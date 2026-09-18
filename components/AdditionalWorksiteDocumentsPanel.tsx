import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileSignature,
  FileText,
  PencilLine,
  Printer,
  RotateCcw,
} from 'lucide-react';
import type { Person } from '../types';
import { getDocuments } from '../src/services/databaseService';
import { supabase } from '../src/lib/supabase';
import { downloadPDF } from '../src/lib/exportUtils';
import {
  ADDITIONAL_WORKSITE_DOCUMENTS,
  generateAdditionalWorksiteDocument,
  type AdditionalWorksiteDocumentType,
  type WorksiteDocumentAnswers,
  type WorksiteDocumentSignatures,
} from '../src/lib/worksiteAdditionalDocumentsPdf';

type WorkRow = {
  id: string;
  nombre: string;
  municipio?: string;
  empresa?: string;
  cif?: string;
  recurso_preventivo?: string;
};

const safe = (value: unknown) => String(value ?? '').trim();
const norm = (value: string) =>
  safe(value)
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._\-/:]+/g, ' ')
    .replace(/\s+/g, ' ');
const workIdentity = (value: string) => {
  const raw = norm(value);
  const code = raw.match(/\b(\d{5})\b/)?.[1] || '';
  const compact = raw.replace(/\s+/g, '');
  const type = compact.includes('gr') ? 'GR' : compact.includes('ee') ? 'EE' : '';
  return code && type ? `${code} ${type}` : '';
};
const sameWork = (left: string, right: string) => {
  const a = workIdentity(left);
  const b = workIdentity(right);
  return a && b ? a === b : norm(left) === norm(right);
};

const DEFAULT_COMPANY = 'AEPSA (Diputación Provincial de Cádiz)';
const DEFAULT_CIF = 'P1100000G';

const SignaturePad: React.FC<{
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, name, value, onChange }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.floor(165 * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, 165);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
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
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    const next = point(event);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
  };

  const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onChange(event.currentTarget.toDataURL('image/png'));
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const clear = () => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    onChange('');
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="font-black text-sm">{label}</div>
          <div className="text-xs text-slate-500">{name || 'Nombre pendiente'}</div>
        </div>
        {value && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
            Firmado
          </span>
        )}
      </div>
      <canvas
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="w-full h-[165px] rounded-xl border-2 border-slate-300 bg-white touch-none"
      />
      <div className="mt-2 flex justify-between gap-2">
        <span className="text-xs text-slate-500">Firmar con el dedo o lápiz táctil</span>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Borrar
        </button>
      </div>
    </div>
  );
};

interface AdditionalWorksiteDocumentsWorkspaceProps {
  selectedWork: string;
}

