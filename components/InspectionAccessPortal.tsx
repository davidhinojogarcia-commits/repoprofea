import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { OFFICIAL_LOGO_BASE64 } from '../src/assets/logoData';
import { supabase } from '../src/lib/supabase';
import { readInspectionAccess, type InspectionRead, type InspectionRole } from '../src/services/inspectionAccessService';

const LABELS: Record<InspectionRole,string> = {
  inspector:'Inspección de Trabajo y Seguridad Social',
  direccion_facultativa:'Dirección Facultativa',
  coordinador_seguridad:'Coordinación de Seguridad y Salud',
};
const FIELDS: {key:keyof InspectionRead['worker'];label:string}[] = [
  {key:'name',label:'Trabajador'},{key:'category',label:'Categoría'},
  {key:'worksite',label:'Obra'},{key:'periodStart',label:'Inicio del periodo'},
  {key:'periodEnd',label:'Fin del periodo'},
  {key:'trainingRecord',label:'Formación PRL según ficha'},
  {key:'aptitudeConclusion',label:'Conclusión preventiva de aptitud'}
];

function makeScopedExtract(data: InspectionRead): Blob {
  const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
  const logo=doc.getImageProperties(OFFICIAL_LOGO_BASE64);
  const width=Math.min(48,11*logo.width/logo.height);
  doc.addImage(OFFICIAL_LOGO_BASE64,'PNG',195-width,5,width,11);
  doc.setTextColor(0,84,142);
  doc.setFont('helvetica','bold');
  doc.setFontSize(12);
  doc.text('GESTIONPROFEA · CONSULTA PROFESIONAL AUTORIZADA',15,26);
  doc.setTextColor(30,41,59);
  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  doc.text('Perfil: '+(LABELS[data.role]||data.role),15,36);
  doc.text('Consulta: '+new Date().toLocaleString('es-ES'),15,42);
  doc.text('Acceso caduca: '+new Date(data.expiresAt).toLocaleString('es-ES'),15,48);
  let y=62;
  for(const f of FIELDS){
    const value=data.worker[f.key];
    if(!value)continue;
    doc.setFont('helvetica','bold');
    doc.text(f.label+':',15,y);
    doc.setFont('helvetica','normal');
    const lines=doc.splitTextToSize(String(value),115) as string[];
    doc.text(lines,82,y);
    y+=Math.max(1,lines.length)*6+3;
  }
  doc.setDrawColor(200,210,220);
  doc.line(15,y+1,195,y+1);
  doc.setFontSize(8.5);
  doc.text(doc.splitTextToSize(
    'Extracto informativo obtenido mediante autorización temporal. No sustituye contratos, certificados firmados, reconocimientos médicos ni documentación original. El estado de contratación debe comprobarse por las vías oficiales.',175
  ),15,y+9);
  return doc.output('blob');
}

