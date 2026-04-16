import test from "node:test";
import assert from "node:assert/strict";

import { buildFollowupChatMessages, buildInitialChatMessages } from "../src/background/prompt-template.ts";
import type { ChatSession, PaperContext } from "../src/background/types.ts";

const paper: PaperContext = {
  itemID: 1,
  title: "Sample",
  authors: ["Jane Doe"],
  year: "2026",
  attachmentText: "Paper body"
};

test("buildInitialChatMessages follows zh-CN locale", () => {
  const messages = buildInitialChatMessages(paper, "zh-CN");
  assert.match(messages[0].content, /Chinese/i);
  assert.match(messages[1].content, /Paper body/);
});

test("buildFollowupChatMessages keeps first answer and recent turns in balanced mode", () => {
  const session: ChatSession = {
    paper: {
      itemID: 1,
      title: "Sample",
      authors: ["Jane Doe"],
      year: "2026"
    },
    backendLabel: "OpenAI Compatible",
    model: "gpt-5-mini",
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:10:00.000Z",
    messages: [
      { id: "a1", role: "assistant", markdown: "Initial long answer", createdAt: "2026-04-16T10:00:00.000Z", citations: [], status: "done" },
      { id: "u1", role: "user", markdown: "Question 1", createdAt: "2026-04-16T10:01:00.000Z", citations: [] },
      { id: "a2", role: "assistant", markdown: "Answer 1", createdAt: "2026-04-16T10:02:00.000Z", citations: [], status: "done" },
      { id: "u2", role: "user", markdown: "Question 2", createdAt: "2026-04-16T10:03:00.000Z", citations: [] },
      { id: "a3", role: "assistant", markdown: "Answer 2", createdAt: "2026-04-16T10:04:00.000Z", citations: [], status: "done" },
      { id: "u3", role: "user", markdown: "Question 3", createdAt: "2026-04-16T10:05:00.000Z", citations: [] },
      { id: "a4", role: "assistant", markdown: "Answer 3", createdAt: "2026-04-16T10:06:00.000Z", citations: [], status: "done" }
    ]
  };

  const messages = buildFollowupChatMessages({
    paper,
    session,
    question: "What are the main limitations?",
    locale: "en-US"
  });

  assert.match(messages[0].content, /current paper/i);
  assert.match(messages[1].content, /Initial long answer/);
  assert.match(messages[messages.length - 1].content, /main limitations/i);
  assert.ok(!messages.some((message) => /Question 1/.test(message.content)));
});
