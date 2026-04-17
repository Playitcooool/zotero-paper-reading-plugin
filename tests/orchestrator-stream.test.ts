import test from "node:test";
import assert from "node:assert/strict";

import {
  appendAssistantDelta,
  appendPendingAssistantMessage,
  finalizeAssistantMessage
} from "../src/background/orchestrator.ts";
import type { ChatSession } from "../src/background/types.ts";

const baseSession: ChatSession = {
  paper: {
    itemID: 1,
    title: "Sample Paper",
    authors: ["Jane Doe"],
    year: "2026"
  },
  backendLabel: "OpenAI Compatible",
  model: "gpt-4.1-mini",
  createdAt: "2026-04-16T10:00:00.000Z",
  updatedAt: "2026-04-16T10:00:00.000Z",
  messages: []
};

test("appendPendingAssistantMessage adds a pending assistant turn", () => {
  const session = appendPendingAssistantMessage(baseSession, "2026-04-16T10:01:00.000Z");

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0]?.role, "assistant");
  assert.equal(session.messages[0]?.status, "pending");
  assert.equal(session.messages[0]?.markdown, "");
});

test("appendAssistantDelta updates the pending assistant markdown and citations", () => {
  const pending = appendPendingAssistantMessage(baseSession, "2026-04-16T10:01:00.000Z");
  const session = appendAssistantDelta(pending, "See [Fig. 2]");

  assert.equal(session.messages[0]?.markdown, "See [Fig. 2]");
  assert.equal(session.messages[0]?.citations[0]?.label, "Fig. 2");
  assert.equal(session.messages[0]?.status, "pending");
});

test("finalizeAssistantMessage marks the pending message done and updates backend metadata", () => {
  const pending = appendAssistantDelta(
    appendPendingAssistantMessage(baseSession, "2026-04-16T10:01:00.000Z"),
    "Complete answer"
  );
  const session = finalizeAssistantMessage(pending, {
    backendLabel: "Google Gemini",
    model: "gemini-2.5-pro",
    updatedAt: "2026-04-16T10:02:00.000Z"
  });

  assert.equal(session.backendLabel, "Google Gemini");
  assert.equal(session.model, "gemini-2.5-pro");
  assert.equal(session.updatedAt, "2026-04-16T10:02:00.000Z");
  assert.equal(session.messages[0]?.status, "done");
});
