import test from "node:test";
import assert from "node:assert/strict";

import { buildAskAIButtonMarkup } from "../src/reader/toolbar-button.ts";

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
