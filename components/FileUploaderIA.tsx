import React, { useCallback, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileCheck, Info, RefreshCw, Trash2, UploadCloud, Users, XCircle } from 'lucide-react';
import { Subcontratista, SubcontrataDocAnalysisResult, SubcontrataDocEstado, SubcontrataDocItem, SubcontrataEstadoExpediente, SubcontrataTrabajadorCAE } from '../types';
import { getSubcontrataCompliance } from '../src/lib/subcontratasDefaults';
import { ChecklistReviewModal, ProposedChecklistChange } from './ChecklistReviewModal';
import { extractClientDocumentText } from '../src/lib/clientDocumentText';
import { updateDocument } from '../src/services/databaseService';

interface FileUploaderIAProps {
  subcontrata: Subcontratista;
  onChecklistUpdate: (updatedChecklist: SubcontrataDocItem[], newEstadoExpediente: SubcontrataEstadoExpediente, summaryText: string) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  onFilterMissingInRed?: () => void;
  onOpenRequerimiento?: () => void;
}

type ConvertedFile = { name:string; type:string; base64:string; extractedText:string; extractionSource:string };
type ReviewWorker = SubcontrataTrabajadorCAE & { selected:boolean };

const stateRank:Record<SubcontrataDocEstado,number>={entregado:5,no_aplica:4,incompleto:3,caducado:2,pendiente:1};
const confidenceRank=(v?:string)=>v==='alta'?0.4:v==='media'?0.2:0;

