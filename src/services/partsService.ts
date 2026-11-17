import { supabase } from "../lib/supabase";
import { visitFileBytes } from "./visitMinutesService";
export async function partsRequest<T = any>(
  body: Record<string, unknown>,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  let jwt = "";
  if (!token) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token)
      throw new Error("Inicia sesión para consultar los partes.");
    jwt = data.session.access_token;
  }
  const response = await fetch("/api/parts", {
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
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok)
    throw Object.assign(
      new Error(
        data?.message ||
          "No se confirmó la operación. Conserva el trabajo y vuelve a consultar su estado.",
      ),
      { status: response.status },
    );
  return data;
}
export async function openPartFile(
  file: any,
  action: "view" | "download" | "share",
) {
  const bytes = await visitFileBytes(file),
    blob = new Blob([bytes], { type: file.mime || "application/pdf" }),
    url = URL.createObjectURL(blob);
  try {
    if (action === "share") {
      const document = new File([blob], file.filename, { type: blob.type });
      if (navigator.canShare?.({ files: [document] })) {
        await navigator.share({
          files: [document],
          title: "Documento laboral de acceso restringido",
        });
        return;
      }
    }
    const a = document.createElement("a");
    a.href = url;
    if (action !== "view") a.download = file.filename;
    else {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
export async function partAttachment(file: File) {
  if (!["image/png", "image/jpeg", "application/pdf"].includes(file.type))
    throw new Error("Selecciona un PDF, PNG o JPEG.");
  // Reuse the bounded existing image compression; no audio upload or transcription.
  const { prepareVisitAttachment } =
    await import("../lib/visitAttachmentProcessing");
  const prepared = await prepareVisitAttachment(file);
  const source = prepared.blob;
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("No se pudo leer el anexo."));
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.readAsDataURL(source);
  });
  return { name: prepared.name, mime: prepared.mime, base64 };
}
