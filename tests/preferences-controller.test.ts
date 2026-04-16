import test from "node:test";
import assert from "node:assert/strict";

import { initPreferencesDocument } from "../src/preferences/controller.ts";
import { DEFAULT_SETTINGS } from "../src/background/settings-manager.ts";
import { getStringsForLocale } from "../src/i18n/index.ts";

class FakeElement {
  id: string;
  value = "";
  style: Record<string, string> = {};
  textContent = "";
  listeners = new Map<string, Array<() => void>>();
  className = "";
  ownerDocument?: FakeDocument;
  attributes = new Map<string, string>();

  constructor(id: string, className = "") {
    this.id = id;
    this.className = className;
  }

  addEventListener(type: string, handler: () => void): void {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  trigger(type: string): void {
    for (const handler of this.listeners.get(type) || []) {
      handler();
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  elements = new Map<string, FakeElement>();
  groups = new Map<string, FakeElement[]>();
  defaultView = {
    setTimeout(callback: () => void): void {
      callback();
    }
  };

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) || null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.groups.get(selector) || [];
  }

  addElement(id: string, className = ""): FakeElement {
    const element = new FakeElement(id, className);
    element.ownerDocument = this;
    this.elements.set(id, element);
    if (className) {
      const selector = `.${className}`;
      const group = this.groups.get(selector) || [];
      group.push(element);
      this.groups.set(selector, group);
    }
    return element;
  }
}

test("initPreferencesDocument is idempotent and syncs visibility", () => {
  const doc = new FakeDocument();
  const calls: Array<[string, string]> = [];

  for (const id of [
    "backendMode",
    "directProvider",
    "apiAddress",
    "apiKey",
    "modelName",
    "companionUrl",
    "requestTimeoutMs",
    "sidebarWidth",
    "zpr-mode-summary-title",
    "zpr-mode-summary-body",
    "toggleAdvancedBtn",
    "advancedSettings",
    "saveBtn",
    "resetBtn",
    "settingsStatus"
  ]) {
    doc.addElement(id);
  }

  doc.addElement("direct-1", "zpr-direct-only");
  doc.addElement("companion-1", "zpr-companion-only");
  doc.addElement("advanced-1", "zpr-advanced");

  initPreferencesDocument(doc as unknown as Document, {
    defaults: DEFAULT_SETTINGS,
    getAllSettings: () => ({ ...DEFAULT_SETTINGS, backendMode: "companion" }),
    setSetting: (key, value) => {
      calls.push([String(key), String(value)]);
    },
    strings: getStringsForLocale("en-US")
  });

  initPreferencesDocument(doc as unknown as Document, {
    defaults: DEFAULT_SETTINGS,
    getAllSettings: () => ({ ...DEFAULT_SETTINGS, backendMode: "companion" }),
    setSetting: (key, value) => {
      calls.push([String(key), String(value)]);
    },
    strings: getStringsForLocale("en-US")
  });

  assert.equal(doc.getElementById("backendMode")?.listeners.get("change")?.length, 1);
  assert.equal(doc.getElementById("saveBtn")?.listeners.get("click")?.length, 1);
  assert.equal(doc.getElementById("resetBtn")?.listeners.get("click")?.length, 1);
  assert.equal(doc.getElementById("toggleAdvancedBtn")?.listeners.get("click")?.length, 1);
  assert.equal(doc.querySelectorAll(".zpr-direct-only")[0]?.style.display, "none");
  assert.equal(doc.querySelectorAll(".zpr-companion-only")[0]?.style.display, "");
  assert.equal(doc.getElementById("advancedSettings")?.style.display, "none");
  assert.equal(doc.getElementById("zpr-mode-summary-title")?.textContent, "Current mode guidance");
  assert.equal(
    doc.getElementById("zpr-mode-summary-body")?.textContent,
    "In companion mode, make sure the local service is running and the Companion URL is reachable."
  );

  doc.getElementById("saveBtn")?.trigger("click");
  assert.ok(calls.some(([key]) => key === "backendMode"));
  assert.equal(doc.getElementById("settingsStatus")?.textContent, "Saved");

  doc.getElementById("toggleAdvancedBtn")?.trigger("click");
  assert.equal(doc.getElementById("advancedSettings")?.style.display, "");
});

test("initPreferencesDocument normalizes invalid numeric settings and reports it", () => {
  const doc = new FakeDocument();
  const calls: Array<[string, string]> = [];

  for (const id of [
    "backendMode",
    "directProvider",
    "apiAddress",
    "apiKey",
    "modelName",
    "companionUrl",
    "requestTimeoutMs",
    "sidebarWidth",
    "zpr-mode-summary-title",
    "zpr-mode-summary-body",
    "toggleAdvancedBtn",
    "advancedSettings",
    "saveBtn",
    "resetBtn",
    "settingsStatus"
  ]) {
    doc.addElement(id);
  }

  initPreferencesDocument(doc as unknown as Document, {
    defaults: DEFAULT_SETTINGS,
    getAllSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSetting: (key, value) => {
      calls.push([String(key), String(value)]);
    },
    strings: getStringsForLocale("en-US")
  });

  doc.getElementById("requestTimeoutMs")!.value = "abc";
  doc.getElementById("sidebarWidth")!.value = "-20";
  doc.getElementById("saveBtn")?.trigger("click");

  assert.ok(calls.some(([key, value]) => key === "requestTimeoutMs" && value === DEFAULT_SETTINGS.requestTimeoutMs));
  assert.ok(calls.some(([key, value]) => key === "sidebarWidth" && value === DEFAULT_SETTINGS.sidebarWidth));
  assert.equal(doc.getElementById("settingsStatus")?.textContent, "Some invalid numeric values were reset to safe defaults.");
});
