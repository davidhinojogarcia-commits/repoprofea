import { offlineDocuments } from './foremanOfflineService';
import type { Person } from '../../types';
import { supabase } from '../lib/supabase';
import { addMissingMandatoryDocumentWorkerV2, initializeMandatoryTraceabilityV2, reviewMandatoryDocumentWorkerV2, updateMandatoryDocumentWorkerGeometryV2, type MandatoryV2WorkerInput } from './mandatoryTraceabilityServiceV2';

const FOREMAN_REQUEST_TIMEOUT_MS = 15000;

const withForemanTimeout = async <T>(promise: Promise<T>, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), FOREMAN_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const compactAttendanceRows = (rows: ForemanAttendanceRow[]) =>
  rows.map(row => {
    const next: Record<string, unknown> = {
      workerId: row.workerId,
      name: row.name,
      dni: row.dni,
      category: row.category,
      entryTime: row.entryTime || '',
      exitTime: row.exitTime || '',
      periodoInicio: row.periodoInicio || '',
      periodoFin: row.periodoFin || '',
      numOferta: row.numOferta || '',
      municipio: row.municipio || '',
      empresa: row.empresa || '',
      codigoObra: row.codigoObra || '',
    };
    if (row.entrySignature === '') next.entrySignature = '';
    else if (row.entrySignature) next.entrySignature = 'signed';
    if (row.exitSignature === '') next.exitSignature = '';
    else if (row.exitSignature) next.exitSignature = 'signed';
    return next;
  });

export type ForemanAttendanceRow = {
  workerId: number;
  name: string;
  dni: string;
  category: string;
  entryTime?: string;
  entrySignature?: string;
  exitTime?: string;
  exitSignature?: string;
  periodoInicio?: string;
  periodoFin?: string;
  numOferta?: string;
  municipio?: string;
  empresa?: string;
  codigoObra?: string;
};

export type ForemanAttendanceDay = {
  id?: string;
  workDate: string;
  foremanSignature?: string;
  foremanTemplate?: import('../lib/foremanSignatureTemplate').ForemanSignatureTemplate;
  rows: ForemanAttendanceRow[];
  status: 'draft' | 'completed' | 'reviewed';
  completedAt?: string | null;
  updatedAt?: string | null;
  correctionPending?: boolean;
  correctionReason?: string | null;
  correctionRequestedAt?: string | null;
};

export type ForemanMandatoryDocument = {
  id: string;
  workDate: string;
  periodKey: string;
  documentType: 'inicio' | 'control_presencia' | 'contrato' | 'prorroga' | 'epis' | 'formacion' | 'maquinaria' | 'autorizacion_uso_maquinaria';
  category: string;
  workers: Person[];
  signatures: Record<string, { signature: string; signedAt?: string } | string>;
  status: 'pending' | 'in_progress' | 'returned' | 'completed' | 'reviewed';
  completedAt?: string | null;
  lifecycleStatus?: string | null;
  assignedAt?: string | null;
  details?: Record<string, any>;
  correctionPending?: boolean;
  correctionReason?: string | null;
  correctionRequestedAt?: string | null;
};

export type ForemanCompletedDocument = {
  id: string;
  workDate: string;
  documentType: string;
  workerId?: number | null;
  workerSnapshot: Partial<Person>;
  answers: Record<string, string>;
  signatures: Record<string, string>;
  status: 'draft' | 'completed' | 'reviewed';
  completedAt?: string | null;
  correctionPending?: boolean;
  correctionReason?: string | null;
  correctionRequestedAt?: string | null;
};

export type ForemanPortalPayload = {
  valid: boolean;
  obra: string;
  foremanName: string;
  defaultWorkStartHour: string;
  defaultWorkEndHour: string;
  worksite: {
    codigo: string;
    nombre: string;
    municipio: string;
    empresa: string;
    cif: string;
    recursoPreventivo: string;
  };
  workers: Person[];
  attendance: ForemanAttendanceDay[];
  documents: ForemanCompletedDocument[];
  mandatoryDocuments: ForemanMandatoryDocument[];
};

export type ForemanPortalAccessStatus = {
  exists: boolean;
  active: boolean;
  foremanName: string;
  lastUsedAt?: string | null;
  updatedAt?: string | null;
};

