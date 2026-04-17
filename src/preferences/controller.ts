import type { PluginSettings } from "../background/settings-manager.ts";
import type { PluginStrings } from "../i18n/index.ts";

const initializedDocs = new WeakSet<object>();

export function initPreferencesDocument(
  doc: Document,
  deps: {
    defaults: PluginSettings;
    getAllSettings: () => PluginSettings;
    setSetting: <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]) => void;
    strings: PluginStrings;
  }
): void {
  const fields: Array<keyof PluginSettings> = [
    "directProvider",
    "apiAddress",
    "apiKey",
    "modelName",
    "requestTimeoutMs",
    "sidebarWidth"
  ];

  const settings = deps.getAllSettings();
  for (const field of fields) {
    const input = doc.getElementById(field) as HTMLInputElement | HTMLSelectElement | null;
    if (input) {
      input.value = settings[field];
      if ("placeholder" in input) {
        input.placeholder = String(deps.defaults[field]);
      }
    }
  }

  const syncSummary = () => {
    setText(doc, "zpr-mode-summary-title", deps.strings.settings.modeSummaryTitle);
    setText(doc, "zpr-mode-summary-body", deps.strings.settings.directModeSummary);
  };

  const syncStaticCopy = () => {
    setText(doc, "zpr-language-title", deps.strings.settings.languageExperienceTitle);
    setText(doc, "zpr-language-body", deps.strings.settings.languageExperienceBody);
    setText(doc, "zpr-backend-title", deps.strings.settings.backendModeTitle);
    setText(doc, "zpr-provider-label", deps.strings.settings.directProviderLabel);
    setText(doc, "zpr-credentials-title", deps.strings.settings.credentialsTitle);
    setText(doc, "zpr-api-address-label", deps.strings.settings.apiAddressLabel);
    setText(doc, "zpr-api-address-help", deps.strings.settings.apiAddressHelp);
    setText(doc, "zpr-api-key-label", deps.strings.settings.apiKeyLabel);
    setText(doc, "zpr-api-key-help", deps.strings.settings.apiKeyHelp);
    setText(doc, "zpr-model-name-label", deps.strings.settings.modelNameLabel);
    setText(doc, "zpr-model-name-help", deps.strings.settings.modelNameHelp);
    setText(doc, "zpr-advanced-title", deps.strings.settings.advancedTitle);
    setText(doc, "zpr-timeout-label", deps.strings.settings.requestTimeoutLabel);
    setText(doc, "zpr-timeout-help", deps.strings.settings.requestTimeoutHelp);
    setText(doc, "zpr-sidebar-width-label", deps.strings.settings.sidebarWidthLabel);
    setText(doc, "zpr-sidebar-width-help", deps.strings.settings.sidebarWidthHelp);
    setText(doc, "zpr-subtitle", deps.strings.settings.subtitle);

    const provider = doc.getElementById("directProvider") as (HTMLSelectElement & { options?: ArrayLike<{ text: string }> }) | null;
    if (provider?.options?.length) {
      provider.options[0].text = deps.strings.backends.openaiCompatible;
      provider.options[1].text = deps.strings.backends.anthropic;
      provider.options[2].text = deps.strings.backends.google;
    }

    const saveBtn = doc.getElementById("saveBtn") as HTMLButtonElement | null;
    const resetBtn = doc.getElementById("resetBtn") as HTMLButtonElement | null;
    if (saveBtn) {
      saveBtn.textContent = deps.strings.settings.save;
      saveBtn.setAttribute("label", deps.strings.settings.save);
    }
    if (resetBtn) {
      resetBtn.textContent = deps.strings.settings.reset;
      resetBtn.setAttribute("label", deps.strings.settings.reset);
    }
  };

  const syncAdvancedVisibility = () => {
    const advanced = doc.getElementById("advancedSettings") as HTMLElement | null;
    const toggle = doc.getElementById("toggleAdvancedBtn") as HTMLButtonElement | null;
    const isOpen = advanced?.getAttribute("data-open") === "true";
    if (advanced) {
      advanced.style.display = isOpen ? "" : "none";
    }
    if (toggle) {
      const label = isOpen
        ? deps.strings.settings.advancedToggleHide
        : deps.strings.settings.advancedToggleShow;
      toggle.textContent = label;
      toggle.setAttribute("label", label);
    }
  };

  if (!initializedDocs.has(doc)) {
    initializedDocs.add(doc);

    doc.getElementById("toggleAdvancedBtn")?.addEventListener("click", () => {
      const advanced = doc.getElementById("advancedSettings") as HTMLElement | null;
      if (!advanced) {
        return;
      }
      advanced.setAttribute("data-open", advanced.getAttribute("data-open") === "true" ? "false" : "true");
      syncAdvancedVisibility();
    });

    const saveBtn = doc.getElementById("saveBtn");
    const resetBtn = doc.getElementById("resetBtn");
    const status = doc.getElementById("settingsStatus") as HTMLElement | null;

    saveBtn?.addEventListener("click", () => {
      const invalidNumericFields: string[] = [];
      for (const field of fields) {
        const input = doc.getElementById(field) as HTMLInputElement | HTMLSelectElement | null;
        if (input) {
          const value = normalizeSettingValue(field, input.value, deps.defaults, invalidNumericFields);
          input.value = value;
          deps.setSetting(field, value as PluginSettings[typeof field]);
        }
      }
      flashStatus(
        status,
        invalidNumericFields.length
          ? deps.strings.settings.invalidNumericReset
          : deps.strings.settings.saved
      );
    });

    resetBtn?.addEventListener("click", () => {
      for (const field of fields) {
        const input = doc.getElementById(field) as HTMLInputElement | HTMLSelectElement | null;
        if (input) {
          input.value = deps.defaults[field];
        }
      }
      syncSummary();
      flashStatus(status, deps.strings.settings.resetDone);
    });
  }

  syncStaticCopy();
  syncSummary();
  syncAdvancedVisibility();
}

function flashStatus(status: HTMLElement | null, message: string): void {
  if (!status) {
    return;
  }

  status.textContent = message;
  status.style.visibility = "visible";
  status.ownerDocument.defaultView?.setTimeout(() => {
    status.style.visibility = "hidden";
  }, 1800);
}

function setText(doc: Document, id: string, value: string): void {
  const element = doc.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function normalizeSettingValue<K extends keyof PluginSettings>(
  key: K,
  value: string,
  defaults: PluginSettings,
  invalidNumericFields: string[]
): PluginSettings[K] {
  if (key === "requestTimeoutMs" || key === "sidebarWidth") {
    const trimmed = value.trim();
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      invalidNumericFields.push(String(key));
      return defaults[key];
    }
    return String(numeric) as PluginSettings[K];
  }

  return value as PluginSettings[K];
}
