import type { AnalysisResult, ChatSession } from "./types.ts";
import { getCurrentLocale, getCurrentStrings, localizeSectionTitle } from "../i18n/index.ts";
import { extractCitationRefsFromMarkdown } from "../reader/panel.ts";

const ANALYSIS_MARKER_PREFIX = "<!--zpr-analysis:";
const CHAT_MARKER_PREFIX = "<!--zpr-chat:";
const MARKER_SUFFIX = "-->";

export function buildAnalysisNoteHtml(result: AnalysisResult): string {
  const encoded = encodePayload(result);
  const locale = getCurrentLocale();
  const strings = getCurrentStrings();
  const sectionHtml = result.sections
    .filter((section) => section.content.trim())
    .map((section) => `<h2>${escapeHtml(localizeSectionTitle(section.id, locale))}</h2><p>${escapeHtml(section.content).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const referenceHtml = result.references.length
    ? `<h2>${escapeHtml(strings.panel.evidenceReferences)}</h2><ul>${result.references.map((ref) => `<li>${escapeHtml(ref.label)}${ref.anchorText ? `: ${escapeHtml(ref.anchorText)}` : ""}</li>`).join("")}</ul>`
    : "";

  return `${ANALYSIS_MARKER_PREFIX}${encoded}${MARKER_SUFFIX}<h1>${escapeHtml(result.meta.title || strings.appName)}</h1>${sectionHtml}${referenceHtml}`;
}

export function buildChatNoteHtml(session: ChatSession, sourceContext?: string): string {
  const encoded = encodePayload(session);
  const transcript = session.messages
    .map((message) => `<h2>${escapeHtml(message.role)}</h2><p>${escapeHtml(message.markdown).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const sourceHtml = sourceContext ? `<p>${escapeHtml(sourceContext)}</p>` : "";
  return `${CHAT_MARKER_PREFIX}${encoded}${MARKER_SUFFIX}<h1>${escapeHtml(session.paper.title || getCurrentStrings().appName)}</h1>${sourceHtml}${transcript}`;
}

export function parseAnalysisNoteHtml(noteHtml: string): AnalysisResult | null {
  return parseMarkedPayload(noteHtml, ANALYSIS_MARKER_PREFIX) as AnalysisResult | null;
}

export function parseChatNoteHtml(noteHtml: string): ChatSession | null {
  return parseMarkedPayload(noteHtml, CHAT_MARKER_PREFIX) as ChatSession | null;
}

export function findExistingAnalysisNote<T extends { id: number; note: string }>(notes: T[]): T | undefined {
  return notes.find((note) => note.note.includes(ANALYSIS_MARKER_PREFIX));
}

export function findExistingChatNote<T extends { id: number; note: string }>(notes: T[]): T | undefined {
  return notes.find((note) => note.note.includes(CHAT_MARKER_PREFIX));
}

export async function loadSavedAnalysisForAttachment(attachment: Zotero.Item): Promise<AnalysisResult | null> {
  const notes = await getAttachmentNotes(attachment);
  const existing = findExistingAnalysisNote(notes);
  return existing ? parseAnalysisNoteHtml(existing.note) : null;
}

export async function loadSavedChatSessionForAttachment(attachment: Zotero.Item): Promise<ChatSession | null> {
  const notes = await getAttachmentNotes(attachment);
  const chatNote = findExistingChatNote(notes);
  if (chatNote) {
    return parseChatNoteHtml(chatNote.note);
  }

  const analysisNote = findExistingAnalysisNote(notes);
  if (!analysisNote) {
    return null;
  }

  const analysis = parseAnalysisNoteHtml(analysisNote.note);
  return analysis ? convertLegacyAnalysisToChatSession(analysis) : null;
}

export async function saveAnalysisForAttachment(attachment: Zotero.Item, result: AnalysisResult): Promise<number> {
  const html = buildAnalysisNoteHtml(result);
  const notes = await getAttachmentNotes(attachment);
  const existing = findExistingAnalysisNote(notes);

  if (existing) {
    existing.setNote(html);
    await existing.saveTx();
    return existing.id;
  }

  const note = new Zotero.Item("note");
  note.libraryID = attachment.libraryID;
  const parentItemID = resolveRegularParentItemID(attachment);
  if (parentItemID) {
    note.parentItemID = parentItemID;
  }
  note.setNote(html);
  await note.saveTx();
  return note.id;
}

export async function saveChatSessionForAttachment(attachment: Zotero.Item, session: ChatSession): Promise<number> {
  const sourceContext = resolveRegularParentItemID(attachment)
    ? undefined
    : buildStandaloneSourceContext(attachment);
  const html = buildChatNoteHtml(session, sourceContext);
  const notes = await getAttachmentNotes(attachment);
  const existing = findExistingChatNote(notes) || findExistingAnalysisNote(notes);

  if (existing) {
    existing.setNote(html);
    await existing.saveTx();
    return existing.id;
  }

  const note = new Zotero.Item("note");
  note.libraryID = attachment.libraryID;
  const parentItemID = resolveRegularParentItemID(attachment);
  if (parentItemID) {
    note.parentItemID = parentItemID;
  }
  note.setNote(html);
  await note.saveTx();
  return note.id;
}

export async function deleteSavedChatSessionForAttachment(attachment: Zotero.Item): Promise<boolean> {
  const notes = await getAttachmentNotes(attachment);
  const managedNotes = notes.filter((note) => note.note.includes(CHAT_MARKER_PREFIX) || note.note.includes(ANALYSIS_MARKER_PREFIX));
  if (!managedNotes.length) {
    return false;
  }

  for (const note of managedNotes) {
    await note.eraseTx();
  }
  return true;
}

export function convertLegacyAnalysisToChatSession(result: AnalysisResult): ChatSession {
  const markdown = analysisResultToMarkdown(result);
  const createdAt = result.meta.generatedAt || new Date().toISOString();

  return {
    paper: {
      itemID: 0,
      title: result.meta.title,
      authors: result.meta.authors,
      year: result.meta.year
    },
    backendLabel: result.meta.backendLabel,
    model: result.meta.model,
    createdAt,
    updatedAt: createdAt,
    messages: [
      {
        id: "legacy-analysis",
        role: "assistant",
        markdown,
        createdAt,
        citations: result.references.map((reference) => ({
          ...reference,
          sourceToken: `[${reference.label}]`
        })),
        status: "done"
      }
    ]
  };
}

async function getAttachmentNotes(attachment: Zotero.Item): Promise<Zotero.Item[]> {
  const ids = attachment.getNotes(false);
  const items = (Zotero.Items as { get(ids: number[]): Zotero.Item[] }).get(ids) || [];
  return items.filter(Boolean);
}

function analysisResultToMarkdown(result: AnalysisResult): string {
  const locale = getCurrentLocale();
  const parts = result.sections
    .filter((section) => section.content.trim())
    .map((section) => `# ${localizeSectionTitle(section.id, locale)}\n\n${section.content.trim()}`);

  if (result.references.length) {
    parts.push(
      `# ${getCurrentStrings().panel.evidenceReferences}\n\n${result.references.map((reference) => {
        const suffix = reference.anchorText ? `: ${reference.anchorText}` : "";
        return `- [${reference.label}]${suffix}`;
      }).join("\n")}`
    );
  }

  const markdown = parts.join("\n\n");
  const citations = extractCitationRefsFromMarkdown(markdown);
  return citations.length ? markdown : markdown;
}

function resolveRegularParentItemID(attachment: Zotero.Item): number | null {
  const parent = attachment.parentItem as (Zotero.Item & { isRegularItem?(): boolean }) | null | undefined;
  if (parent?.id && parent.isRegularItem?.()) {
    return parent.id;
  }
  return null;
}

function buildStandaloneSourceContext(attachment: Zotero.Item): string {
  const attachmentTitle = attachment.getField?.("title") || getCurrentStrings().panel.untitledPaper;
  return `Source attachment: ${attachmentTitle}`;
}

function parseMarkedPayload(noteHtml: string, markerPrefix: string): unknown | null {
  const start = noteHtml.indexOf(markerPrefix);
  if (start === -1) {
    return null;
  }
  const payloadStart = start + markerPrefix.length;
  const end = noteHtml.indexOf(MARKER_SUFFIX, payloadStart);
  if (end === -1) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64(noteHtml.slice(payloadStart, end)));
  } catch {
    return null;
  }
}

function encodePayload(result: AnalysisResult | ChatSession): string {
  return encodeBase64(JSON.stringify(result));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeBase64(value: string): string {
  const bufferCtor = (globalThis as { Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, "utf8").toString("base64");
  }
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(value)));
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const bufferCtor = (globalThis as { Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, "base64").toString("utf8");
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
