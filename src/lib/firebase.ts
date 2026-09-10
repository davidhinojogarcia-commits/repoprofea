import { supabase, type SupabaseUser } from './supabase';
import { Person, DeletedPerson, PdfCustomConfig, UserAccount } from '../../types';

export const auth = {
  currentUser: null as SupabaseUser | null,
};

export const initAuth = (onAuthSuccess?: (user: SupabaseUser, token: string | null) => void, onAuthFailure?: () => void) => {
  const sub = supabase.auth.onAuthStateChange(async user => {
    auth.currentUser = user;
    if (user) {
      const session = (await supabase.auth.getSession()).data.session;
      onAuthSuccess?.(user, session?.access_token || null);
    } else onAuthFailure?.();
  });
  return () => sub.data.subscription.unsubscribe();
};

export const getAccessToken = async (): Promise<string | null> => (await supabase.auth.getSession()).data.session?.access_token || null;
export async function googleSignIn(): Promise<{ accessToken: string }> { throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.'); }
export async function logoutGoogle(): Promise<void> { await supabase.auth.signOut(); auth.currentUser = null; }

export enum OperationType { CREATE='create', UPDATE='update', DELETE='delete', LIST='list', GET='get', WRITE='write' }
export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'documentos' || value === undefined) continue;
    if (value instanceof Date) clean[key] = value.toISOString();
    else if (Array.isArray(value)) clean[key] = value.filter(v => v !== undefined).map(v => v && typeof v === 'object' && !(v instanceof Date) ? sanitizeForFirestore(v) : v);
    else if (value && typeof value === 'object') clean[key] = sanitizeForFirestore(value as any);
    else clean[key] = value;
  }
  return clean;
}
export function canonicalizeEmailKey(email: unknown): string { return typeof email === 'string' ? email.trim().toLowerCase().replace(/[^a-z0-9]/g,'_') || 'unknown' : 'unknown'; }
export function isQuotaExceeded(): boolean { return false; }
export async function markQuotaExceeded(): Promise<void> {}
export interface WorkspaceMember { email: string; role: 'editor'|'viewer'; addedAt: string; name?: string; }
export interface Workspace { id:string; name:string; ownerEmail:string; ownerUid:string; ownerName:string; ownerPhoto?:string; sharedWith:WorkspaceMember[]; sharedWithEmails:string[]; accessCode:string; createdAt:string; lastSyncAt:string; }
export interface DeviceSession { id:string; deviceName:string; userEmail:string; lastActive:string; }
export interface UserAccountSettings { savedObras?:string[]; savedLugares?:string[]; savedSitios?:string[]; savedTelefonos?:string[]; savedCategorias?:string[]; workStartHour?:string; workEndHour?:string; pdfCustomConfig?:PdfCustomConfig; subcontratas?:any[]; lastUpdated?:string; }
export const DEFAULT_WORKSPACE_ID = 'supabase';

function uid() { if (!auth.currentUser?.id) throw new Error('Usuario no autenticado'); return auth.currentUser.id; }
function workerRow(p: Person, ownerId: string, created = false) { const now = new Date().toISOString(); return { owner_id: ownerId, id: Number(p.id), data: sanitizeForFirestore(p), created_by: ownerId, created_at: now, updated_by: ownerId, updated_at: now }; }

export async function createFirestoreWorker(_uid: string, person: Person) { const ownerId = _uid || uid(); await supabase.query('workers', { method:'POST', prefer:'return=minimal', body:workerRow(person, ownerId) }); }
export async function updateFirestoreWorker(_uid: string, personId: number, person: Partial<Person>) { const ownerId = _uid || uid(); await supabase.query('workers', { method:'PATCH', prefer:'return=minimal', query:`owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(personId)}`, body:{ data:sanitizeForFirestore(person), updated_by:ownerId, updated_at:new Date().toISOString() } }); }
export async function deleteFirestoreWorker(_uid: string, personId: number, deletedRecord?: DeletedPerson) { const ownerId = _uid || uid(); if (deletedRecord) await syncDeletedWorkerToAccount(ownerId, deletedRecord); await supabase.query('workers', { method:'DELETE', prefer:'return=minimal', query:`owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(personId)}` }); }
export async function restoreFirestoreWorker(_uid: string, person: Person) { const ownerId = _uid || uid(); await createFirestoreWorker(ownerId, person); await deleteFromAccountTrash(ownerId, person.id); }
export async function permanentDeleteFirestoreWorker(_uid: string, personId: number) { const ownerId = _uid || uid(); await deleteFromAccountTrash(ownerId, personId); }

