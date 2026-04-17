import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../addon/chrome/content/preferences.xhtml", import.meta.url), "utf8");

test("preferences page has language and advanced setting sections", () => {
  assert.match(source, /id="zpr-language-title"/);
  assert.match(source, /id="zpr-mode-summary-title"/);
  assert.match(source, /id="zpr-mode-summary-body"/);
  assert.match(source, /id="zpr-advanced-title"/);
  assert.match(source, /id="toggleAdvancedBtn"/);
  assert.match(source, /id="advancedSettings"/);
});

test("preferences page no longer exposes promptLanguage input", () => {
  assert.ok(!source.includes('id="promptLanguage"'));
});

test("preferences page no longer exposes backend mode or companion inputs", () => {
  assert.ok(!source.includes('id="backendMode"'));
  assert.ok(!source.includes('id="companionUrl"'));
});