export const AdditionalWorksiteDocumentsWorkspace: React.FC<AdditionalWorksiteDocumentsWorkspaceProps> = ({
  selectedWork,
}) => {
  const [loading, setLoading] = useState(false);
  const [workers, setWorkers] = useState<Person[]>([]);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [docType, setDocType] = useState<AdditionalWorksiteDocumentType>('baja_voluntaria');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supervisorName, setSupervisorName] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [answers, setAnswers] = useState<WorksiteDocumentAnswers>({});
  const [signatures, setSignatures] = useState<WorksiteDocumentSignatures>({});
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setLoading(true);
      try {
        const [people, obras, userResult] = await Promise.all([
          getDocuments<Person>('trabajadores'),
          supabase.query('obras', {
            query: 'select=id,nombre,municipio,empresa,cif,recurso_preventivo&order=nombre.asc',
          }),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        setWorkers(people || []);
        setWorks((obras || []) as WorkRow[]);
        const uid = userResult.data.user?.id;
        if (uid) {
          const profiles = await supabase.query('profiles', {
            query: `select=*&id=eq.${encodeURIComponent(uid)}&limit=1`,
          });
          if (cancelled) return;
          const profile = profiles?.[0] || {};
          setSupervisorName(
            safe(profile.display_name) ||
              safe(profile.full_name) ||
              [safe(profile.nombre), safe(profile.apellidos)].filter(Boolean).join(' ') ||
              safe(userResult.data.user?.email),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  const workWorkers = useMemo(
    () =>
      workers
        .filter((worker) => sameWork(worker.obra || '', selectedWork))
        .sort((a, b) => a.apellidosNombre.localeCompare(b.apellidosNombre, 'es')),
    [workers, selectedWork],
  );

  useEffect(() => {
    if (selectedWorkerId && !workWorkers.some((worker) => String(worker.id) === selectedWorkerId)) {
      setSelectedWorkerId('');
    }
  }, [selectedWorkerId, workWorkers]);

  const worker = workWorkers.find((item) => String(item.id) === selectedWorkerId) || null;
  const row = works.find((item) => sameWork(item.nombre, selectedWork));
  const def = ADDITIONAL_WORKSITE_DOCUMENTS[docType];

  const documentContext = useMemo(
    () => ({
      obra: selectedWork,
      municipio: safe(row?.municipio),
      empresa: safe(row?.empresa) || DEFAULT_COMPANY,
      cif: safe(row?.cif) || DEFAULT_CIF,
      fecha: date,
      responsable: safe(row?.recurso_preventivo),
      supervisor: supervisorName,
    }),
    [selectedWork, row, date, supervisorName],
  );

  useEffect(() => {
    if (!selectedWork) {
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return '';
      });
      return;
    }

    const { doc } = generateAdditionalWorksiteDocument(docType, null, documentContext, {});
    const url = URL.createObjectURL(doc.output('blob'));
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });

    return () => URL.revokeObjectURL(url);
  }, [docType, documentContext, selectedWork]);

  const generateBlank = () => {
    if (!selectedWork) return window.alert('Selecciona una obra.');
    const { doc, filename } = generateAdditionalWorksiteDocument(docType, null, documentContext, {});
    downloadPDF(doc, filename);
  };

  const startFilled = () => {
    if (!worker) return window.alert('Selecciona primero un trabajador.');
    if (!safe(row?.recurso_preventivo)) {
      return window.alert('La obra no tiene encargado/recurso preventivo configurado.');
    }
    if (!supervisorName) return window.alert('No se ha podido identificar el supervisor de la cuenta.');
    setAnswers({});
    setSignatures({});
    setEditOpen(true);
  };

  const continueToSign = () => {
    const missing = def.fields
      .filter((field) => field.required && !safe(answers[field.key]))
      .map((field) => field.label);
    if (missing.length) return window.alert(`Completa antes de firmar: ${missing.join(', ')}.`);
    setEditOpen(false);
    setSignatureOpen(true);
  };

  const finishSigned = () => {
    if (!worker) return;
    const missing: string[] = [];
    if (def.signatureWorker && !signatures.worker) missing.push('trabajador');
    if (def.signatureCompany && !signatures.foreman) missing.push('encargado');
    if (def.signatureCompany && !signatures.supervisor) missing.push('supervisor');
    if (missing.length) return window.alert(`Faltan firmas: ${missing.join(', ')}.`);

    const { doc, filename } = generateAdditionalWorksiteDocument(
      docType,
      worker,
      documentContext,
      answers,
      signatures,
    );
    downloadPDF(doc, filename);
    setSignatureOpen(false);
  };

  const fieldInput = (field: (typeof def.fields)[number]) => {
    const common = {
      value: answers[field.key] || '',
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
      ) => setAnswers((current) => ({ ...current, [field.key]: event.target.value })),
      className:
        'mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5',
    };
    if (field.type === 'textarea') {
      return <textarea {...common} rows={3} placeholder={field.placeholder} />;
    }
    if (field.type === 'select') {
      return (
        <select {...common}>
          <option value="">Seleccionar…</option>
          {(field.options || []).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    }
    return <input {...common} type={field.type || 'text'} placeholder={field.placeholder} />;
  };

  if (!selectedWork) {
    return (
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="text-sm text-slate-500">Selecciona una obra para abrir su biblioteca documental.</div>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#00548E] dark:text-blue-400" />
            <h2 className="font-black text-xl">Otros documentos de obra</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Selecciona el documento. En móvil puedes abrir la plantilla a pantalla completa; en pantallas grandes se previsualiza junto al formulario.
          </p>
        </div>

        <div className="grid 2xl:grid-cols-[minmax(330px,0.8fr)_minmax(0,1.2fr)] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm font-bold">
                Fecha
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2.5 bg-white dark:bg-slate-900"
                />
              </label>
              <label className="text-sm font-bold">
                Trabajador
                <select
                  value={selectedWorkerId}
                  onChange={(event) => setSelectedWorkerId(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2.5 bg-white dark:bg-slate-900"
                >
                  <option value="">Sin seleccionar · plantilla en blanco</option>
                  {workWorkers.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.apellidosNombre} · {item.dni} · {item.categoria || 'Sin puesto'}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <b>Obra:</b> {selectedWork}
              </div>
              <div>
                <b>Encargado/a:</b> {safe(row?.recurso_preventivo) || 'No configurado'}
              </div>
              <div className="sm:col-span-2">
                <b>Supervisor/a:</b> {supervisorName || 'No identificado'}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Tipo de documento
              </div>
              <div className="grid sm:grid-cols-2 2xl:grid-cols-1 gap-2">
                {(Object.entries(ADDITIONAL_WORKSITE_DOCUMENTS) as [
                  AdditionalWorksiteDocumentType,
                  typeof def,
                ][]).map(([key, definition]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDocType(key)}
                    className={`text-left rounded-xl border px-3.5 py-3 transition-colors ${
                      docType === key
                        ? 'border-[#00548E] bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'
                    }`}
                  >
                    <div className="font-black text-sm">{definition.short}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
                      {definition.legal}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50/60 dark:border-blue-900/70 dark:bg-blue-950/20 p-4">
              <div className="font-black">{def.title}</div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">{def.legal}</p>
              <p className="text-[11px] text-slate-500 mt-2">
                Con trabajador seleccionado: completar datos → revisar → firmar → generar PDF.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={generateBlank}
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-3 font-bold"
              >
                <Printer className="w-4 h-4" />
                Generar en blanco
              </button>
              <button
                type="button"
                onClick={startFilled}
                disabled={loading || !worker}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-3 font-bold disabled:opacity-50"
              >
                <PencilLine className="w-4 h-4" />
                Completar y firmar
              </button>
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-100 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
              <div>
                <div className="font-black text-sm">Previsualización</div>
                <div className="text-[11px] text-slate-500">Plantilla · {def.short}</div>
              </div>
              {previewUrl && (
                <button
                  type="button"
                  onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-bold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ampliar
                </button>
              )}
            </div>

            <div className="sm:hidden p-4">
              {previewUrl ? (
                <button
                  type="button"
                  onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                  className="w-full min-h-14 inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-3 font-black"
                >
                  <ExternalLink className="w-4 h-4" />
                  Ver documento a pantalla completa
                </button>
              ) : (
                <div className="min-h-24 grid place-items-center text-sm text-slate-500">
                  Preparando vista previa…
                </div>
              )}
            </div>

            <div className="hidden sm:block">
              {previewUrl ? (
                <iframe
                  title={`Previsualización ${def.short}`}
                  src={previewUrl}
                  className="w-full h-[62vh] min-h-[520px] bg-white"
                />
              ) : (
                <div className="min-h-[420px] grid place-items-center text-sm text-slate-500">
                  Preparando vista previa…
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {editOpen && worker && (
        <div className="fixed inset-0 z-[125] bg-slate-950/70 p-0 sm:p-6 flex items-center justify-center">
          <div className="w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[94vh] overflow-y-auto rounded-none sm:rounded-3xl bg-white dark:bg-slate-950 border-0 sm:border shadow-2xl">
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-black text-xl">Completar documento</h2>
                <p className="text-xs text-slate-500">
                  {def.short} · {worker.apellidosNombre}
                </p>
              </div>
              <button onClick={() => setEditOpen(false)} className="p-2 rounded-xl border">
                ×
              </button>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid sm:grid-cols-2 gap-4">
                {def.fields.map((field) => (
                  <label
                    key={field.key}
                    className={`text-sm font-bold ${field.type === 'textarea' ? 'sm:col-span-2' : ''}`}
                  >
                    {field.label}
                    {field.required && <span className="text-red-600"> *</span>}
                    {fieldInput(field)}
                  </label>
                ))}
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setEditOpen(false)}
                  className="rounded-xl border px-4 py-3 font-bold"
                >
                  Cancelar
                </button>
                <button
                  onClick={continueToSign}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] text-white px-5 py-3 font-bold"
                >
                  <FileSignature className="w-4 h-4" />
                  Continuar a firmas
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {signatureOpen && worker && (
        <div className="fixed inset-0 z-[130] bg-slate-950/70 p-0 sm:p-6 flex items-center justify-center">
          <div className="w-full h-full sm:h-auto sm:max-w-6xl sm:max-h-[94vh] overflow-y-auto rounded-none sm:rounded-3xl bg-white dark:bg-slate-950 border-0 sm:border shadow-2xl">
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-black text-xl">Firma del documento</h2>
                <p className="text-xs text-slate-500">
                  {def.short} · {worker.apellidosNombre}
                </p>
              </div>
              <button onClick={() => setSignatureOpen(false)} className="p-2 rounded-xl border">
                ×
              </button>
            </div>
            <div className="p-5 sm:p-6 space-y-4">
              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-4 text-sm">
                Los datos ya están completados. Firma cada persona requerida y genera el PDF definitivo.
              </div>
              {def.signatureWorker && (
                <SignaturePad
                  label="Firma de la persona trabajadora"
                  name={worker.apellidosNombre}
                  value={signatures.worker || ''}
                  onChange={(value) => setSignatures((current) => ({ ...current, worker: value }))}
                />
              )}
              {def.signatureCompany && (
                <div className="grid lg:grid-cols-2 gap-4">
                  <SignaturePad
                    label="Firma del encargado/a de obra"
                    name={safe(row?.recurso_preventivo)}
                    value={signatures.foreman || ''}
                    onChange={(value) => setSignatures((current) => ({ ...current, foreman: value }))}
                  />
                  <SignaturePad
                    label="Firma del supervisor/a"
                    name={supervisorName}
                    value={signatures.supervisor || ''}
                    onChange={(value) => setSignatures((current) => ({ ...current, supervisor: value }))}
                  />
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setSignatureOpen(false);
                    setEditOpen(true);
                  }}
                  className="rounded-xl border px-4 py-3 font-bold"
                >
                  Volver a editar
                </button>
                <button
                  onClick={finishSigned}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-5 py-3 font-black"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Aceptar firmas y generar PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Se mantiene este export para no romper imports antiguos. La biblioteca ya se
// integra directamente dentro de Documentación de obra y no muestra un botón flotante.
export const AdditionalWorksiteDocumentsPanel: React.FC = () => null;
