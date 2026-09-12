from pathlib import Path

path = Path('api/analyze-subcontractor-docs.ts')
text = path.read_text()

old_extract = '''async function extractNativeText(file: InputFile): Promise<string> {
  const { data } = splitDataUrl(file.base64, file.type || 'application/octet-stream');
  const buffer = Buffer.from(data, 'base64');
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const rows: string[] = [];
      workbook.eachSheet(sheet => {
        rows.push(`HOJA: ${sheet.name}`);
        sheet.eachRow(row => {
          const values = (row.values as any[]).slice(1).map(value => {
            if (typeof value === 'object' && value && 'text' in value) return String((value as any).text || '');
            return String(value ?? '');
          }).filter(Boolean);
          if (values.length) rows.push(values.join(' | '));
        });
      });
      return rows.join('\\n').slice(0, MAX_NATIVE_TEXT);
    }
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').slice(0, MAX_NATIVE_TEXT);
    }
  } catch (error) {
    console.warn(`[CAE] No se pudo extraer texto nativo de ${file.name}:`, error instanceof Error ? error.message : 'error');
  }
  return '';
}
'''

new_extract = '''async function extractPdfNativeText(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const textParts = (content.items as any[])
      .map(item => typeof item?.str === 'string' ? item.str : '')
      .map(value => value.trim())
      .filter(Boolean);

    const annotations = await page.getAnnotations({ intent: 'display' }).catch(() => [] as any[]);
    const formFields = (annotations as any[]).flatMap(annotation => {
      const rawValue = annotation?.fieldValue;
      const values = Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : [];
      return values
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .map(value => annotation?.fieldName ? `[CAMPO ${annotation.fieldName}] ${value}` : value);
    });

    const pageText = [...textParts, ...formFields].join('\\n').trim();
    if (pageText) pages.push(`[PÁGINA ${pageNumber}]\\n${pageText}`);
  }
  return pages.join('\\n\\n').slice(0, MAX_NATIVE_TEXT);
}

async function extractNativeText(file: InputFile): Promise<string> {
  const { data } = splitDataUrl(file.base64, file.type || 'application/octet-stream');
  const buffer = Buffer.from(data, 'base64');
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
      const pdfText = await extractPdfNativeText(buffer);
      if (normalizeText(pdfText).length >= 40) return pdfText;
    }
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const rows: string[] = [];
      workbook.eachSheet(sheet => {
        rows.push(`HOJA: ${sheet.name}`);
        sheet.eachRow(row => {
          const values = (row.values as any[]).slice(1).map(value => {
            if (typeof value === 'object' && value && 'text' in value) return String((value as any).text || '');
            return String(value ?? '');
          }).filter(Boolean);
          if (values.length) rows.push(values.join(' | '));
        });
      });
      return rows.join('\\n').slice(0, MAX_NATIVE_TEXT);
    }
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').slice(0, MAX_NATIVE_TEXT);
    }
  } catch (error) {
    console.warn(`[CAE] No se pudo extraer texto nativo de ${file.name}:`, error instanceof Error ? error.message : 'error');
  }
  return '';
}
'''

if old_extract not in text:
    raise SystemExit('extractNativeText block not found')
text = text.replace(old_extract, new_extract, 1)

old_native = "return { provider: 'deterministic', data: normalizeOcr({ legible: true, quality: 'alta', pageCount: 1, language: 'es', plainText: nativeText, documentKind: 'Documento Office', observations: 'Texto extraído de forma nativa.', dates: [], identifiers: [], workers: [], signatures: [], stamps: [] }) };"
new_native = "return { provider: 'deterministic', data: normalizeOcr({ legible: true, quality: 'alta', pageCount: Math.max(1, (nativeText.match(/\\[PÁGINA \\d+\\]/g) || []).length), language: 'es', plainText: nativeText, documentKind: file.name.toLowerCase().endsWith('.pdf') ? 'PDF con texto nativo' : 'Documento Office', observations: 'Texto extraído de forma nativa; no requiere OCR visual para lectura.', dates: [], identifiers: [], workers: [], signatures: [], stamps: [] }) };"
if old_native not in text:
    raise SystemExit('native OCR return block not found')
text = text.replace(old_native, new_native, 1)

old_gateway = """  try {
    const raw = await callGateway('anthropic/claude-sonnet-4.6', [{ type: 'message', role: 'user', content }], ocrSchema, 'cae_ocr_document', 20_000);
    return { provider: 'vercel-ai-gateway', data: normalizeOcr(raw) };
  } catch (gatewayError) {
    const key = geminiKey();
    if (!key) throw gatewayError;
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ inlineData: { mimeType: split.mimeType, data: split.data } }, { text: ocrPrompt(file.name) }] },
      config: { responseMimeType: 'application/json', responseSchema: ocrSchema as any, temperature: 0 }
    });
    return { provider: 'gemini', data: normalizeOcr(JSON.parse(String(response.text || '{}'))) };
  }
"""

new_gateway = """  let gatewayError: unknown = new Error('AI_GATEWAY_UNAVAILABLE');
  for (const model of ['anthropic/claude-sonnet-5', 'google/gemini-2.5-flash', 'openai/gpt-5.6-sol']) {
    try {
      const raw = await callGateway(model, [{ type: 'message', role: 'user', content }], ocrSchema, 'cae_ocr_document', 20_000);
      return { provider: 'vercel-ai-gateway', data: normalizeOcr(raw) };
    } catch (error) {
      gatewayError = error;
      console.warn(`[CAE] OCR visual falló con ${model} para ${file.name}:`, error instanceof Error ? error.message : 'error');
    }
  }

  const key = geminiKey();
  if (!key) throw gatewayError;
  const ai = new GoogleGenAI({ apiKey: key });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts: [{ inlineData: { mimeType: split.mimeType, data: split.data } }, { text: ocrPrompt(file.name) }] },
    config: { responseMimeType: 'application/json', responseSchema: ocrSchema as any, temperature: 0 }
  });
  return { provider: 'gemini', data: normalizeOcr(JSON.parse(String(response.text || '{}'))) };
"""

if old_gateway not in text:
    raise SystemExit('OCR gateway block not found')
text = text.replace(old_gateway, new_gateway, 1)

text = text.replace("engineVersion: '2.0.0'", "engineVersion: '2.1.0'")
path.write_text(text)
