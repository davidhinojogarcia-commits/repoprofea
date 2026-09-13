import { supabase } from '../../lib/supabase';
import { writeAuditLog } from '../../services/auditService';
import type { SaeCandidate, SaeDraft, SaeNeed, SaeReport } from './types';

const requireUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error || new Error('Debes iniciar sesión.');
  return data.user;
};

const needFromRow = (row: any, categories: any[]): SaeNeed => ({
  id: row.id,
  workName: row.work_name,
  workCode: row.work_code || '',
  month: row.hiring_month,
  year: row.hiring_year,
  totalRequested: row.total_requested,
  status: row.status,
  notes: row.notes || '',
  sourceFileName: row.source_file_name || '',
  sourceStoragePath: row.source_storage_path || '',
  extractionEvidence: row.extraction_evidence || [],
  categories: categories.filter(category => category.need_id === row.id).map(category => ({
    id: category.id,
    needId: category.need_id,
    category: category.category,
    categoryCode: category.category_code || '',
    requestedCount: category.requested_count,
  })),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const candidateFromRow = (row: any): SaeCandidate => ({
  id: row.id, needId: row.need_id, sourceReportId: row.source_report_id,
  originalFullName: row.original_full_name, normalizedFullName: row.normalized_full_name,
  firstName: row.first_name || '', surnames: row.surnames || '', dniNie: row.dni_nie || '',
  category: row.category || '', categoryCode: row.category_code || '', offerNumber: row.offer_number || '',
  workName: row.work_name || '', workCode: row.work_code || '', month: row.hiring_month || undefined,
  fortnight: row.fortnight || null, expectedHireDate: row.expected_hire_date || '', saeIdentifier: row.sae_identifier || '',
  sourcePage: row.source_page, sourceRowText: row.source_row_text, sourcePosition: row.source_position,
  confidence: row.confidence, evidence: row.evidence || [], status: row.status,
  selectedForHire: Boolean(row.selected_for_hire), existingWorkerId: row.existing_worker_id,
  existingWorkerOwnerId: row.existing_worker_owner_id,
  resultCode: row.result_code || '', resultLabel: row.result_label || null,
  alignmentOffsetX: row.alignment_offset_x || 0, alignmentOffsetY: row.alignment_offset_y || 0,
});

export async function listSaeNeeds(): Promise<SaeNeed[]> {
  const [needs, categories, candidates] = await Promise.all([
    supabase.query('sae_needs', { query: 'select=*&order=updated_at.desc' }),
    supabase.query('sae_need_categories', { query: 'select=*&order=category.asc' }),
    supabase.query('sae_candidates', { query: 'select=need_id,status,fortnight,selected_for_hire' }),
  ]);
  return (needs || []).map((row: any) => {
    const need = needFromRow(row, categories || []);
    const related = (candidates || []).filter((candidate: any) => candidate.need_id === row.id);
    const hiredCount = related.filter((candidate: any) => candidate.status === 'contratado').length;
    return {
      ...need,
      candidateCount: related.length,
      assignedCount: related.filter((candidate: any) => candidate.fortnight === 1 || candidate.fortnight === 2).length,
      hiredCount,
      pendingCount: Math.max(need.totalRequested - hiredCount, 0),
    };
  });
}

export async function saveSaeNeed(need: SaeNeed, sourceFile?: File): Promise<SaeNeed> {
  const user = await requireUser();
  let sourceStoragePath = need.sourceStoragePath || null;
  if (sourceFile) sourceStoragePath = await uploadSaeFile(sourceFile, `needs/${need.id}`);
  await supabase.query('sae_needs', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      id: need.id, owner_id: user.id, work_name: need.workName.trim(), work_code: need.workCode?.trim() || null,
      hiring_month: need.month, hiring_year: need.year,
      total_requested: need.categories.reduce((sum, item) => sum + Number(item.requestedCount || 0), 0),
      status: need.status, notes: need.notes || null, source_file_name: sourceFile?.name || need.sourceFileName || null,
      source_storage_path: sourceStoragePath, extraction_evidence: need.extractionEvidence || [],
      created_by: user.id, updated_by: user.id,
    },
  });
  await supabase.query('sae_need_categories', { method: 'DELETE', prefer: 'return=minimal', query: `need_id=eq.${encodeURIComponent(need.id)}` });
  if (need.categories.length) {
    await supabase.query('sae_need_categories', {
      method: 'POST', prefer: 'return=minimal',
      body: need.categories.map(item => ({
        id: item.id || crypto.randomUUID(), need_id: need.id, category: item.category.trim(),
        category_code: item.categoryCode?.trim() || null, requested_count: Number(item.requestedCount || 0),
        created_by: user.id,
      })),
    });
  }
  await writeAuditLog('CREATE', 'sae_needs', need.id, { workName: need.workName, totalRequested: need.totalRequested });
  return { ...need, sourceStoragePath: sourceStoragePath || undefined };
}

