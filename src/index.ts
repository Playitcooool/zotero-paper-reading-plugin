import { appendUserDraft, continueChatSession, startChatSession } from "./background/orchestrator.ts";
import { deleteSavedChatSessionForAttachment, loadSavedChatSessionForAttachment, saveChatSessionForAttachment } from "./background/persistence.ts";
import { DEFAULT_SETTINGS, getAllSettings, getSidebarWidth, setSetting, type PluginSettings } from "./background/settings-manager.ts";
import { getCurrentStrings } from "./i18n/index.ts";
import { initPreferencesDocument } from "./preferences/controller.ts";
import { createInitialReaderState, shouldApplyRequestResult, shouldRecreatePanelHost, startRequest, type PanelHostMeta } from "./runtime/reader-runtime.ts";
import { createReaderPanelHost, type ReaderPanelHost } from "./reader/panel.ts";
import { shouldEnableAskAI, toReaderLocation } from "./reader/reference-utils.ts";
import { buildAskAIButtonMarkup, ensureAskAIButtonStyles } from "./reader/toolbar-button.ts";
import type { ChatSession, EvidenceReference } from "./background/types.ts";

declare const Services: any;

const TOOLBAR_LISTENER_ID = "zotero-paper-reading-render-toolbar";
interface PanelHostEntry extends PanelHostMeta {
  host: ReaderPanelHost;
}

const panelHosts = new Map<string, PanelHostEntry>();
const panelState = new Map<string, ReaderState>();

interface FailedTurnState {
  question: string;
  baseSession: ChatSession;
  userMessageId: string;
  errorMessage: string;
  createdAt: string;
}

interface ReaderState {
  session: ChatSession | null;
  bootstrapping: boolean;
  sendingFollowup: boolean;
  retryingTurnId: string | null;
  panelError: string | null;
  failedTurn: FailedTurnState | null;
  requestToken: number;
}

const log = (message: string) => {
  try {
    Services.console.logStringMessage(`ZoteroPaperReading: ${message}`);
  } catch {
    Zotero.log(`ZoteroPaperReading: ${message}`);
  }
};

const hooks = {
  onStartup: async () => {
    const rootURI = (globalThis as { rootURI?: string }).rootURI;
    const strings = getCurrentStrings();
    if (rootURI) {
      Zotero.PreferencePanes.register({
        pluginID: "zoteropaperreading@plugin.local",
        src: rootURI + "chrome/content/preferences.xhtml",
        label: strings.appName,
        scripts: [rootURI + "chrome/content/scripts/zoteropaperreading.js"]
      });
    }
    registerReaderToolbarListener();
  },

  onMainWindowLoad: async () => {
    log("Main window ready");
  },

  onMainWindowUnload: async () => {
    for (const entry of panelHosts.values()) {
      entry.host.dispose();
    }
    panelHosts.clear();
    panelState.clear();
  },

  onShutdown: async () => {
    unregisterReaderToolbarListener();
    for (const entry of panelHosts.values()) {
      entry.host.dispose();
    }
    panelHosts.clear();
    panelState.clear();
  },

  onPrefsLoad: async (event: Event) => {
    const doc = (event.target as Element | null)?.ownerDocument || (globalThis as { document?: Document }).document;
    if (!doc) {
      return;
    }
    initPreferencesDocument(doc, {
      defaults: DEFAULT_SETTINGS,
      getAllSettings,
      setSetting,
      strings: getCurrentStrings()
    });
  }
};

function registerReaderToolbarListener(): void {
  if (!Zotero.Reader?.registerEventListener) {
    log("Reader toolbar listener is unavailable");
    return;
  }
  unregisterReaderToolbarListener();
  Zotero.Reader.registerEventListener("renderToolbar", handleRenderToolbar, TOOLBAR_LISTENER_ID);
}

function unregisterReaderToolbarListener(): void {
  if (!Zotero.Reader?.unregisterEventListener) {
    return;
  }
  Zotero.Reader.unregisterEventListener("renderToolbar", handleRenderToolbar);
}

