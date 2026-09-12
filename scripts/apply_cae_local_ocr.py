from pathlib import Path

helper = r'''import { createWorker } from 'tesseract.js';

export type ClientExtractedDocument = {
  text: string;
  source: 'pdf-native' | 'pdf-local-ocr' | 'image-local-ocr' | 'none';
};

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const setupPdfJs = async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  return pdfjs;
};

const canvasForPage = async (page: any, scale = 1.7) => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No se pudo crear el lienzo de OCR.');
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
};

export async function extractClientDocumentText(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ClientExtractedDocument> {
  const lower = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lower);
  if (!isPdf && !isImage) return { text: '', source: 'none' };

  if (isPdf) {
    const pdfjs = await setupPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const nativePages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress?.(`Leyendo texto del PDF · página ${pageNumber}/${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = (content.items as any[])
        .map(item => typeof item?.str === 'string' ? item.str : '')
        .filter(Boolean)
        .join(' ')
        .trim();
      if (text) nativePages.push(`[PÁGINA ${pageNumber}]\n${text}`);
    }

    const nativeText = nativePages.join('\n\n');
    if (normalize(nativeText).length >= 80) return { text: nativeText, source: 'pdf-native' };

    onProgress?.('PDF escaneado detectado · iniciando OCR local de respaldo…');
    const worker = await createWorker('spa');
    try {
      const ocrPages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        onProgress?.(`OCR local · página ${pageNumber}/${pdf.numPages}…`);
        const page = await pdf.getPage(pageNumber);
        const canvas = await canvasForPage(page, 1.8);
        const result = await worker.recognize(canvas);
        const text = String(result?.data?.text || '').trim();
        if (text) ocrPages.push(`[PÁGINA ${pageNumber}]\n${text}`);
      }
      return { text: ocrPages.join('\n\n'), source: ocrPages.length ? 'pdf-local-ocr' : 'none' };
    } finally {
      await worker.terminate();
    }
  }

  onProgress?.('Ejecutando OCR local sobre la imagen…');
  const worker = await createWorker('spa');
  try {
    const result = await worker.recognize(file);
    const text = String(result?.data?.text || '').trim();
    return { text, source: text ? 'image-local-ocr' : 'none' };
  } finally {
    await worker.terminate();
  }
}
'''
Path('src/lib/clientDocumentText.ts').write_text(helper)

frontend = Path('components/FileUploaderIA.tsx')
text = frontend.read_text()
import_anchor = "import { notifyDatabaseSync } from '../src/lib/syncNotifier';"
new_import = "import { extractClientDocumentText } from '../src/lib/clientDocumentText';"
if new_import not in text:
    text = text.replace(import_anchor, import_anchor + "\n" + new_import, 1)

old = """      const convertedFiles = await Promise.all(selectedFiles.map(file => new Promise<{ name: string; type: string; base64: string }>((resolve, reject) => {\n        const reader = new FileReader();\n        reader.onloadend = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', base64: reader.result as string });\n        reader.onerror = reject;\n        reader.readAsDataURL(file);\n      })));"""
new = """      const convertedFiles = [];\n      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex += 1) {\n        const file = selectedFiles[fileIndex];\n        setAnalysisProgress(`Preparando ${fileIndex + 1}/${selectedFiles.length}: ${file.name}…`);\n        let extractedText = '';\n        let extractionSource = 'none';\n        try {\n          const extracted = await extractClientDocumentText(file, message => setAnalysisProgress(`${file.name}: ${message}`));\n          extractedText = extracted.text;\n          extractionSource = extracted.source;\n        } catch (error) {\n          console.warn(`[CAE] Extracción local no disponible para ${file.name}:`, error);\n        }\n        const base64 = await new Promise<string>((resolve, reject) => {\n          const reader = new FileReader();\n          reader.onloadend = () => resolve(reader.result as string);\n          reader.onerror = reject;\n          reader.readAsDataURL(file);\n        });\n        convertedFiles.push({ name: file.name, type: file.type || 'application/octet-stream', base64, extractedText, extractionSource });\n      }"""
if old not in text:
    raise SystemExit('frontend conversion block not found')
text = text.replace(old, new, 1)
frontend.write_text(text)

api = Path('api/analyze-subcontractor-docs.ts')
text = api.read_text()
text = text.replace("type InputFile = { name: string; type?: string; base64: string };", "type InputFile = { name: string; type?: string; base64: string; extractedText?: string; extractionSource?: string };", 1)