export default function InspectionAccessPortal({ id }: {id:string}) {
  const validId=useMemo(()=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id),[id]);
  const [email,setEmail]=useState('');
  const [sessionEmail,setSessionEmail]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [info,setInfo]=useState('');
  const [record,setRecord]=useState<InspectionRead|null>(null);
  useEffect(()=>{
    let active=true;
    const check=async()=>{
      const {data,error}=await supabase.auth.getUser();
      if(active)setSessionEmail(error?null:(data.user?.email||null));
    };
    void check();
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      if(!active)return;
      setSessionEmail(session?.user?.email||null);
      setRecord(null);
    });
    return ()=>{active=false;subscription.unsubscribe();};
  },[]);
  const read=useCallback(async()=>{
    if(!validId)return;
    setLoading(true);setError('');
    try {const result=await readInspectionAccess(id);setRecord(result);}
    catch(e:any){setRecord(null);setError(e?.message||'No se ha podido verificar el acceso.');}
    finally{setLoading(false);}
  },[validId,id]);
  useEffect(()=>{if(sessionEmail&&validId)void read();},[sessionEmail,validId,read]);
  const requestLogin=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(sending||!validId)return;
    setSending(true);setError('');setInfo('');
    try{
      const {error}=await supabase.auth.signInWithOtp({
        email:email.trim(),
        options:{
          emailRedirectTo:new URL('/?inspection-access='+encodeURIComponent(id),location.origin).toString(),
          shouldCreateUser:true,
        },
      });
      if(error)throw error;
      setInfo('Comprueba el correo introducido y abre el enlace de acceso. La autorización solo funcionará si coincide con el correo verificado por el supervisor.');
    }catch(e:any){setError(e?.message||'No se pudo enviar el enlace de verificación.');}
    finally{setSending(false);}
  };
  const logout=async()=>{
    setRecord(null);setSessionEmail(null);setError('');
    const {error}=await supabase.auth.signOut();
    if(error)setError(error.message);
  };
  const download=async()=>{
    if(!record||loading)return;
    setError('');setLoading(true);
    try{
      // Revalidación online inmediatamente antes de facilitar un PDF.
      const fresh=await readInspectionAccess(id);
      setRecord(fresh);
      const blob=makeScopedExtract(fresh);
      const objectUrl=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=objectUrl;a.download='GESTIONPROFEA_EXTRACTO_CONSULTA.pdf';
      document.body.appendChild(a);a.click();a.remove();
      window.setTimeout(()=>URL.revokeObjectURL(objectUrl),15000);
    }catch(e:any){setRecord(null);setError(e?.message||'La autorización ya no permite descargar el extracto.');}
    finally{setLoading(false);}
  };

  return <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6 sm:py-10">
    <div className="mx-auto w-full max-w-xl space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-50 p-3 text-[#00548E] dark:bg-slate-800 dark:text-blue-300"><ShieldCheck className="h-6 w-6"/></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black">Consulta profesional PROFEA</h1>
          <p className="text-xs text-slate-600 dark:text-slate-300">Diputación Provincial de Cádiz · acceso temporal protegido</p>
        </div>
      </header>
      {!validId ? <p role="alert" className="text-red-700 dark:text-red-300">El código de consulta no tiene un formato válido.</p> : <>
        <p className="text-sm text-slate-600 dark:text-slate-300">Esta página se abre desde el navegador sin instalar GestionProfea. El enlace por sí solo no autoriza a consultar información. Se exige autenticación con el correo profesional verificado y una autorización vigente del supervisor.</p>
        {!sessionEmail ? <form onSubmit={requestLogin} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <label className="block space-y-2 text-sm font-bold">Correo profesional autorizado
            <input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="nombre@organismo.es"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/>
          </label>
          <button type="submit" disabled={sending} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50">
            <LockKeyhole className="h-4 w-4"/>{sending?'Enviando verificación…':'Verificar correo y acceder'}
          </button>
        </form> : <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="min-w-0 break-words text-xs">Sesión: <strong>{sessionEmail}</strong></p>
            <button type="button" onClick={()=>void logout()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><LogOut className="h-4 w-4"/> Cambiar cuenta</button>
          </div>
          {loading && !record && <p role="status" className="text-sm">Comprobando autorización en el servidor…</p>}
          {record && <section className="space-y-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-slate-800">
              <h2 className="font-bold text-[#00548E] dark:text-blue-300">{LABELS[record.role]}</h2>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Autorizado hasta: {new Date(record.expiresAt).toLocaleString('es-ES')}</p>
            </div>
            <dl className="space-y-2">
              {FIELDS.filter(f=>record.worker[f.key]).map(f=><div key={f.key} className="grid grid-cols-1 gap-1 border-b border-slate-100 py-2 text-sm dark:border-slate-800 sm:grid-cols-2">
                <dt className="font-bold text-slate-600 dark:text-slate-300">{f.label}</dt>
                <dd className="break-words">{record.worker[f.key]}</dd>
              </div>)}
            </dl>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{record.notice}</p>
            <button type="button" disabled={loading} onClick={()=>void download()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              <Download className="h-4 w-4"/> Descargar extracto institucional
            </button>
            <p className="text-xs text-slate-600 dark:text-slate-300">Los contratos firmados, certificados de formación, EPIs y demás documentos originales no se entregan automáticamente desde esta ficha. Solicita su exhibición al supervisor o mediante el cauce oficial del requerimiento.</p>
          </section>}
        </>}
        {info && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{info}</p>}
        {error && <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>}
      </>}
      <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        La Inspección de Trabajo mantiene sus facultades legales: esta consulta opcional no sustituye un requerimiento oficial ni puede impedir la entrega de documentación por los cauces establecidos.
      </footer>
    </div>
  </main>;
}
