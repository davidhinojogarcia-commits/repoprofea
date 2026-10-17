import React, { useEffect, useRef, useState } from "react";
import {
  visitRequest,
  readVisitAttachment,
  downloadVisitFile,
} from "../src/services/visitMinutesService";
import {
  ORDER_STATUS_LABELS,
  orderClosed,
  type WorkOrder,
  type OrderStatus,
} from "../src/lib/visitWorkOrders";
import { visitInput } from "./VisitContactsPanel";
const btn =
  "min-h-[46px] rounded-xl border px-4 py-2 font-bold disabled:opacity-50";
export function VisitWorkOrdersFollowup({
  worksiteId,
  token,
}: {
  worksiteId?: string;
  token?: string;
}) {
  const [rows, setRows] = useState<WorkOrder[]>([]),
    [all, setAll] = useState(false),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [canWrite, setCanWrite] = useState(false),
    [verificationScopes, setVerificationScopes] = useState<string[]>([]),
    [history, setHistory] = useState<any>({}),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [states, setStates] = useState<Record<string, string>>({}),
    [replacements, setReplacements] = useState<Record<string, string>>({}),
    [files, setFiles] = useState<Record<string, any[]>>({});
  const guard = useRef(false),
    operation = useRef<{ key: string; id: string } | null>(null);
  const request = (action: string, data: any = {}) =>
    visitRequest(
      {
        action: (token ? "foreman-visits-" : "orders-") + action,
        worksiteId,
        token,
        ...data,
      },
      { public: !!token },
    );
  const load = async (next = 0, signal?: AbortSignal) => {
    const r = await visitRequest(
      {
        action: token ? "foreman-visits-orders" : "orders-list",
        worksiteId,
        token,
        offset: next,
        pending: !all,
      },
      { public: !!token, signal },
    );
    setRows((old) => (next ? [...old, ...r.orders] : r.orders));
    setMore(r.hasMore);
    setOffset(r.nextOffset);
    setCanWrite(token ? true : r.canWrite);
    setVerificationScopes(r.verificationScopes || []);
  };
  useEffect(() => {
    const abort = new AbortController();
    setRows([]);
    setHistory({});
    setNotes({});
    setFiles({});
    setError("");
    void load(0, abort.signal).catch((e) => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => abort.abort();
  }, [worksiteId, token, all]);
  const run = async (fn: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3">
      <h3 className="font-black text-lg">Seguimiento de órdenes de obra</h3>
      <p className="text-sm">
        El acta firmada conserva su contenido original. Solo una comprobación
        autorizada cierra el cumplimiento de una orden.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />{" "}
          Incluir órdenes finalizadas
        </label>
        <button
          className={btn}
          disabled={busy}
          onClick={() => void run(() => load())}
        >
          Actualizar órdenes
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!rows.length && <p>Sin órdenes visibles en esta selección.</p>}
      {rows.map((o) => (
        <article
          key={o.id}
          className="rounded-2xl border bg-white p-4 dark:bg-slate-900 space-y-3"
        >
          <h4 className="font-black">
            {o.origin_number} · Orden {o.number}
          </h4>
          <p className="whitespace-pre-wrap">{o.definition.description}</p>
          <p>
            {ORDER_STATUS_LABELS[o.status]} · Plazo:{" "}
            {o.definition.deadline || "Sin plazo"} · Prioridad:{" "}
            {o.definition.priority === "urgent"
              ? "Urgente"
              : o.definition.priority === "high"
                ? "Alta"
                : "Normal"}
          </p>
          <p className="text-sm">
            Emite: {o.definition.issuerName} · {o.definition.issuerRole} ·{" "}
            {o.definition.issuerEntity}
            <br />
            Responsable: {o.definition.recipient || "Sin asignar"} · Zona:{" "}
            {o.definition.location || "No indicada"}
          </p>
          {o.executed_at && (
            <p>
              Ejecución declarada:{" "}
              {new Date(o.executed_at).toLocaleString("es")}
            </p>
          )}
          {o.verified_at && (
            <p>Comprobación: {new Date(o.verified_at).toLocaleString("es")}</p>
          )}
          {canWrite &&
            !orderClosed(o.status) &&
            (!token || o.definition.foremanCanReport) && (
              <div className="space-y-2">
                <label className="block">
                  Avance o resultado de comprobación
                  <textarea
                    className={visitInput}
                    value={notes[o.id] || ""}
                    onChange={(e) =>
                      setNotes({ ...notes, [o.id]: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  Estado
                  <select
                    className={visitInput}
                    aria-label="Estado"
                    value={states[o.id] || ""}
                    onChange={(e) =>
                      setStates({ ...states, [o.id]: e.target.value })
                    }
                  >
                    <option value="">
                      Conservar estado y registrar avance
                    </option>
                    {Object.entries(ORDER_STATUS_LABELS)
                      .filter(
                        ([s]) =>
                          s !== o.status &&
                          (![
                            "verified",
                            "cancelled",
                            "superseded",
                            "breached",
                          ].includes(s) ||
                            verificationScopes.includes(o.definition.nature)) &&
                          (!token ||
                            [
                              "pending_execution",
                              "in_progress",
                              "executed_pending_verification",
                            ].includes(s)),
                      )
                      .map(([s, label]) => (
                        <option key={s} value={s}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
                {states[o.id] === "superseded" && (
                  <label className="block">
                    Identificador de la orden que la sustituye
                    <input
                      className={visitInput}
                      value={replacements[o.id] || ""}
                      onChange={(e) =>
                        setReplacements({
                          ...replacements,
                          [o.id]: e.target.value,
                        })
                      }
                    />
                  </label>
                )}
                <label className="block">
                  Fotografía o documento justificativo
                  <input
                    className={visitInput}
                    type="file"
                    accept="image/png,image/jpeg,application/pdf"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f)
                        void run(async () => {
                          const base64 = await readVisitAttachment(f);
                          setFiles((old) => ({
                            ...old,
                            [o.id]: [
                              ...(old[o.id] || []),
                              {
                                id: crypto.randomUUID(),
                                name: f.name,
                                mime: f.type,
                                base64,
                                caption: "",
                              },
                            ],
                          }));
                        });
                    }}
                  />
                </label>
                {(files[o.id] || []).map((f) => (
                  <p key={f.id}>
                    {f.name}{" "}
                    <button
                      className={btn}
                      onClick={() =>
                        setFiles({
                          ...files,
                          [o.id]: files[o.id].filter((x) => x.id !== f.id),
                        })
                      }
                    >
                      Quitar
                    </button>
                  </p>
                ))}
                <button
                  className={btn + " bg-[#00548E] text-white"}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const payload = {
                        orderId: o.id,
                        revision: o.revision,
                        status: states[o.id] || null,
                        note: notes[o.id] || "",
                        evidence: files[o.id] || [],
                        replacementId: replacements[o.id] || null,
                      };
                      const key = JSON.stringify(payload);
                      if (operation.current?.key !== key)
                        operation.current = { key, id: crypto.randomUUID() };
                      await request("transition", {
                        ...payload,
                        operation: operation.current.id,
                      });
                      operation.current = null;
                      setNotes({ ...notes, [o.id]: "" });
                      setFiles({ ...files, [o.id]: [] });
                      setStates({ ...states, [o.id]: "" });
                      setHistory({ ...history, [o.id]: null });
                      await load();
                    })
                  }
                >
                  Guardar avance o comprobación
                </button>
              </div>
            )}
          <button
            className={btn}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const h = await request("history", { orderId: o.id });
                setHistory({ ...history, [o.id]: h });
              })
            }
          >
            Ver historial
          </button>
          {history[o.id] && (
            <div className="space-y-2">
              <details>
                <summary>Versiones de la orden en actas firmadas</summary>
                {history[o.id].definitions?.map((d: any) => (
                  <div className="border-t py-2" key={d.version}>
                    <p>
                      Versión {d.version} ·{" "}
                      {new Date(d.at).toLocaleString("es")}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {d.definition.description}
                    </p>
                    <p>
                      {d.definition.issuerName} · {d.definition.issuerRole} ·{" "}
                      {d.reason || "Texto original"}
                    </p>
                  </div>
                ))}
              </details>
              {history[o.id].events.map((e: any) => (
                <div key={e.id} className="border-t py-2">
                  <p>
                    {new Date(e.at).toLocaleString("es")} ·{" "}
                    {ORDER_STATUS_LABELS[e.to_status as OrderStatus]} ·{" "}
                    {e.actor_type === "foreman"
                      ? "Encargado"
                      : "Responsable autorizado"}
                    {e.actor_id ? " · " + e.actor_id : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{e.note}</p>
                  {e.details.evidenceIds?.map((id: string) => (
                    <button
                      className={btn}
                      key={id}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await request("evidence", {
                            orderId: o.id,
                            evidenceId: id,
                          });
                          downloadVisitFile({
                            base64: r.file.base64,
                            filename: r.file.name,
                            mime: r.file.mime,
                          });
                        })
                      }
                    >
                      Descargar evidencia
                    </button>
                  ))}
                </div>
              ))}
              {history[o.id].hasMore && (
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const h = await request("history", {
                        orderId: o.id,
                        before: history[o.id].nextBefore,
                      });
                      setHistory({
                        ...history,
                        [o.id]: {
                          ...h,
                          events: [...history[o.id].events, ...h.events],
                        },
                      });
                    })
                  }
                >
                  Historial anterior
                </button>
              )}
            </div>
          )}
        </article>
      ))}
      {more && (
        <button
          className={btn}
          disabled={busy}
          onClick={() => void run(() => load(offset))}
        >
          Cargar más órdenes
        </button>
      )}
    </section>
  );
}
