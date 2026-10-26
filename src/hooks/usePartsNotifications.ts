import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
/** Generic notification metadata only; scoped and destroyed on account change. */
export function usePartsNotifications(
  userId: string,
  onNotice: (message: string) => void,
) {
  const [state, setState] = useState({ owner: userId, count: 0 }),
    notice = useRef(onNotice);
  notice.current = onNotice;
  useEffect(() => {
    const setCount = (count: number) => setState({ owner: userId, count });
    let disposed = false,
      lastRead = 0;
    const ids = new Set<string>(),
      removed = new Set<string>();
    setCount(0);
    async function refresh() {
      if (disposed || Date.now() - lastRead < 1000) return;
      lastRead = Date.now();
      try {
        const rows = await supabase.query("parts_notifications", {
          query: `select=id&owner_id=eq.${encodeURIComponent(userId)}&recipient=eq.supervisor&read_at=is.null&limit=100`,
          networkOnly: true,
        });
        if (disposed) return;
        for (const r of rows || []) if (!removed.has(r.id)) ids.add(r.id);
        setCount(ids.size);
      } catch {
        if (!disposed)
          notice.current(
            "No se pudo actualizar el indicador de Partes y avisos. Abre el módulo para comprobar los pendientes.",
          );
      }
    }
    void refresh();
    const channel = supabase
      .channel("parts-notifications-" + userId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "parts_notifications",
          filter: "owner_id=eq." + userId,
        },
        (event: any) => {
          if (
            disposed ||
            event.new?.owner_id !== userId ||
            event.new?.recipient !== "supervisor"
          )
            return;
          const row = event.new;
          if (row.read_at) {
            ids.delete(row.id);
            removed.add(row.id);
          } else if (!ids.has(row.id)) {
            ids.add(row.id);
            notice.current(
              row.message === "Incidencia urgente pendiente de revisión"
                ? row.message
                : "Nuevo aviso en Partes y avisos",
            );
          }
          if (ids.size > 200) ids.delete(ids.values().next().value!);
          setCount(ids.size);
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const marked = () => {
      ids.clear();
      setCount(0);
    };
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("parts:notifications-read", marked);
    document.addEventListener("visibilitychange", focus);
    return () => {
      disposed = true;
      ids.clear();
      removed.clear();
      void supabase.removeChannel(channel);
      window.removeEventListener("parts:notifications-read", marked);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [userId]);
  return state.owner === userId ? state.count : 0;
}
