from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label} anchor missing')
    return text.replace(old, new, 1)


validators = r'''export type ValidationResult = {
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
'''
Path('src/lib/personalDataValidators.ts').write_text(validators)

p = Path('types.ts')
s = p.read_text()
if 'numeroSeguridadSocial?: string;' not in s:
    s = replace_once(s, '  telefono: string;\n', '  telefono: string;\n  numeroSeguridadSocial?: string;\n  iban?: string;\n', 'types')
p.write_text(s)

p = Path('src/services/databaseService.ts')
s = p.read_text()
if 'numero_seguridad_social: value.numeroSeguridadSocial' not in s:
    s = replace_once(s, '      telefono: value.telefono || "",\n      calzado:', '      telefono: value.telefono || "",\n      numero_seguridad_social: value.numeroSeguridadSocial || null,\n      iban: value.iban || null,\n      calzado:', 'database serializer')
p.write_text(s)

p = Path('components/RegistrationForm.tsx')
s = p.read_text()
if 'personalDataValidators' not in s:
    s = replace_once(s, "import { motion, AnimatePresence } from 'motion/react';", "import { motion, AnimatePresence } from 'motion/react';\nimport { formatIban, formatSpanishSocialSecurityNumber, normalizeIban, normalizeSpanishSocialSecurityNumber, validateIban, validateSpanishSocialSecurityNumber } from '../src/lib/personalDataValidators';", 'registration import')
if "numeroSeguridadSocial: ''," not in s:
    s = replace_once(s, "    telefono: '',\n    calzado:", "    telefono: '',\n    numeroSeguridadSocial: '',\n    iban: '',\n    calzado:", 'registration state')
if 'matchedPerson.numeroSeguridadSocial' not in s:
    s = replace_once(s, '            telefono: matchedPerson.telefono || prev.telefono,\n            categoria:', '            telefono: matchedPerson.telefono || prev.telefono,\n            numeroSeguridadSocial: matchedPerson.numeroSeguridadSocial || prev.numeroSeguridadSocial,\n            iban: matchedPerson.iban || prev.iban,\n            categoria:', 'registration repeat data')
if "name === 'numeroSeguridadSocial'" not in s:
    s = replace_once(s, "    if (name === 'dni') {", "    if (name === 'numeroSeguridadSocial') {\n      setFormData(prev => ({ ...prev, numeroSeguridadSocial: value.replace(/[^0-9\\s\\/-]/g, '') }));\n      return;\n    }\n    if (name === 'iban') {\n      setFormData(prev => ({ ...prev, iban: value.toUpperCase().replace(/[^A-Z0-9\\s]/g, '') }));\n      return;\n    }\n\n    if (name === 'dni') {", 'registration input normalizers')
if 'profea:administrative-data-recognized' not in s:
    anchor = "  useEffect(() => {\n    setFormData(prev => ({ ...prev, quincena: `${qType} ${qMonth} ${qYear}` }));\n  }, [qType, qMonth, qYear]);\n"
    listener = anchor + "\n  useEffect(() => {\n    const handleAdministrativeScan = (event: Event) => {\n      const detail = (event as CustomEvent<{ nuss?: string; iban?: string }>).detail || {};\n      if (!detail.nuss && !detail.iban) return;\n      setFormData(prev => {\n        const next = { ...prev };\n        if (detail.nuss) {\n          const detected = normalizeSpanishSocialSecurityNumber(detail.nuss);\n          if (!prev.numeroSeguridadSocial || normalizeSpanishSocialSecurityNumber(prev.numeroSeguridadSocial) === detected || window.confirm('Este registro ya tiene un Nº de Seguridad Social. ¿Sustituirlo por el detectado?')) next.numeroSeguridadSocial = detected;\n        }\n        if (detail.iban) {\n          const detected = normalizeIban(detail.iban);\n          if (!prev.iban || normalizeIban(prev.iban) === detected || window.confirm('Este registro ya tiene un IBAN. ¿Sustituirlo por el detectado?')) next.iban = detected;\n        }\n        return next;\n      });\n    };\n    window.addEventListener('profea:administrative-data-recognized', handleAdministrativeScan as EventListener);\n    return () => window.removeEventListener('profea:administrative-data-recognized', handleAdministrativeScan as EventListener);\n  }, []);\n"
    s = replace_once(s, anchor, listener, 'registration scanner listener')
