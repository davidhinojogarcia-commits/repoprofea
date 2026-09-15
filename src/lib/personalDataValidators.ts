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
  .replace(/[OQ]/g, '0')
  .replace(/[IL]/g, '1')
  .replace(/S/g, '5')
  .replace(/B/g, '8');

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
    /(?:NUSS|NAF|SEGURIDAD\s+SOCIAL|AFILIACI[ÓO]N)[^0-9]{0,30}(\d{2}[\s\/-]*\d{8}[\s\/-]*\d{2})/g,
    /\b(\d{2}[\s\/-]+\d{8}[\s\/-]+\d{2})\b/g,
    /\b(\d{12})\b/g,
  ];
  for (const regex of nussRegexes) {
    for (const match of text.matchAll(regex)) {
      const candidate = normalizeSpanishSocialSecurityNumber(match[1]);
      if (validateSpanishSocialSecurityNumber(candidate).valid) nussCandidates.add(candidate);
    }
  }
  const ibanRaw = text.match(/ES(?:[\s-]*[A-Z0-9]){22}/g) || [];
  for (const raw of ibanRaw) {
    const compact = normalizeIban(raw);
    if (validateIban(compact).valid) {
      ibanCandidates.add(compact);
      continue;
    }
    if (compact.startsWith('ES') && compact.length === 24) {
      const corrected = `ES${correctOcrNumericPart(compact.slice(2))}`;
      if (validateIban(corrected).valid) ibanCandidates.add(corrected);
    }
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