export async function updateSaeNeedStatus(id: string, status: SaeNeed['status']) {
  const user = await requireUser();
  await supabase.query('sae_needs', { method: 'PATCH', prefer: 'return=minimal', query: `id=eq.${encodeURIComponent(id)}`, body: { status, updated_by: user.id } });
  await writeAuditLog('UPDATE', 'sae_needs', id, { status });
}

export async function uploadSaeFile(file: File, folder: string): Promise<string> {
  const user = await requireUser();
  const cleanName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `${user.id}/${folder}/${Date.now()}-${cleanName}`;
  const lowerName = file.name.toLowerCase();
  const contentType = file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg');
  const { error } = await supabase.storage.from('sae-documents').upload(path, file, { cacheControl: '3600', upsert: false, contentType });
  if (error) throw error;
  return path;
}

export async function downloadSaeFile(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from('sae-documents').download(path);
  if (error || !data) throw error || new Error('No se pudo recuperar el documento original.');
  return data;
}

export async function saveSaeReport(report: SaeReport, file: File, candidates: SaeCandidate[]): Promise<SaeReport> {
  const user = await requireUser();
  const storagePath = await uploadSaeFile(file, `reports/${report.needId}/${report.id}`);
  await supabase.query('sae_reports', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      id: report.id, need_id: report.needId, owner_id: user.id, file_name: report.fileName,
      mime_type: report.mimeType, storage_path: storagePath, page_count: report.pageCount,
      extraction_method: report.extractionMethod, processing_status: report.processingStatus,
      raw_text: report.rawText, detected_legend: report.detectedLegend || {}, created_by: user.id, updated_by: user.id,
    },
  });
  if (candidates.length) {
    await supabase.query('sae_candidates', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: candidates.map(candidate => ({
        id: candidate.id, need_id: candidate.needId, source_report_id: candidate.sourceReportId,
        owner_id: user.id, original_full_name: candidate.originalFullName,
        normalized_full_name: candidate.normalizedFullName, first_name: candidate.firstName || null,
        surnames: candidate.surnames || null, dni_nie: candidate.dniNie || null,
        category: candidate.category || null, category_code: candidate.categoryCode || null,
        offer_number: candidate.offerNumber || null, work_name: candidate.workName || null,
        work_code: candidate.workCode || null, hiring_month: candidate.month || null,
        fortnight: candidate.fortnight || null, expected_hire_date: candidate.expectedHireDate || null,
        sae_identifier: candidate.saeIdentifier || null, source_page: candidate.sourcePage,
        source_row_text: candidate.sourceRowText, source_position: candidate.sourcePosition,
        confidence: candidate.confidence, evidence: candidate.evidence || [], status: candidate.status,
        selected_for_hire: candidate.selectedForHire, created_by: user.id, updated_by: user.id,
      })),
    });
  }
  await updateSaeNeedStatus(report.needId, 'candidatos_recibidos');
  await writeAuditLog('CREATE', 'sae_reports', report.id, { needId: report.needId, fileName: report.fileName, candidates: candidates.length });
  return { ...report, storagePath };
}

export async function listSaeReports(needId: string): Promise<SaeReport[]> {
  const rows = await supabase.query('sae_reports', { query: `select=*&need_id=eq.${encodeURIComponent(needId)}&order=created_at.asc` });
  return (rows || []).map((row: any) => ({
    id: row.id, needId: row.need_id, fileName: row.file_name, mimeType: row.mime_type,
    storagePath: row.storage_path, pageCount: row.page_count, extractionMethod: row.extraction_method,
    processingStatus: row.processing_status, rawText: row.raw_text || '', detectedLegend: row.detected_legend || {}, createdAt: row.created_at,
  }));
}

export async function listSaeCandidates(needId: string): Promise<SaeCandidate[]> {
  const rows = await supabase.query('sae_candidates', { query: `select=*&need_id=eq.${encodeURIComponent(needId)}&order=source_report_id.asc,source_page.asc,created_at.asc` });
  return (rows || []).map(candidateFromRow);
}

