from pathlib import Path

front_path = Path('components/ReconocimientosMedicosSection.tsx')
front = front_path.read_text(encoding='utf-8')

import_anchor = "import { Person, MedicalRecordImportItem, getAptitudMedicaInfo } from '../types';\n"
import_line = "import { extractClientDocumentText } from '../src/lib/clientDocumentText';\n"
if import_line not in front:
    if import_anchor not in front:
        raise SystemExit('frontend import anchor not found')
    front = front.replace(import_anchor, import_anchor + import_line, 1)

old_map = """        validFiles.map(async (file) => {
          const base64 = await new Promise<string>((resolve, reject) => {
"""
new_map = """        validFiles.map(async (file) => {
          let extractedText = '';
          let extractionSource = 'none';
          try {
            const extracted = await extractClientDocumentText(
              file,
              message => setUploadProgressText(`${file.name}: ${message}`)
            );
            extractedText = extracted.text;
            extractionSource = extracted.source;
          } catch (error) {
            console.warn(`[Reconocimientos médicos] OCR local no disponible para ${file.name}:`, error);
          }

          const base64 = await new Promise<string>((resolve, reject) => {
"""
if old_map not in front:
    raise SystemExit('frontend payload map anchor not found')
front = front.replace(old_map, new_map, 1)

old_return = """          return {
            filename: file.name,
            mimeType,
            fileBase64: base64
          };
"""
new_return = """          return {
            filename: file.name,
            mimeType,
            fileBase64: base64,
            extractedText,
            extractionSource
          };
"""
if old_return not in front:
    raise SystemExit('frontend payload return anchor not found')
front = front.replace(old_return, new_return, 1)

front = front.replace(
    "? `Analizando ${validFiles.length} documentos conjuntamente con IA...` \n          : 'Analizando documento con IA...'",
    "? `Procesando ${validFiles.length} documentos (OCR local + respaldo IA)...` \n          : 'Procesando documento (OCR local + respaldo IA)...'",
    1,
)
front_path.write_text(front, encoding='utf-8')

back_path = Path('api/parse-medical-records.ts')
back = back_path.read_text(encoding='utf-8')
old_local = """    const base64 = String(file?.fileBase64 || file?.base64 || file?.data || '');
    const mimeType = normalizeMime(file?.mimeType || file?.type || 'application/pdf');
    if (!base64 || mimeType !== 'application/pdf') continue;
    const text = await extractPdfText(base64);
    if (normalizeText(text).length < 30) continue;
"""
new_local = """    const base64 = String(file?.fileBase64 || file?.base64 || file?.data || '');
    const mimeType = normalizeMime(file?.mimeType || file?.type || 'application/pdf');
    if (!base64) continue;

    // Prefer text/OCR already extracted in the browser. This works for scanned PDFs
    // and images and avoids depending on an external AI provider for basic parsing.
    let text = String(file?.extractedText || '').trim();
    if (normalizeText(text).length < 30 && mimeType === 'application/pdf') {
      text = await extractPdfText(base64);
    }
    if (normalizeText(text).length < 30) continue;
"""
if old_local not in back:
    raise SystemExit('backend local fallback anchor not found')
back = back.replace(old_local, new_local, 1)
back_path.write_text(back, encoding='utf-8')

print('Medical client OCR fallback patch applied')