if 'const nussCheck = formData.numeroSeguridadSocial' not in s:
    anchor = '    if (isPeriodInvalid) {'
    checks = "    const nussCheck = formData.numeroSeguridadSocial ? validateSpanishSocialSecurityNumber(formData.numeroSeguridadSocial) : null;\n    if (nussCheck && !nussCheck.valid) {\n      alert(`⚠️ Número de la Seguridad Social no válido. ${nussCheck.error || ''}`);\n      document.getElementById('nuss-input')?.focus();\n      return;\n    }\n    const duplicateNuss = nussCheck?.valid && (people || []).some(p => normalizeSpanishSocialSecurityNumber(p.numeroSeguridadSocial) === nussCheck.normalized);\n    if (duplicateNuss) {\n      alert('⚠️ Este Número de la Seguridad Social ya está asociado a otro registro. Revisa el trabajador antes de continuar.');\n      document.getElementById('nuss-input')?.focus();\n      return;\n    }\n    const ibanCheck = formData.iban ? validateIban(formData.iban) : null;\n    if (ibanCheck && !ibanCheck.valid) {\n      alert(`⚠️ IBAN no válido. ${ibanCheck.error || ''}`);\n      document.getElementById('iban-input')?.focus();\n      return;\n    }\n    if (nussCheck?.valid) formData.numeroSeguridadSocial = nussCheck.normalized;\n    if (ibanCheck?.valid) formData.iban = ibanCheck.normalized;\n\n" + anchor
    s = replace_once(s, anchor, checks, 'registration submit checks')
# Add reset values exactly once in reset block if still absent after handle submit area.
reset_anchor = "      telefono: '',\n      calzado:"
if s.count("numeroSeguridadSocial: '',") < 2 and reset_anchor in s:
    s = s.replace(reset_anchor, "      telefono: '',\n      numeroSeguridadSocial: '',\n      iban: '',\n      calzado:", 1)
if 'const nussAnalysis = useMemo' not in s:
    s = replace_once(s, '  const isPeriodInvalid = useMemo(() => {', "  const nussAnalysis = useMemo(() => formData.numeroSeguridadSocial ? validateSpanishSocialSecurityNumber(formData.numeroSeguridadSocial) : null, [formData.numeroSeguridadSocial]);\n  const ibanAnalysis = useMemo(() => formData.iban ? validateIban(formData.iban) : null, [formData.iban]);\n\n  const isPeriodInvalid = useMemo(() => {", 'registration computed validation')
if 'id="nuss-input"' not in s:
    phone_anchor = '''          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">\n            <div className="space-y-1.5">\n              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Teléfono</label>'''
    admin_ui = r'''          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Nº Seguridad Social</label>
              <input id="nuss-input" type="text" name="numeroSeguridadSocial" value={formData.numeroSeguridadSocial || ''} onChange={handleChange} placeholder="11/12345678/90" className={`w-full p-2.5 rounded-xl focus:outline-none transition-all text-sm font-mono text-slate-800 dark:text-slate-100 ${nussAnalysis ? (nussAnalysis.valid ? 'border border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10' : 'border-2 border-red-500 bg-red-50/20 dark:bg-red-950/10') : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-brand-primary'}`} />
              {nussAnalysis && <p className={`text-[11px] font-semibold ${nussAnalysis.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{nussAnalysis.valid ? `✓ Número válido · ${formatSpanishSocialSecurityNumber(nussAnalysis.normalized)}` : `✕ ${nussAnalysis.error}`}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">IBAN / Cuenta bancaria</label>
              <input id="iban-input" type="text" name="iban" value={formData.iban || ''} onChange={handleChange} placeholder="ES00 0000 0000 0000 0000 0000" className={`w-full p-2.5 rounded-xl focus:outline-none transition-all text-sm font-mono text-slate-800 dark:text-slate-100 ${ibanAnalysis ? (ibanAnalysis.valid ? 'border border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10' : 'border-2 border-red-500 bg-red-50/20 dark:bg-red-950/10') : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-brand-primary'}`} />
              {ibanAnalysis && <p className={`text-[11px] font-semibold ${ibanAnalysis.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{ibanAnalysis.valid ? `✓ IBAN válido · ${formatIban(ibanAnalysis.normalized)}` : `✕ ${ibanAnalysis.error}`}</p>}
              <p className="text-[10px] text-slate-400">También puedes capturarlos desde Cámara escáner → Seguridad Social / IBAN.</p>
            </div>
          </div>

''' + phone_anchor
    s = replace_once(s, phone_anchor, admin_ui, 'registration admin UI')
