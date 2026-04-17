export type BackendMode = "direct" | "companion";
export type DirectProvider = "openai-compatible" | "anthropic" | "google";

export interface PluginSettings {
  backendMode: BackendMode;
  directProvider: DirectProvider;
  apiAddress: string;
  apiKey: string;
  modelName: string;
  companionUrl: string;
  requestTimeoutMs: string;
  sidebarWidth: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  backendMode: "direct",
  directProvider: "openai-compatible",
  apiAddress: "https://api.openai.com/v1",
  apiKey: "",
  modelName: "gpt-4.1-mini",
  companionUrl: "http://127.0.0.1:8765",
  requestTimeoutMs: "120000",
  sidebarWidth: "420"
};

const PREF_PREFIX = "extensions.zotero.zoteropaperreading.";

function getPrefs(): { get(key: string): unknown; set(key: string, value: unknown): void } | null {
  return (globalThis as { Zotero?: { Prefs?: { get(key: string): unknown; set(key: string, value: unknown): void } } }).Zotero?.Prefs || null;
}

export function getSetting<K extends keyof PluginSettings>(key: K): PluginSettings[K] {
  const prefs = getPrefs();
  if (!prefs) {
    return DEFAULT_SETTINGS[key];
  }

  const value = prefs.get(PREF_PREFIX + key);
  return (value === undefined || value === null || value === "")
    ? DEFAULT_SETTINGS[key]
    : String(value) as PluginSettings[K];
}

export function setSetting<K extends keyof PluginSettings>(key: K, value: PluginSettings[K]): void {
  getPrefs()?.set(PREF_PREFIX + key, value);
}

export function getAllSettings(): PluginSettings {
  return {
    backendMode: getSetting("backendMode"),
    directProvider: getSetting("directProvider"),
    apiAddress: getSetting("apiAddress"),
    apiKey: getSetting("apiKey"),
    modelName: getSetting("modelName"),
    companionUrl: getSetting("companionUrl"),
    requestTimeoutMs: getSetting("requestTimeoutMs"),
    sidebarWidth: getSetting("sidebarWidth")
  };
}

export function parsePositiveIntegerSetting(value: string, fallback: number): number {
  const numeric = Number.parseInt(value.trim(), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function getRequestTimeoutMs(settings: PluginSettings): number {
  return parsePositiveIntegerSetting(settings.requestTimeoutMs, Number.parseInt(DEFAULT_SETTINGS.requestTimeoutMs, 10));
}

export function getSidebarWidth(settings: PluginSettings): number {
  return parsePositiveIntegerSetting(settings.sidebarWidth, Number.parseInt(DEFAULT_SETTINGS.sidebarWidth, 10));
}
