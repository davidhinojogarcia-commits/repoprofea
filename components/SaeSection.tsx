import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, BriefcaseBusiness, Check, CheckCircle2, ChevronRight,
  ClipboardCheck, Download, FileCheck2, FileSearch, FileUp, GripVertical, Loader2,
  Pencil, Plus, Settings2, Upload, UserCheck, Users, X,
} from 'lucide-react';
import type { Person } from '../types';
import { useAuthShell } from './AuthGate';
import {
  detectSaeLegend, extractSaeDocument, generateCompletedSaePdf, normalizePersonName,
  normalizeSearchText, parseCandidateRows, parseNeedExtraction,
} from '../src/features/sae/saeDocumentEngine';
import {
  assignSaeCandidate, downloadSaeFile, listSaeCandidates, listSaeDrafts, listSaeNeeds, listSaeReports,
  listSaeResultCodes, recordGeneratedDocument, saveSaeDraft, saveSaeNeed, saveSaeReport,
  saveSaeResultCode, updateSaeCandidate, updateSaeNeedStatus,
} from '../src/features/sae/saeService';
import type { SaeCandidate, SaeDraft, SaeNeed, SaeNeedCategory, SaeReport } from '../src/features/sae/types';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const PHASES = ['Necesidad','Informes SAE','Candidatos','Distribución','Nuevos registros','Contratación','Devolución SAE'] as const;
type Phase = typeof PHASES[number];
type Toast = (message: string, type: 'success' | 'error') => void;

interface SaeSectionProps {
  people: Person[];
  savedObras: string[];
  savedCategorias: string[];
  onRegister: (person: Omit<Person, 'id' | 'fechaRegistro'>) => Promise<boolean | void> | boolean | void;
  onToast: Toast;
}

const emptyNeed = (): SaeNeed => ({
  id: crypto.randomUUID(), workName: '', workCode: '', month: new Date().getMonth() + 1,
  year: new Date().getFullYear(), totalRequested: 0, status: 'pendiente_candidatos_sae',
  categories: [{ category: '', requestedCount: 1 }], extractionEvidence: [],
});

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => (
  <div className="profea-modal-overlay fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-3 sm:p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
    <section className={`flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[calc(100dvh-3rem)] ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6">
        <h2 className="min-w-0 text-lg font-black text-slate-900 dark:text-white">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20}/></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
    </section>
  </div>
);

const Field: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, className = '', ...props }) => (
  <label className="block min-w-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
    <span className="mb-1.5 block">{label}</span>
    <input {...props} className={`w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white ${className}`}/>
  </label>
);

const StatusPill = ({ value }: { value: string }) => {
  const label = value.replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());
  const warning = value.includes('pendiente') || value === 'sin_asignar';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${warning ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'}`}>{label}</span>;
};

const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const inferMimeType = (file: File) => {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
};

const candidateWorkerMatch = (candidate: SaeCandidate, people: Person[]) => {
  const dni = (candidate.dniNie || '').replace(/[\s-]/g, '').toUpperCase();
  const name = normalizeSearchText(candidate.normalizedFullName);
  return people.find(person => {
    const personDni = (person.dni || '').replace(/[\s-]/g, '').toUpperCase();
    return Boolean((dni && personDni === dni) || (name && normalizeSearchText(person.apellidosNombre) === name));
  });
};