export async function updateSaeCandidate(candidate: SaeCandidate) {
  const user = await requireUser();
  await supabase.query('sae_candidates', {
    method: 'PATCH', prefer: 'return=minimal', query: `id=eq.${encodeURIComponent(candidate.id)}`,
    body: {
      original_full_name: candidate.originalFullName, normalized_full_name: candidate.normalizedFullName,
      first_name: candidate.firstName || null, surnames: candidate.surnames || null, dni_nie: candidate.dniNie || null,
      category: candidate.category || null, category_code: candidate.categoryCode || null,
      offer_number: candidate.offerNumber || null, work_name: candidate.workName || null, work_code: candidate.workCode || null,
      hiring_month: candidate.month || null, fortnight: candidate.fortnight || null,
      expected_hire_date: candidate.expectedHireDate || null, sae_identifier: candidate.saeIdentifier || null,
      confidence: candidate.confidence, evidence: candidate.evidence || [], status: candidate.status,
      selected_for_hire: candidate.selectedForHire, existing_worker_owner_id: candidate.existingWorkerOwnerId || null, existing_worker_id: candidate.existingWorkerId || null,
      result_code: candidate.resultCode || null, result_label: candidate.resultLabel || null,
      alignment_offset_x: candidate.alignmentOffsetX || 0, alignment_offset_y: candidate.alignmentOffsetY || 0,
      updated_by: user.id,
    },
  });
  await writeAuditLog('UPDATE', 'sae_candidates', candidate.id, { status: candidate.status, fortnight: candidate.fortnight, result: candidate.resultLabel });
}

export async function assignSaeCandidate(candidate: SaeCandidate, hiringYear: number) {
  const user = await requireUser();
  await updateSaeCandidate(candidate);
  await supabase.query('sae_candidate_allocations', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    query: 'on_conflict=candidate_id',
    body: {
      id: candidate.id, candidate_id: candidate.id, need_id: candidate.needId,
      hiring_year: hiringYear, hiring_month: candidate.month,
      fortnight: candidate.fortnight || null, assigned_by: user.id, assigned_at: new Date().toISOString(),
    },
  });
}

export async function saveSaeDraft(draft: SaeDraft) {
  const user = await requireUser();
  await supabase.query('sae_registration_drafts', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      id: draft.id, need_id: draft.needId, candidate_id: draft.candidateId, owner_id: user.id,
      existing_worker_owner_id: draft.existingWorkerOwnerId || null, existing_worker_id: draft.existingWorkerId || null, status: draft.status, data: draft.data,
      created_by: user.id, updated_by: user.id,
    },
  });
  await writeAuditLog('CREATE', 'sae_registration_drafts', draft.id, { candidateId: draft.candidateId, status: draft.status });
}

export async function listSaeDrafts(needId: string): Promise<SaeDraft[]> {
  const rows = await supabase.query('sae_registration_drafts', { query: `select=*&need_id=eq.${encodeURIComponent(needId)}&order=created_at.asc` });
  return (rows || []).map((row: any) => ({
    id: row.id, needId: row.need_id, candidateId: row.candidate_id,
    existingWorkerId: row.existing_worker_id, existingWorkerOwnerId: row.existing_worker_owner_id, status: row.status, data: row.data || {},
  }));
}

export async function listSaeResultCodes(): Promise<Record<string, string>> {
  const rows = await supabase.query('sae_result_codes', { query: 'select=result_key,code&active=eq.true&order=result_key.asc' });
  const result = Object.fromEntries((rows || []).map((row: any) => [row.result_key, row.code]));
  return Object.keys(result).length ? result : { contratado: '2100' };
}

export async function saveSaeResultCode(resultKey: string, code: string) {
  const user = await requireUser();
  await supabase.query('sae_result_codes', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { result_key: resultKey, code, label: resultKey === 'contratado' ? 'Contratado' : resultKey, active: true, updated_by: user.id },
  });
  await writeAuditLog('UPDATE', 'sae_result_codes', resultKey, { code });
}

export async function recordGeneratedDocument(needId: string, reportId: string, fileName: string, storagePath?: string) {
  const user = await requireUser();
  const id = crypto.randomUUID();
  await supabase.query('sae_generated_documents', {
    method: 'POST', prefer: 'return=minimal',
    body: { id, need_id: needId, source_report_id: reportId, owner_id: user.id, file_name: fileName, storage_path: storagePath || null, created_by: user.id },
  });
  await writeAuditLog('CREATE', 'sae_generated_documents', id, { needId, reportId, fileName });
}