old_extract_start = """async function extractNativeText(file: InputFile): Promise<string> {\n  const { data } = splitDataUrl(file.base64, file.type || 'application/octet-stream');"""
new_extract_start = """async function extractNativeText(file: InputFile): Promise<string> {\n  const clientText = String(file.extractedText || '').trim();\n  if (normalizeText(clientText).length >= 40) {\n    return clientText.slice(0, MAX_NATIVE_TEXT);\n  }\n  const { data } = splitDataUrl(file.base64, file.type || 'application/octet-stream');"""
if old_extract_start not in text:
    raise SystemExit('extractNativeText anchor not found')
text = text.replace(old_extract_start, new_extract_start, 1)

anchor = "const fallbackAliases: Record<string, string[]> = {"
insert = r'''const strongDeterministicEvidence = (itemId: string, searchable: string) => {
  const has = (...terms: string[]) => terms.every(term => searchable.includes(normalizeText(term)));
  if (itemId === 'rea') return has('registro de empresas acreditadas') && (has('certificado de inscripcion') || has('n inscripcion rea'));
  if (itemId === 'adhesion_pss') return has('plan de seguridad y salud') && (has('acta de adhesion') || has('se adhiere al plan')) && has('subcontratista');
  if (itemId === 'cert_tgss') return has('tesoreria general de la seguridad social') && has('corriente en las obligaciones');
  if (itemId === 'cert_aeat') return has('agencia estatal de administracion tributaria') && has('obligaciones tributarias');
  if (itemId === 'seguro_rc') return has('responsabilidad civil') && (has('poliza') || has('aseguradora'));
  if (itemId === 'formacion_prl') return has('prevencion de riesgos laborales') && (has('formacion') || has('curso'));
  if (itemId === 'aptitud_medica') return has('aptitud') && (has('medica') || has('vigilancia de la salud'));
  if (itemId === 'entrega_epis') return has('equipos de proteccion individual') || has('entrega de epis');
  return false;
};

'''
if 'const strongDeterministicEvidence' not in text:
    text = text.replace(anchor, insert + anchor, 1)

old_det = """    return [{ docId: item.id, state: ocr.legible ? 'incompleto' : 'pendiente', issuedDate: '', expiryDate: '', company: '', taxId: '', evidence, evidencePage: 0, observations: 'Coincidencia textual detectada; requiere cotejo humano.', confidence: 'baja' }];"""
new_det = """    const strong = strongDeterministicEvidence(item.id, searchable);\n    return [{ docId: item.id, state: strong && ocr.legible ? 'entregado' : (ocr.legible ? 'incompleto' : 'pendiente'), issuedDate: '', expiryDate: '', company: '', taxId: '', evidence, evidencePage: 1, observations: strong ? 'Evidencia documental fuerte detectada por lectura local/determinista. Requiere confirmación humana antes de aplicar.' : 'Coincidencia textual detectada; requiere cotejo humano.', confidence: strong ? 'media' : 'baja' }];"""
if old_det not in text:
    raise SystemExit('deterministic assessment block not found')
text = text.replace(old_det, new_det, 1)

old_catch = """        ocr = normalizeOcr({ legible: false, quality: 'baja', pageCount: 1, plainText: nativeText, observations: 'No se pudo completar el OCR visual.', dates: [], identifiers: [], workers: [], signatures: [], stamps: [] });"""
new_catch = """        const hasLocalText = normalizeText(nativeText).length >= 40;\n        ocr = normalizeOcr({ legible: hasLocalText, quality: hasLocalText ? 'media' : 'baja', pageCount: 1, plainText: nativeText, observations: hasLocalText ? 'Texto recuperado localmente; el servicio OCR/IA visual no respondió.' : 'Servicio OCR/IA visual no disponible para este archivo. No se infiere que el documento sea borroso.', dates: [], identifiers: [], workers: [], signatures: [], stamps: [] });"""
if old_catch not in text:
    raise SystemExit('ocr catch block not found')
text = text.replace(old_catch, new_catch, 1)

old_illeg = """      if (!ocr.legible) documentosIlegibles.push({ archivo: file.name, motivo: ocr.observations || 'OCR insuficiente.', docRelacionado: validated[0]?.docId || '', confianza: ocr.quality });"""
new_illeg = """      if (!ocr.legible && !String(ocr.observations || '').includes('Servicio OCR/IA visual no disponible')) {\n        documentosIlegibles.push({ archivo: file.name, motivo: ocr.observations || 'OCR insuficiente.', docRelacionado: validated[0]?.docId || '', confianza: ocr.quality });\n      }"""
if old_illeg not in text:
    raise SystemExit('illegible push block not found')
text = text.replace(old_illeg, new_illeg, 1)
text = text.replace("engineVersion: '2.1.0'", "engineVersion: '2.2.0'")
api.write_text(text)
