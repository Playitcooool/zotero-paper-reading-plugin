import type { ChatMessage, ChatSession, CitationRef, EvidenceReference } from "../background/types.ts";
import MarkdownIt from "markdown-it";
import type { PluginStrings } from "../i18n/index.ts";
import { getCurrentLocale } from "../i18n/index.ts";
import { getResizedSidebarWidth, shouldAutoScrollTranscript } from "../runtime/reader-runtime.ts";

const markdownRenderer = createMarkdownRenderer();

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
      onRegenerate: () => void;
      onClear: () => void;
      onRetryFailedTurn?: () => void;
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
  chromeHandlers: ReaderPanelChromeHandlers
): ReaderPanelHost {
  const nativeDoc = reader._iframeWindow?.document || null;
  if (nativeDoc) {
    return new FixedSidebarHost(nativeDoc, sidebarWidth, true, strings, chromeHandlers);
  }
  if (mainWindow?.document) {
    return new FixedSidebarHost(mainWindow.document, sidebarWidth, false, strings, chromeHandlers);
  }
  return new NoopPanelHost();
}

class FixedSidebarHost implements ReaderPanelHost {
  private readonly doc: Document;
  private readonly isReaderDoc: boolean;
  private readonly strings: PluginStrings;
  private readonly chromeHandlers: ReaderPanelChromeHandlers;
  private sidebarWidth: number;
  private root: HTMLDivElement | null = null;
  private content: HTMLDivElement | null = null;
  private transcript: HTMLDivElement | null = null;
  private jumpButton: HTMLButtonElement | null = null;
  private autoScroll = true;
  private lastManualScrollTop = 0;
  private isHidden = false;

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
      this.root.innerHTML = `
        <div class="zpr-sidebar-resize" data-zpr-action="resize" aria-hidden="true"></div>
        <div class="zpr-sidebar-card">
          <div class="zpr-sidebar-head">
            <div class="zpr-sidebar-heading">
              <div class="zpr-sidebar-title">${escapeHtml(this.strings.panel.title)}</div>
              <div class="zpr-sidebar-subtitle">${escapeHtml(this.isReaderDoc ? this.strings.panel.inReaderSubtitle : this.strings.panel.fallbackSubtitle)}</div>
            </div>
            <button type="button" class="zpr-close-button" data-zpr-action="close-panel" aria-label="${escapeHtml(this.strings.panel.close)}" title="${escapeHtml(this.strings.panel.close)}">×</button>
          </div>
          <div class="zpr-sidebar-content"></div>
        </div>
      `;
      this.content = this.root.querySelector(".zpr-sidebar-content") as HTMLDivElement;
      this.doc.documentElement.appendChild(this.root);
      this.root.querySelector('[data-zpr-action="close-panel"]')?.addEventListener("click", () => {
        this.chromeHandlers.onClose();
      });
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
    this.resetTranscriptState();
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

    this.resetTranscriptState();
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
      onRegenerate: () => void;
      onClear: () => void;
      onRetryFailedTurn?: () => void;
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
    this.content.innerHTML = "";
    const isBusy = Boolean(options.isBusy);

    const toolbar = this.doc.createElement("div");
    toolbar.className = "zpr-result-head";
    toolbar.innerHTML = `
      <div class="zpr-result-actions">
        <button type="button" class="zpr-secondary-button" data-zpr-action="copy-chat">${escapeHtml(this.strings.panel.transcriptCopy)}</button>
        <button type="button" class="zpr-secondary-button" data-zpr-action="regenerate">${escapeHtml(this.strings.panel.regenerate)}</button>
        <button type="button" class="zpr-secondary-button zpr-danger-button" data-zpr-action="clear">${escapeHtml(this.strings.panel.clear)}</button>
      </div>
    `;
    this.content.appendChild(toolbar);

    const toolbarButtons = toolbar.querySelectorAll("[data-zpr-action]");
    toolbarButtons.forEach((node) => {
      (node as HTMLButtonElement).disabled = isBusy;
    });

    const copyChatButton = toolbar.querySelector('[data-zpr-action="copy-chat"]') as HTMLButtonElement | null;
    copyChatButton?.addEventListener("click", () => {
      void copyText(this.doc, buildSessionPlainText(session, this.strings)).then((copied) => {
        if (copied && copyChatButton) {
          flashCopiedLabel(this.doc, copyChatButton, this.strings.panel.transcriptCopy, this.strings.panel.copied);
        }
      });
    });

