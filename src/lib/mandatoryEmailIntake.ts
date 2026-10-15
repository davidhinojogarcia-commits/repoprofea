import { classifyEmploymentDocument, recognizeEmploymentWorker } from './employmentDocumentAnalysis.mjs';
import type { Person } from '../../types';
import { extractClientDocumentText } from './clientDocumentText';
import {
  base64UrlAttachmentToFile,
  getGmailConnectionStatus,
  scanAdministrativeGmail,
  type AdministrativeGmailMessage,
} from './gmailConnection';
import { loadAppBusinessSettings } from '../services/appSettingsService';
import { getDocuments } from '../services/databaseService';
import { prepareMandatoryDocumentFromEmail, restoreForemanMandatoryGmailSource } from '../services/foremanPortalService';
import { analyzeMandatoryOriginalPdf, analyzeEmploymentOriginalPdf, fileToBase64, resolveMandatoryAnchorsWithOcrRows, sha256Hex } from './mandatoryPdfOverlay';
import { extractPrintedWorkerNameCandidates } from './mandatoryWorkerDetection';
import { resolveMandatoryWorksite } from './mandatoryWorksiteDetection';
import { proposeEmploymentWorksite } from './employmentWorksiteAssignment';

const norm = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const compact = (value: unknown) => norm(value).replace(/\s+/g, '');

const MONTHS: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

const isoDate = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const extractDate = (text: string, fallbackMs?: string) => {
  const direct = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (direct) return isoDate(Number(direct[3]), Number(direct[2]), Number(direct[1]));
  const spanish = norm(text).match(/\b(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+DE\s+(20\d{2})\b/);
  if (spanish) return isoDate(Number(spanish[3]), MONTHS[spanish[2]], Number(spanish[1]));
  if (fallbackMs && Number(fallbackMs)) return new Date(Number(fallbackMs)).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
};

const documentType = (filename: string, text: string): 'inicio' | 'control_presencia' | 'contrato' | 'prorroga' | null => {
  const probe = norm(`${filename}\n${text}`);
  if (/CONTROL\s+(DE\s+)?PRESENCIA/.test(probe)) return 'control_presencia';
  if (/\bINICIO\b/.test(norm(filename))) return 'inicio';
  const employment = classifyEmploymentDocument(text, filename);
  if (employment) return employment;
  if (/\bINICIO\b|INCORPORACION\s+AL\s+CENTRO\s+DE\s+TRABAJO|ESTANDO\s+PREVISTA\s+SU\s+INCORPORACION/.test(probe)) return 'inicio';
  return null;
};

const extractWorksiteFromText = (text: string, candidates: string[] = [], fallback = '') => {
  const resolved = resolveMandatoryWorksite({ text, candidates, fallback: '' });
  if (resolved.source === 'candidate') return resolved.obra;
  if (fallback) return fallback;
  return '';
};

const extractCategory = (text: string) => {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const m = norm(line).match(/^CATEGORIA\s+(.+)$/);
    if (m?.[1]) return m[1].trim();
  }
  return '';
};

const periodKeyFor = (filename: string, workDate: string) => {
  const probe = norm(filename);
  const month = Number(workDate.slice(5, 7));
  const year = workDate.slice(0, 4);
  const q = /(?:^|\s)(1|PRIMERA)\s*(?:A|O)?\s*Q(?:UINCENA)?\b/.test(probe)
    ? '1Q'
    : /(?:^|\s)(2|SEGUNDA)\s*(?:A|O)?\s*Q(?:UINCENA)?\b/.test(probe)
      ? '2Q'
      : Number(workDate.slice(8, 10)) <= 15 ? '1Q' : '2Q';
  return `${year}-${String(month).padStart(2, '0')}-${q}`;
};

const NAME_STOPWORDS = new Set(['DEL','LOS','LAS','MARIA','JOSE','DE','LA','EL','Y']);

const nameWords = (name: string) =>
  norm(name).split(' ').filter(word => word.length >= 3 && !NAME_STOPWORDS.has(word));

const editDistanceAtMostOne = (a: string, b: string) => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) [a,b] = [b,a];
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) { i += 1; j += 1; }
    else j += 1;
  }
  if (j < b.length) edits += 1;
  return edits <= 1;
};

const categoryWords = (value: string) =>
  norm(value)
    .replace(/\b(OF|OFICIAL|PEON|PEON[A-Z]*|PRIMERA|SEGUNDA|1O|1A|2O|2A)\b/g, ' ')
    .split(' ')
    .filter(word => word.length >= 4);

