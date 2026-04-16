export type SectionId =
  | "thesis"
  | "core-method"
  | "reusable-ideas"
  | "implementation-transfer"
  | "related-work"
  | "evidence"
  | "open-questions"
  | "follow-up";

export interface AnalysisSection {
  id: SectionId;
  content: string;
}

export type ReferenceKind = "figure" | "table" | "page";

export interface EvidenceReference {
  kind: ReferenceKind;
  label: string;
  page: number;
  anchorText?: string;
}

export interface AnalysisMeta {
  title: string;
  authors: string[];
  year: string;
  backendLabel: string;
  model: string;
  generatedAt: string;
}

export interface AnalysisResult {
  sections: AnalysisSection[];
  references: EvidenceReference[];
  meta: AnalysisMeta;
  rawText: string;
}

export interface ChatSessionPaperMeta {
  itemID: number;
  title: string;
  authors: string[];
  year: string;
}

export interface CitationRef extends EvidenceReference {
  sourceToken: string;
}

export type ChatMessageRole = "system" | "user" | "assistant";
export type ChatMessageStatus = "pending" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  markdown: string;
  createdAt: string;
  citations: CitationRef[];
  status?: ChatMessageStatus;
}

export interface ChatSession {
  paper: ChatSessionPaperMeta;
  backendLabel: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface PaperContext {
  itemID: number;
  title: string;
  authors: string[];
  year: string;
  abstractText?: string;
  attachmentText: string;
}

export interface AnalysisRequest {
  paper: PaperContext;
  prompt: string;
}

export interface BackendResponse {
  content: string | Record<string, unknown>;
  backendLabel: string;
  model: string;
}

export interface LLMMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ChatRequest {
  paper: PaperContext;
  messages: LLMMessage[];
  mode: "initial" | "followup";
  locale: string;
}

export interface ChatResponse {
  markdown: string;
  backendLabel: string;
  model: string;
}

export interface AnalysisBackend {
  kind: "direct" | "companion";
  label: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface PanelSessionState {
  itemID: number;
  startedAt: string;
  status: "idle" | "loading" | "success" | "error";
}

export interface PersistenceRecord {
  attachmentItemID: number;
  noteItemID: number;
  updatedAt: string;
  backendLabel: string;
}

export const SECTION_ORDER: SectionId[] = [
  "thesis",
  "core-method",
  "reusable-ideas",
  "implementation-transfer",
  "related-work",
  "evidence",
  "open-questions",
  "follow-up"
];