p.write_text(s)

p = Path('components/EditPersonModal.tsx')
s = p.read_text()
if 'personalDataValidators' not in s:
    s = replace_once(s, "import { motion, AnimatePresence } from 'motion/react';", "import { motion, AnimatePresence } from 'motion/react';\nimport { formatIban, formatSpanishSocialSecurityNumber, validateIban, validateSpanishSocialSecurityNumber } from '../src/lib/personalDataValidators';", 'edit import')
if "name === 'numeroSeguridadSocial'" not in s:
    s = replace_once(s, "    if (name === 'reconocimientoEstado'", "    if (name === 'numeroSeguridadSocial') {\n      setFormData(prev => prev ? ({ ...prev, numeroSeguridadSocial: value.replace(/[^0-9\\s\\/-]/g, '') }) : null);\n      return;\n    }\n    if (name === 'iban') {\n      setFormData(prev => prev ? ({ ...prev, iban: value.toUpperCase().replace(/[^A-Z0-9\\s]/g, '') }) : null);\n      return;\n    }\n    if (name === 'reconocimientoEstado'", 'edit input normalizers')
if 'Este Número de la Seguridad Social ya está asociado a otro trabajador' not in s:
    anchor = '    // Un DNI repetido representa una nueva contratación del mismo trabajador.'
    checks = "    if (formData.numeroSeguridadSocial) {\n      const check = validateSpanishSocialSecurityNumber(formData.numeroSeguridadSocial);\n      if (!check.valid) { alert(`⚠️ Número de la Seguridad Social no válido. ${check.error || ''}`); return; }\n      formData.numeroSeguridadSocial = check.normalized;\n      const duplicate = allPeople.some(p => p.id !== formData.id && p.numeroSeguridadSocial && validateSpanishSocialSecurityNumber(p.numeroSeguridadSocial).normalized === check.normalized);\n      if (duplicate) { alert('⚠️ Este Número de la Seguridad Social ya está asociado a otro trabajador.'); return; }\n    }\n    if (formData.iban) {\n      const check = validateIban(formData.iban);\n      if (!check.valid) { alert(`⚠️ IBAN no válido. ${check.error || ''}`); return; }\n      formData.iban = check.normalized;\n    }\n" + anchor
    s = replace_once(s, anchor, checks, 'edit submit checks')
# Add edit fields before medical block heading if clear anchor exists.
if 'name="numeroSeguridadSocial"' not in s:
    anchor = '            <div className="space-y-6">\n              <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center"><Activity'
    if anchor in s:
        admin_ui = r'''            <div className="space-y-6">
              <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Datos administrativos</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Nº Seguridad Social</label>
                  <input type="text" name="numeroSeguridadSocial" value={formData.numeroSeguridadSocial || ''} onChange={handleChange} placeholder="11/12345678/90" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono text-slate-800 dark:text-slate-100" />
                  {!!formData.numeroSeguridadSocial && <p className={`text-[10px] ${validateSpanishSocialSecurityNumber(formData.numeroSeguridadSocial).valid ? 'text-emerald-600' : 'text-red-600'}`}>{validateSpanishSocialSecurityNumber(formData.numeroSeguridadSocial).valid ? `✓ ${formatSpanishSocialSecurityNumber(formData.numeroSeguridadSocial)}` : '✕ Número no válido'}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">IBAN / Cuenta bancaria</label>
                  <input type="text" name="iban" value={formData.iban || ''} onChange={handleChange} placeholder="ES00 0000 0000 0000 0000 0000" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono text-slate-800 dark:text-slate-100" />
                  {!!formData.iban && <p className={`text-[10px] ${validateIban(formData.iban).valid ? 'text-emerald-600' : 'text-red-600'}`}>{validateIban(formData.iban).valid ? `✓ ${formatIban(formData.iban)}` : '✕ IBAN no válido'}</p>}
                </div>
              </div>
            </div>

''' + anchor
        s = s.replace(anchor, admin_ui, 1)
p.write_text(s)

p = Path('components/CameraScannerModal.tsx')
s = p.read_text()
if 'extractClientDocumentText' not in s:
    s = replace_once(s, "import { getBase64Image, OFFICIAL_LOGO_BASE64 } from '../src/lib/exportUtils';", "import { getBase64Image, OFFICIAL_LOGO_BASE64 } from '../src/lib/exportUtils';\nimport { extractClientDocumentText } from '../src/lib/clientDocumentText';\nimport { detectAdministrativeDataFromText, formatIban, formatSpanishSocialSecurityNumber } from '../src/lib/personalDataValidators';", 'camera imports')
