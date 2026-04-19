import type { ChatSession, LLMMessage, PaperContext } from "./types.ts";

function describeOutputLanguage(locale: string): string {
  return locale === "zh-CN" ? "Chinese" : "English";
}

function getInitialReadingSpec(locale: string): {
  headings: string[];
  lengthHint: string;
} {
  if (locale === "zh-CN") {
    return {
      headings: [
        "一句话结论",
        "论文主旨",
        "核心方法（白话版）",
        "关键直觉",
        "可复用/可迁移点（落地建议）",
        "证据与局限",
        "启发与下一步"
      ],
      lengthHint: "Target no more than 900 Chinese characters unless the user explicitly asks for more depth."
    };
  }

  return {
    headings: [
      "One-sentence takeaway",
      "Core claim",
      "Method in plain language",
      "Key intuition",
      "Implementation notes (what to steal)",
      "Evidence & limitations",
      "Inspiration / next experiments"
    ],
    lengthHint: "Target no more than 650 English words unless the user explicitly asks for more depth."
  };
}

export function buildInitialChatMessages(paper: PaperContext, locale: string): LLMMessage[] {
  const outputLanguage = describeOutputLanguage(locale);
  const spec = getInitialReadingSpec(locale);

  return [
    {
      role: "system",
      content: [
        "You are an academic paper reading assistant.",
        `Answer in ${outputLanguage}.`,
        "Return markdown only.",
        "Start with a first-pass reading of the current paper that is deep but scannable.",
        "Do NOT ask the user to provide a separate question or task. The task is to start the paper reading now.",
        "Paraphrase and synthesize in your own words. Do NOT copy/paste sentences from the paper.",
        "Avoid long quotes. If a quote is absolutely necessary, keep it very short and clearly mark it as a quote.",
        "When possible, cite figures, tables, and page numbers using tokens like [Fig. 2], [Table 1], or [p. 5].",
        "If evidence is uncertain, say so plainly."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "Read this paper and produce a deep-but-scannable first-pass reading.",
        `Use exactly these section headings: ${spec.headings.join(", ")}.`,
        "Keep each section to 2-4 short bullets (or 1-2 short sentences), focusing on what matters for understanding and reuse.",
        "Be concrete and actionable where possible (e.g., what to reuse in implementation, what to test next).",
        spec.lengthHint,
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
        "Paraphrase in your own words. Do NOT copy/paste sentences from the paper.",
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
