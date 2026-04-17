import type { ChatSession, LLMMessage, PaperContext } from "./types.ts";

function describeOutputLanguage(locale: string): string {
  return locale === "zh-CN" ? "Chinese" : "English";
}

export function buildInitialChatMessages(paper: PaperContext, locale: string): LLMMessage[] {
  const outputLanguage = describeOutputLanguage(locale);

  return [
    {
      role: "system",
      content: [
        "You are an academic paper reading assistant.",
        `Answer in ${outputLanguage}.`,
        "Return markdown only.",
        "Start with a balanced first-pass reading of the current paper.",
        "Answer directly and keep the first pass concise but information-dense.",
        "When possible, cite figures, tables, and page numbers using tokens like [Fig. 2], [Table 1], or [p. 5].",
        "If evidence is uncertain, say so plainly."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "Read this paper and produce a balanced first-pass interpretation.",
        "Use exactly these section headings: Core claim, Method in plain language, Reusable ideas, Evidence and limitations.",
        "Keep each section to 1-3 short bullets or short sentences.",
        "Target no more than 450 English words or 700 Chinese characters unless the user explicitly asks for more depth.",
        "",
        buildPaperPayload(paper, true)
      ].join("\n")
    }
  ];
}

export function buildFollowupChatMessages(input: {
  paper: PaperContext;
  session: ChatSession;
  question: string;
  locale: string;
}): LLMMessage[] {
  const outputLanguage = describeOutputLanguage(input.locale);
  const recentMessages = input.session.messages
    .filter((message) => message.role !== "system")
    .slice(-5)
    .map((message) => ({
      role: message.role,
      content: message.markdown
    })) as LLMMessage[];

  const firstAssistant = input.session.messages.find((message) => message.role === "assistant");

  return [
    {
      role: "system",
      content: [
        "You are continuing a conversation about the current paper.",
        `Answer in ${outputLanguage}.`,
        "Return markdown only.",
        "Answer directly first, then expand only when the user asks for more depth.",
        "Stay grounded in this paper and the existing conversation.",
        "When possible, cite figures, tables, and page numbers using tokens like [Fig. 2], [Table 1], or [p. 5].",
        "If the user asks beyond what the paper supports, say so."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "Paper context:",
        buildPaperPayload(input.paper, false),
        "",
        "Initial assistant answer:",
        firstAssistant?.markdown || ""
      ].join("\n")
    },
    ...recentMessages,
    {
      role: "user",
      content: input.question
    }
  ];
}

function buildPaperPayload(paper: PaperContext, includeFullText: boolean): string {
  const authors = paper.authors.join(", ") || "Unknown";
  const year = paper.year || "Unknown";
  const body = includeFullText
    ? paper.attachmentText
    : truncateForFollowup(paper.attachmentText);

  return [
    `Title: ${paper.title}`,
    `Authors: ${authors}`,
    `Year: ${year}`,
    paper.abstractText ? `Abstract: ${paper.abstractText}` : "",
    "",
    "Paper text:",
    body
  ].filter(Boolean).join("\n");
}

function truncateForFollowup(text: string): string {
  const normalized = text.trim();
  const limit = 8000;
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n\n[Truncated follow-up context]` : normalized;
}
