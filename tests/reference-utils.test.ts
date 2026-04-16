import test from "node:test";
import assert from "node:assert/strict";

import { shouldEnableAskAI, toReaderLocation } from "../src/reader/reference-utils.ts";

test("shouldEnableAskAI only enables PDF attachments", () => {
  assert.equal(shouldEnableAskAI({ itemType: "attachment-pdf" }), true);
  assert.equal(shouldEnableAskAI({ itemType: "attachment-file", attachmentReaderType: "pdf" }), true);
  assert.equal(shouldEnableAskAI({ itemType: "attachment-file", attachmentContentType: "application/pdf" }), true);
  assert.equal(shouldEnableAskAI({ itemType: "attachment-epub" }), false);
});

test("toReaderLocation converts page references to Zotero reader location", () => {
  assert.deepEqual(toReaderLocation({ kind: "page", label: "p.8", page: 8 }), { pageIndex: 7 });
});
