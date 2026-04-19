export interface ReaderRequestState {
  requestToken: number;
}

export interface PanelHostMeta {
  doc: Document;
  sidebarWidth: number;
}

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

const MIN_SIDEBAR_WIDTH = 280;
const VIEWPORT_SLACK = 96;
const AUTO_SCROLL_THRESHOLD = 32;

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

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(0, viewportWidth - VIEWPORT_SLACK);
  if (viewportMax <= 0) {
    return 0;
  }
  if (viewportMax < MIN_SIDEBAR_WIDTH) {
    return Math.min(Math.max(width, 0), viewportMax);
  }
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), viewportMax);
}

export function getResizedSidebarWidth(args: {
  startWidth: number;
  startClientX: number;
  currentClientX: number;
  viewportWidth: number;
}): number {
  const delta = args.startClientX - args.currentClientX;
  return clampSidebarWidth(args.startWidth + delta, args.viewportWidth);
}

export function shouldAutoScrollTranscript(metrics: ScrollMetrics): boolean {
  return metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - AUTO_SCROLL_THRESHOLD;
}
