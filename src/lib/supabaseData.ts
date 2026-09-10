import { supabase, type SupabaseUser } from './supabase';
import { Person, DeletedPerson, PdfCustomConfig, UserAccount } from '../../types';

// Adaptador de datos Supabase para trabajadores, papelera y ajustes.
export const auth = { currentUser: null as SupabaseUser | null };

export const initAuth = (
  onAuthSuccess?: (user: SupabaseUser, token: string | null) => void,
  onAuthFailure?: () => void,
) => {
  const sub = supabase.auth.onAuthStateChange(async user => {
    auth.currentUser = user;
    if (user) {
      const session = (await supabase.auth.getSession()).data.session;
      onAuthSuccess?.(user, session?.access_token || null);
    } else {
      onAuthFailure?.();
    }
  });
  return () => sub.data.subscription.unsubscribe();
};

export const getAccessToken = async () =>
  (await supabase.auth.getSession()).data.session?.access_token || null;

export async function googleSignIn(): Promise<{ accessToken: string }> {
  throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.');
}
export async function logoutGoogle() {
  await supabase.auth.signOut();
  auth.currentUser = null;
}

export enum OperationType {
  CREATE = 'create', UPDATE = 'update', DELETE = 'delete', LIST = 'list', GET = 'get', WRITE = 'write',
}

export function sanitizeForDatabase<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'documentos' || value === undefined) continue;
    if (value instanceof Date) clean[key] = value.toISOString();
    else if (Array.isArray(value)) clean[key] = value.filter(v => v !== undefined).map(v => v && typeof v === 'object' && !(v instanceof Date) ? sanitizeForDatabase(v) : v);
    else if (value && typeof value === 'object') clean[key] = sanitizeForDatabase(value as any);
    else clean[key] = value;
  }
  return clean;
}

export function canonicalizeEmailKey(email: unknown) {
  return typeof email === 'string' ? email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'unknown' : 'unknown';
}
export function isQuotaExceeded() { return false; }
export async function markQuotaExceeded() {}

export interface WorkspaceMember { email: string; role: 'editor' | 'viewer'; addedAt: string; name?: string; }
export interface Workspace { id: string; name: string; ownerEmail: string; ownerUid: string; ownerName: string; ownerPhoto?: string; sharedWith: WorkspaceMember[]; sharedWithEmails: string[]; accessCode: string; createdAt: string; lastSyncAt: string; }
export interface DeviceSession { id: string; deviceName: string; userEmail: string; lastActive: string; }
export interface UserAccountSettings { savedObras?: string[]; savedLugares?: string[]; savedSitios?: string[]; savedTelefonos?: string[]; savedCategorias?: string[]; workStartHour?: string; workEndHour?: string; pdfCustomConfig?: PdfCustomConfig; subcontratas?: any[]; lastUpdated?: string; }
export const DEFAULT_WORKSPACE_ID = 'supabase';

function uid() {
  if (!auth.currentUser?.uid) throw new Error('Usuario no autenticado');
  return auth.currentUser.uid;
}

function workerFields(p: Partial<Person>) {
  return {
    obra_id: (p as any).obraId || (p as any).obra_id || null,
    supervisor_responsable: p.supervisorResponsable || '', num_oferta: p.numOferta || '', obra: p.obra || '',
    categoria: p.categoria || '', quincena: p.quincena || '', apellidos_nombre: p.apellidosNombre || '', dni: p.dni || '',
    fecha_nacimiento: p.fechaNacimiento || '', periodo_inicio: p.periodoInicio || '', periodo_fin: p.periodoFin || '',
    telefono: p.telefono || '', calzado: p.calzado || '', formacion: p.formacion || '', lugar_formacion: p.lugarFormacion || null,
    cita_dia: p.citaDia || '', cita_hora: p.citaHora || '', sitio_reconocimiento: p.sitioReconocimiento || '',
    documentacion_completa: p.documentacionCompleta || '', observaciones: p.observaciones || null, fecha_registro: p.fechaRegistro || '',
    necesita_reconocimiento: p.necesitaReconocimiento || null, aptitud_medica: p.aptitudMedica || null,
    limitaciones_aptitud: p.limitacionesAptitud || null, reconocimiento_estado: p.reconocimientoEstado || null,
    reconocimiento_fecha: p.reconocimientoFecha || null, reconocimiento_validez: p.reconocimientoValidez || null,
    reconocimiento_limitaciones: p.reconocimientoLimitaciones || null, reconocimiento_observaciones: p.reconocimientoObservaciones || null,
  };
}

