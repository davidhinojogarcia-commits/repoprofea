import { SIGNATURE_INK } from '../src/lib/signatureInk';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import {
  CheckCircle2,
  ExternalLink,
  FileSignature,
  FileText,
  PencilLine,
  Printer,
  RotateCcw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import type { Person } from '../types';
import { getDocuments } from '../src/services/databaseService';
import { getSessionUser, supabase } from '../src/lib/supabase';
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
    ctx.strokeStyle = SIGNATURE_INK;
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
  docType: AdditionalWorksiteDocumentType;
}

export const AdditionalWorksiteDocumentsWorkspace: React.FC<AdditionalWorksiteDocumentsWorkspaceProps> = ({
  selectedWork,
  docType,
}) => {
  const [loading, setLoading] = useState(false);
  const [workers, setWorkers] = useState<Person[]>([]);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerPickerOpen, setWorkerPickerOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supervisorName, setSupervisorName] = useState('');
  const [workMode, setWorkMode] = useState<'filled' | 'blank'>('filled');
  const [answers, setAnswers] = useState<WorksiteDocumentAnswers>({});
  const [signatures, setSignatures] = useState<WorksiteDocumentSignatures>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setLoading(true);
      try {
        const [people, obras, sessionUser] = await Promise.all([
          getDocuments<Person>('trabajadores'),
          supabase.query('obras', {
            query: 'select=id,nombre,municipio,empresa,cif,recurso_preventivo&order=nombre.asc',
          }),
          getSessionUser(),
        ]);
        if (cancelled) return;
        setWorkers(people || []);
        setWorks((obras || []) as WorkRow[]);
        const uid = sessionUser?.id;
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
              safe(sessionUser?.email),
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

  const filteredWorkers = useMemo(() => {
    const term = norm(workerSearch);
    if (!term) return workWorkers.slice(0, 12);
    return workWorkers
      .filter((item) =>
        [
          item.apellidosNombre,
          item.dni,
          item.categoria,
          item.numOferta,
          item.telefono,
        ].some((value) => norm(String(value || '')).includes(term)),
      )
      .slice(0, 20);
  }, [workWorkers, workerSearch]);

  useEffect(() => {
    if (selectedWorkerId && !workWorkers.some((worker) => String(worker.id) === selectedWorkerId)) {
      setSelectedWorkerId('');
      setWorkerSearch('');
    }
  }, [selectedWorkerId, workWorkers]);

  useEffect(() => {
    setSelectedWorkerId('');
    setWorkerSearch('');
    setWorkerPickerOpen(false);
  }, [selectedWork]);

  const worker = workWorkers.find((item) => String(item.id) === selectedWorkerId) || null;
  const row = works.find((item) => sameWork(item.nombre, selectedWork));
  const def = ADDITIONAL_WORKSITE_DOCUMENTS[docType];

  useEffect(() => {
    setAnswers({});
    setSignatures({});
    setWorkMode('filled');
    setPreviewOpen(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
  }, [docType]);

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

  const generateBlank = () => {
    if (!selectedWork) return window.alert('Selecciona una obra.');
    const { doc, filename } = generateAdditionalWorksiteDocument(
      docType,
      null,
      documentContext,
      {},
      {},
    );
    downloadPDF(doc, filename);
  };

  const validateFilledDocument = (requireSignatures: boolean) => {
    if (!worker) {
      window.alert('Selecciona primero un trabajador.');
      return false;
    }
    if (!safe(row?.recurso_preventivo)) {
      window.alert('La obra no tiene encargado/recurso preventivo configurado.');
      return false;
    }
    if (!supervisorName) {
      window.alert('No se ha podido identificar el supervisor de la cuenta.');
      return false;
    }
    const missingFields = def.fields
      .filter((field) => field.required && !safe(answers[field.key]))
      .map((field) => field.label);
    if (missingFields.length) {
      window.alert(`Completa los campos obligatorios: ${missingFields.join(', ')}.`);
      return false;
    }
    if (requireSignatures) {
      const missingSignatures: string[] = [];
      if (def.signatureWorker && !signatures.worker) missingSignatures.push('trabajador');
      if (def.signatureCompany && !signatures.foreman) missingSignatures.push('encargado');
      if (def.signatureCompany && !signatures.supervisor) missingSignatures.push('supervisor');
      if (missingSignatures.length) {
        window.alert(`Faltan firmas: ${missingSignatures.join(', ')}.`);
        return false;
      }
    }
    return true;
  };

  const generateFilled = () => {
    if (!validateFilledDocument(true) || !worker) return;
    const { doc, filename } = generateAdditionalWorksiteDocument(
      docType,
      worker,
      documentContext,
      answers,
      signatures,
    );
    downloadPDF(doc, filename);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
  };

  const openPreview = () => {
    if (!selectedWork) return window.alert('Selecciona una obra.');
    if (workMode === 'filled' && !worker) {
      return window.alert('Selecciona un trabajador para previsualizar el documento cumplimentado.');
    }

    const { doc } =
      workMode === 'blank'
        ? generateAdditionalWorksiteDocument(docType, null, documentContext, {}, {})
        : generateAdditionalWorksiteDocument(
            docType,
            worker,
            documentContext,
            answers,
            signatures,
          );
    const url = URL.createObjectURL(doc.output('blob'));
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
    setPreviewOpen(true);
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
            <h2 className="font-black text-xl">{def.short}</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Documento seleccionado desde la biblioteca lateral. Completa los datos o genera directamente la plantilla en blanco.
          </p>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-2 bg-slate-50 dark:bg-slate-950">
            <div className="grid sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWorkMode('filled')}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${
                  workMode === 'filled'
                    ? 'bg-[#00548E] text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'
                }`}
              >
                <PencilLine className="w-4 h-4" />
                Completar y firmar
              </button>
              <button
                type="button"
                onClick={() => setWorkMode('blank')}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${
                  workMode === 'blank'
                    ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'
                }`}
              >
                <Printer className="w-4 h-4" />
                Generar en blanco
              </button>
            </div>
          </div>

          {workMode === 'blank' && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-200">
              <div className="font-black">Modo plantilla en blanco</div>
              <p className="mt-1 text-xs">
                Los datos del trabajador, campos y firmas quedan bloqueados. Puedes previsualizar la plantilla o generar directamente el PDF en blanco.
              </p>
            </div>
          )}

          <div className={workMode === 'blank' ? 'pointer-events-none opacity-45 select-none' : ''}>
            <div className="grid lg:grid-cols-2 gap-4">
              <label className="text-sm font-bold">
                Fecha
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  disabled={workMode === 'blank'}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-3 bg-white dark:bg-slate-900 disabled:cursor-not-allowed"
                />
              </label>

              <div className="text-sm font-bold">
                <div className="flex items-center justify-between gap-2">
                  <span>Trabajador</span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {workWorkers.length} en esta obra
                  </span>
                </div>

                {worker ? (
                  <div className="mt-1.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/20 p-3">
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 rounded-lg bg-white dark:bg-slate-900 border border-blue-100 dark:border-blue-900 p-2 text-[#00548E] dark:text-blue-300">
                        <UserRound className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-black text-sm leading-tight">{worker.apellidosNombre}</div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {worker.dni || 'Sin DNI'} · {worker.categoria || 'Sin puesto'}
                        </div>
                        {worker.numOferta && (
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            Oferta: {worker.numOferta}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedWorkerId('');
                          setWorkerSearch('');
                          setWorkerPickerOpen(true);
                        }}
                        className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-500 hover:text-red-600"
                        title="Cambiar trabajador"
                        aria-label="Cambiar trabajador"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWorkerId('');
                        setWorkerSearch('');
                        setWorkerPickerOpen(true);
                      }}
                      className="mt-2 w-full rounded-lg border border-blue-200 dark:border-blue-800 bg-white/80 dark:bg-slate-900 px-3 py-2 text-xs font-bold text-[#00548E] dark:text-blue-300"
                    >
                      Buscar otro trabajador
                    </button>
                  </div>
                ) : (
                  <div className="relative mt-1.5">
                    <Search className="pointer-events-none absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                    <input
                      type="search"
                      value={workerSearch}
                      onChange={(event) => {
                        setWorkerSearch(event.target.value);
                        setWorkerPickerOpen(true);
                      }}
                      onFocus={() => setWorkerPickerOpen(true)}
                      placeholder="Nombre, DNI, puesto u oferta…"
                      autoComplete="off"
                      disabled={workMode === 'blank'}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-3 text-sm font-semibold outline-none focus:border-[#00548E] focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950"
                    />

                    {workerPickerOpen && workMode === 'filled' && (
                      <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
                        {filteredWorkers.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSelectedWorkerId(String(item.id));
                              setWorkerSearch('');
                              setWorkerPickerOpen(false);
                            }}
                            className="w-full border-b last:border-b-0 border-slate-100 dark:border-slate-800 px-3 py-3 text-left hover:bg-blue-50 dark:hover:bg-blue-950/30"
                          >
                            <div className="font-black text-sm">{item.apellidosNombre}</div>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              <span>{item.dni || 'Sin DNI'}</span>
                              <span>· {item.categoria || 'Sin puesto'}</span>
                              {item.numOferta && <span>· Oferta {item.numOferta}</span>}
                            </div>
                          </button>
                        ))}
                        {!filteredWorkers.length && (
                          <div className="px-4 py-5 text-center text-xs text-slate-500">
                            No hay trabajadores que coincidan con “{workerSearch}”.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <div>
                <b>Obra:</b> {selectedWork}
              </div>
              <div>
                <b>Encargado/a:</b> {safe(row?.recurso_preventivo) || 'No configurado'}
              </div>
              <div>
                <b>Supervisor/a:</b> {supervisorName || 'No identificado'}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/60 dark:border-blue-900/70 dark:bg-blue-950/20 p-4">
              <div className="font-black">{def.title}</div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">{def.legal}</p>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <PencilLine className="w-4 h-4 text-[#00548E] dark:text-blue-400" />
                <h3 className="font-black">Datos del documento</h3>
              </div>
              {def.fields.length ? (
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
              ) : (
                <div className="text-sm text-slate-500">
                  Este documento no requiere campos adicionales.
                </div>
              )}
            </div>

            {(def.signatureWorker || def.signatureCompany) && (
              <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4">
                  <FileSignature className="w-4 h-4 text-[#00548E] dark:text-blue-400" />
                  <h3 className="font-black">Firmas</h3>
                </div>
                <div className="space-y-4">
                  {def.signatureWorker && (
                    <SignaturePad
                      label="Firma de la persona trabajadora"
                      name={worker?.apellidosNombre || ''}
                      value={signatures.worker || ''}
                      onChange={(value) =>
                        setSignatures((current) => ({ ...current, worker: value }))
                      }
                    />
                  )}
                  {def.signatureCompany && (
                    <div className="grid lg:grid-cols-2 gap-4">
                      <SignaturePad
                        label="Firma del encargado/a de obra"
                        name={safe(row?.recurso_preventivo)}
                        value={signatures.foreman || ''}
                        onChange={(value) =>
                          setSignatures((current) => ({ ...current, foreman: value }))
                        }
                      />
                      <SignaturePad
                        label="Firma del supervisor/a"
                        name={supervisorName}
                        value={signatures.supervisor || ''}
                        onChange={(value) =>
                          setSignatures((current) => ({ ...current, supervisor: value }))
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-2 z-20 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur p-3 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={openPreview}
                disabled={loading || (workMode === 'filled' && !worker)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#00548E]/30 bg-blue-50 dark:bg-blue-950/30 text-[#00548E] dark:text-blue-300 px-5 py-3 text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ExternalLink className="w-4 h-4" />
                Previsualizar documento
              </button>
              <button
                type="button"
                onClick={workMode === 'blank' ? generateBlank : generateFilled}
                disabled={loading || (workMode === 'filled' && !worker)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-5 py-3 text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {workMode === 'blank' ? <Printer className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {workMode === 'blank' ? 'Generar PDF en blanco' : 'Generar PDF firmado'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {previewOpen && (
        <ModalPortal label="AdditionalWorksiteDocumentsPanel"><div className="fixed inset-0 z-[135] bg-slate-950/75 p-0 sm:p-5 flex items-center justify-center">
          <div className="w-full h-full sm:h-[94vh] sm:max-w-6xl bg-white dark:bg-slate-950 sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-5 py-3 bg-white dark:bg-slate-950">
              <div className="min-w-0">
                <div className="font-black">Previsualización · {def.short}</div>
                <div className="text-[11px] text-slate-500">
                  {workMode === 'blank' ? 'Plantilla en blanco' : worker?.apellidosNombre || 'Documento cumplimentado'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {previewUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir aparte
                  </button>
                )}
                <button
                  type="button"
                  onClick={closePreview}
                  className="rounded-xl border p-2"
                  aria-label="Cerrar previsualización"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900">
              {previewUrl ? (
                <>
                  <iframe
                    title={`Previsualización ${def.short}`}
                    src={previewUrl}
                    className="hidden sm:block w-full h-full bg-white"
                  />
                  <div className="sm:hidden h-full p-5 grid place-items-center">
                    <button
                      type="button"
                      onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-4 font-black"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Ver documento a pantalla completa
                    </button>
                  </div>
                </>
              ) : (
                <div className="h-full grid place-items-center text-sm text-slate-500">
                  Preparando vista previa…
                </div>
              )}
            </div>
          </div>
        </div></ModalPortal>
      )}
    </>
  );
};

// Se mantiene este export para no romper imports antiguos. La biblioteca ya se
// integra directamente dentro de Documentación de obra y no muestra un botón flotante.
export const AdditionalWorksiteDocumentsPanel: React.FC = () => null;

