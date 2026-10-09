import { getSessionUser, supabase } from './supabase';

type CallResult<T>={data:T};
async function call<T>(action:string,payload:any={}):Promise<CallResult<T>>{return {data:await supabase.edgeFunction('admin-users',{action,...payload})};}

// Compatibilidad con llamadas antiguas: ya no crea ni presume un primer administrador.
// El rol procede exclusivamente del perfil activo almacenado en Supabase.
export const bootstrapFirstAdmin=async()=>{
  const user=(await getSessionUser());
  if(!user)return {data:{ok:false,role:null as 'admin'|'user'|null}};
  const rows=await supabase.query('profiles',{query:`select=role,active&id=eq.${encodeURIComponent(user.id)}&limit=1`});
  const profile=rows?.[0];
  const role=profile?.active===true&&(profile.role==='admin'||profile.role==='user')?profile.role:null;
  return {data:{ok:role!==null,role}};
};
export const touchLogin=async()=>({data:{ok:true,email:(await getSessionUser())?.email||''}});
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

export const setDataPermission=async(payload:any)=>{
  await supabase.query('data_permissions',{
    method:'POST',
    prefer:'resolution=merge-duplicates,return=minimal',
    query:'on_conflict=resource_type,resource_id,user_id',
    body:{
      resource_type:payload.resourceType,
      resource_id:String(payload.resourceId),
      owner_id:payload.ownerId,
      user_id:payload.userId,
      can_read:payload.canRead,
      can_update:payload.canUpdate,
      can_delete:payload.canDelete,
    }
  });
  return {data:{ok:true,permissionId:`${payload.resourceType}_${payload.resourceId}_${payload.userId}`}};
};

export const deleteDataPermission=async(payload:any)=>{
  await supabase.query('data_permissions',{
    method:'DELETE',
    prefer:'return=minimal',
    query:`resource_type=eq.${encodeURIComponent(payload.resourceType)}&resource_id=eq.${encodeURIComponent(String(payload.resourceId))}&user_id=eq.${encodeURIComponent(payload.userId)}`
  });
  return {data:{ok:true}};
};

export const listShareableUsers=async()=>{
  const rows=await supabase.rpc('list_shareable_profiles');
  return Array.isArray(rows)?rows:[];
};
export const listShareableProfiles=listShareableUsers;

export const getRecordShares=async(resourceType:string,resourceId:string|number)=>{
  if(resourceType==='trabajadores'){
    const workerId=Number(resourceId);
    if(!Number.isFinite(workerId))throw new Error('Identificador de trabajador no válido.');
    const rows=await supabase.rpc('get_worker_shares',{p_worker_id:workerId});
    return Array.isArray(rows)?rows:[];
  }
  const rows=await supabase.query('data_permissions',{
    query:`select=id,user_id,can_read,can_update,can_delete,created_at&resource_type=eq.${encodeURIComponent(resourceType)}&resource_id=eq.${encodeURIComponent(String(resourceId))}&order=created_at.asc`
  });
  return rows||[];
};

type ShareAccess='read'|'read_write';
export const shareRecordWithUser=async(payload:{resourceType:string;resourceId:string|number;ownerId:string;userId:string;access:ShareAccess})=>{
  if(payload.resourceType==='trabajadores'){
    const workerId=Number(payload.resourceId);
    if(!Number.isFinite(workerId))throw new Error('Identificador de trabajador no válido.');
    await supabase.rpc('set_worker_share',{
      p_worker_id:workerId,
      p_user_id:payload.userId,
      p_can_update:payload.access==='read_write'
    });
    return {data:{ok:true}};
  }
  return setDataPermission({...payload,canRead:true,canUpdate:payload.access==='read_write',canDelete:false});
};

export const unshareRecordWithUser=async(payload:{resourceType:string;resourceId:string|number;userId:string})=>{
  if(payload.resourceType==='trabajadores'){
    const workerId=Number(payload.resourceId);
    if(!Number.isFinite(workerId))throw new Error('Identificador de trabajador no válido.');
    await supabase.rpc('remove_worker_share',{p_worker_id:workerId,p_user_id:payload.userId});
    return {data:{ok:true}};
  }
  return deleteDataPermission(payload);
};

export const writeAuditEvent=async(payload:any)=>{
  if(payload?.action!=='LOGIN')return {data:{ok:true}};
  const user=await getSessionUser();
  if(user)await supabase.query('audit_logs',{
    method:'POST',
    prefer:'return=minimal',
    body:{
      user_id:user.id,
      user_email:user.email||'',
      action:'LOGIN',
      resource_type:payload.resourceType||'auth',
      resource_id:payload.resourceId||user.id,
      details:payload.details||{},
    },
  });
  return {data:{ok:true}};
};
