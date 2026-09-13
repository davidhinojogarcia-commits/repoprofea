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
  if (/APTO\s+CON\s+(LIMITACION|LIMITACIONES|RESTRICCION|RESTRICCIONES)/.test(text) || /APTO.*LIMITACI/.test(text)) return 'Apto con Limitación';
  if (/NO\s+APTO/.test(text) || /INAPTO/.test(text)) return 'No Apto';
  if (/\bAPTO\b/.test(text) || /APTITUD\s+(FAVORABLE|POSITIVA)/.test(text)) return 'Apto';
  return '';
};

const detectDate = (text: string) => {
  const match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
};

const detectValidity = (text: string, date: string) => {
  const explicit = text.match(/(?:VALID(?:EZ|O)|CADUC(?:IDAD|A)|HASTA)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/i);
  if (explicit) return `${explicit[3]}-${explicit[2].padStart(2,'0')}-${explicit[1].padStart(2,'0')}`;
  return date ? String(Number(date.slice(0,4)) + 1) : '';
};

const detectLimitations = (windowText: string) => {
  const raw = windowText.replace(/\s+/g, ' ').trim();
  const match = raw.match(/(?:LIMITACIONES?|RESTRICCIONES?|CONDICIONES?)\s*[:\-]?\s*([^.;\n]{3,180})/i);
  if (match) return match[1].trim();
  const result = raw.match(/APTO\s+CON\s+LIMITACIONES?\s*[:\-]?\s*([^.;\n]{3,180})/i);
  return result?.[1]?.trim() || '';
};

const detectCentre = (text: string) => {
  const match = text.match(/(?:CENTRO\s+M[EÉ]DICO|SERVICIO\s+DE\s+PREVENCI[OÓ]N|ENTIDAD)\s*[:\-]?\s*([^\n]{3,100})/i);
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

export function analyzeMedicalDocumentText(
  text: string,
  workers: Person[],
  sourceFilename: string,
): MedicalRecordImportItem[] {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const flat = lines.join('\n');
  if (!normalize(flat)) return [];

  const globalDate = detectDate(flat);
  const validez = detectValidity(flat, globalDate);
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
        bestIndex = i;
        bestScore = 1.2;
        break;
      }
      const score = scoreName(lines[i], worker.apellidosNombre);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0 || bestScore < 0.62) continue;

    const from = Math.max(0, bestIndex - 2);
    const to = Math.min(lines.length, bestIndex + 4);
    const windowText = lines.slice(from, to).join(' | ');
    let resultado = detectResult(windowText);
    if (!resultado && globalApto) resultado = 'Apto';
    if (!resultado) continue;

    const fechaReconocimiento = detectDate(windowText) || globalDate;
    const limitaciones = resultado === 'Apto con Limitación' ? detectLimitations(windowText) : '';
    const confianza: 'alta' | 'media' | 'baja' = bestScore >= 0.92 && !!detectResult(windowText)
      ? 'alta'
      : bestScore >= 0.75
        ? 'media'
        : 'baja';

    out.push({
      dni: worker.dni || '',
      apellidosNombre: worker.apellidosNombre,
      resultado,
      limitaciones,
      fechaReconocimiento,
      validez,
      centroMedico,
      observaciones: `Reconocido automáticamente desde ${sourceFilename} mediante extracción local/OCR.`,
      confianza,
      dniValido: true,
      fechaValida: !!fechaReconocimiento,
      centroValido: centroMedico !== 'No especificado',
      inconsistencias: [],
      matchedPersonId: worker.id,
      matchedPersonName: worker.apellidosNombre,
      archivoOrigen: sourceFilename,
    });
  }

  return out;
}
