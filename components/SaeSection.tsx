import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  Download,
  FileText,
  Link2,
  Loader2,
  Plus,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
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

type NeedForm = {
  obra: string;
  codigoObra: string;
  mes: string;
  ano: string;
  categorias: { categoria: string; cantidad: number }[];
};

const emptyNeed: NeedForm = {
  obra: '',
  codigoObra: '',
  mes: '',
  ano: String(new Date().getFullYear()),
  categorias: [{ categoria: '', cantidad: 1 }],
};

const norm = (value: string) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const dataUrlToBytes = (dataUrl: string) => {
  const raw = atob(dataUrl.split(',')[1] || '');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

const bytesToBlob = (bytes: Uint8Array) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/pdf' });
};

const loadPdfLib = async () => {
  const url = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
  return await import(/* @vite-ignore */ url) as any;
};

export const SaeSection: React.FC<SaeSectionProps> = ({ people, onToast }) => {
  const [needs, setNeeds] = useState<SaeNeed[]>([]);
  const [selectedNeedId, setSelectedNeedId] = useState('');
  const [reports, setReports] = useState<SaeReport[]>([]);
  const [candidates, setCandidates] = useState<SaeCandidate[]>([]);
  const [needForm, setNeedForm] = useState<NeedForm>(emptyNeed);
  const [showNeedForm, setShowNeedForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [activeStep, setActiveStep] = useState(1);
  const [previewReport, setPreviewReport] = useState<SaeReport | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewOffsetX, setPreviewOffsetX] = useState(0);
  const [previewOffsetY, setPreviewOffsetY] = useState(0);

  const selectedNeed = needs.find(n => n.id === selectedNeedId) || null;

  const refresh = async (needId = selectedNeedId) => {
    const nextNeeds = await listSaeNeeds();
    setNeeds(nextNeeds);
    const resolved = needId || nextNeeds[0]?.id || '';
    if (!selectedNeedId && resolved) setSelectedNeedId(resolved);
    if (!resolved) {
      setReports([]);
      setCandidates([]);
      return;
    }
    const [nextReports, nextCandidates] = await Promise.all([
      listSaeReports(resolved),
      listSaeCandidates(resolved),
    ]);
    setReports(nextReports);
    setCandidates(nextCandidates);
  };

  useEffect(() => {
    void refresh().catch(e => onToast(e.message || 'No se pudo cargar SAE.', 'error'));
  }, []);

  useEffect(() => {
    if (!selectedNeedId) return;
    void Promise.all([listSaeReports(selectedNeedId), listSaeCandidates(selectedNeedId)])
      .then(([nextReports, nextCandidates]) => {
        setReports(nextReports);
        setCandidates(nextCandidates);
      })
      .catch(e => onToast(e.message || 'No se pudo cargar la necesidad SAE.', 'error'));
  }, [selectedNeedId]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const stats = useMemo(() => ({
    candidates: candidates.length,
    selected: candidates.filter(c => ['Preseleccionado', '1ª Quincena', '2ª Quincena', 'Contratado'].includes(c.estado)).length,
    contracted: candidates.filter(c => c.estado === 'Contratado').length,
    pending: candidates.filter(c => !c.resultCode).length,
  }), [candidates]);

  const categoryStats = useMemo(() => (selectedNeed?.categorias || []).map(req => {
    const pool = candidates.filter(c => norm(c.categoria).includes(norm(req.categoria)) || norm(req.categoria).includes(norm(c.categoria)));
    return {
      ...req,
      pool: pool.length,
      assigned: pool.filter(c => c.quincena || c.estado === 'Contratado').length,
    };
  }), [selectedNeed, candidates]);

  const patchCandidate = async (candidate: SaeCandidate, patch: Partial<SaeCandidate>) => {
    const optimistic = { ...candidate, ...patch };
    setCandidates(prev => prev.map(c => c.id === candidate.id ? optimistic : c));
    try {
      await updateSaeCandidate(candidate.id, patch);
    } catch (e: any) {
      setCandidates(prev => prev.map(c => c.id === candidate.id ? candidate : c));
      onToast(e.message || 'No se pudo actualizar el candidato.', 'error');
    }
  };

  const handleNeedFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setProgress('Analizando necesidad de contratación…');
    try {
      const parsed = await parseSaeNeedFile(file, setProgress);
      setNeedForm({
        obra: parsed.obra,
        codigoObra: parsed.codigoObra,
        mes: parsed.mes,
        ano: parsed.ano ? String(parsed.ano) : String(new Date().getFullYear()),
        categorias: parsed.categorias.length ? parsed.categorias : [{ categoria: '', cantidad: 1 }],
      });
      setShowNeedForm(true);
      onToast('Necesidad analizada. Revise los datos antes de confirmar.', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo analizar el documento.', 'error');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const saveNeed = async () => {
    if (!needForm.obra.trim() || !needForm.mes.trim()) return onToast('Indique obra y mes.', 'error');
    const validCategories = needForm.categorias.filter(c => c.categoria.trim() && c.cantidad > 0);
    if (!validCategories.length) return onToast('Añada al menos una categoría y cantidad.', 'error');
    setBusy(true);
    try {
      const created = await createSaeNeed({
        obra: needForm.obra.trim(),
        codigoObra: needForm.codigoObra.trim(),
        mes: needForm.mes.trim(),
        ano: Number(needForm.ano) || null,
        estado: 'Pendiente de candidatos SAE',
        categorias: validCategories.map((c, i) => ({ id: `draft_${i}`, ...c })),
      });
      setShowNeedForm(false);
      setNeedForm(emptyNeed);
      setSelectedNeedId(created.id);
      await refresh(created.id);
      setActiveStep(2);
      onToast('Necesidad SAE creada correctamente.', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo crear la necesidad.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReportFile = async (file?: File) => {
    if (!file || !selectedNeed) return;
    setBusy(true);
    setProgress('Leyendo informe SAE…');
    try {
      const parsed = await parseSaeReportFile(file, setProgress);
      if (!parsed.candidates.length) throw new Error('No se han reconocido candidatos. Revise que sea un informe de resultado de selección del SAE.');
      const fileBase64 = await fileToDataUrl(file);
      await createSaeReport(selectedNeed.id, {
        fileName: file.name,
        fileBase64,
        extractedText: parsed.sourceText,
        extractionSource: parsed.source,
        offerNumber: parsed.offerNumber,
        obra: parsed.obra || selectedNeed.obra,
        codigoObra: parsed.codigoObra || selectedNeed.codigoObra,
        mes: parsed.mes || selectedNeed.mes,
        quincena: parsed.quincena,
        categoria: parsed.categoria,
      }, parsed.candidates.map(c => ({
        orderNumber: c.orderNumber,
        fullNameOriginal: c.fullNameOriginal,
        normalizedName: c.normalizedName,
        apellidos: c.apellidos,
        nombre: c.nombre,
        categoria: parsed.categoria,
        obra: parsed.obra || selectedNeed.obra,
        codigoObra: parsed.codigoObra || selectedNeed.codigoObra,
        offerNumber: parsed.offerNumber,
        mes: parsed.mes || selectedNeed.mes,
        quincena: '',
        estado: 'Sin asignar',
        resultCode: '',
        linkedWorkerId: null,
        pageNumber: c.pageNumber,
        overlayX: c.overlayX,
        overlayY: c.overlayY,
        confidence: c.confidence,
      })));
      await refresh(selectedNeed.id);
      setActiveStep(3);
      onToast(`${parsed.candidates.length} candidatos SAE reconocidos. Revise los datos.`, 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo analizar el informe SAE.', 'error');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const registerWorker = async (candidate: SaeCandidate) => {
    if (!candidate.quincena) return onToast('Asigne primero una quincena.', 'error');
    const previous = people.find(p => norm(p.apellidosNombre) === norm(candidate.normalizedName));
    const workerId = Date.now() + Math.floor(Math.random() * 900000);
    const worker = {
      id: workerId,
      fechaRegistro: new Date().toISOString(),
      supervisorResponsable: previous?.supervisorResponsable || '',
      numOferta: candidate.offerNumber,
      obra: candidate.obra || selectedNeed?.obra || '',
      categoria: candidate.categoria || '',
      quincena: candidate.quincena,
      apellidosNombre: candidate.normalizedName,
      dni: previous?.dni || '',
      fechaNacimiento: previous?.fechaNacimiento || '',
      periodoInicio: '',
      periodoFin: '',
      telefono: previous?.telefono || '',
      calzado: previous?.calzado || '',
      formacion: previous?.formacion || 'No',
      lugarFormacion: previous?.lugarFormacion || '',
      citaDia: '',
      citaHora: '',
      sitioReconocimiento: '',
      documentacionCompleta: 'No',
      observaciones: `Contratación SAE · Oferta ${candidate.offerNumber} · Orden ${candidate.orderNumber}.`,
      necesitaReconocimiento: previous?.necesitaReconocimiento || 'No',
      sincronizadoEnNube: true,
    };
    try {
      await createDocument('trabajadores', workerId, worker as any);
      await patchCandidate(candidate, {
        estado: 'Contratado',
        resultCode: '2001',
        linkedWorkerId: workerId,
      });
      onToast('Trabajador registrado y contratación SAE confirmada automáticamente (2001).', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo registrar al trabajador.', 'error');
    }
  };

  const buildReturnPdfBytes = async (
    report: SaeReport,
    offsetX = 0,
    offsetY = 0,
    requireComplete = true,
  ): Promise<Uint8Array> => {
    const rows = candidates.filter(c => c.reportId === report.id);
    if (!rows.length) throw new Error('No hay candidatos asociados al informe.');
    if (requireComplete) {
      const pending = rows.filter(c => !c.resultCode);
      if (pending.length) throw new Error(`Quedan ${pending.length} candidatos sin código SAE.`);
    }
    if (!report.fileBase64.startsWith('data:application/pdf')) {
      throw new Error('La devolución sobre original requiere que el informe de origen sea PDF.');
    }

    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const pdf = await PDFDocument.load(dataUrlToBytes(report.fileBase64));
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pages = pdf.getPages();

    for (const candidate of rows) {
      const page = pages[Math.max(0, candidate.pageNumber - 1)];
      if (!page) continue;
      const code = candidate.resultCode || (requireComplete ? '' : '2001');
      if (!code) continue;
      const x = (candidate.overlayX + offsetX) * 72 / 25.4;
      const y = page.getHeight() - ((candidate.overlayY + offsetY) * 72 / 25.4) - 8;
      page.drawText(code, { x, y, size: 10, font, color: rgb(0, 0, 0) });
    }
    return await pdf.save();
  };

  const generateReturnPdf = async (report: SaeReport) => {
    setBusy(true);
    setProgress('Generando PDF SAE sobre el original…');
    try {
      const bytes = await buildReturnPdfBytes(report, 0, 0, true);
      const url = URL.createObjectURL(bytesToBlob(bytes));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `SAE_CUMPLIMENTADO_${report.offerNumber || report.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast('Documento SAE generado conservando el PDF original y añadiendo únicamente los códigos.', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo generar el documento SAE.', 'error');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const refreshPreview = async (report: SaeReport, offsetX: number, offsetY: number) => {
    const bytes = await buildReturnPdfBytes(report, offsetX, offsetY, false);
    const nextUrl = URL.createObjectURL(bytesToBlob(bytes));
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });
  };

  const openPreview = async (report: SaeReport) => {
    setPreviewReport(report);
    setPreviewOffsetX(0);
    setPreviewOffsetY(0);
    try {
      await refreshPreview(report, 0, 0);
    } catch (e: any) {
      setPreviewReport(null);
      onToast(e.message || 'No se pudo abrir la vista previa.', 'error');
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewReport(null);
    setPreviewOffsetX(0);
    setPreviewOffsetY(0);
  };

  const applyPreviewOffset = async () => {
    if (!previewReport) return;
    const rows = candidates.filter(c => c.reportId === previewReport.id);
    try {
      await Promise.all(rows.map(c => updateSaeCandidate(c.id, {
        overlayX: c.overlayX + previewOffsetX,
        overlayY: c.overlayY + previewOffsetY,
      })));
      setCandidates(prev => prev.map(c => c.reportId === previewReport.id ? {
        ...c,
        overlayX: c.overlayX + previewOffsetX,
        overlayY: c.overlayY + previewOffsetY,
      } : c));
      setPreviewOffsetX(0);
      setPreviewOffsetY(0);
      await refreshPreview(previewReport, 0, 0);
      onToast('Posición de los códigos guardada para este informe SAE.', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo guardar el ajuste.', 'error');
    }
  };

  const stepLabels = ['Necesidad', 'Informes SAE', 'Candidatos', 'Distribución', 'Registros', 'Contratación', 'Devolución'];

  return (
    <div className="space-y-6 min-w-0">
      <div className="ui-surface p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#00548E] dark:text-blue-400 mb-1">
              <BriefcaseBusiness className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-[0.16em]">Servicio Andaluz de Empleo</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">Gestión SAE</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Necesidad → informes → candidatos → quincenas → registros → contratación → devolución SAE.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
              <FileText className="w-4 h-4" /> Importar necesidad
              <input type="file" className="hidden" accept=".pdf,image/*" disabled={busy} onChange={e => { void handleNeedFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </label>
            <button onClick={() => setShowNeedForm(v => !v)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white font-bold text-sm">
              <Plus className="w-4 h-4" /> Nueva necesidad
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {stepLabels.map((label, i) => (
            <button key={label} onClick={() => setActiveStep(i + 1)} className={`rounded-xl px-2 py-2 text-[11px] sm:text-xs font-bold border transition ${activeStep === i + 1 ? 'bg-[#00548E] text-white border-[#00548E]' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'}`}>
              {i + 1}. {label}
            </button>
          ))}
        </div>
      </div>

      {busy && (
        <div className="ui-surface p-4 flex items-center gap-3 text-sm font-semibold">
          <Loader2 className="w-4 h-4 animate-spin text-[#00548E]" /> {progress || 'Procesando…'}
        </div>
      )}

      {showNeedForm && (
        <div className="ui-surface p-5 space-y-4">
          <h2 className="font-black text-lg">Revisión de necesidad de contratación</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input value={needForm.obra} onChange={e => setNeedForm(f => ({ ...f, obra: e.target.value }))} placeholder="Obra" className="ui-input" />
            <input value={needForm.codigoObra} onChange={e => setNeedForm(f => ({ ...f, codigoObra: e.target.value }))} placeholder="Código obra" className="ui-input" />
            <input value={needForm.mes} onChange={e => setNeedForm(f => ({ ...f, mes: e.target.value }))} placeholder="Mes" className="ui-input" />
            <input value={needForm.ano} onChange={e => setNeedForm(f => ({ ...f, ano: e.target.value }))} placeholder="Año" className="ui-input" />
          </div>
          <div className="space-y-2">
            {needForm.categorias.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_42px] gap-2">
                <input value={c.categoria} onChange={e => setNeedForm(f => ({ ...f, categorias: f.categorias.map((x, j) => j === i ? { ...x, categoria: e.target.value } : x) }))} placeholder="Categoría" className="ui-input" />
                <input type="number" min={1} value={c.cantidad} onChange={e => setNeedForm(f => ({ ...f, categorias: f.categorias.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value) || 1 } : x) }))} className="ui-input" />
                <button onClick={() => setNeedForm(f => ({ ...f, categorias: f.categorias.filter((_, j) => j !== i) }))} className="rounded-xl border border-red-200 text-red-600"><Trash2 className="w-4 h-4 mx-auto" /></button>
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-3">
            <button onClick={() => setNeedForm(f => ({ ...f, categorias: [...f.categorias, { categoria: '', cantidad: 1 }] }))} className="text-sm font-bold text-[#00548E]">+ Añadir categoría</button>
            <button onClick={() => void saveNeed()} disabled={busy} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold">Confirmar necesidad</button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[320px_1fr] gap-6 min-w-0">
        <aside className="ui-surface p-4 h-fit">
          <h2 className="font-black mb-3">Necesidades activas</h2>
          <div className="space-y-2">
            {needs.map(n => (
              <button key={n.id} onClick={() => { setSelectedNeedId(n.id); setActiveStep(2); }} className={`w-full text-left rounded-xl border p-3 ${selectedNeedId === n.id ? 'border-[#00548E] bg-blue-50 dark:bg-blue-950/20' : 'border-slate-200 dark:border-slate-800'}`}>
                <div className="font-bold text-sm">{n.obra}</div>
                <div className="text-xs text-slate-500 mt-1">{n.mes} {n.ano || ''} · {n.categorias.reduce((s, c) => s + c.cantidad, 0)} trabajadores</div>
              </button>
            ))}
            {!needs.length && <div className="text-sm text-slate-500 p-3">Cree primero una necesidad de contratación.</div>}
          </div>
        </aside>

        <main className="space-y-5 min-w-0">
          {selectedNeed ? (
            <>
              <div className="ui-surface p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="font-black text-xl">{selectedNeed.obra}</h2>
                    <p className="text-sm text-slate-500">{selectedNeed.codigoObra && `Obra ${selectedNeed.codigoObra} · `}{selectedNeed.mes} {selectedNeed.ano || ''}</p>
                  </div>
                  <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm cursor-pointer">
                    <FileText className="w-4 h-4" /> Añadir informe SAE
                    <input type="file" accept=".pdf,image/*" className="hidden" disabled={busy} onChange={e => { void handleReportFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  {[['Candidatos', stats.candidates], ['Seleccionados', stats.selected], ['Contratados', stats.contracted], ['Sin resultado', stats.pending]].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
                      <div className="text-2xl font-black">{value}</div>
                      <div className="text-xs text-slate-500">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {categoryStats.map(c => <span key={c.id} className="text-xs font-semibold rounded-full border px-3 py-1.5">{c.categoria}: necesarios {c.cantidad} · candidatos {c.pool} · asignados {c.assigned}</span>)}
                </div>
              </div>

              {!!reports.length && (
                <div className="ui-surface p-5">
                  <h3 className="font-black mb-3">Informes SAE</h3>
                  <div className="space-y-2">
                    {reports.map(report => (
                      <div key={report.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
                        <div>
                          <div className="font-bold text-sm">{report.fileName}</div>
                          <div className="text-xs text-slate-500">Oferta {report.offerNumber || '—'} · {report.quincena || report.mes || 'Periodo no detectado'} · {candidates.filter(c => c.reportId === report.id).length} candidatos</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => void openPreview(report)} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-bold text-xs"><FileText className="w-4 h-4" /> Vista previa / ajustar</button>
                          <button onClick={() => void generateReturnPdf(report)} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-bold text-xs"><Download className="w-4 h-4" /> Descargar devolución</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="ui-surface p-4 sm:p-5 min-w-0">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="font-black text-lg">Candidatos SAE</h3>
                    <p className="text-xs text-slate-500">Al guardar al candidato como nuevo trabajador se considera contratado y se asigna automáticamente SAE 2001.</p>
                  </div>
                  <Users className="w-5 h-5 text-[#00548E]" />
                </div>
                {!candidates.length ? (
                  <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500">Suba un informe SAE para detectar las candidaturas.</div>
                ) : (
                  <div className="space-y-3">
                    {candidates.map(candidate => (
                      <div key={candidate.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900/40">
                        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-sm">{candidate.orderNumber}. {candidate.normalizedName || titleCaseSpanish(candidate.fullNameOriginal)}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${candidate.confidence === 'Alta' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{candidate.confidence}</span>
                              {candidate.linkedWorkerId && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> registro</span>}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">{candidate.categoria || 'Categoría pendiente'} · Oferta {candidate.offerNumber || '—'} · {candidate.obra}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {['', '1ª Quincena', '2ª Quincena'].map(q => (
                              <button key={q || 'none'} disabled={candidate.estado === 'Contratado'} onClick={() => void patchCandidate(candidate, { quincena: q, estado: q || 'Sin asignar' })} className={`px-3 py-2 rounded-lg text-xs font-bold border disabled:opacity-50 ${candidate.quincena === q ? 'bg-[#00548E] text-white border-[#00548E]' : 'border-slate-300 dark:border-slate-700'}`}>{q || 'Sin asignar'}</button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3 grid md:grid-cols-[1fr_auto] gap-3 items-end">
                          <div className="grid sm:grid-cols-2 gap-2">
                            <input value={candidate.apellidos} disabled={candidate.estado === 'Contratado'} onChange={e => setCandidates(prev => prev.map(x => x.id === candidate.id ? { ...x, apellidos: e.target.value, normalizedName: `${e.target.value} ${x.nombre}`.trim() } : x))} onBlur={() => void updateSaeCandidate(candidate.id, { apellidos: candidate.apellidos, normalizedName: candidate.normalizedName })} className="ui-input text-sm" placeholder="Apellidos" />
                            <input value={candidate.nombre} disabled={candidate.estado === 'Contratado'} onChange={e => setCandidates(prev => prev.map(x => x.id === candidate.id ? { ...x, nombre: e.target.value, normalizedName: `${x.apellidos} ${e.target.value}`.trim() } : x))} onBlur={() => void updateSaeCandidate(candidate.id, { nombre: candidate.nombre, normalizedName: candidate.normalizedName })} className="ui-input text-sm" placeholder="Nombre" />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {candidate.estado !== 'Contratado' ? (
                              <button onClick={() => void registerWorker(candidate)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1"><UserCheck className="w-4 h-4" /> Registrar nuevo trabajador</button>
                            ) : (
                              <span className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Contratado · SAE 2001</span>
                            )}
                            <select value={candidate.resultCode} disabled={candidate.estado === 'Contratado'} onChange={e => void patchCandidate(candidate, { resultCode: e.target.value })} className="ui-input text-xs min-w-[220px]">
                              <option value="">Resultado SAE pendiente</option>
                              {SAE_RESULT_CODES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="ui-surface p-10 text-center">
              <CalendarRange className="w-10 h-10 mx-auto text-slate-400 mb-3" />
              <h2 className="font-black">Cree una necesidad para comenzar</h2>
              <p className="text-sm text-slate-500 mt-1">El flujo SAE siempre comienza por la necesidad de contratación.</p>
            </div>
          )}
        </main>
      </div>

      <div className="ui-surface p-4 text-xs text-slate-500 flex gap-2 items-start">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <span>Los códigos oficiales usados son los del informe SAE: 2001 significa “Contratará al candidato”; 2100 significa “Rechazo voluntario”. Los no contratados requieren selección expresa del motivo.</span>
      </div>

      {previewReport && (
        <div className="fixed inset-0 z-[180] bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) closePreview(); }}>
          <div className="w-full max-w-6xl h-[92vh] bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="font-black">Vista previa SAE · {previewReport.fileName}</div>
                <div className="text-xs text-slate-500">Los candidatos sin resultado se muestran con 2001 solo como referencia visual. X/Y desplazan todos los códigos del informe en milímetros.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold">X
                  <input type="number" step="0.5" value={previewOffsetX} onChange={e => { const value = Number(e.target.value) || 0; setPreviewOffsetX(value); void refreshPreview(previewReport, value, previewOffsetY); }} className="ui-input !w-20 !py-1.5 ml-1" />
                </label>
                <label className="text-xs font-bold">Y
                  <input type="number" step="0.5" value={previewOffsetY} onChange={e => { const value = Number(e.target.value) || 0; setPreviewOffsetY(value); void refreshPreview(previewReport, previewOffsetX, value); }} className="ui-input !w-20 !py-1.5 ml-1" />
                </label>
                <button onClick={() => void applyPreviewOffset()} className="px-3 py-2 rounded-lg bg-[#00548E] text-white text-xs font-bold">Guardar posición</button>
                <button onClick={closePreview} className="px-3 py-2 rounded-lg border text-xs font-bold">Cerrar</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900">
              {previewUrl ? <iframe title="Vista previa documento SAE" src={previewUrl} className="w-full h-full border-0" /> : <div className="h-full grid place-items-center text-sm text-slate-500">Preparando vista previa…</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
