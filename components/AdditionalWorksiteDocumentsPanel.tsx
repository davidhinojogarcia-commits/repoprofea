import React, { useEffect, useMemo, useState } from 'react';
import { FileText, FolderOpen, Printer, UserRound, X } from 'lucide-react';
import type { Person } from '../types';
import { getDocuments } from '../src/services/databaseService';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { supabase } from '../src/lib/supabase';
import { downloadPDF } from '../src/lib/exportUtils';
import {
  ADDITIONAL_WORKSITE_DOCUMENTS,
  generateAdditionalWorksiteDocument,
  type AdditionalWorksiteDocumentType,
} from '../src/lib/worksiteAdditionalDocumentsPdf';

type WorkRow = { id: string; nombre: string; municipio?: string; empresa?: string; cif?: string; recurso_preventivo?: string };
const safe = (v: unknown) => String(v ?? '').trim();
const norm = (v: string) => safe(v).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[._\-/:]+/g, ' ').replace(/\s+/g, ' ');
const workIdentity = (v: string) => { const raw = norm(v); const code = raw.match(/\b(\d{5})\b/)?.[1] || ''; const compact = raw.replace(/\s+/g,''); const type = compact.includes('gr') ? 'GR' : compact.includes('ee') ? 'EE' : ''; return code && type ? `${code} ${type}` : ''; };
const sameWork = (a: string,b: string) => { const x=workIdentity(a), y=workIdentity(b); return x&&y ? x===y : norm(a)===norm(b); };
const DEFAULT_COMPANY = 'AEPSA (Diputación Provincial de Cádiz)';
const DEFAULT_CIF = 'P1100000G';