const categorySimilarity = (a: string, b: string) => {
  const left = categoryWords(a);
  const right = categoryWords(b);
  if (!left.length || !right.length) return 0;
  const hits = left.filter(word => right.some(other =>
    other === word ||
    (word.length >= 5 && other.length >= 5 && editDistanceAtMostOne(word, other))
  )).length;
  return hits / Math.max(1, Math.min(left.length, right.length));
};

const cleanWorkerName = (value: unknown) =>
  norm(String(value || '').replace(/\[[^\]]*\]\s*$/g, '').replace(/\([^)]*\)\s*$/g, ''));

const sourceWorkerId = (name: string) => {
  const value = norm(name);
  let hash = 2166136261;
  for (let i=0;i<value.length;i+=1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash,16777619);
  }
  return -(3000000000 + (hash >>> 0));
};

const flexibleNameTokens = (value: string) =>
  norm(value)
    .replace(/[,.;:()\[\]_/\\-]+/g,' ')
    .split(/\s+/)
    .map(token=>token.trim())
    .filter(Boolean);

const tokenMatches = (left: string, right: string) => {
  if(left===right)return true;
  if(left.length===1&&right.startsWith(left))return true;
  if(right.length===1&&left.startsWith(right))return true;
  return left.length>=4&&right.length>=4&&editDistanceAtMostOne(left,right);
};

const flexibleNameScore = (printedName: string, directoryName: string) => {
  const printed=flexibleNameTokens(printedName);
  const directory=flexibleNameTokens(directoryName);
  if(!printed.length||!directory.length)return 0;
  const printedHits=printed.filter(token=>directory.some(other=>tokenMatches(token,other))).length;
  const directoryHits=directory.filter(token=>printed.some(other=>tokenMatches(token,other))).length;
  const coveragePrinted=printedHits/printed.length;
  const coverageDirectory=directoryHits/directory.length;
  const strongTokens=printed.filter(token=>token.length>=3&&directory.some(other=>tokenMatches(token,other))).length;
  if(strongTokens<2)return 0;
  return coveragePrinted*0.62+coverageDirectory*0.38;
};

const bestDirectoryNameMatch = (printedName: string, workers: Person[]) => {
  const ranked=workers
    .map(worker=>({worker,score:flexibleNameScore(printedName,worker.apellidosNombre||'')}))
    .filter(item=>item.score>=0.72)
    .sort((a,b)=>b.score-a.score);
  if(!ranked.length)return null;
  if(ranked.length>1&&ranked[0].score-ranked[1].score<0.08)return null;
  return ranked[0].worker;
};

const extractWorkersPrintedInPdf = (
  text: string,
  workers: Person[],
  category: string,
  obra: string,
  type: 'inicio'|'control_presencia'|'contrato'|'prorroga',
): Person[] => {
  if (type==='contrato'||type==='prorroga') {
    const recognized = recognizeEmploymentWorker(text);
    if (!recognized.name) return [];
    const identity=flexibleNameTokens(recognized.name).sort().join(' ');
    const matches=workers.filter(worker=>flexibleNameTokens(worker.apellidosNombre||'').sort().join(' ')===identity);
    const canonical=matches.length===1?matches[0]:null;
    return [{...(canonical || {}), id:canonical?.id || sourceWorkerId(recognized.name), apellidosNombre:recognized.name, dni:canonical?.dni || '', categoria:category || canonical?.categoria || '', obra} as Person];
  }
  const canonicalByName = new Map<string,Person>();
  if(type==='inicio'){
    for (const worker of workers) {
      const key=cleanWorkerName(worker.apellidosNombre || '');
      if(key && !canonicalByName.has(key))canonicalByName.set(key,worker);
    }
  }

  const seen=new Set<string>();
  const result:Person[]=[];
  const normalizedObra=norm(obra);
  const printedNames=extractPrintedWorkerNameCandidates(text);

  for (const printedName of printedNames) {
    const key=cleanWorkerName(printedName);
    if(!key||seen.has(key))continue;
    const keyTokens=key.split(' ').filter(Boolean);
    if(normalizedObra && keyTokens.length>=2 && (normalizedObra.includes(key) || key.includes(normalizedObra)))continue;
    seen.add(key);

    // Control de presencia es independiente del Directorio: el PDF es la única
    // fuente de personas. Se conserva exactamente el nombre leído y se genera
    // una identidad local estable solo para este documento.
    if(type==='control_presencia'){
      result.push({
        id:sourceWorkerId(key),
        apellidosNombre:printedName,
        dni:'',
        categoria:category || '',
        obra:obra || '',
      } as Person);
      continue;
    }

    // En Inicio también manda el PDF, pero se conserva la compatibilidad
    // existente con una coincidencia inequívoca del Directorio.
    const canonical=canonicalByName.get(key) || bestDirectoryNameMatch(printedName,workers);
    result.push(canonical
      ? ({...canonical,apellidosNombre:printedName,categoria:category||canonical.categoria||'',obra:obra||canonical.obra||''} as Person)
      : ({
          id:sourceWorkerId(key),
          apellidosNombre:printedName,
          dni:'',
          categoria:category || '',
          obra:obra || '',
        } as Person));
  }

  return result;
};