function workerRow(p: Person, ownerId: string) {
  const now = new Date().toISOString();
  return {
    owner_id: ownerId, id: Number(p.id), ...workerFields(p), data: sanitizeForDatabase(p),
    created_by: ownerId, created_at: p.fechaRegistro || now, updated_by: ownerId, updated_at: now,
  };
}

async function verifyWorkerPersisted(ownerId: string, personId: number) {
  const rows = await supabase.query('trabajadores', {
    query: `select=owner_id,id&owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(personId)}&limit=1`,
  });
  if (!rows?.[0]) throw new Error(`Supabase no confirmó la persistencia del trabajador ${personId}.`);
}

// El propietario siempre se deriva de la sesión autenticada. Los parámetros _uid se conservan
// solo para no romper firmas históricas mientras se eliminan esos imports del frontend.
export async function createWorkerRecord(_uid: string, person: Person) {
  const ownerId = uid();
  const personId = Number(person.id);
  if (!Number.isFinite(personId)) throw new Error('ID de trabajador inválido');
  await supabase.query('trabajadores', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: workerRow(person, ownerId),
  });
  await verifyWorkerPersisted(ownerId, personId);
}
export async function updateWorkerRecord(_uid: string, personId: number, person: Partial<Person>) {
  const ownerId = uid();
  const currentRows = await supabase.query('trabajadores', {
    query: `select=data&owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(personId)}&limit=1`,
  });
  if (!currentRows?.[0]) throw new Error('El trabajador no existe o no tienes permiso para modificarlo.');
  const merged = { ...(currentRows[0].data || {}), ...sanitizeForDatabase(person as any), id: personId };
  await supabase.query('trabajadores', { method: 'PATCH', prefer: 'return=representation', query: `owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(personId)}`, body: { ...workerFields(merged), data: merged, updated_by: ownerId, updated_at: new Date().toISOString() } });
  await verifyWorkerPersisted(ownerId, personId);
}
export async function deleteWorkerRecord(_uid: string, personId: number, deletedRecord?: DeletedPerson) {
  const ownerId = uid();
  if (deletedRecord) await syncDeletedWorkerToAccount(ownerId, deletedRecord);
  await supabase.query('trabajadores', { method: 'DELETE', prefer: 'return=minimal', query: `owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(personId)}` });
}
export async function restoreWorkerRecord(_uid: string, person: Person) {
  await createWorkerRecord(uid(), person);
  await deleteFromAccountTrash(uid(), person.id);
}
export async function permanentDeleteWorkerRecord(_uid: string, personId: number) {
  await deleteFromAccountTrash(uid(), personId);
}

function mapWorker(row: any): Person {
  return { ...(row.data || {}), id: Number(row.id), ownerId: row.owner_id, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at } as Person;
}
function mapTrash(row: any): DeletedPerson {
  const raw = row.data || {};
  const person = raw.person || raw;
  return {
    person: { ...person, id: Number(row.id) } as Person,
    fechaEliminacion: raw.fechaEliminacion || row.updated_at || row.created_at,
  };
}

