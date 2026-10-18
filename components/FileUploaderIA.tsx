import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import {
  CheckCircle2,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import {
  Subcontratista,
  SubcontrataDocItem,
  SubcontrataEstadoExpediente,
  SubcontrataTrabajadorCAE,
} from '../types';
import {
  ChecklistReviewModal,
  ProposedChecklistChange,
  ReviewSource,
} from './ChecklistReviewModal';
import { extractClientDocumentText } from '../src/lib/clientDocumentText';
import { verifySubcontractorPersonnel } from '../src/lib/caePersonnelVerifier';
import { fillCaeDocumentDates } from '../src/lib/caeDocumentDates';

interface Props {
  subcontrata: Subcontratista;
  onChecklistUpdate: (
    items: SubcontrataDocItem[],
    estado: SubcontrataEstadoExpediente,
    summary: string,
  ) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  onFilterMissingInRed?: () => void;
  onOpenRequerimiento?: () => void;
  onWorkersUpdate?: (workers: SubcontrataTrabajadorCAE[]) => void;
}

type Upload = {
  name: string;
  type: string;
  extractedText: string;
  extractionSource: string;
};

const safeJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Respuesta no válida del servidor (${response.status}).` };
  }
};

const postJson = async (path: string, payload: any, label: string) => {
  const endpoint = `${window.location.origin}${path}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(`[CAE] ${label}`, error);
    throw new Error(`No se pudo conectar con el servicio de ${label}.`);
  }

  if (response.status === 413) {
    throw new Error(
      'El lote de documentación sigue superando el tamaño permitido por el servidor. Reduzca temporalmente el número de archivos y vuelva a intentarlo.',
    );
  }

  const data = await safeJson(response);
  if (!response.ok) throw new Error(data?.error || `Error ${response.status} en ${label}.`);
  return data;
};