export const SaeSection: React.FC<SaeSectionProps> = ({ people, savedObras, savedCategorias, onRegister, onToast }) => {
  const { role } = useAuthShell();
  const [needs, setNeeds] = useState<SaeNeed[]>([]);
  const [selectedNeed, setSelectedNeed] = useState<SaeNeed | null>(null);
  const [phase, setPhase] = useState<Phase>('Necesidad');
  const [reports, setReports] = useState<SaeReport[]>([]);
  const [candidates, setCandidates] = useState<SaeCandidate[]>([]);
  const [drafts, setDrafts] = useState<SaeDraft[]>([]);
  const [resultCodes, setResultCodes] = useState<Record<string, string>>({ contratado: '2100' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [needEditor, setNeedEditor] = useState<SaeNeed | null>(null);
  const [needFile, setNeedFile] = useState<File | undefined>();
  const [pendingReports, setPendingReports] = useState<Array<{ report: SaeReport; file: File; candidates: SaeCandidate[] }>>([]);
  const [editingCandidate, setEditingCandidate] = useState<SaeCandidate | null>(null);
  const [preview, setPreview] = useState<{ url: string; report: SaeReport } | null>(null);
  const [codesOpen, setCodesOpen] = useState(false);

  const loadNeeds = useCallback(async () => {
    setBusy(true); setError('');
    try { setNeeds(await listSaeNeeds()); }
    catch (cause: any) { setError(cause?.message || 'No se pudieron cargar las necesidades SAE.'); }
    finally { setBusy(false); }
  }, []);

  const loadNeedDetail = useCallback(async (need: SaeNeed) => {
    setBusy(true); setError('');
    try {
      const [loadedReports, loadedCandidates, loadedDrafts, loadedCodes] = await Promise.all([
        listSaeReports(need.id), listSaeCandidates(need.id), listSaeDrafts(need.id), listSaeResultCodes(),
      ]);
      setReports(loadedReports); setCandidates(loadedCandidates); setDrafts(loadedDrafts); setResultCodes(loadedCodes);
    } catch (cause: any) { setError(cause?.message || 'No se pudo cargar el expediente SAE.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadNeeds(); }, [loadNeeds]);
  useEffect(() => { if (selectedNeed) void loadNeedDetail(selectedNeed); }, [selectedNeed, loadNeedDetail]);

  const categorySummary = useMemo(() => (selectedNeed?.categories || []).map(item => {
    const related = candidates.filter(candidate => normalizeSearchText(candidate.category) === normalizeSearchText(item.category));
    const selected = related.filter(candidate => candidate.selectedForHire).length;
    const hired = related.filter(candidate => candidate.status === 'contratado').length;
    return { ...item, candidates: related.length, selected, hired, pending: Math.max(item.requestedCount - hired, 0), over: selected > item.requestedCount };
  }), [selectedNeed, candidates]);
  const duplicateCandidateIds = useMemo(() => {
    const groups = new Map<string, string[]>();
    candidates.forEach(candidate => {
      const identity = candidate.dniNie?.replace(/[\s-]/g, '').toUpperCase() || normalizeSearchText(candidate.normalizedFullName);
      if (!identity) return;
      groups.set(identity, [...(groups.get(identity) || []), candidate.id]);
    });
    return new Set(Array.from(groups.values()).filter(ids => ids.length > 1).flat());
  }, [candidates]);

  const saveNeed = async () => {
    if (!needEditor?.workName.trim() || !needEditor.categories.length || needEditor.categories.some(item => !item.category.trim() || item.requestedCount < 1)) {
      setError('Revisa la obra y todas las categorías antes de confirmar.'); return;
    }
    setBusy(true); setError('');
    try {
      const saved = await saveSaeNeed({ ...needEditor, totalRequested: needEditor.categories.reduce((sum, item) => sum + Number(item.requestedCount), 0) }, needFile);
      setNeedEditor(null); setNeedFile(undefined); await loadNeeds(); setSelectedNeed(saved); onToast('Necesidad SAE creada correctamente.', 'success');
    } catch (cause: any) { setError(cause?.message || 'No se pudo guardar la necesidad.'); }
    finally { setBusy(false); }
  };

  const analyzeNeedFile = async (file: File) => {
    setBusy(true); setProgress('Analizando documento…'); setError('');
    try {
      const extraction = await extractSaeDocument(file, setProgress);
      const parsed = parseNeedExtraction(extraction);
      setNeedFile(file);
      setNeedEditor({ ...emptyNeed(), ...parsed, categories: parsed.categories.length ? parsed.categories : [{ category: '', requestedCount: 1 }] } as SaeNeed);
    } catch (cause: any) { setError(cause?.message || 'No se pudo analizar el documento.'); }
    finally { setBusy(false); setProgress(''); }
  };

  const analyzeReports = async (files: FileList | File[]) => {
    if (!selectedNeed) return;
    setBusy(true); setError('');
    try {
      const pending: Array<{ report: SaeReport; file: File; candidates: SaeCandidate[] }> = [];
      for (const file of Array.from(files)) {
        setProgress(`Procesando ${file.name}…`);
        const extraction = await extractSaeDocument(file, setProgress);
        const reportId = crypto.randomUUID();
        const detected = parseCandidateRows(extraction, selectedNeed, reportId);
        pending.push({
          file,
          report: { id: reportId, needId: selectedNeed.id, fileName: file.name, mimeType: inferMimeType(file), storagePath: '', pageCount: extraction.pageCount, extractionMethod: extraction.method, processingStatus: 'review', rawText: extraction.fullText, detectedLegend: detectSaeLegend(extraction.fullText) },
          candidates: detected,
        });
      }
      setPendingReports(pending);
    } catch (cause: any) { setError(cause?.message || 'No se pudo analizar el informe SAE.'); }
    finally { setBusy(false); setProgress(''); }
  };

  const confirmReports = async () => {
    if (!selectedNeed) return;
    const invalid = pendingReports.flatMap(item => item.candidates).some(candidate => !candidate.originalFullName.trim() || !candidate.category.trim());
    if (invalid) { setError('Hay candidatos sin nombre o categoría. Corrige los campos señalados antes de confirmar.'); return; }
    setBusy(true); setError('');
    try {
      for (const item of pendingReports) await saveSaeReport({ ...item.report, processingStatus: 'confirmed' }, item.file, item.candidates);
      setPendingReports([]); await loadNeedDetail(selectedNeed); await loadNeeds(); onToast('Informes SAE y candidatos guardados.', 'success');
    } catch (cause: any) { setError(cause?.message || 'No se pudieron guardar los informes.'); }
    finally { setBusy(false); }
  };

  const addManualCandidate = (reportIndex: number) => {
    if (!selectedNeed) return;
    setPendingReports(current => current.map((entry, index) => index !== reportIndex ? entry : {
      ...entry,
      candidates: [...entry.candidates, {
        id: crypto.randomUUID(), needId: selectedNeed.id, sourceReportId: entry.report.id,
        originalFullName: '', normalizedFullName: '', category: '', workName: selectedNeed.workName,
        workCode: selectedNeed.workCode, month: selectedNeed.month, sourcePage: 1,
        sourceRowText: 'Fila añadida manualmente durante la revisión',
        sourcePosition: { page: 1, rowIndex: entry.candidates.length, x: 20, y: 20 + entry.candidates.length * 12, width: 400, height: 10, pageWidth: 595, pageHeight: 842, resultX: 520 },
        confidence: 'baja', evidence: [], status: 'pendiente_datos', selectedForHire: false,
      }],
    }));
  };

  const patchCandidate = async (candidate: SaeCandidate, patch: Partial<SaeCandidate>, toast?: string) => {
    const next = { ...candidate, ...patch };
    setCandidates(items => items.map(item => item.id === next.id ? next : item));
    try { await updateSaeCandidate(next); if (toast) onToast(toast, 'success'); }
    catch (cause: any) { onToast(cause?.message || 'No se pudo actualizar el candidato.', 'error'); await selectedNeed && loadNeedDetail(selectedNeed); }
  };

  const allocate = async (candidate: SaeCandidate, fortnight: 1 | 2 | null) => {
    const next = { ...candidate, fortnight, status: fortnight === 1 ? 'primera_quincena' as const : fortnight === 2 ? 'segunda_quincena' as const : 'sin_asignar' as const };
    setCandidates(items => items.map(item => item.id === next.id ? next : item));
    try { await assignSaeCandidate(next, selectedNeed?.year || new Date().getFullYear()); }
    catch (cause: any) { onToast(cause?.message || 'No se pudo guardar la asignación.', 'error'); if (selectedNeed) await loadNeedDetail(selectedNeed); return; }
    if (selectedNeed?.status === 'candidatos_recibidos') {
      await updateSaeNeedStatus(selectedNeed.id, 'en_distribucion');
      setSelectedNeed({ ...selectedNeed, status: 'en_distribucion' });
    }
  };

  const makeDraft = async (candidate: SaeCandidate) => {
    if (!selectedNeed || !candidate.fortnight || !candidate.category || !candidate.workName) {
      onToast('Define categoría, obra y quincena antes de preparar la contratación.', 'error'); return;
    }
    const existing = candidateWorkerMatch(candidate, people);
    const current = drafts.find(draft => draft.candidateId === candidate.id);
    const draft: SaeDraft = {
      id: current?.id || crypto.randomUUID(), needId: selectedNeed.id, candidateId: candidate.id,
      existingWorkerId: existing?.id || current?.existingWorkerId || null,
      existingWorkerOwnerId: existing?.ownerId || current?.existingWorkerOwnerId || null,
      status: existing ? 'enlazado' : 'borrador_sae',
      data: {
        supervisorResponsable: '', numOferta: candidate.offerNumber || '', obra: candidate.workName || selectedNeed.workName,
        categoria: candidate.category, quincena: `${candidate.fortnight === 1 ? '1ª' : '2ª'} ${MONTHS[selectedNeed.month - 1]} ${selectedNeed.year}`,
        periodoInicio: candidate.expectedHireDate || '', periodoFin: '', apellidosNombre: candidate.normalizedFullName,
        dni: candidate.dniNie || '', fechaNacimiento: '', telefono: '', calzado: '', formacion: '', lugarFormacion: '',
        citaDia: '', citaHora: '', sitioReconocimiento: '', documentacionCompleta: '', observaciones: `Borrador procedente del SAE · Oferta ${candidate.offerNumber || 'sin número'}`,
        necesitaReconocimiento: 'Sí',
        ...(current?.data || {}),
      },
    };
    await saveSaeDraft(draft);
    setDrafts(items => [...items.filter(item => item.candidateId !== candidate.id), draft]);
    await patchCandidate(candidate, { selectedForHire: true, existingWorkerId: existing?.id || null, existingWorkerOwnerId: existing?.ownerId || null, status: 'preseleccionado' }, 'Borrador SAE preparado.');
  };

  const updateDraft = (draft: SaeDraft, field: string, value: string) => {
    const next = { ...draft, data: { ...draft.data, [field]: value } };
    setDrafts(items => items.map(item => item.id === next.id ? next : item));
  };

  const persistDraft = async (draft: SaeDraft) => {
    try { await saveSaeDraft(draft); onToast('Borrador SAE guardado.', 'success'); }
    catch (cause: any) { onToast(cause?.message || 'No se pudo guardar el borrador.', 'error'); }
  };

  const confirmHire = async (candidate: SaeCandidate, draft: SaeDraft) => {
    if (!selectedNeed) return;
    const data: any = draft.data;
    const missing = ['apellidosNombre','dni','categoria','obra','quincena'].filter(field => !String(data[field] || '').trim());
    if (!candidate.fortnight) missing.push('quincena SAE');
    if (missing.length) { onToast(`Completa los campos obligatorios: ${missing.join(', ')}.`, 'error'); return; }
    const code = reports.find(report => report.id === candidate.sourceReportId)?.detectedLegend?.contratado || resultCodes.contratado;
    if (!code) { onToast('No existe un código SAE configurable para “Contratado”.', 'error'); return; }
    setBusy(true);
    try {
      if (!draft.existingWorkerId) {
        const created = await onRegister(data as Omit<Person, 'id' | 'fechaRegistro'>);
        if (created === false) throw new Error('No se creó el trabajador; la contratación SAE no se ha confirmado.');
      }
      const nextDraft: SaeDraft = { ...draft, status: 'contratado' };
      await saveSaeDraft(nextDraft);
      setDrafts(items => items.map(item => item.id === draft.id ? nextDraft : item));
      await patchCandidate(candidate, { status: 'contratado', resultLabel: 'contratado', resultCode: code, selectedForHire: true }, 'Contratación SAE confirmada.');
      await updateSaeNeedStatus(selectedNeed.id, 'en_contratacion');
    } catch (cause: any) { onToast(cause?.message || 'No se pudo confirmar la contratación.', 'error'); }
    finally { setBusy(false); }
  };

  const markNotHired = async (candidate: SaeCandidate) => {
    const reportCode = reports.find(report => report.id === candidate.sourceReportId)?.detectedLegend?.['no contratado'];
    const configured = resultCodes.no_contratado;
    await patchCandidate(candidate, { selectedForHire: false, status: 'no_contratado', resultLabel: 'no_contratado', resultCode: reportCode || configured || '' }, 'Resultado SAE guardado.');
  };

  const makeReportPdf = async (report: SaeReport) => {
    const source = await downloadSaeFile(report.storagePath);
    return generateCompletedSaePdf(await source.arrayBuffer(), report.mimeType, candidates.filter(candidate => candidate.sourceReportId === report.id));
  };

  const buildReportPdf = async (report: SaeReport, openPreview: boolean) => {
    const pdfBytes = await makeReportPdf(report);
    const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
    if (openPreview) {
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ url: URL.createObjectURL(blob), report });
    } else {
      const name = report.fileName.replace(/\.[^.]+$/, '') + '_cumplimentado.pdf';
      saveBlob(blob, name); await recordGeneratedDocument(report.needId, report.id, name);
    }
  };

  const downloadAll = async () => {
    setBusy(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const report of reports) {
        const bytes = await makeReportPdf(report);
        const name = report.fileName.replace(/\.[^.]+$/, '') + '_cumplimentado.pdf';
        zip.file(name, bytes);
        await recordGeneratedDocument(report.needId, report.id, name);
      }
      const archive = await zip.generateAsync({ type: 'blob' });
      const work = selectedNeed?.workName.replace(/[^a-z0-9áéíóúüñ_-]+/gi, '_') || 'informes';
      saveBlob(archive, `SAE_${work}_${selectedNeed?.year || ''}.zip`);
      if (selectedNeed && candidates.length > 0 && candidates.every(candidate => Boolean(candidate.resultLabel))) {
        await updateSaeNeedStatus(selectedNeed.id, 'finalizada');
        setSelectedNeed({ ...selectedNeed, status: 'finalizada' });
      }
      onToast('Informes SAE cumplimentados descargados en un archivo ZIP.', 'success');
    }
    catch (cause: any) { onToast(cause?.message || 'No se pudieron generar todos los documentos.', 'error'); }
    finally { setBusy(false); }
  };

  if (!selectedNeed) return (
    <section className="space-y-5">
      <header className="ui-surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ui-gradient-brand)] text-white"><BriefcaseBusiness/></span><div><h1 className="text-2xl font-black text-[var(--ui-text)]">SAE</h1><p className="text-sm text-[var(--ui-text-muted)]">Necesidades, selección, quincenas, contratación y devolución documental</p></div></div>
        <button onClick={() => { setNeedEditor(emptyNeed()); setNeedFile(undefined); setError(''); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 font-bold text-white hover:bg-brand-secondary"><Plus size={18}/>Nueva necesidad de contratación</button>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
      {busy ? <div className="ui-surface grid min-h-52 place-items-center"><Loader2 className="animate-spin text-brand-primary"/></div> : needs.length === 0 ? (
        <div className="ui-surface grid min-h-64 place-items-center p-8 text-center"><div><FileSearch className="mx-auto mb-3 text-slate-400" size={40}/><h2 className="font-black">No hay necesidades SAE</h2><p className="mt-1 text-sm text-slate-500">Crea la primera necesidad manualmente o a partir de un documento.</p></div></div>
      ) : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{needs.map(need => <button key={need.id} onClick={() => { setSelectedNeed(need); setPhase('Necesidad'); }} className="ui-surface group min-w-0 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-lg font-black text-[var(--ui-text)]">{need.workName}</h2><p className="text-sm text-[var(--ui-text-muted)]">{MONTHS[need.month - 1]} {need.year}{need.workCode ? ` · ${need.workCode}` : ''}</p></div><ChevronRight className="shrink-0 text-slate-400 group-hover:text-brand-primary"/></div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center"><div className="rounded-xl bg-blue-50 p-2 dark:bg-blue-950/40"><strong className="block text-lg text-blue-700 dark:text-blue-300">{need.totalRequested}</strong><span className="text-[10px] uppercase text-slate-500">Solicitados</span></div><div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><strong className="block text-lg">{need.candidateCount || 0}</strong><span className="text-[10px] uppercase text-slate-500">Candidatos</span></div><div className="rounded-xl bg-emerald-50 p-2 dark:bg-emerald-950/40"><strong className="block text-lg text-emerald-700 dark:text-emerald-300">{need.hiredCount || 0}</strong><span className="text-[10px] uppercase text-slate-500">Contratados</span></div><div className="rounded-xl bg-amber-50 p-2 dark:bg-amber-950/40"><strong className="block text-lg text-amber-700 dark:text-amber-300">{need.pendingCount ?? need.totalRequested}</strong><span className="text-[10px] uppercase text-slate-500">Pendientes</span></div></div>
        <div className="mt-4"><StatusPill value={need.status}/></div>
      </button>)}</div>}
      {needEditor && <Modal title="Nueva necesidad de contratación" onClose={() => setNeedEditor(null)} wide>
        <div className="mb-5 rounded-xl border border-dashed border-blue-300 bg-blue-50/70 p-4 dark:border-blue-800 dark:bg-blue-950/30"><label className="flex cursor-pointer flex-col items-center gap-2 text-center"><FileUp className="text-brand-primary"/><strong>Analizar documento de necesidades</strong><span className="text-xs text-slate-500">PDF, JPG o PNG · extracción nativa y OCR solo cuando sea necesario</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" onChange={event => event.target.files?.[0] && void analyzeNeedFile(event.target.files[0])}/></label></div>
        <p className="mb-4 text-sm text-slate-500">Revisa todos los datos. Ningún valor dudoso se guarda automáticamente.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Obra *" value={needEditor.workName} list="sae-obras" onChange={event => setNeedEditor({ ...needEditor, workName: event.target.value })}/><datalist id="sae-obras">{savedObras.map(item => <option key={item}>{item}</option>)}</datalist><Field label="Código de obra" value={needEditor.workCode || ''} onChange={event => setNeedEditor({ ...needEditor, workCode: event.target.value })}/><label className="text-sm font-semibold">Mes *<select value={needEditor.month} onChange={event => setNeedEditor({ ...needEditor, month: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5">{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label><Field label="Año *" type="number" min={2020} max={2200} value={needEditor.year} onChange={event => setNeedEditor({ ...needEditor, year: Number(event.target.value) })}/></div>
        <div className="mt-6 space-y-3"><div className="flex items-center justify-between"><h3 className="font-black">Categorías solicitadas</h3><button onClick={() => setNeedEditor({ ...needEditor, categories: [...needEditor.categories, { category: '', requestedCount: 1 }] })} className="rounded-lg border px-3 py-2 text-sm font-bold"><Plus size={15} className="inline"/> Añadir</button></div>{needEditor.categories.map((item, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_7rem_2.5rem] gap-2"><input list="sae-categories" value={item.category} placeholder="Categoría profesional" onChange={event => { const categories = [...needEditor.categories]; categories[index] = { ...item, category: event.target.value }; setNeedEditor({ ...needEditor, categories }); }} className="min-w-0 rounded-xl border bg-transparent px-3 py-2.5"/><input type="number" min={1} value={item.requestedCount} aria-label="Trabajadores solicitados" onChange={event => { const categories = [...needEditor.categories]; categories[index] = { ...item, requestedCount: Number(event.target.value) }; setNeedEditor({ ...needEditor, categories }); }} className="min-w-0 rounded-xl border bg-transparent px-3 py-2.5"/><button aria-label="Eliminar categoría" onClick={() => setNeedEditor({ ...needEditor, categories: needEditor.categories.filter((_, position) => position !== index) })} className="rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950"><X/></button></div>)}<datalist id="sae-categories">{savedCategorias.map(item => <option key={item}>{item}</option>)}</datalist></div>
        {needFile && <p className="mt-4 text-xs text-slate-500">Origen: {needFile.name}</p>}
        <div className="mt-6 flex justify-end"><button disabled={busy} onClick={() => void saveNeed()} className="rounded-xl bg-brand-primary px-5 py-3 font-bold text-white disabled:opacity-50">Confirmar necesidad</button></div>
      </Modal>}
      {busy && progress && <div className="fixed bottom-5 right-5 z-[140] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"><Loader2 size={16} className="animate-spin"/>{progress}</div>}
    </section>
  );

  const phaseIndex = PHASES.indexOf(phase);
  return <section className="space-y-5">
    <header className="ui-surface p-4 sm:p-6"><button onClick={() => { setSelectedNeed(null); void loadNeeds(); }} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-brand-primary"><ArrowLeft size={17}/>Necesidades activas</button><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-black">{selectedNeed.workName}</h1><p className="text-sm text-slate-500">{MONTHS[selectedNeed.month - 1]} {selectedNeed.year}{selectedNeed.workCode ? ` · ${selectedNeed.workCode}` : ''}</p></div><StatusPill value={selectedNeed.status}/></div>
      <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Fases SAE">{PHASES.map((item, index) => <button key={item} onClick={() => setPhase(item)} className={`min-h-12 rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${phase === item ? 'border-brand-primary bg-brand-primary text-white' : index < phaseIndex ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}><span className="mr-1 opacity-70">{index + 1}.</span>{item}</button>)}</nav>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
    {phase === 'Necesidad' && <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]"><article className="ui-surface p-5"><h2 className="font-black">Datos de la necesidad</h2><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-slate-500">Obra</dt><dd className="font-bold">{selectedNeed.workName}</dd></div><div><dt className="text-slate-500">Periodo</dt><dd className="font-bold">{MONTHS[selectedNeed.month - 1]} {selectedNeed.year}</dd></div><div><dt className="text-slate-500">Código</dt><dd className="font-bold">{selectedNeed.workCode || '—'}</dd></div><div><dt className="text-slate-500">Total solicitado</dt><dd className="font-bold">{selectedNeed.totalRequested}</dd></div></dl></article><article className="ui-surface p-5"><h2 className="font-black">Categorías</h2><div className="mt-3 space-y-2">{selectedNeed.categories.map(item => <div key={item.category} className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800"><span>{item.category}</span><strong>{item.requestedCount}</strong></div>)}</div></article></div>}
    {phase === 'Informes SAE' && <article className="ui-surface p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-black">Informes de resultado de selección</h2><p className="text-sm text-slate-500">Texto nativo → OCR → reglas deterministas → revisión humana.</p></div><label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 font-bold text-white"><Upload size={17}/>Añadir informe SAE<input multiple type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" onChange={event => event.target.files && void analyzeReports(event.target.files)}/></label></div><div className="mt-5 grid gap-3 md:grid-cols-2">{reports.map(report => <div key={report.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex items-start gap-3"><FileCheck2 className="shrink-0 text-emerald-600"/><div className="min-w-0"><strong className="block truncate">{report.fileName}</strong><span className="text-xs text-slate-500">{report.pageCount} pág. · {report.extractionMethod.toUpperCase()}</span></div></div></div>)}{reports.length === 0 && <p className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">Todavía no hay informes vinculados.</p>}</div></article>}
    {phase === 'Candidatos' && <article className="ui-surface p-4 sm:p-6"><h2 className="font-black">Bandeja de candidatos SAE</h2><div className="mt-4 grid gap-3 lg:grid-cols-2">{candidates.map(candidate => <div key={candidate.id} className={`min-w-0 rounded-xl border p-4 ${candidate.confidence === 'baja' ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block break-words">{candidate.normalizedFullName}</strong><p className="text-sm text-slate-500">{candidate.category || 'Categoría pendiente'} · {candidate.offerNumber || 'Oferta sin identificar'}</p></div><button onClick={() => setEditingCandidate(candidate)} aria-label="Revisar candidato" className="shrink-0 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil size={17}/></button></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill value={candidate.status}/><span className={`rounded-full px-2 py-1 text-xs font-bold ${candidate.confidence === 'alta' ? 'bg-emerald-100 text-emerald-700' : candidate.confidence === 'media' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'}`}>Confianza {candidate.confidence}</span>{duplicateCandidateIds.has(candidate.id) && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-200">Posible duplicado</span>}<span className="text-xs text-slate-500">Pág. {candidate.sourcePage}</span></div><p className="mt-3 line-clamp-2 text-xs text-slate-500" title={candidate.sourceRowText}>{candidate.sourceRowText}</p></div>)}{!candidates.length && <p className="col-span-full p-8 text-center text-sm text-slate-500">Añade y confirma al menos un informe SAE.</p>}</div></article>}
    {phase === 'Distribución' && <div className="space-y-4"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{categorySummary.map(item => <div key={item.category} className={`rounded-xl border p-3 text-sm ${item.over ? 'border-red-400 bg-red-50 dark:bg-red-950/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}><strong>{item.category}</strong><p className="text-slate-500">Necesarios {item.requestedCount} / Asignados {item.selected}</p>{item.over && <p className="mt-1 font-bold text-red-600">Sobreasignación</p>}</div>)}</div><div className="grid gap-4 xl:grid-cols-3">{([null,1,2] as const).map(slot => <article key={slot || 0} className="ui-surface min-w-0 p-4"><h2 className="mb-3 flex items-center justify-between font-black"><span>{slot === null ? 'SIN ASIGNAR' : `${slot}ª QUINCENA`}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800">{candidates.filter(candidate => candidate.fortnight === slot).length}</span></h2><div className="space-y-2">{candidates.filter(candidate => candidate.fortnight === slot).map(candidate => <div key={candidate.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-start gap-2"><GripVertical size={17} className="mt-0.5 shrink-0 text-slate-400"/><div className="min-w-0 flex-1"><strong className="block break-words text-sm">{candidate.normalizedFullName}</strong><span className="text-xs text-slate-500">{candidate.category}</span></div></div><div className="mt-3 grid grid-cols-3 gap-1"><button aria-label="Sin asignar" onClick={() => void allocate(candidate, null)} className={`rounded-lg px-2 py-2 text-xs font-bold ${slot === null ? 'bg-slate-800 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>Sin asignar</button><button aria-label="Primera quincena" onClick={() => void allocate(candidate, 1)} className={`rounded-lg px-2 py-2 text-xs font-bold ${slot === 1 ? 'bg-brand-primary text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>1ª</button><button aria-label="Segunda quincena" onClick={() => void allocate(candidate, 2)} className={`rounded-lg px-2 py-2 text-xs font-bold ${slot === 2 ? 'bg-brand-primary text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>2ª</button></div></div>)}</div></article>)}</div></div>}
    {phase === 'Nuevos registros' && <div className="space-y-4"><article className="ui-surface p-5"><h2 className="font-black">Preparación de nuevos registros</h2><p className="mt-1 text-sm text-slate-500">Selecciona candidatos y completa sus borradores. Todavía no se crean trabajadores.</p></article><div className="grid gap-4 xl:grid-cols-2">{candidates.filter(candidate => candidate.fortnight || candidate.selectedForHire).map(candidate => { const draft = drafts.find(item => item.candidateId === candidate.id); const existing = candidateWorkerMatch(candidate, people); return <article key={candidate.id} className="ui-surface min-w-0 p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-black">{candidate.normalizedFullName}</h3><p className="text-sm text-slate-500">{candidate.category} · {candidate.fortnight ? `${candidate.fortnight}ª quincena` : 'Sin quincena'}</p></div>{existing && <span className="shrink-0 rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-200">Trabajador existente</span>}</div>{!draft ? <div className="mt-4 flex gap-2"><button onClick={() => void makeDraft(candidate)} className="flex-1 rounded-xl bg-brand-primary px-4 py-2.5 font-bold text-white">Seleccionar para contratar</button><button onClick={() => void markNotHired(candidate)} className="rounded-xl border border-red-300 px-4 py-2.5 font-bold text-red-700 dark:border-red-800 dark:text-red-300">No contratado</button></div> : <div className="mt-4 space-y-3">{existing && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">Coincidencia: <strong>{existing.apellidosNombre}</strong> · {existing.dni}. Se enlazará sin duplicarlo.</div>}<div className="grid gap-3 sm:grid-cols-2">{[['apellidosNombre','Nombre completo *'],['dni','DNI/NIE *'],['categoria','Categoría *'],['obra','Obra *'],['quincena','Quincena *'],['numOferta','Oferta SAE']].map(([field,label]) => <Field key={field} label={label} value={String(draft.data[field] || '')} onChange={event => updateDraft(draft, field, event.target.value)}/>)}</div><div className="flex justify-end"><button onClick={() => void persistDraft(draft)} className="rounded-xl bg-brand-primary px-4 py-2.5 font-bold text-white">Guardar borrador</button></div></div>}</article>; })}</div></div>}
    {phase === 'Contratación' && <div className="space-y-4"><article className="ui-surface p-5"><h2 className="font-black">Confirmación de contratación</h2><p className="mt-1 text-sm text-slate-500">La confirmación crea o enlaza el trabajador y fija el resultado SAE.</p></article><div className="grid gap-4 xl:grid-cols-2">{drafts.map(draft => { const candidate = candidates.find(item => item.id === draft.candidateId); if (!candidate) return null; const required = ['apellidosNombre','dni','categoria','obra','quincena']; const missing = required.filter(field => !String(draft.data[field] || '').trim()); return <article key={draft.id} className="ui-surface p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{candidate.normalizedFullName}</h3><p className="text-sm text-slate-500">{draft.existingWorkerId ? 'Trabajador existente enlazado' : 'Nuevo registro SAE'}</p></div><StatusPill value={draft.status}/></div>{missing.length > 0 && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle size={16} className="mr-1 inline"/>Falta completar: {missing.join(', ')}</div>}<button disabled={missing.length > 0 || candidate.status === 'contratado'} onClick={() => void confirmHire(candidate, draft)} className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><UserCheck size={17} className="mr-1 inline"/>{candidate.status === 'contratado' ? 'Contratación confirmada' : 'Confirmar contratación'}</button></article>; })}{drafts.length === 0 && <p className="col-span-full ui-surface p-8 text-center text-sm text-slate-500">Prepara primero los borradores en “Nuevos registros”.</p>}</div></div>}
    {phase === 'Devolución SAE' && <article className="ui-surface p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-black">Documentos de devolución al SAE</h2><p className="text-sm text-slate-500">Se conserva el original y se escriben los códigos sobre la fila y página detectadas.</p></div><div className="flex flex-wrap gap-2">{role === 'admin' && <button onClick={() => setCodesOpen(true)} className="rounded-xl border px-4 py-2.5 font-bold"><Settings2 size={16} className="inline"/> Códigos SAE</button>}<button disabled={!reports.length || busy} onClick={() => void downloadAll()} className="rounded-xl bg-brand-primary px-4 py-2.5 font-bold text-white disabled:opacity-50"><Download size={16} className="inline"/> Descargar todos</button></div></div><div className="mt-5 space-y-3">{reports.map(report => { const related = candidates.filter(candidate => candidate.sourceReportId === report.id); const unresolved = related.filter(candidate => !candidate.resultLabel).length; return <div key={report.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><strong className="block truncate">{report.fileName}</strong><p className={`text-xs ${unresolved ? 'text-amber-600' : 'text-emerald-600'}`}>{related.length} candidatos · {unresolved ? `${unresolved} sin resultado` : 'Resultados completos'}</p></div><div className="flex gap-2"><button onClick={() => void buildReportPdf(report, true)} className="flex-1 rounded-xl border px-4 py-2 text-sm font-bold">Vista previa</button><button onClick={() => void buildReportPdf(report, false)} className="flex-1 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white">Descargar</button></div></div>; })}</div></article>}
    {busy && <div className="fixed bottom-5 right-5 z-[140] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"><Loader2 size={16} className="animate-spin"/>{progress || 'Procesando…'}</div>}
    {pendingReports.length > 0 && <Modal title="Revisión previa de informes SAE" onClose={() => setPendingReports([])} wide><p className="mb-4 text-sm text-slate-500">Corrige cualquier lectura dudosa. Los campos de confianza baja aparecen resaltados y no se completan con suposiciones.</p><div className="space-y-6">{pendingReports.map((item, reportIndex) => <section key={item.report.id}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-black">{item.file.name} · {item.candidates.length} candidatos</h3><button type="button" onClick={() => addManualCandidate(reportIndex)} className="rounded-lg border px-3 py-2 text-sm font-bold"><Plus size={15} className="inline"/> Añadir fila manual</button></div>{item.candidates.length === 0 ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">No se han detectado filas de candidatos. No se inventará ningún dato; revisa el documento o añade las filas manualmente.</div> : <div className="space-y-2">{item.candidates.map((candidate, candidateIndex) => <div key={candidate.id} className={`grid gap-2 rounded-xl border p-3 sm:grid-cols-[1.5fr_1fr_9rem_6rem] ${candidate.confidence === 'baja' ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}><input value={candidate.originalFullName} aria-label="Nombre original" onChange={event => setPendingReports(current => current.map((entry, rIndex) => rIndex !== reportIndex ? entry : { ...entry, candidates: entry.candidates.map((person, cIndex) => cIndex !== candidateIndex ? person : { ...person, originalFullName: event.target.value, normalizedFullName: normalizePersonName(event.target.value) }) }))} className="min-w-0 rounded-lg border bg-transparent px-2 py-2"/><input value={candidate.category} aria-label="Categoría" onChange={event => setPendingReports(current => current.map((entry, rIndex) => rIndex !== reportIndex ? entry : { ...entry, candidates: entry.candidates.map((person, cIndex) => cIndex !== candidateIndex ? person : { ...person, category: event.target.value }) }))} className="min-w-0 rounded-lg border bg-transparent px-2 py-2"/><input value={candidate.dniNie || ''} aria-label="DNI/NIE" onChange={event => setPendingReports(current => current.map((entry, rIndex) => rIndex !== reportIndex ? entry : { ...entry, candidates: entry.candidates.map((person, cIndex) => cIndex !== candidateIndex ? person : { ...person, dniNie: event.target.value }) }))} className="min-w-0 rounded-lg border bg-transparent px-2 py-2"/><span className="self-center text-xs font-bold">Pág. {candidate.sourcePage}</span></div>)}</div>}</section>)}</div><div className="mt-6 flex justify-end"><button onClick={() => void confirmReports()} className="rounded-xl bg-brand-primary px-5 py-3 font-bold text-white">Confirmar y guardar</button></div></Modal>}
    {editingCandidate && <Modal title="Revisar candidato SAE" onClose={() => setEditingCandidate(null)}><div className="grid gap-4 sm:grid-cols-2"><Field label="Texto original SAE" value={editingCandidate.originalFullName} onChange={event => setEditingCandidate({ ...editingCandidate, originalFullName: event.target.value, normalizedFullName: normalizePersonName(event.target.value) })}/><Field label="Nombre normalizado" value={editingCandidate.normalizedFullName} onChange={event => setEditingCandidate({ ...editingCandidate, normalizedFullName: event.target.value })}/><Field label="DNI/NIE" value={editingCandidate.dniNie || ''} onChange={event => setEditingCandidate({ ...editingCandidate, dniNie: event.target.value })}/><Field label="Categoría" value={editingCandidate.category} onChange={event => setEditingCandidate({ ...editingCandidate, category: event.target.value })}/><Field label="Oferta SAE" value={editingCandidate.offerNumber || ''} onChange={event => setEditingCandidate({ ...editingCandidate, offerNumber: event.target.value })}/><Field label="Obra" value={editingCandidate.workName || ''} onChange={event => setEditingCandidate({ ...editingCandidate, workName: event.target.value })}/></div><div className="mt-4 rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-800"><strong>Evidencia · página {editingCandidate.sourcePage}</strong><p className="mt-1 break-words">{editingCandidate.sourceRowText}</p></div><div className="mt-5 flex justify-end"><button onClick={() => { void patchCandidate(editingCandidate, { ...editingCandidate, confidence: 'alta', status: editingCandidate.category ? 'sin_asignar' : 'pendiente_datos' }, 'Candidato revisado.'); setEditingCandidate(null); }} className="rounded-xl bg-brand-primary px-5 py-3 font-bold text-white">Validar datos</button></div></Modal>}
    {preview && <Modal title={`Vista previa · ${preview.report.fileName}`} onClose={() => { URL.revokeObjectURL(preview.url); setPreview(null); }} wide><iframe title="Vista previa del informe SAE cumplimentado" src={preview.url} className="h-[65dvh] w-full rounded-xl border bg-white"/><div className="mt-4 space-y-2"><h3 className="font-black">Corrección de alineación</h3>{candidates.filter(candidate => candidate.sourceReportId === preview.report.id && candidate.resultCode).map(candidate => <div key={candidate.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_7rem_7rem]"><span className="min-w-0 break-words text-sm font-bold">{candidate.normalizedFullName} · {candidate.resultCode}</span><input type="number" step="1" value={candidate.alignmentOffsetX || 0} aria-label="Ajuste horizontal" onChange={event => void patchCandidate(candidate, { alignmentOffsetX: Number(event.target.value) })} className="rounded-lg border bg-transparent px-2 py-1"/><input type="number" step="1" value={candidate.alignmentOffsetY || 0} aria-label="Ajuste vertical" onChange={event => void patchCandidate(candidate, { alignmentOffsetY: Number(event.target.value) })} className="rounded-lg border bg-transparent px-2 py-1"/></div>)}</div><p className="mt-3 text-xs text-slate-500">Tras ajustar X/Y, cierra y vuelve a generar la vista previa.</p></Modal>}
    {codesOpen && <Modal title="Códigos de resultado SAE" onClose={() => setCodesOpen(false)}><p className="mb-4 text-sm text-slate-500">Solo se utiliza la leyenda del propio informe o esta configuración. No se inventan códigos adicionales.</p>{['contratado','no_contratado'].map(key => <div key={key} className="mb-3 grid grid-cols-[1fr_9rem] gap-3"><label className="self-center font-bold">{key === 'contratado' ? 'Contratado' : 'No contratado'}</label><input value={resultCodes[key] || ''} placeholder={key === 'contratado' ? '2100' : 'Sin configurar'} onChange={event => setResultCodes({ ...resultCodes, [key]: event.target.value })} className="rounded-xl border bg-transparent px-3 py-2.5"/></div>)}<div className="mt-5 flex justify-end"><button onClick={async () => { try { for (const [key, rawCode] of Object.entries(resultCodes)) { const code = String(rawCode || '').trim(); if (code) await saveSaeResultCode(key, code); } onToast('Códigos SAE guardados.', 'success'); setCodesOpen(false); } catch (cause: any) { onToast(cause?.message || 'No se pudieron guardar los códigos.', 'error'); } }} className="rounded-xl bg-brand-primary px-5 py-3 font-bold text-white">Guardar configuración</button></div></Modal>}
  </section>;
};

export default SaeSection;
