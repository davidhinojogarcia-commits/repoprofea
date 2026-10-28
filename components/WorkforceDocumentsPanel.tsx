import React, { useEffect, useRef, useState } from "react";
import {
  FileDown,
  Eye,
  Share2,
  Save,
  FileSignature,
  RefreshCw,
} from "lucide-react";
import { SignaturePad } from "./HandwrittenSignaturePad";
import ModalPortal from "./ModalPortal";
import {
  workforceRequest,
  openWorkforceFile,
} from "../src/services/workforceDocumentsService";
import {
  storeVisitDraft,
  readVisitDraft,
  clearVisitDraft,
} from "../src/lib/visitDraftStore";
import { appConfirm, appPrompt } from "../src/lib/appDialog";
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUS,
  COMMON_FIELDS,
  REJECTION_FIELDS,
  EXIT_FIELDS,
  declaration,
  documentVariant,
  RECEIPT_TEXT,
  LEGAL_NOTE,
  madridInput,
  madridCandidates,
  stamp,
  type Field,
  type DocumentKind,
  type Content,
  type WorkforceDocument,
} from "../src/lib/workforceDocuments/domain";
const input =
  "mt-1 block w-full min-h-[48px] rounded-xl border border-slate-300 bg-white p-3 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const button =
  "inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl border border-slate-300 px-4 py-3 font-bold disabled:opacity-50";
