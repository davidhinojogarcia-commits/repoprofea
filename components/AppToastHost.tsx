import React,{useEffect,useState} from 'react';
import {CheckCircle2,AlertTriangle,X} from 'lucide-react';
import {APP_TOAST_EVENT,type AppToastDetail} from '../src/lib/appToast';

export function AppToastHost(){
 const [toast,setToast]=useState<AppToastDetail|null>(null);
 useEffect(()=>{
  const handler=(event:Event)=>setToast((event as CustomEvent<AppToastDetail>).detail);
  window.addEventListener(APP_TOAST_EVENT,handler as EventListener);
  return()=>window.removeEventListener(APP_TOAST_EVENT,handler as EventListener);
 },[]);
 useEffect(()=>{if(!toast)return;const id=window.setTimeout(()=>setToast(null),3500);return()=>window.clearTimeout(id);},[toast]);
 if(!toast)return null;
 const success=toast.type==='success';
 return <div className={`fixed top-24 right-4 z-[2000] max-w-md rounded-xl border px-4 py-3 shadow-2xl backdrop-blur flex items-start gap-3 ${success?'border-emerald-200 bg-emerald-50/95 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/95 dark:text-emerald-200':'border-red-200 bg-red-50/95 text-red-800 dark:border-red-900 dark:bg-red-950/95 dark:text-red-200'}`} role={success?'status':'alert'}>
  {success?<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0"/>:<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0"/>}
  <span className="text-sm font-semibold leading-5">{toast.message}</span>
  <button type="button" onClick={()=>setToast(null)} className="ml-1 rounded p-1 opacity-70 hover:opacity-100" aria-label="Cerrar aviso"><X size={15}/></button>
 </div>;
}
