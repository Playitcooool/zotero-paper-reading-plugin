import test from "node:test";
import assert from "node:assert/strict";

import { buildAskAIButtonMarkup, getAskAIButtonStyles } from "../src/reader/toolbar-button.ts";

test("buildAskAIButtonMarkup includes icon markup", () => {
  const markup = buildAskAIButtonMarkup();

  assert.match(markup, /svg/i);
  assert.match(markup, /zpr-toolbar-icon/);
});

test("ask ai button styles keep a compact icon-only button", () => {
  const css = getAskAIButtonStyles();

  assert.match(css, /#zpr-ask-ai-button/);
  assert.match(css, /\.zpr-toolbar-icon/);
  assert.match(css, /width:\s*28px/);
  assert.match(css, /:focus-visible/);
});