const isVisualFile = (file: File) =>
  file.type === 'application/pdf' ||
  file.type.startsWith('image/') ||
  /\.(pdf|png|jpe?g|webp)$/i.test(file.name);

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FileUploaderIA: React.FC<Props> = ({
  subcontrata,
  onChecklistUpdate,
  onToast,
  onWorkersUpdate,
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [review, setReview] = useState(false);
  const [changes, setChanges] = useState<ProposedChecklistChange[]>([]);
  const [reviewSources, setReviewSources] = useState<ReviewSource[]>([]);
  const [summary, setSummary] = useState('');
  const [workers, setWorkers] = useState<any[]>([]);

  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl('');
      setPreviewText('');
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl = '';

    const preparePreview = async () => {
      setPreviewText('');
      setPreviewError('');

      if (isVisualFile(previewFile)) {
        objectUrl = URL.createObjectURL(previewFile);
        if (!cancelled) setPreviewUrl(objectUrl);
        return;
      }

      setPreviewUrl('');
      setPreviewLoading(true);
      try {
        const result = await extractClientDocumentText(previewFile);
        if (cancelled) return;
        setPreviewText(result.text?.trim() || '');
        if (!result.text?.trim()) {
          setPreviewError(
            'No se ha podido generar una vista textual de este archivo. El documento sí puede incluirse en el análisis automático.',
          );
        }
      } catch (error) {
        console.error('[CAE] No se pudo preparar la previsualización local:', error);
        if (!cancelled) {
          setPreviewError(
            'No se ha podido previsualizar este archivo, pero puede mantenerse seleccionado para el análisis.',
          );
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    void preparePreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewFile]);

  const add = (list: File[]) => {
    const accepted = list.filter(
      file =>
        file.type === 'application/pdf' ||
        file.type.startsWith('image/') ||
        /\.(pdf|png|jpe?g|docx?|xlsx?)$/i.test(file.name),
    );

    if (!accepted.length) {
      onToast('Seleccione PDF, Word, Excel o imágenes.', 'error');
      return;
    }

    setFiles(previous => [
      ...previous,
      ...accepted.filter(
        file => !previous.some(existing => existing.name === file.name && existing.size === file.size),
      ),
    ]);
  };

  const removeFile = (file: File) => {
    setFiles(previous =>
      previous.filter(existing => !(existing.name === file.name && existing.size === file.size)),
    );
    if (previewFile?.name === file.name && previewFile.size === file.size) setPreviewFile(null);
  };

  const convert = async (file: File): Promise<Upload> => {
    let extractedText = '';
    let extractionSource = 'none';

    try {
      const result = await extractClientDocumentText(file, message =>
        setProgress(`${file.name}: ${message}`),
      );
      extractedText = result.text;
      extractionSource = result.source;
    } catch (error) {
      reportOperationalError('[CAE] extracción local no disponible', error, 'warn');
    }

    return {
      name: file.name,
      type: file.type || 'application/octet-stream',
      extractedText,
      extractionSource,
    };
  };

  const analyze = async () => {
    if (!files.length) {
      onToast('Seleccione al menos un documento.', 'error');
      return;
    }

    setBusy(true);
    setReview(false);

    try {
      const converted: Upload[] = [];
      for (let index = 0; index < files.length; index++) {
        setProgress(`Preparando ${index + 1}/${files.length}: ${files[index].name}`);
        converted.push(await convert(files[index]));
      }

      const payload = {
        files: converted,
        subcontrata: {
          nombreEmpresa: subcontrata.nombreEmpresa,
          cif: subcontrata.cif,
          obra: subcontrata.obra,
          actividadGremio: subcontrata.actividadGremio,
        },
        currentChecklist: subcontrata.checklist,
      };

      setProgress('Identificando documentos y cotejando trabajadores con ITA/RNT/IDC…');
      const data = await postJson(
        '/api/analyze-subcontractor-docs-v3',
        payload,
        'análisis documental CAE',
      );
      if (!data.success) throw new Error(data.error || 'No se pudo analizar la documentación.');

      setProgress('Validando Acta de Adhesión al PSS…');
      try {
        const validation = await postJson(
          '/api/validate-adhesion-pss',
          payload,
          'validación del Acta de Adhesión',
        );

        if (validation.found && validation.documento) {
          const documents = Array.isArray(data.documentosAnalizados)
            ? data.documentosAnalizados
            : [];
          const index = documents.findIndex((item: any) => item.docId === 'adhesion_pss');

          if (index >= 0) documents[index] = { ...documents[index], ...validation.documento };
          else documents.push(validation.documento);

          data.documentosAnalizados = documents;

          if (validation.documento.estado === 'incompleto') {
            data.resumenDiagnostico = `${data.resumenDiagnostico || ''} Acta de Adhesión al PSS con incidencias: ${validation.documento.observaciones}`.trim();
          }
        }
      } catch (error) {
        console.warn('[CAE] validación PSS no bloqueante', error);
      }

      data.documentosAnalizados = fillCaeDocumentDates(
        data.documentosAnalizados || [],
        converted,
        subcontrata.checklist,
      );

      const byId = new Map<string, any>();
      for (const item of data.documentosAnalizados || []) {
        const previous = byId.get(item.docId);
        const score =
          (item.fechaEmision ? 2 : 0) +
          (item.fechaCaducidad ? 2 : 0) +
          (item.confianza === 'alta' ? 2 : item.confianza === 'media' ? 1 : 0);
        const previousScore = previous
          ? (previous.fechaEmision ? 2 : 0) +
            (previous.fechaCaducidad ? 2 : 0) +
            (previous.confianza === 'alta' ? 2 : previous.confianza === 'media' ? 1 : 0)
          : -1;
        if (score > previousScore) byId.set(item.docId, item);
      }

      const next: ProposedChecklistChange[] = subcontrata.checklist.flatMap(item => {
        const detected: any = byId.get(item.id);
        if (!detected) return [];

        return [
          {
            docId: item.id,
            nombre: item.nombre,
            categoria: item.categoria,
            normativa: item.normativa,
            obligatorio: item.obligatorio,
            estadoActual: item.estado,
            estadoPropuesto: detected.estado,
            fechaEntregaActual: item.fechaEntrega,
            fechaEntregaPropuesta: detected.fechaEmision || '',
            fechaCaducidadActual: item.fechaCaducidad,
            fechaCaducidadPropuesta: detected.fechaCaducidad || '',
            observacionesActuales: item.observaciones,
            observacionesPropuestas: detected.observaciones || '',
            archivoOrigen: detected.archivoOrigen || '',
            estaCaducado: detected.estaCaducado,
            diasCaducado: detected.diasCaducado,
            diasRestantes: detected.diasRestantes,
            esProximaCaducidad: detected.esProximaCaducidad,
            motivoCaducidad: detected.motivoCaducidad,
            esLegible: detected.esLegible !== false,
            validezIA:
              detected.estado === 'incompleto'
                ? 'INCIDENCIA'
                : detected.estaCaducado
                  ? 'CADUCADO'
                  : 'VERIFICADO',
            confianza: detected.confianza,
            selected: true,
          },
        ];
      });

      const detectedDateCount = next.filter(
        change =>
          change.fechaEntregaPropuesta !== (change.fechaEntregaActual || '') ||
          change.fechaCaducidadPropuesta !== (change.fechaCaducidadActual || ''),
      ).length;

      const verified = verifySubcontractorPersonnel(
        data.trabajadoresDetectados || [],
        converted,
        subcontrata.checklist,
      );

      setChanges(next);
      setWorkers(verified);
      setReviewSources(
        converted.map(upload => ({
          ...upload,
          file: files.find(
            source => source.name === upload.name && (source.type || 'application/octet-stream') === upload.type,
          ) || files.find(source => source.name === upload.name),
        })),
      );
      setSummary(data.resumenDiagnostico || 'Expediente analizado.');

      // La revisión humana empieza únicamente cuando el análisis automático ha terminado.
      // No se modifica el checklist antes de que el supervisor confirme documento a documento.
      if (next.length) setReview(true);

      const pss = next.find(item => item.docId === 'adhesion_pss');
      if (pss?.estadoPropuesto === 'incompleto') {
        onToast(
          `Análisis terminado. Acta de Adhesión con incidencia: ${pss.observacionesPropuestas || 'faltan datos o firmas obligatorias.'} Revise ahora los documentos uno a uno.`,
          'error',
        );
      } else if (next.length) {
        onToast(
          `Análisis terminado: ${next.length} requisito(s), ${detectedDateCount} fecha(s) detectadas y ${verified.length} trabajador(es) cotejados. Revise ahora cada documento antes de aplicar los cambios.`,
          'success',
        );
      } else {
        onToast(
          'El análisis ha terminado, pero no se han identificado requisitos del checklist para revisar.',
          'error',
        );
      }
    } catch (error: any) {
      console.error('[CAE] análisis interrumpido', error);
      const message = String(error?.message || '');
      onToast(
        message && message !== 'The string did not match the expected pattern.'
          ? message
          : 'No se pudo completar el análisis documental en este dispositivo. Vuelva a seleccionar los archivos y repita el análisis.',
        'error',
      );
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const apply = (confirmed: ProposedChecklistChange[]) => {
    const updated = subcontrata.checklist.map(item => {
      const change = confirmed.find(candidate => candidate.docId === item.id);
      if (!change) return item;

      const validezIA =
        change.estadoPropuesto === 'entregado'
          ? 'VERIFICADO'
          : change.estadoPropuesto === 'caducado'
            ? 'CADUCADO'
            : change.estadoPropuesto === 'incompleto'
              ? 'INCIDENCIA'
              : change.validezIA;

      return {
        ...item,
        estado: change.estadoPropuesto,
        fechaEntrega: change.fechaEntregaPropuesta || item.fechaEntrega,
        fechaCaducidad: change.fechaCaducidadPropuesta || item.fechaCaducidad,
        observaciones: change.observacionesPropuestas || item.observaciones,
        detectadoPorIA: true,
        validezIA,
      };
    });

    const blocking = updated.some(
      item =>
        item.obligatorio &&
        ['pendiente', 'caducado', 'incompleto'].includes(item.estado),
    );

    onChecklistUpdate(updated, blocking ? 'condicionado' : 'apto', summary);
    setReview(false);
    onToast('Revisión CAE aplicada al checklist correctamente.', 'success');
  };

  const saveWorkers = () => {
    if (!workers.length) return;
    const confirmedWorkers = workers.map((worker: any) => ({
      ...worker,
      confirmadoPorUsuario: true,
    })) as SubcontrataTrabajadorCAE[];

    if (onWorkersUpdate) onWorkersUpdate(confirmedWorkers);

    onToast(
      `${confirmedWorkers.length} trabajador(es) incorporados al apartado "Trabajadores de la empresa".`,
      'success',
    );
    setWorkers([]);
    setFiles([]);
  };

  return (
    <div className="space-y-4">
      <div className="ui-surface p-5 space-y-4">
        <div>
          <h3 className="font-bold">Comprobación documental CAE</h3>
          <p className="text-xs text-slate-500">
            Seleccione la documentación, previsualice los archivos que necesite y después ejecute
            el análisis automático. La revisión manual se realizará al finalizar el análisis.
          </p>
        </div>

        <div
          onClick={() => input.current?.click()}
          className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer"
        >
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={event => {
              if (event.target.files) add(Array.from(event.target.files));
              event.target.value = '';
            }}
          />
          <UploadCloud className="w-8 h-8 mx-auto mb-2" />
          <b>Seleccione documentación CAE</b>
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {files.length} archivo(s) seleccionado(s)
              </p>
              <p className="text-[11px] text-slate-500">
                Pulse un archivo para previsualizarlo antes del análisis.
              </p>
            </div>

            {files.map(file => (
              <div
                key={`${file.name}-${file.size}`}
                className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 bg-white dark:bg-slate-900"
              >
                <button
                  type="button"
                  onClick={() => setPreviewFile(file)}
                  className="min-w-0 flex-1 flex items-center gap-2 text-left rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 p-1.5"
                  title={`Previsualizar ${file.name}`}
                >
                  {/\.xlsx?$/i.test(file.name) ? (
                    <FileSpreadsheet className="w-4 h-4 shrink-0 text-emerald-600" />
                  ) : (
                    <FileText className="w-4 h-4 shrink-0 text-blue-600" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {file.name}
                    </span>
                    <span className="block text-[10px] text-slate-500">{formatBytes(file.size)}</span>
                  </span>
                  <Eye className="w-4 h-4 shrink-0 text-slate-500" />
                </button>

                <button
                  type="button"
                  onClick={() => removeFile(file)}
                  className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  aria-label={`Eliminar ${file.name}`}
                  title="Quitar archivo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          disabled={busy || !files.length}
          onClick={() => void analyze()}
          className="ui-button-primary inline-flex gap-2 items-center"
        >
          {busy ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <FileCheck className="w-4 h-4" />
          )}
          {busy ? progress || 'Analizando…' : 'Analizar documentación'}
        </button>
      </div>

      {workers.length > 0 && (
        <div className="ui-surface p-5">
          <h3 className="font-bold flex gap-2 items-center">
            <Users className="w-5 h-5" />
            Trabajadores del ITA/RNT/IDC cotejados
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            La plantilla nominal se toma exclusivamente del ITA/RNT/IDC o alta aportada. Los demás
            documentos solo acreditan a esas personas.
          </p>

          {workers.map((worker: any) => (
            <div key={worker.id || worker.dni} className="border rounded-lg p-3 mt-2 text-sm">
              <b>{worker.nombreApellidos || 'Nombre pendiente'}</b> · {worker.dni || 'DNI pendiente'} ·{' '}
              {worker.puestoTrabajo || 'Puesto pendiente'}
              <div className={worker.estadoAcceso === 'autorizado' ? 'text-emerald-700' : 'text-rose-700'}>
                {worker.estadoAcceso === 'autorizado' ? 'AUTORIZADO' : 'NO AUTORIZADO'}
              </div>
              {worker.documentosAcreditados?.length > 0 && (
                <div className="text-xs text-slate-500">
                  Documentos: {worker.documentosAcreditados.join(', ')}
                </div>
              )}
              {worker.motivosNoAutorizado?.length > 0 && (
                <div className="text-xs text-rose-600">
                  {worker.motivosNoAutorizado.join(' · ')}
                </div>
              )}
            </div>
          ))}

          <button
            onClick={saveWorkers}
            className="mt-3 ui-button-primary inline-flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Incorporar a trabajadores de la empresa
          </button>
        </div>
      )}

      {previewFile && (
        <ModalPortal label="Previsualización de archivo"><div
          className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Previsualización de ${previewFile.name}`}
        >
          <div className="w-full max-w-5xl max-h-[92dvh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-200 dark:border-slate-800">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 dark:text-white truncate">
                  {previewFile.name}
                </p>
                <p className="text-xs text-slate-500">
                  Previsualización previa al análisis · {formatBytes(previewFile.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar previsualización"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto bg-slate-100 dark:bg-slate-950 p-3">
              {previewLoading ? (
                <div className="h-72 flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Preparando previsualización…
                </div>
              ) : previewUrl && previewFile.type.startsWith('image/') ? (
                <img
                  src={previewUrl}
                  alt={previewFile.name}
                  className="max-w-full mx-auto rounded-lg shadow bg-white"
                />
              ) : previewUrl ? (
                <iframe
                  src={previewUrl}
                  title={previewFile.name}
                  className="w-full h-[72dvh] rounded-lg bg-white"
                />
              ) : previewText ? (
                <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  {previewText}
                </pre>
              ) : (
                <div className="h-72 flex items-center justify-center text-center p-6">
                  <div>
                    <FileText className="w-10 h-10 mx-auto mb-3 text-slate-400" />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {previewError || 'No hay una vista previa disponible para este archivo.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div></ModalPortal>
      )}

      <ChecklistReviewModal
        isOpen={review}
        subcontrata={subcontrata}
        proposedChanges={changes}
        sourceFiles={files}
        reviewSources={reviewSources}
        onClose={() => setReview(false)}
        onApplyChanges={apply}
      />
    </div>
  );
};
