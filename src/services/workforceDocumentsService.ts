import { supabase } from "../lib/supabase";
export { openPartFile as openWorkforceFile } from "./partsService";
export async function workforceRequest(
  body: Record<string, unknown>,
  token?: string,
  signal?: AbortSignal,
): Promise<any> {
  let jwt = "";
  if (!token) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token)
      throw new Error("Inicia sesión para consultar los documentos.");
    jwt = data.session.access_token;
  }
  const r = await fetch("/api/workforce-documents", {
    method: "POST",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: "Bearer " + jwt } : {}),
    },
    body: JSON.stringify({ ...body, ...(token ? { token } : {}) }),
    signal: signal || AbortSignal.timeout(65000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.ok)
    throw Object.assign(
      new Error(
        data?.message ||
          "No se confirmó la operación. Conserva el borrador y vuelve a consultar.",
      ),
      { status: r.status },
    );
  return data;
}