async function handleRenderToolbar(event: _ZoteroTypes.Reader.EventParams<"renderToolbar">): Promise<void> {
  const strings = getCurrentStrings();
  const attachment = getAttachmentForReader(event.reader);
  if (!attachment || !shouldEnableAskAI({
    itemType: attachment.itemType,
    attachmentReaderType: attachment.attachmentReaderType,
    attachmentContentType: attachment.attachmentContentType
  })) {
    return;
  }

  const existing = event.doc.getElementById("zpr-ask-ai-button");
  if (existing) {
    return;
  }

  const button = event.doc.createElement("button");
  button.id = "zpr-ask-ai-button";
  button.className = "toolbar-button";
  button.type = "button";
  ensureAskAIButtonStyles(event.doc);
  button.innerHTML = buildAskAIButtonMarkup(strings.toolbar.askAI);
  button.setAttribute("aria-label", strings.toolbar.askAI);
  button.setAttribute("title", strings.toolbar.askAI);
  button.addEventListener("click", () => {
    void openChatPanel(event.reader);
  });
  event.append(button);
}

async function openChatPanel(reader: _ZoteroTypes.ReaderInstance): Promise<void> {
  const attachment = getAttachmentForReader(reader);
  if (!attachment) {
    return;
  }

  cleanupReaderRuntime(reader);
  const strings = getCurrentStrings();
  const settings = getAllSettings();
  const sidebarWidth = getSidebarWidth(settings);
  const mainWindow = resolveMainWindow();
  const hostEntry = getOrCreatePanelHost(reader, sidebarWidth, mainWindow, strings);
  const host = hostEntry.host;
  const state = getOrCreateReaderState(reader);

  if (state.session || state.panelError || state.bootstrapping) {
    renderPanelState(reader, host, state);
    return;
  }

  const saved = await loadSavedChatSessionForAttachment(attachment);
  if (saved) {
    state.session = saved.paper.itemID
      ? saved
      : { ...saved, paper: { ...saved.paper, itemID: attachment.id } };
    state.panelError = null;
    renderPanelState(reader, host, state);
    return;
  }

  await startFreshSession(reader);
}

async function startFreshSession(reader: _ZoteroTypes.ReaderInstance, followupQuestion?: string): Promise<void> {
  const attachment = getAttachmentForReader(reader);
  if (!attachment) {
    return;
  }

  const hostEntry = panelHosts.get(getReaderKey(reader));
  const host = hostEntry?.host;
  const state = getOrCreateReaderState(reader);
  if (!host || state.bootstrapping || state.sendingFollowup || state.retryingTurnId) {
    return;
  }

  state.session = null;
  state.bootstrapping = true;
  state.sendingFollowup = false;
  state.retryingTurnId = null;
  state.panelError = null;
  state.failedTurn = null;
  renderPanelState(reader, host, state);
  const requestToken = startRequest(state);

  try {
    const session = await startChatSession(attachment, getAllSettings());
    if (!shouldApplyAsyncResult(reader, state, requestToken, hostEntry)) {
      return;
    }
    state.session = session;
    state.bootstrapping = false;
    renderPanelState(reader, host, state);
    await saveChatSessionForAttachment(attachment, session);
    if (followupQuestion) {
      await submitFollowup(reader, followupQuestion);
    }
  } catch (error) {
    if (!shouldApplyAsyncResult(reader, state, requestToken, hostEntry)) {
      return;
    }
    state.bootstrapping = false;
    state.panelError = error instanceof Error ? error.message : String(error);
    renderPanelState(reader, host, state);
  }
}

function renderPanelState(reader: _ZoteroTypes.ReaderInstance, host: ReaderPanelHost, state: ReaderState): void {
  if (state.bootstrapping && !state.session) {
    const attachment = getAttachmentForReader(reader);
    host.showLoading(
      attachment?.parentItem?.getField?.("title") || getCurrentStrings().panel.untitledPaper,
      getCurrentStrings().panel.loading
    );
    return;
  }

  if (state.panelError && !state.session) {
    host.showError(state.panelError, () => {
      void startFreshSession(reader);
    });
    return;
  }

  if (!state.session) {
    host.showEmpty(undefined, undefined, {
      onStart: () => {
        void startFreshSession(reader);
      },
      onSuggestedQuestion: (question) => {
        void startFreshSession(reader, question);
      }
    }, {
      isBusy: state.bootstrapping
    });
    return;
  }

  host.showChat(state.session, {
    onReferenceClick: (reference) => navigateToReference(reader, reference),
    onSubmit: (question) => {
      void submitFollowup(reader, question);
    },
    onRegenerate: () => {
      void regenerateChatSession(reader);
    },
    onClear: () => {
      void clearChatSession(reader);
    },
    onRetryFailedTurn: () => {
      void retryFailedTurn(reader);
    }
  }, {
    isBusy: state.sendingFollowup || Boolean(state.retryingTurnId),
    failedTurn: state.failedTurn
      ? {
          question: state.failedTurn.question,
          errorMessage: state.failedTurn.errorMessage,
          createdAt: state.failedTurn.createdAt
        }
      : null
  });
}

