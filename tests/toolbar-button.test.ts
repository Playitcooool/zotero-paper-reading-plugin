import test from "node:test";
import assert from "node:assert/strict";

import { buildAskAIButtonMarkup, getAskAIButtonStyles } from "../src/reader/toolbar-button.ts";

test("buildAskAIButtonMarkup includes icon and label", () => {
  const markup = buildAskAIButtonMarkup("Ask AI");

  assert.match(markup, /svg/i);
  assert.match(markup, /Ask AI/);
  assert.match(markup, /zpr-toolbar-icon/);
});

test("buildAskAIButtonMarkup supports localized label", () => {
  const markup = buildAskAIButtonMarkup("询问 AI");

  assert.match(markup, /询问 AI/);
});

test("ask ai button styles hide the label until hover or focus", () => {
  const css = getAskAIButtonStyles();

  assert.match(css, /\.zpr-toolbar-label/);
  assert.match(css, /opacity:\s*0/);
  assert.match(css, /#zpr-ask-ai-button:hover\s+\.zpr-toolbar-label/);
  assert.match(css, /:focus-visible/);
});
