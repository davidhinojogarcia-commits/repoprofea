import React, { useCallback, useEffect, useState } from 'react';
import type { Person } from '../types';
import {
  inspectionAccessUrl, issueInspectionAccess, listInspectionAccess, revokeInspectionAccess,
  type InspectionGrant, type InspectionRole, type InspectionSection
} from '../src/services/inspectionAccessService';
import { Clipboard, Link2, ShieldCheck, Trash2 } from 'lucide-react';

const LABELS: Record<InspectionRole,string> = {
  inspector: 'Inspección de Trabajo',
  direccion_facultativa: 'Dirección Facultativa',
  coordinador_seguridad: 'Coordinador de Seguridad y Salud',
};
const SECTIONS: {id:InspectionSection,label:string,roles:InspectionRole[]}[] = [
  {id:'identity',label:'Identificación y categoría',roles:['inspector','direccion_facultativa','coordinador_seguridad']},
  {id:'worksite',label:'Obra vinculada al registro',roles:['inspector','direccion_facultativa','coordinador_seguridad']},
  {id:'employment',label:'Periodo de contratación',roles:['inspector']},
  {id:'prevention',label:'Estado de formación PRL según ficha',roles:['inspector','direccion_facultativa','coordinador_seguridad']},
  {id:'medical_conclusion',label:'Conclusión preventiva de aptitud (sin diagnósticos)',roles:['inspector','coordinador_seguridad']},
];

