import React, { useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import { defaultGeneratedForemanTemplate, validateForemanTemplate, type ForemanSignatureTemplate } from '../src/lib/foremanSignatureTemplate';
import { getReusableForemanLayout } from '../src/services/foremanPortalService';

type Props = { modelKey: string; initial?: ForemanSignatureTemplate; onClose: () => void;
  onSave: (layout: ForemanSignatureTemplate) => Promise<void> };
/** Normalized bottom-left coordinates, shared with the imported PDF editor. */
export default function ForemanModelSettings({modelKey,initial,onClose,onSave}:Props) {
  const [layout,setLayout]=useState<ForemanSignatureTemplate>(()=>initial||defaultGeneratedForemanTemplate(modelKey));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const inFlight=useRef(false);
  const save=async()=>{
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');
    try{validateForemanTemplate(layout);await onSave({...layout,revision:layout.revision+1});onClose();}
    catch(e:any){setError(e.message||'No se pudo guardar la configuración.');}
    finally{inFlight.current=false;setBusy(false);}
  };
  return <ModalPortal label="Firma del encargado" layout="fullscreen"><section className="foreman-model-settings-overlay">
    <div className="foreman-model-settings-panel rounded-2xl bg-white p-5 text-slate-900 dark:bg-slate-900 dark:text-slate-50">
      <h2 className="text-lg font-black">Firma del encargado</h2>
      <p className="mt-2 text-sm">Indica si corresponde firmar este documento. La plantilla solo se reutiliza al cargarla expresamente y guardarla.</p>
      <label className="mt-3 block text-sm font-bold">Modelo documental<input disabled={busy} value={layout.templateKey} maxLength={120} onChange={e=>setLayout({...layout,templateKey:e.target.value})} className="mt-1 min-h-[48px] w-full rounded-lg border bg-white p-2 text-slate-900"/></label>
      <button disabled={busy} type="button" className="mt-2 min-h-[48px] w-full rounded-lg border px-3 font-bold" onClick={async()=>{
        setBusy(true);setError('');
        try{const saved=await getReusableForemanLayout(layout.templateKey);if(!saved)throw new Error('No hay una plantilla guardada para este modelo.');validateForemanTemplate(saved);setLayout(saved);}
        catch(e:any){setError(e.message);}finally{setBusy(false);}
      }}>Cargar plantilla guardada</button>
      <label className="mt-3 flex min-h-[48px] items-center gap-2 font-bold"><input disabled={busy} type="checkbox" checked={layout.enabled} onChange={e=>setLayout({...layout,enabled:e.target.checked,required:e.target.checked&&layout.required})}/>Corresponde firma del encargado</label>
      {layout.enabled&&<>
        <label className="flex min-h-[48px] items-center gap-2 font-bold"><input disabled={busy} type="checkbox" checked={layout.required} onChange={e=>setLayout({...layout,required:e.target.checked})}/>Obligatoria antes de enviar</label>
        <p className="text-sm">Posición en porcentaje de página, desde la esquina inferior izquierda. Revisa el PDF con la previsualización antes de enviarlo.</p>
        <div className="mt-2 grid grid-cols-2 gap-3">{(['x','y','width','height'] as const).map((field,i)=><label key={field} className="text-sm font-bold">{['Horizontal (%)','Vertical (%)','Ancho (%)','Alto (%)'][i]}
          <input disabled={busy} type="number" min="0" max="100" step="0.1" value={Number((layout[field]*100).toFixed(2))} onChange={e=>setLayout({...layout,[field]:Number(e.target.value)/100})} className="mt-1 min-h-[48px] w-full rounded-lg border bg-white p-2 text-slate-900"/>
        </label>)}</div>
      </>}
      {error&&<p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-4 flex gap-3"><button disabled={busy} type="button" onClick={onClose} className="min-h-[48px] flex-1 rounded-xl border px-3 font-bold">Cerrar</button><button disabled={busy} type="button" onClick={()=>void save()} className="min-h-[48px] flex-1 rounded-xl bg-[#00548E] px-3 font-black text-white">{busy?'Guardando…':'Guardar plantilla'}</button></div>
    </div>
  </section></ModalPortal>;
}