async function submitFollowup(reader: _ZoteroTypes.ReaderInstance, question: string): Promise<void> {
  const attachment = getAttachmentForReader(reader);
  if (!attachment) {
    return;
  }

  const key = getReaderKey(reader);
  const state = panelState.get(key);
  const hostEntry = panelHosts.get(key);
  const host = hostEntry?.host;
  if (!state?.session || !host || state.bootstrapping || state.sendingFollowup || state.retryingTurnId) {
    return;
  }

  const baseSession = state.session;
  const draft = appendUserDraft(baseSession, question);
  const userMessageId = draft.messages[draft.messages.length - 1]?.id || "";
  state.session = draft;
  state.sendingFollowup = true;
  state.failedTurn = null;
  state.panelError = null;
  renderPanelState(reader, host, state);
  const requestToken = startRequest(state);

  try {
    const next = await continueChatSession(attachment, baseSession, question, getAllSettings());
    if (!shouldApplyAsyncResult(reader, state, requestToken, hostEntry)) {
      return;
    }
    state.session = next;
    state.sendingFollowup = false;
    renderPanelState(reader, host, state);
    await saveChatSessionForAttachment(attachment, next);
  } catch (error) {
    if (!shouldApplyAsyncResult(reader, state, requestToken, hostEntry)) {
      return;
    }
    state.sendingFollowup = false;
    state.failedTurn = {
      question,
      baseSession,
      userMessageId,
      errorMessage: error instanceof Error ? error.message : String(error),
      createdAt: new Date().toISOString()
    };
    renderPanelState(reader, host, state);
  }
}

async function retryFailedTurn(reader: _ZoteroTypes.ReaderInstance): Promise<void> {
  const attachment = getAttachmentForReader(reader);
  if (!attachment) {
    return;
  }

  const key = getReaderKey(reader);
  const state = panelState.get(key);
  const hostEntry = panelHosts.get(key);
  const host = hostEntry?.host;
  if (!state?.failedTurn || !state.session || !host || state.bootstrapping || state.sendingFollowup || state.retryingTurnId) {
    return;
  }

  const failedTurn = state.failedTurn;
  state.retryingTurnId = failedTurn.userMessageId;
  state.failedTurn = null;
  renderPanelState(reader, host, state);
  const requestToken = startRequest(state);

  try {
    const next = await continueChatSession(attachment, failedTurn.baseSession, failedTurn.question, getAllSettings());
    if (!shouldApplyAsyncResult(reader, state, requestToken, hostEntry)) {
      return;
    }
    state.session = next;
    state.retryingTurnId = null;
    renderPanelState(reader, host, state);
    await saveChatSessionForAttachment(attachment, next);
  } catch (error) {
    if (!shouldApplyAsyncResult(reader, state, requestToken, hostEntry)) {
      return;
    }
    state.retryingTurnId = null;
    state.failedTurn = {
      ...failedTurn,
      errorMessage: error instanceof Error ? error.message : String(error),
      createdAt: new Date().toISOString()
    };
    renderPanelState(reader, host, state);
  }
}

async function clearChatSession(reader: _ZoteroTypes.ReaderInstance): Promise<void> {
  const attachment = getAttachmentForReader(reader);
  if (!attachment) {
    return;
  }

  const state = getOrCreateReaderState(reader);
  const host = panelHosts.get(getReaderKey(reader))?.host;
  if (!host || state.bootstrapping || state.sendingFollowup || state.retryingTurnId) {
    return;
  }

  const strings = getCurrentStrings();
  if (!confirmDestructiveAction(reader, strings.panel.clearConfirm)) {
    return;
  }

  await deleteSavedChatSessionForAttachment(attachment);
  state.session = null;
  state.bootstrapping = false;
  state.sendingFollowup = false;
  state.retryingTurnId = null;
  state.panelError = null;
  state.failedTurn = null;
  renderPanelState(reader, host, state);
}

async function regenerateChatSession(reader: _ZoteroTypes.ReaderInstance): Promise<void> {
  const attachment = getAttachmentForReader(reader);
  if (!attachment) {
    return;
  }

  const state = getOrCreateReaderState(reader);
  if (state.bootstrapping || state.sendingFollowup || state.retryingTurnId) {
    return;
  }

  const strings = getCurrentStrings();
  if (!confirmDestructiveAction(reader, strings.panel.regenerateConfirm)) {
    return;
  }

  await deleteSavedChatSessionForAttachment(attachment);
  state.session = null;
  state.failedTurn = null;
  state.panelError = null;
  await startFreshSession(reader);
}