export const FileUploaderIA:React.FC<FileUploaderIAProps>=({subcontrata,onChecklistUpdate,onToast})=>{
  const [isDragging,setIsDragging]=useState(false);
  const [selectedFiles,setSelectedFiles]=useState<File[]>([]);
  const [isAnalyzing,setIsAnalyzing]=useState(false);
  const [analysisProgress,setAnalysisProgress]=useState('');
  const [isReviewModalOpen,setIsReviewModalOpen]=useState(false);
  const [proposedChanges,setProposedChanges]=useState<ProposedChecklistChange[]>([]);
  const [analysisSummary,setAnalysisSummary]=useState('');
  const [workersReview,setWorkersReview]=useState<ReviewWorker[]>([]);
  const fileInputRef=useRef<HTMLInputElement>(null);

  const libroEstado=subcontrata.libroSubcontratacionEstado || (subcontrata.checklist.find(i=>i.id==='libro_subcontratacion')?.estado==='entregado'?'registrado':'no_registrado');
  const savedWorkers=subcontrata.trabajadoresCae||[];
  const authorized=savedWorkers.filter(w=>w.estadoAcceso==='autorizado');
  const denied=savedWorkers.filter(w=>w.estadoAcceso!=='autorizado');

  const addFiles=useCallback((incoming:File[])=>{
    const accepted=incoming.filter(file=>file.type==='application/pdf'||file.type.startsWith('image/')||/\.(pdf|png|jpe?g|docx?|xlsx?)$/i.test(file.name));
    if(!accepted.length){onToast('Seleccione archivos PDF, Word, Excel o imágenes.','error');return;}
    setSelectedFiles(prev=>{const names=new Set(prev.map(f=>f.name));return [...prev,...accepted.filter(f=>!names.has(f.name))];});
  },[onToast]);

  const convertFile=async(file:File):Promise<ConvertedFile>=>{
    let extractedText='',extractionSource='none';
    try{const x=await extractClientDocumentText(file,m=>setAnalysisProgress(`${file.name}: ${m}`));extractedText=x.text;extractionSource=x.source;}catch(e){console.warn('[CAE] extracción local',e);}
    const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onloadend=()=>resolve(String(r.result||''));r.onerror=()=>reject(r.error);r.readAsDataURL(file);});
    return {name:file.name,type:file.type||'application/octet-stream',base64,extractedText,extractionSource};
  };

  const buildProposal=(item:SubcontrataDocItem,doc:SubcontrataDocAnalysisResult):ProposedChecklistChange=>{
    let estado:SubcontrataDocEstado=doc.estaCaducado?'caducado':(doc.estado||'entregado');
    if(doc.esLegible===false||doc.solicitarReintento)estado='incompleto';
    let obs=String(doc.observaciones||'').trim();
    if(doc.estaCaducado)obs=doc.motivoCaducidad||obs||'Documento caducado.';
    else if(doc.esLegible===false||doc.solicitarReintento)obs=doc.motivoIlegible||obs||'Documento incompleto o requiere revisión.';
    else if(doc.esProximaCaducidad)obs=doc.motivoCaducidad||obs;
    const validezIA=doc.estaCaducado?`CADUCADO${doc.diasCaducado?` (${doc.diasCaducado} días)`:''}`:doc.esProximaCaducidad?`PRÓXIMA CADUCIDAD${doc.diasRestantes!=null?` (${doc.diasRestantes} días)`:''}`:`VERIFICADO (${doc.confianza||'media'})`;
    return {docId:item.id,nombre:item.nombre,categoria:item.categoria,normativa:item.normativa,obligatorio:item.obligatorio,estadoActual:item.estado,estadoPropuesto:estado,fechaEntregaActual:item.fechaEntrega,fechaEntregaPropuesta:doc.fechaEmision||item.fechaEntrega||'',fechaCaducidadActual:item.fechaCaducidad,fechaCaducidadPropuesta:doc.fechaCaducidad||item.fechaCaducidad||'',observacionesActuales:item.observaciones,observacionesPropuestas:obs||item.observaciones||'',archivoOrigen:doc.archivoOrigen||'',estaCaducado:doc.estaCaducado,diasCaducado:doc.diasCaducado,diasRestantes:doc.diasRestantes,esProximaCaducidad:doc.esProximaCaducidad,motivoCaducidad:doc.motivoCaducidad,motivoIlegible:doc.motivoIlegible,esLegible:doc.esLegible!==false,validezIA,confianza:doc.confianza,selected:true} as ProposedChecklistChange;
  };

  const executeAnalysis=async()=>{
    if(!selectedFiles.length){onToast('Seleccione al menos un documento.','error');return;}
    setIsAnalyzing(true); setAnalysisSummary(''); setWorkersReview([]);
    try{
      const files:ConvertedFile[]=[]; for(let i=0;i<selectedFiles.length;i++){setAnalysisProgress(`Preparando ${i+1}/${selectedFiles.length}: ${selectedFiles[i].name}`);files.push(await convertFile(selectedFiles[i]));}
      setAnalysisProgress('Cotejando fechas, vigencias legales y personal de la subcontrata…');
      const response=await fetch('/api/analyze-subcontractor-docs-v3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files,subcontrata:{nombreEmpresa:subcontrata.nombreEmpresa,cif:subcontrata.cif,obra:subcontrata.obra,actividadGremio:subcontrata.actividadGremio},currentChecklist:subcontrata.checklist})});
      const data=await response.json().catch(()=>({})); if(!response.ok||!data.success)throw new Error(data.error||'No se pudo analizar la documentación.');
      const best=new Map<string,SubcontrataDocAnalysisResult>();
      for(const d of Array.isArray(data.documentosAnalizados)?data.documentosAnalizados:[]){if(!d?.docId)continue;const p=best.get(d.docId);const score=(stateRank[d.estado as SubcontrataDocEstado]||0)+confidenceRank(d.confianza);const pscore=p?(stateRank[p.estado]||0)+confidenceRank(p.confianza):-1;if(!p||score>pscore)best.set(d.docId,d);}
      const proposals=subcontrata.checklist.flatMap(item=>{const d=best.get(item.id);return d?[buildProposal(item,d)]:[];});
      setProposedChanges(proposals);
      const detected:ReviewWorker[]=(Array.isArray(data.trabajadoresDetectados)?data.trabajadoresDetectados:[]).map((w:any,i:number)=>({id:w.id||`cae_${Date.now()}_${i}`,nombreApellidos:String(w.nombreApellidos||''),dni:String(w.dni||''),puestoTrabajo:String(w.puestoTrabajo||''),estadoAcceso:w.estadoAcceso==='autorizado'?'autorizado':'no_autorizado',motivosNoAutorizado:Array.isArray(w.motivosNoAutorizado)?w.motivosNoAutorizado:[],documentosAcreditados:Array.isArray(w.documentosAcreditados)?w.documentosAcreditados:[],archivosOrigen:Array.isArray(w.archivosOrigen)?w.archivosOrigen:[],confianza:w.confianza||'baja',confirmadoPorUsuario:false,selected:true}));
      setWorkersReview(detected);
      const summary=String(data.resumenDiagnostico||`${files.length} archivo(s) analizados.`); setAnalysisSummary(summary);
      if(proposals.length)setIsReviewModalOpen(true);
      if(!proposals.length&&!detected.length)onToast('Análisis completado sin evidencias suficientes para proponer cambios.','success');
      else onToast(`Análisis completado: ${proposals.length} requisito(s) y ${detected.length} trabajador(es) para revisión humana.`,'success');
    }catch(e:any){console.error('[CAE v3]',e);onToast(e?.message||'Error al analizar los documentos.','error');}finally{setIsAnalyzing(false);setAnalysisProgress('');}
  };

  const applyChecklist=(confirmed:ProposedChecklistChange[])=>{
    const updated=subcontrata.checklist.map(item=>{const c=confirmed.find(x=>x.docId===item.id);if(!c)return item;return {...item,estado:c.estadoPropuesto,fechaEntrega:c.fechaEntregaPropuesta||item.fechaEntrega,fechaCaducidad:c.fechaCaducidadPropuesta||item.fechaCaducidad,observaciones:c.observacionesPropuestas||item.observaciones,detectadoPorIA:!!c.archivoOrigen,validezIA:c.validezIA||'VERIFICADO',esLegible:c.esLegible!==false,solicitarReintento:c.estadoPropuesto==='incompleto'||c.esLegible===false};});
    const compliance=getSubcontrataCompliance({...subcontrata,checklist:updated});
    const blocking=updated.some(i=>i.obligatorio&&['pendiente','caducado','incompleto'].includes(i.estado));
    onChecklistUpdate(updated,blocking?'condicionado':(compliance.estadoSugerido||'apto'),analysisSummary||`Checklist actualizado con ${confirmed.length} evidencias.`);
    setIsReviewModalOpen(false); onToast(`Se han aplicado ${confirmed.length} cambios confirmados al checklist.`,'success');
  };

  const saveReviewedWorkers=async()=>{
    const selected=workersReview.filter(w=>w.selected).map(({selected,...w})=>({...w,confirmadoPorUsuario:true}));
    if(!selected.length){onToast('Seleccione al menos un trabajador detectado.','error');return;}
    const byKey=new Map<string,SubcontrataTrabajadorCAE>();
    for(const w of [...savedWorkers,...selected]){const key=(w.dni||w.nombreApellidos).toUpperCase().replace(/[^A-Z0-9]/g,'');byKey.set(key,w);}
    try{await updateDocument('subcontratas',subcontrata.id,{trabajadoresCae:Array.from(byKey.values())} as any);setWorkersReview([]);setSelectedFiles([]);onToast(`${selected.length} trabajador(es) incorporados al expediente CAE tras revisión.`,'success');}catch(e:any){onToast(e?.message||'No se pudo guardar el personal CAE.','error');}
  };

  const setLibro=async(value:'registrado'|'no_registrado')=>{
    const checklist=subcontrata.checklist.map(i=>i.id==='libro_subcontratacion'?{...i,estado:(value==='registrado'?'entregado':'pendiente') as SubcontrataDocEstado,fechaEntrega:value==='registrado'?(i.fechaEntrega||new Date().toISOString().slice(0,10)):i.fechaEntrega}:i);
    try{await updateDocument('subcontratas',subcontrata.id,{libroSubcontratacionEstado:value,checklist} as any);const compliance=getSubcontrataCompliance({...subcontrata,checklist});onChecklistUpdate(checklist,compliance.estadoSugerido,`Libro de Subcontratación: ${value==='registrado'?'registrado':'no registrado'}.`);onToast(`Libro de Subcontratación marcado como ${value==='registrado'?'REGISTRADO':'NO REGISTRADO'}.`,'success');}catch(e:any){onToast(e?.message||'No se pudo actualizar el Libro de Subcontratación.','error');}
  };

  const workerRows=useMemo(()=>workersReview,[workersReview]);

  return <div className="space-y-4">
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="p-5 bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 text-white"><div className="flex items-center gap-3"><FileCheck className="w-5 h-5 text-amber-300"/><div><h3 className="font-bold">Comprobación documental CAE V3</h3><p className="text-xs text-blue-100 mt-0.5">Fechas y vigencias legales, documentos y personal de la subcontrata. Todo cambio requiere revisión humana.</p></div></div></div>
      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div className="font-bold text-sm">Libro de Subcontratación</div><div className="text-xs text-slate-500">Seleccione expresamente el estado del libro para esta subcontrata.</div></div><div className="flex gap-2"><button onClick={()=>void setLibro('registrado')} className={`px-3 py-2 rounded-lg text-xs font-bold border ${libroEstado==='registrado'?'bg-emerald-600 text-white border-emerald-600':'border-emerald-300 text-emerald-700'}`}>Registrado</button><button onClick={()=>void setLibro('no_registrado')} className={`px-3 py-2 rounded-lg text-xs font-bold border ${libroEstado==='no_registrado'?'bg-rose-600 text-white border-rose-600':'border-rose-300 text-rose-700'}`}>No registrado</button></div></div>
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs flex gap-2"><Info className="w-4 h-4 shrink-0"/><span>El REA se calcula con vigencia de 3 años desde la fecha de inscripción o renovación cuando el documento no imprime una caducidad. Para otros documentos no se inventa una vigencia: se usa la fecha expresa o la regla configurada.</span></div>
        <div onDragOver={e=>{e.preventDefault();setIsDragging(true)}} onDragLeave={e=>{e.preventDefault();setIsDragging(false)}} onDrop={e=>{e.preventDefault();setIsDragging(false);addFiles(Array.from(e.dataTransfer.files))}} onClick={()=>fileInputRef.current?.click()} className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer ${isDragging?'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40':'border-slate-300 dark:border-slate-700'}`}><input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,application/pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={e=>{if(e.target.files)addFiles(Array.from(e.target.files));e.target.value='';}}/><UploadCloud className="w-8 h-8 mx-auto text-indigo-600 mb-2"/><p className="text-sm font-bold">Arrastre aquí la documentación CAE o pulse para seleccionarla</p></div>
        {!!selectedFiles.length&&<div className="space-y-2">{selectedFiles.map(f=><div key={f.name} className="flex items-center justify-between rounded-lg border p-2 text-xs"><span className="truncate">{f.name}</span><button onClick={e=>{e.stopPropagation();setSelectedFiles(p=>p.filter(x=>x.name!==f.name))}} className="text-rose-600"><Trash2 className="w-4 h-4"/></button></div>)}</div>}
        <button disabled={isAnalyzing||!selectedFiles.length} onClick={()=>void executeAnalysis()} className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#00548E] text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2 justify-center">{isAnalyzing?<RefreshCw className="w-4 h-4 animate-spin"/>:<FileCheck className="w-4 h-4"/>}{isAnalyzing?(analysisProgress||'Analizando…'):'Analizar documentación'}</button>
      </div>
    </div>

    {!!workerRows.length&&<div className="bg-white dark:bg-slate-900 rounded-xl border border-amber-300 dark:border-amber-800 p-5 space-y-4"><div><h3 className="font-black flex items-center gap-2"><Users className="w-5 h-5"/>Personal detectado · revisión obligatoria</h3><p className="text-xs text-slate-500 mt-1">Revise nombre, DNI y puesto. No se guarda nada hasta pulsar “Confirmar personal revisado”.</p></div><div className="space-y-3">{workerRows.map(w=><div key={w.id} className="rounded-xl border p-3"><div className="grid sm:grid-cols-[32px_1fr_170px_180px] gap-2 items-center"><input type="checkbox" checked={w.selected} onChange={e=>setWorkersReview(p=>p.map(x=>x.id===w.id?{...x,selected:e.target.checked}:x))}/><input className="ui-input text-sm" value={w.nombreApellidos} onChange={e=>setWorkersReview(p=>p.map(x=>x.id===w.id?{...x,nombreApellidos:e.target.value}:x))} placeholder="Nombre y apellidos"/><input className="ui-input text-sm" value={w.dni} onChange={e=>setWorkersReview(p=>p.map(x=>x.id===w.id?{...x,dni:e.target.value.toUpperCase()}:x))} placeholder="DNI/NIE"/><input className="ui-input text-sm" value={w.puestoTrabajo} onChange={e=>setWorkersReview(p=>p.map(x=>x.id===w.id?{...x,puestoTrabajo:e.target.value}:x))} placeholder="Puesto de trabajo"/></div><div className={`mt-2 text-xs font-bold ${w.estadoAcceso==='autorizado'?'text-emerald-700':'text-rose-700'}`}>{w.estadoAcceso==='autorizado'?'AUTORIZADO PARA ENTRAR A OBRA':'NO AUTORIZADO PARA ENTRAR A OBRA'}</div>{w.motivosNoAutorizado.length>0&&<div className="mt-1 text-xs text-rose-600">{w.motivosNoAutorizado.join(' · ')}</div>}</div>)}</div><button onClick={()=>void saveReviewedWorkers()} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm inline-flex gap-2 items-center"><CheckCircle2 className="w-4 h-4"/>Confirmar personal revisado</button></div>}

    {!!savedWorkers.length&&<div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5"><h3 className="font-black mb-3">Control de acceso · personal de la subcontrata</h3><div className="grid lg:grid-cols-2 gap-4"><div><div className="text-xs font-black text-emerald-700 uppercase mb-2">Autorizados ({authorized.length})</div>{authorized.length?authorized.map(w=><div key={w.id} className="rounded-lg border border-emerald-200 p-2 mb-2 text-xs"><b>{w.nombreApellidos}</b> · {w.dni||'DNI pendiente'} · {w.puestoTrabajo||'Puesto pendiente'}</div>):<div className="text-xs text-slate-500">Ninguno.</div>}</div><div><div className="text-xs font-black text-rose-700 uppercase mb-2">No autorizados ({denied.length})</div>{denied.length?denied.map(w=><div key={w.id} className="rounded-lg border border-rose-200 p-2 mb-2 text-xs"><b>{w.nombreApellidos}</b> · {w.dni||'DNI pendiente'} · {w.puestoTrabajo||'Puesto pendiente'}<div className="text-rose-600 mt-1">{w.motivosNoAutorizado.join(' · ')||'Documentación pendiente de validar.'}</div></div>):<div className="text-xs text-slate-500">Ninguno.</div>}</div></div></div>}

    {isReviewModalOpen&&<ChecklistReviewModal isOpen={isReviewModalOpen} onClose={()=>setIsReviewModalOpen(false)} changes={proposedChanges} summary={analysisSummary} onConfirm={applyChecklist}/>} 
  </div>;
};
