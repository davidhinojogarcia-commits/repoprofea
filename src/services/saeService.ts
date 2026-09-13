import { supabase } from '../lib/supabase';

export type SaeNeed = {
  id: string;
  ownerId?: string;
  obra: string;
  codigoObra: string;
  mes: string;
  ano: number | null;
  estado: string;
  categorias: { id: string; categoria: string; cantidad: number }[];
  createdAt?: string;
};

export type SaeReport = {
  id: string;
  needId: string;
  fileName: string;
  fileBase64: string;
  extractedText: string;
  extractionSource: string;
  offerNumber: string;
  obra: string;
  codigoObra: string;
  mes: string;
  quincena: string;
  categoria: string;
  createdAt?: string;
};

export type SaeCandidate = {
  id: string;
  needId: string;
  reportId: string;
  orderNumber: number;
  fullNameOriginal: string;
  normalizedName: string;
  apellidos: string;
  nombre: string;
  categoria: string;
  obra: string;
  codigoObra: string;
  offerNumber: string;
  mes: string;
  quincena: string;
  estado: string;
  resultCode: string;
  linkedWorkerId?: number | null;
  pageNumber: number;
  overlayX: number;
  overlayY: number;
  confidence: string;
};

const uid = async () => {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debe iniciar sesión.');
  return data.user.id;
};

const newid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export async function listSaeNeeds(): Promise<SaeNeed[]> {
  await uid();
  const needs = await supabase.query('sae_needs', { query: 'select=*&order=created_at.desc' });
  const categories = await supabase.query('sae_need_categories', { query: 'select=*&order=created_at.asc' });
  return (needs || []).map((row: any) => ({
    id: row.id, ownerId: row.owner_id, obra: row.obra || '', codigoObra: row.codigo_obra || '', mes: row.mes || '',
    ano: row.ano ?? null, estado: row.estado || 'Pendiente de candidatos SAE', createdAt: row.created_at,
    categorias: (categories || []).filter((c: any) => c.need_id === row.id).map((c: any) => ({ id: c.id, categoria: c.categoria, cantidad: Number(c.cantidad || 0) })),
  }));
}

export async function createSaeNeed(input: Omit<SaeNeed, 'id' | 'ownerId' | 'createdAt'>): Promise<SaeNeed> {
  const ownerId = await uid();
  const id = newid('need');
  await supabase.query('sae_needs', { method: 'POST', prefer: 'return=minimal', body: {
    id, owner_id: ownerId, obra: input.obra, codigo_obra: input.codigoObra, mes: input.mes, ano: input.ano, estado: input.estado,
  }});
  for (const category of input.categorias) {
    await supabase.query('sae_need_categories', { method: 'POST', prefer: 'return=minimal', body: {
      id: newid('needcat'), need_id: id, owner_id: ownerId, categoria: category.categoria, cantidad: category.cantidad,
    }});
  }
  return { ...input, id, ownerId };
}

export async function listSaeReports(needId?: string): Promise<SaeReport[]> {
  await uid();
  const query = `select=*${needId ? `&need_id=eq.${encodeURIComponent(needId)}` : ''}&order=created_at.desc`;
  const rows = await supabase.query('sae_reports', { query });
  return (rows || []).map((r: any) => ({
    id: r.id, needId: r.need_id, fileName: r.file_name || '', fileBase64: r.file_base64 || '', extractedText: r.extracted_text || '',
    extractionSource: r.extraction_source || '', offerNumber: r.offer_number || '', obra: r.obra || '', codigoObra: r.codigo_obra || '',
    mes: r.mes || '', quincena: r.quincena || '', categoria: r.categoria || '', createdAt: r.created_at,
  }));
}

