import { createWorker } from 'tesseract.js';
import { detectAdministrativeDataFromText } from './personalDataValidators';

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKET';

export type FastAdministrativeOcrResult = {
  text: string;
  dni: string;
  birthDate: string;
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

const toIsoBirthDate = (day: string, month: string, year: string): string => {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return '';
  if (y < 1900 || y > new Date().getFullYear()) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const detectBirthDate = (rawText: string): string => {
  const text = String(rawText || '').toUpperCase();
  const patterns = [
    /(?:FECHA\s+DE\s+NACIMIENTO|F\.\s*NACIMIENTO|F\.\s*NAC\.?|NACIMIENTO|NAC\.?)[^0-9]{0,25}(\d{1,2})[\s.\/-](\d{1,2})[\s.\/-](\d{4})/g,
    /(?:DATE\s+OF\s+BIRTH|BIRTH)[^0-9]{0,25}(\d{1,2})[\s.\/-](\d{1,2})[\s.\/-](\d{4})/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const iso = toIsoBirthDate(match[1], match[2], match[3]);
      if (iso) return iso;
    }
  }
  return '';
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

const prepareImageForOcr = (base64: string): Promise<string> => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const maxWidth = 1800;
    const scale = img.width > maxWidth ? maxWidth / img.width : Math.min(1.5, 1800 / Math.max(1, img.width));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return resolve(base64);
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      const contrasted = gray < 150 ? Math.max(0, gray - 35) : Math.min(255, gray + 25);
      data[i] = contrasted;
      data[i + 1] = contrasted;
      data[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);
    resolve(canvas.toDataURL('image/png'));
  };
  img.onerror = () => resolve(base64);
  img.src = base64;
});

export async function recognizeAdministrativePagesFast(
  pages: Array<{ base64: string; name?: string }>,
  onProgress?: (message: string) => void,
): Promise<FastAdministrativeOcrResult> {
  const started = performance.now();
  const warnings: string[] = [];
  const texts: string[] = [];
  let pagesProcessed = 0;
  let dni = '';
  let birthDate = '';
  let nuss = '';
  let iban = '';

  onProgress?.('Preparando OCR rápido…');
  const worker = await createWorker('spa');
  try {
    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '6',
    } as any);

    for (let index = 0; index < pages.length; index += 1) {
      onProgress?.(`Mejorando imagen y leyendo página ${index + 1}/${pages.length}…`);
      const prepared = await prepareImageForOcr(pages[index].base64);
      const result = await worker.recognize(prepared);
      pagesProcessed += 1;
      const text = String(result?.data?.text || '').trim();
      if (text) texts.push(text);

      const combined = texts.join('\n\n');
      const administrative = detectAdministrativeDataFromText(combined);
      if (!nuss && administrative.nuss) nuss = administrative.nuss;
      if (!iban && administrative.iban) iban = administrative.iban;
      if (!dni) dni = detectIdentityDocument(combined);
      if (!birthDate) birthDate = detectBirthDate(combined);
      for (const warning of administrative.warnings) {
        if (!warnings.includes(warning)) warnings.push(warning);
      }

      if (dni && birthDate && nuss && iban) break;
    }
  } finally {
    await worker.terminate();
  }

  if (!nuss) warnings.push('No se pudo validar automáticamente el Nº de Seguridad Social. Revisa que el número completo sea visible y nítido.');
  if (!iban) warnings.push('No se pudo validar automáticamente el IBAN. Revisa que aparezca completo, incluido ES y sus 22 dígitos.');

  return {
    text: texts.join('\n\n'),
    dni,
    birthDate,
    nuss,
    iban,
    pagesProcessed,
    elapsedMs: Math.round(performance.now() - started),
    warnings,
  };
}