type Draft = {
  id: string;
  workerId: number;
  content: Content;
  expected: number;
  operation?: Record<string, unknown>;
};
export function DocumentInstant({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
}) {
  const local = madridInput(value),
    choices = madridCandidates(local);
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        className={input}
        type="datetime-local"
        disabled={disabled}
        value={local}
        onChange={(e) => {
          const c = madridCandidates(e.target.value);
          onChange(c.length === 1 ? c[0] : e.target.value);
        }}
      />
      {choices.length === 2 && (
        <select
          aria-label={"Desambiguar " + label}
          className={input}
          disabled={disabled}
          value={choices.includes(value) ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecciona la hora en el cambio de horario</option>
          {choices.map((v) => (
            <option key={v} value={v}>
              {v.endsWith("+02:00") ? "UTC+02 (verano)" : "UTC+01 (invierno)"}
            </option>
          ))}
        </select>
      )}
      {local && choices.length === 0 && (
        <span role="alert">
          Hora inexistente o incompleta en Europe/Madrid.
        </span>
      )}
    </label>
  );
}
export default function WorkforceDocumentsPanel({
  kind,
  work,
  token,
}: {
  kind: DocumentKind;
  work?: string;
  token?: string;
  key?: string;
}) {
  const [context, setContext] = useState<any>(null),
    [rows, setRows] = useState<any[]>([]),
    [workers, setWorkers] = useState<any[]>([]),
    [search, setSearch] = useState(""),
    [workerOffset, setWorkerOffset] = useState(0),
    [offset, setOffset] = useState(0);
  const [record, setRecord] = useState<WorkforceDocument | null>(null),
    [history, setHistory] = useState<any[]>([]),
    [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [localStatus, setLocalStatus] = useState("");
  const [signer, setSigner] = useState<"worker" | "foreman" | null>(null),
    [ink, setInk] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(""),
    [returnAt, setReturnAt] = useState(""),
    [actualExit, setActualExit] = useState(""),
    [returnNote, setReturnNote] = useState(""),
    [returnConfirmed, setReturnConfirmed] = useState(false);
  const lock = useRef(false),
    pending = useRef<Record<string, unknown> | null>(null);
  const scope = context
    ? `workforce:${context.owner}:${context.worksite.id}:${kind}:${token ? "foreman" : "supervisor"}`
    : "";
  const call = (b: Record<string, unknown>, signal?: AbortSignal) =>
    workforceRequest({ ...b, kind, work }, token, signal);
  useEffect(() => {
    const abort = new AbortController();
    setContext(null);
    setRecord(null);
    setDraft(null);
    setSigner(null);
    setRows([]);
    setError("");
    setNotice("");
    setOffset(0);
    setWorkerOffset(0);
    setSearch("");
    pending.current = null;
    void call({ action: "context" }, abort.signal)
      .then((r) => setContext(r))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
    };
  }, [kind, work, token]);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void readVisitDraft<Draft>(scope)
      .then((d) => {
        if (d && !cancelled) {
          setDraft(d);
          pending.current = d.operation || null;
          setNotice(
            "Borrador protegido recuperado. Consulta el estado del servidor antes de firmar.",
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);
  useEffect(() => {
    if (!scope || !draft) return;
    let active = true;
    void storeVisitDraft(scope, draft)
      .then(() => {
        if (active) setLocalStatus("Borrador protegido en este dispositivo.");
      })
      .catch(() => {
        if (active)
          setLocalStatus(
            "No se pudo proteger el borrador local. Guarda en el servidor antes de salir.",
          );
      });
    return () => {
      active = false;
    };
  }, [scope, draft]);
  useEffect(() => {
    if (!context) return;
    const abort = new AbortController();
    void call({ action: "list", offset }, abort.signal)
      .then((r) => setRows(r.records))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [context, offset]);
  useEffect(() => {
    if (!context) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void call(
        { action: "workers", search, offset: workerOffset },
        abort.signal,
      )
        .then((r) => setWorkers(r.workers))
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [context, search, workerOffset]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      if (e.name !== "AbortError")
        setError(e.message || "No se confirmó la operación.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    const r = await call({ action: "list", offset });
    setRows(r.records);
  }
  async function open(id: string) {
    if (
      draft &&
      !(await appConfirm(
        "El borrador local se sustituirá por el registro seleccionado. Guarda primero si quieres conservarlo.",
      ))
    )
      return;
    const r = await call({ action: "detail", id });
    setRecord(r.record);
    setHistory(r.history);
    setDraft(null);
    pending.current = null;
    await clearVisitDraft(scope);
    setSigner(null);
    setInk("");
    setConfirmed(false);
  }
  async function command(action: string, extra: Record<string, unknown> = {}) {
    const current = record;
    const body = pending.current || {
      action,
      id: draft?.id || current?.id,
      expected: draft?.expected ?? current?.revision,
      operationId: crypto.randomUUID(),
      ...extra,
    };
    pending.current = body;
    // Only unsigned edits are queued on the device. Ink and access/session tokens never enter draft storage.
    if (action === "save" && draft) {
      setDraft({ ...draft, operation: body });
      await storeVisitDraft(scope, { ...draft, operation: body });
    }
    const r = await call(body);
    pending.current = null;
    setRecord(r.record);
    setDraft(null);
    setSigner(null);
    setInk("");
    setConfirmed(false);
    await clearVisitDraft(scope);
    setNotice("Guardado confirmado por el servidor.");
    await reload();
    const detail = await call({ action: "detail", id: r.record.id });
    setHistory(detail.history);
  }
  async function file(
    action: "view" | "download" | "share",
    revision?: number,
    returnOnly = false,
  ) {
    if (!record) return;
    const r = await call({
      action: "pdf",
      id: record.id,
      ...(revision !== undefined ? { revision } : {}),
      returnOnly,
    });
    if (action === "view") {
      const bytes = Uint8Array.from(atob(r.file.base64), (c: string) =>
        c.charCodeAt(0),
      );
      setPreview(
        URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
      );
    } else await openWorkforceFile(r.file, action);
  }
  function edit() {
    if (!record) return;
    pending.current = null;
    setDraft({
      id: record.id,
      workerId: record.workerId,
      content: { ...record.content },
      expected: record.revision,
    });
    setSigner(null);
    setInk("");
    setConfirmed(false);
  }
  const content = draft?.content || record?.content || {};
  const patch = (key: string, value: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            content: { ...d.content, [key]: value },
            operation: undefined,
          }
        : d,
    );
  const fields = [
    ...COMMON_FIELDS,
    ...(kind === "rechazo_voluntario" ? REJECTION_FIELDS : EXIT_FIELDS),
  ].filter(
    (f) =>
      !(
        (f.key === "returnAt" && content.returnMode !== "at") ||
        (f.key === "duration" && content.returnMode !== "duration")
      ),
  );
  const isFinal =
    record &&
    ["completed", "return_recorded", "annulled"].includes(record.status);
  const mismatch = record && record.kind !== kind;
  if (mismatch)
    return (
      <p role="alert">El registro no corresponde a este tipo documental.</p>
    );
  return (
    <section
      className="space-y-4 rounded-2xl border bg-white p-4 sm:p-6 dark:bg-slate-900"
      aria-label={DOCUMENT_KINDS[kind]}
    >
      <h2 className="text-xl font-black">{DOCUMENT_KINDS[kind]}</h2>
      <p className="text-sm">
        {kind === "salida_obra"
          ? "Comunicación de salida temporal. En una urgencia, la documentación puede quedar en borrador y completarse después con las fechas reales."
          : "Personas contratadas: distinguir no incorporación, cese expreso y rechazo de tarea o riesgo sin voluntad de cesar."}
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-900">
          {notice}
        </p>
      )}
      {!context ? (
        <p>Cargando contexto autorizado…</p>
      ) : (
        <>
          <p className="text-sm">
            {context.worksite.code} · {context.worksite.name} ·{" "}
            {context.worksite.employer || "Entidad pendiente en Configuración"}{" "}
            · Operador: {context.actor.name}
          </p>
          {!record && !draft && (
            <div className="space-y-3">
              <label className="block font-bold">
                Buscar trabajador por nombre
                <input
                  className={input}
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setWorkerOffset(0);
                  }}
                />
              </label>
              <div className="max-h-64 overflow-auto">
                {workers.map((w) => (
                  <button
                    key={w.id}
                    disabled={busy}
                    className={button + " m-1 w-full justify-start text-left"}
                    onClick={() => {
                      setDraft({
                        id: crypto.randomUUID(),
                        workerId: w.id,
                        expected: 0,
                        content: {
                          communication: new Date().toISOString(),
                          contractReference: "",
                          ...(kind === "salida_obra"
                            ? {
                                returnMode: "unknown",
                                returnDay: "unknown",
                                justification: "not_applicable",
                              }
                            : {}),
                        },
                      });
                      setRecord(null);
                    }}
                  >
                    {w.apellidos_nombre} · {w.categoria} · {w.periodo_inicio} /{" "}
                    {w.periodo_fin}
                  </button>
                ))}
              </div>
              <button
                className={button}
                disabled={!workerOffset}
                onClick={() => setWorkerOffset((v) => Math.max(0, v - 30))}
              >
                Trabajadores anteriores
              </button>{" "}
              <button
                className={button}
                disabled={workers.length < 30}
                onClick={() => setWorkerOffset((v) => v + 30)}
              >
                Más trabajadores
              </button>
            </div>
          )}
          {draft && (
            <div className="space-y-4">
              <p className="font-bold">
                Borrador · trabajador #{draft.workerId} · {localStatus}
              </p>
              <p className="text-sm">
                No incluyas diagnóstico, tratamiento ni detalles íntimos.
                Guardar cambios retira las firmas de la nueva versión; las
                anteriores permanecen en el historial.
              </p>
              <fieldset
                disabled={busy || !!pending.current}
                className="grid gap-4 md:grid-cols-2"
              >
                {fields.map((f) => (
                  <div key={f.key}>
                    {f.type === "instant" ? (
                      <DocumentInstant
                        label={f.label}
                        value={content[f.key] || ""}
                        onChange={(v) => patch(f.key, v)}
                      />
                    ) : (
                      <label className="block text-sm font-bold">
                        {f.label}
                        {f.options ? (
                          <select
                            className={input}
                            value={content[f.key] || ""}
                            onChange={(e) => patch(f.key, e.target.value)}
                          >
                            <option value="">Seleccionar…</option>
                            {f.options.map(([v, label]) => (
                              <option key={v} value={v}>
                                {label}
                              </option>
                            ))}
                          </select>
                        ) : f.type === "textarea" ? (
                          <textarea
                            maxLength={4000}
                            rows={3}
                            className={input}
                            value={content[f.key] || ""}
                            onChange={(e) => patch(f.key, e.target.value)}
                          />
                        ) : (
                          <input
                            maxLength={4000}
                            type={f.type || "text"}
                            className={input}
                            value={content[f.key] || ""}
                            onChange={(e) => patch(f.key, e.target.value)}
                          />
                        )}
                      </label>
                    )}
                  </div>
                ))}
              </fieldset>
              {["task", "risk"].includes(content.intention) &&
                kind === "rechazo_voluntario" && (
                  <p role="alert">
                    No corresponde un cese voluntario. Conserva este borrador y
                    utiliza Prevención o Partes y avisos.
                  </p>
                )}
              <button
                className={button + " bg-[#00548E] text-white"}
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    command("save", {
                      workerId: draft.workerId,
                      content: draft.content,
                    }),
                  )
                }
              >
                <Save className="h-4 w-4" />
                {pending.current
                  ? "Reintentar el mismo guardado"
                  : "Guardar borrador en servidor"}
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await call({ action: "detail", id: draft.id });
                    setRecord(r.record);
                    setHistory(r.history);
                    setNotice(
                      "Estado del servidor consultado. Tu edición local se conserva.",
                    );
                  })
                }
              >
                Consultar estado sin descartar edición
              </button>
              {record && draft.expected !== record.revision && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (
                        await appConfirm(
                          "Se conservará tu contenido local y al guardarlo se retirarán las firmas de la nueva versión. Las revisiones anteriores se conservan. ¿Aplicarlo sobre la revisión actual?",
                        )
                      ) {
                        pending.current = null;
                        setDraft({
                          ...draft,
                          expected: record.revision,
                          operation: undefined,
                        });
                      }
                    })
                  }
                >
                  Aplicar mi edición sobre la revisión actual
                </button>
              )}
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (
                      await appConfirm(
                        "¿Descartar solo la edición de este dispositivo? El registro guardado en servidor se conserva.",
                      )
                    ) {
                      setDraft(null);
                      pending.current = null;
                      await clearVisitDraft(scope);
                    }
                  })
                }
              >
                Descartar edición local
              </button>
            </div>
          )}
          {record && !draft && (
            <div className="space-y-4">
              <h3 className="font-black">
                {record.worker.name} · {DOCUMENT_STATUS[record.status]}
                {kind === "salida_obra" && record.status === "completed"
                  ? " · Regreso pendiente"
                  : ""}
              </h3>
              <p className="text-sm">
                {record.worker.dni} · {record.worker.category} ·{" "}
                {record.worksite.employer} · CIF {record.worksite.cif} ·
                Encargado: {record.foreman.name}
              </p>
              <p className="break-all text-xs">
                {record.id} · v{record.version} · revisión {record.revision}
              </p>
              <div className="rounded-xl border p-4 space-y-2">
                <h4 className="font-bold">
                  Contenido de la versión que se firma
                </h4>
                {fields
                  .filter((f) => content[f.key])
                  .map((f) => (
                    <p key={f.key} className="whitespace-pre-wrap text-sm">
                      <strong>{f.label}: </strong>
                      {f.type === "instant"
                        ? stamp(content[f.key])
                        : f.options?.find(
                            (o) => o[0] === content[f.key],
                          )?.[1] || content[f.key]}
                    </p>
                  ))}
                <p className="whitespace-pre-wrap">{declaration(record)}</p>
                <p>{RECEIPT_TEXT}</p>
                <p className="text-xs">{LEGAL_NOTE}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(() => file("view"))}
                >
                  <Eye className="h-4 w-4" />
                  Previsualizar PDF
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(() => file("download"))}
                >
                  <FileDown className="h-4 w-4" />
                  Descargar PDF
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(() => file("share"))}
                >
                  <Share2 className="h-4 w-4" />
                  Entrega manual
                </button>
              </div>
              {!isFinal && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      command("save", {
                        content: record.content,
                        refreshSnapshot: true,
                      }),
                    )
                  }
                >
                  Actualizar datos desde Configuración y retirar firmas de la
                  nueva versión
                </button>
              )}
              {!isFinal && (
                <button className={button} disabled={busy} onClick={edit}>
                  Editar y retirar firmas de la nueva versión
                </button>
              )}
              {record.status === "draft" && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(() => command("prepare"))}
                >
                  Validar y preparar para lectura y firma
                </button>
              )}
              {["prepared", "worker_signed"].includes(record.status) && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    setSigner(
                      record.status === "prepared" ? "worker" : "foreman",
                    );
                    setInk("");
                    setConfirmed(false);
                  }}
                >
                  <FileSignature className="h-4 w-4" />
                  {record.status === "prepared"
                    ? "Firma voluntaria del trabajador"
                    : "Confirmación y firma del encargado"}
                </button>
              )}
              {signer && (
                <div className="space-y-3 border-2 border-blue-200 rounded-xl p-4">
                  <p className="font-bold">
                    Firma sobre v{record.version}. Operador del dispositivo:{" "}
                    {context.actor.name}.
                  </p>
                  <label className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={busy}
                    />
                    {signer === "worker"
                      ? "He podido leer esta versión y firmo voluntariamente su contenido concreto."
                      : RECEIPT_TEXT}
                  </label>
                  <SignaturePad
                    label={
                      signer === "worker"
                        ? "Firma del trabajador"
                        : "Firma del encargado"
                    }
                    name={
                      signer === "worker"
                        ? record.worker.name
                        : record.foreman.name
                    }
                    value={ink}
                    onChange={setInk}
                  />
                  <button
                    className={button}
                    disabled={busy || !confirmed || !ink}
                    onClick={() =>
                      void run(() =>
                        command(
                          signer === "worker" ? "sign-worker" : "sign-foreman",
                          {
                            hash: record.hash,
                            version: record.version,
                            confirmed,
                            image: ink,
                          },
                        ),
                      )
                    }
                  >
                    Confirmar y guardar firma
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => {
                      setSigner(null);
                      setInk("");
                      setConfirmed(false);
                    }}
                  >
                    Cancelar firma
                  </button>
                </div>
              )}
              {kind === "salida_obra" && record.status === "completed" && (
                <div className="space-y-3 rounded-xl border p-4">
                  <h4 className="font-bold">Añadir diligencia de regreso</h4>
                  {record.content.exitType !== "actual" && (
                    <DocumentInstant
                      label="Salida efectiva comprobada"
                      value={actualExit}
                      onChange={setActualExit}
                    />
                  )}
                  <DocumentInstant
                    label="Regreso efectivo comprobado"
                    value={returnAt}
                    onChange={setReturnAt}
                  />
                  <label className="block">
                    Observaciones de comprobación
                    <textarea
                      className={input}
                      value={returnNote}
                      maxLength={4000}
                      onChange={(e) => setReturnNote(e.target.value)}
                    />
                  </label>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={returnConfirmed}
                      onChange={(e) => setReturnConfirmed(e.target.checked)}
                    />
                    Confirmo que he comprobado estas horas efectivas. No son
                    estimaciones.
                  </label>
                  <button
                    className={button}
                    disabled={busy || !returnConfirmed}
                    onClick={() =>
                      void run(() =>
                        command("return", {
                          at: returnAt,
                          actualExit,
                          note: returnNote,
                          confirmed: returnConfirmed,
                        }),
                      )
                    }
                  >
                    Registrar regreso sin alterar el PDF firmado
                  </button>
                </div>
              )}
              {record.returnEntry && (
                <div>
                  <p>
                    Regreso: {stamp(record.returnEntry.at)} · Registrado por{" "}
                    {record.returnEntry.actor.name}
                  </p>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(() => file("view", undefined, true))
                    }
                  >
                    Consultar diligencia de regreso
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(() => file("download", undefined, true))
                    }
                  >
                    Descargar diligencia
                  </button>
                </div>
              )}
              {record.status !== "annulled" && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const reason = await appPrompt(
                        "Motivo de anulación (el documento y las firmas se conservan):",
                      );
                      if (reason) await command("annul", { reason });
                    })
                  }
                >
                  Anular con trazabilidad
                </button>
              )}
              {record.annulment && (
                <p>
                  Anulado por {record.annulment.actor.name}:{" "}
                  {record.annulment.reason}. El PDF original conserva sus
                  firmas; consulta este estado antes de usarlo.
                </p>
              )}
              <details>
                <summary className="font-bold">
                  Historial y versiones conservadas
                </summary>
                {history.map((h) => (
                  <div key={h.revision} className="border-b py-2 text-sm">
                    Revisión {h.revision} · {h.action} · {h.actor.name} ·{" "}
                    {stamp(h.at)}{" "}
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void run(() => file("view", h.revision))}
                    >
                      Consultar PDF de esta revisión
                    </button>
                  </div>
                ))}
              </details>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setRecord(null);
                  setSigner(null);
                  pending.current = null;
                }}
              >
                Volver al archivo / elaborar otro
              </button>
            </div>
          )}
          <div className="space-y-2">
            <h3 className="font-bold">Archivo de {DOCUMENT_KINDS[kind]}</h3>
            <button
              className={button}
              disabled={busy}
              onClick={() => void run(reload)}
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar archivo
            </button>
            {rows.map((r) => (
              <button
                key={r.id}
                className={button + " w-full justify-start text-left"}
                disabled={busy}
                onClick={() => void run(() => open(r.id))}
              >
                {r.workerName} ·{" "}
                {DOCUMENT_STATUS[r.status as keyof typeof DOCUMENT_STATUS]} · v
                {r.version}
              </button>
            ))}
            <button
              className={button}
              disabled={!offset || busy}
              onClick={() => setOffset((v) => Math.max(0, v - 30))}
            >
              Anteriores
            </button>{" "}
            <button
              className={button}
              disabled={rows.length < 30 || busy}
              onClick={() => setOffset((v) => v + 30)}
            >
              Más documentos
            </button>
          </div>
        </>
      )}
      {preview && (
        <ModalPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Previsualización del documento"
            className="fixed inset-0 z-[9999] flex flex-col bg-white p-3 dark:bg-slate-900"
          >
            <button className={button} onClick={() => setPreview("")}>
              Cerrar previsualización
            </button>
            <iframe
              title="PDF institucional"
              src={preview}
              className="mt-2 min-h-0 flex-1 w-full"
            />
          </div>
        </ModalPortal>
      )}
    </section>
  );
}
