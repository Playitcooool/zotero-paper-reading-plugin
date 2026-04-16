import type { EvidenceReference } from "../background/types.ts";

export function shouldEnableAskAI(item: {
  itemType?: string | null;
  attachmentReaderType?: string | null;
  attachmentContentType?: string | null;
}): boolean {
  return item.itemType === "attachment-pdf"
    || item.attachmentReaderType === "pdf"
    || item.attachmentContentType === "application/pdf";
}

export function toReaderLocation(reference: EvidenceReference): { pageIndex: number } {
  return {
    pageIndex: Math.max(reference.page - 1, 0)
  };
}
