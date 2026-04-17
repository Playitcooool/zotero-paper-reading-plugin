import type { ChatSession } from "../background/types.ts";

export function applySessionSaveFailure(input: {
  session: ChatSession;
  saveError: Error | string;
  notice: string;
}): {
  session: ChatSession;
  panelError: null;
  notice: string;
  saveErrorMessage: string;
} {
  return {
    session: input.session,
    panelError: null,
    notice: input.notice,
    saveErrorMessage: input.saveError instanceof Error ? input.saveError.message : String(input.saveError)
  };
}
