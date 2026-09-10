import { supabase } from './supabase';

type CallResult<T>={data:T};
async function call<T>(action:string,payload:any={}):Promise<CallResult<T>>{return {data:await supabase.edgeFunction('admin-users',{action,...payload})};}
export const bootstrapFirstAdmin=async()=>({data:{ok:true,role:'admin' as const}});
export const touchLogin=async()=>({data:{ok:true,email:(await supabase.auth.getUser()).data.user?.email||''}});
export const createManagedUser=(payload:any)=>call<{uid:string;email:string;role:'admin'|'user'}>('create',payload);
export const updateManagedUserProfile=(payload:any)=>call<{ok:boolean}>('update_profile',payload);
export const updateManagedUserRole=(payload:any)=>call<{ok:boolean}>('role',payload);
export const setManagedUserRole=updateManagedUserRole;
export const updateManagedUserStatus=(payload:any)=>call<{ok:boolean}>('status',payload);
export const setManagedUserActive=updateManagedUserStatus;
export const deleteManagedUser=(payload:any)=>call<{ok:boolean}>('delete',payload);
export const updateManagedUserPermissions=(payload:any)=>call<{ok:boolean}>('permissions',payload);
export const updateManagedPermissions=updateManagedUserPermissions;
export const resetManagedUserPassword=(payload:any)=>call<{email:string;resetLink:string}>('reset_password',payload);
export const sendManagedPasswordReset=resetManagedUserPassword;
export const setDataPermission=async(payload:any)=>{await supabase.query('data_permissions',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{resource_type:payload.resourceType,resource_id:String(payload.resourceId),owner_id:payload.ownerId,user_id:payload.userId,can_read:payload.canRead,can_update:payload.canUpdate,can_delete:payload.canDelete}});return {data:{ok:true,permissionId:`${payload.resourceType}_${payload.resourceId}_${payload.userId}`}};};
export const deleteDataPermission=async(payload:any)=>{await supabase.query('data_permissions',{method:'DELETE',prefer:'return=minimal',query:`resource_type=eq.${encodeURIComponent(payload.resourceType)}&resource_id=eq.${encodeURIComponent(String(payload.resourceId))}&user_id=eq.${encodeURIComponent(payload.userId)}`});return {data:{ok:true}};};
export const writeAuditEvent=async(payload:any)=>{const user=(await supabase.auth.getUser()).data.user;if(user)await supabase.query('audit_logs',{method:'POST',prefer:'return=minimal',body:{user_id:user.id,user_email:user.email||'',action:payload.action,resource_type:payload.resourceType||'',resource_id:payload.resourceId||'',details:payload.details||{}}});return {data:{ok:true}};};