if 'isRecognizingAdministrative' not in s:
    s = replace_once(s, '  const [isRecognizing, setIsRecognizing] = useState(false);', '  const [isRecognizing, setIsRecognizing] = useState(false);\n  const [isRecognizingAdministrative, setIsRecognizingAdministrative] = useState(false);', 'camera state')
if 'handleRecognizeAdministrativeData' not in s:
    anchor = '  const handleWorkerFieldChange = (index: number, field: keyof WorkerRelation, value: string) => {'
    fn = r'''  const dataUrlToFile = async (dataUrl: string, name: string): Promise<File> => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], name || 'documento.jpg', { type: blob.type || 'image/jpeg' });
  };

  const handleRecognizeAdministrativeData = async () => {
    if (!pages.length) {
      onToast('Captura primero el documento que contiene Seguridad Social o IBAN.', 'error');
      return;
    }
    setIsRecognizingAdministrative(true);
    try {
      const texts: string[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const file = await dataUrlToFile(pages[index].base64, pages[index].name);
        const extracted = await extractClientDocumentText(file, (message) => setRecognitionStep(`${message} · ${index + 1}/${pages.length}`));
        if (extracted.text) texts.push(extracted.text);
      }
      const detected = detectAdministrativeDataFromText(texts.join('\n\n'));
      if (!detected.nuss && !detected.iban) {
        onToast('No se ha detectado un Nº de Seguridad Social o IBAN válido. Repite la foto o introdúcelo manualmente.', 'error');
        return;
      }
      const lines = [
        detected.nuss ? `Nº Seguridad Social: ${formatSpanishSocialSecurityNumber(detected.nuss)}` : 'Nº Seguridad Social: no detectado',
        detected.iban ? `IBAN: ${formatIban(detected.iban)}` : 'IBAN: no detectado',
        ...detected.warnings,
      ];
      if (!window.confirm(`DATOS ADMINISTRATIVOS DETECTADOS\n\n${lines.join('\n')}\n\n¿Incorporar estos datos al trabajador que estás registrando?`)) return;
      window.dispatchEvent(new CustomEvent('profea:administrative-data-recognized', { detail: { nuss: detected.nuss, iban: detected.iban } }));
      onToast('Datos administrativos validados e incorporados al registro en curso.', 'success');
      handleClose();
    } catch (error: any) {
      console.error('OCR administrativo:', error?.message || error);
      onToast('No se han podido reconocer los datos administrativos. Puedes repetir el escaneo o introducirlos manualmente.', 'error');
    } finally {
      setIsRecognizingAdministrative(false);
      setRecognitionStep('');
    }
  };

''' + anchor
    s = replace_once(s, anchor, fn, 'camera OCR function')
if 'title="Reconocer Nº de Seguridad Social e IBAN con OCR local"' not in s:
    anchor = '''                {pages.length > 0 && (\n                  <button\n                    onClick={handleRecognizeWorkers}'''
    button = r'''                {pages.length > 0 && (
                  <button
                    onClick={handleRecognizeAdministrativeData}
                    disabled={isRecognizingAdministrative || isRecognizing}
                    className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                    title="Reconocer Nº de Seguridad Social e IBAN con OCR local"
                  >
                    {isRecognizingAdministrative ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                    Seguridad Social / IBAN
                  </button>
                )}

''' + anchor
    s = replace_once(s, anchor, button, 'camera admin button')
p.write_text(s)

Path('supabase/migrations/20260915170500_add_worker_nuss_iban.sql').write_text(r'''-- Datos administrativos del trabajador. Nullable para compatibilidad histórica.
alter table public.trabajadores
  add column if not exists numero_seguridad_social text null,
  add column if not exists iban text null;

create index if not exists trabajadores_nuss_owner_idx
  on public.trabajadores(owner_id, numero_seguridad_social)
  where numero_seguridad_social is not null and numero_seguridad_social <> '';

comment on column public.trabajadores.numero_seguridad_social is 'NUSS/NAF normalizado (12 dígitos). Validado en aplicación antes de persistir.';
comment on column public.trabajadores.iban is 'IBAN normalizado. Dato administrativo sensible sujeto a las RLS existentes de trabajadores.';
''')

print('worker administrative-data patch applied')
