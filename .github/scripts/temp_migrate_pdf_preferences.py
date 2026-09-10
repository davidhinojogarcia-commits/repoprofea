from pathlib import Path

p = Path('src/lib/exportUtils.ts')
s = p.read_text()
anchor = "import { OFFICIAL_LOGO_BASE64 } from '../assets/logoData';"
imp = "import { loadPdfPreferences, savePdfPreferences } from '../services/pdfPreferencesService';"
if imp not in s:
    s = s.replace(anchor, anchor + "\n" + imp, 1)

start = s.find("export const getStoredPdfConfig =")
end = s.find("\nexport const formatDate", start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró bloque PDF config')
replacement = r'''let pdfConfigCache: Required<PdfCustomConfig> = { ...DEFAULT_PDF_CONFIG };
let pdfPreferencesHydrated = false;

const normalizePdfConfig = (value?: Partial<PdfCustomConfig>): Required<PdfCustomConfig> => ({
  headerLine1: value?.headerLine1 || DEFAULT_PDF_CONFIG.headerLine1,
  headerLine2: value?.headerLine2 || DEFAULT_PDF_CONFIG.headerLine2,
  footerText: value?.footerText || DEFAULT_PDF_CONFIG.footerText,
  customLogo: value?.customLogo || '',
  showTimestamp: value?.showTimestamp !== undefined ? Boolean(value.showTimestamp) : DEFAULT_PDF_CONFIG.showTimestamp,
  showPageNumbers: value?.showPageNumbers !== undefined ? Boolean(value.showPageNumbers) : DEFAULT_PDF_CONFIG.showPageNumbers,
});

export const hydrateStoredPdfConfig = async (): Promise<void> => {
  if (pdfPreferencesHydrated) return;
  let remote = await loadPdfPreferences();

  // Migración única desde la preferencia histórica del navegador.
  if ((!remote || Object.keys(remote).length === 0) && typeof window !== 'undefined') {
    try {
      const legacyRaw = localStorage.getItem('pdfCustomConfig');
      if (legacyRaw) {
        remote = JSON.parse(legacyRaw);
        await savePdfPreferences(normalizePdfConfig(remote));
      }
    } catch (error) {
      console.warn('No se pudo migrar la configuración PDF local:', error);
    }
  }

  pdfConfigCache = normalizePdfConfig(remote);
  pdfPreferencesHydrated = true;
  if (typeof window !== 'undefined') localStorage.removeItem('pdfCustomConfig');
};

export const getStoredPdfConfig = (): Required<PdfCustomConfig> => ({ ...pdfConfigCache });

export const saveStoredPdfConfig = (config: Partial<PdfCustomConfig>): Required<PdfCustomConfig> => {
  pdfConfigCache = normalizePdfConfig({ ...pdfConfigCache, ...config });
  void savePdfPreferences(pdfConfigCache).catch(error =>
    console.warn('Error guardando configuración PDF en Supabase:', error)
  );
  return { ...pdfConfigCache };
};
'''
s = s[:start] + replacement + s[end:]
p.write_text(s)

p = Path('components/AuthGate.tsx')
s = p.read_text()
anchor = "import { hydrateStoredSubcontratasPreferences } from '../src/lib/subcontratasDefaults';"
imp = "import { hydrateStoredPdfConfig } from '../src/lib/exportUtils';"
if imp not in s:
    s = s.replace(anchor, anchor + "\n" + imp, 1)
old = """          await hydrateStoredSubcontratasPreferences().catch(error =>
            console.warn('No se pudieron precargar preferencias de subcontratas:', error)
          );"""
new = """          await Promise.all([
            hydrateStoredSubcontratasPreferences().catch(error =>
              console.warn('No se pudieron precargar preferencias de subcontratas:', error)
            ),
            hydrateStoredPdfConfig().catch(error =>
              console.warn('No se pudo precargar la configuración PDF:', error)
            ),
          ]);"""
if old not in s:
    raise SystemExit('No se encontró hidratación en AuthGate')
s = s.replace(old, new, 1)
p.write_text(s)