export async function getForemanPortalAccessStatus(obra: string): Promise<ForemanPortalAccessStatus> {
  const rows = await supabase.query('foreman_portal_access', {
    query: `obra=eq.${encodeURIComponent(obra)}&select=active,foreman_name,last_used_at,updated_at&limit=1`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    exists: Boolean(row),
    active: Boolean(row?.active),
    foremanName: String(row?.foreman_name || ''),
    lastUsedAt: row?.last_used_at || null,
    updatedAt: row?.updated_at || null,
  };
}

export async function createForemanPortalAccess(obra: string, foremanName: string): Promise<string> {
  const token = await supabase.rpc('ensure_foreman_portal_access', {
    p_obra: obra,
    p_foreman_name: foremanName,
  });
  const value = String(token || '').trim();
  if (!value) throw new Error('No se pudo generar el acceso móvil del encargado.');
  return value;
}

export async function revokeForemanPortalAccess(obra: string): Promise<void> {
  await supabase.rpc('revoke_foreman_portal_access', { p_obra: obra });
}

export async function resolveForemanPortal(token: string): Promise<ForemanPortalPayload> {
  const result = await withForemanTimeout(
    supabase.rpc('resolve_foreman_portal', { p_token: token }, { fresh: true }),
    'La conexión con el portal está tardando demasiado. Comprueba la cobertura y pulsa Reintentar.',
  );
  return {
    valid: Boolean(result?.valid),
    obra: String(result?.obra || ''),
    foremanName: String(result?.foremanName || ''),
    defaultWorkStartHour: String(result?.defaultWorkStartHour || '08:00'),
    defaultWorkEndHour: String(result?.defaultWorkEndHour || '15:00'),
    worksite: {
      codigo: String(result?.worksite?.codigo || ''),
      nombre: String(result?.worksite?.nombre || result?.obra || ''),
      municipio: String(result?.worksite?.municipio || ''),
      empresa: String(result?.worksite?.empresa || ''),
      cif: String(result?.worksite?.cif || ''),
      recursoPreventivo: String(result?.worksite?.recursoPreventivo || result?.foremanName || ''),
    },
    workers: Array.isArray(result?.workers) ? result.workers : [],
    attendance: Array.isArray(result?.attendance) ? result.attendance : [],
    documents: Array.isArray(result?.documents) ? result.documents : [],
    mandatoryDocuments: Array.isArray(result?.mandatoryDocuments) ? result.mandatoryDocuments.filter((document:any)=>String(document.lifecycleStatus||document.details?.lifecycleStatus||'')!=='ARCHIVED') : [],
  };
}

export async function saveForemanAttendance(
  token: string,
  workDate: string,
  rows: ForemanAttendanceRow[],
  status: 'draft' | 'completed' = 'draft',
) {
  return withForemanTimeout(
    supabase.rpc('save_foreman_attendance', {
      p_token: token,
      p_work_date: workDate,
      p_rows: compactAttendanceRows(rows),
      p_status: status,
    }),
    'No se pudo guardar la jornada a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}

export async function signForemanAttendance(
  token: string,
  workDate: string,
  rows: ForemanAttendanceRow[],
  workerId: number,
  kind: 'entry' | 'exit',
  signature: string,
) {
  return withForemanTimeout(
    supabase.rpc('sign_foreman_attendance', {
      p_token: token,
      p_work_date: workDate,
      p_rows: compactAttendanceRows(rows),
      p_worker_id: workerId,
      p_kind: kind,
      p_signature: signature,
    }),
    'La firma está tardando demasiado en guardarse. Comprueba la conexión y vuelve a intentarlo.',
  );
}

export async function submitForemanDocument(input: {
  token: string;
  documentType: string;
  workDate: string;
  workerId?: number | null;
  answers: Record<string, string>;
  signatures: Record<string, string>;
}) {
  return withForemanTimeout(
    supabase.rpc('submit_foreman_document', {
      p_token: input.token,
      p_document_type: input.documentType,
      p_work_date: input.workDate,
      p_worker_id: input.workerId ?? null,
      p_answers: input.answers,
      p_signatures: input.signatures,
    }),
    'No se pudo enviar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function prepareMandatoryForemanDocuments(workers: Person[]): Promise<number> {
  if (!workers.length) return 0;
  const result = await supabase.rpc('prepare_foreman_mandatory_documents', { p_workers: workers });
  return Number(result) || 0;
}

export async function signMandatoryForemanDocument(
  token: string,
  documentId: string,
  workerId: number,
  signature: string,
) {
  return withForemanTimeout(
    supabase.rpc('sign_foreman_mandatory_document', {
      p_token: token,
      p_document_id: documentId,
      p_worker_id: workerId,
      p_signature: signature,
    }),
    'La firma está tardando demasiado en guardarse. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function prepareMandatoryDocumentFromEmail(input: {
  documentType: 'inicio' | 'control_presencia' | 'contrato' | 'prorroga';
  workerIds: number[];
  importedWorkers?: Person[];
  workDate: string;
  category?: string;
  periodKey: string;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  rfcMessageId?: string | null;
  emailFrom?: string | null;
  emailSubject?: string | null;
  attachmentName?: string | null;
  sourceText?: string | null;
  sourcePdfBase64?: string | null;
  sourcePdfSha256?: string | null;
  pageMeta?: any[];
  workerAnchors?: any[];
  obraHint?: string | null;
  worksiteProposal?: import('../lib/employmentWorksiteAssignment').EmploymentWorksiteProposal;
}) {
  const id = await supabase.rpc('prepare_foreman_mandatory_from_email', {
    p_document_type: input.documentType,
    p_worker_ids: input.workerIds,
    p_work_date: input.workDate,
    p_category: input.category || '',
    p_period_key: input.periodKey,
    p_gmail_message_id: input.gmailMessageId || null,
    p_gmail_thread_id: input.gmailThreadId || null,
    p_rfc_message_id: input.rfcMessageId || null,
    p_email_from: input.emailFrom || null,
    p_email_subject: input.emailSubject || null,
    p_attachment_name: input.attachmentName || null,
    p_obra_hint: input.obraHint || null,
  });
  const documentId = String(id || '').trim();
  if (documentId && input.sourcePdfBase64) {
    await supabase.rpc('save_foreman_mandatory_original_pdf', {
      p_document_id: documentId,
      p_pdf_base64: input.sourcePdfBase64,
      p_filename: input.attachmentName || '',
      p_original_sha256: input.sourcePdfSha256 || '',
      p_page_meta: input.pageMeta || [],
      p_worker_anchors: input.workerAnchors || [],
    });
  }
  if (documentId) {
    const currentRows = await supabase.query('foreman_mandatory_documents', {
      query: 'id=eq.' + encodeURIComponent(documentId) + '&select=details&limit=1',
    });
    const currentDetails =
      Array.isArray(currentRows) && currentRows[0]?.details && typeof currentRows[0].details === 'object'
        ? currentRows[0].details
        : {};
    await supabase.query('foreman_mandatory_documents', {
      method: 'PATCH',
      query: 'id=eq.' + encodeURIComponent(documentId),
      prefer: 'return=minimal',
      body: {
        details: {
          ...currentDetails,
          sourceText: input.sourceText || '',
          sourceFilename: input.attachmentName || '',
          ...(input.worksiteProposal ? { worksiteAssignment: input.worksiteProposal } : {}),
          importedWorkerIds: Array.isArray(input.importedWorkers)
            ? input.importedWorkers.map(worker=>Number(worker.id)).filter(Number.isFinite)
            : (Array.isArray(currentDetails.importedWorkerIds) ? currentDetails.importedWorkerIds : input.workerIds),
          importedWorkers: Array.isArray(input.importedWorkers)
            ? input.importedWorkers
            : (Array.isArray(currentDetails.importedWorkers) ? currentDetails.importedWorkers : []),
        },
        updated_at: new Date().toISOString(),
      },
    });
  }
  if (documentId) {
    const anchors = Array.isArray(input.workerAnchors) ? input.workerAnchors : [];
    const byLegacyId = new Map(anchors.map((anchor:any)=>[Number(anchor.workerId),anchor]));
    const importedWorkers = Array.isArray(input.importedWorkers) ? input.importedWorkers : [];
    const workerSnapshots:any[] = [...importedWorkers];
    const snapshotIds = new Set(importedWorkers.map((worker:any)=>Number(worker.id)));
    for(const anchor of anchors){
      const anchorId=Number(anchor?.workerId);
      if(Number.isFinite(anchorId)&&!snapshotIds.has(anchorId)){
        workerSnapshots.push({id:anchorId,apellidosNombre:String(anchor?.workerName||'Persona del documento')});
        snapshotIds.add(anchorId);
      }
    }
    for(const rawId of (Array.isArray(input.workerIds)?input.workerIds:[])){
      const workerId=Number(rawId);
      if(Number.isFinite(workerId)&&!snapshotIds.has(workerId)){
        workerSnapshots.push({id:workerId,apellidosNombre:'Persona incluida en el documento'});
        snapshotIds.add(workerId);
      }
    }
    const workersV2: MandatoryV2WorkerInput[] = workerSnapshots.map((worker:any,index:number): MandatoryV2WorkerInput =>{
      const legacyWorkerId = Number(worker.id);
      const anchor:any = byLegacyId.get(legacyWorkerId) || null;
      const hasNameBox = Boolean(anchor && anchor.nameX!=null && anchor.nameY!=null && Number(anchor.nameWidth||0)>0 && Number(anchor.nameHeight||anchor.rowHeight||0)>0);
      const hasSignatureBox = Boolean(anchor && anchor.signatureX!=null && anchor.signatureY!=null && Number(anchor.signatureWidth||0)>0 && Number(anchor.signatureHeight||0)>0);
      const confidence = Number(anchor?.confidence || 0);
      const manualConfirmed = Boolean(anchor?.resolved) && hasSignatureBox && (confidence>=0.999 || /confirmada manualmente por el supervisor|identidad confirmada por el supervisor/i.test(String(anchor?.reason||'')));
      const confirmed = Boolean(anchor?.resolved) && hasSignatureBox && (hasNameBox || manualConfirmed);
      return {
        legacyWorkerId: Number.isFinite(legacyWorkerId) ? legacyWorkerId : null,
        directoryWorkerId: null,
        printedName: String(worker.apellidosNombre || anchor?.workerName || '').trim(),
        page: anchor?.page != null ? Number(anchor.page) : null,
        rowIndex: anchor?.order != null ? Number(anchor.order) : index,
        detectionStatus: confirmed && !['contrato','prorroga'].includes(input.documentType) ? 'CONFIRMED' : 'DETECTED',
        detectionConfidence: confidence || null,
        positionStatus: confirmed && !['contrato','prorroga'].includes(input.documentType) ? 'RESOLVED' : 'PENDING',
        positionSource: manualConfirmed && !hasNameBox ? 'MANUAL' : 'AUTO',
        nameBox: hasNameBox ? {x:Number(anchor.nameX),y:Number(anchor.nameY),width:Number(anchor.nameWidth||1),height:Number(anchor.nameHeight||anchor.rowHeight||1)} : null,
        signatureBox: hasSignatureBox ? {x:Number(anchor.signatureX),y:Number(anchor.signatureY),width:Number(anchor.signatureWidth),height:Number(anchor.signatureHeight)} : null,
      };
    }).filter((worker:any)=>worker.printedName);
    await initializeMandatoryTraceabilityV2({
      documentId,
      workers: workersV2,
      detectedWorksite: input.obraHint && input.obraHint !== '__PENDING_WORKSITE__' ? input.obraHint : null,
    });
    // Publication is an explicit supervisor action after reviewing this draft.
  }
  return id;
}

export async function getForemanMandatoryPdf(
  token: string,
  documentId: string,
  variant: 'original' | 'signed' = 'original',
) {
  if(navigator.onLine===false){
    const cached=(await offlineDocuments(token)).find(document=>document.id===documentId);
    if(!cached||cached.pdf.variant!==variant)throw new Error('Esta versión del PDF no se ha descargado en este dispositivo.');
    return cached.pdf;
  }
  return withForemanTimeout(
    supabase.rpc('get_foreman_mandatory_pdf', {
      p_token: token,
      p_document_id: documentId,
      p_variant: variant,
    }),
    'No se pudo abrir el PDF a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  ) as Promise<{ base64:string; filename:string; sha256:string; variant:'original'|'signed'; fidelity?:any }>;
}

export async function getSupervisorMandatoryPdf(
  documentId: string,
  variant: 'original' | 'signed' = 'signed',
) {
  return supabase.rpc('get_supervisor_mandatory_pdf', {
    p_document_id: documentId,
    p_variant: variant,
  }) as Promise<{ base64:string; filename:string; sha256:string; variant:'original'|'signed'; fidelity?:any }>;
}


export async function getSupervisorMandatorySignatures(
  documentId: string,
): Promise<Record<string, { signature?: string; signedAt?: string } | string>> {
  const rows = await supabase.query('foreman_mandatory_documents', {
    query: `id=eq.${encodeURIComponent(documentId)}&select=signatures&limit=1`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.signatures && typeof row.signatures === 'object' ? row.signatures : {};
}

export async function updateSupervisorMandatoryAnchors(
  documentId: string,
  workerAnchors: any[],
) {
  const normalizedAnchors=(workerAnchors||[]).map(anchor=>({...anchor}));
  const v2Rows=await supabase.query('mandatory_document_workers_v2',{
    query:`document_id=eq.${encodeURIComponent(documentId)}&select=id,legacy_worker_id,printed_name,detection_status,page`,
    networkOnly:true,
  });
  const savedRows=Array.isArray(v2Rows)?v2Rows:[];
  const byLegacyId=new Map(savedRows.filter((row:any)=>row.legacy_worker_id!=null).map((row:any)=>[Number(row.legacy_worker_id),row]));
  const byDocumentId=new Map(savedRows.map((row:any)=>[String(row.id),row]));

  for(let index=0;index<normalizedAnchors.length;index+=1){
    const anchor=normalizedAnchors[index];
    // A retry after a partially completed save must reuse the stable documentary identity.
    const row:any=byDocumentId.get(String(anchor.documentWorkerId||'')) || byLegacyId.get(Number(anchor.workerId)) ||
      (Number(anchor.workerId)<0?savedRows.find((candidate:any)=>candidate.detection_status!=='REJECTED'&&String(candidate.printed_name||'').trim().toLocaleLowerCase('es')===String(anchor.workerName||'').trim().toLocaleLowerCase('es')&&Number(candidate.page||1)===Number(anchor.page||1)):null);
    const nameBox=anchor.nameX!=null&&anchor.nameY!=null&&Number(anchor.nameWidth||0)>0&&Number(anchor.nameHeight||anchor.rowHeight||0)>0
      ? {x:Number(anchor.nameX),y:Number(anchor.nameY),width:Number(anchor.nameWidth||1),height:Number(anchor.nameHeight||anchor.rowHeight||1)} : null;
    const signatureBox=anchor.signatureX!=null&&anchor.signatureY!=null&&Number(anchor.signatureWidth||0)>0&&Number(anchor.signatureHeight||0)>0
      ? {x:Number(anchor.signatureX),y:Number(anchor.signatureY),width:Number(anchor.signatureWidth),height:Number(anchor.signatureHeight)} : null;

    if(row?.detection_status==='REJECTED')continue;
    if(!signatureBox)throw new Error(`Falta una posición de firma válida para ${anchor.workerName||'el trabajador'}.`);
    if(!row){
      const printedName=String(anchor.workerName||'').replace(/\s+/g,' ').trim();
      if(printedName.length<3)throw new Error('Indica el nombre completo del trabajador añadido.');
      const created:any=await addMissingMandatoryDocumentWorkerV2({
        documentId,
        printedName,
        page:Math.max(1,Number(anchor.page||1)),
        rowIndex:Number.isFinite(Number(anchor.order))?Number(anchor.order):index,
        nameBox,
        signatureBox,
      });
      const stableLegacyId=Number(created?.legacyWorkerId);
      const documentWorkerId=String(created?.documentWorkerId||'');
      if(!Number.isFinite(stableLegacyId)||!documentWorkerId)throw new Error('No se pudo crear una identidad documental estable para el trabajador añadido.');
      normalizedAnchors[index]={...anchor,workerId:stableLegacyId,documentWorkerId,resolved:true,positionSource:'MANUAL',reason:'Trabajador recuperado manualmente del PDF y posición confirmada por el supervisor.'};
      byLegacyId.set(stableLegacyId,{id:documentWorkerId,legacy_worker_id:stableLegacyId,printed_name:printedName,detection_status:'CONFIRMED'});
      continue;
    }

    normalizedAnchors[index]={...anchor,workerId:Number(row.legacy_worker_id),documentWorkerId:String(row.id)};
    if(row.detection_status!=='CONFIRMED'){
      await reviewMandatoryDocumentWorkerV2({documentId,documentWorkerId:String(row.id),action:'confirm',printedName:String(anchor.workerName||row.printed_name),nameBox,signatureBox});
    }
    if(signatureBox){
      await updateMandatoryDocumentWorkerGeometryV2({documentId,documentWorkerId:String(row.id),nameBox,signatureBox,page:anchor.page!=null?Number(anchor.page):null,rowIndex:anchor.order!=null?Number(anchor.order):null});
    }
  }

  // RPCs maintain the legacy projection. Never overwrite it with the editor's stale draft.
  const persistedWorkers=await supabase.query('mandatory_document_workers_v2',{
    query:`document_id=eq.${encodeURIComponent(documentId)}&select=id,legacy_worker_id,detection_status,position_status,signature_box,page,row_index`,
    networkOnly:true,
  });
  const documents=await supabase.query('foreman_mandatory_documents',{
    query:`id=eq.${encodeURIComponent(documentId)}&select=id,details,lifecycle_status&limit=1`,networkOnly:true,
  });
  const document=Array.isArray(documents)?documents[0]:null;
  if(!document)throw new Error('No se pudo verificar el guardado de posiciones.');
  const persistedById=new Map((Array.isArray(persistedWorkers)?persistedWorkers:[]).map((row:any)=>[String(row.id),row]));
  for(const anchor of normalizedAnchors){
    const original:any=byDocumentId.get(String(anchor.documentWorkerId||''))||byLegacyId.get(Number(anchor.workerId));
    if(original?.detection_status==='REJECTED')continue;
    const row:any=persistedById.get(String(anchor.documentWorkerId||''));
    const savedAnchor=(document.details?.workerAnchors||[]).find((candidate:any)=>String(candidate.documentWorkerId)===String(anchor.documentWorkerId));
    const coordinatesMatch=['x','y','width','height'].every((key,index)=>
      Number(row?.signature_box?.[key])===Number(anchor[['signatureX','signatureY','signatureWidth','signatureHeight'][index]])&&
      Number(savedAnchor?.[['signatureX','signatureY','signatureWidth','signatureHeight'][index]])===Number(anchor[['signatureX','signatureY','signatureWidth','signatureHeight'][index]])
    );
    if(!row||row.detection_status!=='CONFIRMED'||row.position_status!=='RESOLVED'||!savedAnchor||!coordinatesMatch||
       Number(row.page)!==Number(anchor.page)||Number(savedAnchor.page)!==Number(anchor.page)||
       (anchor.order!=null&&Number(row.row_index)!==Number(anchor.order))||
       !(document.details?.importedWorkerIds||[]).some((id:any)=>Number(id)===Number(anchor.workerId))){
      throw new Error(`No se pudo verificar la posición guardada de ${anchor.workerName||'un trabajador'}. Vuelve a guardar con conexión.`);
    }
  }
  return document;

}
export async function repairForemanMandatoryAnchors(
  token: string,
  documentId: string,
  workerAnchors: any[],
) {
  return withForemanTimeout(
    supabase.rpc('repair_foreman_mandatory_anchors', {
      p_token: token,
      p_document_id: documentId,
      p_worker_anchors: workerAnchors || [],
    }),
    'No se pudieron preparar las zonas de firma a tiempo.',
  );
}


export async function getForemanMandatorySignatures(
  token: string,
  documentId: string,
): Promise<Record<string, { signature: string; signedAt?: string } | string>> {
  return withForemanTimeout(
    supabase.rpc('get_foreman_mandatory_signatures', {
      p_token: token,
      p_document_id: documentId,
    }),
    'No se pudieron cargar las firmas a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  ) as Promise<Record<string, { signature: string; signedAt?: string } | string>>;
}

export async function storeForemanMandatorySignedPdf(input: {
  token: string;
  documentId: string;
  pdfBase64: string;
  signedSha256: string;
  fidelity: any;
}) {
  return withForemanTimeout(
    supabase.rpc('store_foreman_mandatory_signed_pdf', {
      p_token: input.token,
      p_document_id: input.documentId,
      p_pdf_base64: input.pdfBase64,
      p_signed_sha256: input.signedSha256,
      p_fidelity: input.fidelity || {},
    }),
    'No se pudo guardar el PDF firmado a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}

export async function markMandatoryDocumentReturned(id: string, gmailMessageId: string) {
  await supabase.rpc('mark_foreman_mandatory_returned', {
    p_id: id,
    p_gmail_message_id: gmailMessageId,
  });
}


export async function finalizeForemanMandatoryDocument(token: string, documentId: string) {
  return withForemanTimeout(
    supabase.rpc('finalize_foreman_mandatory_document', {
      p_token: token,
      p_document_id: documentId,
    }),
    'No se pudo finalizar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}

export async function correctForemanMandatoryWorkerName(
  token: string,
  documentId: string,
  workerId: number,
  workerName: string,
) {
  const name=String(workerName||'').replace(/\s+/g,' ').trim();
  if(name.length<3)throw new Error('Indica un nombre válido.');
  return withForemanTimeout(
    supabase.rpc('correct_foreman_mandatory_worker_name', {
      p_token: token,
      p_document_id: documentId,
      p_worker_id: workerId,
      p_worker_name: name,
    }),
    'No se pudo guardar la corrección del nombre a tiempo.',
  );
}


export async function removeForemanMandatoryWorker(
  token: string,
  documentId: string,
  workerId: number,
) {
  return withForemanTimeout(
    supabase.rpc('remove_foreman_mandatory_worker', {
      p_token: token,
      p_document_id: documentId,
      p_worker_id: workerId,
    }),
    'No se pudo quitar la persona del documento a tiempo.',
  );
}

export async function removeSupervisorMandatoryWorker(documentId:string,workerId:number){
  const rows=await supabase.query('mandatory_document_workers_v2',{query:`document_id=eq.${encodeURIComponent(documentId)}&legacy_worker_id=eq.${encodeURIComponent(String(workerId))}&select=id&limit=1`,networkOnly:true});
  const row=Array.isArray(rows)?rows[0]:null;
  if(row?.id){
    await reviewMandatoryDocumentWorkerV2({documentId,documentWorkerId:String(row.id),action:'reject'});
    const verified=await supabase.query('mandatory_document_workers_v2',{query:`id=eq.${encodeURIComponent(String(row.id))}&select=id,detection_status&limit=1`,networkOnly:true});
    if(!Array.isArray(verified)||verified[0]?.detection_status!=='REJECTED')throw new Error('No se pudo verificar la eliminación del trabajador.');
    return verified[0];
  }
  return supabase.rpc('remove_supervisor_mandatory_worker',{p_document_id:documentId,p_worker_id:workerId});
}

export async function createForemanOperationalDocument(input: {
  token: string;
  documentType: 'epis' | 'formacion' | 'maquinaria' | 'autorizacion_uso_maquinaria';
  workDate: string;
  workerIds: number[];
  details?: Record<string, any>;
}) {
  return withForemanTimeout(
    supabase.rpc('create_foreman_operational_document', {
      p_token: input.token,
      p_document_type: input.documentType,
      p_work_date: input.workDate,
      p_worker_ids: input.workerIds,
      p_details: input.details || {},
    }),
    'No se pudo preparar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function returnForemanItemForCorrection(
  entityType: 'mandatory' | 'attendance' | 'document',
  id: string,
  reason: string,
) {
  return supabase.rpc('return_foreman_item_for_correction', {
    p_entity_type: entityType,
    p_id: id,
    p_reason: reason,
  });
}

export async function reviewForemanItem(
  entityType: 'mandatory' | 'attendance' | 'document',
  id: string,
) {
  return supabase.rpc('review_foreman_item', {
    p_entity_type: entityType,
    p_id: id,
  });
}

export async function resubmitForemanDocument(input: {
  token: string;
  documentId: string;
  answers: Record<string, string>;
  signatures: Record<string, string>;
}) {
  return withForemanTimeout(
    supabase.rpc('resubmit_foreman_document', {
      p_token: input.token,
      p_document_id: input.documentId,
      p_answers: input.answers,
      p_signatures: input.signatures,
    }),
    'No se pudo reenviar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function updateForemanMandatoryDocument(input: {
  id: string;
  workDate: string;
  category: string;
  workers: Person[];
  signatures: Record<string, { signature: string; signedAt?: string } | string>;
  status: 'pending' | 'in_progress' | 'returned' | 'completed' | 'reviewed';
  details?: Record<string, any>;
}) {
  const workerIds = new Set(input.workers.map((worker) => String(worker.id)));
  const filteredSignatures = Object.fromEntries(
    Object.entries(input.signatures || {}).filter(([workerId]) => workerIds.has(String(workerId))),
  );
  const signedCount = Object.keys(filteredSignatures).length;
  const total = input.workers.length;
  const exactOriginalMode = input.details?.originalPdfMode === 'overlay';
  const nextStatus = exactOriginalMode
    ? (signedCount > 0 ? 'in_progress' : 'pending')
    : total > 0 && signedCount >= total
      ? 'completed'
      : signedCount > 0
        ? 'in_progress'
        : 'pending';

  if (exactOriginalMode) {
    await supabase.query('foreman_mandatory_pdf_files', {
      method: 'PATCH',
      prefer: 'return=minimal',
      query: `document_id=eq.${encodeURIComponent(input.id)}`,
      body: {
        signed_pdf: null,
        signed_sha256: null,
        fidelity: null,
        updated_at: new Date().toISOString(),
      },
    });
  }

  await supabase.query('foreman_mandatory_documents', {
    method: 'PATCH',
    prefer: 'return=minimal',
    query: `id=eq.${encodeURIComponent(input.id)}`,
    body: {
      work_date: input.workDate,
      category: input.category,
      workers: input.workers,
      signatures: filteredSignatures,
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
      reviewed_at: null,
      returned_at: null,
      correction_pending: false,
      correction_reason: null,
      correction_requested_at: null,
      details: input.details || {},
      updated_at: new Date().toISOString(),
    },
  });
}

export async function deleteForemanMandatoryDocuments(input: { ids?: string[]; obra?: string }) {
  const ids=(input.ids||[]).filter(Boolean);
  const obra=String(input.obra||'').trim();
  if(!ids.length&&!obra)return 0;
  const result=await supabase.rpc('delete_foreman_mandatory_documents',{
    p_ids:ids.length?ids:null,
    p_obra:obra||null,
  });
  return Number(result)||0;
}

export async function deleteForemanMandatoryDocument(id: string) {
  return deleteForemanMandatoryDocuments({ids:[id]});
}

export async function restoreForemanMandatoryGmailSource(gmailMessageId: string, attachmentName: string) {
  return Number(await supabase.rpc('restore_foreman_mandatory_gmail_source', {
    p_gmail_message_id: gmailMessageId,
    p_attachment_name: attachmentName,
  })) || 0;
}


export async function loadSupervisorMandatoryEditorDocument(documentId:string){
  // Read the document and its authoritative geometry in one database snapshot.
  // Older imported documents can have missing UUIDs or stale positions in details.
  const rows=await supabase.query('foreman_mandatory_documents',{
    query:`id=eq.${encodeURIComponent(documentId)}&select=id,details,workers,signatures,work_date,category,lifecycle_status,status,updated_at,v2_initialized_at,documentWorkers:mandatory_document_workers_v2(id,legacy_worker_id,printed_name,detection_status,position_status,position_source,detection_confidence,page,row_index,name_box,signature_box,created_at)&limit=1`,
    networkOnly:true,
  });
  const document=Array.isArray(rows)?rows[0]:null;
  if(!document||!Array.isArray(document.documentWorkers))throw new Error('No se pudieron recuperar las posiciones guardadas del documento.');
  const previous=Array.isArray(document.details?.workerAnchors)?document.details.workerAnchors:[];
  const ordered=[...document.documentWorkers].sort((a,b)=>Number(a.row_index??Number.MAX_SAFE_INTEGER)-Number(b.row_index??Number.MAX_SAFE_INTEGER)||String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)));
  const active=ordered.filter(row=>row.detection_status!=='REJECTED');
  const used=new Set(active.filter(row=>row.legacy_worker_id!=null).map(row=>Number(row.legacy_worker_id)));
  const workerAnchors=active.map((row,index)=>{
    const old=previous.find((anchor:any)=>String(anchor.documentWorkerId||'')===String(row.id))||
      (row.legacy_worker_id!=null?previous.find((anchor:any)=>Number(anchor.workerId)===Number(row.legacy_worker_id)):null)||{};
    let workerId=row.legacy_worker_id!=null?Number(row.legacy_worker_id):-(index+1);
    while(row.legacy_worker_id==null&&used.has(workerId))workerId--;
    used.add(workerId);
    const value=(box:any,key:string)=>box?.[key]!=null?Number(box[key]):null;
    return {...old,documentWorkerId:String(row.id),draftNew:false,workerId,workerName:String(row.printed_name),
      page:Number(row.page||1),order:row.row_index,detectionStatus:row.detection_status,resolved:row.detection_status==='CONFIRMED'&&row.position_status==='RESOLVED',
      confidence:row.position_source==='MANUAL'?1:Number(row.detection_confidence||0),positionSource:row.position_source,
      reason:row.position_source==='MANUAL'?'Posición confirmada manualmente por el supervisor.':undefined,
      nameX:value(row.name_box,'x'),nameY:value(row.name_box,'y'),nameWidth:value(row.name_box,'width'),nameHeight:value(row.name_box,'height'),
      rowHeight:value(row.name_box,'height'),nameRightX:row.name_box?Number(row.name_box.x)+Number(row.name_box.width):null,
      signatureX:value(row.signature_box,'x'),signatureY:value(row.signature_box,'y'),signatureWidth:value(row.signature_box,'width'),signatureHeight:value(row.signature_box,'height')};
  });
  return {...document,details:{...(document.details||{}),workerAnchors,
    documentWorkersV2:ordered.map(row=>({id:row.id,legacyWorkerId:row.legacy_worker_id,printedName:row.printed_name,detectionStatus:row.detection_status,positionStatus:row.position_status,positionSource:row.position_source,page:row.page,rowIndex:row.row_index}))}};
}

export async function saveSupervisorMandatoryDraft(documentId:string,anchors:any[],expectedUpdatedAt?:string|null){
  const toBox=(anchor:any,prefix:string)=>{
    const values=prefix==='name'?[anchor.nameX,anchor.nameY,anchor.nameWidth??(anchor.nameRightX!=null&&anchor.nameX!=null?anchor.nameRightX-anchor.nameX:null),anchor.nameHeight??anchor.rowHeight]:['X','Y','Width','Height'].map(key=>anchor[prefix+key]);
    if(values.some(value=>value==null))return null;
    const [x,y,width,height]=values.map(Number);
    if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0)throw new Error('Coordenadas no válidas. Revisa el trabajador seleccionado.');
    return {x,y,width,height};
  };
  const workers=anchors.map((anchor,index)=>{
    if(!anchor.documentWorkerId)throw new Error('Falta la identidad documental. Cierra y vuelve a abrir el editor.');
    return {documentWorkerId:anchor.documentWorkerId,create:Boolean(anchor.draftNew),printedName:String(anchor.workerName||'').trim(),
      page:Math.max(1,Number(anchor.page||1)),rowIndex:index,resolved:Boolean(anchor.resolved),expectedDetectionStatus:anchor.resolved?'CONFIRMED':String((anchor as any).detectionStatus||'CONFIRMED'),
      nameBox:toBox(anchor,'name'),signatureBox:toBox(anchor,'signature')};
  });
  const saved:any=await supabase.rpc('save_mandatory_positions_draft_v2',{p_document_id:documentId,p_workers:workers,p_expected_updated_at:expectedUpdatedAt||null});
  const verified=await loadSupervisorMandatoryEditorDocument(documentId);
  if(!saved?.details?.draftSaveHash||!verified||verified.details?.draftSaveHash!==saved.details.draftSaveHash||verified.updated_at!==saved.updated_at)throw new Error('No se pudo verificar el borrador guardado. Reabre el documento para consultar su estado.');
  for(const worker of workers){
    const row=verified.documentWorkers.find((row:any)=>String(row.id)===worker.documentWorkerId);
    const boxMatches=(actual:any,expected:any)=>expected==null?actual==null:actual!=null&&['x','y','width','height'].every(key=>Number(actual[key])===expected[key]);
    if(!row||row.detection_status!==worker.expectedDetectionStatus||row.position_status!==(worker.resolved&&worker.signatureBox?'RESOLVED':'PENDING')||
       Number(row.page)!==worker.page||Number(row.row_index)!==worker.rowIndex||
       !boxMatches(row.name_box,worker.nameBox)||!boxMatches(row.signature_box,worker.signatureBox)){
      throw new Error(`No se pudo verificar la posición guardada de ${worker.printedName}. El editor conserva tus ajustes para reintentar.`);
    }
  }
  return verified;
}



/** Supervisor-only model configuration and scoped foreman signature evidence. */
export async function loadForemanSignatureTemplate(documentId:string,modelKey:string){
  return supabase.rpc('get_foreman_signature_template',{p_document_id:documentId,p_model_key:modelKey});
}
export async function saveForemanSignatureTemplate(documentId:string,modelKey:string,layout:import('../lib/foremanSignatureTemplate').ForemanSignatureTemplate){
  return supabase.rpc('save_foreman_signature_template',{p_document_id:documentId,p_model_key:modelKey,p_layout:layout});
}
export async function signImportedDocumentAsForeman(token:string,documentId:string,signature:string){
  return withForemanTimeout(supabase.rpc('sign_foreman_document_as_foreman',{p_token:token,p_document_id:documentId,p_signature:signature}),'No se pudo guardar la firma del encargado.');
}
export async function getImportedForemanSignature(token:string,documentId:string):Promise<{signed:boolean;signature?:string;signedAt?:string}>{
  return withForemanTimeout(supabase.rpc('get_foreman_document_signature',{p_token:token,p_document_id:documentId}),'No se pudo recuperar la firma del encargado.');
}

export function getAttendanceForemanEvidence(token:string,workDate:string){
  return withForemanTimeout(supabase.rpc('get_attendance_foreman_evidence',{p_token:token,p_work_date:workDate}),'No se pudo comprobar la firma del control horario.');
}
export function signAttendanceAsForeman(token:string,workDate:string,signature:string){
  return withForemanTimeout(supabase.rpc('sign_attendance_as_foreman',{p_token:token,p_work_date:workDate,p_signature:signature}),'No se pudo guardar la firma del encargado.');
}
export function saveAttendanceForemanTemplate(documentId:string,layout:import('../lib/foremanSignatureTemplate').ForemanSignatureTemplate){
  return supabase.rpc('save_attendance_foreman_template',{p_document_id:documentId,p_layout:layout});
}
export function getSupervisorForemanEvidence(documentId:string){
  return supabase.rpc('get_supervisor_foreman_evidence',{p_document_id:documentId});
}
export function getReusableForemanLayout(modelKey:string){
  return supabase.rpc('get_reusable_foreman_layout',{p_model_key:modelKey});
}