export const AdditionalWorksiteDocumentsPanel: React.FC = () => {
  const [visible,setVisible]=useState(false); const [open,setOpen]=useState(false); const [loading,setLoading]=useState(false);
  const [workers,setWorkers]=useState<Person[]>([]); const [works,setWorks]=useState<WorkRow[]>([]); const [configuredWorks,setConfiguredWorks]=useState<string[]>([]);
  const [selectedWork,setSelectedWork]=useState(''); const [selectedWorkerId,setSelectedWorkerId]=useState(''); const [docType,setDocType]=useState<AdditionalWorksiteDocumentType>('baja_voluntaria');
  const [date,setDate]=useState(()=>new Date().toISOString().slice(0,10));

  useEffect(()=>{ const h=(e:Event)=>{ const detail=(e as CustomEvent<{view?:string}>).detail; const on=detail?.view==='documentacion_obra'; setVisible(on); if(!on)setOpen(false); }; window.addEventListener('profea:navigate',h as EventListener); return()=>window.removeEventListener('profea:navigate',h as EventListener); },[]);

  const refresh=async()=>{ setLoading(true); try { const [p,o,s]=await Promise.all([getDocuments<Person>('trabajadores'),supabase.query('obras',{query:'select=id,nombre,municipio,empresa,cif,recurso_preventivo&order=nombre.asc'}),loadAppBusinessSettings()]); setWorkers(p||[]); setWorks((o||[]) as WorkRow[]); setConfiguredWorks((s.savedObras||[]).map(safe).filter(Boolean)); } finally { setLoading(false); } };
  useEffect(()=>{ if(visible) void refresh(); },[visible]);

  const workNames=useMemo(()=>Array.from(new Set([...works.map(w=>workIdentity(w.nombre)||safe(w.nombre)),...configuredWorks.map(w=>workIdentity(w)||safe(w))].filter(Boolean))).sort((a,b)=>a.localeCompare(b,'es',{numeric:true})),[works,configuredWorks]);
  useEffect(()=>{ if(!selectedWork&&workNames.length)setSelectedWork(workNames[0]); if(selectedWork&&!workNames.includes(selectedWork)&&workNames.length)setSelectedWork(workNames[0]); },[workNames,selectedWork]);
  const workWorkers=useMemo(()=>workers.filter(w=>sameWork(w.obra||'',selectedWork)).sort((a,b)=>a.apellidosNombre.localeCompare(b.apellidosNombre,'es')),[workers,selectedWork]);
  useEffect(()=>{ if(selectedWorkerId&&!workWorkers.some(w=>String(w.id)===selectedWorkerId))setSelectedWorkerId(''); },[selectedWorkerId,workWorkers]);
  const worker=workWorkers.find(w=>String(w.id)===selectedWorkerId)||null; const row=works.find(w=>sameWork(w.nombre,selectedWork));

  const generate=(withWorker:boolean)=>{ const chosen=withWorker?worker:null; if(withWorker&&!chosen){window.alert('Selecciona primero un trabajador.');return;} if(!selectedWork){window.alert('Selecciona una obra.');return;} const {doc,filename}=generateAdditionalWorksiteDocument(docType,chosen,{obra:selectedWork,municipio:safe(row?.municipio),empresa:safe(row?.empresa)||DEFAULT_COMPANY,cif:safe(row?.cif)||DEFAULT_CIF,fecha:date,responsable:safe(row?.recurso_preventivo)}); downloadPDF(doc,filename); };

  if(!visible)return null;
  return <>
    <button type="button" onClick={()=>setOpen(true)} className="fixed z-[45] right-5 bottom-5 inline-flex items-center gap-2 rounded-2xl bg-[#00548E] text-white px-4 py-3 font-black shadow-xl hover:bg-[#004270]" title="Otros documentos de obra"><FolderOpen className="w-5 h-5"/>Otros documentos</button>
    {open&&<div className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}>
      <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><FolderOpen className="w-5 h-5 text-[#00548E]"/><h2 className="font-black text-xl">Otros documentos de obra</h2></div><p className="text-xs text-slate-500 mt-1">Plantillas homogéneas, en blanco o autorellenadas con datos del trabajador y de la obra.</p></div>
          <button type="button" onClick={()=>setOpen(false)} className="p-2 rounded-xl border"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-5 sm:p-6 space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-sm font-bold">Obra<select value={selectedWork} onChange={e=>setSelectedWork(e.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-900 dark:border-slate-700">{workNames.map(w=><option key={w}>{w}</option>)}</select></label>
            <label className="text-sm font-bold">Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-900 dark:border-slate-700"/></label>
            <label className="text-sm font-bold sm:col-span-2">Trabajador (opcional)<select value={selectedWorkerId} onChange={e=>setSelectedWorkerId(e.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-900 dark:border-slate-700"><option value="">Sin seleccionar · generar plantilla en blanco</option>{workWorkers.map(w=><option key={w.id} value={String(w.id)}>{w.apellidosNombre} · {w.dni} · {w.categoria||'Sin puesto'}</option>)}</select></label>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {(Object.entries(ADDITIONAL_WORKSITE_DOCUMENTS) as [AdditionalWorksiteDocumentType,typeof ADDITIONAL_WORKSITE_DOCUMENTS[AdditionalWorksiteDocumentType]][]).map(([key,def])=><button type="button" key={key} onClick={()=>setDocType(key)} className={`text-left rounded-2xl border p-4 transition ${docType===key?'border-[#00548E] bg-blue-50 dark:bg-blue-950/30':'border-slate-200 dark:border-slate-800 hover:border-blue-300'}`}><div className="flex items-start gap-3"><FileText className="w-5 h-5 text-[#00548E] shrink-0 mt-0.5"/><div><div className="font-black">{def.short}</div><div className="text-xs text-slate-500 mt-1 line-clamp-3">{def.legal}</div></div></div></button>)}
          </div>
          <div className="rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/20 p-4"><div className="font-black">{ADDITIONAL_WORKSITE_DOCUMENTS[docType].title}</div><p className="text-xs text-slate-600 dark:text-slate-300 mt-2">{ADDITIONAL_WORKSITE_DOCUMENTS[docType].legal}</p><p className="text-[11px] text-slate-500 mt-2">Los partes internos no sustituyen modelos oficiales, comunicaciones obligatorias, certificados firmados por órgano competente ni documentación emitida por FREMAP u otra entidad cuando legalmente proceda.</p></div>
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            <button type="button" onClick={()=>generate(false)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 font-bold"><Printer className="w-4 h-4"/>Generar en blanco</button>
            <button type="button" onClick={()=>generate(true)} disabled={loading||!worker} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-3 font-bold disabled:opacity-50"><UserRound className="w-4 h-4"/>Generar con trabajador</button>
          </div>
        </div>
      </div>
    </div>}
  </>;
};
