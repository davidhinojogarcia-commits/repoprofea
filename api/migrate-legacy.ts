import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2';

async function sb(pathname:string, token:string, init:RequestInit={}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, { ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await response.text();
  let data:any=null; try { data=text?JSON.parse(text):null; } catch { data=text; }
  if(!response.ok) throw new Error(data?.message||data?.msg||data?.error||`Supabase ${response.status}`);
  return data;
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const auth=String(req.headers.authorization||'');
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!token) return res.status(401).json({error:'Unauthorized'});
  try{
    const user=await sb('/auth/v1/user',token,{method:'GET'});
    const profile=(await sb(`/rest/v1/users?select=id,role,active&id=eq.${encodeURIComponent(user.id)}&limit=1`,token,{method:'GET'}))?.[0];
    if(!profile || profile.active!==true || profile.role!=='admin') return res.status(403).json({error:'Admin only'});
    const settingsRows=await sb(`/rest/v1/user_settings?select=settings&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,token,{method:'GET'});
    const current=settingsRows?.[0]?.settings||{};
    if(current.legacyMigrationVersion===1) return res.status(200).json({migrated:false,reason:'already-migrated'});
    const existing=await sb(`/rest/v1/workers?select=id&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`,token,{method:'GET'});
    if((existing||[]).length) return res.status(200).json({migrated:false,reason:'data-already-present'});
    const workers=JSON.parse(await fs.readFile(path.join(process.cwd(),'data','initial_workers.json'),'utf8'));
    const now=new Date().toISOString(); let imported=0;
    for(let i=0;i<workers.length;i+=50){
      const rows=workers.slice(i,i+50).filter((w:any)=>w&&w.id!=null).map((w:any)=>({owner_id:user.id,id:Number(w.id),data:w,created_by:user.id,created_at:w.fechaRegistro||now,updated_by:user.id,updated_at:w._lastUpdated||w.fechaRegistro||now}));
      if(rows.length){await sb('/rest/v1/workers',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)}); imported+=rows.length;}
    }
    const settings=JSON.parse(await fs.readFile(path.join(process.cwd(),'data','initial_settings.json'),'utf8'));
    await sb('/rest/v1/user_settings',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:user.id,settings:{...settings,legacyMigrationVersion:1,legacyMigrationAt:now},updated_by:user.id,updated_at:now})});
    return res.status(200).json({migrated:true,workers:imported});
  }catch(error:any){console.error('legacy migration',error);return res.status(500).json({error:error?.message||'Migration failed'});}
}
