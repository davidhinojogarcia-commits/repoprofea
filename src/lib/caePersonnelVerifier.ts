import type { SubcontrataDocItem } from '../../types';

export type CaeTextFile = { name: string; extractedText?: string };
type PersonalKind = 'altas_ss' | 'dni_nie' | 'aptitud_medica' | 'formacion_prl' | 'entrega_epis' | 'autorizacion_maquinaria';

const norm = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const cleanDni = (value: unknown) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const DNI_RE = /\b([XYZ]?\s*\d{7,8}\s*[A-Z])\b/gi;

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

const contextForDni = (text: string, dni: string) => {
  const source = String(text || '');
  const compact = cleanDni(dni);
  DNI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DNI_RE.exec(source))) {
    if (cleanDni(match[1]) !== compact) continue;
    const start = Math.max(0, match.index - 220);
    const end = Math.min(source.length, match.index + match[0].length + 220);
    return norm(source.slice(start, end));
  }
  return '';
};

const workerMarkers = /\b(trabajador|trabajadora|operario|operaria|empleado|empleada|personal|categoria|puesto|oficio|apto|aptitud|vigilancia de la salud|reconocimiento medico|alumno|participante|entrega de epis|recibe epis|autorizado para|manejo de maquinaria|alta en seguridad social|situacion de alta|relacion nominal)\b/;
const excludedRoleMarkers = /\b(medico|medica|doctor|doctora|facultativo|colegiado|colegiada|formador|formadora|docente|tecnico de prevencion|tecnica de prevencion|administrador|administradora|gerente|representante legal|apoderado|apoderada|coordinador|coordinadora|director|directora|responsable de prevencion|servicio de prevencion)\b/;

const evidenceIsWorker = (kind: PersonalKind, context: string) => {
  if (!context) return false;
  const hasWorkerMarker = workerMarkers.test(context);
  const hasExcludedRole = excludedRoleMarkers.test(context);
  if (kind === 'altas_ss') return hasWorkerMarker && !hasExcludedRole;
  if (kind === 'aptitud_medica') return /\b(apto|aptitud|trabajador|paciente|puesto|reconocimiento medico)\b/.test(context) && !(hasExcludedRole && !hasWorkerMarker);
  if (kind === 'formacion_prl') return /\b(alumno|participante|trabajador|curso|formacion|oficio|tpc)\b/.test(context) && !(hasExcludedRole && !hasWorkerMarker);
  if (kind === 'entrega_epis') return /\b(trabajador|recibe|entrega|epis|equipos de proteccion)\b/.test(context) && !(hasExcludedRole && !hasWorkerMarker);
  if (kind === 'autorizacion_maquinaria') return /\b(trabajador|operador|autorizado|manejo|maquinaria)\b/.test(context) && !(hasExcludedRole && !hasWorkerMarker);
  if (kind === 'dni_nie') return !hasExcludedRole;
  return false;
};

export const verifySubcontractorPersonnel = (rawWorkers: any[], files: CaeTextFile[], checklist: SubcontrataDocItem[]) => {
  const evidence = new Map<string, { kinds: Set<PersonalKind>; files: Set<string>; workerKinds: Set<PersonalKind> }>();

  for (const file of files) {
    const kinds = kindsFor(file);
    if (!kinds.length) continue;
    const text = String(file.extractedText || '');
    DNI_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DNI_RE.exec(text))) {
      const dni = cleanDni(match[1]);
      if (dni.length < 8) continue;
      const context = contextForDni(text, dni);
      const validKinds = kinds.filter(kind => evidenceIsWorker(kind, context));
      if (!validKinds.length) continue;
      const item = evidence.get(dni) || { kinds: new Set<PersonalKind>(), files: new Set<string>(), workerKinds: new Set<PersonalKind>() };
      validKinds.forEach(kind => {
        item.kinds.add(kind);
        if (kind !== 'dni_nie') item.workerKinds.add(kind);
      });
      item.files.add(file.name);
      evidence.set(dni, item);
    }
  }

  const required = checklist.filter(item => item.categoria === 'trabajadores' && item.obligatorio !== false).map(item => item.id);
  const verified = new Map<string, any>();

  for (const raw of Array.isArray(rawWorkers) ? rawWorkers : []) {
    const dni = cleanDni(raw?.dni);
    if (!dni) continue;
    const ev = evidence.get(dni);
    if (!ev) continue;

    // A worker must be evidenced as personnel, not merely as a signatory or professional appearing in a document.
    // Accepted identity: ITA/RNT/IDC, or DNI/NIE plus one worker document, or at least two distinct worker documents.
    const inSocialSecurityRoster = ev.kinds.has('altas_ss');
    const idPlusWorkerDoc = ev.kinds.has('dni_nie') && ev.workerKinds.size >= 1;
    const corroboratedWorker = ev.workerKinds.size >= 2;
    if (!inSocialSecurityRoster && !idPlusWorkerDoc && !corroboratedWorker) continue;

    const docs = [...ev.workerKinds];
    const motivos: string[] = [];
    if (!inSocialSecurityRoster) motivos.push('No figura con el mismo DNI/NIE en ITA/RNT/IDC o documento de alta aportado.');
    for (const id of required) {
      if (id === 'altas_ss') continue;
      if (!docs.includes(id as PersonalKind)) motivos.push(`No consta para este trabajador: ${checklist.find(item => item.id === id)?.nombre || id}.`);
    }

    verified.set(dni, {
      ...raw,
      dni,
      coincideITA: inSocialSecurityRoster,
      estadoAcceso: motivos.length ? 'no_autorizado' : 'autorizado',
      motivosNoAutorizado: motivos,
      documentosAcreditados: docs,
      archivosOrigen: [...ev.files],
      evidenciaIdentidad: inSocialSecurityRoster ? 'ITA/RNT/IDC' : idPlusWorkerDoc ? 'DNI/NIE + documentación laboral nominal' : 'Documentación laboral nominal corroborada',
      confirmadoPorUsuario: false,
    });
  }

  return [...verified.values()];
};
