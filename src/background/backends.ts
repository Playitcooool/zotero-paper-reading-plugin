import type { AnalysisBackend, ChatRequest, ChatResponse, LLMMessage } from "./types.ts";
import type { DirectProvider, PluginSettings } from "./settings-manager.ts";
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

  if (settings.backendMode === "companion") {
    return {
      kind: "companion",
      label: getCurrentStrings().backends.companion,
      chat: async (request) => chatWithCompanion(settings, request, fetchImpl)
    };
  }

  return {
    kind: "direct",
    label: directProviderLabel(settings.directProvider),
    chat: async (request) => chatDirect(settings, request, fetchImpl)
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

async function chatDirect(
  settings: PluginSettings,
  request: ChatRequest,
  fetchImpl: typeof fetch
): Promise<ChatResponse> {
  const endpoint = resolveDirectEndpoint(settings.directProvider, settings.apiAddress, settings.modelName);
  const response = await fetchImpl(endpoint, buildProviderChatRequest(settings.directProvider, settings, request.messages));
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

async function chatWithCompanion(
  settings: PluginSettings,
  request: ChatRequest,
  fetchImpl: typeof fetch
): Promise<ChatResponse> {
  const strings = getCurrentStrings();
  const response = await fetchImpl(`${stripTrailingSlash(settings.companionUrl)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage(response, strings.backends.companion));
  }

  const data = await response.json() as unknown as JsonValue;
  return {
    markdown: typeof data.content === "string" ? data.content : "",
    backendLabel: strings.backends.companion,
    model: typeof data.model === "string" ? data.model : "companion"
  };
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
