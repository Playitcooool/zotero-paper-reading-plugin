import { SECTION_ORDER, type AnalysisMeta, type AnalysisResult, type AnalysisSection, type EvidenceReference, type SectionId } from "./types.ts";

const HEADING_TO_ID: Record<string, SectionId> = {
  thesis: "thesis",
  "core method/mechanism": "core-method",
  "reusable ideas": "reusable-ideas",
  "implementation transfer": "implementation-transfer",
  "related-work positioning": "related-work",
  "evidence references": "evidence",
  "open questions": "open-questions",
  "follow-up experiments/build directions": "follow-up"
};

export function normalizeAnalysisPayload(
  payload: { content: string | Record<string, unknown>; meta?: Partial<AnalysisMeta> }
): AnalysisResult {
  const meta: AnalysisMeta = {
    title: payload.meta?.title || "",
    authors: payload.meta?.authors || [],
    year: payload.meta?.year || "",
    backendLabel: payload.meta?.backendLabel || "",
    model: payload.meta?.model || "",
    generatedAt: payload.meta?.generatedAt || new Date().toISOString()
  };

  if (typeof payload.content !== "string") {
    return normalizeObjectPayload(payload.content, meta);
  }

  const rawText = payload.content.trim();
  const sectionsById = new Map<SectionId, string>();
  const headingRegex = /^#{1,6}\s+(.+?)\s*$/gm;
  const matches = Array.from(rawText.matchAll(headingRegex));

  if (!matches.length) {
    return {
      sections: SECTION_ORDER.map((sectionId) => ({ id: sectionId, content: rawText })),
      references: extractReferences(rawText),
      meta,
      rawText
    };
  }

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const title = current[1].trim().toLowerCase();
    const sectionId = HEADING_TO_ID[title];
    if (!sectionId) {
      continue;
    }

    const contentStart = current.index! + current[0].length;
    const contentEnd = next?.index ?? rawText.length;
    sectionsById.set(sectionId, rawText.slice(contentStart, contentEnd).trim());
  }

  const sections: AnalysisSection[] = SECTION_ORDER.map((sectionId) => ({
    id: sectionId,
    content: sectionsById.get(sectionId) || ""
  }));
  const evidenceText = sectionsById.get("evidence") || rawText;

  return {
    sections,
    references: extractReferences(evidenceText),
    meta,
    rawText
  };
}

function normalizeObjectPayload(payload: Record<string, unknown>, meta: AnalysisMeta): AnalysisResult {
  const sectionMap = new Map<SectionId, string>();
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  for (const section of sections) {
    if (!section || typeof section !== "object") {
      continue;
    }

    const id = typeof section.id === "string" ? section.id as SectionId : undefined;
    const content = typeof section.content === "string" ? section.content.trim() : "";
    if (id && content) {
      sectionMap.set(id, content);
    }
  }

  const references = Array.isArray(payload.references)
    ? payload.references.flatMap((reference) => normalizeReference(reference))
    : [];

  return {
    sections: SECTION_ORDER.map((section) => ({
      id: section,
      content: sectionMap.get(section) || ""
    })),
    references,
    meta,
    rawText: JSON.stringify(payload)
  };
}

function normalizeReference(reference: unknown): EvidenceReference[] {
  if (!reference || typeof reference !== "object") {
    return [];
  }

  const ref = reference as Partial<EvidenceReference>;
  if (!ref.kind || !ref.label || typeof ref.page !== "number") {
    return [];
  }

  return [{
    kind: ref.kind,
    label: ref.label,
    page: ref.page,
    anchorText: ref.anchorText
  }];
}

function extractReferences(text: string): EvidenceReference[] {
  const references: EvidenceReference[] = [];
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const content = line.replace(/^[-*]\s*/, "");
    let match = content.match(/^(Figure\s+\d+)\s*\(p\.(\d+)\)\s*:?\s*(.*)$/i);
    if (match) {
      references.push({
        kind: "figure",
        label: match[1],
        page: Number(match[2]),
        anchorText: match[3] || undefined
      });
      continue;
    }

    match = content.match(/^(Table\s+\d+)\s*\(p\.(\d+)\)\s*:?\s*(.*)$/i);
    if (match) {
      references.push({
        kind: "table",
        label: match[1],
        page: Number(match[2]),
        anchorText: match[3] || undefined
      });
      continue;
    }

    match = content.match(/^(p\.(\d+))\s*:?\s*(.*)$/i);
    if (match) {
      references.push({
        kind: "page",
        label: match[1],
        page: Number(match[2]),
        anchorText: match[3] || undefined
      });
    }
  }

  return references;
}
