const normalizePrintedNameText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const PRINTED_NAME_EXCLUSIONS = /^(CADIZ|DIPUTACION|CATEGORIA|AREA|GESTION|FONDOS|PROFEA|PFEA|EXCMA|EMPRESA|CONTROL|PRESENCIA|INICIO|INCORPORACION|FECHA|OBRA|LOCALIDAD|MUNICIPIO|CONTRATO|CONVENIO|EXPRESANDO|TENIENDO|ESTANDO|TRABAJADORES?|RELACION|FIRMA|FIRMAS|CALLE|CALLES|AVENIDA|AVDA|PLAZA|PASEO|CARRETERA|CAMINO|PARQUE|EDIFICIO|ADECUACION|MEJORA|REPARACION|REFORMA|URBANIZACION)\b/;

const PRINTED_NAME_CONTEXT_EXCLUSIONS = /\b(AREA DE COOPERACION|DIPUTACION DE CADIZ|NUMERO DE OBRA|N[º°]? OBRA|CENTRO DE TRABAJO|LOCALIDAD|MUNICIPIO|CATEGORIA|RELACION DE TRABAJADORES|CONTROL DE PRESENCIA)\b/;

const NAME_LETTERS = 'A-Za-zÁÉÍÓÚÜÑÇáéíóúüñç';
const COMMA_NAME_PATTERN = new RegExp(
  `([${NAME_LETTERS}][${NAME_LETTERS}'’.-]*(?:\\s+[${NAME_LETTERS}][${NAME_LETTERS}'’.-]*){0,5})\\s*,\\s*([${NAME_LETTERS}][${NAME_LETTERS}'’.-]*(?:\\s+[${NAME_LETTERS}][${NAME_LETTERS}'’.-]*){0,4})(?=\\s{2,}|\\t|\\d|$)`
);

const cleanPrintedLine = (value: unknown) =>
  String(value || '')
    .replace(/[|•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const withoutRowNumber = (value: string) =>
  value.replace(/^\s*\d{1,3}\s*(?:[.)-]\s*)?/, '').trim();

const isLikelyPrintedWorkerName = (line: string) => {
  if(!line||line.length<5||line.length>90)return false;
  if(/\d/.test(line))return false;
  const normalized=normalizePrintedNameText(line);
  if(!normalized||PRINTED_NAME_EXCLUSIONS.test(normalized)||PRINTED_NAME_CONTEXT_EXCLUSIONS.test(normalized))return false;
  const tokens=normalized.split(' ').filter(Boolean);
  if(tokens.length<2||tokens.length>7)return false;
  if(tokens.some(token=>token.length===1&&!/^[A-ZÑ]$/.test(token)))return false;

  const letters=(line.match(/[A-Za-zÁÉÍÓÚÜÑÇáéíóúüñç]/g)||[]);
  if(!letters.length)return false;
  const upper=(line.match(/[A-ZÁÉÍÓÚÜÑÇ]/g)||[]).length;
  const uppercaseRatio=upper/letters.length;

  const hasComma=line.includes(',');
  const hasCompleteCommaName=/,\s*\S/.test(line);
  if(hasComma&&!hasCompleteCommaName)return false;
  return hasCompleteCommaName || uppercaseRatio>=0.72;
};

export const looksLikePrintedWorkerName = (rawLine: string) => {
  const line=withoutRowNumber(cleanPrintedLine(rawLine));
  return isLikelyPrintedWorkerName(line);
};

const extractCommaName = (rawLine: string) => {
  const source=String(rawLine||'').replace(/[|•·]+/g,' ').trim();
  const rowStripped=withoutRowNumber(source);
  const match=rowStripped.match(COMMA_NAME_PATTERN);
  if(!match)return null;
  const candidate=`${match[1].replace(/\s+/g,' ').trim()}, ${match[2].replace(/\s+/g,' ').trim()}`;
  return isLikelyPrintedWorkerName(candidate) ? candidate : null;
};

export const extractPrintedWorkerNameCandidates = (text: string): string[] => {
  const rawLines=String(text||'').split(/\r?\n/);
  const result:string[]=[];
  const seen=new Set<string>();

  const push=(candidate:string|null)=>{
    if(!candidate)return;
    const key=normalizePrintedNameText(candidate);
    if(!key||seen.has(key))return;
    seen.add(key);
    result.push(candidate);
  };

  for(let i=0;i<rawLines.length;i+=1){
    const raw=rawLines[i]||'';
    push(extractCommaName(raw));

    const cleaned=withoutRowNumber(cleanPrintedLine(raw));
    if(isLikelyPrintedWorkerName(cleaned))push(cleaned);

    // Algunos PDF separan "APELLIDOS," y "NOMBRE" en dos líneas.
    if(/,\s*$/.test(raw)&&i+1<rawLines.length){
      const next=String(rawLines[i+1]||'').trim();
      if(next&&!/\d/.test(next)){
        push(extractCommaName(`${raw} ${next}`));
      }
    }
  }

  return result;
};
