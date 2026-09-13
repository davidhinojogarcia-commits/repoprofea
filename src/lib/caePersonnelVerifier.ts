import type { SubcontrataDocItem } from '../../types';

export type CaeTextFile = { name: string; extractedText?: string };
type PersonalKind = 'altas_ss' | 'dni_nie' | 'aptitud_medica' | 'formacion_prl' | 'entrega_epis' | 'autorizacion_maquinaria';

const norm = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const cleanDni = (value: unknown) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const extractDnis = (text: string) => {
  const set = new Set<string>();
  const re = /\b([XYZ]?\s*\d{7,8}\s*[A-Z])\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || '')))) {
    const dni = cleanDni(m[1]);
    if (dni.length >= 8) set.add(dni);
  }
  return set;
};

const kindsFor = (file: CaeTextFile): PersonalKind[] => {
  const text = norm(`${file.name}\n${file.extractedText || ''}`);
  const kinds = new Set<PersonalKind>();
  if (/\b(informe de trabajadores en alta|ita|rnt|relacion nominal de trabajadores|informe de datos para la cotizacion|idc|alta seguridad social)\b/.test(text)) kinds.add('altas_ss');
  if (/\b(documento nacional de identidad|dni|nie|tarjeta de identidad de extranjero)\b/.test(text)) kinds.add('dni_nie');
  if (/\b(aptitud medica|vigilancia de la salud|reconocimiento medico|certificado de aptitud|apto con limitacion|apto)\b/.test(text)) kinds.add('aptitud_medica');
  if (/\b(formacion en prevencion|prevencion de riesgos laborales|tpc|curso 20 horas|curso 6 horas|formacion por oficio)\b/.test(text)) kinds.add('formacion_prl');
  if (/\b(entrega de epis|entrega de epi|equipos de proteccion individual|justificante de entrega)\b/.test(text)) kinds.add('entrega_epis');
  if (/\b(autorizacion.*maquinaria|autorizado.*manejo|operador de maquinaria|manejo de maquinaria|carretilla|dumper|plataforma elevadora|retroexcavadora)\b/.test(text)) kinds.add('autorizacion_maquinaria');
  return [...kinds];
};

const findRawWorker = (rawWorkers: any[], dni: string) => rawWorkers.find(raw => cleanDni(raw?.dni) === dni);

export const verifySubcontractorPersonnel = (rawWorkers: any[], files: CaeTextFile[], checklist: SubcontrataDocItem[]) => {
  // REGLA ESTRICTA: ITA/RNT/IDC/alta es la única fuente que crea trabajadores.
  // DNI, reconocimiento médico, formación, EPIs y maquinaria solo acreditan a personas ya incluidas en esa plantilla.
  const itaRoster = new Set<string>();
  const evidence = new Map<string, { kinds: Set<PersonalKind>; files: Set<string> }>();

  for (const file of files) {
    const kinds = kindsFor(file);
    if (!kinds.length) continue;
    const dnis = extractDnis(file.extractedText || '');
    if (kinds.includes('altas_ss')) dnis.forEach(dni => itaRoster.add(dni));

    for (const dni of dnis) {
      const item = evidence.get(dni) || { kinds: new Set<PersonalKind>(), files: new Set<string>() };
      kinds.forEach(kind => item.kinds.add(kind));
      item.files.add(file.name);
      evidence.set(dni, item);
    }
  }

  const required = checklist.filter(item => item.categoria === 'trabajadores' && item.obligatorio !== false).map(item => item.id);
  const verified: any[] = [];

  for (const dni of itaRoster) {
    const raw = findRawWorker(Array.isArray(rawWorkers) ? rawWorkers : [], dni) || {};
    const ev = evidence.get(dni) || { kinds: new Set<PersonalKind>(['altas_ss']), files: new Set<string>() };
    const docs = [...ev.kinds].filter(kind => kind !== 'dni_nie');
    const motivos: string[] = [];

    for (const id of required) {
      if (!docs.includes(id as PersonalKind)) motivos.push(`No consta para este trabajador: ${checklist.find(item => item.id === id)?.nombre || id}.`);
    }

    verified.push({
      ...raw,
      id: raw.id || `cae_${dni}`,
      nombreApellidos: raw.nombreApellidos || raw.nombre || '',
      dni,
      puestoTrabajo: raw.puestoTrabajo || raw.puesto || '',
      coincideITA: true,
      estadoAcceso: motivos.length ? 'no_autorizado' : 'autorizado',
      motivosNoAutorizado: motivos,
      documentosAcreditados: docs,
      archivosOrigen: [...ev.files],
      evidenciaIdentidad: 'ITA/RNT/IDC o alta de Seguridad Social aportada',
      confirmadoPorUsuario: false,
    });
  }

  return verified;
};
