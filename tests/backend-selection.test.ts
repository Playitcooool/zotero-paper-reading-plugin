import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, type PluginSettings } from "../src/background/settings-manager.ts";
import { buildProviderChatRequest, createBackend, resolveDirectEndpoint } from "../src/background/backends.ts";

test("createBackend always returns a direct provider backend", () => {
  const backend = createBackend(DEFAULT_SETTINGS, { fetch: async () => new Response("{}") });
  assert.equal(backend.kind, "direct");
});

test("resolveDirectEndpoint maps anthropic and google endpoints", () => {
  assert.match(resolveDirectEndpoint("anthropic", "https://api.anthropic.com", "claude-sonnet"), /\/messages$/);
  assert.match(resolveDirectEndpoint("google", "https://generativelanguage.googleapis.com", "gemini-2.5-pro"), /gemini-2\.5-pro:generateContent$/);
});

test("buildProviderChatRequest maps follow-up messages to openai-compatible payload", async () => {
  const request = buildProviderChatRequest("openai-compatible", {
    ...DEFAULT_SETTINGS,
    modelName: "gpt-4.1-mini",
    apiKey: "test-key"
  }, [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Question" }
  ]);

  assert.equal(request.method, "POST");
  assert.match(String((request.headers as Record<string, string>).Authorization), /Bearer test-key/);
  assert.match(String(request.body), /"messages"/);
  assert.match(String(request.body), /Question/);
});

test("direct backend aborts requests when timeout elapses", async () => {
  const settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    directProvider: "openai-compatible",
    requestTimeoutMs: "1"
  };

  const backend = createBackend(settings, {
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("signal missing"));
        return;
      }
      signal.addEventListener("abort", () => reject(new Error("Request timed out after 1 ms")), { once: true });
    })
  });

  try {
    await backend.chat({
      paper: {
        itemID: 1,
        title: "Sample",
        authors: ["Jane Doe"],
        year: "2026",
        attachmentText: "Paper body"
      },
      messages: [{ role: "user", content: "Question" }],
      mode: "followup",
      locale: "en-US"
    });
    assert.ok(false, "Expected request to time out");
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), /timed out/i);
  }
});

test("openai-compatible backend streams metadata, delta, and done events", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"model":"gpt-4.1-mini","choices":[{"delta":{"content":"Hello"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  const backend = createBackend(DEFAULT_SETTINGS, {
    fetch: async () => new Response(body, {
      headers: { "content-type": "text/event-stream" }
    })
  });

  const events: Array<{ type: string; text?: string; model?: string }> = [];
  for await (const event of backend.chatStream({
    paper: {
      itemID: 1,
      title: "Sample",
      authors: ["Jane Doe"],
      year: "2026",
      attachmentText: "Paper body"
    },
    messages: [{ role: "user", content: "Question" }],
    mode: "followup",
    locale: "en-US"
  })) {
    events.push(event);
  }

  assert.equal(events[0]?.type, "metadata");
  assert.equal(events[0]?.model, "gpt-4.1-mini");
  assert.equal(events[1]?.type, "delta");
  assert.equal(events[1]?.text, "Hello");
  assert.equal(events[2]?.text, " world");
  assert.equal(events[3]?.type, "done");
});
