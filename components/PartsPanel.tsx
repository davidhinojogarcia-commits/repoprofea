import React, { useEffect, useRef, useState } from "react";
import PartsPolicyEditor from "./PartsPolicyEditor";
import { VisitSignaturePad } from "./VisitSignaturePad";
import ModalPortal from "./ModalPortal";
import {
  partsRequest,
  openPartFile,
  partAttachment,
} from "../src/services/partsService";
import {
  PART_REASONS,
  RECEIPT_LABELS,
  PART_ACTION_LABELS,
  PART_STATUS,
  type PartContent,
  type PartRecord,
  type PartCommand,
  type PartKind,
  type ReceiptMode,
} from "../src/lib/parts/domain";
import {
  storeVisitDraft,
  readVisitDraft,
  clearVisitDraft,
} from "../src/lib/visitDraftStore";
import { supabase } from "../src/lib/supabase";
import {
  activatePartsPush,
  disablePartsPush,
  partsPushMessage,
} from "../src/services/partsPushService";
import { appConfirm } from "../src/lib/appDialog";
const input =
  "mt-1 block w-full min-h-[48px] rounded-xl border border-slate-300 bg-white p-3 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const button =
  "min-h-[48px] rounded-xl border border-slate-300 px-4 py-3 font-bold disabled:opacity-50";
