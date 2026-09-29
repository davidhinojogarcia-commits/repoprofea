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
import { prepareMandatoryDocumentFromEmail } from '../services/foremanPortalService';

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

const documentType = (filename: string, text: string): 'inicio' | 'control_presencia' | null => {
  const probe = norm(`${filename}\n${text}`);
  if (/CONTROL\s+(DE\s+)?PRESENCIA/.test(probe)) return 'control_presencia';
  if (/\bINICIO\b|INCORPORACION\s+AL\s+CENTRO\s+DE\s+TRABAJO|ESTANDO\s+PREVISTA\s+SU\s+INCORPORACION/.test(probe)) return 'inicio';
  return null;
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

const matchWorkers = (workers: Person[], text: string, category: string) => {
  const normalized = norm(text);
  const compactText = compact(text);
  const textTokens = normalized.split(' ').filter(Boolean);
  const categoryNorm = norm(category);

  return workers
    .map(worker => {
      const dni = compact(worker.dni);
      if (dni && dni.length >= 7 && compactText.includes(dni)) {
        return { worker, score: 100 };
      }

      const words = nameWords(worker.apellidosNombre || '');
      if (!words.length) return { worker, score: 0 };

      let exactHits = 0;
      let fuzzyHits = 0;
      for (const word of words) {
        if (normalized.includes(word)) {
          exactHits += 1;
          continue;
        }
        if (
          word.length >= 5 &&
          textTokens.some(token =>
            token.length >= 5 &&
            (token.startsWith(word.slice(0, 5)) ||
              word.startsWith(token.slice(0, 5)) ||
              editDistanceAtMostOne(word, token))
          )
        ) {
          fuzzyHits += 1;
        }
      }

      const nameScore = exactHits * 3 + fuzzyHits * 2;
      const surnameStrong = words.slice(0, 2).filter(word =>
        normalized.includes(word) ||
        (word.length >= 5 && textTokens.some(token => token.length >= 5 && editDistanceAtMostOne(word, token)))
      ).length;
      const categoryScore = categoryNorm ? categorySimilarity(categoryNorm, worker.categoria || '') : 0;
      const score = nameScore + surnameStrong * 2 + categoryScore * 2;
      return { worker, score };
    })
    .filter(item => item.score >= 5)
    .sort((a,b) => b.score - a.score)
    .map(item => item.worker);
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

const matchMandatoryWorkersWithOcrRetry = async (
  file: File,
  workers: Person[],
  firstText: string,
  type: 'inicio' | 'control_presencia',
  onProgress?: (message: string) => void,
) => {
  let text = firstText;
  let category = type === 'inicio' ? extractCategoryWithFilenameFallback(text, file.name) : '';
  let matched = matchWorkers(workers, text, category);

  if (!matched.length) {
    onProgress?.(`No se localizaron trabajadores en ${file.name}. Reforzando lectura…`);
    const reinforced = await extractClientDocumentText(file, onProgress, { forceOcr: true, ocrScale: 2.4 });
    text = reinforced.text || text;
    category = type === 'inicio' ? extractCategoryWithFilenameFallback(text, file.name) : '';
    matched = matchWorkers(workers, text, category);
  }

  return { text, category, matched };
};

export type MandatoryEmailIntakeResult = {
  scannedMessages: number;
  importedDocuments: number;
  skippedAttachments: number;
  warnings: string[];
};

export async function processAdministrativeMandatoryInbox(options?: {
  existingSourceKeys?: Set<string>;
  onProgress?: (message: string) => void;
}): Promise<MandatoryEmailIntakeResult> {
  const settings = await loadAppBusinessSettings();
  const administrativeEmail = String(settings.administrative?.email || '').trim().toLowerCase();
  if (!administrativeEmail) {
    return { scannedMessages: 0, importedDocuments: 0, skippedAttachments: 0, warnings: ['Configura primero el correo de la administrativa.'] };
  }

  const gmail = await getGmailConnectionStatus();
  if (!gmail.connected) {
    return { scannedMessages: 0, importedDocuments: 0, skippedAttachments: 0, warnings: ['Conecta Gmail del supervisor en Configuración.'] };
  }
  if (!gmail.canRead) {
    const error: any = new Error('Gmail necesita una nueva autorización para detectar automáticamente los correos de la administrativa.');
    error.code = 'GMAIL_READ_PERMISSION_REQUIRED';
    throw error;
  }

  options?.onProgress?.('Consultando Gmail de la administrativa…');
  const messages = await scanAdministrativeGmail(administrativeEmail);
  const workers = await getDocuments<Person>('trabajadores', { limitCount: 5000 });
  const existing = options?.existingSourceKeys || new Set<string>();
  const warnings: string[] = [];
  let importedDocuments = 0;
  let skippedAttachments = 0;

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
        const extracted = await extractClientDocumentText(file, options?.onProgress);
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
        const matched = recognition.matched;
        if (!matched.length) {
          warnings.push(`${attachment.filename}: no se pudieron vincular trabajadores tras la lectura reforzada. Revisa el documento o usa Editar para asignarlos manualmente.`);
          skippedAttachments += 1;
          continue;
        }

        // Evita mezclar obras: selecciona la obra mayoritaria entre los trabajadores detectados.
        const counts = new Map<string, number>();
        for (const worker of matched) {
          const work = String(worker.obra || '').trim();
          if (work) counts.set(work, (counts.get(work) || 0) + 1);
        }
        const obra = [...counts.entries()].sort((a,b) => b[1] - a[1])[0]?.[0] || '';
        const selected = obra ? matched.filter(worker => String(worker.obra || '').trim() === obra) : matched;
        const workDate = extractDate(extracted.text, message.internalDate);
        await prepareMandatoryDocumentFromEmail({
          documentType: type,
          workerIds: selected.map(worker => Number(worker.id)).filter(Number.isFinite),
          workDate,
          category,
          periodKey: periodKeyFor(attachment.filename, workDate),
          gmailMessageId: message.id,
          gmailThreadId: message.threadId,
          rfcMessageId: message.rfcMessageId,
          emailFrom: administrativeEmail,
          emailSubject: message.subject,
          attachmentName: attachment.filename,
          sourceText: stripRecognizedWorkerLines(recognition.text, selected),
        });
        importedDocuments += 1;
        existing.add(key);
      } catch (error: any) {
        warnings.push(`${attachment.filename}: ${error?.message || 'no se pudo procesar'}`);
      }
    }
  }

  return { scannedMessages: messages.length, importedDocuments, skippedAttachments, warnings };
}


