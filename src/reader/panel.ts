import type { ChatMessage, ChatSession, CitationRef, EvidenceReference } from "../background/types.ts";
import katex from "katex";
import MarkdownIt from "markdown-it/dist/index.cjs.js";
import texmath from "markdown-it-texmath";
import type { PluginStrings } from "../i18n/index.ts";
import { getCurrentLocale } from "../i18n/index.ts";
import { getResizedSidebarWidth, shouldAutoScrollTranscript } from "../runtime/reader-runtime.ts";

const markdownRenderer = createMarkdownRenderer();
const HOST_SHORTCUT_KEYS = new Set([
  "Backspace",
  "Delete",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  " ",
  "Spacebar",
  "Escape"
]);
const SELECTABLE_CONTENT_SELECTOR = ".zpr-chat-list, .zpr-message, .zpr-message-body, .zpr-meta, .zpr-notice";
const NON_SELECTABLE_CONTROL_SELECTOR =
  ".zpr-sidebar-resize, .zpr-close-button, .zpr-toolbar-button, .zpr-text-button, .zpr-composer, .zpr-jump-button, button";

export interface ReaderPanelChromeHandlers {
  onClose: () => void;
  onResize: (width: number) => void;
}

export interface ReaderPanelHost {
  mount(): boolean;
  setHidden(hidden: boolean): void;
  setWidth(width: number): void;
  showLoading(title: string, subtitle?: string): void;
  showEmpty(
    title?: string,
    message?: string,
    handlers?: {
      onStart: () => void;
      onSuggestedQuestion: (question: string) => void;
    },
    options?: { isBusy?: boolean }
  ): void;
  showChat(
    session: ChatSession,
    handlers: {
      onReferenceClick: (reference: EvidenceReference) => void;
      onSubmit: (question: string) => void;
      onRetryFailedTurn?: () => void;
      onRegenerate?: () => void;
      onClear?: () => void;
    },
    options?: {
      notice?: string;
      isBusy?: boolean;
      failedTurn?: {
        question: string;
        errorMessage: string;
        createdAt: string;
      } | null;
    }
  ): void;
  showError(message: string, onRetry?: () => void): void;
  dispose(): void;
}

export function createReaderPanelHost(
  reader: _ZoteroTypes.ReaderInstance,
  sidebarWidth: number,
  mainWindow: Window | null,
  strings: PluginStrings,
  chromeHandlers: ReaderPanelChromeHandlers,
  docHint?: Document
): ReaderPanelHost {
  const readerDoc = reader._iframeWindow?.document || null;
  const doc = docHint || readerDoc || mainWindow?.document || null;
  if (!doc) {
    return new NoopPanelHost();
  }
  return new FixedSidebarHost(doc, sidebarWidth, doc === readerDoc, strings, chromeHandlers);
}

class FixedSidebarHost implements ReaderPanelHost {
  private readonly doc: Document;
  private readonly isReaderDoc: boolean;
  private readonly strings: PluginStrings;
  private readonly chromeHandlers: ReaderPanelChromeHandlers;
  private sidebarWidth: number;
  private root: HTMLDivElement | null = null;
  private content: HTMLDivElement | null = null;
  private notice: HTMLDivElement | null = null;
  private meta: HTMLDivElement | null = null;
  private transcript: HTMLDivElement | null = null;
  private jumpButton: HTMLButtonElement | null = null;
  private composer: HTMLFormElement | null = null;
  private composerInput: HTMLTextAreaElement | null = null;
  private composerSendButton: HTMLButtonElement | null = null;
  private readonly messageNodes = new Map<string, HTMLDivElement>();
  private failedTurnNode: HTMLDivElement | null = null;
  private draftValue = "";
  private isComposerComposing = false;
  private lastComposerBusy = false;
  private currentSubmitHandler: ((question: string) => void) | null = null;
  private autoScroll = true;
  private lastManualScrollTop = 0;
  private isHidden = false;
  private globalIsolationInstalled = false;

  constructor(
    doc: Document,
    sidebarWidth: number,
    isReaderDoc: boolean,
    strings: PluginStrings,
    chromeHandlers: ReaderPanelChromeHandlers
  ) {
    this.doc = doc;
    this.sidebarWidth = sidebarWidth;
    this.isReaderDoc = isReaderDoc;
    this.strings = strings;
    this.chromeHandlers = chromeHandlers;
  }

  mount(): boolean {
    this.ensureStyles();
    if (!this.root) {
      this.root = this.doc.createElement("div");
      this.root.id = "zpr-sidebar-root";
      this.root.setAttribute("role", "complementary");
      this.root.setAttribute("aria-labelledby", "zpr-sidebar-title");
      this.root.innerHTML = `
        <div class="zpr-sidebar-resize" data-zpr-action="resize" aria-hidden="true"></div>
        <div class="zpr-sidebar-card">
          <div class="zpr-sidebar-head">
            <div class="zpr-sidebar-title" id="zpr-sidebar-title">${escapeHtml(this.strings.panel.title)}</div>
            <button type="button" class="zpr-close-button" data-zpr-action="close-panel" aria-label="${escapeHtml(this.strings.panel.close)}" title="${escapeHtml(this.strings.panel.close)}">×</button>
          </div>
          <div class="zpr-sidebar-content"></div>
        </div>
      `;
      this.content = this.root.querySelector(".zpr-sidebar-content") as HTMLDivElement;
      (this.doc.body || this.doc.documentElement).appendChild(this.root);
      this.root.querySelector('[data-zpr-action="close-panel"]')?.addEventListener("click", () => {
        this.chromeHandlers.onClose();
      });
      this.installGlobalIsolation();
      this.bindResizeHandle();
      this.syncLayout();
    }
    return true;
  }

