import test from "node:test";
import assert from "node:assert/strict";

import type { ChatSession } from "../src/background/types.ts";
import { applySessionSaveFailure } from "../src/runtime/session-persistence-state.ts";

const session: ChatSession = {
  paper: {
    itemID: 7,
    title: "Sample Paper",
    authors: ["Jane Doe"],
    year: "2026"
  },
  backendLabel: "OpenAI Compatible",
  model: "gpt-5-mini",
  createdAt: "2026-04-16T10:00:00.000Z",
  updatedAt: "2026-04-16T10:05:00.000Z",
  messages: []
};

test("applySessionSaveFailure keeps the session visible and reports a notice instead of a fatal panel error", () => {
  const next = applySessionSaveFailure({
    session,
    saveError: new Error("parent item 1/g2n4jn54 must be a regular item"),
    notice: "Generated, but not saved."
  });

  assert.equal(next.session, session);
  assert.equal(next.panelError, null);
  assert.equal(next.notice, "Generated, but not saved.");
  assert.equal(next.saveErrorMessage, "parent item 1/g2n4jn54 must be a regular item");
});
