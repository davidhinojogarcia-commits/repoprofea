const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2';
const STORAGE_KEY = 'profea-supabase-session';
export interface SupabaseUser { id:string; uid:string; email?:string|null; user_metadata?:Record<string,any>; }
export interface SupabaseSession { access_token:string; refresh_token:string; expires_at?:number; user:SupabaseUser; }
let session:SupabaseSession|null=null;let listeners=new Set<(user:SupabaseUser|null)=>void>();
const normalizeUser=(user:any):SupabaseUser=>({...user,uid:user.uid||user.id,id:user.id||user.uid});
function loadSession():SupabaseSession|null{try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;const s=JSON.parse(raw);return{...s,user:normalizeUser(s.user)};}catch{return null;}}
function saveSession(value:SupabaseSession|null){session=value?{...value,user:normalizeUser(value.user)}:null;try{if(session)localStorage.setItem(STORAGE_KEY,JSON.stringify(session));else localStorage.removeItem(STORAGE_KEY);}catch{}listeners.forEach(cb=>cb(session?.user||null));}
session=loadSession();
async function request(path:string,options:RequestInit={},token?:string|null):Promise<any>{const headers=new Headers(options.headers);headers.set('apikey',SUPABASE_KEY);headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${token||session?.access_token||SUPABASE_KEY}`);const response=await fetch(`${SUPABASE_URL}${path}`,{...options,headers});const text=await response.text();let data:any=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(!response.ok){const error:any=new Error(data?.msg||data?.message||data?.error_description||data?.error||`Supabase HTTP ${response.status}`);error.status=response.status;error.code=data?.code||data?.error_code;throw error;}return data;}
function withExpiry(data:any){return{...data,user:normalizeUser(data.user),expires_at:data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600)};}
export const supabase={
 get url(){return SUPABASE_URL;},get key(){return SUPABASE_KEY;},
 auth:{
  async signInWithPassword(email:string,password:string){const data=withExpiry(await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},null));saveSession(data as SupabaseSession);return{data,error:null};},
  async refreshSession(){if(!session?.refresh_token)return{data:{session:null},error:null};try{const data=withExpiry(await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})},null));saveSession(data as SupabaseSession);return{data:{session:data},error:null};}catch(error){saveSession(null);return{data:{session:null},error};}},
  async getSession(){if(!session)session=loadSession();if(!session)return{data:{session:null},error:null};if(session.expires_at&&session.expires_at*1000<Date.now()+30000)return this.refreshSession();return{data:{session},error:null};},
  async getUser(){if(!session?.access_token)return{data:{user:null},error:null};try{const user=normalizeUser(await request('/auth/v1/user',{method:'GET'}));saveSession({...session,user});return{data:{user},error:null};}catch(error){return{data:{user:null},error};}},
  async signOut(){try{if(session?.access_token)await request('/auth/v1/logout',{method:'POST'});}finally{saveSession(null);}},
  onAuthStateChange(callback:(user:SupabaseUser|null)=>void){listeners.add(callback);queueMicrotask(()=>callback(session?.user||null));return{data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};},
 },
 async query(table:string,options:{method?:string;query?:string;body?:any;prefer?:string}={}){const headers:Record<string,string>={};if(options.prefer)headers.Prefer=options.prefer;return request(`/rest/v1/${table}${options.query?`?${options.query}`:''}`,{method:options.method||'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});},
 async edgeFunction(name:string,body:any){return request(`/functions/v1/${name}`,{method:'POST',body:JSON.stringify(body)});},
};
export{SUPABASE_URL,SUPABASE_KEY,STORAGE_KEY};