export async function createSaeReport(needId: string, report: Omit<SaeReport, 'id' | 'needId' | 'createdAt'>, candidates: Omit<SaeCandidate, 'id' | 'needId' | 'reportId'>[]) {
  const ownerId = await uid();
  const id = newid('report');
  await supabase.query('sae_reports', { method: 'POST', prefer: 'return=minimal', body: {
    id, need_id: needId, owner_id: ownerId, file_name: report.fileName, file_base64: report.fileBase64,
    extracted_text: report.extractedText, extraction_source: report.extractionSource, offer_number: report.offerNumber,
    obra: report.obra, codigo_obra: report.codigoObra, mes: report.mes, quincena: report.quincena, categoria: report.categoria,
  }});
  for (const c of candidates) {
    await supabase.query('sae_candidates', { method: 'POST', prefer: 'return=minimal', body: {
      id: newid('cand'), need_id: needId, report_id: id, owner_id: ownerId, order_number: c.orderNumber,
      full_name_original: c.fullNameOriginal, normalized_name: c.normalizedName, apellidos: c.apellidos, nombre: c.nombre,
      categoria: c.categoria, obra: c.obra, codigo_obra: c.codigoObra, offer_number: c.offerNumber, mes: c.mes,
      quincena: c.quincena, estado: c.estado, result_code: c.resultCode || '', linked_worker_id: c.linkedWorkerId || null,
      page_number: c.pageNumber, overlay_x: c.overlayX, overlay_y: c.overlayY, confidence: c.confidence,
    }});
  }
  return id;
}

export async function listSaeCandidates(needId?: string): Promise<SaeCandidate[]> {
  await uid();
  const query = `select=*${needId ? `&need_id=eq.${encodeURIComponent(needId)}` : ''}&order=order_number.asc`;
  const rows = await supabase.query('sae_candidates', { query });
  return (rows || []).map((r: any) => ({
    id: r.id, needId: r.need_id, reportId: r.report_id, orderNumber: Number(r.order_number || 0), fullNameOriginal: r.full_name_original || '',
    normalizedName: r.normalized_name || '', apellidos: r.apellidos || '', nombre: r.nombre || '', categoria: r.categoria || '', obra: r.obra || '',
    codigoObra: r.codigo_obra || '', offerNumber: r.offer_number || '', mes: r.mes || '', quincena: r.quincena || '', estado: r.estado || 'Sin asignar',
    resultCode: r.result_code || '', linkedWorkerId: r.linked_worker_id || null, pageNumber: Number(r.page_number || 2),
    overlayX: Number(r.overlay_x || 184), overlayY: Number(r.overlay_y || 50), confidence: r.confidence || 'Media',
  }));
}

export async function updateSaeCandidate(id: string, patch: Partial<SaeCandidate>) {
  await uid();
  const body: any = {};
  const map: Record<string,string> = {
    normalizedName:'normalized_name', apellidos:'apellidos', nombre:'nombre', categoria:'categoria', obra:'obra', codigoObra:'codigo_obra',
    offerNumber:'offer_number', mes:'mes', quincena:'quincena', estado:'estado', resultCode:'result_code', linkedWorkerId:'linked_worker_id',
    pageNumber:'page_number', overlayX:'overlay_x', overlayY:'overlay_y', confidence:'confidence', fullNameOriginal:'full_name_original', orderNumber:'order_number'
  };
  Object.entries(patch).forEach(([k,v]) => { if (map[k]) body[map[k]] = v; });
  if (!Object.keys(body).length) return;
  await supabase.query('sae_candidates', { method: 'PATCH', prefer: 'return=minimal', query: `id=eq.${encodeURIComponent(id)}`, body });
}

export const SAE_RESULT_CODES = [
  ['2000','Admitido'], ['2001','Contratará al candidato'], ['2100','Rechazo voluntario'], ['2101','No se ha presentado'],
  ['2103','Ha dejado el proceso de selección'], ['2107','No aceptó las condiciones del puesto'], ['2200','No cumple los requisitos'],
  ['2210','No corresponde al perfil por otros motivos'], ['2212','Otros motivos'], ['2500','Ya estaba ocupado el puesto de trabajo'],
] as const;
