import type { AnalysisBackend, ChatRequest, ChatResponse, ChatStreamEvent, LLMMessage } from "./types.ts";
import { getRequestTimeoutMs, type DirectProvider, type PluginSettings } from "./settings-manager.ts";
import { getCurrentStrings } from "../i18n/index.ts";

export interface BackendDeps {
  fetch?: typeof fetch;
}

interface JsonValue {
  [key: string]: unknown;
}

export function createBackend(settings: PluginSettings, deps: BackendDeps = {}): AnalysisBackend {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Fetch is unavailable in this environment");
  }

  return {
    kind: "direct",
    label: directProviderLabel(settings.directProvider),
    chat: async (request) => chatDirect(settings, request, fetchImpl),
    chatStream: (request) => streamDirect(settings, request, fetchImpl)
  };
}

export function resolveDirectEndpoint(provider: DirectProvider, apiAddress: string, modelName: string): string {
  const normalizedBase = stripTrailingSlash(apiAddress);
  if (provider === "anthropic") {
    return `${normalizedBase}/messages`;
  }
  if (provider === "google") {
    return `${normalizedBase}/v1beta/models/${modelName}:generateContent`;
  }
  return `${normalizedBase}/chat/completions`;
}

export function buildProviderChatRequest(
  provider: DirectProvider,
  settings: PluginSettings,
  messages: LLMMessage[]
): RequestInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (provider === "anthropic") {
    headers["x-api-key"] = settings.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.modelName,
        max_tokens: 4000,
        system: messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"),
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content
          }))
      })
    };
  }

  if (provider === "google") {
    return {
      method: "POST",
      headers: settings.apiKey
        ? { ...headers, "x-goog-api-key": settings.apiKey }
        : headers,
      body: JSON.stringify({
        systemInstruction: {
          parts: messages
            .filter((message) => message.role === "system")
            .map((message) => ({ text: message.content }))
        },
        contents: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }]
          }))
      })
    };
  }

  return {
    method: "POST",
    headers: settings.apiKey
      ? { ...headers, Authorization: `Bearer ${settings.apiKey}` }
      : headers,
    body: JSON.stringify({
      model: settings.modelName,
      messages
    })
  };
}

export function buildProviderStreamRequest(
  provider: DirectProvider,
  settings: PluginSettings,
  messages: LLMMessage[]
): RequestInit {
  const request = buildProviderChatRequest(provider, settings, messages);
  if (provider !== "openai-compatible" || typeof request.body !== "string") {
    return request;
  }

  const payload = JSON.parse(request.body) as JsonValue;
  return {
    ...request,
    body: JSON.stringify({
      ...payload,
      stream: true
    })
  };
}

async function chatDirect(
  settings: PluginSettings,
  request: ChatRequest,
  fetchImpl: typeof fetch
): Promise<ChatResponse> {
  if (settings.directProvider === "openai-compatible") {
    let markdown = "";
    let model = settings.modelName;
    for await (const event of streamDirect(settings, request, fetchImpl)) {
      if (event.type === "metadata") {
        model = event.model;
      }
      if (event.type === "delta") {
        markdown += event.text;
      }
    }
    return {
      markdown: markdown.trim(),
      backendLabel: directProviderLabel(settings.directProvider),
      model
    };
  }

  const endpoint = resolveDirectEndpoint(settings.directProvider, settings.apiAddress, settings.modelName);
  const response = await fetchDirectResponse(
    fetchImpl,
    endpoint,
    buildProviderChatRequest(settings.directProvider, settings, request.messages),
    getRequestTimeoutMs(settings),
    settings.directProvider
  );
  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage(response, directProviderLabel(settings.directProvider)));
  }

  const data = await response.json() as unknown as JsonValue;
  return {
    markdown: extractDirectContent(settings.directProvider, data),
    backendLabel: directProviderLabel(settings.directProvider),
    model: settings.modelName
  };
}

async function* streamDirect(
  settings: PluginSettings,
  request: ChatRequest,
  fetchImpl: typeof fetch
): AsyncIterable<ChatStreamEvent> {
  const endpoint = resolveDirectEndpoint(settings.directProvider, settings.apiAddress, settings.modelName);
  const response = await fetchDirectResponse(
    fetchImpl,
    endpoint,
    buildProviderStreamRequest(settings.directProvider, settings, request.messages),
    getRequestTimeoutMs(settings),
    settings.directProvider
  );
  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage(response, directProviderLabel(settings.directProvider)));
  }

  if (settings.directProvider !== "openai-compatible") {
    const data = await response.json() as unknown as JsonValue;
    yield {
      type: "metadata",
      backendLabel: directProviderLabel(settings.directProvider),
      model: settings.modelName
    };
    const text = extractDirectContent(settings.directProvider, data);
    if (text) {
      yield {
        type: "delta",
        text
      };
    }
    yield { type: "done" };
    return;
  }

  yield* streamOpenAICompatibleResponse(response, directProviderLabel(settings.directProvider), settings.modelName);
}