    toolbar.querySelector('[data-zpr-action="regenerate"]')?.addEventListener("click", () => {
      if (!isBusy) {
        handlers.onRegenerate();
      }
    });
    toolbar.querySelector('[data-zpr-action="clear"]')?.addEventListener("click", () => {
      if (!isBusy) {
        handlers.onClear();
      }
    });

    if (options.notice) {
      const notice = this.doc.createElement("div");
      notice.className = "zpr-notice";
      notice.textContent = options.notice;
      this.content.appendChild(notice);
    }

    const meta = this.doc.createElement("div");
    meta.className = "zpr-meta";
    meta.innerHTML = `
      <div class="zpr-meta-title">${escapeHtml(session.paper.title || this.strings.panel.untitledPaper)}</div>
      <div class="zpr-meta-subtitle">${escapeHtml(session.paper.authors.join(", "))}${session.paper.year ? ` · ${escapeHtml(session.paper.year)}` : ""}</div>
      <div class="zpr-meta-mini">${escapeHtml(session.backendLabel)} · ${escapeHtml(session.model)}</div>
    `;
    this.content.appendChild(meta);

    const transcript = this.doc.createElement("div");
    transcript.className = "zpr-chat-list";
    for (const message of session.messages) {
      if (message.role === "system") {
        continue;
      }
      transcript.appendChild(this.buildMessageBubble(message, handlers.onReferenceClick));
    }

