from pathlib import Path
import re

# Camera scanner: use the fast batch OCR and include DNI in the same pass.
p = Path('components/CameraScannerModal.tsx')
text = p.read_text(encoding='utf-8')
import_old = "import { extractClientDocumentText } from '../src/lib/clientDocumentText';\n"
import_new = import_old + "import { recognizeAdministrativePagesFast } from '../src/lib/fastAdministrativeOcr';\n"
if "fastAdministrativeOcr" not in text:
    if import_old not in text:
        raise SystemExit('CameraScannerModal import anchor not found')
    text = text.replace(import_old, import_new, 1)

pattern = re.compile(r"  const handleRecognizeAdministrativeData = async \(\) => \{.*?\n  \};\n\n  const handleWorkerFieldChange", re.S)
replacement = '''  const handleRecognizeAdministrativeData = async () => {
    if (!pages.length) {
      onToast('Captura primero el documento que contiene DNI/NIE, Seguridad Social o IBAN.', 'error');
      return;
    }
    setIsRecognizingAdministrative(true);
    try {
      const detected = await recognizeAdministrativePagesFast(
        pages.map(page => ({ base64: page.base64, name: page.name })),
        (message) => setRecognitionStep(message),
      );

      if (!detected.dni && !detected.nuss && !detected.iban) {
        onToast('No se han detectado DNI/NIE, Nº de Seguridad Social o IBAN válidos. Repite la foto o introdúcelos manualmente.', 'error');
        return;
      }

      const elapsed = Math.max(0.1, detected.elapsedMs / 1000).toFixed(1);
      const lines = [
        detected.dni ? `DNI/NIE: ${detected.dni}` : 'DNI/NIE: no detectado',
        detected.nuss ? `Nº Seguridad Social: ${formatSpanishSocialSecurityNumber(detected.nuss)}` : 'Nº Seguridad Social: no detectado',
        detected.iban ? `IBAN: ${formatIban(detected.iban)}` : 'IBAN: no detectado',
        `OCR: ${detected.pagesProcessed} página(s) · ${elapsed} s`,
        ...detected.warnings,
      ];

      if (!window.confirm(`DATOS DETECTADOS\n\n${lines.join('\\n')}\n\n¿Incorporar estos datos al trabajador que estás registrando?`)) return;

      window.dispatchEvent(new CustomEvent('profea:administrative-data-recognized', {
        detail: {
          dni: detected.dni,
          nuss: detected.nuss,
          iban: detected.iban,
          documentText: detected.text,
        },
      }));
      onToast(`Datos reconocidos en ${elapsed} s e incorporados al registro en curso.`, 'success');
      handleClose();
    } catch (error: any) {
      console.error('OCR administrativo rápido:', error?.message || error);
      onToast('No se han podido reconocer los datos. Puedes repetir el escaneo o introducirlos manualmente.', 'error');
    } finally {
      setIsRecognizingAdministrative(false);
      setRecognitionStep('');
    }
  };

  const handleWorkerFieldChange'''
text2, n = pattern.subn(replacement, text, count=1)
if n != 1:
    raise SystemExit(f'CameraScannerModal function replacement count={n}')
p.write_text(text2, encoding='utf-8')

# Registration form: fill DNI too and cross-check the SAE/person name against OCR text.
p = Path('components/RegistrationForm.tsx')
text = p.read_text(encoding='utf-8')
anchor = "const isValidDNI = (dni: string): boolean => {\n  return analyzeDNI(dni).status === 'valid';\n};\n"
helper = anchor + '''\nconst normalizeIdentityWords = (value: string) => String(value || '')
  .normalize('NFD')
  .replace(/[\\u0300-\\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9Ñ]+/g, ' ')
  .split(/\\s+/)
  .filter(word => word.length >= 3);

const documentLikelyMatchesPerson = (personName: string, documentText: string): boolean => {
  const nameWords = Array.from(new Set(normalizeIdentityWords(personName)));
  if (!nameWords.length || !documentText) return true;
  const docWords = new Set(normalizeIdentityWords(documentText));
  const matches = nameWords.filter(word => docWords.has(word)).length;
  const minimum = nameWords.length <= 2 ? nameWords.length : Math.max(2, Math.ceil(nameWords.length * 0.6));
  return matches >= minimum;
};
'''
if 'const normalizeIdentityWords' not in text:
    if anchor not in text:
        raise SystemExit('RegistrationForm DNI helper anchor not found')
    text = text.replace(anchor, helper, 1)

old = '''    const handleAdministrativeScan = (event: Event) => {
      const detail = (event as CustomEvent<{ nuss?: string; iban?: string }>).detail || {};
      if (!detail.nuss && !detail.iban) return;
      setFormData(prev => {
        const next = { ...prev };
        if (detail.nuss) {
          const detected = normalizeSpanishSocialSecurityNumber(detail.nuss);
          if (!prev.numeroSeguridadSocial || normalizeSpanishSocialSecurityNumber(prev.numeroSeguridadSocial) === detected || window.confirm('Este registro ya tiene un Nº de Seguridad Social. ¿Sustituirlo por el detectado?')) next.numeroSeguridadSocial = detected;
        }
        if (detail.iban) {
          const detected = normalizeIban(detail.iban);
          if (!prev.iban || normalizeIban(prev.iban) === detected || window.confirm('Este registro ya tiene un IBAN. ¿Sustituirlo por el detectado?')) next.iban = detected;
        }
        return next;
      });
    };'''
new = '''    const handleAdministrativeScan = (event: Event) => {
      const detail = (event as CustomEvent<{ dni?: string; nuss?: string; iban?: string; documentText?: string }>).detail || {};
      if (!detail.dni && !detail.nuss && !detail.iban) return;
      setFormData(prev => {
        const next = { ...prev };
        const detectedDni = (detail.dni || '').replace(/[\\s-]/g, '').toUpperCase();
        const currentDni = (prev.dni || '').replace(/[\\s-]/g, '').toUpperCase();
        const nameMatches = documentLikelyMatchesPerson(prev.apellidosNombre, detail.documentText || '');
        const dniMatchesExisting = !!detectedDni && !!currentDni && detectedDni === currentDni;

        if (prev.apellidosNombre && detail.documentText && !nameMatches && !dniMatchesExisting) {
          const continueAnyway = window.confirm(`No se ha podido verificar que el documento pertenezca a ${prev.apellidosNombre}. ¿Quieres incorporar igualmente los datos detectados?`);
          if (!continueAnyway) return prev;
        }

        if (detectedDni && isValidDNI(detectedDni)) {
          if (!currentDni || currentDni === detectedDni || window.confirm(`Este registro ya tiene el DNI/NIE ${currentDni}. ¿Sustituirlo por ${detectedDni}?`)) next.dni = detectedDni;
        }
        if (detail.nuss) {
          const detected = normalizeSpanishSocialSecurityNumber(detail.nuss);
          if (!prev.numeroSeguridadSocial || normalizeSpanishSocialSecurityNumber(prev.numeroSeguridadSocial) === detected || window.confirm('Este registro ya tiene un Nº de Seguridad Social. ¿Sustituirlo por el detectado?')) next.numeroSeguridadSocial = detected;
        }
        if (detail.iban) {
          const detected = normalizeIban(detail.iban);
          if (!prev.iban || normalizeIban(prev.iban) === detected || window.confirm('Este registro ya tiene un IBAN. ¿Sustituirlo por el detectado?')) next.iban = detected;
        }
        return next;
      });
    };'''
if old not in text:
    raise SystemExit('RegistrationForm administrative listener anchor not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
