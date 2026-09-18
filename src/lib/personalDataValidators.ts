export type ValidationResult = {
  valid: boolean;
  normalized: string;
  formatted?: string;
  error?: string;
};

export const normalizeSpanishSocialSecurityNumber = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

export const formatSpanishSocialSecurityNumber = (value: unknown): string => {
  const clean = normalizeSpanishSocialSecurityNumber(value);
  if (clean.length !== 12) return clean;
  return `${clean.slice(0, 2)}/${clean.slice(2, 10)}/${clean.slice(10)}`;
};

export const validateSpanishSocialSecurityNumber = (value: unknown): ValidationResult => {
  const normalized = normalizeSpanishSocialSecurityNumber(value);
  if (!normalized) return { valid: false, normalized, error: 'Número de la Seguridad Social vacío.' };
  if (normalized.length !== 12) return { valid: false, normalized, error: 'Debe contener 12 dígitos.' };
  if (!/^\d{12}$/.test(normalized)) return { valid: false, normalized, error: 'Solo puede contener números.' };
  const province = Number(normalized.slice(0, 2));
  const affiliation = Number(normalized.slice(2, 10));
  const control = Number(normalized.slice(10, 12));
  if (!Number.isInteger(province) || province < 1 || province > 53) {
    return { valid: false, normalized, error: 'Código provincial no válido.' };
  }
  if (!Number.isInteger(affiliation) || affiliation <= 0) {
    return { valid: false, normalized, error: 'Número de afiliación no válido.' };
  }
  const base = affiliation < 10000000
    ? province * 10000000 + affiliation
    : Number(`${normalized.slice(0, 2)}${normalized.slice(2, 10)}`);
  const expected = base % 97;
  if (expected !== control) return { valid: false, normalized, error: 'Dígitos de control incorrectos.' };
  return { valid: true, normalized, formatted: formatSpanishSocialSecurityNumber(normalized) };
};

export const normalizeIban = (value: unknown): string =>
  String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const formatIban = (value: unknown): string =>
  normalizeIban(value).replace(/(.{4})/g, '$1 ').trim();

const ibanMod97 = (iban: string): number => {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const expanded = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
};

const spanishCccValid = (iban: string): boolean => {
  if (!/^ES\d{22}$/.test(iban)) return false;
  const ccc = iban.slice(4);
  const weights = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
  const digit = (ten: string) => {
    const sum = ten.split('').reduce((acc, value, index) => acc + Number(value) * weights[index], 0);
    const raw = 11 - (sum % 11);
    return raw === 11 ? 0 : raw === 10 ? 1 : raw;
  };
  return Number(ccc[8]) === digit(`00${ccc.slice(0, 8)}`) && Number(ccc[9]) === digit(ccc.slice(10));
};

export const validateIban = (value: unknown): ValidationResult => {
  const normalized = normalizeIban(value);
  if (!normalized) return { valid: false, normalized, error: 'IBAN vacío.' };
  if (!/^ES\d{22}$/.test(normalized)) {
    return { valid: false, normalized, formatted: formatIban(normalized), error: 'El IBAN español debe comenzar por ES y contener 22 dígitos.' };
  }
  if (ibanMod97(normalized) !== 1) {
    return { valid: false, normalized, formatted: formatIban(normalized), error: 'Dígitos internacionales de control incorrectos.' };
  }
  if (!spanishCccValid(normalized)) {
    return { valid: false, normalized, formatted: formatIban(normalized), error: 'Dígitos nacionales de control de la cuenta incorrectos.' };
  }
  return { valid: true, normalized, formatted: formatIban(normalized) };
};

const correctOcrNumericPart = (value: string) => value
  .toUpperCase()
  .replace(/[OQD]/g, '0')
  .replace(/[IL|!]/g, '1')
  .replace(/Z/g, '2')
  .replace(/[S$]/g, '5')
  .replace(/G/g, '6')
  .replace(/B/g, '8');

const compactOcrToken = (value: string) => String(value || '')
  .toUpperCase()
  .replace(/[\s._,:;\/\\-]+/g, '');

const recoverNumericWindows = (raw: string, length: number): string[] => {
  const corrected = correctOcrNumericPart(compactOcrToken(raw)).replace(/\D/g, '');
  if (corrected.length < length) return [];
  if (corrected.length === length) return [corrected];
  const values: string[] = [];
  for (let i = 0; i <= corrected.length - length; i += 1) values.push(corrected.slice(i, i + length));
  return values;
};