function mapWorker(row:any): Person { return { ...(row.data || {}), id:Number(row.id), ownerId:row.owner_id, createdBy:row.created_by, createdAt:row.created_at, updatedBy:row.updated_by, updatedAt:row.updated_at } as Person; }
function mapTrash(row:any): DeletedPerson { return { ...(row.data || {}), id:Number(row.id), fechaEliminacion:(row.data?.fechaEliminacion || row.updated_at || row.created_at) } as DeletedPerson; }

export async function fetchFirestoreWorkers(_uid: string): Promise<Person[]> { const rows = await supabase.query('workers', { query:'select=owner_id,id,data,created_by,created_at,updated_by,updated_at&order=updated_at.desc' }); return (rows || []).map(mapWorker); }
export async function fetchAccountTrash(_uid: string): Promise<DeletedPerson[]> { const rows = await supabase.query('trash', { query:'select=owner_id,id,data,created_at,updated_at&order=updated_at.desc' }); return (rows || []).map(mapTrash); }
export async function syncDeletedWorkerToAccount(_uid: string, deletedPerson: DeletedPerson) { const ownerId = _uid || uid(); await supabase.query('trash', { method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:{ owner_id:ownerId, id:Number(deletedPerson.id), data:sanitizeForFirestore(deletedPerson), created_by:ownerId, created_at:new Date().toISOString(), updated_by:ownerId, updated_at:new Date().toISOString() } }); }
export async function deleteFromAccountTrash(_uid:string, personId:number) { const ownerId=_uid||uid(); await supabase.query('trash',{method:'DELETE',prefer:'return=minimal',query:`owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(personId)}`}); }
export async function fetchUserAccountSettings(_uid:string):Promise<UserAccountSettings>{ const ownerId=_uid||uid(); const rows=await supabase.query('user_settings',{query:`select=settings&user_id=eq.${encodeURIComponent(ownerId)}&limit=1`}); return rows?.[0]?.settings || {}; }
export async function saveUserAccountSettings(_uid:string, settings:UserAccountSettings){ const ownerId=_uid||uid(); await supabase.query('user_settings',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{user_id:ownerId,settings:sanitizeForFirestore(settings),updated_by:ownerId,updated_at:new Date().toISOString()}}); }
export async function fetchAccountData(_uid?:string){ const id=_uid||uid(); return {workers:await fetchFirestoreWorkers(id),trash:await fetchAccountTrash(id),settings:await fetchUserAccountSettings(id)}; }