export async function fetchWorkerRecords(_uid: string) {
  const rows = await supabase.query('trabajadores', { query: 'select=owner_id,id,data,created_by,created_at,updated_by,updated_at&order=updated_at.desc' });
  return (rows || []).map(mapWorker);
}
export async function fetchAccountTrash(_uid: string) {
  const rows = await supabase.query('trash', { query: 'select=owner_id,id,data,created_at,updated_at&order=updated_at.desc' });
  return (rows || []).map(mapTrash);
}
export async function syncDeletedWorkerToAccount(_uid: string, d: DeletedPerson) {
  const ownerId = uid();
  const personId = Number(d.person?.id);
  if (!Number.isFinite(personId)) throw new Error('ID de trabajador inválido para papelera');
  await supabase.query('trash', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { owner_id: ownerId, id: personId, data: sanitizeForDatabase(d), created_by: ownerId, created_at: new Date().toISOString(), updated_by: ownerId, updated_at: new Date().toISOString() } });
}
export async function deleteFromAccountTrash(_uid: string, id: number) {
  const ownerId = uid();
  await supabase.query('trash', { method: 'DELETE', prefer: 'return=minimal', query: `owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(id)}` });
}

export async function fetchUserAccountSettings(_uid: string) {
  const ownerId = uid();
  const rows = await supabase.query('user_settings', { query: `select=settings&user_id=eq.${encodeURIComponent(ownerId)}&limit=1` });
  return rows?.[0]?.settings || {};
}
export async function saveUserAccountSettings(_uid: string, settings: UserAccountSettings) {
  const ownerId = uid();
  await supabase.query('user_settings', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { user_id: ownerId, settings: sanitizeForDatabase(settings), updated_by: ownerId, updated_at: new Date().toISOString() } });
}
export async function fetchAccountData(_uid?: string) {
  return { workers: await fetchWorkerRecords(uid()), trash: await fetchAccountTrash(uid()), settings: await fetchUserAccountSettings(uid()) };
}

function poll<T>(load: () => Promise<T>, cb: (v: T) => void, onError?: (e: Error) => void, interval = 3000) {
  let active = true;
  const run = async () => {
    try { if (active) cb(await load()); }
    catch (e) { onError?.(e instanceof Error ? e : new Error(String(e))); }
  };
  run();
  const timer = window.setInterval(() => { if (active) run(); }, interval);
  return () => { active = false; window.clearInterval(timer); };
}

export function subscribeToWorkerRecords(_uid: string, cb: (workers: Person[]) => void, onError?: (e: Error) => void) { return poll(() => fetchWorkerRecords(uid()), cb, onError); }
export function subscribeToAccountWorkers(_uid: string, cb: (workers: Person[]) => void, onError?: (e: Error) => void) { return subscribeToWorkerRecords(uid(), cb, onError); }
export function subscribeToAccountTrash(_uid: string, cb: (trash: DeletedPerson[]) => void, onError?: (e: Error) => void) { return poll(() => fetchAccountTrash(uid()), cb, onError); }
export async function syncAccountSettings(_uid: string, s: UserAccountSettings) { return saveUserAccountSettings(uid(), s); }
export function subscribeToAccountSettings(_uid: string, cb: (s: UserAccountSettings) => void, onError?: (e: Error) => void) { return poll(() => fetchUserAccountSettings(uid()), cb, onError); }

export async function registerAccountSession(..._args: any[]) {}
export async function unregisterAccountSession(..._args: any[]) {}
export function subscribeToAccountSessions(..._args: any[]) { return () => {}; }

export async function getOrCreateUserAccount(user: { uid: string; email: string; displayName?: string | null }): Promise<UserAccount> {
  return { id: user.uid, username: user.email, email: user.email, displayName: user.displayName || user.email, role: 'user', createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() } as UserAccount;
}
export async function getUserAccountByEmail(email: string) {
  const u = auth.currentUser;
  return u && u.email?.toLowerCase() === email.trim().toLowerCase() ? getOrCreateUserAccount({ uid: u.uid, email: u.email || email }) : null;
}
export async function fetchSharedAccountsForEmail(email: string) { const a = await getUserAccountByEmail(email); return a ? [a] : []; }
export async function syncWorkerToAccount(_accountId: string, p: Person) { return createWorkerRecord(uid(), p); }
export async function deleteWorkerFromAccount(_accountId: string, id: number, d?: DeletedPerson) { return deleteWorkerRecord(uid(), id, d); }