function confirmDestructiveAction(reader: _ZoteroTypes.ReaderInstance, message: string): boolean {
  const title = getCurrentStrings().panel.title;
  const promptWindow = reader._iframeWindow || resolveMainWindow();
  try {
    if (Services?.prompt?.confirm) {
      return Services.prompt.confirm(promptWindow, title, message);
    }
  } catch {
    // Fallback to DOM confirm below.
  }

  try {
    const confirmFn = promptWindow?.confirm || globalThis.confirm;
    return confirmFn ? confirmFn(message) : false;
  } catch {
    return false;
  }
}

function navigateToReference(reader: _ZoteroTypes.ReaderInstance, reference: EvidenceReference): void {
  reader.navigate(toReaderLocation(reference));
}

function getAttachmentForReader(reader: _ZoteroTypes.ReaderInstance): Zotero.Item | null {
  const itemID = reader.itemID;
  if (!itemID) {
    return null;
  }
  const items = (Zotero.Items as { get(ids: number | number[]): Zotero.Item | Zotero.Item[] }).get(itemID);
  return Array.isArray(items) ? items[0] : items;
}

function getOrCreatePanelHost(
  reader: _ZoteroTypes.ReaderInstance,
  sidebarWidth: number,
  mainWindow: Window | null,
  strings: ReturnType<typeof getCurrentStrings>
): PanelHostEntry {
  const key = getReaderKey(reader);
  const existing = panelHosts.get(key);
  const doc = resolvePanelDocument(reader, mainWindow);
  if (!doc) {
    const host = createReaderPanelHost(reader, sidebarWidth, mainWindow, strings);
    host.mount();
    return {
      host,
      doc: (reader._iframeWindow?.document || mainWindow?.document) as Document,
      sidebarWidth
    };
  }

  if (existing && !shouldRecreatePanelHost(existing, doc, sidebarWidth)) {
    return existing;
  }

  if (existing) {
    existing.host.dispose();
    panelHosts.delete(key);
    panelState.delete(key);
  }

  const host = createReaderPanelHost(reader, sidebarWidth, mainWindow, strings);
  host.mount();
  const entry: PanelHostEntry = { host, doc, sidebarWidth };
  panelHosts.set(key, entry);
  return entry;
}

function getOrCreateReaderState(reader: _ZoteroTypes.ReaderInstance): ReaderState {
  const key = getReaderKey(reader);
  const existing = panelState.get(key);
  if (existing) {
    return existing;
  }

  const state: ReaderState = {
    session: null,
    bootstrapping: false,
    sendingFollowup: false,
    retryingTurnId: null,
    panelError: null,
    failedTurn: null,
    ...createInitialReaderState()
  };
  panelState.set(key, state);
  return state;
}

function getReaderKey(reader: _ZoteroTypes.ReaderInstance): string {
  return reader._instanceID || String(reader.itemID || Math.random());
}

function resolveMainWindow(): Window | null {
  try {
    return Services.wm.getMostRecentWindow("navigator:browser");
  } catch {
    return null;
  }
}

function resolvePanelDocument(reader: _ZoteroTypes.ReaderInstance, mainWindow: Window | null): Document | null {
  return reader._iframeWindow?.document || mainWindow?.document || null;
}

function cleanupReaderRuntime(reader: _ZoteroTypes.ReaderInstance): void {
  const key = getReaderKey(reader);
  const entry = panelHosts.get(key);
  if (entry && !entry.doc.documentElement?.isConnected) {
    entry.host.dispose();
    panelHosts.delete(key);
    panelState.delete(key);
  }
}

function shouldApplyAsyncResult(
  reader: _ZoteroTypes.ReaderInstance,
  state: ReaderState,
  requestToken: number,
  hostEntry: PanelHostEntry | undefined
): boolean {
  if (!shouldApplyRequestResult(state, requestToken)) {
    return false;
  }

  const currentEntry = panelHosts.get(getReaderKey(reader));
  if (!currentEntry || !hostEntry || currentEntry !== hostEntry) {
    return false;
  }

  return currentEntry.doc.documentElement?.isConnected !== false;
}

(Zotero as any).ZoteroPaperReading = { hooks };
export { hooks };