function poll<T>(load:()=>Promise<T>, cb:(v:T)=>void, interval=3000):()=>void { let active=true; const run=async()=>{try{cb(await load())}catch{}}; run(); const timer=window.setInterval(()=>{if(active)run()},interval); return ()=>{active=false;window.clearInterval(timer)}; }
export function subscribeToFirestoreWorkers(_uid:string, cb:(workers:Person[])=>void){return poll(()=>fetchFirestoreWorkers(_uid||uid()),cb);}
export function subscribeToAccountWorkers(_uid:string,cb:(workers:Person[])=>void){return subscribeToFirestoreWorkers(_uid,cb);}
export function subscribeToAccountTrash(_uid:string,cb:(trash:DeletedPerson[])=>void){return poll(()=>fetchAccountTrash(_uid||uid()),cb);}
export async function syncAccountSettings(_uid:string,settings:UserAccountSettings){return saveUserAccountSettings(_uid,settings);}
export function subscribeToAccountSettings(_uid:string,cb:(settings:UserAccountSettings)=>void){return poll(()=>fetchUserAccountSettings(_uid||uid()),cb);}
export async function registerAccountSession(..._args:any[]){ }
export async function unregisterAccountSession(..._args:any[]){ }
export function subscribeToAccountSessions(..._args:any[]){return ()=>{};}
export async function getOrCreateUserAccount(user:{uid:string;email:string;displayName?:string|null}):Promise<UserAccount>{return {id:user.uid,username:user.email,email:user.email,password:undefined,displayName:user.displayName||user.email,role:'user',createdAt:new Date().toISOString(),lastLoginAt:new Date().toISOString()} as UserAccount;}
export async function getUserAccountByEmail(email:string){const u=auth.currentUser;return u&&u.email?.toLowerCase()===email.trim().toLowerCase()?getOrCreateUserAccount({uid:u.id,email:u.email||email}):null;}
export async function fetchSharedAccountsForEmail(email:string){const a=await getUserAccountByEmail(email);return a?[a]:[];}
export async function syncWorkerToAccount(_accountId:string,p:Person){return createFirestoreWorker(uid(),p);}
export async function deleteWorkerFromAccount(_accountId:string,id:number,d?:DeletedPerson){return deleteFirestoreWorker(uid(),id,d);}
export async function getOrCreateUserWorkspace(user:any):Promise<Workspace>{return {id:user.uid,name:user.displayName||user.email,ownerEmail:user.email,ownerUid:user.uid,ownerName:user.displayName||user.email,sharedWith:[],sharedWithEmails:[user.email],accessCode:'',createdAt:new Date().toISOString(),lastSyncAt:new Date().toISOString()};}
export async function getWorkspaceByIdOrEmail(_id:string){return auth.currentUser?getOrCreateUserWorkspace({uid:auth.currentUser.id,email:auth.currentUser.email||''}):null;}
export async function fetchSharedWorkspacesForEmail(_email:string){const w=await getWorkspaceByIdOrEmail('');return w?[w]:[];}
export async function findWorkspaceByAccessCode(_code:string){return getWorkspaceByIdOrEmail('');}
export async function addMemberToWorkspace(..._args:any[]){throw new Error('La compartición se gestiona desde Administración > Permisos.');}
export async function updateMemberRoleInWorkspace(..._args:any[]){throw new Error('La compartición se gestiona desde Administración > Permisos.');}
export async function removeMemberFromWorkspace(..._args:any[]){throw new Error('La compartición se gestiona desde Administración > Permisos.');}
export function subscribeToWorkspaceMeta(..._args:any[]){return ()=>{};}
export async function syncWorkerToWorkspace(_workspaceId:string,p:Person){return createFirestoreWorker(uid(),p);}
export async function deleteWorkerFromWorkspace(_workspaceId:string,id:number,d?:DeletedPerson){return deleteFirestoreWorker(uid(),id,d);}
export async function syncDeletedWorkerToWorkspace(_workspaceId:string,d:DeletedPerson){return syncDeletedWorkerToAccount(uid(),d);}
export async function deleteFromWorkspaceTrash(_workspaceId:string,id:number){return deleteFromAccountTrash(uid(),id);}
export async function fetchWorkspaceData(_workspaceId:string){return fetchAccountData();}
export function subscribeToWorkspaceWorkers(_args?:any,...rest:any[]){return subscribeToAccountWorkers(uid(),rest[0]||(()=>{}));}
export function subscribeToWorkspaceTrash(_args?:any,...rest:any[]){return subscribeToAccountTrash(uid(),rest[0]||(()=>{}));}
export function subscribeToWorkspaceSettings(_args?:any,...rest:any[]){return subscribeToAccountSettings(uid(),rest[0]||(()=>{}));}
export async function syncWorkspaceSettings(...args:any[]){return saveUserAccountSettings(uid(),args[1]||{});}
export async function registerWorkspaceSession(..._args:any[]){ }
export async function unregisterWorkspaceSession(..._args:any[]){ }
export function subscribeToWorkspaceSessions(..._args:any[]){return ()=>{};}
export async function getOrCreateSyncGroup(..._args:any[]){return {id:uid(),ownerUid:uid()};}
export async function syncWorkerToCloud(_groupId:string,p:Person){return createFirestoreWorker(uid(),p);}
export async function deleteWorkerFromCloud(_groupId:string,id:number,d?:DeletedPerson){return deleteFirestoreWorker(uid(),id,d);}
export async function syncDeletedWorkerToCloud(_groupId:string,d:DeletedPerson){return syncDeletedWorkerToAccount(uid(),d);}
export async function deleteFromCloudTrash(_groupId:string,id:number){return deleteFromAccountTrash(uid(),id);}
export async function fetchGroupData(..._args:any[]){return fetchAccountData();}
export function subscribeToWorkers(...args:any[]){return subscribeToAccountWorkers(uid(),args[1]||(()=>{}));}
export function subscribeToTrash(...args:any[]){return subscribeToAccountTrash(uid(),args[1]||(()=>{}));}
export async function registerSession(..._args:any[]){ }
export async function unregisterSession(..._args:any[]){ }
export function subscribeToSessions(..._args:any[]){return ()=>{};}
export async function checkGroupExists(..._args:any[]){return true;}
