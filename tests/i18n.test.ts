import test from "node:test";
import assert from "node:assert/strict";

import {
  getResolvedLocale,
  getStringsForLocale,
  localizeSectionTitle,
  type SupportedLocale
} from "../src/i18n/index.ts";

test("getResolvedLocale maps zotero locale to zh-CN and en-US", () => {
  assert.equal(getResolvedLocale("zh-CN"), "zh-CN");
  assert.equal(getResolvedLocale("zh"), "zh-CN");
  assert.equal(getResolvedLocale("en-US"), "en-US");
  assert.equal(getResolvedLocale("fr-FR"), "en-US");
});

test("getStringsForLocale returns localized button and settings copy", () => {
  const zh = getStringsForLocale("zh-CN");
  const en = getStringsForLocale("en-US");

  assert.equal(zh.toolbar.askAI, "Ask AI");
  assert.equal(zh.settings.languageExperienceTitle, "语言与体验");
  assert.equal(en.settings.languageExperienceTitle, "Language & experience");
  assert.equal(en.panel.retry, "Retry");
});

test("localizeSectionTitle localizes analysis section headings", () => {
  assert.equal(localizeSectionTitle("thesis", "zh-CN"), "论文主旨");
  assert.equal(localizeSectionTitle("follow-up", "en-US"), "Follow-up experiments/build directions");
});
