from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected target not found in {path}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Restore the Obras tab. The full specialized UI already exists in Configuracion.
replace_once(
    "components/Configuracion.tsx",
    "  const tabs = [\n    { id: 'lugares', label: 'Lugares Formación', icon: GraduationCap, list: savedLugares, setter: setSavedLugares },",
    "  const tabs = [\n    { id: 'obras', label: 'Obras', icon: Building2, list: savedObras, setter: setSavedObras },\n    { id: 'lugares', label: 'Lugares Formación', icon: GraduationCap, list: savedLugares, setter: setSavedLugares },",
)

# Harden SAE month and work-code recognition.
parser = Path("src/lib/saeDocumentParser.ts")
text = parser.read_text(encoding="utf-8")
start = text.index("function detectMonth(text: string): string {")
end = text.index("\nconst compact =", start)
replacement = r'''const MONTH_PATTERN = MONTHS.join('|');

function detectMonth(text: string): string {
  const norm = normalizeSaeText(text);
  if (!norm) return '';

  const contextualPatterns = [
    new RegExp(`\\b[12](?:A|ª|º)?\\s*QUINCENA\\s+(?:DE\\s+)?(${MONTH_PATTERN})\\b`, 'i'),
    new RegExp(`\\b(?:MES|PERIODO|NECESIDAD(?:ES)?(?:\\s+DE\\s+CONTRATACION)?|OFERTA)\\s*[:\\-]?\\s*(${MONTH_PATTERN})\\b`, 'i'),
    new RegExp(`\\bPFEA\\b[^\\n]{0,80}\\b(${MONTH_PATTERN})\\b`, 'i'),
  ];
  for (const pattern of contextualPatterns) {
    const match = norm.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }

  let best = { month: '', score: -1, index: Number.MAX_SAFE_INTEGER };
  for (const month of MONTHS) {
    const monthRegex = new RegExp(`\\b${month}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = monthRegex.exec(norm))) {
      const nearby = norm.slice(
        Math.max(0, match.index - 90),
        Math.min(norm.length, match.index + month.length + 90),
      );
      let score = 0;
      if (/QUINCENA/.test(nearby)) score += 8;
      if (/\bMES\b|PERIODO/.test(nearby)) score += 6;
      if (/NECESIDAD|CONTRATACION|OFERTA/.test(nearby)) score += 4;
      if (/PFEA|SAE/.test(nearby)) score += 2;
      if (/FECHA\s+(?:DE\s+)?(?:EMISION|FIRMA|REGISTRO)/.test(nearby)) score -= 5;
      if (score > best.score || (score === best.score && match.index < best.index)) {
        best = { month, score, index: match.index };
      }
    }
  }
  return best.month;
}

function detectYear(text: string): number | null {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function canonicalWorkCode(value: string): string {
  const norm = normalizeSaeText(value);
  const digits = norm.match(/\b(\d{5})\b/)?.[1] || '';
  const compactValue = norm.replace(/[.\s_\-/:]+/g, '');
  const type = compactValue.includes('GR') ? 'GR' : compactValue.includes('EE') ? 'EE' : '';
  return digits && type ? `${digits} ${type}` : '';
}

function detectWork(text: string) {
  const norm = normalizeSaeText(text);
  const variants = [
    norm.match(/\b(\d{5})\s*[-–/:]?\s*(G\s*\.?\s*R\.?|E\s*\.?\s*E\.?)\b/i)?.[0] || '',
    norm.match(/\b(G\s*\.?\s*R\.?|E\s*\.?\s*E\.?)\s*[-–/:]?\s*(\d{5})\b/i)?.[0] || '',
    norm.match(/(?:CODIGO|COD\.?|EXPEDIENTE)\s*(?:DE\s+)?(?:OBRA)?\s*[:#\-]?\s*([^\n]{0,35})/i)?.[1] || '',
  ];
  const codigoObra = variants.map(canonicalWorkCode).find(Boolean) || '';

  const explicit = text.match(
    /(?:OBRA|PROYECTO|DENOMINACI[ÓO]N\s+(?:DE\s+LA\s+)?OBRA)\s*[:\-]?\s*([^\n\r]{3,120})/i,
  );
  const obra = (explicit?.[1] || '')
    .replace(/\b(?:G\s*\.?\s*R\.?|E\s*\.?\s*E\.?)\s*[-–/:]?\s*\d{5}\b/ig, ' ')
    .replace(/\b\d{5}\s*[-–/:]?\s*(?:G\s*\.?\s*R\.?|E\s*\.?\s*E\.?)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-–:;,.\s]+|[-–:;,.\s]+$/g, '')
    .trim();
  return { codigoObra, obra: obra || codigoObra };
}
'''
text = text[:start] + replacement + text[end:]

# Normalize GR/EE before parsing structured needs, regardless of whether the SAE
# technician writes the letters before/after the code or uses punctuation.
flat_start = text.index("  const flat = text", text.index("function extractStructuredProfeaNeeds"))
flat_end = text.index("\n  const month =", flat_start)
flat_replacement = r'''  const flat = text
    .replace(/\[P[ÁA]GINA\s+\d+\]/gi, ' ')
    .replace(/\r/g, '\n')
    .replace(/\b(G\s*\.?\s*R\.?|E\s*\.?\s*E\.?)\s*[-–/:]?\s*(\d{5})\b/gi, (_m, type, code) => `${code} ${String(type).replace(/\./g, '').replace(/\s+/g, '').toUpperCase()}`)
    .replace(/\b(\d{5})\s*[-–/:]?\s*(G\s*\.?\s*R\.?|E\s*\.?\s*E\.?)\b/gi, (_m, code, type) => `${code} ${String(type).replace(/\./g, '').replace(/\s+/g, '').toUpperCase()}`)
    .replace(/[\t ]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();'''
text = text[:flat_start] + flat_replacement + text[flat_end:]
parser.write_text(text, encoding="utf-8")

# Validate report vs selected need by canonical work key, not by literal formatting.
sae = Path("components/SaeSection.tsx")
text = sae.read_text(encoding="utf-8")
old = "const nw=(v:string)=>norm(v).replace(/[.\\s-]+/g,'');if(nw(selectedNeed.codigoObra)&&nw(parsed.codigoObra)&&nw(selectedNeed.codigoObra)!==nw(parsed.codigoObra))throw new Error(`El informe corresponde a la obra ${parsed.codigoObra}, pero está seleccionada ${selectedNeed.codigoObra}.`);"
new = "const workKey=(v:string)=>{const s=norm(v).replace(/[.\\s_\\-/:]+/g,'');const code=s.match(/(\\d{5})/)?.[1]||'';const type=s.includes('gr')?'gr':s.includes('ee')?'ee':'';return code&&type?`${code}${type}`:s;};if(workKey(selectedNeed.codigoObra)&&workKey(parsed.codigoObra)&&workKey(selectedNeed.codigoObra)!==workKey(parsed.codigoObra))throw new Error(`El informe corresponde a la obra ${parsed.codigoObra}, pero está seleccionada ${selectedNeed.codigoObra}.`);"
if old not in text:
    raise SystemExit("SAE report comparison target not found")
sae.write_text(text.replace(old, new, 1), encoding="utf-8")
