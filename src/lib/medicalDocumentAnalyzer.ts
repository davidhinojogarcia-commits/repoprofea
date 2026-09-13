import type { MedicalRecordImportItem, Person } from '../../types';

const normalize = (value: string) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9Ñ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const compactDni = (value?: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const STOP = new Set(['DE','DEL','LA','LAS','EL','LOS','Y','DA','DI','SAN','SANTA']);
const nameTokens = (value: string) => normalize(value).split(' ').filter(t => t.length > 1 && !STOP.has(t));

const scoreName = (documentLine: string, workerName: string) => {
  const line = normalize(documentLine);
  const worker = normalize(workerName);
  if (!worker || !line) return 0;
  if (line.includes(worker)) return 1;
  const target = nameTokens(workerName);
  const source = nameTokens(documentLine);
  if (!target.length || !source.length) return 0;
  const shared = target.filter(t => source.some(s => s === t || (t.length >= 5 && s.startsWith(t)) || (s.length >= 5 && t.startsWith(s))));
  return (shared.length * 2) / (target.length + Math.min(source.length, target.length + 3));
};

const detectResult = (value: string): MedicalRecordImportItem['resultado'] | '' => {
  const text = normalize(value);
  if (/APTO\s+CON\s+(LIMITACION|LIMITACIONES|RESTRICCION|RESTRICCIONES)/.test(text) || /APTO.{0,120}LIMITACI/.test(text) || /APTO.{0,120}RESTRIC/.test(text)) return 'Apto con Limitación';
  if (/NO\s+APTO/.test(text) || /INAPTO/.test(text)) return 'No Apto';
  if (/\bAPTO\b/.test(text) || /APTITUD\s+(FAVORABLE|POSITIVA)/.test(text)) return 'Apto';
  return '';
};

const dateMatches = (text: string) => Array.from(String(text || '').matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g));
const toIso = (m: RegExpMatchArray) => `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
const detectDate = (text: string) => {
  const labelled = String(text || '').match(/(?:FECHA\s+(?:DEL\s+)?(?:RECONOCIMIENTO|EXAMEN|REALIZACI[ÓO]N)|REALIZADO\s+EL)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/i);
  if (labelled) return `${labelled[3]}-${labelled[2].padStart(2,'0')}-${labelled[1].padStart(2,'0')}`;
  const match = dateMatches(text)[0];
  return match ? toIso(match) : '';
};
const addYear = (iso: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''; const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };
const detectValidity = (text: string, date: string) => {
  const explicit = String(text || '').match(/(?:VALID(?:EZ|O|A)|CADUC(?:IDAD|A)|VIGENTE\s+HASTA|HASTA)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/i);
  if (explicit) return `${explicit[3]}-${explicit[2].padStart(2,'0')}-${explicit[1].padStart(2,'0')}`;
  return addYear(date);
};

const LIMITATION_LABEL = /(?:LIMITACIONES?|RESTRICCIONES?|CONDICIONES?|OBSERVACIONES(?:\s+(?:M[EÉ]DICAS?|LABORALES?|DE\s+APTITUD))?|ADAPTACIONES?|MEDIDAS\s+PREVENTIVAS?|RECOMENDACIONES?|APTITUD\s+CONDICIONADA)\s*[:\-–—]?\s*/i;
const LIMITATION_STOP = /\b(?:FECHA(?:\s+DEL)?\s+(?:RECONOCIMIENTO|EXAMEN|EMISI[ÓO]N)|VALIDEZ|VIGENCIA|CADUCIDAD|CENTRO\s+M[EÉ]DICO|SERVICIO\s+DE\s+PREVENCI[ÓO]N|ENTIDAD|DNI|NIF|APELLIDOS|NOMBRE|FIRMA|SELLO|PROTOCOLOS?|PUESTO\s+DE\s+TRABAJO|EMPRESA)\b/i;
const LIMITATION_HINT = /\b(?:NO\s+(?:REALIZAR|TRABAJAR|MANIPULAR|LEVANTAR|CARGAR|SUBIR|BAJAR|CONDUCIR|USAR|EFECTUAR|EXPONERSE|PERMANECER|TRABAJAR\s+EN)|EVITAR|RESTRINGIR|RESTRICCI[ÓO]N|LIMITAR|LIMITACI[ÓO]N|PROHIBIDO|SIN\s+(?:TRABAJOS?|TAREAS?|EXPOSICI[ÓO]N)|USO\s+(?:OBLIGATORIO|NECESARIO)|UTILIZAR\s+EPI|EPI\s+(?:OBLIGATORIO|ESPEC[IÍ]FICO)|NO\s+LEVANTAR\s+M[AÁ]S\s+DE|PAUSAS?\s+(?:FRECUENTES?|PERI[ÓO]DICAS?)|CAMBIO\s+POSTURAL|ADAPTAR|ADAPTACI[ÓO]N|LIMITACI[ÓO]N\s+TEMPORAL|TRABAJO\s+EN\s+ALTURA|ALTURAS?|CARGAS?|RUIDO|VIBRACIONES?|POLVO|S[IÍ]LICE|CALOR|FR[IÍ]O|CONDUCCI[ÓO]N|MAQUINARIA|MOVIMIENTOS?\s+REPETITIVOS?|POSTURAS?\s+FORZADAS?|BIPEDESTACI[ÓO]N|SEDENTACI[ÓO]N|ESCALERAS?|ANDAMIOS?|ESPACIOS?\s+CONFINADOS?|PANTALLAS?\s+DE\s+VISUALIZACI[ÓO]N|CARGA\s+F[IÍ]SICA|SOBREESFUERZOS?)\b/i;
const NON_LIMITATION = /^(?:SIN\s+LIMITACIONES?|NO\s+PRESENTA\s+LIMITACIONES?|NINGUNA|NO\s+PROCEDE|N\/A)$/i;

const cleanLimitation = (value: string) => String(value || '')
  .replace(/^\s*[:\-–—|•·*]+\s*/, '')
  .replace(/^\s*(?:LIMITACIONES?|RESTRICCIONES?|CONDICIONES?|OBSERVACIONES(?:\s+(?:M[EÉ]DICAS?|LABORALES?|DE\s+APTITUD))?|ADAPTACIONES?|MEDIDAS\s+PREVENTIVAS?|RECOMENDACIONES?|APTITUD\s+CONDICIONADA)\s*[:\-–—]?\s*/i, '')
  .replace(/\s*\|\s*/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/[,:;\-–—]+\s*$/, '')
  .trim();

const limitationLooksReal = (value: string) => {
  const n = normalize(value);
  if (n.length < 5) return false;
  if (NON_LIMITATION.test(n)) return false;
  if (/^(SI|NO|APTO|APTO CON LIMITACIONES?|LIMITACIONES?|RESTRICCIONES?|CONDICIONES?|OBSERVACIONES?)$/.test(n)) return false;
  if (/^(FECHA|DNI|NIF|NOMBRE|APELLIDOS|CENTRO|VIGENCIA|VALIDEZ|EMPRESA|PUESTO)\b/.test(n)) return false;
  if (/^(RESULTADO|APTITUD)\s*[:\-]?\s*APTO\s+CON\s+(LIMITACION|LIMITACIONES|RESTRICCION|RESTRICCIONES)$/.test(n)) return false;
  return true;
};

const collectLimitationTail = (tail: string, maxLines = 8) => {
  const pieces = tail.split(/\r?\n/);
  const collected: string[] = [];
  let consumed = 0;
  for (const piece of pieces) {
    if (consumed++ >= maxLines) break;
    let clean = cleanLimitation(piece);
    if (!clean) continue;
    if (LIMITATION_STOP.test(clean) && collected.length) break;
    if (/^(?:RESULTADO|APTITUD)\b/i.test(clean) && collected.length) break;
    if (/\b(?:NO\s+APTO|INAPTO)\b/i.test(clean)) break;
    clean = clean.replace(/^(?:RESULTADO|APTITUD)\s*[:\-]?\s*APTO\s+CON\s+(?:LIMITACIONES?|RESTRICCIONES?)\s*[:\-]?\s*/i, '');
    clean = cleanLimitation(clean);
    if (!clean || NON_LIMITATION.test(clean)) continue;
    collected.push(clean);
    if (collected.join(' ').length >= 600) break;
  }
  return cleanLimitation(collected.join(' ')).slice(0, 600);
};

const extractExplicitLimitations = (text: string) => {
  const lines = String(text || '').split(/\r?\n/);
  const candidates: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const label = line.match(LIMITATION_LABEL);
    if (!label) continue;
    const after = cleanLimitation(line.slice((label.index || 0) + label[0].length));
    if (limitationLooksReal(after)) candidates.push(after);
    const tail = collectLimitationTail(lines.slice(i + 1, i + 9).join('\n'));
    if (limitationLooksReal(tail)) candidates.push(tail);
  }
  return candidates;
};

const extractRestrictionSentences = (text: string) => {
  const chunks = String(text || '').split(/\r?\n|(?<=[.;])\s+/).map(cleanLimitation).filter(Boolean);
  return chunks.filter(c => limitationLooksReal(c) && LIMITATION_HINT.test(c) && !LIMITATION_STOP.test(c));
};

const uniqueText = (items: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const clean = cleanLimitation(raw);
    const key = normalize(clean);
    if (!clean || !key || seen.has(key)) continue;
    seen.add(key); out.push(clean);
  }
  return out;
};

const detectLimitations = (workerLines: string[], broaderLines: string[], worker: Person) => {
  const localText = workerLines.join('\n');
  const broaderText = broaderLines.join('\n');
  const all: string[] = [];

  all.push(...extractExplicitLimitations(localText));

  const anchors = [
    /APTO\s+CON\s+(?:LIMITACIONES?|RESTRICCIONES?)\s*[:\-–—]?\s*/ig,
    /APTITUD\s+CONDICIONADA\s*[:\-–—]?\s*/ig,
  ];
  for (const re of anchors) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(localText))) {
      const sameLineEnd = localText.indexOf('\n', match.index);
      const sameLine = cleanLimitation(localText.slice(match.index + match[0].length, sameLineEnd >= 0 ? sameLineEnd : undefined));
      if (limitationLooksReal(sameLine)) all.push(sameLine);
      const tail = collectLimitationTail(localText.slice(match.index + match[0].length));
      if (limitationLooksReal(tail)) all.push(tail);
    }
  }

  all.push(...extractRestrictionSentences(localText));

  // Segundo pase: algunos certificados imprimen las limitaciones en un bloque de la página,
  // separado visualmente de la fila con nombre/DNI. Solo usamos ese bloque si la sección contiene
  // de forma clara al trabajador o si existe un único apto con limitaciones en el documento.
  const workerDni = compactDni(worker.dni);
  const broaderNormalized = normalize(broaderText);
  const workerMentioned = (workerDni.length >= 8 && compactDni(broaderText).includes(workerDni)) || nameTokens(worker.apellidosNombre).filter(t => broaderNormalized.includes(t)).length >= Math.max(2, nameTokens(worker.apellidosNombre).length - 1);
  if (workerMentioned) {
    all.push(...extractExplicitLimitations(broaderText));
    all.push(...extractRestrictionSentences(broaderText));
  }

  const unique = uniqueText(all)
    .filter(x => !/^APTO\b/i.test(x))
    .filter(x => !NON_LIMITATION.test(x));
  return cleanLimitation(unique.join('; ')).slice(0, 600);
};

const detectCentre = (text: string) => {
  const match = text.match(/(?:CENTRO\s+M[EÉ]DICO|SERVICIO\s+DE\s+PREVENCI[OÓ]N|ENTIDAD)\s*[:\-]?\s*([^\n|]{3,100})/i);
  return match?.[1]?.trim() || 'No especificado';
};
const hasMixedNegativeResults = (text: string) => { const n = normalize(text); return /NO\s+APTO|INAPTO|APTO\s+CON\s+(LIMITACION|LIMITACIONES|RESTRICCION|RESTRICCIONES)/.test(n); };
const hasGlobalApto = (text: string) => { const n = normalize(text); return /RELACION\s+DE\s+TRABAJADORES\s+APTOS|LISTADO\s+DE\s+TRABAJADORES\s+APTOS|TODOS\s+(LOS\s+)?TRABAJADORES\s+APTOS|TODOS\s+APTOS|APTITUD\s+FAVORABLE/.test(n); };

const findNextWorkerBoundary = (lines: string[], start: number, workers: Person[], currentId: number) => {
  for (let i = start + 1; i < Math.min(lines.length, start + 60); i += 1) {
    const lineDni = compactDni(lines[i]);
    for (const other of workers) {
      if (other.id === currentId) continue;
      const dni = compactDni(other.dni);
      if (dni.length >= 8 && lineDni.includes(dni)) return i;
      if (scoreName(lines[i], other.apellidosNombre) >= 0.9) return i;
    }
  }
  return Math.min(lines.length, start + 55);
};

const findPreviousWorkerBoundary = (lines: string[], start: number, workers: Person[], currentId: number) => {
  for (let i = start - 1; i >= Math.max(0, start - 30); i -= 1) {
    const lineDni = compactDni(lines[i]);
    for (const other of workers) {
      if (other.id === currentId) continue;
      const dni = compactDni(other.dni);
      if (dni.length >= 8 && lineDni.includes(dni)) return i + 1;
      if (scoreName(lines[i], other.apellidosNombre) >= 0.9) return i + 1;
    }
  }
  return Math.max(0, start - 12);
};

export function analyzeMedicalDocumentText(text: string, workers: Person[], sourceFilename: string): MedicalRecordImportItem[] {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const flat = lines.join('\n');
  if (!normalize(flat)) return [];

  const globalDate = detectDate(flat);
  const globalValidity = detectValidity(flat, globalDate);
  const centroMedico = detectCentre(flat);
  const globalApto = hasGlobalApto(flat) && !hasMixedNegativeResults(flat);
  const out: MedicalRecordImportItem[] = [];
  const totalLimitedMarkers = (normalize(flat).match(/APTO\s+CON\s+(?:LIMITACION|LIMITACIONES|RESTRICCION|RESTRICCIONES)/g) || []).length;

  for (const worker of workers) {
    const workerDni = compactDni(worker.dni);
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const lineDni = compactDni(lines[i]);
      if (workerDni && workerDni.length >= 8 && lineDni.includes(workerDni)) { bestIndex = i; bestScore = 1.2; break; }
      const score = scoreName(lines[i], worker.apellidosNombre);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    if (bestIndex < 0 || bestScore < 0.62) continue;

    const from = findPreviousWorkerBoundary(lines, bestIndex, workers, worker.id);
    const boundary = findNextWorkerBoundary(lines, bestIndex, workers, worker.id);
    const workerLines = lines.slice(from, boundary);
    const resultWindow = lines.slice(Math.max(from, bestIndex - 4), Math.min(boundary, bestIndex + 35));
    const windowText = resultWindow.join('\n');
    let resultado = detectResult(windowText) || detectResult(workerLines.join('\n'));
    if (!resultado && globalApto) resultado = 'Apto';
    if (!resultado) continue;

    const fechaReconocimiento = detectDate(workerLines.join('\n')) || globalDate;
    const validez = detectValidity(workerLines.join('\n'), fechaReconocimiento) || globalValidity;
    const broaderLines = totalLimitedMarkers <= 1 ? lines : workerLines;
    const limitaciones = resultado === 'Apto con Limitación' ? detectLimitations(workerLines, broaderLines, worker) : '';
    const inconsistencias: string[] = [];
    if (resultado === 'Apto con Limitación' && !limitaciones) inconsistencias.push('El documento indica apto con limitaciones, pero no se ha podido aislar el texto exacto de la limitación. Revisar antes de guardar.');

    const localResult = !!detectResult(windowText) || !!detectResult(workerLines.join('\n'));
    let confianza: 'alta' | 'media' | 'baja' = bestScore >= 0.92 && localResult ? 'alta' : bestScore >= 0.75 ? 'media' : 'baja';
    if (resultado === 'Apto con Limitación' && !limitaciones) confianza = 'baja';
    if (resultado === 'Apto con Limitación' && limitaciones && bestScore >= 0.92) confianza = 'alta';

    out.push({
      dni: worker.dni || '', apellidosNombre: worker.apellidosNombre, resultado, limitaciones,
      fechaReconocimiento, validez, centroMedico,
      observaciones: `Reconocido automáticamente desde ${sourceFilename} mediante extracción local/OCR.${limitaciones ? ` Limitaciones transcritas: ${limitaciones}` : ''}`,
      confianza, dniValido: true, fechaValida: !!fechaReconocimiento,
      centroValido: centroMedico !== 'No especificado', inconsistencias,
      matchedPersonId: worker.id, matchedPersonName: worker.apellidosNombre, archivoOrigen: sourceFilename,
    });
  }
  return out;
}
