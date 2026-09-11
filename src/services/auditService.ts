import {supabase} from '../lib/supabase';
export type AuditAction='LOGIN'|'CREATE'|'UPDATE'|'DELETE'|'CREATE_USER'|'UPDATE_USER'|'DELETE_USER'|'UPDATE_PERMISSIONS';
export async function writeAuditLog(action:AuditAction,resourceType:string,resourceId:string,details?:Record<string,unknown>){const user=(await supabase.auth.getUser()).data.user;if(!user)return;await supabase.query('audit_logs',{method:'POST',prefer:'return=minimal',body:{user_id:user.id,user_email:user.email||'',action,resource_type:resourceType,resource_id:resourceId,details:details||{}}});}
