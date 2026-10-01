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

export const looksLikePrintedWorkerName = (rawLine: string) => {
  const line=String(rawLine||'')
    .replace(/[|•·]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
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

  return line.includes(',') || uppercaseRatio>=0.72;
};
