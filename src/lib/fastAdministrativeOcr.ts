import { createWorker } from 'tesseract.js';
import { detectAdministrativeDataFromText } from './personalDataValidators';

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKET';

export type FastAdministrativeOcrResult = {
  text: string;
  dni: string;
  nuss: string;
  iban: string;
  pagesProcessed: number;
  elapsedMs: number;
  warnings: string[];
};

const compactDocument = (value: string) => String(value || '')
  .toUpperCase()
  .replace(/[\s.-]/g, '');

export const isValidSpanishIdentityDocument = (value: string): boolean => {
  const clean = compactDocument(value);
  const dni = clean.match(/^(\d{8})([A-Z])$/);
  if (dni) return DNI_LETTERS[Number(dni[1]) % 23] === dni[2];

  const nie = clean.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (!nie) return false;
  const prefix = nie[1] === 'X' ? '0' : nie[1] === 'Y' ? '1' : '2';
  return DNI_LETTERS[Number(`${prefix}${nie[2]}`) % 23] === nie[3];
};

const detectIdentityDocument = (rawText: string): string => {
  const text = String(rawText || '').toUpperCase();
  const candidates = new Set<string>();
  const patterns = [
    /(?:DNI|NIF|NIE|DOCUMENTO(?:\s+NACIONAL)?(?:\s+DE\s+IDENTIDAD)?)[^A-Z0-9]{0,20}([XYZ]?\s*\d(?:[\s.-]*\d){6,7}[\s.-]*[A-Z])/g,
    /\b([XYZ]\s*\d(?:[\s.-]*\d){6}[\s.-]*[A-Z])\b/g,
    /\b(\d(?:[\s.-]*\d){7}[\s.-]*[A-Z])\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = compactDocument(match[1]);
      if (isValidSpanishIdentityDocument(candidate)) candidates.add(candidate);
    }
  }

  return Array.from(candidates)[0] || '';
};

const normalizedWords = (value: string) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9Ñ]+/g, ' ')
  .split(/\s+/)
  .filter(word => word.length >= 3);

export const documentLikelyMatchesPerson = (personName: string, documentText: string): boolean => {
  const nameWords = Array.from(new Set(normalizedWords(personName)));
  if (!nameWords.length) return true;
  const documentWords = new Set(normalizedWords(documentText));
  const matches = nameWords.filter(word => documentWords.has(word)).length;
  const minimum = nameWords.length <= 2 ? nameWords.length : Math.max(2, Math.ceil(nameWords.length * 0.6));
  return matches >= minimum;
};

export async function recognizeAdministrativePagesFast(
  pages: Array<{ base64: string; name?: string }>,
  onProgress?: (message: string) => void,
): Promise<FastAdministrativeOcrResult> {
  const started = performance.now();
  const warnings: string[] = [];
  const texts: string[] = [];
  let pagesProcessed = 0;
  let dni = '';
  let nuss = '';
  let iban = '';

  // Reutilizamos UN solo worker para todas las páginas. Crear/terminar Tesseract por
  // cada foto era el principal coste fijo del flujo anterior.
  onProgress?.('Preparando OCR rápido…');
  const worker = await createWorker('spa');
  try {
    for (let index = 0; index < pages.length; index += 1) {
      onProgress?.(`Leyendo página ${index + 1}/${pages.length}…`);
      const result = await worker.recognize(pages[index].base64);
      pagesProcessed += 1;
      const text = String(result?.data?.text || '').trim();
      if (text) texts.push(text);

      const combined = texts.join('\n\n');
      const administrative = detectAdministrativeDataFromText(combined);
      if (!nuss && administrative.nuss) nuss = administrative.nuss;
      if (!iban && administrative.iban) iban = administrative.iban;
      if (!dni) dni = detectIdentityDocument(combined);
      for (const warning of administrative.warnings) {
        if (!warnings.includes(warning)) warnings.push(warning);
      }

      // En cuanto están los tres datos objetivo no procesamos fotos adicionales.
      if (dni && nuss && iban) break;
    }
  } finally {
    await worker.terminate();
  }

  return {
    text: texts.join('\n\n'),
    dni,
    nuss,
    iban,
    pagesProcessed,
    elapsedMs: Math.round(performance.now() - started),
    warnings,
  };
}