    if (options.failedTurn) {
      const error = this.doc.createElement("div");
      error.className = "zpr-message zpr-message-assistant zpr-message-error";
      error.innerHTML = `
        <div class="zpr-message-meta">
          <div class="zpr-message-role">${escapeHtml(this.strings.panel.roleAssistant)}</div>
          <div class="zpr-message-time">${escapeHtml(formatMessageTimestamp(options.failedTurn.createdAt))}</div>
        </div>
        <div class="zpr-pending">${escapeHtml(options.failedTurn.errorMessage)}</div>
        <div class="zpr-message-actions">
          <button type="button" class="zpr-text-button" data-zpr-action="retry-turn">${escapeHtml(this.strings.panel.retryTurn)}</button>
        </div>
      `;
      error.querySelector('[data-zpr-action="retry-turn"]')?.addEventListener("click", () => {
        handlers.onRetryFailedTurn?.();
      });
      transcript.appendChild(error);
    }

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
      <textarea class="zpr-composer-input" placeholder="${escapeHtml(this.strings.panel.composerPlaceholder)}"></textarea>
      <button type="submit" class="zpr-composer-send">${escapeHtml(this.strings.panel.send)}</button>
    `;
    const input = composer.querySelector(".zpr-composer-input") as HTMLTextAreaElement | null;
    const sendButton = composer.querySelector(".zpr-composer-send") as HTMLButtonElement | null;
    syncComposerDisabledState(input, sendButton, isBusy);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input?.value.trim() || "";
      if (!value || isBusy) {
        return;
      }
      input!.value = "";
      syncComposerDisabledState(input, sendButton, true);
      handlers.onSubmit(value);
    });
    input?.addEventListener("input", () => {
      syncComposerDisabledState(input, sendButton, isBusy);
    });
    input?.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
        keyboardEvent.preventDefault();
        composer.requestSubmit();
      }
    });
    this.content.appendChild(composer);

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

    if (this.autoScroll) {
      this.scrollTranscriptToBottom();
    } else {
      transcript.scrollTop = previousScrollTop;
    }
    this.updateJumpButtonVisibility();
    if (!isBusy) {
      input?.focus();
    }
  }

  showError(message: string, onRetry?: () => void): void {
    if (!this.mount() || !this.content) {
      return;
    }
    this.resetTranscriptState();
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
    this.doc.documentElement.style.removeProperty("--zpr-sidebar-width");
    this.doc.body?.style.removeProperty("margin-right");
    this.root?.remove();
    this.root = null;
    this.content = null;
    this.transcript = null;
    this.jumpButton = null;
  }

  private buildMessageBubble(message: ChatMessage, onReferenceClick: (reference: EvidenceReference) => void): HTMLDivElement {
    const bubble = this.doc.createElement("div");
    bubble.className = `zpr-message zpr-message-${message.role}${message.status === "pending" ? " zpr-message-streaming" : ""}`;
    const bodyHtml = message.role === "assistant" && !message.markdown.trim() && message.status === "pending"
      ? `<div class="zpr-pending">${escapeHtml(this.strings.panel.thinking)}</div>`
      : `<div class="zpr-message-body">${renderMarkdownToHtml(message.markdown, message.citations)}</div>`;
    bubble.innerHTML = `
      <div class="zpr-message-meta">
        <div class="zpr-message-role">${escapeHtml(message.role === "user" ? this.strings.panel.roleUser : this.strings.panel.roleAssistant)}</div>
        <div class="zpr-message-time">${escapeHtml(formatMessageTimestamp(message.createdAt))}</div>
      </div>
      ${bodyHtml}
      ${message.role === "assistant" ? `<div class="zpr-message-actions"><button type="button" class="zpr-text-button" data-zpr-message-copy="${escapeHtml(message.id)}">${escapeHtml(this.strings.panel.copyMessage)}</button></div>` : ""}
    `;
    bindCitationClicks(bubble, message.citations, onReferenceClick);

    const copyButton = bubble.querySelector(`[data-zpr-message-copy="${escapeHtml(message.id)}"]`) as HTMLButtonElement | null;
    copyButton?.addEventListener("click", () => {
      void copyText(this.doc, message.markdown).then((copied) => {
        if (copied && copyButton) {
          flashCopiedLabel(this.doc, copyButton, this.strings.panel.copyMessage, this.strings.panel.copied);
        }
      });
    });
    return bubble;
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

  private resetTranscriptState(): void {
    this.transcript = null;
    this.jumpButton = null;
    this.autoScroll = true;
    this.lastManualScrollTop = 0;
  }

  private syncLayout(): void {
    this.doc.documentElement.style.setProperty("--zpr-sidebar-width", `${this.sidebarWidth}px`);
    if (this.root) {
      this.root.style.display = this.isHidden ? "none" : "block";
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
    style.textContent = `
      #zpr-sidebar-root {
        position: fixed;
        top: 0;
        right: 0;
        width: var(--zpr-sidebar-width, 420px);
        height: 100vh;
        z-index: 2147483647;
        padding: 12px 12px 12px 0;
        box-sizing: border-box;
        pointer-events: none;
        display: flex;
      }
      .zpr-sidebar-hidden {
        display: none;
      }
      .zpr-sidebar-resize {
        width: 12px;
        cursor: col-resize;
        pointer-events: auto;
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
        align-items: flex-start;
        padding: 16px 18px 10px;
        border-bottom: 1px solid rgba(226, 232, 240, 0.9);
      }
      .zpr-sidebar-heading {
        min-width: 0;
      }
      .zpr-sidebar-title {
        font-size: 16px;
        font-weight: 700;
      }
      .zpr-sidebar-subtitle {
        color: #64748b;
        font-size: 12px;
        margin-top: 4px;
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
      }
      .zpr-sidebar-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 16px 18px 18px;
      }
      .zpr-result-head {
        display: flex;
        justify-content: flex-end;
        margin: -16px -18px 14px;
        padding: 12px 18px 10px;
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
      .zpr-meta-title {
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 6px;
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
        display: inline-block;
        width: 8px;
        height: 8px;
        margin-left: 6px;
        border-radius: 999px;
        background: #2563eb;
        opacity: 0.5;
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
      .zpr-message-body a {
        color: #2563eb;
      }
      .zpr-message-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      .zpr-text-button {
        border: none;
        background: transparent;
        color: #2563eb;
        padding: 0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
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
      }
      .zpr-composer-send {
        align-self: end;
        min-width: 72px;
        font-weight: 600;
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
      button:disabled,
      textarea:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
    `;
    this.doc.documentElement.appendChild(style);
  }
}

class NoopPanelHost implements ReaderPanelHost {
  mount(): boolean { return false; }
  setHidden(): void {}
  setWidth(): void {}
  showLoading(): void {}
  showEmpty(): void {}
  showChat(): void {}
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
  return markdownRenderer.render(markdown, { citations }).trim();
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
  input.disabled = isBusy;
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
    await clipboard.writeText(value);
    return true;
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

function replaceCitationTokens(text: string, citations: CitationRef[]): string {
  return text.replace(/\[(Fig\.?\s*\d+|Figure\s+\d+|Table\s+\d+|p\.\s*\d+)\]/gi, (token) => {
    const reference = citations.find((citation) => citation.sourceToken.toLowerCase() === token.toLowerCase());
    if (!reference || reference.page <= 0) {
      return `<span class="zpr-citation-label">${escapeHtml(token)}</span>`;
    }
    return `<button type="button" class="zpr-citation-button" data-zpr-citation-token="${escapeHtml(reference.sourceToken)}">${escapeHtml(token)}</button>`;
  });
}
