import React, { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Upload, Users, CheckCircle2, FileText, CalendarRange, Plus, Trash2, Download, Loader2, AlertTriangle, ChevronRight, UserCheck, Link2 } from 'lucide-react';
import jsPDF from 'jspdf';
import { parseSaeNeedFile, parseSaeReportFile, fileToDataUrl, titleCaseSpanish } from '../src/lib/saeDocumentParser';
import { createDocument } from '../src/services/databaseService';
import {
  SAE_RESULT_CODES,
  SaeCandidate,
  SaeNeed,
  SaeReport,
  createSaeNeed,
  createSaeReport,
  listSaeCandidates,
  listSaeNeeds,
  listSaeReports,
  updateSaeCandidate,
} from '../src/services/saeService';

interface SaeSectionProps {
  people: any[];
  onToast: (message: string, type: 'success' | 'error') => void;
}

type NeedForm = { obra: string; codigoObra: string; mes: string; ano: string; categorias: { categoria: string; cantidad: number }[] };

const emptyNeed: NeedForm = { obra: '', codigoObra: '', mes: '', ano: String(new Date().getFullYear()), categorias: [{ categoria: '', cantidad: 1 }] };
const norm = (value: string) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || '';
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export const SaeSection: React.FC<SaeSectionProps> = ({ people, onToast }) => {
  const [needs, setNeeds] = useState<SaeNeed[]>([]);
  const [selectedNeedId, setSelectedNeedId] = useState<string>('');
  const [reports, setReports] = useState<SaeReport[]>([]);
  const [candidates, setCandidates] = useState<SaeCandidate[]>([]);
  const [needForm, setNeedForm] = useState<NeedForm>(emptyNeed);
  const [showNeedForm, setShowNeedForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [activeStep, setActiveStep] = useState(1);

  const selectedNeed = needs.find(n => n.id === selectedNeedId) || null;

  const refresh = async (needId = selectedNeedId) => {
    const nextNeeds = await listSaeNeeds();
    setNeeds(nextNeeds);
    const resolved = needId || nextNeeds[0]?.id || '';
    if (!selectedNeedId && resolved) setSelectedNeedId(resolved);
    if (resolved) {
      const [nextReports, nextCandidates] = await Promise.all([listSaeReports(resolved), listSaeCandidates(resolved)]);
      setReports(nextReports);
      setCandidates(nextCandidates);
    } else {
      setReports([]);
      setCandidates([]);
    }
  };

  useEffect(() => { void refresh().catch(e => onToast(e.message || 'No se pudo cargar SAE.', 'error')); }, []);
  useEffect(() => {
    if (!selectedNeedId) return;
    void Promise.all([listSaeReports(selectedNeedId), listSaeCandidates(selectedNeedId)])
      .then(([r, c]) => { setReports(r); setCandidates(c); })
      .catch(e => onToast(e.message || 'No se pudo cargar la necesidad SAE.', 'error'));
  }, [selectedNeedId]);

  const stats = useMemo(() => {
    const selected = candidates.filter(c => ['Preseleccionado','1ª Quincena','2ª Quincena','Contratado'].includes(c.estado)).length;
    const contracted = candidates.filter(c => c.estado === 'Contratado').length;
    const pending = candidates.filter(c => !c.resultCode).length;
    return { candidates: candidates.length, selected, contracted, pending };
  }, [candidates]);

  const categoryStats = useMemo(() => (selectedNeed?.categorias || []).map(req => {
    const pool = candidates.filter(c => norm(c.categoria).includes(norm(req.categoria)) || norm(req.categoria).includes(norm(c.categoria)));
    const assigned = pool.filter(c => c.quincena || c.estado === 'Contratado').length;
    return { ...req, pool: pool.length, assigned };
  }), [selectedNeed, candidates]);

  const patchCandidate = async (candidate: SaeCandidate, patch: Partial<SaeCandidate>) => {
    const optimistic = { ...candidate, ...patch };
    setCandidates(prev => prev.map(c => c.id === candidate.id ? optimistic : c));
    try { await updateSaeCandidate(candidate.id, patch); }
    catch (e: any) {
      setCandidates(prev => prev.map(c => c.id === candidate.id ? candidate : c));
      onToast(e.message || 'No se pudo actualizar el candidato.', 'error');
    }
  };

  const handleNeedFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setProgress('Analizando necesidad de contratación…');
    try {
      const parsed = await parseSaeNeedFile(file, setProgress);
      setNeedForm({
        obra: parsed.obra, codigoObra: parsed.codigoObra, mes: parsed.mes, ano: parsed.ano ? String(parsed.ano) : String(new Date().getFullYear()),
        categorias: parsed.categorias.length ? parsed.categorias : [{ categoria: '', cantidad: 1 }],
      });
      setShowNeedForm(true);
      onToast('Necesidad analizada. Revise los datos antes de confirmar.', 'success');
    } catch (e: any) { onToast(e.message || 'No se pudo analizar el documento.', 'error'); }
    finally { setBusy(false); setProgress(''); }
  };

  const saveNeed = async () => {
    if (!needForm.obra.trim() || !needForm.mes.trim()) return onToast('Indique obra y mes.', 'error');
    const validCategories = needForm.categorias.filter(c => c.categoria.trim() && c.cantidad > 0);
    if (!validCategories.length) return onToast('Añada al menos una categoría y cantidad.', 'error');
    setBusy(true);
    try {
      const created = await createSaeNeed({
        obra: needForm.obra.trim(), codigoObra: needForm.codigoObra.trim(), mes: needForm.mes.trim(),
        ano: Number(needForm.ano) || null, estado: 'Pendiente de candidatos SAE', categorias: validCategories.map((c, i) => ({ id: `draft_${i}`, ...c })),
      });
      setShowNeedForm(false); setNeedForm(emptyNeed); setSelectedNeedId(created.id); await refresh(created.id); setActiveStep(2);
      onToast('Necesidad SAE creada correctamente.', 'success');
    } catch (e: any) { onToast(e.message || 'No se pudo crear la necesidad.', 'error'); }
    finally { setBusy(false); }
  };

  const handleReportFile = async (file?: File) => {
    if (!file || !selectedNeed) return;
    setBusy(true); setProgress('Leyendo informe SAE…');
    try {
      const parsed = await parseSaeReportFile(file, setProgress);
      if (!parsed.candidates.length) throw new Error('No se han reconocido candidatos. Revise que sea un informe de resultado de selección del SAE.');
      const fileBase64 = await fileToDataUrl(file);
      await createSaeReport(selectedNeed.id, {
        fileName: file.name, fileBase64, extractedText: parsed.sourceText, extractionSource: parsed.source, offerNumber: parsed.offerNumber,
        obra: parsed.obra || selectedNeed.obra, codigoObra: parsed.codigoObra || selectedNeed.codigoObra, mes: parsed.mes || selectedNeed.mes,
        quincena: parsed.quincena, categoria: parsed.categoria,
      }, parsed.candidates.map(c => ({
        orderNumber: c.orderNumber, fullNameOriginal: c.fullNameOriginal, normalizedName: c.normalizedName, apellidos: c.apellidos, nombre: c.nombre,
        categoria: parsed.categoria, obra: parsed.obra || selectedNeed.obra, codigoObra: parsed.codigoObra || selectedNeed.codigoObra,
        offerNumber: parsed.offerNumber, mes: parsed.mes || selectedNeed.mes, quincena: '', estado: 'Sin asignar', resultCode: '', linkedWorkerId: null,
        pageNumber: c.pageNumber, overlayX: c.overlayX, overlayY: c.overlayY, confidence: c.confidence,
      })));
      await refresh(selectedNeed.id); setActiveStep(3);
      onToast(`${parsed.candidates.length} candidatos SAE reconocidos. Revise los datos.`, 'success');
    } catch (e: any) { onToast(e.message || 'No se pudo analizar el informe SAE.', 'error'); }
    finally { setBusy(false); setProgress(''); }
  };

  const prepareWorker = async (candidate: SaeCandidate) => {
    const byName = people.find(p => norm(p.apellidosNombre) === norm(candidate.normalizedName));
    if (byName) {
      await patchCandidate(candidate, { estado: candidate.quincena || 'Preseleccionado', linkedWorkerId: Number(byName.id) });
      onToast('Candidato enlazado con un trabajador existente.', 'success');
      return;
    }
    const workerId = Date.now() + Math.floor(Math.random() * 900000);
    const worker = {
      id: workerId, fechaRegistro: new Date().toISOString(), supervisorResponsable: '', numOferta: candidate.offerNumber,
      obra: candidate.obra || selectedNeed?.obra || '', categoria: candidate.categoria || '', quincena: candidate.quincena || '',
      apellidosNombre: candidate.normalizedName, dni: '', fechaNacimiento: '', periodoInicio: '', periodoFin: '', telefono: '', calzado: '',
      formacion: 'No', lugarFormacion: '', citaDia: '', citaHora: '', sitioReconocimiento: '', documentacionCompleta: 'No',
      observaciones: `Borrador procedente del SAE · Oferta ${candidate.offerNumber} · Orden ${candidate.orderNumber}. Complete los datos antes de confirmar la contratación.`,
      necesitaReconocimiento: 'No', sincronizadoEnNube: true,
    };
    try {
      await createDocument('trabajadores', workerId, worker as any);
      await patchCandidate(candidate, { estado: candidate.quincena || 'Preseleccionado', linkedWorkerId: workerId });
      onToast('Borrador de trabajador creado. Complete sus datos antes de contratar.', 'success');
    } catch (e: any) { onToast(e.message || 'No se pudo preparar el registro.', 'error'); }
  };

  const confirmContract = async (candidate: SaeCandidate) => {
    if (!candidate.linkedWorkerId) return onToast('Primero prepare o enlace el registro del trabajador.', 'error');
    if (!candidate.quincena) return onToast('Asigne primero una quincena.', 'error');
    await patchCandidate(candidate, { estado: 'Contratado', resultCode: '2001' });
    onToast('Contratación confirmada: SAE 2001 · Contratará al candidato.', 'success');
  };

  const generateReturnPdf = async (report: SaeReport) => {
    const rows = candidates.filter(c => c.reportId === report.id);
    if (!rows.length) return onToast('No hay candidatos asociados al informe.', 'error');
    const pending = rows.filter(c => !c.resultCode);
    if (pending.length) return onToast(`Quedan ${pending.length} candidatos sin código SAE.`, 'error');
    if (!report.fileBase64.startsWith('data:application/pdf')) return onToast('La devolución sobre original requiere que el informe de origen sea PDF.', 'error');
    setBusy(true); setProgress('Generando copia del informe SAE cumplimentado…');
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
      const source = await pdfjs.getDocument({ data: dataUrlToBytes(report.fileBase64), useSystemFonts: true }).promise;
      let doc: jsPDF | null = null;
      for (let p = 1; p <= source.numPages; p += 1) {
        const page = await source.getPage(p);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo preparar la vista del PDF.');
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const widthMm = viewport.width * 25.4 / (72 * 2); const heightMm = viewport.height * 25.4 / (72 * 2);
        if (!doc) doc = new jsPDF({ orientation: widthMm > heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [widthMm, heightMm] });
        else doc.addPage([widthMm, heightMm], widthMm > heightMm ? 'landscape' : 'portrait');
        doc.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, widthMm, heightMm);
        const pageRows = rows.filter(c => c.pageNumber === p);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
        pageRows.forEach(c => doc!.text(c.resultCode, c.overlayX, c.overlayY, { baseline: 'middle' }));
      }
      if (!doc) throw new Error('No se pudo generar el PDF.');
      doc.save(`SAE_CUMPLIMENTADO_${report.offerNumber || report.id}.pdf`);
      onToast('Documento SAE cumplimentado generado sobre el original.', 'success');
    } catch (e: any) { onToast(e.message || 'No se pudo generar el documento SAE.', 'error'); }
    finally { setBusy(false); setProgress(''); }
  };

  const stepLabels = ['Necesidad', 'Informes SAE', 'Candidatos', 'Distribución', 'Registros', 'Contratación', 'Devolución'];

  return (
    <div className="space-y-6 min-w-0">
      <div className="ui-surface p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#00548E] dark:text-blue-400 mb-1"><BriefcaseBusiness className="w-5 h-5"/><span className="text-xs font-black uppercase tracking-[0.16em]">Servicio Andaluz de Empleo</span></div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">Gestión SAE</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Necesidad → informes → candidatos → quincenas → registros → contratación → devolución SAE.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
              <Upload className="w-4 h-4"/> Importar necesidad<input type="file" className="hidden" accept=".pdf,image/*" disabled={busy} onChange={e => { void handleNeedFile(e.target.files?.[0]); e.currentTarget.value=''; }}/>
            </label>
            <button onClick={() => setShowNeedForm(v => !v)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white font-bold text-sm"><Plus className="w-4 h-4"/> Nueva necesidad</button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {stepLabels.map((label, i) => <button key={label} onClick={() => setActiveStep(i+1)} className={`rounded-xl px-2 py-2 text-[11px] sm:text-xs font-bold border transition ${activeStep===i+1?'bg-[#00548E] text-white border-[#00548E]':'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'}`}>{i+1}. {label}</button>)}
        </div>
      </div>

      {busy && <div className="ui-surface p-4 flex items-center gap-3 text-sm font-semibold"><Loader2 className="w-4 h-4 animate-spin text-[#00548E]"/>{progress || 'Procesando…'}</div>}

      {showNeedForm && <div className="ui-surface p-5 space-y-4">
        <h2 className="font-black text-lg">Revisión de necesidad de contratación</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input value={needForm.obra} onChange={e=>setNeedForm(f=>({...f,obra:e.target.value}))} placeholder="Obra" className="ui-input"/>
          <input value={needForm.codigoObra} onChange={e=>setNeedForm(f=>({...f,codigoObra:e.target.value}))} placeholder="Código obra" className="ui-input"/>
          <input value={needForm.mes} onChange={e=>setNeedForm(f=>({...f,mes:e.target.value}))} placeholder="Mes" className="ui-input"/>
          <input value={needForm.ano} onChange={e=>setNeedForm(f=>({...f,ano:e.target.value}))} placeholder="Año" className="ui-input"/>
        </div>
        <div className="space-y-2">
          {needForm.categorias.map((c,i)=><div key={i} className="grid grid-cols-[1fr_90px_42px] gap-2">
            <input value={c.categoria} onChange={e=>setNeedForm(f=>({...f,categorias:f.categorias.map((x,j)=>j===i?{...x,categoria:e.target.value}:x)}))} placeholder="Categoría" className="ui-input"/>
            <input type="number" min={1} value={c.cantidad} onChange={e=>setNeedForm(f=>({...f,categorias:f.categorias.map((x,j)=>j===i?{...x,cantidad:Number(e.target.value)||1}:x)}))} className="ui-input"/>
            <button onClick={()=>setNeedForm(f=>({...f,categorias:f.categorias.filter((_,j)=>j!==i)}))} className="rounded-xl border border-red-200 text-red-600"><Trash2 className="w-4 h-4 mx-auto"/></button>
          </div>)}
        </div>
        <div className="flex justify-between gap-3"><button onClick={()=>setNeedForm(f=>({...f,categorias:[...f.categorias,{categoria:'',cantidad:1}]}))} className="text-sm font-bold text-[#00548E]">+ Añadir categoría</button><button onClick={()=>void saveNeed()} disabled={busy} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold">Confirmar necesidad</button></div>
      </div>}

      <div className="grid lg:grid-cols-[320px_1fr] gap-6 min-w-0">
        <aside className="ui-surface p-4 h-fit">
          <h2 className="font-black mb-3">Necesidades activas</h2>
          <div className="space-y-2">
            {needs.map(n=><button key={n.id} onClick={()=>{setSelectedNeedId(n.id);setActiveStep(2)}} className={`w-full text-left rounded-xl border p-3 ${selectedNeedId===n.id?'border-[#00548E] bg-blue-50 dark:bg-blue-950/20':'border-slate-200 dark:border-slate-800'}`}>
              <div className="font-bold text-sm">{n.obra}</div><div className="text-xs text-slate-500 mt-1">{n.mes} {n.ano || ''} · {n.categorias.reduce((s,c)=>s+c.cantidad,0)} trabajadores</div>
            </button>)}
            {!needs.length && <div className="text-sm text-slate-500 p-3">Cree primero una necesidad de contratación.</div>}
          </div>
        </aside>

        <main className="space-y-5 min-w-0">
          {selectedNeed ? <>
            <div className="ui-surface p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div><h2 className="font-black text-xl">{selectedNeed.obra}</h2><p className="text-sm text-slate-500">{selectedNeed.codigoObra && `Obra ${selectedNeed.codigoObra} · `}{selectedNeed.mes} {selectedNeed.ano || ''}</p></div>
                <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm cursor-pointer"><FileText className="w-4 h-4"/> Añadir informe SAE<input type="file" accept=".pdf,image/*" className="hidden" disabled={busy} onChange={e=>{void handleReportFile(e.target.files?.[0]);e.currentTarget.value='';}}/></label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                {[['Candidatos',stats.candidates],['Seleccionados',stats.selected],['Contratados',stats.contracted],['Sin resultado',stats.pending]].map(([l,v])=><div key={String(l)} className="rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3"><div className="text-2xl font-black">{v}</div><div className="text-xs text-slate-500">{l}</div></div>)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">{categoryStats.map(c=><span key={c.id} className="text-xs font-semibold rounded-full border px-3 py-1.5">{c.categoria}: necesarios {c.cantidad} · candidatos {c.pool} · asignados {c.assigned}</span>)}</div>
            </div>

            {!!reports.length && <div className="ui-surface p-5"><h3 className="font-black mb-3">Informes SAE</h3><div className="space-y-2">{reports.map(r=><div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3"><div><div className="font-bold text-sm">{r.fileName}</div><div className="text-xs text-slate-500">Oferta {r.offerNumber || '—'} · {r.quincena || r.mes || 'Periodo no detectado'} · {candidates.filter(c=>c.reportId===r.id).length} candidatos</div></div><button onClick={()=>void generateReturnPdf(r)} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-bold text-xs"><Download className="w-4 h-4"/> Descargar devolución</button></div>)}</div></div>}

            <div className="ui-surface p-4 sm:p-5 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-4"><div><h3 className="font-black text-lg">Candidatos SAE</h3><p className="text-xs text-slate-500">El candidato no se convierte en trabajador hasta preparar/enlazar su registro.</p></div><Users className="w-5 h-5 text-[#00548E]"/></div>
              {!candidates.length ? <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500">Suba un informe SAE para detectar las candidaturas.</div> : <div className="space-y-3">
                {candidates.map(c=><div key={c.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900/40">
                  <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                    <div className="min-w-0 flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="font-black text-sm">{c.orderNumber}. {c.normalizedName || titleCaseSpanish(c.fullNameOriginal)}</span><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${c.confidence==='Alta'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{c.confidence}</span>{c.linkedWorkerId && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold inline-flex items-center gap-1"><Link2 className="w-3 h-3"/> registro</span>}</div><div className="text-xs text-slate-500 mt-1">{c.categoria || 'Categoría pendiente'} · Oferta {c.offerNumber || '—'} · {c.obra}</div></div>
                    <div className="flex flex-wrap gap-2">
                      {['','1ª Quincena','2ª Quincena'].map(q=><button key={q||'none'} onClick={()=>void patchCandidate(c,{quincena:q,estado:q||'Sin asignar'})} className={`px-3 py-2 rounded-lg text-xs font-bold border ${c.quincena===q?'bg-[#00548E] text-white border-[#00548E]':'border-slate-300 dark:border-slate-700'}`}>{q||'Sin asignar'}</button>)}
                    </div>
                  </div>
                  <div className="mt-3 grid md:grid-cols-[1fr_auto] gap-3 items-end">
                    <div className="grid sm:grid-cols-2 gap-2">
                      <input value={c.apellidos} onChange={e=>setCandidates(p=>p.map(x=>x.id===c.id?{...x,apellidos:e.target.value,normalizedName:`${e.target.value} ${x.nombre}`.trim()}:x))} onBlur={()=>void updateSaeCandidate(c.id,{apellidos:c.apellidos,normalizedName:c.normalizedName})} className="ui-input text-sm" placeholder="Apellidos"/>
                      <input value={c.nombre} onChange={e=>setCandidates(p=>p.map(x=>x.id===c.id?{...x,nombre:e.target.value,normalizedName:`${x.apellidos} ${e.target.value}`.trim()}:x))} onBlur={()=>void updateSaeCandidate(c.id,{nombre:c.nombre,normalizedName:c.normalizedName})} className="ui-input text-sm" placeholder="Nombre"/>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!c.linkedWorkerId && <button onClick={()=>void prepareWorker(c)} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold inline-flex items-center gap-1"><UserCheck className="w-4 h-4"/> Preparar registro</button>}
                      {c.linkedWorkerId && c.estado!=='Contratado' && <button onClick={()=>void confirmContract(c)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> Confirmar contratación</button>}
                      <select value={c.resultCode} disabled={c.estado==='Contratado'} onChange={e=>void patchCandidate(c,{resultCode:e.target.value})} className="ui-input text-xs min-w-[220px]"><option value="">Resultado SAE pendiente</option>{SAE_RESULT_CODES.map(([code,label])=><option key={code} value={code}>{code} · {label}</option>)}</select>
                    </div>
                  </div>
                </div>)}
              </div>}
            </div>
          </> : <div className="ui-surface p-10 text-center"><CalendarRange className="w-10 h-10 mx-auto text-slate-400 mb-3"/><h2 className="font-black">Cree una necesidad para comenzar</h2><p className="text-sm text-slate-500 mt-1">El flujo SAE siempre comienza por la necesidad de contratación.</p></div>}
        </main>
      </div>

      <div className="ui-surface p-4 text-xs text-slate-500 flex gap-2 items-start"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"/><span>Los códigos oficiales usados son los del informe SAE: 2001 significa “Contratará al candidato”; 2100 significa “Rechazo voluntario”. Los no contratados requieren selección expresa del motivo.</span></div>
    </div>
  );
};