export async function getOrCreateUserWorkspace(user: any): Promise<Workspace> {
  return { id: user.uid, name: user.displayName || user.email, ownerEmail: user.email, ownerUid: user.uid, ownerName: user.displayName || user.email, sharedWith: [], sharedWithEmails: [user.email], accessCode: '', createdAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() };
}
export async function getWorkspaceByIdOrEmail(_id: string) { return auth.currentUser ? getOrCreateUserWorkspace({ uid: auth.currentUser.uid, email: auth.currentUser.email || '' }) : null; }
export async function fetchSharedWorkspacesForEmail(_email: string) { const w = await getWorkspaceByIdOrEmail(''); return w ? [w] : []; }
export async function findWorkspaceByAccessCode(_code: string) { return getWorkspaceByIdOrEmail(''); }
export async function addMemberToWorkspace(..._args: any[]) { throw new Error('La compartición se gestiona desde Administración > Permisos.'); }
export async function updateMemberRoleInWorkspace(..._args: any[]) { throw new Error('La compartición se gestiona desde Administración > Permisos.'); }
export async function removeMemberFromWorkspace(..._args: any[]) { throw new Error('La compartición se gestiona desde Administración > Permisos.'); }
export function subscribeToWorkspaceMeta(..._args: any[]) { return () => {}; }

export async function syncWorkerToWorkspace(_workspaceId: string, p: Person) { return createWorkerRecord(uid(), p); }
export async function deleteWorkerFromWorkspace(_workspaceId: string, id: number, d?: DeletedPerson) { return deleteWorkerRecord(uid(), id, d); }
export async function syncDeletedWorkerToWorkspace(_workspaceId: string, d: DeletedPerson) { return syncDeletedWorkerToAccount(uid(), d); }
export async function deleteFromWorkspaceTrash(_workspaceId: string, id: number) { return deleteFromAccountTrash(uid(), id); }
export async function fetchWorkspaceData(_workspaceId: string) { return fetchAccountData(); }
export function subscribeToWorkspaceWorkers(_workspaceId: any, cb: any, onError?: any) { return subscribeToAccountWorkers(uid(), cb, onError); }
export function subscribeToWorkspaceTrash(_workspaceId: any, cb: any, onError?: any) { return subscribeToAccountTrash(uid(), cb, onError); }
export function subscribeToWorkspaceSettings(_workspaceId: any, cb: any, onError?: any) { return subscribeToAccountSettings(uid(), cb, onError); }
export async function syncWorkspaceSettings(...args: any[]) { return saveUserAccountSettings(uid(), args[1] || {}); }
export async function registerWorkspaceSession(..._args: any[]) {}
export async function unregisterWorkspaceSession(..._args: any[]) {}
export function subscribeToWorkspaceSessions(..._args: any[]) { return () => {}; }

export async function getOrCreateSyncGroup(..._args: any[]) { return { id: uid(), ownerUid: uid() }; }
export async function syncWorkerToCloud(_groupId: string, p: Person) { return createWorkerRecord(uid(), p); }
export async function deleteWorkerFromCloud(_groupId: string, id: number, d?: DeletedPerson) { return deleteWorkerRecord(uid(), id, d); }
export async function syncDeletedWorkerToCloud(_groupId: string, d: DeletedPerson) { return syncDeletedWorkerToAccount(uid(), d); }
export async function deleteFromCloudTrash(_groupId: string, id: number) { return deleteFromAccountTrash(uid(), id); }
export async function fetchGroupData(..._args: any[]) { return fetchAccountData(); }
export function subscribeToWorkers(...args: any[]) { return subscribeToAccountWorkers(uid(), args[1] || (() => {})); }
export function subscribeToTrash(...args: any[]) { return subscribeToAccountTrash(uid(), args[1] || (() => {})); }
export async function registerSession(..._args: any[]) {}
export async function unregisterSession(..._args: any[]) {}
export function subscribeToSessions(..._args: any[]) { return () => {}; }
export async function checkGroupExists(..._args: any[]) { return true; }