const addCandidateIfValidNuss = (candidates: Set<string>, raw: string) => {
  const direct = normalizeSpanishSocialSecurityNumber(raw);
  if (validateSpanishSocialSecurityNumber(direct).valid) candidates.add(direct);

  const corrected = normalizeSpanishSocialSecurityNumber(correctOcrNumericPart(raw));
  if (validateSpanishSocialSecurityNumber(corrected).valid) candidates.add(corrected);

  // En tarjetas oficiales borrosas Tesseract puede pegar etiquetas, guiones o un dígito vecino.
  // Probamos todas las ventanas plausibles de 12 dígitos y solo aceptamos las que superan control MOD97.
  for (const candidate of recoverNumericWindows(raw, 12)) {
    if (validateSpanishSocialSecurityNumber(candidate).valid) candidates.add(candidate);
  }
};

const addCandidateIfValidIban = (candidates: Set<string>, raw: string) => {
  const compact = normalizeIban(raw);
  if (validateIban(compact).valid) candidates.add(compact);

  const prefixFixed = compact
    .replace(/^E[58]/, 'ES')
    .replace(/^3S/, 'ES')
    .replace(/^E\$/, 'ES')
    .replace(/^ES(?=[A-Z])/, 'ES');

  const tryCandidate = (value: string) => {
    if (!value.startsWith('ES')) return;
    const numeric = correctOcrNumericPart(value.slice(2)).replace(/\D/g, '');
    if (numeric.length !== 22) return;
    const candidate = `ES${numeric}`;
    if (validateIban(candidate).valid) candidates.add(candidate);
  };

  tryCandidate(prefixFixed);

  // Recupera IBAN cuando el OCR incluye texto contiguo antes/después.
  const compactRaw = compactOcrToken(raw).replace(/^E[58]/, 'ES').replace(/^3S/, 'ES');
  for (let index = 0; index < compactRaw.length - 23; index += 1) {
    const possiblePrefix = compactRaw.slice(index, index + 2).replace(/^E[58]$/, 'ES').replace(/^3S$/, 'ES');
    if (possiblePrefix !== 'ES') continue;
    tryCandidate(`ES${compactRaw.slice(index + 2, index + 24)}`);
  }
};

export type AdministrativeDataDetection = {
  nuss: string;
  iban: string;
  nussValid: boolean;
  ibanValid: boolean;
  warnings: string[];
};

export const detectAdministrativeDataFromText = (rawText: string): AdministrativeDataDetection => {
  const text = String(rawText || '').toUpperCase();
  const warnings: string[] = [];
  const nussCandidates = new Set<string>();
  const ibanCandidates = new Set<string>();

  const nussRegexes = [
    /(?:NUSS|N[ÚU]M(?:ERO)?\.?\s*(?:DE\s*)?(?:AFILIACI[ÓO]N|SEGURIDAD\s+SOCIAL)|NAF|N\.?(?:º|O)?\s*S\.?(?:S|SOCIAL)?|SEGURIDAD\s+SOCIAL|AFILIACI[ÓO]N|TGSS|TESORER[IÍ]A\s+GENERAL)[^A-Z0-9]{0,55}([0-9OQDIL|!ZSBG][0-9OQDIL|!ZSBG\s.\/-]{9,28})/g,
    /\b([0-9OQDIL|!ZSBG]{2}[\s.\/-]+[0-9OQDIL|!ZSBG]{7,8}[\s.\/-]+[0-9OQDIL|!ZSBG]{2})\b/g,
    /\b([0-9OQDIL|!ZSBG]{12})\b/g,
  ];
  for (const regex of nussRegexes) {
    for (const match of text.matchAll(regex)) addCandidateIfValidNuss(nussCandidates, match[1]);
  }

  const ibanRegexes = [
    /(?:IBAN|CUENTA\s+BANCARIA|CUENTA\s+CORRIENTE|N[ÚU]M(?:ERO)?\.?\s+DE\s+CUENTA|CERTIFICADO\s+(?:DE\s+)?TITULARIDAD|TITULARIDAD\s+(?:DE\s+)?CUENTA)[^A-Z0-9]{0,80}((?:ES|E[58]|3S|E\$)(?:[\s._,:;\/-]*[A-Z0-9]){22,30})/g,
    /\b((?:ES|E[58]|3S|E\$)(?:[\s._,:;\/-]*[A-Z0-9]){22})\b/g,
  ];
  for (const regex of ibanRegexes) {
    for (const match of text.matchAll(regex)) addCandidateIfValidIban(ibanCandidates, match[1]);
  }

  if (nussCandidates.size > 1) warnings.push('Se han detectado varios NUSS válidos; revisar el documento.');
  if (ibanCandidates.size > 1) warnings.push('Se han detectado varios IBAN válidos; revisar el documento.');
  const nuss = Array.from(nussCandidates)[0] || '';
  const iban = Array.from(ibanCandidates)[0] || '';
  return { nuss, iban, nussValid: !!nuss, ibanValid: !!iban, warnings };
};

export const maskIban = (value: unknown): string => {
  const normalized = normalizeIban(value);
  if (!normalized) return '';
  return `${normalized.slice(0, 2)}** **** **** **** **** ${normalized.slice(-4)}`;
};