const matchWorkers = (workers: Person[], text: string) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => ({ raw: line, normalized: norm(line), compacted: compact(line) }))
    .filter(line => line.normalized);

  const usedIdentity = new Set<string>();
  const matches: Person[] = [];

  for (const line of lines) {
    const candidates = workers
      .map(worker => {
        const dni = compact(worker.dni || '');
        const name = cleanWorkerName(worker.apellidosNombre || '');
        if (dni && dni.length >= 7 && line.compacted.includes(dni)) {
          return { worker, score: 200, identity: 'dni:' + dni };
        }
        if (!name) return null;
        const exactName = line.normalized === name;
        const nameInsideLine = line.normalized.includes(name);
        if (!exactName && !nameInsideLine) return null;
        return {
          worker,
          score: exactName ? 120 : 100,
          identity: 'name:' + name,
        };
      })
      .filter((item): item is {worker:Person;score:number;identity:string} => Boolean(item))
      .sort((a,b) => b.score - a.score || Number(b.worker.id || 0) - Number(a.worker.id || 0));

    const best = candidates.find(item => !usedIdentity.has(item.identity));
    if (!best) continue;
    usedIdentity.add(best.identity);
    matches.push(best.worker);
  }

  return matches;
};

const stripRecognizedWorkerLines = (text: string, workers: Person[]) => {
  if (!text || !workers.length) return text.trim();
  const workerMarkers = workers.map(worker => ({
    dni: compact(worker.dni || ''),
    names: nameWords(worker.apellidosNombre || '').filter(word => word.length >= 4),
  }));

  return text
    .split(/\r?\n/)
    .filter(line => {
      const normalizedLine = norm(line);
      const compactLine = compact(line);
      return !workerMarkers.some(marker => {
        if (marker.dni && marker.dni.length >= 7 && compactLine.includes(marker.dni)) return true;
        if (marker.names.length < 2) return false;
        const hits = marker.names.filter(word => normalizedLine.includes(word)).length;
        return hits >= 2;
      });
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const extractCategoryWithFilenameFallback = (text: string, filename: string) => {
  const fromText = extractCategory(text);
  if (fromText) return fromText;
  const probe = norm(filename)
    .replace(/\.PDF\b/g, '')
    .replace(/\b(INICIO|INCORPORACION|CONTROL|PRESENCIA|OCT|NOV|DIC|ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SEPT)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return probe;
};

const extractMandatoryTextSafely = async (file: File, warnings: string[], onProgress?: (message: string) => void) => {
  try {
    return await extractClientDocumentText(file, onProgress);
  } catch (error) {
    const type = documentType(file.name, '');
    if (type !== 'contrato' && type !== 'prorroga') throw error;
    warnings.push(`${file.name}: no se pudo completar la lectura. El original se conserva pendiente de revisión manual de obra, trabajador y firma.`);
    // The PDF analyzer still validates the actual PDF and its pages below.
    // Filename classification never supplies a worksite, identity or position.
    return { text: '', source: 'none' as const };
  }
};

const matchMandatoryWorkersWithOcrRetry = async (
  file: File,
  workers: Person[],
  firstText: string,
  type: 'inicio' | 'control_presencia' | 'contrato' | 'prorroga',
  onProgress?: (message: string) => void,
) => {
  let text = firstText;
  if(type==='contrato'||type==='prorroga') {
    if(!recognizeEmploymentWorker(text).name){
      try {
        const reinforced = await extractClientDocumentText(file,onProgress,{forceOcr:true,ocrScale:2.4});
        text=reinforced.text || text;
      } catch {onProgress?.('No se pudo reforzar la lectura. Se conserva el original para revisión manual.');}
    }
    return {text,category:'',matched:[] as Person[],printedNames:[] as string[]};
  }
  let category = type === 'inicio' ? extractCategoryWithFilenameFallback(text, file.name) : '';

  // Control de presencia no depende del Directorio. Solo comprobamos si el
  // propio PDF contiene nombres legibles; si no, reforzamos la lectura con OCR.
  if(type==='control_presencia'){
    let printedNames=extractPrintedWorkerNameCandidates(text);
    if(!printedNames.length){
      onProgress?.(`No se localizaron nombres en ${file.name}. Reforzando lectura del documento…`);
      const reinforced = await extractClientDocumentText(file, onProgress, { forceOcr: true, ocrScale: 2.6 });
      text = reinforced.text || text;
      printedNames=extractPrintedWorkerNameCandidates(text);
    }
    return { text, category, matched: [] as Person[], printedNames };
  }

  let matched = matchWorkers(workers, text);
  if (!matched.length) {
    onProgress?.(`No se localizaron trabajadores en ${file.name}. Reforzando lectura…`);
    const reinforced = await extractClientDocumentText(file, onProgress, { forceOcr: true, ocrScale: 2.4 });
    text = reinforced.text || text;
    category = extractCategoryWithFilenameFallback(text, file.name);
    matched = matchWorkers(workers, text);
  }

  return { text, category, matched, printedNames: extractPrintedWorkerNameCandidates(text) };
};

export type MandatoryEmailIntakeResult = {
  pendingWorksiteDocuments?: number;
  scannedMessages: number;
  importedDocuments: number;
  skippedAttachments: number;
  warnings: string[];
  missingDirectoryWorkers: string[];
};

export async function processAdministrativeMandatoryInbox(options?: {
  existingSourceKeys?: Set<string>;
  onProgress?: (message: string) => void;
  restoreDeleted?: boolean;
  obraCandidates?: string[];
}): Promise<MandatoryEmailIntakeResult> {
  const settings = await loadAppBusinessSettings();
  const administrativeEmail = String(settings.administrative?.email || '').trim().toLowerCase();
  if (!administrativeEmail) {
    return { scannedMessages: 0, importedDocuments: 0, skippedAttachments: 0, warnings: ['Configura primero el correo de la administrativa.'], missingDirectoryWorkers: [] };
  }

  const gmail = await getGmailConnectionStatus();
  if (!gmail.connected) {
    return { scannedMessages: 0, importedDocuments: 0, skippedAttachments: 0, warnings: ['Conecta Gmail del supervisor en Configuración.'], missingDirectoryWorkers: [] };
  }
  if (!gmail.canRead) {
    const error: any = new Error('Gmail necesita una nueva autorización para detectar automáticamente los correos de la administrativa.');
    error.code = 'GMAIL_READ_PERMISSION_REQUIRED';
    throw error;
  }

  options?.onProgress?.('Consultando Gmail de la administrativa…');
  const messages = await scanAdministrativeGmail(administrativeEmail);
  const workers = await getDocuments<Person>('trabajadores', { limitCount: 5000 });
  const worksiteCatalog = await getDocuments<any>('obras', { limitCount: 1000 });
  const knownWorksites = options?.obraCandidates?.length ? options.obraCandidates : worksiteCatalog.map((obra:any)=>String(obra?.nombre||'').trim()).filter(Boolean);
  const existing = options?.existingSourceKeys || new Set<string>();
  const warnings: string[] = [];
  const missingDirectoryWorkers = new Set<string>();
  let importedDocuments = 0;
  let skippedAttachments = 0;
  let pendingWorksiteDocuments = 0;

  for (const message of messages) {
    for (const attachment of message.attachments || []) {
      const key = `${message.id}|${attachment.filename}`;
      if (existing.has(key)) continue;
      if (!/\.pdf$/i.test(attachment.filename) && attachment.mimeType !== 'application/pdf') {
        skippedAttachments += 1;
        continue;
      }
      options?.onProgress?.(`Leyendo ${attachment.filename}…`);
      try {
        const file = base64UrlAttachmentToFile(attachment);
        const extracted = await extractMandatoryTextSafely(file, warnings, options?.onProgress);
        const type = documentType(attachment.filename, extracted.text);
        if (!type) {
          skippedAttachments += 1;
          continue;
        }
        const recognition = await matchMandatoryWorkersWithOcrRetry(
          file,
          workers,
          extracted.text,
          type,
          options?.onProgress,
        );
        const category = recognition.category;
        const worksiteProposal = ['contrato','prorroga'].includes(type) ? proposeEmploymentWorksite(recognition.text, worksiteCatalog) : undefined;
        const documentObra = worksiteProposal ? '' : extractWorksiteFromText(recognition.text, knownWorksites);
        const listedWorkers = extractWorkersPrintedInPdf(recognition.text, workers, category, documentObra, type);
        if (!listedWorkers.length && !['contrato','prorroga'].includes(type)) {
          warnings.push(`${attachment.filename}: no se han podido leer nombres de personas en el PDF.`);
          skippedAttachments += 1;
          continue;
        }
        const obra = documentObra || '__PENDING_WORKSITE__';
        if(obra==='__PENDING_WORKSITE__'){
          warnings.push(`${attachment.filename}: documento conservado pendiente de clasificar por obra.`);
        }
        const selected = listedWorkers;
        if(type==='inicio'){
          selected.filter(worker=>Number(worker.id)<0).forEach(worker=>{
            const name=String(worker.apellidosNombre||'').trim();
            if(name)missingDirectoryWorkers.add(name);
          });
        }
        const workDate = extractDate(extracted.text, message.internalDate);
        let analysis = await (['contrato','prorroga'].includes(type) ? analyzeEmploymentOriginalPdf(file,selected,options?.onProgress) : analyzeMandatoryOriginalPdf(file, selected, options?.onProgress, recognition.text));
        if (analysis.unresolvedWorkerIds.length && !['contrato','prorroga'].includes(type)) {
          analysis = await resolveMandatoryAnchorsWithOcrRows(file, selected, analysis, options?.onProgress);
        }
        const selectedById = new Map(selected.map(worker => [Number(worker.id), worker]));
        const orderedSelected = analysis.orderedWorkerIds
          .map(id => selectedById.get(Number(id)))
          .filter((worker): worker is Person => Boolean(worker));
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        if (options?.restoreDeleted) {
          await restoreForemanMandatoryGmailSource(message.id, attachment.filename);
        }
        const preparedId=await prepareMandatoryDocumentFromEmail({
          documentType: type,
          workerIds: orderedSelected.filter(worker=>Number(worker.id)>0).map(worker => Number(worker.id)).filter(Number.isFinite),
          importedWorkers: orderedSelected,
          workDate,
          category,
          periodKey: periodKeyFor(attachment.filename, workDate),
          gmailMessageId: message.id,
          gmailThreadId: message.threadId,
          rfcMessageId: message.rfcMessageId,
          emailFrom: administrativeEmail,
          emailSubject: message.subject,
          attachmentName: attachment.filename,
          obraHint: obra,
          worksiteProposal,
          sourceText: recognition.text,
          sourcePdfBase64: await fileToBase64(file),
          sourcePdfSha256: await sha256Hex(sourceBytes),
          pageMeta: analysis.pages,
          workerAnchors: analysis.anchors,
        });
        if(preparedId) { importedDocuments += 1; if(obra==='__PENDING_WORKSITE__')pendingWorksiteDocuments += 1; }
        existing.add(key);
      } catch (error: any) {
        warnings.push(`${attachment.filename}: ${error?.message || 'no se pudo procesar'}`);
      }
    }
  }

  return { scannedMessages: messages.length, importedDocuments, skippedAttachments, warnings, pendingWorksiteDocuments, missingDirectoryWorkers:[...missingDirectoryWorkers] };
}


export type MandatoryManualImportResult = {
  pendingWorksiteDocuments?: number;
  importedDocuments: number;
  skippedFiles: number;
  warnings: string[];
  missingDirectoryWorkers: string[];
};

export async function processManualMandatoryFiles(
  files: File[],
  options?: { onProgress?: (message: string) => void; obraHint?: string; obraCandidates?: string[] },
): Promise<MandatoryManualImportResult> {
  const workers = await getDocuments<Person>('trabajadores', { limitCount: 5000 });
  const worksiteCatalog = await getDocuments<any>('obras', { limitCount: 1000 });
  const knownWorksites = options?.obraCandidates?.length ? options.obraCandidates : worksiteCatalog.map((obra:any)=>String(obra?.nombre||'').trim()).filter(Boolean);
  const warnings: string[] = [];
  const missingDirectoryWorkers = new Set<string>();
  let importedDocuments = 0;
  let skippedFiles = 0;
  let pendingWorksiteDocuments = 0;

  for (const file of files) {
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      skippedFiles += 1;
      warnings.push(`${file.name}: solo se admiten documentos PDF.`);
      continue;
    }

    options?.onProgress?.(`Analizando ${file.name}…`);
    try {
      const extracted = await extractMandatoryTextSafely(file, warnings, options?.onProgress);
      const type = documentType(file.name, extracted.text);
      if (!type) {
        skippedFiles += 1;
        warnings.push(`${file.name}: no se reconoce como Inicio, Control de presencia, Contrato ni Prórroga.`);
        continue;
      }

      const recognition = await matchMandatoryWorkersWithOcrRetry(
        file,
        workers,
        extracted.text,
        type,
        options?.onProgress,
      );
      const category = recognition.category;
      const obraHint = String(options?.obraHint || '').trim();
      const worksiteProposal = ['contrato','prorroga'].includes(type) ? proposeEmploymentWorksite(recognition.text, worksiteCatalog) : undefined;
      const documentObra = worksiteProposal ? '' : extractWorksiteFromText(
        recognition.text,
        knownWorksites,
        files.length === 1 ? obraHint : '',
      );
      const obra = documentObra || '__PENDING_WORKSITE__';
      if(obra==='__PENDING_WORKSITE__'){
        warnings.push(`${file.name}: documento conservado pendiente de clasificar por obra.`);
      }
      const selected = extractWorkersPrintedInPdf(recognition.text, workers, category, documentObra || '', type);
      if(['contrato','prorroga'].includes(type)&&!selected.length)warnings.push(`${file.name}: original conservado; revisa el trabajador en Ajustar firmas.`);
      if(type==='inicio'){
        selected.filter(worker=>Number(worker.id)<0).forEach(worker=>{
          const name=String(worker.apellidosNombre||'').trim();
          if(name)missingDirectoryWorkers.add(name);
        });
      }
      if(!selected.length && !['contrato','prorroga'].includes(type)){
        skippedFiles += 1;
        warnings.push(`${file.name}: no se han podido leer nombres de personas en el PDF.`);
        continue;
      }
      const workDate = extractDate(extracted.text);
      let analysis = await (['contrato','prorroga'].includes(type) ? analyzeEmploymentOriginalPdf(file,selected,options?.onProgress) : analyzeMandatoryOriginalPdf(file, selected, options?.onProgress, recognition.text));
        if (analysis.unresolvedWorkerIds.length && !['contrato','prorroga'].includes(type)) {
          analysis = await resolveMandatoryAnchorsWithOcrRows(file, selected, analysis, options?.onProgress);
        }
      const selectedById = new Map(selected.map(worker => [Number(worker.id), worker]));
      const orderedSelected = analysis.orderedWorkerIds
        .map(id => selectedById.get(Number(id)))
        .filter((worker): worker is Person => Boolean(worker));
      const sourceBytes = new Uint8Array(await file.arrayBuffer());

      const preparedId=await prepareMandatoryDocumentFromEmail({
        documentType: type,
        workerIds: orderedSelected.filter(worker=>Number(worker.id)>0).map(worker => Number(worker.id)).filter(Number.isFinite),
        importedWorkers: orderedSelected,
        workDate,
        category,
        periodKey: periodKeyFor(file.name, workDate),
        gmailMessageId: null,
        gmailThreadId: null,
        rfcMessageId: null,
        emailFrom: null,
        emailSubject: null,
        attachmentName: file.name,
        sourceText: recognition.text,
        sourcePdfBase64: await fileToBase64(file),
        sourcePdfSha256: await sha256Hex(sourceBytes),
        pageMeta: analysis.pages,
        workerAnchors: analysis.anchors,
        obraHint: obra || null,
        worksiteProposal,
      });
      if(preparedId) { importedDocuments += 1; if(obra==='__PENDING_WORKSITE__')pendingWorksiteDocuments += 1; }
    } catch (error: any) {
      skippedFiles += 1;
      warnings.push(`${file.name}: ${error?.message || 'no se pudo procesar'}`);
    }
  }

  return { importedDocuments, skippedFiles, warnings, pendingWorksiteDocuments, missingDirectoryWorkers:[...missingDirectoryWorkers] };
}
