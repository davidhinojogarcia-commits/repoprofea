export type VisitStatus = 'draft' | 'review' | 'changes' | 'rejected' | 'signing' | 'signed' | 'cancelled';
export type VisitPerson = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  entity: string;
  phone: string;
  email: string;
  attended: boolean;
  reviewRequired: boolean;
  signing: 'required' | 'optional' | 'none';
  receiveFinal: boolean;
};
export type VisitAgreement = {
  id: string;
  text: string;
  responsible: string;
  deadline: string;
  source?: string;
};
export type VisitAttachment = {
  id: string;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'application/pdf';
  base64: string;
  caption: string;
};
export type VisitContent = {
  worksiteId: string;
  worksite: string;
  code: string;
  location: string;
  municipality: string;
  promoter: string;
  author: string;
  authorRole: string;
  authorEmail: string;
  authorPhone: string;
  date: string;
  start: string;
  end: string;
  purpose: string;
  discussion: string;
  observations: string;
  nextVisit: string;
  agreements: VisitAgreement[];
  attachments: VisitAttachment[];
};
export type VisitResponse = {
  decision: 'agree' | 'changes' | 'reject';
  comment: string;
  at: string;
  mode: 'email-code' | 'in-person';
};
export type VisitSignature = {
  image: string;
  at: string;
  mode: 'email-code' | 'in-person';
};
export type VisitState = {
  version: number;
  status: VisitStatus;
  content: VisitContent;
  participants: VisitPerson[];
  responses: Record<string, VisitResponse>;
  signatures: Record<string, VisitSignature>;
  createdAt: string;
  issuedAt?: string;
  finalizedAt?: string;
  cancelledReason?: string;
  followup: Record<string, {
    done: boolean;
    note: string;
    at: string;
  }>;
  finalSha256?: string;
};
export type VisitRecord = {
  id: string;
  owner_id: string;
  obra_id: string;
  number: string;
  revision: number;
  status: VisitStatus;
  version: number;
  state: VisitState;
  updated_at: string;
  canWrite?: boolean;
};
export type VisitContact = {
  id: string;
  revision: number;
  firstName: string;
  lastName: string;
  role: string;
  entity: string;
  phone: string;
  email: string;
  active: boolean;
  assignments: {
    worksiteId: string;
    role: string;
  }[];
};
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  draft: 'Borrador',
  review: 'En revisión',
  changes: 'Cambios solicitados',
  rejected: 'Disconformidad',
  signing: 'Pendiente de firmas',
  signed: 'Firmada',
  cancelled: 'Anulada'
};
export const VISIT_NOTICE = 'Acta de seguimiento de visita. No sustituye al Libro de Órdenes y Asistencias ni al Libro de Incidencias. Firma manuscrita capturada; no es una firma con certificado digital.';
export const uuidValid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
export const emailValid = (s: string) => /^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/.test(s);
const text = (s: unknown, max = 20000) => {
  if (typeof s !== 'string' || s.length > max) throw new Error('Texto inválido o demasiado largo.');
  return s.trim();
};
const insist: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const madridDate = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(date);
export const madridTimestamp = (date: string) => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  dateStyle: 'short',
  timeStyle: 'short'
}).format(new Date(date));
export const personName = (p: Pick<VisitPerson, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`.trim();
export function cleanContact(raw: any): VisitContact {
  insist(uuidValid(raw?.id), 'Identificador de contacto inválido.');
  const value = {
    id: raw.id,
    revision: Number(raw.revision) || 0,
    firstName: text(raw.firstName, 150),
    lastName: text(raw.lastName, 200),
    role: text(raw.role, 200),
    entity: text(raw.entity, 200),
    phone: text(raw.phone, 60),
    email: text(raw.email, 254).toLowerCase(),
    active: raw.active !== false,
    assignments: [] as VisitContact['assignments']
  };
  insist(value.firstName && value.lastName && value.role, 'Indica nombre, apellidos y cargo.');
  insist(!value.email || emailValid(value.email), 'Correo electrónico inválido.');
  insist(Array.isArray(raw.assignments) && raw.assignments.length <= 100, 'Asignaciones inválidas.');
  value.assignments = raw.assignments.map((a: any) => {
    insist(uuidValid(a.worksiteId), 'Obra inválida.');
    return {
      worksiteId: a.worksiteId,
      role: text(a.role, 200)
    };
  });
  insist(new Set(value.assignments.map(a => a.worksiteId)).size === value.assignments.length, 'Hay obras duplicadas.');
  return value;
}
export function cleanVisit(content: any, participants: any[]): {
  content: VisitContent;
  participants: VisitPerson[];
} {
  insist(content && uuidValid(content.worksiteId), 'Selecciona una obra registrada.');
  const c = {} as VisitContent;
  for (const key of ['worksiteId', 'worksite', 'code', 'location', 'municipality', 'promoter', 'author', 'authorRole', 'authorEmail', 'authorPhone', 'date', 'start', 'end', 'purpose', 'discussion', 'observations', 'nextVisit'] as const) c[key] = text(content[key], ['discussion', 'observations', 'purpose'].includes(key) ? 50000 : 500);
  insist(c.worksite && c.author && c.authorRole, 'Indica obra, autor y cargo.');
  insist(/^\d{4}-\d{2}-\d{2}$/.test(c.date) && new Date(c.date + 'T12:00:00Z').toISOString().slice(0, 10) === c.date, 'Fecha de visita inválida.');
  insist(/^([01]\d|2[0-3]):[0-5]\d$/.test(c.start) && (!c.end || /^([01]\d|2[0-3]):[0-5]\d$/.test(c.end)), 'Hora inválida.');
  insist(!c.end || c.end >= c.start, 'La hora final debe ser posterior a la inicial; para visitas nocturnas utiliza actas por fecha.');
  insist(!c.authorEmail || emailValid(c.authorEmail), 'Correo del autor inválido.');
  insist(!c.nextVisit || /^\d{4}-\d{2}-\d{2}$/.test(c.nextVisit), 'Próxima visita inválida.');
  insist(Array.isArray(content.agreements) && content.agreements.length <= 100, 'Acuerdos inválidos.');
  c.agreements = content.agreements.map((a: any) => {
    insist(uuidValid(a.id), 'Acuerdo inválido.');
    const deadline = text(a.deadline, 10);
    insist(!deadline || /^\d{4}-\d{2}-\d{2}$/.test(deadline), 'Plazo inválido.');
    return {
      id: a.id,
      text: text(a.text, 10000),
      responsible: text(a.responsible, 300),
      deadline,
      ...(a.source ? {
        source: text(a.source, 200)
      } : {})
    };
  });
  insist(new Set(c.agreements.map(a => a.id)).size === c.agreements.length, 'Acuerdos duplicados.');
  insist(Array.isArray(content.attachments) && content.attachments.length <= 8, 'Máximo ocho anexos.');
  c.attachments = content.attachments.map((a: any) => {
    insist(uuidValid(a.id) && ['image/png', 'image/jpeg', 'application/pdf'].includes(a.mime), 'Tipo de anexo no permitido.');
    const base64 = text(a.base64, 1800000);
    insist(/^[a-z0-9+/]+={0,2}$/i.test(base64) && base64.length % 4 === 0, 'Anexo inválido.');
    return {
      id: a.id,
      name: text(a.name, 150),
      mime: a.mime,
      base64,
      caption: text(a.caption, 1000)
    };
  });
  insist(c.attachments.reduce((n, a) => n + a.base64.length, 0) <= 2000000, 'Los anexos superan el límite conjunto de 1,5 MB. Reduce su tamaño.');
  insist(Array.isArray(participants) && participants.length <= 40, 'Máximo cuarenta participantes.');
  const people = participants.map(p => {
    const contact = cleanContact({
      ...p,
      active: true,
      assignments: []
    });
    insist(['required', 'optional', 'none'].includes(p.signing), 'Tipo de firmante inválido.');
    insist(p.signing === 'none' || p.reviewRequired === true, 'Los firmantes deben revisar el acta.');
    return {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.role,
      entity: contact.entity,
      phone: contact.phone,
      email: contact.email,
      attended: p.attended === true,
      reviewRequired: p.reviewRequired === true,
      signing: p.signing,
      receiveFinal: p.receiveFinal === true
    } as VisitPerson;
  });
  insist(new Set(people.map(p => p.id)).size === people.length, 'Participantes duplicados.');
  insist(new Set(people.map(p => `${personName(p).toLocaleLowerCase('es')}|${p.entity.toLocaleLowerCase('es')}`)).size === people.length, 'La misma persona aparece más de una vez.');
  insist(new Set(people.filter(p => p.email).map(p => p.email)).size === people.filter(p => p.email).length, 'Cada participante debe utilizar su propio correo.');
  return {
    content: c,
    participants: people
  };
}
export function newVisit(content: VisitContent, people: VisitPerson[], now: string): VisitState {
  return {
    version: 1,
    status: 'draft',
    ...cleanVisit(content, people),
    responses: {},
    signatures: {},
    createdAt: now,
    followup: {}
  };
}
export type VisitCommand = {
  type: 'save';
  content: VisitContent;
  participants: VisitPerson[];
} | {
  type: 'review' | 'open-signing' | 'revise' | 'finalize';
} | {
  type: 'respond';
  personId: string;
  decision: VisitResponse['decision'];
  comment: string;
  mode: VisitResponse['mode'];
} | {
  type: 'sign';
  personId: string;
  image: string;
  mode: VisitSignature['mode'];
} | {
  type: 'cancel';
  reason: string;
} | {
  type: 'followup';
  agreementId: string;
  done: boolean;
  note: string;
};
export function applyVisitCommand(before: VisitState, command: VisitCommand, now: string): VisitState {
  const state: VisitState = structuredClone(before);
  insist(state.status !== 'cancelled', 'Esta acta está anulada.');
  switch (command.type) {
    case 'save':
      insist(state.status === 'draft', 'Abre una nueva versión para modificar el contenido.');
      Object.assign(state, cleanVisit(command.content, command.participants));
      break;
    case 'review':
      insist(state.status === 'draft', 'Esta versión ya se ha enviado a revisión.');
      insist(state.content.purpose && state.content.discussion && state.content.end, 'Completa objeto, asuntos tratados y hora final antes de revisar.');
      insist(state.participants.some(p => p.signing === 'required'), 'Debe haber al menos un firmante obligatorio.');
      insist(state.participants.filter(p => p.receiveFinal).every(p => p.email), 'Completa el correo de quienes deben recibir el PDF final o desmarca su distribución antes de emitir.');
      insist(state.content.agreements.every(a => a.text), 'Completa o elimina los acuerdos vacíos.');
      state.status = 'review';
      state.issuedAt = now;
      break;
    case 'respond':
      {
        insist(['review', 'changes', 'rejected'].includes(state.status), 'La revisión de esta versión está cerrada.');
        const p = state.participants.find(p => p.id === command.personId);
        insist(p?.reviewRequired && !state.responses[p.id], 'Esta persona no debe responder o ya ha respondido; una corrección requiere nueva versión.');
        insist(['agree', 'changes', 'reject'].includes(command.decision), 'Respuesta inválida.');
        const comment = text(command.comment, 5000);
        insist(command.decision === 'agree' || comment, 'Explica los cambios o la disconformidad.');
        state.responses[p.id] = {
          decision: command.decision,
          comment,
          at: now,
          mode: command.mode
        };
        state.status = Object.values(state.responses).some(r => r.decision === 'reject') ? 'rejected' : Object.values(state.responses).some(r => r.decision === 'changes') ? 'changes' : 'review';
        break;
      }
    case 'open-signing':
      insist(state.status === 'review' && state.participants.filter(p => p.reviewRequired).every(p => state.responses[p.id]?.decision === 'agree'), 'Faltan conformidades o hay cambios/disconformidades pendientes.');
      state.status = 'signing';
      break;
    case 'sign':
      {
        insist(state.status === 'signing', 'El acta no está abierta a firma.');
        const p = state.participants.find(p => p.id === command.personId);
        insist(p && p.signing !== 'none' && state.responses[p.id]?.decision === 'agree' && !state.signatures[p.id], 'Firma no permitida o ya confirmada.');
        insist(typeof command.image === 'string' && command.image.length <= 250000 && /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(command.image), 'La firma debe ser una imagen PNG válida de tamaño reducido.');
        state.signatures[p.id] = {
          image: command.image,
          at: now,
          mode: command.mode
        };
        break;
      }
    case 'finalize':
      insist(state.status === 'signing' && state.participants.some(p => p.signing === 'required') && state.participants.filter(p => p.signing === 'required').every(p => state.signatures[p.id]), 'Faltan firmas obligatorias.');
      state.status = 'signed';
      state.finalizedAt = now;
      break;
    case 'revise':
      insist(state.status !== 'draft', 'Ya estás editando un borrador.');
      state.version++;
      state.status = 'draft';
      state.responses = {};
      state.signatures = {};
      state.createdAt = now;
      delete state.issuedAt;
      delete state.finalizedAt;
      delete state.finalSha256;
      break;
    case 'cancel':
      state.cancelledReason = text(command.reason, 2000);
      insist(state.cancelledReason, 'Indica el motivo de anulación.');
      state.status = 'cancelled';
      break;
    case 'followup':
      insist(state.status === 'signed' && state.content.agreements.some(a => a.id === command.agreementId), 'Acuerdo no disponible para seguimiento.');
      state.followup[command.agreementId] = {
        done: command.done === true,
        note: text(command.note, 2000),
        at: now
      };
      break;
    default:
      throw new Error('Operación no reconocida.');
  }
  return state;
}
export function visitMail(state: VisitState, number: string, kind: 'review' | 'signing' | 'final', person: VisitPerson, link = '') {
  const c = state.content;
  const subject = `${kind === 'review' ? 'Revisión' : kind === 'signing' ? 'Firma' : 'Acta firmada'} · ${number} · ${c.code || c.worksite}`;
  const intro = kind === 'review' ? 'Le remito para su revisión el acta de la visita de obra. Revise su contenido y registre su conformidad, solicitud de cambios o disconformidad.' : kind === 'signing' ? 'Completadas las conformidades, el acta está disponible para su firma manuscrita.' : 'Adjunto el acta firmada de la visita de obra para su conocimiento y seguimiento de los acuerdos que le correspondan.';
  const body = [`Estimado/a ${personName(person)}:`, '', intro, '', `Obra: ${c.worksite}`, `Código: ${c.code || 'No indicado'}`, `Acta: ${number} · Versión ${state.version}`, `Visita: ${c.date} · ${c.start}${c.end ? ' a ' + c.end : ''} (Europe/Madrid)`, '', ...(kind === 'final' && c.agreements.length ? ['Acuerdos recogidos en el acta:', ...c.agreements.map((a, i) => `${i + 1}. ${a.text}${a.responsible ? ' · Responsable: ' + a.responsible : ''}${a.deadline ? ' · Plazo: ' + a.deadline : ''}`), ''] : []), ...(link ? ['Acceso personal (requiere código enviado a su correo):', link, 'No comparta este enlace ni el código de verificación.', ''] : []), 'Para cualquier aclaración puede contactar con la persona que suscribe.', '', 'Atentamente,', c.author, c.authorRole, ...[c.authorPhone, c.authorEmail].filter(Boolean), '', 'GestionProfea · Seguimiento de visitas de obra.'].join('\n');
  return {
    subject,
    body
  };
}