function extractDirectContent(provider: DirectProvider, data: JsonValue): string {
  if (provider === "anthropic") {
    const content = Array.isArray(data.content) ? data.content : [];
    return content
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        return typeof (entry as JsonValue).text === "string" ? (entry as JsonValue).text as string : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (provider === "google") {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const first = candidates[0] as JsonValue | undefined;
    const parts = Array.isArray((first?.content as JsonValue | undefined)?.parts)
      ? ((first?.content as JsonValue).parts as unknown[])
      : [];
    return parts
      .map((part) => (part && typeof part === "object" && typeof (part as JsonValue).text === "string") ? (part as JsonValue).text as string : "")
      .join("\n")
      .trim();
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] as JsonValue | undefined;
  const message = first?.message as JsonValue | undefined;
  const content = message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        return typeof (part as JsonValue).text === "string" ? (part as JsonValue).text as string : "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

async function buildHttpErrorMessage(response: Response, label: string): Promise<string> {
  const fallback = `${label} error: ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json() as unknown as JsonValue;
      const message = typeof data.error === "string"
        ? data.error
        : (data.error && typeof data.error === "object" && typeof (data.error as JsonValue).message === "string")
          ? (data.error as JsonValue).message as string
          : typeof data.message === "string"
            ? data.message
            : undefined;
      return message ? `${fallback} - ${message}` : fallback;
    }
    const text = (await response.text()).trim();
    return text ? `${fallback} - ${text.slice(0, 280)}` : fallback;
  } catch {
    return fallback;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function directProviderLabel(provider: DirectProvider): string {
  const strings = getCurrentStrings();
  switch (provider) {
    case "anthropic":
      return strings.backends.anthropic;
    case "google":
      return strings.backends.google;
    default:
      return strings.backends.openaiCompatible;
  }
}

async function* streamOpenAICompatibleResponse(
  response: Response,
  backendLabel: string,
  fallbackModel: string
): AsyncIterable<ChatStreamEvent> {
  if (!response.body) {
    yield {
      type: "metadata",
      backendLabel,
      model: fallbackModel
    };
    yield { type: "done" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let emittedMetadata = false;

  for await (const chunk of readResponseBody(response.body)) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const events = parseOpenAIStreamFrame(frame, backendLabel, fallbackModel, emittedMetadata);
      if (!events.length) {
        continue;
      }
      if (events[0]?.type === "metadata") {
        emittedMetadata = true;
      }
      for (const event of events) {
        yield event;
      }
      if (events.some((event) => event.type === "done")) {
        return;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const events = parseOpenAIStreamFrame(buffer, backendLabel, fallbackModel, emittedMetadata);
    if (events[0]?.type === "metadata") {
      emittedMetadata = true;
    }
    for (const event of events) {
      yield event;
    }
    if (events.some((event) => event.type === "done")) {
      return;
    }
  }

  if (!emittedMetadata) {
    yield {
      type: "metadata",
      backendLabel,
      model: fallbackModel
    };
  }
  yield { type: "done" };
}

async function* readResponseBody(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      if (value) {
        yield value;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseOpenAIStreamFrame(
  frame: string,
  backendLabel: string,
  fallbackModel: string,
  emittedMetadata: boolean
): ChatStreamEvent[] {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .join("\n");
  if (!payload) {
    return [];
  }
  if (payload === "[DONE]") {
    return [{ type: "done" }];
  }

  const data = JSON.parse(payload) as JsonValue;
  const events: ChatStreamEvent[] = [];
  if (!emittedMetadata) {
    events.push({
      type: "metadata",
      backendLabel,
      model: typeof data.model === "string" ? data.model : fallbackModel
    });
  }

  const text = extractOpenAICompatibleDelta(data);
  if (text) {
    events.push({
      type: "delta",
      text
    });
  }
  return events;
}

function extractOpenAICompatibleDelta(data: JsonValue): string {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") {
        return "";
      }
      const delta = (choice as JsonValue).delta;
      if (!delta || typeof delta !== "object") {
        return "";
      }
      const content = (delta as JsonValue).content;
      if (typeof content === "string") {
        return content;
      }
      if (!Array.isArray(content)) {
        return "";
      }
      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          return typeof (part as JsonValue).text === "string" ? (part as JsonValue).text as string : "";
        })
        .join("");
    })
    .join("");
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const timeoutMessage = getCurrentStrings().panel.requestTimedOut.replace("{ms}", String(timeoutMs));
  const AbortControllerImpl = globalThis.AbortController;
  if (typeof AbortControllerImpl !== "function") {
    return await fetchWithFallbackTimeout(fetchImpl, input, init, timeoutMs, timeoutMessage);
  }

  const controller = new AbortControllerImpl();
  const timeoutId = setTimeout(() => controller.abort(timeoutMessage), timeoutMs);

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchDirectResponse(
  fetchImpl: typeof fetch,
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  provider: DirectProvider
): Promise<Response> {
  try {
    return await fetchWithTimeout(fetchImpl, endpoint, init, timeoutMs);
  } catch (error) {
    throw decorateFetchError(error, endpoint, provider);
  }
}

function decorateFetchError(error: unknown, endpoint: string, provider: DirectProvider): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }

  return new Error([
    `Network request failed for ${provider} provider.`,
    `Endpoint: ${endpoint}`,
    `Reason: ${message}`,
    "Check that the API address is correct, the server is reachable, and Zotero trusts the TLS certificate if you are using HTTPS."
  ].join(" "));
}

async function fetchWithFallbackTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fetchImpl(input, init),
      new Promise<Response>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