  setHidden(hidden: boolean): void {
    this.isHidden = hidden;
    if (!this.mount() || !this.root) {
      return;
    }
    this.root.classList.toggle("zpr-sidebar-hidden", hidden);
    this.syncLayout();
  }

  setWidth(width: number): void {
    this.sidebarWidth = width;
    this.syncLayout();
  }

  showLoading(title: string, subtitle: string = this.strings.panel.loading): void {
    if (!this.mount() || !this.content) {
      return;
    }
    this.resetChatViewState(true);
    this.content.innerHTML = `
      <div class="zpr-loading">
        <div class="zpr-loading-badge">${escapeHtml(this.strings.panel.title)}</div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </div>
    `;
  }

  showEmpty(
    title: string = this.strings.panel.emptyChatTitle,
    message: string = this.strings.panel.emptyChatBody,
    handlers?: {
      onStart: () => void;
      onSuggestedQuestion: (question: string) => void;
    },
    options: { isBusy?: boolean } = {}
  ): void {
    if (!this.mount() || !this.content) {
      return;
    }

    this.resetChatViewState(true);
    this.content.innerHTML = "";
    const empty = this.doc.createElement("div");
    empty.className = "zpr-empty";
    empty.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
      <button type="button" class="zpr-primary-button" data-zpr-empty-action="start">${escapeHtml(this.strings.panel.startNewReading)}</button>
      <div class="zpr-suggestion-list"></div>
    `;
    this.content.appendChild(empty);

    const startButton = empty.querySelector('[data-zpr-empty-action="start"]') as HTMLButtonElement | null;
    if (startButton) {
      startButton.disabled = Boolean(options.isBusy);
      startButton.addEventListener("click", () => handlers?.onStart());
    }

    const suggestionList = empty.querySelector(".zpr-suggestion-list") as HTMLDivElement | null;
    if (suggestionList) {
      for (const question of getSuggestedQuestions(this.strings)) {
        const button = this.doc.createElement("button");
        button.type = "button";
        button.className = "zpr-suggestion-button";
        button.textContent = question;
        button.disabled = Boolean(options.isBusy);
        button.addEventListener("click", () => handlers?.onSuggestedQuestion(question));
        suggestionList.appendChild(button);
      }
    }
  }

  showChat(
    session: ChatSession,
    handlers: {
      onReferenceClick: (reference: EvidenceReference) => void;
      onSubmit: (question: string) => void;
      onRetryFailedTurn?: () => void;
      onRegenerate?: () => void;
      onClear?: () => void;
    },
    options: {
      notice?: string;
      isBusy?: boolean;
      failedTurn?: {
        question: string;
        errorMessage: string;
        createdAt: string;
      } | null;
    } = {}
  ): void {
    if (!this.mount() || !this.content) {
      return;
    }

    const previousScrollTop = this.autoScroll ? 0 : this.lastManualScrollTop;
    const isBusy = Boolean(options.isBusy);
    const wasBusy = this.lastComposerBusy;
    const activeElement = this.doc.activeElement;
    this.currentSubmitHandler = handlers.onSubmit;
    this.ensureChatView();
    if (!this.content || !this.notice || !this.meta || !this.transcript || !this.jumpButton || !this.composerInput || !this.composerSendButton) {
      return;
    }

    const toolbarActions = buildPanelToolbarActions(this.strings);
    if (!this.content.querySelector(".zpr-result-head") && toolbarActions.length) {
      const toolbar = this.doc.createElement("div");
      toolbar.className = "zpr-result-head";
      toolbar.innerHTML = `<div class="zpr-result-actions">${toolbarActions.map((action) => (
        `<button type="button" class="zpr-toolbar-button${action.danger ? " zpr-toolbar-button-danger" : ""}" data-zpr-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
      )).join("")}</div>`;
      this.content.insertBefore(toolbar, this.content.firstChild);

      toolbar.querySelector('[data-zpr-action="regenerate"]')?.addEventListener("click", () => {
        handlers.onRegenerate?.();
      });
      toolbar.querySelector('[data-zpr-action="clear"]')?.addEventListener("click", () => {
        handlers.onClear?.();
      });
    }

    const toolbarButtons = Array.from(this.content.querySelectorAll(".zpr-result-head [data-zpr-action]")) as HTMLButtonElement[];
    for (const button of toolbarButtons) {
      button.disabled = isBusy;
    }

    this.setNotice(options.notice || null);

    const visibleMeta = buildVisibleSessionMeta(session, this.strings);
    this.meta.innerHTML = `
      <div class="zpr-meta-title">${escapeHtml(visibleMeta.title)}</div>
      ${visibleMeta.detail ? `<div class="zpr-meta-subtitle">${escapeHtml(visibleMeta.detail)}</div>` : ""}
    `;

    this.renderTranscript(session.messages, handlers.onReferenceClick);
    this.renderFailedTurn(options.failedTurn, handlers.onRetryFailedTurn);

    syncComposerDisabledState(this.composerInput, this.composerSendButton, isBusy);
    this.lastComposerBusy = isBusy;

    if (this.autoScroll) {
      this.scrollTranscriptToBottom();
    } else {
      this.transcript.scrollTop = previousScrollTop;
    }
    this.updateJumpButtonVisibility();
    if (getComposerFocusBehavior({
      wasBusy,
      isBusy,
      isInputFocused: activeElement === this.composerInput,
      preserveExistingFocus: this.shouldPreserveExistingFocus(activeElement)
    }) === "focus") {
      this.composerInput.focus();
    }
  }

  showError(message: string, onRetry?: () => void): void {
    if (!this.mount() || !this.content) {
      return;
    }
    this.resetChatViewState(true);
    this.content.innerHTML = `<div class="zpr-error"><strong>${escapeHtml(this.strings.panel.analysisFailed)}</strong><span>${escapeHtml(message)}</span></div>`;
    if (onRetry) {
      const button = this.doc.createElement("button");
      button.className = "zpr-reference-button";
      button.textContent = this.strings.panel.retry;
      button.addEventListener("click", onRetry);
      this.content.appendChild(button);
    }
  }

  dispose(): void {
    this.removeGlobalIsolation();
    this.doc.documentElement.style.removeProperty("--zpr-sidebar-width");
    this.doc.body?.style.removeProperty("margin-right");
    this.root?.remove();
    this.root = null;
    this.content = null;
    this.notice = null;
    this.meta = null;
    this.transcript = null;
    this.jumpButton = null;
    this.composer = null;
    this.composerInput = null;
    this.composerSendButton = null;
    this.currentSubmitHandler = null;
    this.messageNodes.clear();
    this.failedTurnNode = null;
  }

  private installGlobalIsolation(): void {
    const view = this.doc.defaultView;
    if (!view || this.globalIsolationInstalled) {
      return;
    }
    const options = { capture: true } as const;
    view.addEventListener("keydown", this.handleWindowKeyCapture, options);
    view.addEventListener("keyup", this.handleWindowKeyCapture, options);
    view.addEventListener("pointerdown", this.handlePointerCapture, options);
    view.addEventListener("pointerup", this.handlePointerCapture, options);
    this.doc.addEventListener("mousedown", this.handlePointerCapture, options);
    this.doc.addEventListener("mouseup", this.handlePointerCapture, options);
    this.doc.addEventListener("click", this.handlePointerCapture, options);
    this.doc.addEventListener("dragstart", this.handlePointerCapture, options);
    this.doc.addEventListener("selectstart", this.handleSelectStartCapture, options);
    this.globalIsolationInstalled = true;
  }

  private removeGlobalIsolation(): void {
    const view = this.doc.defaultView;
    if (!view || !this.globalIsolationInstalled) {
      return;
    }
    const options = { capture: true } as const;
    view.removeEventListener("keydown", this.handleWindowKeyCapture, options);
    view.removeEventListener("keyup", this.handleWindowKeyCapture, options);
    view.removeEventListener("pointerdown", this.handlePointerCapture, options);
    view.removeEventListener("pointerup", this.handlePointerCapture, options);
    this.doc.removeEventListener("mousedown", this.handlePointerCapture, options);
    this.doc.removeEventListener("mouseup", this.handlePointerCapture, options);
    this.doc.removeEventListener("click", this.handlePointerCapture, options);
    this.doc.removeEventListener("dragstart", this.handlePointerCapture, options);
    this.doc.removeEventListener("selectstart", this.handleSelectStartCapture, options);
    this.globalIsolationInstalled = false;
  }

  private readonly handleWindowKeyCapture = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    if (this.doc.activeElement !== this.composerInput || !this.isComposerTarget(event.target) || !HOST_SHORTCUT_KEYS.has(event.key)) {
      return;
    }
    stopHostEvent(event);
  };

  private readonly handlePointerCapture = (event: Event): void => {
    if (!this.isPointerInSelectableContent(event)) {
      return;
    }
    stopHostEvent(event);
  };

  private readonly handleSelectStartCapture = (event: Event): void => {
    if (!this.isEventInsideSidebar(event) && !this.isSelectionInsideSidebar()) {
      return;
    }
    stopHostEvent(event);
  };

  private isEventInsideSidebar(event: Event): boolean {
    const target = event.target;
    return target instanceof Node && Boolean(this.root?.contains(target));
  }

  private isComposerTarget(target: EventTarget | null): boolean {
    return target instanceof Node && Boolean(this.composerInput?.contains(target));
  }

  private isPointerInSelectableContent(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Element) || !this.root?.contains(target)) {
      return false;
    }
    if (target.closest(NON_SELECTABLE_CONTROL_SELECTOR)) {
      return false;
    }
    return Boolean(target.closest(SELECTABLE_CONTENT_SELECTOR));
  }

  private isSelectionInsideSidebar(): boolean {
    const selection = this.doc.defaultView?.getSelection?.();
    if (!selection || selection.rangeCount < 1) {
      return false;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    return Boolean(
      (anchorNode && this.root?.contains(anchorNode)) ||
      (focusNode && this.root?.contains(focusNode))
    );
  }

  private buildMessageBubble(message: ChatMessage, onReferenceClick: (reference: EvidenceReference) => void): HTMLDivElement {
    const bubble = this.doc.createElement("div");
    this.renderMessageBubble(bubble, message, onReferenceClick);
    return bubble;
  }

  private renderMessageBubble(
    bubble: HTMLDivElement,
    message: ChatMessage,
    onReferenceClick: (reference: EvidenceReference) => void
  ): void {
    bubble.className = `zpr-message zpr-message-${message.role}${getMessageBubbleStateClasses(message).map((name) => ` ${name}`).join("")}`;
    bubble.setAttribute("data-zpr-message-id", message.id);
    const bodyHtml = message.role === "assistant" && !message.markdown.trim() && message.status === "pending"
      ? buildPendingIndicatorMarkup(this.strings)
      : `<div class="zpr-message-body">${renderMarkdownToHtml(message.markdown, message.citations)}</div>`;
    const messageMeta = buildVisibleMessageMeta(message, this.strings);
    bubble.innerHTML = `
      <div class="zpr-message-meta">
        ${messageMeta.showRole ? `<div class="zpr-message-role">${escapeHtml(messageMeta.roleLabel)}</div>` : "<div></div>"}
        <div class="zpr-message-time">${escapeHtml(formatMessageTimestamp(message.createdAt))}</div>
      </div>
      ${bodyHtml}
      ${shouldShowMessageCopyButton(message) ? `<div class="zpr-message-actions"><button type="button" class="zpr-text-button" data-zpr-message-copy="${escapeHtml(message.id)}">${escapeHtml(this.strings.panel.copyMessage)}</button></div>` : ""}
    `;
    bindCitationClicks(bubble, message.citations, onReferenceClick);

    const copyButton = bubble.querySelector(`[data-zpr-message-copy="${escapeHtml(message.id)}"]`) as HTMLButtonElement | null;
    copyButton?.addEventListener("click", () => {
      void this.handleCopyMessage(copyButton, message.markdown);
    });
  }

  private ensureChatView(): void {
    if (!this.content) {
      return;
    }

    if (this.notice && this.meta && this.transcript && this.jumpButton && this.composer && this.composerInput && this.composerSendButton) {
      return;
    }

    this.content.innerHTML = "";

    const notice = this.doc.createElement("div");
    notice.className = "zpr-notice";
    notice.style.display = "none";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    this.content.appendChild(notice);
    this.notice = notice;

    const meta = this.doc.createElement("div");
    meta.className = "zpr-meta";
    this.content.appendChild(meta);
    this.meta = meta;

    const transcript = this.doc.createElement("div");
    transcript.className = "zpr-chat-list";
    transcript.addEventListener("scroll", () => {
      this.autoScroll = shouldAutoScrollTranscript({
        scrollTop: transcript.scrollTop,
        clientHeight: transcript.clientHeight,
        scrollHeight: transcript.scrollHeight
      });
      if (!this.autoScroll) {
        this.lastManualScrollTop = transcript.scrollTop;
      }
      this.updateJumpButtonVisibility();
    });
    this.content.appendChild(transcript);
    this.transcript = transcript;

    const jumpButton = this.doc.createElement("button");
    jumpButton.type = "button";
    jumpButton.className = "zpr-jump-button";
    jumpButton.textContent = this.strings.panel.jumpToLatest;
    jumpButton.addEventListener("click", () => {
      this.autoScroll = true;
      this.scrollTranscriptToBottom();
      this.updateJumpButtonVisibility();
    });
    this.content.appendChild(jumpButton);
    this.jumpButton = jumpButton;

    const composer = this.doc.createElement("form");
    composer.className = "zpr-composer";
    composer.innerHTML = `
      <textarea class="zpr-composer-input" aria-label="${escapeHtml(this.strings.panel.composerPlaceholder)}" placeholder="${escapeHtml(this.strings.panel.composerPlaceholder)}"></textarea>
      <button type="submit" class="zpr-composer-send">${escapeHtml(this.strings.panel.send)}</button>
    `;
    const input = composer.querySelector(".zpr-composer-input") as HTMLTextAreaElement | null;
    const sendButton = composer.querySelector(".zpr-composer-send") as HTMLButtonElement | null;
    if (!input || !sendButton) {
      return;
    }

    if (input.value !== this.draftValue) {
      input.value = this.draftValue;
    }

    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value || this.lastComposerBusy) {
        return;
      }
      this.draftValue = "";
      input.value = "";
      syncComposerDisabledState(input, sendButton, true);
      this.currentSubmitHandler?.(value);
    });

    input.addEventListener("input", (event) => {
      this.draftValue = input.value;
      syncComposerDisabledState(input, sendButton, this.lastComposerBusy);
    });
    input.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType === "deleteContentBackward" || inputEvent.inputType === "deleteContentForward") {
        stopHostEvent(inputEvent);
      }
    });
    input.addEventListener("keyup", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (HOST_SHORTCUT_KEYS.has(keyboardEvent.key)) {
        stopHostEvent(keyboardEvent);
      }
    });
    input.addEventListener("compositionstart", (event) => {
      this.isComposerComposing = true;
    });
    input.addEventListener("compositionend", (event) => {
      this.isComposerComposing = false;
      this.draftValue = input.value;
      syncComposerDisabledState(input, sendButton, this.lastComposerBusy);
    });
    input.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (HOST_SHORTCUT_KEYS.has(keyboardEvent.key)) {
        stopHostEvent(keyboardEvent);
      }
      const action = getComposerKeyAction({
        key: keyboardEvent.key,
        shiftKey: keyboardEvent.shiftKey,
        isComposing: keyboardEvent.isComposing || this.isComposerComposing,
        isBusy: this.lastComposerBusy
      });
      if (action === "submit") {
        keyboardEvent.preventDefault();
        composer.requestSubmit();
      }
    });

    this.content.appendChild(composer);
    this.composer = composer;
    this.composerInput = input;
    this.composerSendButton = sendButton;
  }

  private bindResizeHandle(): void {
    const handle = this.root?.querySelector('[data-zpr-action="resize"]') as HTMLDivElement | null;
    const view = this.doc.defaultView;
    if (!handle || !view) {
      return;
    }

    handle.addEventListener("pointerdown", (event) => {
      const startWidth = this.sidebarWidth;
      const startClientX = event.clientX;
      const move = (moveEvent: PointerEvent) => {
        const nextWidth = getResizedSidebarWidth({
          startWidth,
          startClientX,
          currentClientX: moveEvent.clientX,
          viewportWidth: view.innerWidth || this.doc.documentElement.clientWidth || 1280
        });
        this.setWidth(nextWidth);
        this.chromeHandlers.onResize(nextWidth);
      };
      const stop = () => {
        view.removeEventListener("pointermove", move);
        view.removeEventListener("pointerup", stop);
      };

      handle.setPointerCapture?.(event.pointerId);
      view.addEventListener("pointermove", move);
      view.addEventListener("pointerup", stop, { once: true });
    });
  }

  private resetChatViewState(clearDraft: boolean): void {
    if (this.composerInput) {
      this.draftValue = this.composerInput.value;
    }
    if (clearDraft) {
      this.draftValue = "";
    }
    this.notice = null;
    this.meta = null;
    this.transcript = null;
    this.jumpButton = null;
    this.composer = null;
    this.composerInput = null;
    this.composerSendButton = null;
    this.currentSubmitHandler = null;
    this.messageNodes.clear();
    this.failedTurnNode = null;
    this.isComposerComposing = false;
    this.lastComposerBusy = false;
    this.autoScroll = true;
    this.lastManualScrollTop = 0;
  }

  private syncLayout(): void {
    this.doc.documentElement.style.setProperty("--zpr-sidebar-width", `${this.sidebarWidth}px`);
    if (this.root) {
      this.root.style.display = this.isHidden ? "none" : "block";
      const topInset = this.isReaderDoc ? this.resolveReaderTopInset() : 0;
      this.root.style.top = `${topInset}px`;
      this.root.style.height = topInset > 0 ? `calc(100vh - ${topInset}px)` : "100vh";
    }
    if (this.isReaderDoc) {
      if (this.isHidden) {
        this.doc.body?.style.removeProperty("margin-right");
      } else {
        this.doc.body?.style.setProperty("margin-right", `${this.sidebarWidth}px`);
      }
    }
  }

  private scrollTranscriptToBottom(): void {
    if (!this.transcript) {
      return;
    }
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  private updateJumpButtonVisibility(): void {
    if (!this.jumpButton || !this.transcript) {
      return;
    }
    const shouldShow = !this.autoScroll && this.transcript.scrollHeight > this.transcript.clientHeight;
    this.jumpButton.classList.toggle("zpr-jump-button-visible", shouldShow);
  }

  private ensureStyles(): void {
    if (this.doc.getElementById("zpr-sidebar-style")) {
      return;
    }
    const style = this.doc.createElement("style");
    style.id = "zpr-sidebar-style";
    style.textContent = getSidebarStyles();
    this.doc.documentElement.appendChild(style);
  }

  private resolveReaderTopInset(): number {
    const askAIButton = this.doc.getElementById("zpr-ask-ai-button");
    const toolbar = askAIButton?.closest(".toolbar, [role='toolbar'], header");
    const bounds = toolbar?.getBoundingClientRect?.();
    if (!bounds) {
      return 0;
    }
    return Math.max(0, Math.round(bounds.bottom));
  }

  private renderTranscript(
    messages: ChatMessage[],
    onReferenceClick: (reference: EvidenceReference) => void
  ): void {
    if (!this.transcript) {
      return;
    }

    const visibleMessages = messages.filter((message) => message.role !== "system");
    const visibleIds = new Set(visibleMessages.map((message) => message.id));
    for (const [messageId, node] of this.messageNodes) {
      if (visibleIds.has(messageId)) {
        continue;
      }
      node.remove();
      this.messageNodes.delete(messageId);
    }

    for (const message of visibleMessages) {
      const existing = this.messageNodes.get(message.id);
      const bubble = existing || this.doc.createElement("div");
      this.renderMessageBubble(bubble, message, onReferenceClick);
      this.messageNodes.set(message.id, bubble);
      this.transcript.appendChild(bubble);
    }
  }

  private renderFailedTurn(
    failedTurn: {
      question: string;
      errorMessage: string;
      createdAt: string;
    } | null | undefined,
    onRetryFailedTurn?: () => void
  ): void {
    if (!this.transcript) {
      return;
    }
    if (!failedTurn) {
      this.failedTurnNode?.remove();
      this.failedTurnNode = null;
      return;
    }

    const error = this.failedTurnNode || this.doc.createElement("div");
    error.className = "zpr-message zpr-message-assistant zpr-message-error";
    error.innerHTML = `
      <div class="zpr-message-meta">
        <div></div>
        <div class="zpr-message-time">${escapeHtml(formatMessageTimestamp(failedTurn.createdAt))}</div>
      </div>
      <div class="zpr-pending" role="status" aria-live="polite">${escapeHtml(failedTurn.errorMessage)}</div>
      <div class="zpr-message-actions">
        <button type="button" class="zpr-text-button" data-zpr-action="retry-turn">${escapeHtml(this.strings.panel.retryTurn)}</button>
      </div>
    `;
    error.querySelector('[data-zpr-action="retry-turn"]')?.addEventListener("click", () => {
      onRetryFailedTurn?.();
    });
    this.transcript.appendChild(error);
    this.failedTurnNode = error;
  }

  private setNotice(message: string | null): void {
    if (!this.notice) {
      return;
    }
    this.notice.textContent = message || "";
    this.notice.style.display = message ? "block" : "none";
  }

  private async handleCopyMessage(button: HTMLButtonElement | null, value: string): Promise<void> {
    const copied = await copyText(this.doc, value);
    if (!button) {
      return;
    }
    if (copied) {
      flashCopiedLabel(this.doc, button, this.strings.panel.copyMessage, this.strings.panel.copied);
      return;
    }
    this.setNotice(this.strings.panel.copyFailed);
  }

  private shouldPreserveExistingFocus(activeElement: Element | null): boolean {
    if (!activeElement || !this.root) {
      return false;
    }
    if (!this.root.contains(activeElement)) {
      return false;
    }
    return activeElement !== this.composerInput;
  }
}

