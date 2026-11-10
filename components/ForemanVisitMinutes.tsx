import React, { useEffect, useRef, useState } from "react";
import {
  visitRequest,
  downloadVisitFile,
  visitFileBytes,
} from "../src/services/visitMinutesService";
import { VisitWorkOrdersFollowup } from "./VisitWorkOrdersFollowup";
const btn =
  "inline-flex min-h-[44px] min-w-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center text-sm font-bold text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00548E] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";
export default function ForemanVisitMinutes({
  token,
  onOpenPdf,
}: {
  token: string;
  onOpenPdf?: (bytes: Uint8Array, title: string) => void;
}) {
  const [tab, setTab] = useState<"signed" | "orders">("signed"),
    [rows, setRows] = useState<any[]>([]),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [work, setWork] = useState("");
  const guard = useRef(false);
  const request = (action: string, extra: any = {}) =>
    visitRequest(
      { action: "foreman-visits-" + action, token, ...extra },
      { public: true },
    );
  const load = async (next = 0, signal?: AbortSignal) => {
    const r = await visitRequest(
      { action: "foreman-visits-list", token, offset: next },
      { public: true, signal },
    );
    setRows((old) => (next ? [...old, ...r.publications] : r.publications));
    setMore(r.hasMore);
    setOffset(r.nextOffset);
    setWork(r.worksite);
  };
  useEffect(() => {
    const abort = new AbortController();
    setRows([]);
    void load(0, abort.signal).catch((e) => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => abort.abort();
  }, [token]);
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
    <section className="min-w-0 space-y-3 text-slate-900 dark:text-slate-100">
      <h2 className="break-words text-lg font-black sm:text-xl">Actas de visitas · {work}</h2>
      <nav className="grid grid-cols-2 gap-2" aria-label="Actas de visitas">
        <button
          className={btn}
          aria-pressed={tab === "signed"}
          onClick={() => setTab("signed")}
        >
          ACTAS FIRMADAS
        </button>
        <button
          className={btn}
          aria-pressed={tab === "orders"}
          onClick={() => setTab("orders")}
        >
          ÓRDENES PENDIENTES
        </button>
      </nav>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {tab === "orders" ? (
        <VisitWorkOrdersFollowup token={token} />
      ) : (
        <>
          <p>
            Documentos definitivos de esta obra. Confirmar su lectura no implica
            aceptar una orden ni verificar su ejecución.
          </p>
          <button
            className={btn}
            disabled={busy}
            onClick={() => void run(() => load())}
          >
            Actualizar actas
          </button>
          {!rows.length && (
            <p>No hay actas firmadas disponibles para este acceso.</p>
          )}
          {rows.map((p) => (
            <article
              className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4"
              key={p.recordId + ":" + p.version}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 flex-1 break-words text-sm font-black">{p.number} · v{p.version}</h3>
                <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{p.visitDate}</span>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {onOpenPdf && (
                  <button
                    className={btn}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await request("pdf", p);
                        onOpenPdf(
                          await visitFileBytes(r.file),
                          p.number + " · PDF firmado",
                        );
                      })
                    }
                  >
                    Ver PDF firmado
                  </button>
                )}
                <button
                  className={btn + " !border-[#00548E] !bg-[#00548E] !text-white hover:!bg-[#004477]"}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await request("pdf", p);
                      await downloadVisitFile(r.file);
                    })
                  }
                >
                  Abrir / descargar PDF firmado
                </button>
                <button
                  className={btn + " sm:col-span-2"}
                  disabled={busy || !!p.readAt}
                  onClick={() =>
                    void run(async () => {
                      await request("read", p);
                      await load();
                    })
                  }
                >
                  {p.readAt
                    ? "Lectura confirmada"
                    : "Confirmar lectura del acta"}
                </button>
              </div>
              {p.readAt && (
                <p className="text-sm">
                  Leída: {new Date(p.readAt).toLocaleString("es")}
                </p>
              )}
            </article>
          ))}
          {more && (
            <button
              className={btn}
              disabled={busy}
              onClick={() => void run(() => load(offset))}
            >
              Cargar siguientes actas
            </button>
          )}
        </>
      )}
    </section>
  );
}
