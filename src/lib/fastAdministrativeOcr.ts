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

const correctIdentityOcr = (value: string) => String(value || '')
  .toUpperCase()
  .replace(/[\s._,:;\/\\-]/g, '')
  .replace(/[OQD]/g, '0')
  .replace(/[IL|!]/g, '1')
  .replace(/S(?=\d)/g, '5')
  .replace(/B(?=\d)/g, '8')
  .replace(/G(?=\d)/g, '6');

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
    /(?:DNI|NIF|NIE|NUM(?:ERO)?\.?\s*DOC(?:UMENTO)?|DOCUMENTO(?:\s+NACIONAL)?(?:\s+DE\s+IDENTIDAD)?)[^A-Z0-9]{0,35}([XYZ0-9OQDIL|!SBG][A-Z0-9OQDIL|!SBG\s._,:;\/-]{7,16}[A-Z])/g,
    /\b([XYZ]\s*[0-9OQDIL|!SBG](?:[\s._,:;\/-]*[0-9OQDIL|!SBG]){6}[\s._,:;\/-]*[A-Z])\b/g,
    /\b([0-9OQDIL|!SBG](?:[\s._,:;\/-]*[0-9OQDIL|!SBG]){7}[\s._,:;\/-]*[A-Z])\b/g,
  ];

  const addCandidate = (raw: string) => {
    const direct = compactDocument(raw);
    if (isValidSpanishIdentityDocument(direct)) candidates.add(direct);

    const corrected = correctIdentityOcr(raw);
    // Preservamos X/Y/Z inicial si existe; el resto del cuerpo debe ser numérico.
    const nie = corrected.match(/^([XYZ])(.*)([A-Z])$/);
    if (nie) {
      const body = nie[2].replace(/\D/g, '').slice(0, 7);
      const value = `${nie[1]}${body}${nie[3]}`;
      if (body.length === 7 && isValidSpanishIdentityDocument(value)) candidates.add(value);
    }

    const dni = corrected.match(/^(.*)([A-Z])$/);
    if (dni) {
      const body = dni[1].replace(/\D/g, '');
      for (let i = 0; i <= body.length - 8; i += 1) {
        const value = `${body.slice(i, i + 8)}${dni[2]}`;
        if (isValidSpanishIdentityDocument(value)) candidates.add(value);
      }
    }
  };

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) addCandidate(match[1]);
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
  const labels = [
    /(?:FECHA\s*(?:DE)?\s*NACIMIENTO|F\.\s*NACIMIENTO|F\.\s*NAC\.?|NACIMIENTO|NAC\.?|NACIDO\/?A|DATE\s+OF\s+BIRTH|BIRTH|DOB)[^0-9OQDIL|!SBG]{0,35}([0-9OQDIL|!SBG]{1,2})[\s.\/-]+([0-9OQDIL|!SBG]{1,2})[\s.\/-]+([0-9OQDIL|!SBG]{4})/g,
    /(?:FECHA\s*(?:DE)?\s*NACIMIENTO|NACIMIENTO|NAC\.?|DOB)[^0-9OQDIL|!SBG]{0,35}([0-9OQDIL|!SBG]{2})([0-9OQDIL|!SBG]{2})([0-9OQDIL|!SBG]{4})/g,
  ];
  const fix = (value: string) => correctIdentityOcr(value).replace(/\D/g, '');
  for (const pattern of labels) {
    for (const match of text.matchAll(pattern)) {
      const iso = toIsoBirthDate(fix(match[1]), fix(match[2]), fix(match[3]));
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

const prepareImageVariantsForOcr = (base64: string): Promise<string[]> => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const targetWidth = Math.min(2600, Math.max(1900, img.width * 2));
    const scale = Math.max(1, targetWidth / Math.max(1, img.width));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    if (!sctx) return resolve([base64]);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, width, height);

    const raw = sctx.getImageData(0, 0, width, height);
    const gray = new Uint8ClampedArray(raw.data.length);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < raw.data.length; i += 4) {
      const g = Math.round(raw.data[i] * 0.299 + raw.data[i + 1] * 0.587 + raw.data[i + 2] * 0.114);
      gray[i] = gray[i + 1] = gray[i + 2] = g;
      gray[i + 3] = 255;
      sum += g;
      count += 1;
    }
    const mean = count ? sum / count : 150;

    const makeVariant = (mode: 'contrast' | 'threshold') => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return base64;
      const imageData = new ImageData(new Uint8ClampedArray(gray), width, height);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        const value = d[i];
        let out = value;
        if (mode === 'contrast') {
          // Alto contraste + realce suave para texto gris/borroso.
          out = Math.max(0, Math.min(255, Math.round((value - mean) * 1.9 + 128)));
          if (out < 110) out = Math.max(0, out - 25);
          if (out > 185) out = Math.min(255, out + 20);
        } else {
          const threshold = Math.max(115, Math.min(185, mean * 0.92));
          out = value < threshold ? 0 : 255;
        }
        d[i] = d[i + 1] = d[i + 2] = out;
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL('image/png');
    };

    resolve([makeVariant('contrast'), makeVariant('threshold')]);
  };
  img.onerror = () => resolve([base64]);
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
      const variants = await prepareImageVariantsForOcr(pages[index].base64);
      const pageTexts: string[] = [];

      // Primera pasada: bloques de texto. Segunda: texto disperso, muy útil en tarjetas y certificados.
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        await worker.setParameters({
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: variantIndex === 0 ? '6' : '11',
        } as any);
        const result = await worker.recognize(variants[variantIndex]);
        const text = String(result?.data?.text || '').trim();
        if (text) pageTexts.push(text);

        const probe = [...texts, ...pageTexts].join('\n\n');
        const administrative = detectAdministrativeDataFromText(probe);
        if (!nuss && administrative.nuss) nuss = administrative.nuss;
        if (!iban && administrative.iban) iban = administrative.iban;
        if (!dni) dni = detectIdentityDocument(probe);
        if (!birthDate) birthDate = detectBirthDate(probe);
        for (const warning of administrative.warnings) {
          if (!warnings.includes(warning)) warnings.push(warning);
        }

        // Si ya encontramos los cuatro campos no gastamos una segunda pasada.
        if (dni && birthDate && nuss && iban) break;
      }

      pagesProcessed += 1;
      if (pageTexts.length) texts.push(pageTexts.join('\n'));
      if (dni && birthDate && nuss && iban) break;
    }
  } finally {
    await worker.terminate();
  }

  if (!dni) warnings.push('No se pudo validar automáticamente el DNI/NIE completo con su letra de control.');
  if (!birthDate) warnings.push('No se pudo identificar con seguridad la fecha de nacimiento del documento de identidad.');
  if (!nuss) warnings.push('No se pudo validar automáticamente el Nº de Seguridad Social. Revisa que el número completo sea visible.');
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