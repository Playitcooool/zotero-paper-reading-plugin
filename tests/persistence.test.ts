import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAnalysisNoteHtml,
  buildChatNoteHtml,
  convertLegacyAnalysisToChatSession,
  deleteSavedChatSessionForAttachment,
  findExistingAnalysisNote,
  parseAnalysisNoteHtml,
  parseChatNoteHtml
} from "../src/background/persistence.ts";
import type { AnalysisResult, ChatSession } from "../src/background/types.ts";

const sampleResult: AnalysisResult = {
  sections: [
    { id: "thesis", content: "The paper proposes a new method." },
    { id: "core-method", content: "Encoder plus reranker." }
  ],
  references: [{ kind: "page", label: "p.4", page: 4 }],
  meta: {
    title: "Sample Paper",
    authors: ["Jane Doe"],
    year: "2026",
    backendLabel: "OpenAI Compatible",
    model: "gpt-5-mini",
    generatedAt: "2026-04-16T10:00:00.000Z"
  },
  rawText: "raw"
};

test("buildAnalysisNoteHtml round-trips through parseAnalysisNoteHtml", () => {
  const html = buildAnalysisNoteHtml(sampleResult);
  const parsed = parseAnalysisNoteHtml(html);

  assert.ok(parsed);
  assert.equal(parsed?.meta.title, "Sample Paper");
  assert.equal(parsed?.sections.length, 2);
  assert.equal(parsed?.references[0].page, 4);
});

test("findExistingAnalysisNote returns plugin-managed note", () => {
  const notes = [
    { id: 1, note: "<p>normal</p>" },
    { id: 2, note: buildAnalysisNoteHtml(sampleResult) }
  ];

  const found = findExistingAnalysisNote(notes);
  assert.equal(found?.id, 2);
});

test("buildChatNoteHtml round-trips through parseChatNoteHtml", () => {
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
    messages: [
      {
        id: "m1",
        role: "assistant",
        markdown: "# Summary\n\nA structured read of the paper.",
        createdAt: "2026-04-16T10:00:00.000Z",
        citations: [{ kind: "page", label: "p.4", page: 4, sourceToken: "[p. 4]" }],
        status: "done"
      }
    ]
  };

  const html = buildChatNoteHtml(session);
  const parsed = parseChatNoteHtml(html);

  assert.ok(parsed);
  assert.equal(parsed?.paper.title, "Sample Paper");
  assert.equal(parsed?.messages.length, 1);
  assert.equal(parsed?.messages[0].citations[0].sourceToken, "[p. 4]");
});

test("convertLegacyAnalysisToChatSession migrates analysis into a first assistant message", () => {
  const session = convertLegacyAnalysisToChatSession(sampleResult);

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].role, "assistant");
  assert.match(session.messages[0].markdown, /# Thesis/);
  assert.equal(session.messages[0].citations[0].page, 4);
  assert.equal(session.paper.title, "Sample Paper");
});

test("deleteSavedChatSessionForAttachment removes all plugin-managed session notes", async () => {
  const deleted: number[] = [];
  const chatSession: ChatSession = {
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

  const legacyNote = {
    id: 1,
    note: buildAnalysisNoteHtml(sampleResult),
    async eraseTx(): Promise<boolean> {
      deleted.push(1);
      return true;
    }
  };
  const chatNote = {
    id: 2,
    note: buildChatNoteHtml(chatSession),
    async eraseTx(): Promise<boolean> {
      deleted.push(2);
      return true;
    }
  };

  const originalZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Items: {
      get(): Array<typeof legacyNote | typeof chatNote> {
        return [legacyNote, chatNote];
      }
    }
  };

  try {
    const removed = await deleteSavedChatSessionForAttachment({
      getNotes(): number[] {
        return [1, 2];
      }
    } as unknown as Zotero.Item);

    assert.equal(removed, true);
    assert.deepEqual(deleted.sort((a, b) => a - b), [1, 2]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = originalZotero;
  }
});

test("deleteSavedChatSessionForAttachment falls back to deleting a legacy analysis note", async () => {
  const deleted: number[] = [];
  const legacyNote = {
    id: 1,
    note: buildAnalysisNoteHtml(sampleResult),
    async eraseTx(): Promise<boolean> {
      deleted.push(1);
      return true;
    }
  };

  const originalZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Items: {
      get(): Array<typeof legacyNote> {
        return [legacyNote];
      }
    }
  };

  try {
    const removed = await deleteSavedChatSessionForAttachment({
      getNotes(): number[] {
        return [1];
      }
    } as unknown as Zotero.Item);

    assert.equal(removed, true);
    assert.deepEqual(deleted, [1]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = originalZotero;
  }
});
