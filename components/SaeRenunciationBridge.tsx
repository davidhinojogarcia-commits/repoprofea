import React, { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { AlertTriangle, CheckCircle2, Download, FileSignature, RotateCcw, Send, X } from 'lucide-react';
import { createDocument, getDocument, updateDocument } from '../src/services/databaseService';
import { supabase } from '../src/lib/supabase';

type CandidateRow = {
  id: string;
  need_id: string;
  source_report_id?: string | null;
  order_number?: number | null;
  full_name_original?: string | null;
  normalized_name?: string | null;
  apellidos?: string | null;
  nombre?: string | null;
  category?: string | null;
  work_name?: string | null;
  work_code?: string | null;
  offer_number?: string | null;
  hiring_month?: number | null;
  fortnight?: number | null;
  status?: string | null;
  result_code?: string | null;
  existing_worker_id?: number | null;
  updated_at?: string | null;
};

type NeedRow = {
  id: string;
  work_name?: string | null;
  work_code?: string | null;
  hiring_month?: number | null;
  hiring_year?: number | null;
  notes?: string | null;
};

type Worker = Record<string, any> & { id?: number };

type FlowData = {
  candidate: CandidateRow;
  need: NeedRow | null;
  worker: Worker | null;
};

const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const workerName = (candidate: CandidateRow) => candidate.normalized_name || [candidate.apellidos, candidate.nombre].filter(Boolean).join(' ') || candidate.full_name_original || 'Trabajador';
const candidateWork = (candidate: CandidateRow, need: NeedRow | null) => candidate.work_name || need?.work_name || candidate.work_code || need?.work_code || '';
const candidateCategory = (candidate: CandidateRow) => candidate.category || '';
const monthLabel = (month?: number | null) => month && month >= 1 && month <= 12 ? ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month - 1] : '';
const fortnightLabel = (value?: number | null) => value === 1 ? '1ª Quincena' : value === 2 ? '2ª Quincena' : '';
const safeFilename = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

const formatPhoneForWhatsapp = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9) return `34${digits}`;
  if (digits.startsWith('0034')) return digits.slice(2);
  return digits;
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('No se pudo preparar el PDF.'));
  reader.readAsDataURL(blob);
});

