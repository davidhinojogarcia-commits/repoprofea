import { isOrderAction, handleVisitOrders, resolveOrderReferences, assertVisitOrders } from './visitWorkOrdersHandler.js';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, authenticateRequest, encryptToken, decryptToken, getConnection, refreshGoogleAccessToken, requireServerConfig, touchSent } from './gmailOAuth.js';
import { applyVisitCommand, cleanContact, newVisit, uuidValid, visitMail, type VisitCommand, type VisitRecord, type VisitState } from '../lib/visitMinutes.js';
import { generateVisitMinutesPdf } from '../lib/visitMinutesPdf.js';
const fail = (message: string, status = 400) => Object.assign(new Error(message), {
  status
});
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const freshToken = () => randomBytes(32).toString('base64url');
const serviceHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json'
});
async function database(path: string, body?: any, authorization?: string, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: authorization ? {
      apikey: PUBLIC_KEY,
      Authorization: authorization,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    } : {
      ...serviceHeaders(),
      Prefer: 'return=representation'
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message=String(data?.message);
    if(/visit_contacts_email_unique/.test(message))throw fail('Ya hay un contacto con ese correo. Edita el contacto existente.',409);
    if(/Sin permisos|Sin permiso|Sin competencia|Encargado sin autorización|Acta no autorizada|Obra no autorizada|Cuenta no activa|Acceso revocado/.test(message))throw fail('El permiso o enlace ya no está vigente. Actualiza y comprueba el acceso.',403);
    if(/envío en curso/.test(message))throw fail('Hay un envío en curso. Comprueba su resultado antes de cambiar la versión.',409);
    if(/demasiado grande|Archivo final inválido/.test(message))throw fail('El acta o PDF supera los límites de tamaño. Revisa los anexos antes de continuar.',413);
    const stale = /Revisión desactualizada|Operación reutilizada|duplicate key/i.test(message);
    throw fail(stale ? 'Otra operación cambió estos datos. Recarga y revisa antes de guardar.' : 'No se pudo acceder a las actas. Comprueba los permisos y que la migración del módulo esté instalada.', stale ? 409 : response.status === 401 || response.status === 403 ? 403 : 503);
  }
  return data;
}
const query = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
function pngDimensions(bytes:Buffer,maxPixels:number) {
  if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('PNG inválido');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>10000||height>10000||width*height>maxPixels)throw new Error('Dimensiones excesivas');
  return {width,height};
}
async function validateSignature(image:unknown) {
  try {
    if(typeof image!=='string'||image.length>250000||!/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(image))throw new Error('Formato inválido');
    const bytes=Buffer.from(image.slice(image.indexOf(',')+1),'base64');
    const size=pngDimensions(bytes,2097152);if(size.width>4096||size.height>1024)throw new Error('Firma demasiado grande');
    await PDFDocument.create().then(pdf=>pdf.embedPng(bytes));
  }catch{throw fail('La firma no es legible o supera el tamaño permitido. Bórrala y vuelve a firmar.');}
}
async function validateAttachments(state: VisitState) {
  for (const a of state.content.attachments) {
    const bytes = Buffer.from(a.base64, 'base64');
    try {
      if (a.mime === 'application/pdf') {
        const pdf = await PDFDocument.load(bytes);
        if (pdf.getPageCount() > 30) throw new Error('Demasiadas páginas');
      } else {
        if(a.mime==='image/png')pngDimensions(bytes,16000000);
        const pdf = await PDFDocument.create();
        const image = a.mime === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        if (image.width > 10000 || image.height > 10000 || image.width*image.height>16000000) throw new Error('Imagen demasiado grande');
      }
    } catch {
      throw fail('Un anexo no es legible, está protegido o supera los límites. Revísalo antes de guardar.');
    }
  }
}
function verifiedStoredPdf(file: any, state: VisitState) {
  if (!file && state.finalSha256) throw fail('Falta el archivo final conservado. No se regenerará un documento firmado.', 409);
  if (file && (digest(Buffer.from(file.base64, 'base64')) !== file.sha256 || state.finalSha256 && state.finalSha256 !== file.sha256)) throw fail('La integridad del archivo final no coincide. No se ha descargado ni enviado.', 409);
}
async function activeUser(req: any) {
  const user = await authenticateRequest(req);
  const rows = await database(`profiles?${query({
    select: 'id',
    id: `eq.${user.id}`,
    active: 'eq.true',
    limit: '1'
  })}`);
  if (!rows.length) throw fail('La cuenta no está activa.', 403);
  return user;
}
async function ownerRecord(id: string, userId: string, authorization: string, write = true): Promise<VisitRecord> {
  if (!uuidValid(id)) throw fail('Acta inválida.');
  const rows = await database(`visit_minutes?${query({
    select: '*',
    id: `eq.${id}`,
    limit: '1'
  })}`, undefined, authorization);
  const r = rows?.[0];
  if (!r || write && r.owner_id !== userId) throw fail('No tienes permiso para esta operación.', 403);
  const canWrite=r.owner_id===userId && await database('rpc/visit_minutes_owner_can_write',{p_owner:userId,p_work:r.obra_id});
  if(write&&!canWrite)throw fail('Ya no tienes permiso de modificación sobre esta obra.',403);
  return {
    ...r,
    canWrite
  };
}
async function accessRecord(token: string, session?: string) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw fail('Enlace no válido o caducado.', 403);
  const [access] = await database(`visit_minutes_access?${query({
    select: '*',
    token_hash: `eq.${digest(token)}`,
    limit: '1'
  })}`);
  if (!access || access.revoked || new Date(access.expires_at).getTime() <= Date.now()) throw fail('Enlace no válido o caducado.', 403);
  const [record] = await database(`visit_minutes?${query({
    select: '*',
    id: `eq.${access.record_id}`,
    limit: '1'
  })}`);
  const owner = record && await database('rpc/visit_minutes_owner_can_write',{p_owner:record.owner_id,p_work:record.obra_id});
  if (!owner || !record || record.version !== access.version || record.status === 'cancelled') throw fail('Esta versión ya no está disponible. Solicita un nuevo acceso al supervisor.', 403);
  const person = record.state.participants.find((p: any) => p.id === access.person_id);
  if (!person?.email || !person.reviewRequired) throw fail('Acceso no autorizado.', 403);
  if (session !== undefined && (!/^[a-zA-Z0-9_-]{43}$/.test(session) || access.session_hash !== digest(session) || new Date(access.session_expires_at || 0).getTime() <= Date.now())) throw fail('Verifica de nuevo tu correo para continuar.', 401);
  return {
    access,
    record: record as VisitRecord,
    person
  };
}
const publicRecord = (r: VisitRecord, personId: string) => ({
  id: r.id,
  number: r.number,
  revision: r.revision,
  version: r.version,
  status: r.status,
  state: {
    ...r.state,
    participants: r.state.participants.map(p => ({
      ...p,
      phone: '',
      email: p.id === personId ? p.email : ''
    }))
  },
  personId
});
const mailPart = (value: string) => Buffer.from(value, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
async function gmailToken(ownerId: string) {
  requireServerConfig();
  const connection = await getConnection(ownerId);
  if (!connection?.refresh_token_encrypted) throw Object.assign(fail('Conecta Gmail en Configuración antes de enviar.', 409), {
    code: 'GMAIL_NOT_CONNECTED'
  });
  if (!String(connection.scope || '').split(/\s+/).some(s => ['gmail.send', 'https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/'].includes(s))) throw Object.assign(fail('Renueva Gmail para autorizar el envío.', 403), {
    code: 'GMAIL_SEND_PERMISSION_REQUIRED'
  });
  return {
    token: await refreshGoogleAccessToken(decryptToken(connection.refresh_token_encrypted)),
    from: connection.email
  };
}
export async function sendVisitMime(ownerId: string, to: string, mail: {
  subject: string;
  body: string;
}, identity: string, attachment?: {
  base64: string;
  filename: string;
}, connection?: {
  token: string;
  from: string;
}) {
  const {
    token,
    from
  } = connection || (await gmailToken(ownerId));
  const boundary = 'profea_visit_' + identity.replace(/[^a-z0-9]/gi, '');
  const clean = (v: string) => v.replace(/[\r\n"<>]/g, ' ').trim();
  const parts = [`To: ${clean(to)}`, `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString('base64')}?=`, `Message-ID: <visit-${clean(identity)}@gestionprofea.vercel.app>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', mailPart(mail.body)];
  if (attachment) parts.push(`--${boundary}`, `Content-Type: application/pdf; name="${clean(attachment.filename)}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${clean(attachment.filename)}"`, '', attachment.base64.replace(/(.{76})/g, '$1\r\n'));
  parts.push(`--${boundary}--`, '');
  let response: Response;
  try {
    response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: Buffer.from(parts.join('\r\n')).toString('base64url')
      }),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw Object.assign(fail('Gmail no confirmó el resultado. Comprueba Enviados; no se reintentará automáticamente.', 502), {
      uncertain: true,
      code: 'GMAIL_SEND_UNCERTAIN'
    });
  }
  const sent = await response.json().catch(() => ({}));
  if (!response.ok || typeof sent.id !== 'string' || !sent.id.trim()) throw Object.assign(fail(response.status === 401 ? 'Renueva la autorización de Gmail en Configuración.' : response.status === 429 ? 'Gmail ha limitado los envíos. Inténtalo más tarde.' : 'Gmail no confirmó el envío. Revisa Enviados.', response.status === 401 ? 401 : 502), {
    uncertain: response.ok || response.status >= 500,
    code: response.status === 401 ? 'GMAIL_RECONNECT_REQUIRED' : response.status === 429 ? 'GMAIL_RATE_LIMITED' : 'GMAIL_SEND_FAILED'
  });
  // Email confirmation is authoritative even if the auxiliary timestamp fails.
  await touchSent(ownerId).catch(() => undefined);
  return {
    messageId: sent.id,
    from
  };
}
async function linksAndJobs(record: VisitRecord, state: VisitState, kind: 'review' | 'signing' | 'final') {
  const links: any[] = [],
    jobs: any[] = [];
  const existingLinks = kind === 'final' ? [] : await database(`visit_minutes_access?${query({
    select: 'person_id,revoked,expires_at',
    record_id: `eq.${record.id}`,
    version: `eq.${state.version}`
  })}`);
  for (const p of state.participants.filter(p => p.email && (kind === 'final' ? p.receiveFinal : kind === 'review' ? p.reviewRequired : p.signing !== 'none'))) {
    if (kind !== 'final') {
      if (!existingLinks.some((a: any) => a.person_id === p.id && !a.revoked && new Date(a.expires_at).getTime() > Date.now())) {
        const token = freshToken();
        links.push({
          id: randomUUID(),
          personId: p.id,
          hash: digest(token),
          encrypted: encryptToken(token)
        });
      }
    }
    jobs.push({
      id: randomUUID(),
      personId: p.id,
      kind
    });
  }
  return {
    links,
    jobs
  };
}
async function committed(record: VisitRecord, state: VisitState, operation: string, hash: string, actor: string, event: string, extras: any = {}) {
  return database('rpc/visit_minutes_commit', {
    p_id: record.id,
    p_owner: record.owner_id,
    p_obra: state.content.worksiteId,
    p_expected: record.revision,
    p_state: state,
    p_operation: operation,
    p_hash: hash,
    p_actor: actor,
    p_event: event,
    p_links: extras.links || [],
    p_jobs: extras.jobs || [],
    p_pdf: extras.pdf || null,
    p_sha: extras.sha || null,
    p_access: extras.access || null,
    p_session: extras.session || null,
    p_details: extras.details || {}
  });
}
async function alreadyDone(record: VisitRecord, operation: string, hash: string) {
  const [r] = await database(`visit_minutes_operations?${query({
    select: 'request_hash',
    record_id: `eq.${record.id}`,
    operation_id: `eq.${operation}`,
    limit: '1'
  })}`);
  if (r && r.request_hash !== hash) throw fail('No reutilices una operación para enviar datos diferentes.', 409);
  return !!r;
}
const canonicalLink = (token: string) => {
  const url = new URL(process.env.VISIT_APP_URL || 'https://gestionprofea.vercel.app/');
  if (url.protocol !== 'https:' || url.username || url.password) throw fail('Dirección de aplicación inválida.', 503);
  return url.origin + '/#visit=' + token;
};
export async function visitMinutesHandler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method !== 'POST') return res.status(405).json({
      ok: false,
      message: 'Utiliza POST.'
    });
    if (!SERVICE_KEY) throw fail('El servidor de actas no está configurado.', 503);
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (Buffer.byteLength(JSON.stringify(b)) > 3100000) throw fail('La solicitud es demasiado grande. Reduce los anexos.', 413);
    const action = String(b.action || '');
    if(action.startsWith('foreman-visits-'))return await handleVisitOrders(req,b,res,null,'',{database,digest,validateAttachments});
    if (['challenge', 'verify', 'portal', 'portal-command', 'portal-pdf'].includes(action)) {
      const {
        access,
        record,
        person
      } = await accessRecord(String(b.token || ''), ['portal', 'portal-command', 'portal-pdf'].includes(action) ? String(b.session || '') : undefined);
      if (action === 'challenge') {
        if (access.requests >= 10 || new Date(access.otp_requested_at || 0).getTime() > Date.now() - 60000) throw fail('Espera un minuto antes de pedir otro código. El enlace admite un máximo de diez solicitudes.', 429);
        const connection = await gmailToken(record.owner_id);
        const code = String(randomInt(0, 1000000)).padStart(6, '0');
        if (!(await database('rpc/visit_minutes_challenge', {
          p_id: access.id,
          p_hash: digest(access.id + ':' + code)
        }))) throw fail('Espera un minuto antes de pedir otro código. El enlace admite un máximo de diez solicitudes.', 429);
        await sendVisitMime(record.owner_id, person.email, {
          subject: 'Código de acceso · ' + record.number,
          body: `Su código de acceso personal es: ${code}\n\nCaduca en diez minutos y solo permite revisar o firmar su participación en ${record.number}, versión ${record.version}. No lo comparta. Si no solicitó el acceso, ignore este correo.`
        }, randomUUID(), undefined, connection);
        return res.json({
          ok: true,
          message: 'Código enviado. Comprueba tu correo.'
        });
      }
      if (action === 'verify') {
        if (!/^\d{6}$/.test(String(b.code || ''))) throw fail('Introduce los seis dígitos.');
        const session = freshToken();
        if (!(await database('rpc/visit_minutes_verify', {
          p_id: access.id,
          p_hash: digest(access.id + ':' + b.code),
          p_session: digest(session)
        }))) throw fail('Código incorrecto, utilizado o caducado. Máximo cinco intentos.', 403);
        return res.json({
          ok: true,
          session,
          record: publicRecord(record, person.id)
        });
      }
      if (action === 'portal') return res.json({
        ok: true,
        record: publicRecord(record, person.id)
      });
      if (action === 'portal-pdf') {
        const [file] = await database(`visit_minutes_files?${query({
          select: 'base64,sha256',
          record_id: `eq.${record.id}`,
          version: `eq.${record.version}`,
          limit: '1'
        })}`);
        verifiedStoredPdf(file, record.state);
        const bytes = file ? Buffer.from(file.base64, 'base64') : await generateVisitMinutesPdf(record.state, record.number);
        return res.json({
          ok: true,
          base64: Buffer.from(bytes).toString('base64'),
          filename: `${record.number}_v${record.version}.pdf`
        });
      }
      if (!uuidValid(b.operation)) throw fail('Operación inválida.');
      const command: VisitCommand = b.command?.type === 'respond' ? {
        type: 'respond',
        personId: person.id,
        decision: b.command.decision,
        comment: String(b.command.comment || ''),
        mode: 'email-code'
      } : b.command?.type === 'sign' ? {
        type: 'sign',
        personId: person.id,
        image: b.command.image,
        intent: b.command.intent, note: b.command.note,
        mode: 'email-code'
      } : (() => {
        throw fail('Acción no autorizada.', 403);
      })();
      const hash = digest(JSON.stringify(command));
      if (await alreadyDone(record, b.operation, hash)) return res.json({
        ok: true,
        record: publicRecord(record, person.id)
      });
      if (Number(b.revision) !== record.revision) throw fail('La versión ha cambiado. Actualiza el acta.', 409);
      if (command.type === 'sign') await validateSignature(command.image);
      const state = applyVisitCommand(record.state, command, new Date().toISOString());
      const result = await committed(record, state, b.operation, hash, 'participant:' + person.id, command.type, {
        access: access.id,
        session: digest(String(b.session)),
        details: {personId:person.id,mode:'email-code'}
      });
      return res.json({
        ok: true,
        record: publicRecord(result, person.id)
      });
    }
    const user = await activeUser(req),
      auth = String(req.headers?.authorization || '');
    if(isOrderAction(action))return await handleVisitOrders(req,b,res,user,auth,{database,digest,validateAttachments});
    if (action === 'works') return res.json({
      ok: true,
      works: await database('obras?select=id,nombre,codigo,municipio,descripcion&order=nombre.asc&limit=1000', undefined, auth)
    });
    if (action === 'contacts') {
      const rows = await database(`visit_contacts?${query({
        select: 'id,revision,data',
        owner_id: `eq.${user.id}`,
        order: 'updated_at.desc',
        limit: '500'
      })}`, undefined, auth);
      return res.json({
        ok: true,
        contacts: rows.map((r: any) => ({
          ...r.data,
          id: r.id,
          revision: r.revision
        }))
      });
    }
    if (action === 'save-contact') {
      const contact = cleanContact(b.contact);
      for (const assignment of contact.assignments) {
        const work = await database(`obras?${query({
          select: 'id',
          id: `eq.${assignment.worksiteId}`,
          limit: '1'
        })}`, undefined, auth);
        if (!work.length) throw fail('No tienes acceso a una obra del contacto.', 403);
      }
      const existing = await database(`visit_contacts?${query({
        select: 'id,revision',
        id: `eq.${contact.id}`,
        owner_id: `eq.${user.id}`,
        limit: '1'
      })}`);
      if (existing.length && existing[0].revision !== contact.revision) throw fail('El contacto cambió. Recarga antes de guardar.', 409);
      const data = {
        owner_id: user.id,
        email: contact.email,
        active: contact.active,
        data: contact,
        revision: contact.revision + 1,
        updated_at: new Date().toISOString()
      };
      const result = existing.length ? await database(`visit_contacts?${query({
        id: `eq.${contact.id}`,
        owner_id: `eq.${user.id}`,
        revision: `eq.${contact.revision}`
      })}`, data, undefined, 'PATCH') : await database('visit_contacts', {
        ...data,
        id: contact.id
      });
      if (!result?.length) throw fail('El contacto cambió. Recarga antes de guardar.', 409);
      return res.json({
        ok: true,
        contact: {
          ...contact,
          revision: result[0].revision
        }
      });
    }
    if (action === 'list') {
      const limit = 30,
        offset = Math.max(0, Math.min(100000, Number(b.offset) || 0));
      const params: any = {
        select: 'id,owner_id,obra_id,number,revision,version,status,worksite,visit_date,updated_at',
        order: 'visit_date.desc,id.desc',
        limit: String(limit + 1),
        offset: String(offset)
      };
      if (b.worksiteId) {
        if (!uuidValid(b.worksiteId)) throw fail('Obra inválida.');
        params.obra_id = `eq.${b.worksiteId}`;
      }
      if (b.status) {
        if (!['draft', 'review', 'changes', 'rejected', 'signing', 'signed', 'cancelled'].includes(b.status)) throw fail('Estado inválido.');
        params.status = `eq.${b.status}`;
      }
      if (b.search) {
        const term = String(b.search).slice(0, 100).replace(/[^\p{L}\p{N}\s-]/gu, '').toLowerCase();
        if (term) params.search_text = `ilike.*${term}*`;
      }
      const records = await database('visit_minutes?' + query(params), undefined, auth);
      return res.json({
        ok: true,
        records: records.slice(0, limit),
        hasMore: records.length > limit
      });
    }
    if (action === 'create') {
      if (!uuidValid(b.id) || !uuidValid(b.operation) || !uuidValid(b.content?.worksiteId)) throw fail('Identificadores inválidos. Selecciona una obra registrada.');
      if (!await database('rpc/visit_minutes_can_create_work',{p_id:b.content.worksiteId},auth)) throw fail('Esta obra es de consulta. Necesitas permiso de modificación para crear un acta.',403);
      const [work] = await database('obras?' + query({
        select: 'id,nombre,codigo,municipio',
        id: `eq.${b.content?.worksiteId}`,
        limit: '1'
      }), undefined, auth);
      if (!work) throw fail('Selecciona una obra a la que tengas acceso.', 403);
      const content = await resolveOrderReferences(database,{
        ...b.content,
        worksite: work.nombre,
        code: work.codigo || b.content.code || '',
        municipality: work.municipio || b.content.municipality || ''
      });
      const state = newVisit(content, b.participants, new Date().toISOString());
      await validateAttachments(state);
      const result = await committed({
        id: b.id,
        owner_id: user.id,
        revision: 0
      } as VisitRecord, state, b.operation, digest(JSON.stringify({
        content: b.content,
        participants: b.participants
      })), user.id, 'create');
      return res.json({
        ok: true,
        record: {
          ...result,
          canWrite: true
        }
      });
    }
    const r = await ownerRecord(b.id, user.id, auth, !['get', 'history', 'pdf'].includes(action));
    if (action === 'get') {
      const jobs = await database(`visit_minutes_mail_jobs?${query({
        select: 'id,version,person_id,kind,status,attempts,message_id,error_code',
        record_id: `eq.${r.id}`,
        order: 'updated_at.desc',
        limit: '300'
      })}`);
      return res.json({
        ok: true,
        record: r,
        jobs
      });
    }
    if (action === 'history') {
      const [versions, events] = await Promise.all([database(`visit_minutes_versions?${query({
        select: 'version,archived_at',
        record_id: `eq.${r.id}`,
        order: 'version.desc'
      })}`), database(`visit_minutes_events?${query({
        select: 'id,version,actor,event,at,details',
        record_id: `eq.${r.id}`,
        order: 'id.desc',
        limit: '200',
        offset: String(Math.max(0, Number(b.offset) || 0))
      })}`)]);
      return res.json({
        ok: true,
        versions,
        events
      });
    }
    if (action === 'pdf') {
      let state = r.state;
      const version = Number(b.version) || r.version;
      if (version !== r.version) {
        const [v] = await database(`visit_minutes_versions?${query({
          select: 'state',
          record_id: `eq.${r.id}`,
          version: `eq.${version}`,
          limit: '1'
        })}`);
        if (!v) throw fail('Versión no disponible.', 404);
        state = v.state;
      }
      const [file] = await database(`visit_minutes_files?${query({
        select: 'base64,sha256',
        record_id: `eq.${r.id}`,
        version: `eq.${version}`,
        limit: '1'
      })}`);
      verifiedStoredPdf(file, state);
      const base64 = file?.base64 || Buffer.from(await generateVisitMinutesPdf(state, r.number)).toString('base64');
      return res.json({
        ok: true,
        base64,
        sha256: file?.sha256 || digest(Buffer.from(base64, 'base64')),
        filename: `${r.number}_v${version}${file ? '_FIRMADA' : '_BORRADOR'}.pdf`
      });
    }
    if (action === 'preview-mail') {
      if (!['review', 'signing', 'final'].includes(b.kind)) throw fail('Tipo de correo inválido.');
      const recipients = r.state.participants.filter(p => b.kind === 'final' ? p.receiveFinal : b.kind === 'review' ? p.reviewRequired : p.signing !== 'none');
      return res.json({
        ok: true,
        messages: recipients.map(p => ({
          personId: p.id,
          email: p.email,
          ...visitMail(r.state, r.number, b.kind, p, b.kind === 'final' ? '' : '[Enlace personal verificado generado al enviar]')
        }))
      });
    }
    if (action === 'send-job') {
      if (!uuidValid(b.jobId)) throw fail('Envío inválido.');
      const [job] = await database('visit_minutes_mail_jobs?' + query({
        select: '*',
        id: `eq.${b.jobId}`,
        record_id: `eq.${r.id}`,
        version: `eq.${r.version}`,
        limit: '1'
      }));
      if (!job) throw fail('Envío no disponible.', 404);
      const claimed = await database('rpc/visit_minutes_claim_mail', {
        p_id: job.id
      });
      if (!claimed) return res.json({
        ok: true,
        delivery: job.status,
        message: 'Envío ya tramitado, en curso o sin reintento automático.'
      });
      let googleConfirmed = false;
      try {
        const p = r.state.participants.find(p => p.id === job.person_id);
        if (!p?.email) throw fail('El destinatario no tiene correo.');
        let target = '';
        if (job.kind !== 'final') {
          const [a] = await database('visit_minutes_access?' + query({
            select: 'token_encrypted,expires_at,revoked',
            record_id: `eq.${r.id}`,
            version: `eq.${r.version}`,
            person_id: `eq.${p.id}`,
            limit: '1'
          }));
          if (!a || a.revoked || new Date(a.expires_at).getTime() <= Date.now()) throw fail('Renueva el enlace antes de enviar.');
          target = canonicalLink(decryptToken(a.token_encrypted));
        }
        const [file] = job.kind === 'final' ? await database('visit_minutes_files?' + query({
          select: 'base64,sha256',
          record_id: `eq.${r.id}`,
          version: `eq.${r.version}`,
          limit: '1'
        })) : [];
        if (job.kind === 'final' && (!file || r.status !== 'signed' || digest(Buffer.from(file.base64, 'base64')) !== file.sha256)) throw fail('No se pudo verificar el archivo final.');
        const result = await sendVisitMime(user.id, p.email, visitMail(r.state, r.number, job.kind, p, target), job.id, file ? {
          base64: file.base64,
          filename: `${r.number}_v${r.version}_FIRMADA.pdf`
        } : undefined);
        googleConfirmed = true;
        await database('rpc/visit_minutes_finish_mail',{p_id:job.id,p_status:'sent',p_message:result.messageId,p_code:null,p_actor:user.id});
        return res.json({
          ok: true,
          delivery: 'sent',
          ...result
        });
      } catch (error: any) {
        await database('rpc/visit_minutes_finish_mail',{p_id:job.id,p_status:error.uncertain||googleConfirmed?'uncertain':'failed',p_message:null,p_code:googleConfirmed?'MAIL_ACCEPTED_STATUS_UNCONFIRMED':error.code||'SEND_FAILED',p_actor:user.id});
        throw error;
      }
    }
    if (action === 'link') {
      const p = r.state.participants.find(p => p.id === b.personId);
      if (!p?.email || !p.reviewRequired || !['review', 'changes', 'rejected', 'signing'].includes(r.status)) throw fail('La persona necesita correo y una revisión abierta.');
      const token = freshToken();
      await database('visit_minutes_access?' + query({
        record_id: `eq.${r.id}`,
        version: `eq.${r.version}`,
        person_id: `eq.${p.id}`
      }), {
        revoked: true,
        session_hash: null
      }, undefined, 'PATCH');
      const existing = await database('visit_minutes_access?' + query({
        select: 'id',
        record_id: `eq.${r.id}`,
        version: `eq.${r.version}`,
        person_id: `eq.${p.id}`,
        limit: '1'
      }));
      const data = {
        token_hash: digest(token),
        token_encrypted: encryptToken(token),
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        revoked: false,
        otp_hash: null,
        session_hash: null,
        requests: 0,
        attempts: 0
      };
      if (existing.length) await database('visit_minutes_access?id=eq.' + existing[0].id, data, undefined, 'PATCH');else await database('visit_minutes_access', {
        ...data,
        id: randomUUID(),
        record_id: r.id,
        version: r.version,
        person_id: p.id
      });
      await database('visit_minutes_events', {
        record_id: r.id,
        version: r.version,
        actor: user.id,
        event: 'renew-access',
        details: {
          personId: p.id
        }
      });
      return res.json({
        ok: true,
        url: canonicalLink(token)
      });
    }
    if (action === 'revoke-link') {
      if (!r.state.participants.some(p => p.id === b.personId)) throw fail('Participante no válido.');
      await database('visit_minutes_access?' + query({
        record_id: `eq.${r.id}`,
        version: `eq.${r.version}`,
        person_id: `eq.${b.personId}`
      }), {
        revoked: true,
        session_hash: null
      }, undefined, 'PATCH');
      await database('visit_minutes_events', {
        record_id: r.id,
        version: r.version,
        actor: user.id,
        event: 'revoke-access',
        details: {
          personId: b.personId
        }
      });
      return res.json({
        ok: true
      });
    }
    if (action === 'command' || action === 'queue-final') {
      if (!uuidValid(b.operation)) throw fail('Operación inválida.');
      const hash = digest(JSON.stringify({
        command: b.command,
        kind: action
      }));
      if (await alreadyDone(r, b.operation, hash)) return res.json({
        ok: true,
        record: r
      });
      if (Number(b.revision) !== r.revision) throw fail('Otra operación cambió el acta. Actualiza antes de guardar.', 409);
      let state = r.state,
        extras: any = {};
      let event = 'queue-final';
      if (action === 'command') {
        const command = b.command as VisitCommand;
        if (['respond', 'sign'].includes(command.type)) {
          if (b.inPersonConfirmed !== true) throw fail('La persona debe confirmar su identidad y actuar presencialmente en este dispositivo.');
          (command as any).mode = 'in-person';
        }
        if (command.type === 'save') {
          if (command.content.worksiteId !== r.obra_id) throw fail('La obra del acta no puede cambiar.');
          command.content = await resolveOrderReferences(database,{
            ...command.content,
            worksite: r.state.content.worksite,
            code: r.state.content.code
          });
        }
        if (command.type === 'sign') await validateSignature(command.image);
        state = applyVisitCommand(r.state, command, new Date().toISOString());
        event = command.type;
        if (command.type === 'save') { await validateAttachments(state);await assertVisitOrders(database,state,r.id,true); }
        if(['review','finalize'].includes(command.type))await assertVisitOrders(database,state,r.id);
        if (command.type === 'review' || command.type === 'open-signing') extras = await linksAndJobs(r, state, command.type === 'review' ? 'review' : 'signing');
        if (command.type === 'finalize') {
          const bytes = await generateVisitMinutesPdf(state, r.number);
          extras.pdf = Buffer.from(bytes).toString('base64');
          extras.sha = digest(bytes);
          state.finalSha256 = extras.sha;
        }
        if (command.type === 'respond' || command.type === 'sign') extras.details={personId:command.personId,mode:'in-person'};
        if (command.type === 'followup') extras.details={agreementId:command.agreementId,done:command.done};
      } else {
        if (r.status !== 'signed') throw fail('El acta debe estar firmada.');
        extras = await linksAndJobs(r, state, 'final');
      }
      const result = await committed(r, state, b.operation, hash, user.id, event, extras);
      return res.json({
        ok: true,
        record: {
          ...result,
          canWrite: true
        }
      });
    }
    throw fail('Operación no reconocida.');
  } catch (error: any) {
    // Never echo PostgREST/Gmail response bodies, signatures, tokens or documents.
    const status = Number(error?.status) || 400;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      message: error?.message?.length < 400 ? error.message : 'No se pudo completar la operación del acta.',
      code: error?.code || 'VISIT_OPERATION_FAILED'
    });
  }
}
