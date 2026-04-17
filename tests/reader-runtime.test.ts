import test from "node:test";
import assert from "node:assert/strict";

import {
  clampSidebarWidth,
  createInitialReaderState,
  getResizedSidebarWidth,
  shouldAutoScrollTranscript,
  shouldApplyRequestResult,
  shouldRecreatePanelHost,
  startRequest
} from "../src/runtime/reader-runtime.ts";

test("startRequest increments the request token", () => {
  const state = createInitialReaderState();

  const firstToken = startRequest(state);
  const secondToken = startRequest(state);

  assert.equal(firstToken, 1);
  assert.equal(secondToken, 2);
});

test("shouldApplyRequestResult rejects stale request tokens", () => {
  const state = createInitialReaderState();
  const staleToken = startRequest(state);
  const currentToken = startRequest(state);

  assert.equal(shouldApplyRequestResult(state, staleToken), false);
  assert.equal(shouldApplyRequestResult(state, currentToken), true);
});

test("shouldRecreatePanelHost recreates hosts for disconnected documents or width changes", () => {
  const connectedDoc = { documentElement: { isConnected: true } } as Document;
  const disconnectedDoc = { documentElement: { isConnected: false } } as Document;

  assert.equal(shouldRecreatePanelHost(null, connectedDoc, 420), true);
  assert.equal(shouldRecreatePanelHost({
    doc: connectedDoc,
    sidebarWidth: 420
  }, connectedDoc, 420), false);
  assert.equal(shouldRecreatePanelHost({
    doc: disconnectedDoc,
    sidebarWidth: 420
  }, connectedDoc, 420), true);
  assert.equal(shouldRecreatePanelHost({
    doc: connectedDoc,
    sidebarWidth: 360
  }, connectedDoc, 420), true);
});

test("clampSidebarWidth keeps the panel within fixed bounds and viewport slack", () => {
  assert.equal(clampSidebarWidth(200, 1200), 320);
  assert.equal(clampSidebarWidth(500, 1200), 500);
  assert.equal(clampSidebarWidth(900, 1200), 720);
  assert.equal(clampSidebarWidth(700, 900), 660);
});

test("shouldAutoScrollTranscript pauses when the user scrolls away from the bottom", () => {
  assert.equal(shouldAutoScrollTranscript({
    scrollTop: 580,
    clientHeight: 200,
    scrollHeight: 800
  }), true);
  assert.equal(shouldAutoScrollTranscript({
    scrollTop: 300,
    clientHeight: 200,
    scrollHeight: 800
  }), false);
});

test("getResizedSidebarWidth expands and shrinks from the right edge drag handle", () => {
  assert.equal(getResizedSidebarWidth({
    startWidth: 420,
    startClientX: 1000,
    currentClientX: 920,
    viewportWidth: 1440
  }), 500);
  assert.equal(getResizedSidebarWidth({
    startWidth: 420,
    startClientX: 1000,
    currentClientX: 1080,
    viewportWidth: 1440
  }), 340);
});