const sha256 = async (blob: Blob) => {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const loadImageDataUrl = async (src: string) => {
  try {
    const response = await fetch(src);
    if (!response.ok) return '';
    return await blobToDataUrl(await response.blob());
  } catch {
    return '';
  }
};

const drawWrapped = (doc: jsPDF, text: string, x: number, y: number, width: number, lineHeight = 5) => {
  const lines = doc.splitTextToSize(text || '—', width);
  doc.text(lines, x, y);
  return y + Math.max(1, lines.length) * lineHeight;
};

async function buildRenunciationPdf(input: {
  candidate: CandidateRow;
  need: NeedRow | null;
  worker: Worker | null;
  phone: string;
  signatureDataUrl: string;
  refusedToSign: boolean;
  observations: string;
}) {
  const { candidate, need, worker, phone, signatureDataUrl, refusedToSign, observations } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 18;
  const right = pageW - 18;
  const usable = right - left;
  const logo = await loadImageDataUrl('/logo-pdf.png');
  if (logo) {
    try { doc.addImage(logo, 'PNG', left, 10, 48, 17, undefined, 'FAST'); } catch {}
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DIPUTACIÓN DE CÁDIZ · PROFEA', right, 15, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Gestión de contratación · Servicio Andaluz de Empleo', right, 20, { align: 'right' });
  doc.setDrawColor(0, 84, 142);
  doc.setLineWidth(0.7);
  doc.line(left, 31, right, 31);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('INFORME DE RENUNCIA A LA CONTRATACIÓN', pageW / 2, 43, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(170, 20, 20);
  doc.text('Código SAE 2100 · Rechazo voluntario', pageW / 2, 49, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  let y = 61;
  const field = (label: string, value: unknown) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(label.toUpperCase(), left, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    y = drawWrapped(doc, String(value || '—'), left, y + 5, usable, 5) + 3;
  };

  doc.setFillColor(245, 247, 250);
  doc.roundedRect(left - 2, y - 5, usable + 4, 74, 2, 2, 'F');
  field('Trabajador', worker?.apellidosNombre || workerName(candidate));
  field('DNI / NIE', worker?.dni || 'No consta en la ficha');
  field('Teléfono', phone || worker?.telefono || 'No consta');
  field('Categoría / puesto', worker?.categoria || candidateCategory(candidate) || '—');
  field('Nº oferta SAE', worker?.numOferta || candidate.offer_number || '—');

  y += 4;
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(left - 2, y - 5, usable + 4, 58, 2, 2, 'F');
  field('Obra', worker?.obra || candidateWork(candidate, need) || '—');
  field('Código de obra', candidate.work_code || need?.work_code || '—');
  field('Periodo SAE', [monthLabel(candidate.hiring_month || need?.hiring_month), need?.hiring_year, fortnightLabel(candidate.fortnight)].filter(Boolean).join(' · ') || '—');
  field('Periodo de contratación', [worker?.periodoInicio, worker?.periodoFin].filter(Boolean).join(' a ') || 'Pendiente / no iniciado');
  field('Supervisor responsable', worker?.supervisorResponsable || '—');

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DECLARACIÓN', left, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const declaration = refusedToSign
    ? 'Se deja constancia de que al trabajador arriba identificado se le ha presentado el presente documento relativo al rechazo voluntario de la contratación indicada, manifestando su negativa a firmarlo. La incidencia queda registrada por el supervisor en la fecha y hora indicadas.'
    : 'El trabajador arriba identificado manifiesta de forma voluntaria su renuncia a la contratación correspondiente a la oferta, obra y periodo indicados, declarando haber leído y comprendido el contenido del presente documento antes de firmarlo.';
  y = drawWrapped(doc, declaration, left, y, usable, 5.2) + 5;
  if (observations.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.text('Observaciones:', left, y);
    doc.setFont('helvetica', 'normal');
    y = drawWrapped(doc, observations.trim(), left, y + 5, usable, 5) + 4;
  }

  const signedAt = new Date();
  doc.setFontSize(9);
  doc.text(`Fecha y hora del registro: ${signedAt.toLocaleString('es-ES')}`, left, y + 2);
  y += 12;

  doc.setDrawColor(180, 180, 180);
  doc.roundedRect(left, y, usable, 48, 2, 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(refusedToSign ? 'CONSTANCIA DE NEGATIVA A FIRMAR' : 'FIRMA DEL TRABAJADOR', left + 4, y + 7);
  if (!refusedToSign && signatureDataUrl) {
    try { doc.addImage(signatureDataUrl, 'PNG', left + 8, y + 10, 78, 32, undefined, 'FAST'); } catch {}
  } else if (refusedToSign) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(170, 20, 20);
    doc.text('EL TRABAJADOR SE NIEGA A FIRMAR', left + 8, y + 26);
    doc.setTextColor(0, 0, 0);
  }

  const footerY = pageH - 17;
  doc.setDrawColor(210, 210, 210);
  doc.line(left, footerY - 5, right, footerY - 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);
  doc.text('Documento generado y archivado electrónicamente por GestionPROFEA.', left, footerY);
  doc.text('Página 1 de 1', right, footerY, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  const blob = doc.output('blob');
  return { blob, signedAt: signedAt.toISOString() };
}

const SignaturePad = ({ onChange }: { onChange: (dataUrl: string) => void }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(190 * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#111827';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, rect.width, 190);
      setHasInk(false);
      onChange('');
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [onChange]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    drawing.current = true;
    last.current = point(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    event.preventDefault();
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const next = point(event);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
    setHasInk(true);
  };
  const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try { onChange(ref.current?.toDataURL('image/png') || ''); } catch {}
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const clear = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
    onChange('');
  };
  return <div>
    <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="w-full h-[190px] rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-white touch-none" />
    <div className="mt-2 flex items-center justify-between gap-2"><span className={`text-xs font-bold ${hasInk ? 'text-emerald-600' : 'text-slate-500'}`}>{hasInk ? 'Firma registrada ✓' : 'Firma aquí con el dedo o lápiz táctil'}</span><button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><RotateCcw className="w-3.5 h-3.5" />Borrar firma</button></div>
  </div>;
};

export const SaeRenunciationBridge: React.FC = () => {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [step, setStep] = useState<'confirm' | 'sign' | 'done'>('confirm');
  const [phone, setPhone] = useState('');
  const [observations, setObservations] = useState('');
  const [signature, setSignature] = useState('');
  const [consent, setConsent] = useState(false);
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [archivePath, setArchivePath] = useState('');
  const openedCandidate = useRef('');
  const renouncedWorkerIds = useRef<Set<number>>(new Set());

  const displayName = useMemo(() => flow ? (flow.worker?.apellidosNombre || workerName(flow.candidate)) : '', [flow]);
  const work = useMemo(() => flow ? (flow.worker?.obra || candidateWork(flow.candidate, flow.need)) : '', [flow]);

  const markDom = () => {
    document.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
      if (!Array.from(select.options).some(option => option.value === '2100')) return;
      const card = select.closest('div.rounded-2xl.border.p-4');
      if (!card) return;
      card.classList.toggle('profea-renuncia-mark', select.value === '2100');
      if (select.value === '2100' && !card.querySelector('[data-renuncia-badge="1"]')) {
        const title = card.querySelector('.font-black.text-sm');
        if (title) {
          const badge = document.createElement('span');
          badge.dataset.renunciaBadge = '1';
          badge.className = 'ml-2 inline-flex rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-200';
          badge.textContent = 'RENUNCIA · SAE 2100';
          title.appendChild(badge);
        }
      }
    });
    renouncedWorkerIds.current.forEach(id => {
      const nodes = [document.getElementById(`person-table-row-${id}`), document.getElementById(`compact-card-${id}`)].filter(Boolean) as HTMLElement[];
      nodes.forEach(node => {
        node.classList.add('profea-renuncia-mark');
        if (node.querySelector('[data-worker-renuncia-badge="1"]')) return;
        const target = node.querySelector('h4') || node.querySelector('td:nth-child(2) > div:first-child');
        if (!target) return;
        const badge = document.createElement('span');
        badge.dataset.workerRenunciaBadge = '1';
        badge.className = 'ml-2 inline-flex rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-200';
        badge.textContent = 'RENUNCIA';
        target.appendChild(badge);
      });
    });
  };

  const refreshRenouncedWorkers = async () => {
    try {
      const rows = await supabase.query('trabajadores', { query: 'select=id,data&order=updated_at.desc&limit=5000' });
      renouncedWorkerIds.current = new Set((rows || []).filter((row: any) => normalize(row.data?.estadoContratacion) === 'renuncia' || String(row.data?.codigoSaeResultado || '') === '2100').map((row: any) => Number(row.id)).filter(Number.isFinite));
      markDom();
    } catch {}
  };

  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.profeaRenunciaStyle = '1';
    style.textContent = `.profea-renuncia-mark{background:rgba(254,226,226,.78)!important;border-color:rgb(248 113 113)!important;box-shadow:inset 4px 0 0 rgb(220 38 38)!important}.profea-renuncia-mark>td{background:rgba(254,226,226,.72)!important}.dark .profea-renuncia-mark{background:rgba(127,29,29,.28)!important;border-color:rgb(153 27 27)!important}.dark .profea-renuncia-mark>td{background:rgba(127,29,29,.24)!important}`;
    document.head.appendChild(style);
    void refreshRenouncedWorkers();
    const observer = new MutationObserver(() => markDom());
    observer.observe(document.body, { childList: true, subtree: true });

    const handler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (!Array.from(target.options).some(option => option.value === '2100')) return;
      setTimeout(() => markDom(), 0);
      if (target.value !== '2100') return;
      setTimeout(async () => {
        try {
          const rows = await supabase.query('sae_candidates', { query: 'select=*&result_code=eq.2100&order=updated_at.desc&limit=1' });
          const candidate = rows?.[0] as CandidateRow | undefined;
          if (!candidate?.id || openedCandidate.current === candidate.id) return;
          openedCandidate.current = candidate.id;
          const needs = await supabase.query('sae_needs', { query: `select=*&id=eq.${encodeURIComponent(candidate.need_id)}&limit=1` });
          const need = (needs?.[0] || null) as NeedRow | null;
          let worker: Worker | null = null;
          if (candidate.existing_worker_id) worker = await getDocument<Worker>('trabajadores', Number(candidate.existing_worker_id));
          if (!worker) {
            const allWorkers = await supabase.query('trabajadores', { query: 'select=*&order=updated_at.desc&limit=5000' });
            const wantedName = normalize(workerName(candidate));
            const wantedOffer = normalize(candidate.offer_number);
            const match = (allWorkers || []).find((row: any) => {
              const data = row.data || {};
              const nameOk = normalize(row.apellidos_nombre || data.apellidosNombre) === wantedName;
              const offerOk = !wantedOffer || normalize(row.num_oferta || data.numOferta) === wantedOffer;
              return nameOk && offerOk;
            });
            if (match) worker = { ...(match.data || {}), id: Number(match.id), apellidosNombre: match.apellidos_nombre || match.data?.apellidosNombre, dni: match.dni || match.data?.dni, telefono: match.telefono || match.data?.telefono, obra: match.obra || match.data?.obra, categoria: match.categoria || match.data?.categoria, numOferta: match.num_oferta || match.data?.numOferta, quincena: match.quincena || match.data?.quincena, periodoInicio: match.periodo_inicio || match.data?.periodoInicio, periodoFin: match.periodo_fin || match.data?.periodoFin };
          }
          const now = new Date().toISOString();
          if (worker?.id) {
            await updateDocument('trabajadores', worker.id, { estadoContratacion: 'Renuncia', codigoSaeResultado: '2100', renunciaFecha: now } as any).catch(() => undefined);
            renouncedWorkerIds.current.add(Number(worker.id));
          }
          setFlow({ candidate, need, worker });
          setPhone(worker?.telefono || '');
          setObservations('');
          setSignature('');
          setConsent(false);
          setRefused(false);
          setPdfFile(null);
          if (pdfUrl) URL.revokeObjectURL(pdfUrl);
          setPdfUrl('');
          setArchivePath('');
          setStep('confirm');
          markDom();
        } catch (error) {
          console.error('No se pudo iniciar el flujo de renuncia SAE:', error);
        }
      }, 450);
    };
    document.addEventListener('change', handler, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('change', handler, true);
      style.remove();
    };
  }, []);

  const close = () => {
    setFlow(null);
    setStep('confirm');
    setBusy(false);
  };

  const finalize = async (refuse = false) => {
    if (!flow) return;
    if (!refuse && !signature) return;
    if (!refuse && !consent) return;
    setBusy(true);
    try {
      const result = await buildRenunciationPdf({ candidate: flow.candidate, need: flow.need, worker: flow.worker, phone, signatureDataUrl: signature, refusedToSign: refuse, observations });
      const name = safeFilename(displayName || flow.candidate.id) || flow.candidate.id;
      const fileName = `RENUNCIA_SAE_2100_${name}_${new Date().toISOString().slice(0, 10)}.pdf`;
      const file = new File([result.blob], fileName, { type: 'application/pdf' });
      const hash = await sha256(result.blob);
      const path = `${flow.candidate.need_id}/renuncias/${flow.candidate.id}/${Date.now()}-${fileName}`;
      const { error } = await supabase.storage.from('sae-documents').upload(path, result.blob, { contentType: 'application/pdf', upsert: true });
      if (error) throw error;
      setArchivePath(path);
      setPdfFile(file);
      const url = URL.createObjectURL(file);
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(url);

      const metadata = {
        estadoContratacion: 'Renuncia', codigoSaeResultado: '2100', renunciaFecha: result.signedAt,
        renunciaFirmada: !refuse, renunciaNegativaFirma: refuse, renunciaDocumentoPath: path,
        renunciaDocumentoNombre: fileName, renunciaDocumentoHash: hash, renunciaTelefono: phone,
      };
      if (flow.worker?.id) {
        await updateDocument('trabajadores', flow.worker.id, metadata as any);
        renouncedWorkerIds.current.add(Number(flow.worker.id));
      }
      await createDocument('contrataciones', `sae-renuncia-${flow.candidate.id}`, {
        trabajadorId: flow.worker?.id || flow.candidate.existing_worker_id || null,
        obra: flow.worker?.obra || candidateWork(flow.candidate, flow.need),
        numOferta: flow.worker?.numOferta || flow.candidate.offer_number || '',
        categoria: flow.worker?.categoria || candidateCategory(flow.candidate),
        periodoInicio: flow.worker?.periodoInicio || '', periodoFin: flow.worker?.periodoFin || '',
        quincena: flow.worker?.quincena || fortnightLabel(flow.candidate.fortnight), estado: 'Renuncia',
        observaciones: `Renuncia SAE 2100${refuse ? ' · negativa a firmar' : ' · documento firmado'}`,
        candidateId: flow.candidate.id, needId: flow.candidate.need_id, ...metadata,
      } as any).catch(error => console.warn('No se pudo sincronizar la tabla de contrataciones:', error));
      await refreshRenouncedWorkers();
      setRefused(refuse);
      setStep('done');
      if (!refuse && navigator.share && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ title: 'Renuncia a contratación PROFEA', text: `Copia firmada de la renuncia de ${displayName}.`, files: [file] }); } catch {}
      }
    } catch (error: any) {
      window.alert(error?.message || 'No se pudo generar y archivar el documento de renuncia.');
    } finally {
      setBusy(false);
    }
  };

  const shareWhatsapp = async () => {
    if (!flow || !pdfFile) return;
    const text = `Hola ${displayName}. Te envío copia del informe de renuncia a la contratación PROFEA correspondiente a ${work || 'la obra indicada'}, registrado con código SAE 2100.`;
    if (navigator.share && navigator.canShare?.({ files: [pdfFile] })) {
      try { await navigator.share({ title: 'Renuncia contratación PROFEA', text, files: [pdfFile] }); return; } catch {}
    }
    const phoneValue = formatPhoneForWhatsapp(phone);
    window.open(`https://wa.me/${phoneValue}?text=${encodeURIComponent(`${text}\n\nEl PDF firmado está generado. Adjunta el archivo descargado desde GestionPROFEA.`)}`, '_blank', 'noopener,noreferrer');
  };

  if (!flow) return null;
  return <div className="fixed inset-0 z-[260] bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-end sm:items-center justify-center">
    <div className="w-full max-w-3xl max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
      <div className="sticky top-0 z-10 p-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur flex justify-between gap-3">
        <div><div className="font-black text-lg">Renuncia detectada · SAE 2100</div><div className="text-xs text-slate-500">{displayName} · {work || 'Obra pendiente'}</div></div>
        <button type="button" onClick={close} className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 grid place-items-center"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-4 sm:p-6">
        {step === 'confirm' && <div className="space-y-5">
          <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 flex gap-3"><AlertTriangle className="w-6 h-6 text-red-600 shrink-0" /><div><div className="font-black text-red-800 dark:text-red-200">Se ha registrado “2100 · Rechazo voluntario”.</div><p className="text-sm text-red-700 dark:text-red-300 mt-1">¿Quieres iniciar ahora el proceso de renuncia, generar el documento y recoger la firma del trabajador?</p></div></div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm"><Info label="Trabajador" value={displayName} /><Info label="DNI / NIE" value={flow.worker?.dni || 'No consta'} /><Info label="Obra" value={work || 'No consta'} /><Info label="Categoría" value={flow.worker?.categoria || candidateCategory(flow.candidate) || 'No consta'} /><Info label="Oferta SAE" value={flow.worker?.numOferta || flow.candidate.offer_number || 'No consta'} /><Info label="Teléfono" value={flow.worker?.telefono || 'No consta'} /></div>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2"><button type="button" onClick={close} className="px-4 py-3 rounded-xl border font-bold">Ahora no</button><button type="button" onClick={() => setStep('sign')} className="px-5 py-3 rounded-xl bg-red-600 text-white font-black inline-flex items-center justify-center gap-2"><FileSignature className="w-4 h-4" />Generar documento de renuncia</button></div>
        </div>}
        {step === 'sign' && <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3"><label className="block"><span className="text-[10px] uppercase tracking-wider font-black text-slate-400">Teléfono para WhatsApp</span><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" className="ui-input mt-1.5 w-full" placeholder="Teléfono del trabajador" /></label><label className="block"><span className="text-[10px] uppercase tracking-wider font-black text-slate-400">DNI / NIE</span><input value={flow.worker?.dni || ''} readOnly className="ui-input mt-1.5 w-full bg-slate-50 dark:bg-slate-800" placeholder="No consta en la ficha" /></label></div>
          <div className="rounded-xl border p-4 text-sm"><b>Declaración:</b> {displayName} manifiesta voluntariamente su renuncia a la contratación de la oferta <b>{flow.candidate.offer_number || '—'}</b> para <b>{work || 'la obra indicada'}</b>.</div>
          <label className="block"><span className="text-[10px] uppercase tracking-wider font-black text-slate-400">Observaciones opcionales</span><textarea value={observations} onChange={e => setObservations(e.target.value)} rows={2} className="ui-input mt-1.5 w-full" /></label>
          <div><div className="text-sm font-black mb-2">Firma del trabajador</div><SignaturePad onChange={setSignature} /></div>
          <label className="flex items-start gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 w-5 h-5 accent-[#00548E]" /><span>El trabajador declara haber leído el documento y manifiesta voluntariamente su renuncia a la contratación indicada.</span></label>
          <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2"><button type="button" onClick={() => void finalize(true)} disabled={busy} className="rounded-xl border border-amber-300 text-amber-800 dark:text-amber-300 px-4 py-3 font-bold">El trabajador se niega a firmar</button><button type="button" onClick={() => setStep('confirm')} disabled={busy} className="rounded-xl border px-4 py-3 font-bold">Volver</button><button type="button" onClick={() => void finalize(false)} disabled={busy || !signature || !consent} className="rounded-xl bg-red-600 text-white px-5 py-3 font-black disabled:opacity-40">{busy ? 'Generando…' : 'Aceptar y cerrar renuncia'}</button></div>
        </div>}
        {step === 'done' && <div className="space-y-5">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 p-5 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" /><div className="font-black text-lg mt-2">RENUNCIA REGISTRADA</div><div className="text-sm text-slate-600 dark:text-slate-300 mt-1">{refused ? 'Documento generado dejando constancia de la negativa a firmar.' : 'Documento firmado y archivado correctamente.'}</div></div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm"><Info label="Trabajador" value={displayName} /><Info label="Código SAE" value="2100 · Rechazo voluntario" /><Info label="Obra" value={work || '—'} /><Info label="Documento" value={archivePath ? 'Archivado ✓' : '—'} /></div>
          <div className="grid sm:grid-cols-3 gap-2">{pdfUrl && <a href={pdfUrl} download={pdfFile?.name || 'renuncia.pdf'} className="rounded-xl border px-4 py-3 font-bold inline-flex items-center justify-center gap-2"><Download className="w-4 h-4" />Descargar PDF</a>}<button type="button" onClick={() => void shareWhatsapp()} className="rounded-xl bg-[#25D366] text-white px-4 py-3 font-black inline-flex items-center justify-center gap-2"><Send className="w-4 h-4" />Compartir por WhatsApp</button><button type="button" onClick={close} className="rounded-xl bg-slate-900 dark:bg-blue-600 text-white px-4 py-3 font-bold">Cerrar</button></div>
          <p className="text-[11px] text-slate-500">En móviles compatibles, “Compartir por WhatsApp” abre la hoja de compartir con el PDF adjunto. El envío definitivo requiere la confirmación del usuario en WhatsApp.</p>
        </div>}
      </div>
    </div>
  </div>;
};

const Info = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3"><div className="text-[10px] uppercase tracking-wider font-black text-slate-400">{label}</div><div className="font-bold mt-1 break-words">{value || '—'}</div></div>;