export default function InspectionAccessManager({ person }: {person:Person}) {
  const [role,setRole]=useState<InspectionRole>('inspector');
  const [sections,setSections]=useState<InspectionSection[]>(['identity','worksite','employment','prevention']);
  const [recipientEmail,setRecipientEmail]=useState('');
  const [duration,setDuration]=useState(30);
  const [verified,setVerified]=useState(false);
  const [verificationNote,setVerificationNote]=useState('');
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [url,setUrl]=useState('');
  const [existing,setExisting]=useState<InspectionGrant[]>([]);
  const refresh=useCallback(async()=>{
    try {setExisting(await listInspectionAccess(Number(person.id)));} catch (e:any) {setError(e?.message||'No se han podido consultar las autorizaciones.');}
  },[person.id]);

  useEffect(()=>{void refresh();},[refresh]);
  const onRoleChange=(value:InspectionRole)=>{
    setRole(value);
    const allowed=SECTIONS.filter(s=>s.roles.includes(value)).map(s=>s.id);
    setSections(previous=>previous.filter(s=>allowed.includes(s)).concat(previous.includes('identity')?[]:['identity']));
  };
  const toggleSection=(id:InspectionSection,enabled:boolean)=>{
    if(id==='identity')return;
    setSections(previous=>enabled?[...new Set([...previous,id])]:previous.filter(x=>x!==id));
  };
  const issue=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(loading)return;
    if(!verified){setError('Confirma la comprobación presencial de la identidad profesional.');return;}
    setLoading(true);setError('');setNotice('');setUrl('');
    try {
      const id=await issueInspectionAccess({
        workerId:Number(person.id),
        recipientEmail:recipientEmail.trim(),
        role,sections,durationMinutes:duration,
        verificationNote:verificationNote.trim()
      });
      setUrl(inspectionAccessUrl(id));
      setNotice('Acceso emitido para el correo verificado; el enlace por sí solo no abre ningún documento.');
      await refresh();
    } catch(e:any){
      setError(e?.message||'No se ha podido emitir el acceso. No compartas enlaces anteriores.');
    } finally {setLoading(false);}
  };
  const revoke=async(id:string)=>{
    if(loading)return;
    setLoading(true);setError('');setNotice('');
    try {
      const did=await revokeInspectionAccess(id);
      if(!did)throw new Error('La autorización ya no estaba activa o no pertenece a este supervisor.');
      if(url.includes(id))setUrl('');
      setNotice('Autorización revocada. Las próximas consultas quedan bloqueadas en el servidor.');
      await refresh();
    }catch(e:any){setError(e?.message||'No se pudo confirmar la revocación.');}
    finally{setLoading(false);}
  };
  const share=async()=>{
    if(!url)return;
    try{
      if(navigator.share)await navigator.share({title:'Acceso temporal verificado · GestionProfea',url});
      else {await navigator.clipboard.writeText(url);setNotice('Enlace copiado. Remítelo solo al correo profesional autorizado.');}
    }catch(e:any){if(e?.name!=='AbortError')setNotice('Comparte el enlace manualmente con el destinatario verificado.');}
  };

  return <section className="space-y-4 rounded-xl border border-[#00548E]/25 bg-blue-50/40 p-3 text-slate-900 dark:border-blue-800 dark:bg-slate-800/60 dark:text-slate-100 sm:p-4" aria-label="Autorizaciones externas de inspección">
    <header className="flex items-center gap-2">
      <ShieldCheck className="h-5 w-5 text-[#00548E] dark:text-blue-300" />
      <h3 className="font-black text-[#00548E] dark:text-blue-300">Consulta profesional temporal</h3>
    </header>
    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
      Solo un supervisor autorizado puede emitir un acceso para este trabajador. Comprueba personalmente la identidad y competencia profesional del destinatario. La otra persona entra desde el navegador, sin instalar la app, autenticándose con su correo.
    </p>
    <form onSubmit={issue} className="space-y-3">
      <label className="block space-y-1 text-xs font-bold">Perfil profesional
        <select aria-label="Perfil profesional externo" value={role} onChange={e=>onRoleChange(e.target.value as InspectionRole)}
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
          {Object.entries(LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs font-bold">Correo profesional autorizado
        <input type="email" required autoComplete="off" value={recipientEmail} onChange={e=>setRecipientEmail(e.target.value)}
          placeholder="nombre@organismo.es" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/>
      </label>
      <fieldset className="space-y-2">
        <legend className="text-xs font-bold">Datos concretos que se autorizan</legend>
        {SECTIONS.filter(s=>s.roles.includes(role)).map(s=><label key={s.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          <input type="checkbox" checked={sections.includes(s.id)} disabled={s.id==='identity'}
            onChange={e=>toggleSection(s.id,e.target.checked)} className="h-5 w-5 accent-[#00548E]"/>
          <span>{s.label}</span>
        </label>)}
      </fieldset>
      <label className="block space-y-1 text-xs font-bold">Duración de la autorización
        <select value={duration} onChange={e=>setDuration(Number(e.target.value))}
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
          <option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>60 minutos</option>
        </select>
      </label>
      <label className="block space-y-1 text-xs font-bold">Cómo se ha verificado la identidad profesional
        <textarea required minLength={15} maxLength={500} rows={2} value={verificationNote} onChange={e=>setVerificationNote(e.target.value)}
          placeholder="Credencial mostrada presencialmente, referencia de actuación o comprobación institucional..."
          className="min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/>
      </label>
      <label className="flex min-h-11 items-start gap-3 text-xs font-medium">
        <input type="checkbox" required checked={verified} onChange={e=>setVerified(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#00548E]"/>
        <span>Declaro haber comprobado la identidad profesional y la pertinencia de este acceso. No autorizo diagnósticos ni expedientes ajenos al trabajador.</span>
      </label>
      <button disabled={loading} type="submit" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
        <Link2 className="h-4 w-4"/> {loading?'Comprobando…':'Emitir acceso temporal'}
      </button>
    </form>
    {url && <div className="space-y-2 rounded-xl border border-emerald-300 bg-white p-3 dark:border-emerald-800 dark:bg-slate-900">
      <p className="text-xs font-bold">Enlace emitido (solo válido con autenticación del correo indicado)</p>
      <input aria-label="Enlace de consulta temporal" value={url} readOnly onFocus={e=>e.currentTarget.select()} className="min-h-11 w-full rounded-lg border px-2 text-xs text-slate-900 dark:bg-slate-800 dark:text-white"/>
      <button type="button" onClick={()=>void share()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-bold">
        <Clipboard className="h-4 w-4"/> Compartir o copiar acceso
      </button>
    </div>}
    {error && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}
    {existing.length>0 && <div className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide">Autorizaciones de este registro</h4>
      {existing.map(g=><div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
        <div className="min-w-0 flex-1 break-words"><p className="font-bold">{LABELS[g.role]||g.role}</p><p>{g.email}</p><p className="text-slate-500 dark:text-slate-400">Caduca: {new Date(g.expiresAt).toLocaleString('es-ES')} · {g.revokedAt?'Revocada':new Date(g.expiresAt)<=new Date()?'Caducada':'Activa'}</p></div>
        {!g.revokedAt && new Date(g.expiresAt)>new Date() && <button type="button" disabled={loading} onClick={()=>void revoke(g.id)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-red-300 px-3 text-xs font-bold text-red-700 dark:border-red-800 dark:text-red-300"><Trash2 className="h-4 w-4"/> Revocar</button>}
      </div>)}
    </div>}
    <p className="text-[11px] text-slate-500 dark:text-slate-400">La consulta temporal muestra únicamente un extracto de datos autorizados. Los originales firmados deberán entregarse por un procedimiento documental verificado; este permiso no los publica automáticamente.</p>
  </section>;
}
