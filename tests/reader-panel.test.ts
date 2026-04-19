import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPanelToolbarActions,
  buildPendingIndicatorMarkup,
  getComposerFocusBehavior,
  getComposerKeyAction,
  getComposerRenderValue,
  buildVisibleMessageMeta,
  getSidebarStyles,
  shouldShowMessageCopyButton,
  buildVisibleSessionMeta,
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

test("renderMarkdownToHtml renders inline and block math", () => {
  const inlineHtml = renderMarkdownToHtml("Inline math $E=mc^2$ works.");
  const blockHtml = renderMarkdownToHtml("\\[a^2 + b^2 = c^2\\]");

  assert.match(inlineHtml, /katex/);
  assert.match(blockHtml, /katex-display/);
});

test("renderMarkdownToHtml supports alternate latex delimiters and preserves code spans", () => {
  const html = renderMarkdownToHtml("Math: \\(x+y\\). Code: `\\(x+y\\)`.");

  assert.match(html, /katex/);
  assert.match(html, /<code>\\\(x\+y\\\)<\/code>/);
});

test("renderMarkdownToHtml escapes raw html instead of rendering it", () => {
  const html = renderMarkdownToHtml("<script>alert(1)</script>");

  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("buildVisibleSessionMeta keeps only title and year for the live panel", () => {
  assert.deepEqual(buildVisibleSessionMeta(sampleSession, getStringsForLocale("en-US")), {
    title: "Sample Paper",
    detail: "2026"
  });
});

test("buildPanelToolbarActions exposes regenerate and clear actions", () => {
  assert.deepEqual(buildPanelToolbarActions(getStringsForLocale("en-US")), [
    { id: "regenerate", label: "Regenerate" },
    { id: "clear", label: "Clear chat", danger: true }
  ]);
});

test("buildVisibleMessageMeta hides assistant labels and keeps the user label", () => {
  assert.deepEqual(buildVisibleMessageMeta(sampleSession.messages[0], getStringsForLocale("en-US")), {
    roleLabel: "",
    showRole: false
  });
  assert.deepEqual(buildVisibleMessageMeta({
    id: "u1",
    role: "user",
    markdown: "Question",
    createdAt: "2026-04-16T10:01:00.000Z",
    citations: []
  }, getStringsForLocale("en-US")), {
    roleLabel: "You",
    showRole: true
  });
});

test("shouldShowMessageCopyButton only shows copy for completed assistant messages", () => {
  assert.equal(shouldShowMessageCopyButton(sampleSession.messages[0]), true);
  assert.equal(shouldShowMessageCopyButton({
    ...sampleSession.messages[0],
    status: "pending"
  }), false);
  assert.equal(shouldShowMessageCopyButton({
    id: "u1",
    role: "user",
    markdown: "Question",
    createdAt: "2026-04-16T10:01:00.000Z",
    citations: []
  }), false);
});

test("buildPendingIndicatorMarkup uses spinner markup for empty thinking state", () => {
  const html = buildPendingIndicatorMarkup(getStringsForLocale("en-US"));
  assert.match(html, /zpr-spinner/);
  assert.match(html, /Thinking/);
});

test("getComposerKeyAction only submits on plain Enter when not composing or busy", () => {
  assert.equal(getComposerKeyAction({
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    isBusy: false
  }), "submit");
  assert.equal(getComposerKeyAction({
    key: "Enter",
    shiftKey: true,
    isComposing: false,
    isBusy: false
  }), "newline");
  assert.equal(getComposerKeyAction({
    key: "Enter",
    shiftKey: false,
    isComposing: true,
    isBusy: false
  }), "ignore");
  assert.equal(getComposerKeyAction({
    key: "Backspace",
    shiftKey: false,
    isComposing: false,
    isBusy: false
  }), "ignore");
  assert.equal(getComposerKeyAction({
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    isBusy: true
  }), "ignore");
});

test("composer render helpers preserve draft and only refocus after busy completes", () => {
  assert.equal(getComposerRenderValue({
    storedDraft: "draft question",
    liveInputValue: ""
  }), "draft question");
  assert.equal(getComposerRenderValue({
    storedDraft: "draft question",
    liveInputValue: "edited draft"
  }), "edited draft");

  assert.equal(getComposerFocusBehavior({
    wasBusy: false,
    isBusy: false,
    isInputFocused: false
  }), "focus");
  assert.equal(getComposerFocusBehavior({
    wasBusy: false,
    isBusy: false,
    isInputFocused: true
  }), "preserve");
  assert.equal(getComposerFocusBehavior({
    wasBusy: true,
    isBusy: false,
    isInputFocused: false
  }), "focus");
  assert.equal(getComposerFocusBehavior({
    wasBusy: false,
    isBusy: true,
    isInputFocused: false
  }), "preserve");
});

test("getSidebarStyles includes edge-resize, unified composer colors, and streaming animation hooks", () => {
  const css = getSidebarStyles();
  assert.match(css, /\.zpr-sidebar-resize/);
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /\.zpr-composer-input/);
  assert.match(css, /background:\s*rgba\(248,\s*250,\s*252,\s*0\.95\)/);
  assert.match(css, /@keyframes zpr-spin/);
  assert.match(css, /@keyframes zpr-stream-pulse/);
});

test("getSidebarStyles makes assistant output selectable and tables show grid lines", () => {
  const css = getSidebarStyles();
  assert.match(css, /\.zpr-message-body[^}]*user-select:\s*text\s*!important/i);
  assert.match(css, /\.zpr-message-body \*[^}]*user-select:\s*text\s*!important/i);
  assert.match(css, /\.zpr-message-body\s+table/i);
  assert.match(css, /\.zpr-message-body\s+th,\s*\.zpr-message-body\s+td/i);
  assert.match(css, /border:\s*1px/i);
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
