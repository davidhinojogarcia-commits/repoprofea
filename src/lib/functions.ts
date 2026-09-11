import { supabase } from './supabase';

type CallResult<T>={data:T};
async function call<T>(action:string,payload:any={}):Promise<CallResult<T>>{return {data:await supabase.edgeFunction('admin-users',{action,...payload})};}

// Compatibilidad con llamadas antiguas: ya no crea ni presume un primer administrador.
// El rol procede exclusivamente del perfil activo almacenado en Supabase.
export const bootstrapFirstAdmin=async()=>{
  const user=(await supabase.auth.getUser()).data.user;
  if(!user)return {data:{ok:false,role:null as 'admin'|'user'|null}};
  const rows=await supabase.query('profiles',{query:`select=role,active&id=eq.${encodeURIComponent(user.id)}&limit=1`});
  const profile=rows?.[0];
  const role=profile?.active===true&&(profile.role==='admin'||profile.role==='user')?profile.role:null;
  return {data:{ok:role!==null,role}};
};
export const touchLogin=async()=>({data:{ok:true,email:(await supabase.auth.getUser()).data.user?.email||''}});
export const createManagedUser=(payload:any)=>call<{uid:string;email:string;role:'admin'|'user'}>('create',payload);
export const updateManagedUserProfile=(payload:any)=>call<{ok:boolean}>('update_profile',payload);
export const updateManagedUserRole=async(payload:any)=>{
  const result=await call<{ok:boolean;selfRoleChange?:boolean;role?:'admin'|'user'}>('role',payload);
  if(result.data?.selfRoleChange===true&&result.data?.role!=='admin'){
    await supabase.auth.signOut({scope:'local'});
    // Esta SPA no expone una ruta física /login en Vercel. Volvemos a la raíz y
    // AuthGate renderiza la pantalla de acceso al detectar que ya no hay sesión.
    if(typeof window!=='undefined')window.location.replace('/');
  }
  return result;
};
export const setManagedUserRole=updateManagedUserRole;
export const updateManagedUserStatus=(payload:any)=>call<{ok:boolean}>('status',payload);
export const setManagedUserActive=updateManagedUserStatus;
export const deleteManagedUser=(payload:any)=>call<{ok:boolean}>('delete',payload);
export const updateManagedUserPermissions=(payload:any)=>call<{ok:boolean}>('permissions',payload);
export const updateManagedPermissions=updateManagedUserPermissions;
export const resetManagedUserPassword=(payload:any)=>call<{ok:boolean;email:string}>('reset_password',payload);
export const sendManagedPasswordReset=resetManagedUserPassword;
export const setDataPermission=async(payload:any)=>{await supabase.query('data_permissions',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{resource_type:payload.resourceType,resource_id:String(payload.resourceId),owner_id:payload.ownerId,user_id:payload.userId,can_read:payload.canRead,can_update:payload.canUpdate,can_delete:payload.canDelete}});return {data:{ok:true,permissionId:`${payload.resourceType}_${payload.resourceId}_${payload.userId}`}};};
export const deleteDataPermission=async(payload:any)=>{await supabase.query('data_permissions',{method:'DELETE',prefer:'return=minimal',query:`resource_type=eq.${encodeURIComponent(payload.resourceType)}&resource_id=eq.${encodeURIComponent(String(payload.resourceId))}&user_id=eq.${encodeURIComponent(payload.userId)}`});return {data:{ok:true}};};
export const writeAuditEvent=async(payload:any)=>{const user=(await supabase.auth.getUser()).data.user;if(user)await supabase.query('audit_logs',{method:'POST',prefer:'return=minimal',body:{user_id:user.id,user_email:user.email||'',action:payload.action,resource_type:payload.resourceType||'',resource_id:payload.resourceId||'',details:payload.details||{}}});return {data:{ok:true}};};