export function getSidebarStyles(): string {
  return `
      #zpr-sidebar-root {
        position: fixed;
        top: 0;
        right: 0;
        width: var(--zpr-sidebar-width, 420px);
        height: 100vh;
        z-index: 2147483647;
        padding: 12px 12px 12px 0;
        box-sizing: border-box;
        pointer-events: auto;
        display: flex;
        position: fixed;
      }
      .zpr-sidebar-hidden {
        display: none;
      }
      .zpr-sidebar-resize {
        position: absolute;
        left: -12px;
        top: 0;
        bottom: 0;
        width: 24px;
        cursor: col-resize;
        pointer-events: auto;
        user-select: none !important;
        -moz-user-select: none !important;
        -webkit-user-select: none !important;
      }
      .zpr-sidebar-card {
        pointer-events: auto;
        height: 100%;
        flex: 1;
        border-left: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(255, 255, 255, 0.96);
        color: #0f172a;
        box-shadow: -12px 0 30px rgba(15, 23, 42, 0.08);
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      }
      .zpr-sidebar-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        padding: 14px 16px 8px;
        border-bottom: 1px solid rgba(226, 232, 240, 0.9);
      }
      .zpr-sidebar-title {
        font-size: 16px;
        font-weight: 700;
      }
      .zpr-close-button {
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.92);
        color: #475569;
        width: 28px;
        height: 28px;
        flex: none;
        cursor: pointer;
        user-select: none !important;
        -moz-user-select: none !important;
        -webkit-user-select: none !important;
      }
      .zpr-close-button:focus-visible,
      .zpr-toolbar-button:focus-visible,
      .zpr-text-button:focus-visible,
      .zpr-jump-button:focus-visible,
      .zpr-composer-send:focus-visible,
      .zpr-primary-button:focus-visible,
      .zpr-suggestion-button:focus-visible,
      .zpr-reference-button:focus-visible,
      .zpr-citation-button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
        border-radius: 12px;
      }
      .zpr-sidebar-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 12px 16px 16px;
      }
      .zpr-result-head {
        display: flex;
        justify-content: flex-end;
        margin: -12px -16px 10px;
        padding: 10px 16px 8px;
        background: rgba(255, 255, 255, 0.94);
        border-bottom: 1px solid rgba(226, 232, 240, 0.75);
      }
      .zpr-result-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .zpr-secondary-button,
      .zpr-reference-button,
      .zpr-composer-send,
      .zpr-citation-button,
      .zpr-primary-button,
      .zpr-suggestion-button {
        border: 1px solid rgba(148, 163, 184, 0.45);
        background: #fff;
        color: #0f172a;
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
      }
      .zpr-primary-button {
        background: #0f172a;
        color: #fff;
        border-color: #0f172a;
        font-weight: 600;
      }
      .zpr-secondary-button {
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
      }
      .zpr-danger-button {
        color: #b42318;
        border-color: rgba(180, 35, 24, 0.25);
      }
      .zpr-toolbar-button {
        border: none;
        background: transparent;
        color: #475569;
        padding: 0;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        user-select: none !important;
        -moz-user-select: none !important;
        -webkit-user-select: none !important;
      }
      .zpr-toolbar-button-danger {
        color: #b42318;
      }
      .zpr-toolbar-button:disabled {
        opacity: 0.55;
      }
      .zpr-meta {
        margin-bottom: 4px;
      }
      .zpr-meta-title {
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 4px;
      }
      .zpr-meta-subtitle,
      .zpr-meta-mini {
        color: #475569;
        font-size: 12px;
        line-height: 1.5;
      }
      .zpr-chat-list {
        flex: 1;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 18px 0;
      }
      .zpr-message {
        border-radius: 14px;
        padding: 12px 14px;
        max-width: 100%;
      }
      .zpr-message-assistant {
        background: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.2);
      }
      .zpr-message-user {
        background: #eff6ff;
        border: 1px solid rgba(59, 130, 246, 0.18);
      }
      .zpr-message-error {
        background: #fff7ed;
        border-color: rgba(249, 115, 22, 0.24);
      }
      .zpr-message-streaming {
        position: relative;
      }
      .zpr-message-streaming::after {
        content: "";
        position: absolute;
        right: 12px;
        bottom: 12px;
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #2563eb;
        animation: zpr-stream-pulse 1s ease-in-out infinite;
      }
      .zpr-message-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .zpr-message-role {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #64748b;
      }
      .zpr-message-time {
        font-size: 11px;
        color: #94a3b8;
      }
      .zpr-message-body,
      .zpr-pending,
      .zpr-loading span,
      .zpr-error span,
      .zpr-empty span {
        line-height: 1.65;
        font-size: 13px;
      }
      .zpr-message-body {
        user-select: text !important;
        -moz-user-select: text !important;
        -webkit-user-select: text !important;
      }
      .zpr-message-body * {
        user-select: text !important;
        -moz-user-select: text !important;
        -webkit-user-select: text !important;
      }
      .zpr-message-body p,
      .zpr-message-body ul,
      .zpr-message-body ol,
      .zpr-message-body pre,
      .zpr-message-body blockquote,
      .zpr-message-body h1,
      .zpr-message-body h2,
      .zpr-message-body h3 {
        margin: 0 0 10px;
      }
      .zpr-message-body table {
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0;
        font-size: 12px;
      }
      .zpr-message-body th,
      .zpr-message-body td {
        border: 1px solid rgba(148, 163, 184, 0.45);
        padding: 6px 8px;
        vertical-align: top;
      }
      .zpr-message-body thead th {
        background: rgba(241, 245, 249, 0.9);
        font-weight: 700;
      }
      .zpr-message-body ul,
      .zpr-message-body ol {
        padding-left: 18px;
      }
      .zpr-message-body pre {
        padding: 10px;
        background: #0f172a;
        color: #e2e8f0;
        overflow: auto;
        border-radius: 10px;
      }
      .zpr-message-body code {
        font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
      }
      .zpr-message-body .katex {
        font-size: 1em;
      }
      .zpr-message-body .katex math {
        display: inline-block;
      }
      .zpr-message-body .katex-display {
        display: block;
        overflow-x: auto;
        margin: 10px 0;
        text-align: center;
      }
      .zpr-message-body a {
        color: #2563eb;
      }
      .zpr-message-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      .zpr-chat-list,
      .zpr-message,
      .zpr-meta,
      .zpr-notice {
        user-select: text !important;
        -moz-user-select: text !important;
        -webkit-user-select: text !important;
      }
      .zpr-text-button {
        border: none;
        background: transparent;
        color: #2563eb;
        padding: 0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        user-select: none !important;
        -moz-user-select: none !important;
        -webkit-user-select: none !important;
      }
      .zpr-citation-button,
      .zpr-citation-label {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 12px;
        margin: 0 2px;
      }
      .zpr-citation-button {
        background: #dbeafe;
        border-color: rgba(59, 130, 246, 0.2);
      }
      .zpr-citation-label {
        background: #f1f5f9;
        color: #475569;
      }
      .zpr-composer {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        padding-top: 12px;
        border-top: 1px solid rgba(226, 232, 240, 0.85);
      }
      .zpr-jump-button {
        align-self: center;
        margin-top: -4px;
        margin-bottom: 8px;
        border: none;
        border-radius: 999px;
        background: #0f172a;
        color: #fff;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transform: translateY(6px);
        transition: opacity 120ms ease, transform 120ms ease;
      }
      .zpr-jump-button-visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .zpr-composer-input {
        min-height: 64px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 12px;
        padding: 10px 12px;
        resize: vertical;
        font: inherit;
        background: rgba(248, 250, 252, 0.95);
        color: #0f172a;
      }
      .zpr-composer-input:focus {
        outline: none;
        border-color: rgba(100, 116, 139, 0.55);
        box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.15);
      }
      .zpr-composer-input:focus-visible {
        outline: none;
        border-color: rgba(37, 99, 235, 0.48);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
      }
      .zpr-composer-send {
        align-self: end;
        min-width: 72px;
        font-weight: 600;
        user-select: none !important;
        -moz-user-select: none !important;
        -webkit-user-select: none !important;
      }
      .zpr-loading,
      .zpr-empty,
      .zpr-error {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .zpr-loading-badge {
        align-self: flex-start;
        padding: 4px 8px;
        border-radius: 999px;
        background: #dbeafe;
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .zpr-suggestion-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .zpr-suggestion-button {
        text-align: left;
        background: #f8fafc;
      }
      .zpr-notice {
        margin-bottom: 14px;
        padding: 10px 12px;
        border-radius: 12px;
        background: #eff6ff;
        color: #1e3a8a;
        font-size: 12px;
        line-height: 1.5;
      }
      .zpr-pending {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .zpr-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(148, 163, 184, 0.35);
        border-top-color: #2563eb;
        border-radius: 999px;
        animation: zpr-spin 0.8s linear infinite;
        flex: none;
      }
      @keyframes zpr-spin {
        to { transform: rotate(360deg); }
      }
      @keyframes zpr-stream-pulse {
        0%, 100% { opacity: 0.35; transform: scale(0.85); }
        50% { opacity: 0.95; transform: scale(1); }
      }
      button:disabled,
      textarea:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
    `;
}

