import React, { useEffect, useRef, useState } from "react";
import {
  visitRequest,
  downloadVisitFile,
  visitFileBytes,
} from "../src/services/visitMinutesService";
import { VisitWorkOrdersFollowup } from "./VisitWorkOrdersFollowup";
const btn =
  "min-h-[46px] rounded-xl border px-4 py-3 font-bold disabled:opacity-50";
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
    <section className="space-y-4">
      <h2 className="text-xl font-black">ACTAS DE VISITAS · {work}</h2>
      <nav className="flex flex-wrap gap-2" aria-label="Actas de visitas">
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
              className="rounded-2xl border bg-white p-4 space-y-3"
              key={p.recordId + ":" + p.version}
            >
              <h3 className="font-black">
                {p.number} · Versión {p.version}
              </h3>
              <p>{p.visitDate}</p>
              <div className="flex flex-wrap gap-2">
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
                  className={btn + " bg-[#00548E] text-white"}
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
                  className={btn}
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
