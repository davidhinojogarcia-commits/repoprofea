export type MandatoryLifecycleStatus =
  | 'IMPORTED'
  | 'ANALYZED'
  | 'NEEDS_WORKSITE_REVIEW'
  | 'NEEDS_WORKER_REVIEW'
  | 'NEEDS_SIGNATURE_POSITION_REVIEW'
  | 'READY'
  | 'ASSIGNED'
  | 'IN_SIGNATURE'
  | 'SUBMITTED'
  | 'RECEIVED'
  | 'REVIEWED'
  | 'RETURNED_FOR_CORRECTION'
  | 'PDF_VALIDATION_ERROR'
  | 'ARCHIVED';

export type DetectionStatus = 'DETECTED' | 'CONFIRMED' | 'REJECTED';
export type PositionStatus = 'PENDING' | 'RESOLVED' | 'REJECTED';
export type PositionSource = 'AUTO' | 'MANUAL';

export type PdfBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MandatoryDocumentWorkerV2 = {
  id: string;
  documentId: string;
  legacyWorkerId?: number | null;
  printedName: string;
  directoryWorkerId?: number | null;
  page?: number | null;
  rowIndex?: number | null;
  detectionStatus: DetectionStatus;
  detectionConfidence?: number | null;
  positionStatus: PositionStatus;
  positionSource?: PositionSource;
  nameBox?: PdfBox | null;
  signatureBox?: PdfBox | null;
  frozenAt?: string | null;
};

const finitePositive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

export const isValidPdfBox = (box: PdfBox | null | undefined) => Boolean(
  box &&
  Number.isFinite(box.x) &&
  Number.isFinite(box.y) &&
  finitePositive(box.width) &&
  finitePositive(box.height) &&
  box.x >= 0 &&
  box.y >= 0,
);

export const canFreezeMandatoryWorker = (worker: MandatoryDocumentWorkerV2) => {
  if (worker.detectionStatus !== 'CONFIRMED') return false;
  return worker.positionStatus === 'RESOLVED'
    && isValidPdfBox(worker.signatureBox)
    && (worker.positionSource === 'MANUAL' || isValidPdfBox(worker.nameBox));
};

export const resolveMandatoryLifecycleBeforeAssignment = (
  workers: MandatoryDocumentWorkerV2[],
  hasResolvedWorksite: boolean,
): MandatoryLifecycleStatus => {
  if (!hasResolvedWorksite) return 'NEEDS_WORKSITE_REVIEW';
  if (!workers.length || workers.some(worker => worker.detectionStatus === 'DETECTED')) {
    return 'NEEDS_WORKER_REVIEW';
  }
  const confirmed = workers.filter(worker => worker.detectionStatus === 'CONFIRMED');
  if (!confirmed.length) return 'NEEDS_WORKER_REVIEW';
  if (confirmed.some(worker => !canFreezeMandatoryWorker(worker))) {
    return 'NEEDS_SIGNATURE_POSITION_REVIEW';
  }
  return 'READY';
};

export const assertFrozenMandatoryWorkers = (workers: MandatoryDocumentWorkerV2[]) => {
  const detected = workers.filter(worker => worker.detectionStatus === 'DETECTED');
  if (detected.length) {
    throw new Error(`No se puede congelar el documento: ${detected.length} detección(es) siguen pendientes de revisión.`);
  }
  const confirmed = workers.filter(worker => worker.detectionStatus === 'CONFIRMED');
  if (!confirmed.length) {
    throw new Error('No se puede asignar un documento sin personas confirmadas.');
  }
  const unresolved = confirmed.filter(worker => !canFreezeMandatoryWorker(worker));
  if (unresolved.length) {
    throw new Error(`No se puede congelar el documento: ${unresolved.length} persona(s) confirmada(s) siguen sin posición válida.`);
  }
};

export const assertSignatureBelongsToFrozenWorker = (worker: MandatoryDocumentWorkerV2) => {
  if (worker.detectionStatus !== 'CONFIRMED') throw new Error('La persona no está confirmada para este documento.');
  if (!worker.frozenAt) throw new Error('La posición de firma no está congelada.');
  if (!canFreezeMandatoryWorker(worker)) throw new Error('La posición de firma no es válida.');
};
