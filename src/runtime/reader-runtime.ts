export interface ReaderRequestState {
  requestToken: number;
}

export interface PanelHostMeta {
  doc: Document;
  sidebarWidth: number;
}

export function createInitialReaderState(): ReaderRequestState {
  return {
    requestToken: 0
  };
}

export function startRequest(state: ReaderRequestState): number {
  state.requestToken += 1;
  return state.requestToken;
}

export function shouldApplyRequestResult(state: ReaderRequestState, requestToken: number): boolean {
  return state.requestToken === requestToken;
}

export function shouldRecreatePanelHost(
  existing: PanelHostMeta | null,
  nextDoc: Document,
  nextSidebarWidth: number
): boolean {
  if (!existing) {
    return true;
  }

  if (existing.doc !== nextDoc) {
    return true;
  }

  if (!existing.doc.documentElement?.isConnected) {
    return true;
  }

  return existing.sidebarWidth !== nextSidebarWidth;
}
