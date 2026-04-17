import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialReaderState,
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
