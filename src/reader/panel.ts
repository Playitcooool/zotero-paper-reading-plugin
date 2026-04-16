import type { ChatMessage, ChatSession, CitationRef, EvidenceReference } from "../background/types.ts";
import type { PluginStrings } from "../i18n/index.ts";
import { getCurrentLocale } from "../i18n/index.ts";

export interface ReaderPanelHost {
  mount(): boolean;
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
  strings: PluginStrings
): ReaderPanelHost {
  const nativeDoc = reader._iframeWindow?.document || null;
  if (nativeDoc) {
    return new FixedSidebarHost(nativeDoc, sidebarWidth, true, strings);
  }
  if (mainWindow?.document) {
    return new FixedSidebarHost(mainWindow.document, sidebarWidth, false, strings);
  }
  return new NoopPanelHost();
}

class FixedSidebarHost implements ReaderPanelHost {
  private readonly doc: Document;
  private readonly sidebarWidth: number;
  private readonly isReaderDoc: boolean;
  private readonly strings: PluginStrings;
  private root: HTMLDivElement | null = null;
  private content: HTMLDivElement | null = null;

  constructor(doc: Document, sidebarWidth: number, isReaderDoc: boolean, strings: PluginStrings) {
    this.doc = doc;
    this.sidebarWidth = sidebarWidth;
    this.isReaderDoc = isReaderDoc;
    this.strings = strings;
  }

  mount(): boolean {
    this.ensureStyles();
    if (!this.root) {
      this.root = this.doc.createElement("div");
      this.root.id = "zpr-sidebar-root";
      this.root.innerHTML = `
        <div class="zpr-sidebar-card">
          <div class="zpr-sidebar-head">
            <div>
              <div class="zpr-sidebar-title">${escapeHtml(this.strings.panel.title)}</div>
              <div class="zpr-sidebar-subtitle">${escapeHtml(this.isReaderDoc ? this.strings.panel.inReaderSubtitle : this.strings.panel.fallbackSubtitle)}</div>
            </div>
          </div>
          <div class="zpr-sidebar-content"></div>
        </div>
      `;
      this.content = this.root.querySelector(".zpr-sidebar-content") as HTMLDivElement;
      this.doc.documentElement.appendChild(this.root);
      this.doc.documentElement.style.setProperty("--zpr-sidebar-width", `${this.sidebarWidth}px`);
      if (this.isReaderDoc) {
        this.doc.body?.style.setProperty("margin-right", `${this.sidebarWidth}px`);
      }
    }
    return true;
  }

  showLoading(title: string, subtitle: string = this.strings.panel.loading): void {
    if (!this.mount() || !this.content) {
      return;
    }
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

    if (isBusy) {
      const pending = this.doc.createElement("div");
      pending.className = "zpr-message zpr-message-assistant";
      pending.innerHTML = `
        <div class="zpr-message-meta">
          <div class="zpr-message-role">${escapeHtml(this.strings.panel.roleAssistant)}</div>
          <div class="zpr-message-time">${escapeHtml(formatMessageTimestamp(new Date().toISOString()))}</div>
        </div>
        <div class="zpr-pending">${escapeHtml(this.strings.panel.thinking)}</div>
      `;
      transcript.appendChild(pending);
    } else if (options.failedTurn) {
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
    transcript.scrollTop = transcript.scrollHeight;
    if (!isBusy) {
      input?.focus();
    }
  }

  showError(message: string, onRetry?: () => void): void {
    if (!this.mount() || !this.content) {
      return;
    }
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
    if (this.isReaderDoc) {
      this.doc.body?.style.removeProperty("margin-right");
    }
    this.root?.remove();
    this.root = null;
    this.content = null;
  }

  private buildMessageBubble(message: ChatMessage, onReferenceClick: (reference: EvidenceReference) => void): HTMLDivElement {
    const bubble = this.doc.createElement("div");
    bubble.className = `zpr-message zpr-message-${message.role}`;
    bubble.innerHTML = `
      <div class="zpr-message-meta">
        <div class="zpr-message-role">${escapeHtml(message.role === "user" ? this.strings.panel.roleUser : this.strings.panel.roleAssistant)}</div>
        <div class="zpr-message-time">${escapeHtml(formatMessageTimestamp(message.createdAt))}</div>
      </div>
      <div class="zpr-message-body">${renderMarkdownToHtml(message.markdown, message.citations)}</div>
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
        padding: 14px;
        box-sizing: border-box;
        pointer-events: none;
      }
      .zpr-sidebar-card {
        pointer-events: auto;
        height: 100%;
        border-left: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(255, 255, 255, 0.96);
        color: #0f172a;
        box-shadow: -12px 0 30px rgba(15, 23, 42, 0.08);
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      }
      .zpr-sidebar-head {
        padding: 16px 18px 10px;
        border-bottom: 1px solid rgba(226, 232, 240, 0.9);
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
  const blocks: string[] = [];
  const lines = markdown.replace(/\r/g, "").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${applyInlineMarkdown(heading[2], citations)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${applyInlineMarkdown(lines[index].replace(/^\d+\.\s+/, ""), citations)}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(`<li>${applyInlineMarkdown(lines[index].replace(/^[-*]\s+/, ""), citations)}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${applyInlineMarkdown(quoteLines.join("<br/>"), citations)}</blockquote>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !lines[index].startsWith("```")
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${applyInlineMarkdown(paragraphLines.join("<br/>"), citations)}</p>`);
  }

  return blocks.join("");
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

function applyInlineMarkdown(text: string, citations: CitationRef[]): string {
  let html = escapeHtml(text);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[(Fig\.?\s*\d+|Figure\s+\d+|Table\s+\d+|p\.\s*\d+)\]/gi, (token) => {
    const reference = citations.find((citation) => citation.sourceToken.toLowerCase() === token.toLowerCase());
    if (!reference || reference.page <= 0) {
      return `<span class="zpr-citation-label">${escapeHtml(token)}</span>`;
    }
    const safeToken = escapeHtml(reference.sourceToken);
    return `<button type="button" class="zpr-citation-button" data-zpr-citation-token="${safeToken}">${escapeHtml(token)}</button>`;
  });
  return html;
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