const primary = button + " bg-[#00548E] text-white";
const empty = (): PartContent => ({
  reason: "mobile",
  occurredAt: new Date().toISOString(),
  place: "",
  facts: "",
  instruction: "",
  response: "",
  witnesses: "",
  priority: "ordinary",
  risk: false,
  uncertain: false,
  attachments: [],
});
type Draft = {
  id: string;
  workerId: number;
  kind: PartKind;
  content: PartContent;
  recordId?: string;
  expected?: number;
  pendingSync?: boolean;
  operation?: { key: string; id: string };
};
export default function PartsPanel({
  token,
  accountId,
  workerId,
  onBack,
}: {
  token?: string;
  accountId?: string;
  workerId?: number;
  onBack?: () => void;
}) {
  const [workerSearch, setWorkerSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [context, setContext] = useState<any>(null),
    [rows, setRows] = useState<any[]>([]),
    [cursor, setCursor] = useState<any>(null),
    [filters, setFilters] = useState<Record<string, string>>({
      workerId: workerId ? String(workerId) : "",
    });
  const [selected, setSelected] = useState<PartRecord | null>(null),
    [detail, setDetail] = useState<any>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [localStatus, setLocalStatus] = useState(""),
    [online, setOnline] = useState(navigator.onLine);
  const [draftHidden, setDraftHidden] = useState(false);
  const [signing, setSigning] = useState<
      "submit" | "authorize" | "receipt" | "elevate" | "resolve-dispute" | null
    >(null),
    [reason, setReason] = useState(""),
    [authority, setAuthority] = useState(""),
    [receiptMode, setReceiptMode] = useState<ReceiptMode>("received"),
    [receiptNote, setReceiptNote] = useState(""),
    [witnesses, setWitnesses] = useState(""),
    [channel, setChannel] = useState(""),
    [comparables, setComparables] = useState<string[]>([]),
    [checked, setChecked] = useState(false);
  const fileCache = useRef(new Map<string, { at: number; file: any }>());
  const syncRef = useRef<() => void>(() => {});
  const scopeGeneration = useRef(0),
    refreshRef = useRef<() => void>(() => {});
  const flight = useRef(false),
    generation = useRef(0),
    contextRef = useRef<any>(null),
    draftRef = useRef<Draft | null>(null),
    storageKey = useRef(""),
    operation = useRef<{ key: string; id: string } | null>(null),
    mounted = useRef(true),
    listFlight = useRef<AbortController | null>(null);
  const isForeman = !!token;
  async function persist() {
    if (!storageKey.current) return;
    await storeVisitDraft(storageKey.current, {
      draft: draftRef.current,
      context: contextRef.current,
    });
    if (mounted.current)
      setLocalStatus(
        "Guardado local cifrado · pendiente de confirmar en servidor",
      );
  }
  async function list(append = false, next = cursor) {
    listFlight.current?.abort();
    const ctrl = new AbortController();
    listFlight.current = ctrl;
    try {
      const r = await partsRequest(
        { action: "list", filters, cursor: append ? next : null },
        token,
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      setRows((p) => (append ? [...p, ...r.rows] : r.rows));
      setCursor(r.cursor);
      setCounts(r.counts || {});
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
    }
  }
  async function load(id: string) {
    const version = ++generation.current;
    setError("");
    try {
      const r = await partsRequest({ action: "detail", id }, token);
      if (!mounted.current || version !== generation.current) return;
      setSelected(r.record);
      setDetail(r);
      setComparables(r.record.comparableIds);
      setChecked(false);
    } catch (e: any) {
      if (mounted.current && version === generation.current)
        setError(e.message);
    }
  }
  useEffect(() => {
    mounted.current = true;
    scopeGeneration.current++;
    fileCache.current.clear();
    operation.current = null;
    setDraftHidden(false);
    setLocalStatus("");
    flight.current = false;
    setBusy(false);
    setSelected(null);
    setContext(null);
    setRows([]);
    setCounts({});
    setDetail(null);
    setSigning(null);
    setError("");
    setNotice("");
    setReason("");
    setAuthority("");
    setDraft(null);
    contextRef.current = null;
    draftRef.current = null;
    storageKey.current = "";
    const ctrl = new AbortController();
    void (async () => {
      try {
        let scope: string;
        if (token) {
          scope = Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(token),
              ),
            ),
          )
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("");
        } else {
          const { data } = await supabase.auth.getSession();
          scope = data.session?.user.id || "";
          if (!scope) throw new Error("Inicia sesión.");
        }
        if (ctrl.signal.aborted) return;
        storageKey.current = "parts:" + scope;
        const saved = await readVisitDraft<any>(storageKey.current);
        if (ctrl.signal.aborted) return;
        if (saved?.draft) {
          draftRef.current = saved.draft;
          setDraft(saved.draft);
        }
        try {
          const r = await partsRequest(
            { action: "context" },
            token,
            ctrl.signal,
          );
          if (ctrl.signal.aborted) return;
          contextRef.current = r;
          setContext(r);
          await persist();
        } catch (e) {
          if (saved?.context) {
            contextRef.current = saved.context;
            setContext(saved.context);
            setNotice(
              "Contexto local: permisos y contratación se volverán a comprobar al sincronizar.",
            );
          } else throw e;
        }
      } catch (e: any) {
        if (!ctrl.signal.aborted) setError(e.message);
      }
    })();
    const connectivity = () => {
      setOnline(navigator.onLine);
    };
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const updates = (event: MessageEvent) => {
      if (event.data?.type !== "PARTS_UPDATED") return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (mounted.current) refreshRef.current();
      }, 300);
    };
    navigator.serviceWorker?.addEventListener("message", updates);
    const flush = () => {
      if (document.visibilityState === "hidden")
        void persist().catch(() => {
          if (mounted.current)
            setLocalStatus("No se pudo confirmar el guardado local.");
        });
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      mounted.current = false;
      ctrl.abort();
      listFlight.current?.abort();
      generation.current++;
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      document.removeEventListener("visibilitychange", flush);
      clearTimeout(refreshTimer);
      navigator.serviceWorker?.removeEventListener("message", updates);
    };
  }, [token, accountId]);
  useEffect(() => {
    draftRef.current = draft;
    if (!storageKey.current || !context) return;
    const t = setTimeout(
      () =>
        void persist().catch(() =>
          setLocalStatus(
            "Error de guardado local. Conserva esta pantalla abierta.",
          ),
        ),
      250,
    );
    return () => clearTimeout(t);
  }, [draft, context]);
  useEffect(() => {
    if (context && online) void list();
  }, [context, online, JSON.stringify(filters)]);
  async function run(
    action: string,
    command: Partial<PartCommand> = {},
    record = selected,
  ) {
    if (flight.current || !record) return null;
    flight.current = true;
    setBusy(true);
    setError("");
    const scope = scopeGeneration.current;
    const body = { action, id: record.id, expected: record.revision, command };
    const key = JSON.stringify(body);
    if (operation.current?.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    try {
      const r = await partsRequest(
        { ...body, operationId: operation.current.id },
        token,
      );
      if (!mounted.current || scope !== scopeGeneration.current) return null;
      setSelected(r.record);
      setNotice(
        "Recibido y registrado por el servidor. Aviso móvil: " +
          partsPushMessage(r.push?.status) +
          ".",
      );
      operation.current = null;
      await list();
      await load(r.record.id);
      return r.record as PartRecord;
    } catch (e: any) {
      if (mounted.current && scope === scopeGeneration.current)
        setError(e.message);
      return null;
    } finally {
      if (scope === scopeGeneration.current) {
        flight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function save() {
    if (!draft || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    const scope = scopeGeneration.current;
    const body = draft.recordId
      ? {
          action: "edit",
          id: draft.recordId,
          expected: draft.expected,
          command: { content: draft.content, kind: draft.kind },
        }
      : {
          action: "create",
          id: draft.id,
          expected: 0,
          workerId: draft.workerId,
          kind: draft.kind,
          content: draft.content,
        };
    const key = JSON.stringify(body);
    if (draft.operation?.key === key) operation.current = draft.operation;
    else if (operation.current?.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    const savedDraft = { ...draft, operation: operation.current! };
    draftRef.current = savedDraft;
    setDraft(savedDraft);
    try {
      await storeVisitDraft(storageKey.current, {
        draft: savedDraft,
        context: contextRef.current,
      });
      const r = await partsRequest(
        { ...body, operationId: operation.current.id },
        token,
      );
      if (!mounted.current || scope !== scopeGeneration.current) return;
      operation.current = null;
      setDraft(null);
      draftRef.current = null;
      await persist();
      setSelected(r.record);
      setNotice(
        "Borrador recibido por el servidor. Revisa el documento antes de firmar.",
      );
      await list();
      await load(r.record.id);
    } catch (e: any) {
      if (mounted.current && scope === scopeGeneration.current)
        setError(e.message);
    } finally {
      if (scope === scopeGeneration.current) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  async function file(
    action: "view" | "download" | "share",
    revision?: number,
    assetId?: string,
  ) {
    if (!selected || flight.current) return;
    const scope = scopeGeneration.current;
    if (
      action === "share" &&
      !(await appConfirm(
        "Comparte únicamente por un canal autorizado y con un destinatario verificado. Compartir no acredita recepción. ¿Continuar?",
      ))
    )
      return;
    if (scope !== scopeGeneration.current || !mounted.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const cacheKey =
        selected.id +
        ":" +
        (revision || selected.revision) +
        ":" +
        (assetId || "pdf");
      let cached = fileCache.current.get(cacheKey);
      if (!cached || Date.now() - cached.at > 45000) {
        const r = await partsRequest(
          {
            action: assetId ? "file" : "pdf",
            id: selected.id,
            revision,
            assetId,
            intent: action,
          },
          token,
        );
        if (scope !== scopeGeneration.current || !mounted.current) return;
        cached = { at: Date.now(), file: r.file };
        if (fileCache.current.size >= 4)
          fileCache.current.delete(fileCache.current.keys().next().value!);
        fileCache.current.set(cacheKey, cached);
      }
      await openPartFile(cached.file, action);
    } catch (e: any) {
      if (
        e.name !== "AbortError" &&
        scope === scopeGeneration.current &&
        mounted.current
      )
        setError(e.message);
    } finally {
      if (scope === scopeGeneration.current) {
        flight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  const setContent = (patch: Partial<PartContent>) =>
    setDraft((p) => (p ? { ...p, content: { ...p.content, ...patch } } : p));
  async function attach(file: File) {
    if (!selected || flight.current) return;
    const scope = scopeGeneration.current;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await partAttachment(file);
      if (scope !== scopeGeneration.current || !mounted.current) return;
      const r = await partsRequest(
        { action: "attachment", id: selected.id, file: data },
        token,
      );
      if (scope !== scopeGeneration.current || !mounted.current) return;
      const next = await partsRequest(
        {
          action: "edit",
          id: selected.id,
          expected: selected.revision,
          operationId: crypto.randomUUID(),
          command: {
            kind: selected.kind,
            content: {
              ...selected.content,
              attachments: [...selected.content.attachments, r.asset],
            },
          },
        },
        token,
      );
      if (scope !== scopeGeneration.current || !mounted.current) return;
      setSelected(next.record);
      await load(selected.id);
    } catch (e: any) {
      if (scope === scopeGeneration.current && mounted.current)
        setError(e.message);
    } finally {
      if (scope === scopeGeneration.current) {
        flight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function sign(image: string) {
    if (!selected) return;
    const command: any = {
      signature: {
        base64: image.split(",")[1],
        mime: "image/png",
        name: "Firma",
      },
      contentHash: selected.contentHash,
      acknowledged: true,
    };
    if (signing === "receipt")
      Object.assign(command, {
        mode: receiptMode,
        note: receiptNote,
        witnesses,
        channel,
      });
    if (signing === "elevate" || signing === "resolve-dispute")
      Object.assign(command, { reason, authority });
    if (await run(signing!, command)) setSigning(null);
  }
  syncRef.current = () => {
    if (draft?.pendingSync && !flight.current && navigator.onLine) void save();
  };
  useEffect(() => {
    if (online && context && draft?.pendingSync) syncRef.current();
  }, [online, context, draft?.pendingSync]);
  refreshRef.current = () => {
    if (!flight.current) {
      void list();
      if (selected && !draft) void load(selected.id);
    }
  };
  const candidates = (context?.workers || []).filter(
    (w: any) =>
      !workerSearch ||
      w.apellidos_nombre.toLowerCase().includes(workerSearch.toLowerCase()),
  );
  return (
    <section
      aria-label="Partes y avisos"
      className="space-y-4 rounded-2xl bg-white p-4 text-slate-900 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-black">Partes y avisos</h2>
        <div className="flex flex-wrap gap-2">
          {!isForeman && (
            <button
              className={button}
              disabled={busy || !online}
              onClick={() =>
                void partsRequest({ action: "notifications-read" }, token)
                  .then(() => {
                    window.dispatchEvent(new Event("parts:notifications-read"));
                    setNotice(
                      "Avisos informativos marcados como leídos. Los expedientes conservan su estado.",
                    );
                  })
                  .catch((e: any) => setError(e.message))
              }
            >
              Marcar avisos leídos
            </button>
          )}
          {onBack && (
            <button className={button} onClick={onBack}>
              Volver al menú
            </button>
          )}
          <button
            className={button}
            disabled={busy || !online}
            onClick={() => {
              void list();
              if (selected) void load(selected.id);
            }}
          >
            Actualizar
          </button>
        </div>
      </div>
      <button
        className={button}
        disabled={busy || !online}
        onClick={() =>
          void activatePartsPush(token)
            .then(() =>
              setNotice("Dispositivo registrado para avisos móviles."),
            )
            .catch((e: any) => setError(e.message))
        }
      >
        Activar avisos móviles
      </button>
      <button
        className={button}
        disabled={busy || !online}
        onClick={() =>
          void disablePartsPush(token)
            .then(() =>
              setNotice(
                "Avisos móviles de este módulo desactivados. Los registros siguen disponibles.",
              ),
            )
            .catch((e: any) => setError(e.message))
        }
      >
        Desactivar avisos móviles del módulo
      </button>
      <p className="text-sm">
        Avisos de servicio y hechos para revisión. Ningún registro constituye
        una sanción automática.
      </p>
      <div
        aria-label="Indicadores del ámbito autorizado"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {Object.entries({
          service: "Avisos ordinarios",
          review: "Pendientes de revisión",
          urgent: "Urgentes",
          returned: "Devueltos",
          delivery: "Pendientes de comunicar",
          communicated: "Comunicados",
          elevated: "Elevados",
          closed: "Cerrados",
        }).map(([key, label]) => (
          <div className="rounded-xl border p-3 text-center" key={key}>
            <span className="block text-xl font-black">
              {counts[key] ?? "—"}
            </span>
            <span className="text-xs">{label}</span>
          </div>
        ))}
      </div>
      {!isForeman && selected && detail && (
        <PartsPolicyEditor
          key={selected.worksite.id + ":" + (detail.policyRevision || 0)}
          worksiteId={selected.worksite.id}
          policy={detail.policy}
          revision={detail.policyRevision || 0}
          onSaved={(policy) => {
            setDetail((p: any) => ({
              ...p,
              policy,
              policyRevision: (p.policyRevision || 0) + 1,
            }));
            void load(selected.id);
          }}
        />
      )}
      {isForeman && context && !context.policy && !detail?.policy && (
        <p
          role="status"
          className="rounded-lg border border-amber-400 p-3 text-sm"
        >
          La obra está pendiente de validar entidad empleadora, convenio y
          política de tratamiento. Puedes conservar borradores; las
          comunicaciones no están habilitadas.
        </p>
      )}
      {!online && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">
          Sin conexión: solo borradores locales. Las firmas y comunicaciones
          requieren confirmación del servidor.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-400 p-3 text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {draft && draftHidden && (
        <button
          className={primary}
          onClick={() => {
            setSelected(null);
            setDraftHidden(false);
          }}
        >
          Recuperar borrador local
        </button>
      )}
      {isForeman && !draft && (
        <div className="flex flex-wrap gap-2">
          {(["service", "incident"] as const).map((kind) => (
            <button
              disabled={busy || !context}
              className={primary}
              key={kind}
              onClick={() => {
                setSelected(null);
                setDraftHidden(false);
                setDraft({
                  id: crypto.randomUUID(),
                  workerId: 0,
                  kind,
                  content: empty(),
                });
              }}
            >
              {kind === "service"
                ? "Nuevo aviso de servicio"
                : "Nuevo parte de incidencia"}
            </button>
          ))}
        </div>
      )}
      {draft && !draftHidden && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3 className="font-black">
            {draft.kind === "service"
              ? "Aviso de servicio"
              : "Parte para revisión"}{" "}
            · {context?.works?.[0]?.obra || "Borrador local"}
          </h3>
          {!draft.recordId && (
            <>
              <label className="block">
                Buscar trabajador
                <input
                  className={input}
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                />
              </label>
              <label className="block">
                Trabajador
                <select
                  aria-label="Trabajador"
                  required
                  className={input}
                  value={draft.workerId || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, workerId: Number(e.target.value) })
                  }
                >
                  <option value="">Selecciona una contratación</option>
                  {candidates.map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {w.apellidos_nombre} · {w.categoria} · {w.periodo_inicio}{" "}
                      a {w.periodo_fin} · ID {w.id}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={draft.kind === "incident"}
              disabled={draft.kind === "incident"}
              onChange={() => setDraft({ ...draft, kind: "incident" })}
            />
            Solicitar revisión del supervisor (parte de incidencia)
          </label>
          <label className="block">
            Motivo
            <select
              className={input}
              value={draft.content.reason}
              onChange={(e) => setContent({ reason: e.target.value })}
            >
              {(
                context?.policy?.reasons ||
                PART_REASONS.map(([id, label]) => ({ id, label }))
              ).map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Fecha y hora del hecho
            <input
              required
              type="datetime-local"
              className={input}
              value={new Date(
                Date.parse(draft.content.occurredAt) -
                  new Date(draft.content.occurredAt).getTimezoneOffset() *
                    60000,
              )
                .toISOString()
                .slice(0, 16)}
              onChange={(e) => {
                if (e.target.value)
                  setContent({
                    occurredAt: new Date(e.target.value).toISOString(),
                  });
              }}
            />
          </label>
          {(
            ["place", "facts", "instruction", "response", "witnesses"] as const
          ).map((key, i) => (
            <label key={key} className="block">
              {
                [
                  "Lugar en la obra",
                  "Descripción objetiva de los hechos",
                  "Instrucción comunicada",
                  "Respuesta del trabajador, si existe",
                  "Testigos, si existen",
                ][i]
              }
              <textarea
                aria-label={
                  [
                    "Lugar en la obra",
                    "Descripción objetiva de los hechos",
                    "Instrucción comunicada",
                    "Respuesta del trabajador, si existe",
                    "Testigos, si existen",
                  ][i]
                }
                rows={key === "facts" ? 5 : 2}
                required={["place", "facts", "instruction"].includes(key)}
                className={input}
                value={draft.content[key]}
                maxLength={key === "facts" ? 6000 : 1500}
                onChange={(e) => setContent({ [key]: e.target.value })}
              />
            </label>
          ))}
          {draft.content.attachments.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border p-2"
            >
              <span>{a.name}</span>
              <button
                type="button"
                className={button}
                onClick={() =>
                  setContent({
                    attachments: draft.content.attachments.filter(
                      (x) => x.id !== a.id,
                    ),
                  })
                }
              >
                Retirar de esta versión
              </button>
            </div>
          ))}
          <p className="text-sm">
            Puedes utilizar el dictado del teclado. No se envía audio ni se
            inventan datos.
          </p>
          <label className="block">
            Prioridad
            <select
              className={input}
              value={draft.content.priority}
              onChange={(e) => setContent({ priority: e.target.value as any })}
            >
              <option value="ordinary">Ordinaria</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={draft.content.risk}
              onChange={(e) => setContent({ risk: e.target.checked })}
            />
            Existe riesgo preventivo; requiere revisión.
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={draft.content.uncertain}
              onChange={(e) => setContent({ uncertain: e.target.checked })}
            />
            Hay dudas o hechos discutidos; remitir al supervisor.
          </label>
          {draft.content.risk && (
            <p role="alert" className="rounded-lg border border-red-400 p-3">
              Ante riesgo grave e inminente, activa las medidas y comunicaciones
              del procedimiento preventivo de la obra sin esperar la firma o
              revisión de este documento.
            </p>
          )}
          <p role="status" className="text-sm">
            {draft.pendingSync
              ? "Pendiente de sincronización del borrador · no enviado ni firmado"
              : localStatus}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={primary}
              disabled={busy || !online || !draft.workerId}
            >
              Guardar borrador en servidor
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || !draft.workerId}
              onClick={() => {
                const queued = { ...draft, pendingSync: true };
                draftRef.current = queued;
                setDraft(queued);
                void storeVisitDraft(storageKey.current, {
                  draft: queued,
                  context: contextRef.current,
                }).catch((e: any) => setError(e.message));
              }}
            >
              Sincronizar borrador al recuperar conexión
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                void persist()
                  .then(() => setNotice("Borrador local conservado."))
                  .catch((e: any) => setError(e.message));
              }}
            >
              Guardar en este dispositivo
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                void persist()
                  .then(() => setDraftHidden(true))
                  .catch((e: any) => setError(e.message));
              }}
            >
              Volver conservando el borrador
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void (async () => {
                  if (
                    await appConfirm(
                      "¿Descartar este borrador local? Los registros del servidor se conservarán.",
                    )
                  ) {
                    draftRef.current = null;
                    setDraft(null);
                    await clearVisitDraft(storageKey.current);
                  }
                })()
              }
            >
              Descartar borrador local
            </button>
          </div>
        </form>
      )}
      {selected && (!draft || draftHidden) && (
        <article className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-black">
              {selected.number} · {PART_STATUS[selected.status]}
            </h3>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                generation.current++;
                setSelected(null);
              }}
            >
              Volver al listado
            </button>
          </div>
          <p>
            {selected.worker.name} · ID {selected.workerId} ·{" "}
            {selected.worksite.code} · {selected.worksite.name}
          </p>
          <p className="text-sm">
            {selected.worker.category} · {selected.worker.periodStart} a{" "}
            {selected.worker.periodEnd} · v{selected.version} / revisión{" "}
            {selected.revision}
          </p>
          <p className="font-bold">
            {PART_REASONS.find(([id]) => id === selected.content.reason)?.[1] ||
              selected.content.reason}{" "}
            · {new Date(selected.content.occurredAt).toLocaleString("es-ES")}
          </p>
          {selected.content.risk && (
            <p role="alert" className="border border-red-400 p-3">
              Riesgo preventivo: activar el procedimiento de la obra sin esperar
              la tramitación documental.
            </p>
          )}
          <dl className="space-y-2">
            {[
              ["Lugar", selected.content.place],
              ["Hechos", selected.content.facts],
              ["Instrucción", selected.content.instruction],
              ["Respuesta", selected.content.response],
              ["Testigos declarados", selected.content.witnesses],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="font-bold">{label}</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {value || "No consta"}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Encargado: {selected.foremanName} · Firma{" "}
            {selected.foremanSignature
              ? "registrada para esta versión"
              : "pendiente"}{" "}
            · Revisión del supervisor:{" "}
            {selected.supervisorSignature
              ? "firmada"
              : selected.kind === "service"
                ? "no necesaria"
                : "pendiente"}
          </p>
          {selected.decision && (
            <p className="rounded-lg border p-3">
              {selected.decision.action}: {selected.decision.reason}
            </p>
          )}
          {selected.receipt && (
            <p className="rounded-lg border p-3">
              Resultado de entrega: {RECEIPT_LABELS[selected.receipt.mode]} ·{" "}
              {selected.receipt.note}{" "}
              {selected.receipt.signature
                ? "Acuse de recibo registrado."
                : "Recepción no acreditada."}
            </p>
          )}
          <button
            className={button}
            disabled={busy || !online}
            onClick={() =>
              void partsRequest(
                { action: "push-retry", id: selected.id },
                token,
              )
                .then((r) =>
                  setNotice(
                    "Aviso móvil: " + partsPushMessage(r.push.status) + ".",
                  ),
                )
                .catch((e: any) => setError(e.message))
            }
          >
            Comprobar / reintentar aviso móvil
          </button>
          <div className="flex flex-wrap gap-2">
            {(["view", "download", "share"] as const).map((action, i) => (
              <button
                disabled={
                  busy ||
                  !online ||
                  (action === "share" &&
                    (!selected.foremanSignature ||
                      ["draft", "returned", "submitted", "review"].includes(
                        selected.status,
                      ) ||
                      (selected.kind === "incident" &&
                        !selected.supervisorSignature)))
                }
                key={action}
                className={button}
                onClick={() => void file(action)}
              >
                {
                  [
                    "Ver PDF",
                    "Descargar PDF",
                    "Compartir por canal verificado",
                  ][i]
                }
              </button>
            ))}
          </div>
          {selected.content.attachments.map((a) => (
            <button
              key={a.id}
              className={button}
              disabled={busy || !online}
              onClick={() => void file("view", undefined, a.id)}
            >
              Ver anexo: {a.name}
            </button>
          ))}
          {isForeman && ["draft", "returned"].includes(selected.status) && (
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  setDraft({
                    id: crypto.randomUUID(),
                    recordId: selected.id,
                    expected: selected.revision,
                    workerId: selected.workerId,
                    kind: selected.kind,
                    content: selected.content,
                  })
                }
              >
                Corregir borrador
              </button>
              <label className={button}>
                Adjuntar documento pertinente
                <input
                  type="file"
                  className="block max-w-full"
                  disabled={
                    busy || !online || selected.content.attachments.length >= 4
                  }
                  accept="application/pdf,image/png,image/jpeg,image/heic"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void attach(f);
                  }}
                />
              </label>
              <button
                className={primary}
                disabled={busy || !online}
                onClick={() => setSigning("submit")}
              >
                {selected.kind === "service"
                  ? "Revisar y firmar aviso"
                  : "Firmar y enviar al supervisor"}
              </button>
            </div>
          )}
          {!isForeman && (
            <>
              <label className="block">
                Motivo de la decisión / justificación de comparabilidad
                <textarea
                  className={input}
                  aria-label="Motivo de la decisión / justificación de comparabilidad"
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {selected.status === "submitted" && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void run("review")}
                  >
                    Iniciar revisión
                  </button>
                )}
                {selected.status === "review" &&
                  selected.receipt?.mode === "disagreement" && (
                    <button
                      className={primary}
                      disabled={busy || !online || !reason.trim()}
                      onClick={() => setSigning("resolve-dispute")}
                    >
                      Revisar disconformidad con firma
                    </button>
                  )}
                {["submitted", "review"].includes(selected.status) && (
                  <>
                    {selected.receipt?.mode !== "disagreement" && (
                      <button
                        className={primary}
                        disabled={busy || !online}
                        onClick={() => setSigning("authorize")}
                      >
                        Revisar y autorizar con firma
                      </button>
                    )}
                    <button
                      className={button}
                      disabled={busy || !reason.trim()}
                      onClick={() => void run("return", { reason })}
                    >
                      Devolver para corrección
                    </button>
                    <button
                      className={button}
                      disabled={busy || !reason.trim()}
                      onClick={() => void run("information", { reason })}
                    >
                      Solicitar información
                    </button>
                  </>
                )}
                {![
                  "draft",
                  "annulled",
                  "elevated",
                  "archived",
                  "dismissed",
                ].includes(selected.status) && (
                  <button
                    className={button}
                    disabled={busy || !reason.trim()}
                    onClick={() => void run("archive", { reason })}
                  >
                    Archivar
                  </button>
                )}
                {![
                  "draft",
                  "annulled",
                  "elevated",
                  "archived",
                  "dismissed",
                ].includes(selected.status) && (
                  <button
                    className={button}
                    disabled={busy || !reason.trim()}
                    onClick={() => void run("dismiss", { reason })}
                  >
                    Desestimar motivadamente
                  </button>
                )}
                {["communicated", "unproven_delivery", "elevated"].includes(
                  selected.status,
                ) && (
                  <button
                    className={button}
                    disabled={busy || !reason.trim()}
                    onClick={() => void run("close", { reason })}
                  >
                    Cerrar seguimiento
                  </button>
                )}
                {!["draft", "annulled"].includes(selected.status) && (
                  <button
                    className={button}
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      void (async () => {
                        if (
                          await appConfirm(
                            "¿Registrar una anulación trazable? Se conservarán las versiones anteriores.",
                          )
                        )
                          await run("annul", { reason });
                      })()
                    }
                  >
                    Anular con motivo
                  </button>
                )}
              </div>
              {detail?.policy &&
                Date.parse(selected.content.occurredAt) +
                  detail.policy.retentionDays * 86400000 <
                  Date.parse(
                    context.serverTime || new Date().toISOString(),
                  ) && (
                  <p
                    role="status"
                    className="rounded-lg border border-amber-500 p-3"
                  >
                    Revisar conservación: se ha alcanzado el plazo configurado.
                    El responsable debe decidir bloqueo o supresión conforme al
                    procedimiento aprobado. No se han eliminado documentos.
                  </p>
                )}
              <h4 className="font-black">Antecedentes para revisión</h4>
              {!detail?.policy && (
                <p className="text-sm">
                  El cómputo de reiteraciones está pendiente de validar
                  convenio, criterios y plazos. No se presume una reincidencia
                  legal.
                </p>
              )}
              {detail?.policy && (
                <p className="text-sm">
                  {detail.comparable?.length || 0} registros comunicados
                  potencialmente comparables dentro del horizonte configurado.
                  El supervisor debe confirmar la relación.
                </p>
              )}
              {(detail?.comparable || []).map((r: any) => (
                <label key={r.id} className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={comparables.includes(r.id)}
                    onChange={(e) =>
                      setComparables((p) =>
                        e.target.checked
                          ? [...p, r.id]
                          : p.filter((id) => id !== r.id),
                      )
                    }
                  />
                  {r.number} · {r.work} ·{" "}
                  {new Date(r.date).toLocaleDateString("es-ES")}
                </label>
              ))}
              {detail?.policy && (
                <button
                  className={button}
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void run("compare", { reason, recordIds: comparables })
                  }
                >
                  Confirmar antecedentes comparables
                </button>
              )}
              {selected.comparableIds.filter((id) =>
                detail?.comparable?.some((r: any) => r.id === id),
              ).length >= 2 && (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-500 p-3"
                >
                  Seguimiento reforzado: dos antecedentes confirmados y esta
                  incidencia para revisión. Un registro pendiente no computa
                  como aviso comunicado. No implica sanción ni elevación
                  automática.
                </p>
              )}
              {!selected.blockedAt && (
                <button
                  className={button}
                  disabled={busy || !reason.trim()}
                  onClick={async () => {
                    if (
                      await appConfirm(
                        "El bloqueo restringe el acceso ordinario y las operaciones futuras. Solo debe acordarlo el responsable de conservación. No elimina documentos. ¿Confirmar el bloqueo motivado?",
                      )
                    )
                      void run("block", { reason });
                  }}
                >
                  Bloquear por conservación
                </button>
              )}
              {[
                "submitted",
                "review",
                "communicated",
                "closed",
                "unproven_delivery",
              ].includes(selected.status) && (
                <>
                  <label className="block">
                    Órgano o responsable destinatario para valoración
                    <input
                      className={input}
                      value={authority}
                      onChange={(e) => setAuthority(e.target.value)}
                      maxLength={300}
                    />
                  </label>
                  <button
                    className={button}
                    disabled={busy || !reason.trim() || !authority.trim()}
                    onClick={() => setSigning("elevate")}
                  >
                    Preparar propuesta de elevación con firma
                  </button>
                </>
              )}
              {selected.status === "elevated" && (
                <>
                  <p>
                    Propuesta para {selected.elevation?.authority}. No
                    constituye sanción.
                  </p>
                  <label className="block">
                    Canal verificado y referencia de remisión efectuada
                    <input
                      className={input}
                      value={channel}
                      onChange={(e) => setChannel(e.target.value)}
                      maxLength={300}
                    />
                  </label>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                    />
                    He verificado el destinatario y realizado la remisión por un
                    canal autorizado.
                  </label>
                  <button
                    className={button}
                    disabled={busy || !checked || !channel || !reason}
                    onClick={() =>
                      void run("remit", {
                        reason,
                        channel,
                        acknowledged: checked,
                      })
                    }
                  >
                    Registrar constancia de remisión
                  </button>
                </>
              )}
            </>
          )}
          {isForeman &&
            ["pending_delivery", "unproven_delivery"].includes(
              selected.status,
            ) && (
              <>
                <h4 className="font-black">
                  Lectura y comunicación al trabajador
                </h4>
                <p className="text-sm">
                  La firma acredita recepción, no aceptación de los hechos. Una
                  negativa no acredita entrega.
                </p>
                <label className="block">
                  Resultado
                  <select
                    aria-label="Resultado"
                    className={input}
                    value={receiptMode}
                    onChange={(e) => {
                      setReceiptMode(e.target.value as ReceiptMode);
                      setChecked(false);
                    }}
                  >
                    {[
                      ["received", "Recibido sin observaciones"],
                      ["observations", "Recibido con observaciones"],
                      ["disagreement", "Recibido con disconformidad"],
                      ["refused", "Negativa a firmar"],
                      ["not_delivered", "Entrega no realizada"],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  Observaciones del trabajador o descripción objetiva del
                  intento
                  <textarea
                    className={input}
                    aria-label="Observaciones del trabajador o descripción objetiva del intento"
                    value={receiptNote}
                    onChange={(e) => setReceiptNote(e.target.value)}
                    maxLength={3000}
                  />
                </label>
                <label className="block">
                  Testigos de la entrega, si existen
                  <input
                    className={input}
                    value={witnesses}
                    onChange={(e) => setWitnesses(e.target.value)}
                    maxLength={1500}
                  />
                </label>
                <label className="block">
                  Otro medio de entrega, si procede
                  <input
                    className={input}
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    maxLength={300}
                  />
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  El documento completo ha sido mostrado para lectura, o he
                  descrito por qué no ha podido entregarse.
                </label>
                <button
                  className={primary}
                  disabled={
                    busy ||
                    !online ||
                    !checked ||
                    (receiptMode !== "received" && !receiptNote.trim())
                  }
                  onClick={() => {
                    if (["refused", "not_delivered"].includes(receiptMode))
                      void run("receipt", {
                        mode: receiptMode,
                        note: receiptNote,
                        witnesses,
                        channel,
                        acknowledged: checked,
                      });
                    else setSigning("receipt");
                  }}
                >
                  {["refused", "not_delivered"].includes(receiptMode)
                    ? "Registrar intento sin firma"
                    : "Firma de recepción del trabajador"}
                </button>
              </>
            )}
          {selected.foremanSignature && detail?.policy && (
            <p
              role="status"
              className={
                (detail.comparable?.length >= 2
                  ? "border-red-500 text-red-700 dark:text-red-300"
                  : "border-amber-400") + " rounded-xl border p-3 font-bold"
              }
            >
              {detail.comparable?.length >= 2
                ? "Tercera incidencia potencialmente comparable — seguimiento reforzado. Requiere revisión; no implica sanción."
                : detail.comparable?.length === 1
                  ? "Segunda incidencia potencialmente comparable — revisión de reiteración."
                  : selected.receipt?.signature
                    ? "Primer aviso documentado."
                    : "Sin antecedentes comunicados comparables en el horizonte aprobado."}
            </p>
          )}
          {detail?.history && (
            <details>
              <summary className="cursor-pointer font-bold">
                Versiones y trazabilidad
              </summary>
              {detail.history.map((h: any) => (
                <div
                  key={h.revision}
                  className="flex flex-wrap items-center gap-2 border-b py-2"
                >
                  <span>
                    r{h.revision} · {PART_ACTION_LABELS[h.action] || h.action} ·{" "}
                    {new Date(h.created_at).toLocaleString("es-ES")}
                  </span>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void file("view", h.revision)}
                  >
                    Ver copia de esta actuación
                  </button>
                </div>
              ))}
            </details>
          )}
        </article>
      )}
      {(!draft || draftHidden) && !selected && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              Estado
              <select
                className={input}
                value={filters.status || ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, status: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {Object.entries(PART_STATUS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Obra
              <select
                className={input}
                value={filters.work || ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, work: e.target.value }))
                }
              >
                <option value="">Todas las autorizadas</option>
                {context?.works?.map((w: any) => (
                  <option key={w.id} value={w.obra}>
                    {w.obra}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motivo
              <select
                className={input}
                value={filters.reason || ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, reason: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {PART_REASONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridad
              <select
                className={input}
                value={filters.priority || ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, priority: e.target.value }))
                }
              >
                <option value="">Todas</option>
                <option value="urgent">Urgente</option>
                <option value="ordinary">Ordinaria</option>
              </select>
            </label>
            {!isForeman && (
              <label>
                Nivel de seguimiento propuesto
                <select
                  className={input}
                  value={filters.repetition || ""}
                  onChange={(e) =>
                    setFilters((p) => ({ ...p, repetition: e.target.value }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="1">Primer registro del seguimiento</option>
                  <option value="2">Segunda incidencia para revisión</option>
                  <option value="3">Seguimiento reforzado</option>
                </select>
              </label>
            )}
            <label>
              ID de trabajador
              <input
                className={input}
                type="number"
                min="1"
                defaultValue={filters.workerId || ""}
                onBlur={(e) =>
                  setFilters((p) => ({ ...p, workerId: e.target.value }))
                }
              />
            </label>
            <label>
              Desde
              <input
                type="date"
                className={input}
                value={filters.from || ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, from: e.target.value }))
                }
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                className={input}
                value={filters.to || ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, to: e.target.value }))
                }
              />
            </label>
          </div>
          {rows.length === 0 && (
            <p>No hay registros disponibles con estos filtros.</p>
          )}
          {rows.map((r) => (
            <button
              key={r.id}
              className="block w-full rounded-xl border p-4 text-left"
              disabled={busy}
              onClick={() => void load(r.id)}
            >
              <span className="font-black">
                PA-{r.number} · {r.worker_name}
              </span>
              <span className="mt-1 block">
                {r.work} · {PART_STATUS[r.status as keyof typeof PART_STATUS]} ·{" "}
                {r.priority === "urgent" ? "URGENTE" : "Ordinaria"}
              </span>
              {r.reiteration_level && (
                <span className="block text-sm">
                  Seguimiento propuesto {r.reiteration_level} ·{" "}
                  {r.documented_antecedents} antecedentes comunicados. Sin
                  calificación jurídica automática.
                </span>
              )}
            </button>
          ))}
          {cursor && (
            <button
              className={button}
              disabled={busy}
              onClick={() => void list(true)}
            >
              Cargar más
            </button>
          )}
        </>
      )}
      {signing && selected && (
        <ModalPortal label="Firma del documento">
          <div className="fixed inset-0 overflow-y-auto bg-slate-950/70 p-3">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Firma del documento"
              className="mx-auto my-3 max-w-2xl rounded-2xl bg-white p-4 text-slate-900 dark:bg-slate-900 dark:text-white"
            >
              <h3 className="font-black">
                {signing === "authorize"
                  ? "Revisado y autorizada su comunicación al trabajador"
                  : signing === "receipt"
                    ? "Recepción del documento, sin conformidad con los hechos"
                    : signing === "elevate"
                      ? "Propuesta de elevación para valoración"
                      : signing === "resolve-dispute"
                        ? "Revisión de las observaciones del trabajador"
                        : "Declaración del encargado"}
              </h3>
              <p className="my-2 text-sm">
                {selected.number} · v{selected.version} · {selected.worker.name}
              </p>
              <dl className="my-3 space-y-2 break-words text-sm">
                <dt className="font-bold">Obra, fecha y lugar del hecho</dt>
                <dd>
                  {selected.worksite.code} · {selected.worksite.name} ·{" "}
                  {new Date(selected.content.occurredAt).toLocaleString()} ·{" "}
                  {selected.content.place}
                </dd>
                <dt className="font-bold">Motivo</dt>
                <dd>
                  {(
                    detail?.policy?.reasons ||
                    PART_REASONS.map(([id, label]) => ({ id, label }))
                  ).find((r: any) => r.id === selected.content.reason)?.label ||
                    selected.content.reason}
                </dd>
                <dt className="font-bold">Respuesta y testigos declarados</dt>
                <dd>
                  {selected.content.response || "No consta respuesta"} ·{" "}
                  {selected.content.witnesses || "Sin testigos declarados"}
                </dd>
                <dt className="font-bold">Adjuntos de la versión</dt>
                <dd>
                  {selected.content.attachments.map((a) => a.name).join(", ") ||
                    "Sin adjuntos"}
                </dd>
                {signing === "receipt" && (
                  <>
                    <dt className="font-bold">Observaciones de recepción</dt>
                    <dd>
                      {receiptNote || "Sin observaciones"} · {witnesses} ·{" "}
                      {channel}
                    </dd>
                  </>
                )}
                {["elevate", "resolve-dispute"].includes(signing) && (
                  <>
                    <dt className="font-bold">
                      Motivo de revisión / propuesta
                    </dt>
                    <dd>
                      {reason} · {authority}
                    </dd>
                  </>
                )}
              </dl>
              <p className="whitespace-pre-wrap break-words">
                {selected.content.facts}
              </p>
              <p className="my-2">{selected.content.instruction}</p>
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
              <VisitSignaturePad
                fixedPurpose={
                  signing === "receipt"
                    ? "Acuse de recibo, sin conformidad con los hechos"
                    : signing === "authorize"
                      ? "Revisado y autorizada su comunicación al trabajador"
                      : signing === "elevate"
                        ? "Revisado para remitir al órgano competente para valoración"
                        : signing === "resolve-dispute"
                          ? "He revisado las observaciones del trabajador, sin convertir el aviso en sanción"
                          : "Declaro los hechos de esta versión como encargado"
                }
                name={
                  signing === "receipt"
                    ? selected.worker.name
                    : context?.actor?.name || "Firmante"
                }
                allowAgreement={false}
                busy={busy}
                onConfirm={(image) => void sign(image)}
                onCancel={() => {
                  if (!busy) setSigning(null);
                }}
              />
            </div>
          </div>
        </ModalPortal>
      )}
    </section>
  );
}
