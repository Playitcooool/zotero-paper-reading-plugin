import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionPlainText,
  extractCitationRefsFromMarkdown,
  getSuggestedQuestions,
  renderMarkdownToHtml
} from "../src/reader/panel.ts";
import type { ChatSession } from "../src/background/types.ts";
import { getStringsForLocale } from "../src/i18n/index.ts";

const sampleSession: ChatSession = {
  paper: {
    itemID: 1,
    title: "Sample Paper",
    authors: ["Jane Doe", "John Doe"],
    year: "2026"
  },
  backendLabel: "OpenAI Compatible",
  model: "gpt-4.1-mini",
  createdAt: "2026-04-16T10:00:00.000Z",
  updatedAt: "2026-04-16T10:00:00.000Z",
  messages: [
    {
      id: "m1",
      role: "assistant",
      markdown: "# Thesis\n\nA concise summary with [Fig. 2] and [p. 5].",
      citations: [
        { kind: "figure", label: "Fig. 2", page: 5, anchorText: "System overview", sourceToken: "[Fig. 2]" },
        { kind: "page", label: "p. 5", page: 5, sourceToken: "[p. 5]" }
      ],
      createdAt: "2026-04-16T10:00:00.000Z",
      status: "done"
    }
  ]
};

test("extractCitationRefsFromMarkdown finds figure and page tokens", () => {
  const citations = extractCitationRefsFromMarkdown("See [Fig. 2] and [p. 5] for details.");

  assert.equal(citations.length, 2);
  assert.equal(citations[0].label, "Fig. 2");
  assert.equal(citations[1].page, 5);
});

test("renderMarkdownToHtml turns citations into interactive buttons", () => {
  const html = renderMarkdownToHtml("A concise summary with [Fig. 2].", sampleSession.messages[0].citations);

  assert.match(html, /data-zpr-citation-token="\[Fig\. 2\]"/);
  assert.match(html, /button/);
});

test("renderMarkdownToHtml supports ordered lists", () => {
  const html = renderMarkdownToHtml("1. first\n2. second");

  assert.match(html, /<ol>/);
  assert.match(html, /<li>first<\/li>/);
  assert.match(html, /<li>second<\/li>/);
});

test("renderMarkdownToHtml downgrades unmapped figure citations to non-interactive labels", () => {
  const html = renderMarkdownToHtml("See [Fig. 9] for details.", []);

  assert.ok(!html.includes("data-zpr-citation-token"));
  assert.match(html, /zpr-citation-label/);
});

test("renderMarkdownToHtml supports fenced code blocks with language markers", () => {
  const html = renderMarkdownToHtml("```ts\nconst answer = 42;\n```");

  assert.match(html, /<pre><code/);
  assert.match(html, /const answer = 42/);
});

test("renderMarkdownToHtml supports tables", () => {
  const html = renderMarkdownToHtml("| A | B |\n| --- | --- |\n| 1 | 2 |");

  assert.match(html, /<table/);
  assert.match(html, /<td>1<\/td>/);
});

test("renderMarkdownToHtml escapes raw html instead of rendering it", () => {
  const html = renderMarkdownToHtml("<script>alert(1)</script>");

  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("buildSessionPlainText includes the conversation transcript", () => {
  const text = buildSessionPlainText(sampleSession, getStringsForLocale("en-US"));

  assert.match(text, /Sample Paper/);
  assert.match(text, /\bAI\b/);
  assert.match(text, /Fig\. 2/);
});

test("getSuggestedQuestions returns localized starter prompts", () => {
  const zh = getSuggestedQuestions(getStringsForLocale("zh-CN"));
  const en = getSuggestedQuestions(getStringsForLocale("en-US"));

  assert.equal(zh.length, 3);
  assert.equal(en.length, 3);
  assert.match(zh[0], /论文|贡献|核心/);
  assert.match(en[0], /core contribution/i);
});