export type MandatoryManualImportResult = {
  importedDocuments: number;
  skippedFiles: number;
  warnings: string[];
};

export async function processManualMandatoryFiles(
  files: File[],
  options?: { onProgress?: (message: string) => void },
): Promise<MandatoryManualImportResult> {
  const workers = await getDocuments<Person>('trabajadores', { limitCount: 5000 });
  const warnings: string[] = [];
  let importedDocuments = 0;
  let skippedFiles = 0;

  for (const file of files) {
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      skippedFiles += 1;
      warnings.push(`${file.name}: solo se admiten documentos PDF.`);
      continue;
    }

    options?.onProgress?.(`Analizando ${file.name}…`);
    try {
      const extracted = await extractClientDocumentText(file, options?.onProgress);
      const type = documentType(file.name, extracted.text);
      if (!type) {
        skippedFiles += 1;
        warnings.push(`${file.name}: no se reconoce como Inicio ni Control de presencia.`);
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
      const matched = recognition.matched;
      if (!matched.length) {
        skippedFiles += 1;
        warnings.push(`${file.name}: no se pudieron vincular trabajadores tras la lectura reforzada. Revisa el documento o usa Editar para asignarlos manualmente.`);
        continue;
      }

      const counts = new Map<string, number>();
      for (const worker of matched) {
        const work = String(worker.obra || '').trim();
        if (work) counts.set(work, (counts.get(work) || 0) + 1);
      }
      const obra = [...counts.entries()].sort((a,b) => b[1] - a[1])[0]?.[0] || '';
      const selected = obra ? matched.filter(worker => String(worker.obra || '').trim() === obra) : matched;
      const workDate = extractDate(extracted.text);

      await prepareMandatoryDocumentFromEmail({
        documentType: type,
        workerIds: selected.map(worker => Number(worker.id)).filter(Number.isFinite),
        workDate,
        category,
        periodKey: periodKeyFor(file.name, workDate),
        gmailMessageId: null,
        gmailThreadId: null,
        rfcMessageId: null,
        emailFrom: null,
        emailSubject: null,
        attachmentName: file.name,
        sourceText: stripRecognizedWorkerLines(recognition.text, selected),
      });
      importedDocuments += 1;
    } catch (error: any) {
      skippedFiles += 1;
      warnings.push(`${file.name}: ${error?.message || 'no se pudo procesar'}`);
    }
  }

  return { importedDocuments, skippedFiles, warnings };
}