function stopHostEvent(event: Event): void {
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

class NoopPanelHost implements ReaderPanelHost {
  mount(): boolean { return false; }
  setHidden(): void {}
  setWidth(): void {}
  showLoading(): void {}
  showEmpty(): void {}
  showChat(
    _session: ChatSession,
    _handlers: {
      onReferenceClick: (reference: EvidenceReference) => void;
      onSubmit: (question: string) => void;
      onRetryFailedTurn?: () => void;
      onRegenerate?: () => void;
      onClear?: () => void;
    },
    _options?: {
      notice?: string;
      isBusy?: boolean;
      failedTurn?: {
        question: string;
        errorMessage: string;
        createdAt: string;
      } | null;
    }
  ): void {}
  showError(): void {}
  dispose(): void {}
}

export function getSuggestedQuestions(strings: PluginStrings): string[] {
  return strings.panel.suggestedQuestions;
}

export function extractCitationRefsFromMarkdown(markdown: string): CitationRef[] {
  const refs: CitationRef[] = [];
  const seen = new Set<string>();
  const pattern = /\[(Fig\.?\s*\d+|Figure\s+\d+|Table\s+\d+|p\.\s*\d+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const token = match[0];
    const label = match[1].replace(/\s+/g, " ").trim();
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (/^p\./i.test(label)) {
      refs.push({
        kind: "page",
        label,
        page: Number(label.replace(/[^\d]/g, "")),
        sourceToken: token
      });
      continue;
    }
    refs.push({
      kind: /^table/i.test(label) ? "table" : "figure",
      label,
      page: 0,
      sourceToken: token
    });
  }
  return refs;
}

export function renderMarkdownToHtml(markdown: string, citations: CitationRef[] = []): string {
  return postProcessRenderedHtml(markdownRenderer.render(markdown, { citations }).trim());
}

export function buildSessionPlainText(session: ChatSession, strings: PluginStrings): string {
  const lines = [
    session.paper.title || strings.panel.untitledPaper,
    session.paper.authors.join(", "),
    ""
  ];

  for (const message of session.messages) {
    if (message.role === "system") {
      continue;
    }
    lines.push(message.role === "user" ? strings.panel.roleUser : strings.panel.roleAssistant);
    lines.push(message.markdown.trim());
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function buildVisibleSessionMeta(
  session: ChatSession,
  strings: PluginStrings
): { title: string; detail: string } {
  return {
    title: session.paper.title || strings.panel.untitledPaper,
    detail: session.paper.year || ""
  };
}

export function buildPanelToolbarActions(_strings: PluginStrings): Array<{ id: string; label: string; danger?: boolean }> {
  return [
    { id: "regenerate", label: _strings.panel.regenerate },
    { id: "clear", label: _strings.panel.clear, danger: true }
  ];
}

export function buildVisibleMessageMeta(
  message: ChatMessage,
  strings: PluginStrings
): { roleLabel: string; showRole: boolean } {
  if (message.role === "assistant") {
    return { roleLabel: "", showRole: false };
  }
  return {
    roleLabel: strings.panel.roleUser,
    showRole: true
  };
}

export function shouldShowMessageCopyButton(message: ChatMessage): boolean {
  return message.role === "assistant" && message.status === "done";
}

export function buildPendingIndicatorMarkup(strings: PluginStrings): string {
  return `<div class="zpr-pending" role="status" aria-live="polite"><span class="zpr-spinner" aria-hidden="true"></span><span>${escapeHtml(strings.panel.thinking)}</span></div>`;
}

export function getComposerKeyAction(args: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  isBusy: boolean;
}): "submit" | "newline" | "ignore" {
  if (args.key !== "Enter") {
    return "ignore";
  }
  if (args.shiftKey) {
    return "newline";
  }
  if (args.isComposing || args.isBusy) {
    return "ignore";
  }
  return "submit";
}

export function getComposerRenderValue(args: {
  storedDraft: string;
  liveInputValue: string;
}): string {
  return args.liveInputValue || args.storedDraft;
}

export function getComposerFocusBehavior(args: {
  wasBusy: boolean;
  isBusy: boolean;
  isInputFocused: boolean;
  preserveExistingFocus?: boolean;
}): "focus" | "preserve" {
  if (args.isBusy || args.isInputFocused || args.preserveExistingFocus) {
    return "preserve";
  }
  return "focus";
}

function bindCitationClicks(root: HTMLElement, citations: CitationRef[], onReferenceClick: (reference: EvidenceReference) => void): void {
  const buttons = Array.from(root.querySelectorAll("[data-zpr-citation-token]")) as HTMLElement[];
  for (const button of buttons) {
    const token = button.getAttribute("data-zpr-citation-token");
    const reference = citations.find((citation) => citation.sourceToken === token && citation.page > 0);
    if (!reference) {
      continue;
    }
    button.addEventListener("click", () => onReferenceClick(reference));
  }
}

function syncComposerDisabledState(
  input: HTMLTextAreaElement | null,
  sendButton: HTMLButtonElement | null,
  isBusy: boolean
): void {
  if (!input || !sendButton) {
    return;
  }
  // Keep the textarea editable while the assistant is streaming, so users can
  // prepare the next question (including deleting/editing). We only disable sending.
  input.disabled = false;
  sendButton.disabled = isBusy || !input.value.trim();
}

function flashCopiedLabel(doc: Document, button: HTMLButtonElement, original: string, copied: string): void {
  button.textContent = copied;
  doc.defaultView?.setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

function formatMessageTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(getCurrentLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

async function copyText(doc: Document, value: string): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to execCommand below.
    }
  }

  const textarea = doc.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  doc.body?.appendChild(textarea);
  textarea.select();
  try {
    return Boolean(doc.execCommand?.("copy"));
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createMarkdownRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false
  });
  renderer.use(texmath, {
    engine: {
      renderToString: (value: string, options: { displayMode?: boolean; throwOnError?: boolean }) =>
        renderMathToString(value, Boolean(options.displayMode))
    },
    delimiters: ["dollars", "brackets"],
    katexOptions: {
      throwOnError: false
    }
  });

  renderer.renderer.rules.text = (
    tokens: Array<{ content: string }>,
    idx: number,
    _options: unknown,
    env: { citations?: CitationRef[] } | undefined
  ) => {
    const text = escapeHtml(tokens[idx].content);
    const citations = ((env as { citations?: CitationRef[] } | undefined)?.citations) || [];
    return replaceCitationTokens(text, citations);
  };

  renderer.renderer.rules.link_open = (
    tokens: Array<{ attrSet(name: string, value: string): void }>,
    idx: number,
    options: unknown,
    _env: unknown,
    self: { renderToken(tokens: unknown, idx: number, options: unknown): string }
  ) => {
    const token = tokens[idx];
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
    return self.renderToken(tokens, idx, options);
  };

  return renderer;
}

function getMessageBubbleStateClasses(message: ChatMessage): string[] {
  const classes: string[] = [];
  if (message.status === "pending") {
    classes.push("zpr-message-streaming");
  }
  if (message.role === "assistant" && message.status === "pending" && !message.markdown.trim()) {
    classes.push("zpr-message-thinking");
  }
  return classes;
}

function renderMathToString(value: string, displayMode: boolean): string {
  const rendered = katex.renderToString(value, {
    displayMode,
    output: "mathml",
    throwOnError: false,
    strict: "ignore"
  });
  return displayMode
    ? rendered.replace('class="katex"', 'class="katex katex-display"')
    : rendered;
}

function postProcessRenderedHtml(html: string): string {
  return html
    .replace(/<section(?: class="eqno")?>/g, '<div class="katex-display">')
    .replace(/<\/section>/g, "</div>")
    .replace(/<\/?eqn>/g, "")
    .replace(/<\/?eq>/g, "");
}

function replaceCitationTokens(text: string, citations: CitationRef[]): string {
  return text.replace(/\[(Fig\.?\s*\d+|Figure\s+\d+|Table\s+\d+|p\.\s*\d+)\]/gi, (token) => {
    const reference = citations.find((citation) => citation.sourceToken.toLowerCase() === token.toLowerCase());
    if (!reference || reference.page <= 0) {
      return `<span class="zpr-citation-label">${escapeHtml(token)}</span>`;
    }
    return `<button type="button" class="zpr-citation-button" data-zpr-citation-token="${escapeHtml(reference.sourceToken)}">${escapeHtml(token)}</button>`;
  });
}
