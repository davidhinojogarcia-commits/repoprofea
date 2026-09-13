import type { MedicalRecordImportItem, Person } from '../../types';

const normalize = (value: string) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9Ñ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const compactDni = (value?: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const STOP = new Set(['DE','DEL','LA','LAS','EL','LOS','Y','DA','DI','SAN','SANTA']);
const nameTokens = (value: string) => normalize(value).split(' ').filter(t => t.length > 1 && !STOP.has(t));

const scoreName = (documentLine: string, workerName: string) => {
  const line = normalize(documentLine);
  const worker = normalize(workerName);
  if (!worker || !line) return 0;
  if (line.includes(worker)) return 1;
  const target = nameTokens(workerName);
  const source = nameTokens(documentLine);
  if (!target.length || !source.length) return 0;
  const shared = target.filter(t => source.some(s => s === t || (t.length >= 5 && s.startsWith(t)) || (s.length >= 5 && t.startsWith(s))));
  return (shared.length * 2) / (target.length + Math.min(source.length, target.length + 3));
};

const detectResult = (value: string): MedicalRecordImportItem['resultado'] | '' => {
  const text = normalize(value);
  if (/APTO\s+CON\s+(LIMITACION|LIMITACIONES|RESTRICCION|RESTRICCIONES)/.test(text) || /APTO.{0,60}LIMITACI/.test(text)) return 'Apto con Limitación';
  if (/NO\s+APTO/.test(text) || /INAPTO/.test(text)) return 'No Apto';
  if (/\bAPTO\b/.test(text) || /APTITUD\s+(FAVORABLE|POSITIVA)/.test(text)) return 'Apto';
  return '';
};

const dateMatches = (text: string) => Array.from(String(text || '').matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g));
const toIso = (m: RegExpMatchArray) => `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

const detectDate = (text: string) => {
  const labelled = String(text || '').match(/(?:FECHA\s+(?:DEL\s+)?(?:RECONOCIMIENTO|EXAMEN|REALIZACI[ÓO]N)|REALIZADO\s+EL)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/i);
  if (labelled) return `${labelled[3]}-${labelled[2].padStart(2,'0')}-${labelled[1].padStart(2,'0')}`;
  const match = dateMatches(text)[0];
  return match ? toIso(match) : '';
};

const addYear = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

const detectValidity = (text: string, date: string) => {
  const explicit = String(text || '').match(/(?:VALID(?:EZ|O|A)|CADUC(?:IDAD|A)|VIGENTE\s+HASTA|HASTA)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/i);
  if (explicit) return `${explicit[3]}-${explicit[2].padStart(2,'0')}-${explicit[1].padStart(2,'0')}`;
  return addYear(date);
};

const LIMITATION_STOP = /\b(?:FECHA(?:\s+DEL)?\s+(?:RECONOCIMIENTO|EXAMEN|EMISI[ÓO]N)|VALIDEZ|VIGENCIA|CADUCIDAD|CENTRO\s+M[EÉ]DICO|SERVICIO\s+DE\s+PREVENCI[ÓO]N|ENTIDAD|DNI|NIF|APELLIDOS|NOMBRE|RESULTADO|APTITUD|FIRMA|SELLO)\b/i;

const cleanLimitation = (value: string) => String(value || '')
  .replace(/^\s*[:\-–—|]+\s*/, '')
  .replace(/\s*\|\s*/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/[,:;\-–—]+\s*$/, '')
  .trim();

const limitationLooksReal = (value: string) => {
  const n = normalize(value);
  if (n.length < 5) return false;
  if (/^(SI|NO|APTO|APTO CON LIMITACIONES?|LIMITACIONES?|RESTRICCIONES?|CONDICIONES?)$/.test(n)) return false;
  if (/^(FECHA|DNI|NIF|NOMBRE|APELLIDOS|CENTRO|VIGENCIA|VALIDEZ)\b/.test(n)) return false;
  return true;
};

/** Extract only the text belonging to the limitations field. It deliberately stops
 * at known form labels so a date, centre or the following worker is never stored as
 * a medical restriction. */
const detectLimitations = (windowLines: string[]) => {
  const joined = windowLines.join('\n');
  const anchors = [
    /(?:LIMITACIONES?|RESTRICCIONES?|CONDICIONES?|OBSERVACIONES\s+M[EÉ]DICAS?)\s*[:\-]?\s*/ig,
    /APTO\s+CON\s+(?:LIMITACIONES?|RESTRICCIONES?)\s*[:\-]?\s*/ig,
  ];

  for (const re of anchors) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(joined))) {
      const tail = joined.slice(match.index + match[0].length);
      const pieces = tail.split(/\r?\n/);
      const collected: string[] = [];
      for (const piece of pieces) {
        const clean = cleanLimitation(piece);
        if (!clean) continue;
        if (LIMITATION_STOP.test(clean)) break;
        if (/\b(?:APTO|NO\s+APTO|INAPTO)\b/i.test(clean) && collected.length) break;
        collected.push(clean);
        if (collected.join(' ').length >= 260) break;
      }
      const result = cleanLimitation(collected.join(' ')).slice(0, 300);
      if (limitationLooksReal(result)) return result;
    }
  }
  return '';
};

const detectCentre = (text: string) => {
  const match = text.match(/(?:CENTRO\s+M[EÉ]DICO|SERVICIO\s+DE\s+PREVENCI[OÓ]N|ENTIDAD)\s*[:\-]?\s*([^\n|]{3,100})/i);
  return match?.[1]?.trim() || 'No especificado';
};

const hasMixedNegativeResults = (text: string) => {
  const n = normalize(text);
  return /NO\s+APTO|INAPTO|APTO\s+CON\s+(LIMITACION|LIMITACIONES|RESTRICCION|RESTRICCIONES)/.test(n);
};

const hasGlobalApto = (text: string) => {
  const n = normalize(text);
  return /RELACION\s+DE\s+TRABAJADORES\s+APTOS|LISTADO\s+DE\s+TRABAJADORES\s+APTOS|TODOS\s+(LOS\s+)?TRABAJADORES\s+APTOS|TODOS\s+APTOS|APTITUD\s+FAVORABLE/.test(n);
};

const findNextWorkerBoundary = (lines: string[], start: number, workers: Person[], currentId: number) => {
  for (let i = start + 1; i < Math.min(lines.length, start + 12); i += 1) {
    const lineDni = compactDni(lines[i]);
    for (const other of workers) {
      if (other.id === currentId) continue;
      const dni = compactDni(other.dni);
      if (dni.length >= 8 && lineDni.includes(dni)) return i;
      if (scoreName(lines[i], other.apellidosNombre) >= 0.9) return i;
    }
  }
  return Math.min(lines.length, start + 10);
};

export function analyzeMedicalDocumentText(text: string, workers: Person[], sourceFilename: string): MedicalRecordImportItem[] {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const flat = lines.join('\n');
  if (!normalize(flat)) return [];

  const globalDate = detectDate(flat);
  const globalValidity = detectValidity(flat, globalDate);
  const centroMedico = detectCentre(flat);
  const globalApto = hasGlobalApto(flat) && !hasMixedNegativeResults(flat);
  const out: MedicalRecordImportItem[] = [];

  for (const worker of workers) {
    const workerDni = compactDni(worker.dni);
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const lineDni = compactDni(lines[i]);
      if (workerDni && workerDni.length >= 8 && lineDni.includes(workerDni)) {
        bestIndex = i; bestScore = 1.2; break;
      }
      const score = scoreName(lines[i], worker.apellidosNombre);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    if (bestIndex < 0 || bestScore < 0.62) continue;

    const from = Math.max(0, bestIndex - 2);
    const boundary = findNextWorkerBoundary(lines, bestIndex, workers, worker.id);
    const to = Math.min(boundary, bestIndex + 10);
    const workerLines = lines.slice(from, to);
    const windowText = workerLines.join('\n');
    let resultado = detectResult(windowText);
    if (!resultado && globalApto) resultado = 'Apto';
    if (!resultado) continue;

    const fechaReconocimiento = detectDate(windowText) || globalDate;
    const validez = detectValidity(windowText, fechaReconocimiento) || globalValidity;
    const limitaciones = resultado === 'Apto con Limitación' ? detectLimitations(workerLines) : '';
    const inconsistencias: string[] = [];
    if (resultado === 'Apto con Limitación' && !limitaciones) {
      inconsistencias.push('El documento indica apto con limitaciones, pero no se ha podido aislar el texto exacto de la limitación. Revisar antes de guardar.');
    }

    const localResult = !!detectResult(windowText);
    let confianza: 'alta' | 'media' | 'baja' = bestScore >= 0.92 && localResult ? 'alta' : bestScore >= 0.75 ? 'media' : 'baja';
    // A limited worker is never auto-applied unless the actual restriction was captured.
    if (resultado === 'Apto con Limitación' && !limitaciones) confianza = 'baja';

    out.push({
      dni: worker.dni || '', apellidosNombre: worker.apellidosNombre, resultado, limitaciones,
      fechaReconocimiento, validez, centroMedico,
      observaciones: `Reconocido automáticamente desde ${sourceFilename} mediante extracción local/OCR.`,
      confianza, dniValido: true, fechaValida: !!fechaReconocimiento,
      centroValido: centroMedico !== 'No especificado', inconsistencias,
      matchedPersonId: worker.id, matchedPersonName: worker.apellidosNombre, archivoOrigen: sourceFilename,
    });
  }
  return out;
}
