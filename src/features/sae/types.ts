export type SaeConfidence = 'alta' | 'media' | 'baja';
export type SaeNeedStatus =
  | 'pendiente_candidatos_sae'
  | 'candidatos_recibidos'
  | 'en_distribucion'
  | 'en_contratacion'
  | 'finalizada';
export type SaeCandidateStatus =
  | 'sin_asignar'
  | 'preseleccionado'
  | 'primera_quincena'
  | 'segunda_quincena'
  | 'contratado'
  | 'no_contratado'
  | 'pendiente_datos';

export interface SaeEvidence {
  field: string;
  value: string;
  page: number;
  text: string;
  confidence: SaeConfidence;
}

export interface SaeNeedCategory {
  id?: string;
  needId?: string;
  category: string;
  categoryCode?: string;
  requestedCount: number;
}

export interface SaeNeed {
  id: string;
  workName: string;
  workCode?: string;
  month: number;
  year: number;
  totalRequested: number;
  status: SaeNeedStatus;
  notes?: string;
  sourceFileName?: string;
  sourceStoragePath?: string;
  extractionEvidence?: SaeEvidence[];
  categories: SaeNeedCategory[];
  candidateCount?: number;
  assignedCount?: number;
  hiredCount?: number;
  pendingCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaeSourcePosition {
  page: number;
  rowIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  resultX: number;
}

export interface SaeCandidate {
  id: string;
  needId: string;
  sourceReportId: string;
  originalFullName: string;
  normalizedFullName: string;
  firstName?: string;
  surnames?: string;
  dniNie?: string;
  category: string;
  categoryCode?: string;
  offerNumber?: string;
  workName?: string;
  workCode?: string;
  month?: number;
  fortnight?: 1 | 2 | null;
  expectedHireDate?: string;
  saeIdentifier?: string;
  sourcePage: number;
  sourceRowText: string;
  sourcePosition: SaeSourcePosition;
  confidence: SaeConfidence;
  evidence: SaeEvidence[];
  status: SaeCandidateStatus;
  selectedForHire: boolean;
  existingWorkerId?: number | null;
  existingWorkerOwnerId?: string | null;
  resultCode?: string;
  resultLabel?: 'contratado' | 'no_contratado' | null;
  alignmentOffsetX?: number;
  alignmentOffsetY?: number;
}

export interface SaeReport {
  id: string;
  needId: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
  pageCount: number;
  extractionMethod: 'native' | 'ocr' | 'hybrid';
  processingStatus: 'processing' | 'review' | 'confirmed' | 'error';
  rawText: string;
  detectedLegend: Record<string, string>;
  createdAt?: string;
}

export interface SaeDraft {
  id: string;
  needId: string;
  candidateId: string;
  existingWorkerId?: number | null;
  existingWorkerOwnerId?: string | null;
  status: 'borrador_sae' | 'enlazado' | 'contratado';
  data: Record<string, unknown>;
}

export interface SaeTextRow {
  page: number;
  rowIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export interface SaeDocumentExtraction {
  file: File;
  method: 'native' | 'ocr' | 'hybrid';
  rows: SaeTextRow[];
  fullText: string;
  pageCount: number;
  pageImages?: Array<{ page: number; dataUrl: string; width: number; height: number }>;
}
