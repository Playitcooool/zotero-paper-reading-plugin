import { createBackend } from "./backends.ts";
import { getCurrentLocale, getCurrentStrings } from "../i18n/index.ts";
import { buildFollowupChatMessages, buildInitialChatMessages } from "./prompt-template.ts";
import { getAllSettings, type PluginSettings } from "./settings-manager.ts";
import type { ChatMessage, ChatSession, CitationRef, PaperContext } from "./types.ts";
import { extractCitationRefsFromMarkdown } from "../reader/panel.ts";

export async function startChatSession(
  attachment: Zotero.Item,
  settings: PluginSettings = getAllSettings()
): Promise<ChatSession> {
  const paper = await buildPaperContext(attachment);
  const locale = getCurrentLocale();
  ensureAttachmentText(paper, locale);

  const backend = createBackend(settings);
  const response = await backend.chat({
    paper,
    messages: buildInitialChatMessages(paper, locale),
    mode: "initial",
    locale
  });

  const timestamp = new Date().toISOString();
  return {
    paper: {
      itemID: paper.itemID,
      title: paper.title,
      authors: paper.authors,
      year: paper.year
    },
    backendLabel: response.backendLabel,
    model: response.model,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      buildAssistantMessage(response.markdown, timestamp)
    ]
  };
}

export async function continueChatSession(
  attachment: Zotero.Item,
  session: ChatSession,
  question: string,
  settings: PluginSettings = getAllSettings()
): Promise<ChatSession> {
  const paper = await buildPaperContext(attachment);
  const locale = getCurrentLocale();
  ensureAttachmentText(paper, locale);

  const backend = createBackend(settings);
  const response = await backend.chat({
    paper,
    messages: buildFollowupChatMessages({
      paper,
      session,
      question,
      locale
    }),
    mode: "followup",
    locale
  });

  const userTimestamp = new Date().toISOString();
  const assistantTimestamp = new Date().toISOString();
  return {
    ...session,
    backendLabel: response.backendLabel,
    model: response.model,
    updatedAt: assistantTimestamp,
    messages: [
      ...session.messages,
      buildUserMessage(question, userTimestamp),
      buildAssistantMessage(response.markdown, assistantTimestamp)
    ]
  };
}

export function appendUserDraft(session: ChatSession, question: string): ChatSession {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    messages: [
      ...session.messages,
      buildUserMessage(question, new Date().toISOString())
    ]
  };
}

export async function buildPaperContext(attachment: Zotero.Item): Promise<PaperContext> {
  const parent = attachment.parentItem;
  const parentData = parent as Zotero.Item & {
    getField?(field: string): string;
    getCreators?(): Array<{ firstName?: string; lastName?: string; name?: string }>;
  };

  const creators = (parentData?.getCreators?.() || []) as Array<{ firstName?: string; lastName?: string; name?: string }>;
  const authors = creators
    .map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" ").trim())
    .filter(Boolean);
  const year = extractYear(parentData?.getField?.("date") || "");
  const title = parentData?.getField?.("title") || attachment.getField?.("title") || "Untitled Paper";
  const fallbackTitle = getCurrentStrings().panel.untitledPaper;
  const abstractText = parentData?.getField?.("abstractNote") || "";
  const attachmentText = truncateForPrompt(await attachment.attachmentText);

  return {
    itemID: attachment.id,
    title: title || fallbackTitle,
    authors,
    year,
    abstractText,
    attachmentText
  };
}

function buildAssistantMessage(markdown: string, createdAt: string): ChatMessage {
  return {
    id: `assistant-${createdAt}`,
    role: "assistant",
    markdown,
    createdAt,
    citations: extractCitationRefsFromMarkdown(markdown),
    status: "done"
  };
}

function buildUserMessage(question: string, createdAt: string): ChatMessage {
  return {
    id: `user-${createdAt}`,
    role: "user",
    markdown: question,
    createdAt,
    citations: [] as CitationRef[]
  };
}

function ensureAttachmentText(paper: PaperContext, locale: string): void {
  if (!paper.attachmentText.trim()) {
    throw new Error(locale === "zh-CN"
      ? "当前 PDF 没有可用文本。请先让 Zotero 完成全文索引后再试。"
      : "No attachment text is available for this PDF. Reindex the attachment and try again.");
  }
}

function extractYear(value: string): string {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function truncateForPrompt(text: string): string {
  const normalized = text.replace(/\u0000/g, "").trim();
  const limit = 60000;
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n\n[Truncated for analysis]` : normalized;
}
