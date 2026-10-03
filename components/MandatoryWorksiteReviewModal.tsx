import React, { useMemo, useState, type ChangeEvent } from 'react';
import ModalPortal from './ModalPortal';

export default function MandatoryWorksiteReviewModal(props:{
  documentLabel:string;
  filename?:string;
  works:string[];
  busy?:boolean;
  onCancel:()=>void;
  onConfirm:(obra:string)=>Promise<void>|void;
}){
  const works=useMemo(()=>[...new Set((props.works||[]).map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')),[props.works]);
  const [selected,setSelected]=useState(works[0]||'');
  return <ModalPortal label="Clasificar documento por obra">
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-xl font-black text-slate-900 dark:text-white">Asignar obra al documento</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No se ha identificado la obra con suficiente seguridad. El documento se conserva, pero no llegará al encargado hasta que selecciones la obra correcta.</p>
        <div className="mt-4 rounded-2xl border bg-slate-50 p-3 text-sm dark:bg-slate-800"><b>{props.documentLabel}</b>{props.filename?<div className="mt-1 break-all text-xs text-slate-500">{props.filename}</div>:null}</div>
        <label className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-500">Obra</label>
        <select value={selected} onChange={(e:ChangeEvent<HTMLSelectElement>)=>setSelected(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border bg-white px-3 text-base font-bold dark:bg-slate-950">
          <option value="">Selecciona una obra…</option>
          {works.map(obra=><option key={obra} value={obra}>{obra}</option>)}
        </select>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={props.busy} onClick={props.onCancel} className="min-h-11 rounded-xl border px-4 text-sm font-black">Cancelar</button>
          <button type="button" disabled={props.busy||!selected} onClick={()=>void props.onConfirm(selected)} className="min-h-11 rounded-xl bg-[#00548E] px-5 text-sm font-black text-white disabled:opacity-50">Asignar obra</button>
        </div>
      </div>
    </div>
  </ModalPortal>;
}
