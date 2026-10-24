import { getSessionUser, supabase } from "../lib/supabase";

export type SaeNeed = {
  id: string;
  ownerId?: string;
  obra: string;
  codigoObra: string;
  mes: string;
  ano: number | null;
  estado: string;
  categorias: { id: string; categoria: string; cantidad: number }[];
  notas?: string;
  createdAt?: string;
};

export type SaeReportVersionCandidate = {
  id: string;
  orderNumber: number;
  resultCode: string;
  pageNumber: number;
  overlayX: number;
  overlayY: number;
};

export type SaeReportVersion = {
  version: number;
  finalizedAt: string;
  candidates: SaeReportVersionCandidate[];
};

export type SaeReport = {
  id: string;
  needId: string;
  fileName: string;
  fileBase64: string;
  storagePath?: string;
  extractedText: string;
  extractionSource: string;
  offerNumber: string;
  obra: string;
  codigoObra: string;
  mes: string;
  quincena: string;
  periodRevision?: string;
  categoria: string;
  status: "review" | "finalized";
  versions: SaeReportVersion[];
  createdAt?: string;
};

export type SaeCandidate = {
  id: string;
  needId: string;
  reportId: string;
  orderNumber: number;
  fullNameOriginal: string;
  normalizedName: string;
  apellidos: string;
  nombre: string;
  categoria: string;
  obra: string;
  codigoObra: string;
  offerNumber: string;
  mes: string;
  quincena: string;
  estado: string;
  resultCode: string;
  linkedWorkerId?: number | null;
  pageNumber: number;
  overlayX: number;
  overlayY: number;
  confidence: string;
  alignmentOffsetX?: number;
  alignmentOffsetY?: number;
};

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
export const monthNumber = (value: string) => {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const index = MONTHS.findIndex((m) =>
    clean.includes(
      m
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    ),
  );
  return index >= 0 ? index + 1 : null;
};
const monthLabel = (value: number | null | undefined) =>
  value && value >= 1 && value <= 12 ? MONTHS[value - 1] : "";
const fortnightNumber = (value: string) =>
  /^\s*1/.test(String(value || ""))
    ? 1
    : /^\s*2/.test(String(value || ""))
      ? 2
      : null;
const fortnightLabel = (value: number | null | undefined) =>
  value === 1 ? "1ª Quincena" : value === 2 ? "2ª Quincena" : "";

const statusToDb: Record<string, string> = {
  "Sin asignar": "sin_asignar",
  Preseleccionado: "preseleccionado",
  "1ª Quincena": "primera_quincena",
  "2ª Quincena": "segunda_quincena",
  Contratado: "contratado",
  "No contratado": "no_contratado",
  "Pendiente de datos": "pendiente_datos",
};
const statusFromDb: Record<string, string> = Object.fromEntries(
  Object.entries(statusToDb).map(([k, v]) => [v, k]),
);

const uid = async () => {
  const user = await getSessionUser();
  if (!user) throw new Error("Debe iniciar sesión.");
  return user.id;
};
const authContext = async () => {
  const ownerId = await uid();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token)
    throw new Error("La sesión ha caducado. Vuelva a iniciar sesión.");
  return { ownerId, token };
};
const uuid = () => crypto.randomUUID();
const encodeStoragePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");
const safeFilename = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");

async function uploadSaeFile(path: string, dataUrl: string) {
  const { token } = await authContext();
  const blob = await (await fetch(dataUrl)).blob();
  const response = await fetch(
    `${supabase.url}/storage/v1/object/sae-documents/${encodeStoragePath(path)}`,
    {
      method: "POST",
      headers: {
        apikey: supabase.key,
        Authorization: `Bearer ${token}`,
        "Content-Type": blob.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: blob,
    },
  );
  if (!response.ok)
    throw new Error(
      `No se pudo guardar el documento SAE${(await response.text().catch(() => "")) ? ": error de almacenamiento" : "."}`,
    );
}

async function deleteSaeFile(path: string) {
  if (!path) return;
  const { token } = await authContext();
  await fetch(
    `${supabase.url}/storage/v1/object/sae-documents/${encodeStoragePath(path)}`,
    {
      method: "DELETE",
      headers: { apikey: supabase.key, Authorization: `Bearer ${token}` },
    },
  ).catch(() => undefined);
}

async function downloadSaeFile(path: string): Promise<string> {
  if (!path) return "";
  const { token } = await authContext();
  const response = await fetch(
    `${supabase.url}/storage/v1/object/authenticated/sae-documents/${encodeStoragePath(path)}`,
    { headers: { apikey: supabase.key, Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return "";
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(
        reader.error || new Error("No se pudo recuperar el documento SAE."),
      );
    reader.readAsDataURL(blob);
  });
}

export async function listSaeNeeds(): Promise<SaeNeed[]> {
  await uid();
  const [needs, categories] = await Promise.all([
    supabase.query("sae_needs", { query: "select=*&order=created_at.desc" }),
    supabase.query("sae_need_categories", {
      query: "select=*&order=created_at.asc",
    }),
  ]);
  return (needs || []).map((row: any) => ({
    id: row.id,
    ownerId: row.owner_id,
    obra: row.work_name || "",
    codigoObra: row.work_code || "",
    mes: monthLabel(Number(row.hiring_month || 0)),
    ano: row.hiring_year == null ? null : Number(row.hiring_year),
    estado: row.status || "pendiente_candidatos_sae",
    notas: row.notes || "",
    createdAt: row.created_at,
    categorias: (categories || [])
      .filter((c: any) => c.need_id === row.id)
      .map((c: any) => ({
        id: c.id,
        categoria: c.category || "",
        cantidad: Number(c.requested_count || 0),
      })),
  }));
}

type NeedInput = Omit<SaeNeed, "id" | "ownerId" | "createdAt">;
const needBody = (input: NeedInput, ownerId: string) => {
  const hiringMonth = monthNumber(input.mes);
  if (!hiringMonth) throw new Error("El mes de contratación no es válido.");
  const hiringYear = input.ano || new Date().getFullYear();
  const totalRequested = input.categorias.reduce(
    (sum, c) => sum + Number(c.cantidad || 0),
    0,
  );
  return {
    hiringMonth,
    hiringYear,
    totalRequested,
    body: {
      work_name: input.obra,
      work_code: input.codigoObra || null,
      hiring_month: hiringMonth,
      hiring_year: hiringYear,
      total_requested: totalRequested,
      notes: input.notas || null,
      updated_by: ownerId,
    },
  };
};

export async function createSaeNeed(input: NeedInput): Promise<SaeNeed> {
  const ownerId = await uid();
  const id = uuid();
  const normalized = needBody(input, ownerId);
  await supabase.query("sae_needs", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      id,
      owner_id: ownerId,
      ...normalized.body,
      status: "pendiente_candidatos_sae",
      created_by: ownerId,
    },
  });
  if (input.categorias.length) {
    await supabase.query("sae_need_categories", {
      method: "POST",
      prefer: "return=minimal",
      body: input.categorias.map((category) => ({
        id: uuid(),
        need_id: id,
        category: category.categoria,
        requested_count: category.cantidad,
        created_by: ownerId,
      })),
    });
  }
  return {
    ...input,
    id,
    ownerId,
    ano: normalized.hiringYear,
    estado: "pendiente_candidatos_sae",
  };
}

export async function updateSaeNeed(
  id: string,
  input: NeedInput,
): Promise<void> {
  const ownerId = await uid();
  const normalized = needBody(input, ownerId);
  await supabase.query("sae_needs", {
    method: "PATCH",
    prefer: "return=minimal",
    query: `id=eq.${encodeURIComponent(id)}`,
    body: normalized.body,
  });
  await supabase.query("sae_need_categories", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `need_id=eq.${encodeURIComponent(id)}`,
  });
  if (input.categorias.length) {
    await supabase.query("sae_need_categories", {
      method: "POST",
      prefer: "return=minimal",
      body: input.categorias.map((category) => ({
        id: uuid(),
        need_id: id,
        category: category.categoria,
        requested_count: category.cantidad,
        created_by: ownerId,
      })),
    });
  }
}

export async function deleteSaeNeed(id: string): Promise<void> {
  await uid();
  const reports = await supabase.query("sae_reports", {
    query: `select=id,storage_path&need_id=eq.${encodeURIComponent(id)}`,
  });
  // Delete children explicitly because the production foreign keys are not assumed to cascade.
  await supabase.query("sae_generated_documents", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `need_id=eq.${encodeURIComponent(id)}`,
  });
  await supabase.query("sae_registration_drafts", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `need_id=eq.${encodeURIComponent(id)}`,
  });
  await supabase.query("sae_candidate_allocations", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `need_id=eq.${encodeURIComponent(id)}`,
  });
  await supabase.query("sae_candidates", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `need_id=eq.${encodeURIComponent(id)}`,
  });
  await supabase.query("sae_reports", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `need_id=eq.${encodeURIComponent(id)}`,
  });
  await supabase.query("sae_need_categories", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `need_id=eq.${encodeURIComponent(id)}`,
  });
  await supabase.query("sae_needs", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `id=eq.${encodeURIComponent(id)}`,
  });
  await Promise.all(
    (reports || []).map((r: any) => deleteSaeFile(r.storage_path || "")),
  );
}

export async function deleteSaeReport(
  report: Pick<SaeReport, "id" | "needId">,
): Promise<void> {
  await uid();
  const storedReports = await supabase.query("sae_reports", {
    query: `select=id,storage_path&need_id=eq.${encodeURIComponent(report.needId)}&id=eq.${encodeURIComponent(report.id)}&limit=1`,
  });
  // El trabajador creado desde SAE es un registro independiente. Al borrar el
  // informe se eliminan solo el documento y sus candidatos importados; los
  // trabajadores ya registrados se conservan sin cambios.
  const stored = storedReports?.[0];
  if (!stored)
    throw new Error(
      "El informe ya no existe o no tienes permiso para eliminarlo.",
    );
  await supabase.query("sae_candidates", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `source_report_id=eq.${encodeURIComponent(report.id)}`,
  });
  await supabase.query("sae_reports", {
    method: "DELETE",
    prefer: "return=minimal",
    query: `id=eq.${encodeURIComponent(report.id)}&need_id=eq.${encodeURIComponent(report.needId)}`,
  });
  await deleteSaeFile(stored.storage_path || "");
}

export async function updateSaeReportStatus(
  id: string,
  status: "review" | "finalized",
  snapshot?: SaeReportVersionCandidate[],
): Promise<number | null> {
  await uid();
  if (status === 'finalized') {
    if (!snapshot) throw new Error('Debe comprobar la versión del informe antes de finalizarlo.');
    return await supabase.rpc('sae_finalize_report_version', { p_report_id: id, p_snapshot: snapshot });
  }
  // The server preserves archived versions and reconciles the reopened draft
  // atomically, without trusting a cached copy of the report history.
  await supabase.rpc('sae_reopen_report', { p_report_id: id });
  return null;
}

export async function listSaeReports(needId?: string): Promise<SaeReport[]> {
  await uid();
  const reportQuery = `select=id,need_id,file_name,storage_path,raw_text,extraction_method,processing_status,detected_legend,created_at${needId ? `&need_id=eq.${encodeURIComponent(needId)}` : ""}&order=created_at.desc`;
  const [rows, candidateRows] = await Promise.all([
    supabase.query("sae_reports", { query: reportQuery }),
    supabase.query("sae_candidates", {
      query: `select=source_report_id,offer_number,work_name,work_code,hiring_month,fortnight,category${needId ? `&need_id=eq.${encodeURIComponent(needId)}` : ""}`,
    }),
  ]);
  return (rows || []).map((r: any) => {
    const sample =
      (candidateRows || []).find((candidate: any) => candidate.source_report_id === r.id) ||
      {};
    return {
      id: r.id,
      needId: r.need_id,
      fileName: r.file_name || "",
      fileBase64: "",
      storagePath: r.storage_path || "",
      extractedText: r.raw_text || "",
      extractionSource: r.extraction_method || "",
      offerNumber: sample.offer_number || "",
      obra: sample.work_name || "",
      codigoObra: sample.work_code || "",
      mes: monthLabel(Number(r.detected_legend?.__manual_period?.month || sample.hiring_month || 0)),
      periodRevision: r.detected_legend?.__manual_period?.revision || "",
      quincena: r.detected_legend?.__manual_period?.label || fortnightLabel(
        sample.fortnight == null ? null : Number(sample.fortnight),
      ),
      categoria: sample.category || "",
      status:
        r.detected_legend?.__workflow_state === "finalized" ||
        r.processing_status === "finalized"
          ? "finalized"
          : "review",
      versions: Array.isArray(r.detected_legend?.__finalized_versions)
        ? r.detected_legend.__finalized_versions
            .map((version: any, index: number) => ({
              version: Number(version?.version || index + 1),
              finalizedAt: String(version?.finalizedAt || ""),
              candidates: Array.isArray(version?.candidates)
                ? version.candidates.map((candidate: any) => ({
                    id: String(candidate?.id || ""),
                    orderNumber: Number(candidate?.orderNumber || 0),
                    resultCode: String(candidate?.resultCode || ""),
                    pageNumber: Math.max(1, Number(candidate?.pageNumber || 1)),
                    overlayX: Number(candidate?.overlayX ?? 184),
                    overlayY: Number(candidate?.overlayY ?? 50),
                  }))
                : [],
            }))
            .filter((version: SaeReportVersion) => version.candidates.length > 0)
        : [],
      createdAt: r.created_at,
    } as SaeReport;
  });
}

export type SaeReportPeriod = "1ª Quincena" | "2ª Quincena" | "Mensual";

export async function saveSaeReportPeriod(report: SaeReport, period: SaeReportPeriod): Promise<void> {
  await uid();
  if (!["1ª Quincena", "2ª Quincena", "Mensual"].includes(period))
    throw new Error("Seleccione un periodo válido.");
  await supabase.rpc("sae_set_report_period", {
    p_report_id: report.id,
    p_period: period,
    p_expected_revision: report.periodRevision || "",
  });
}

export async function loadSaeReportFile(report: Pick<SaeReport, "id" | "storagePath" | "fileBase64">): Promise<string> {
  if (report.fileBase64) return report.fileBase64;
  let storagePath = String(report.storagePath || "");
  if (!storagePath) {
    const rows = await supabase.query("sae_reports", {
      query: `select=storage_path&id=eq.${encodeURIComponent(report.id)}&limit=1`,
    });
    storagePath = String(rows?.[0]?.storage_path || "");
  }
  if (!storagePath) throw new Error("El informe SAE no tiene un archivo asociado.");
  return downloadSaeFile(storagePath);
}

export async function createSaeReport(
  needId: string,
  report: Omit<SaeReport, "id" | "needId" | "status" | "versions" | "createdAt">,
  candidates: Omit<SaeCandidate, "id" | "needId" | "reportId">[],
) {
  const ownerId = await uid();
  const id = uuid();
  const mimeType =
    report.fileBase64.match(/^data:([^;,]+)/)?.[1] || "application/pdf";
  const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  if (!["application/pdf", "image/jpeg", "image/png"].includes(normalizedMime))
    throw new Error("Formato SAE no admitido. Use PDF, JPG o PNG.");
  // La política RLS de Storage valida que la primera carpeta sea el id de la
  // solicitud SAE. Mantener este orden es imprescindible para poder guardar el
  // informe sin relajar la seguridad entre supervisores.
  const storagePath = `${needId}/${ownerId}/${id}/${safeFilename(report.fileName || "informe_sae.pdf")}`;
  await uploadSaeFile(storagePath, report.fileBase64);
  const extractionMethod = report.extractionSource.includes("ocr")
    ? "ocr"
    : report.extractionSource.includes("native")
      ? "native"
      : "hybrid";
  const pageNumbers = Array.from(
    report.extractedText.matchAll(/\[P[ÁA]GINA\s+(\d+)\]/gi),
  ).map((m) => Number(m[1]));
  const pageCount = pageNumbers.length ? Math.max(...pageNumbers) : 1;
  try {
    await supabase.query("sae_reports", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        id,
        need_id: needId,
        owner_id: ownerId,
        file_name: report.fileName,
        mime_type: normalizedMime,
        storage_path: storagePath,
        page_count: pageCount,
        extraction_method: extractionMethod,
        processing_status: "review",
        raw_text: report.extractedText,
        detected_legend: Object.fromEntries(
          SAE_RESULT_CODES.map(([code, label]) => [code, label]),
        ),
        created_by: ownerId,
        updated_by: ownerId,
      },
    });
    if (candidates.length) {
      const candidateRows = candidates.map((candidate) => ({
        id: uuid(),
        need_id: needId,
        source_report_id: id,
        owner_id: ownerId,
        original_full_name: candidate.fullNameOriginal,
        normalized_full_name: candidate.normalizedName,
        first_name: candidate.nombre || null,
        surnames: candidate.apellidos || null,
        category: candidate.categoria || null,
        offer_number: candidate.offerNumber || report.offerNumber || null,
        work_name: candidate.obra || report.obra || null,
        work_code: candidate.codigoObra || report.codigoObra || null,
        hiring_month: monthNumber(candidate.mes || report.mes),
        fortnight: fortnightNumber(candidate.quincena || report.quincena),
        source_page: Math.max(1, Number(candidate.pageNumber || 1)),
        source_row_text: `${candidate.orderNumber} ${candidate.fullNameOriginal}`.trim(),
        source_position: {
          orderNumber: candidate.orderNumber,
          x: candidate.overlayX,
          y: candidate.overlayY,
        },
        confidence: String(candidate.confidence || "Media").toLowerCase(),
        evidence: [
          {
            type: "document-row",
            page: candidate.pageNumber,
            text: candidate.fullNameOriginal,
          },
        ],
        status: "sin_asignar",
        selected_for_hire: false,
        result_code: null,
        created_by: ownerId,
        updated_by: ownerId,
      }));
      await supabase.query("sae_candidates", {
        method: "POST",
        prefer: "return=minimal",
        body: candidateRows,
      });
    }
  
    return id;
  } catch (error) {
    // Evita dejar un informe huérfano si falla la inserción del informe o de
    // cualquiera de sus candidatos después de haber subido el archivo.
    try {
      await supabase.query("sae_candidates", {
        method: "DELETE",
        prefer: "return=minimal",
        query: `source_report_id=eq.${encodeURIComponent(id)}`,
      });
      await supabase.query("sae_reports", {
        method: "DELETE",
        prefer: "return=minimal",
        query: `id=eq.${encodeURIComponent(id)}`,
      });
    } catch {
      // La limpieza de base de datos es de mejor esfuerzo; el error original
      // debe seguir siendo el que se muestra al usuario.
    }
    await deleteSaeFile(storagePath);
    throw error;
  }
}

export async function listSaeCandidates(
  needId?: string,
  options: { reportId?: string; networkOnly?: boolean } = {},
): Promise<SaeCandidate[]> {
  await uid();
  const query = `select=*${needId ? `&need_id=eq.${encodeURIComponent(needId)}` : ""}${options.reportId ? `&source_report_id=eq.${encodeURIComponent(options.reportId)}` : ""}&order=created_at.asc`;
  const rows = await supabase.query("sae_candidates", { query, networkOnly: options.networkOnly });
  return (rows || [])
    .map((r: any) => {
      const pos = r.source_position || {};
      return {
        id: r.id,
        needId: r.need_id,
        reportId: r.source_report_id,
        orderNumber: Number(
          pos.orderNumber ||
            String(r.source_row_text || "").match(/^\s*(\d+)/)?.[1] ||
            0,
        ),
        fullNameOriginal: r.original_full_name || "",
        normalizedName: r.normalized_full_name || "",
        apellidos: r.surnames || "",
        nombre: r.first_name || "",
        categoria: r.category || "",
        obra: r.work_name || "",
        codigoObra: r.work_code || "",
        offerNumber: r.offer_number || "",
        mes: monthLabel(r.hiring_month == null ? null : Number(r.hiring_month)),
        quincena: fortnightLabel(
          r.fortnight == null ? null : Number(r.fortnight),
        ),
        estado: statusFromDb[r.status] || "Sin asignar",
        resultCode: r.result_code || "",
        linkedWorkerId:
          r.existing_worker_id == null ? null : Number(r.existing_worker_id),
        pageNumber: Number(r.source_page || 1),
        overlayX: Number(pos.x ?? 184) + Number(r.alignment_offset_x ?? 0),
        overlayY: Number(pos.y ?? 50) + Number(r.alignment_offset_y ?? 0),
        alignmentOffsetX: Number(r.alignment_offset_x ?? 0),
        alignmentOffsetY: Number(r.alignment_offset_y ?? 0),
        confidence: r.confidence
          ? `${String(r.confidence).charAt(0).toUpperCase()}${String(r.confidence).slice(1)}`
          : "Media",
      };
    })
    .sort((a: SaeCandidate, b: SaeCandidate) => a.orderNumber - b.orderNumber);
}

export function positionSaePreviewCandidates(rows: SaeCandidate[], x: number, y: number): SaeCandidate[] {
  return rows.map(c => ({ ...c,
    overlayX: c.overlayX - (c.alignmentOffsetX ?? 0) + x,
    overlayY: c.overlayY - (c.alignmentOffsetY ?? 0) + y,
  }));
}

export async function saveSaeReportAlignment(reportId: string, x: number, y: number): Promise<SaeCandidate[]> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Las coordenadas SAE deben ser números válidos.");
  const ownerId = await uid();
  // These existing numeric columns store an absolute adjustment, not repeated deltas.
  const offsetX = Math.round(x * 100) / 100;
  const offsetY = Math.round(y * 100) / 100;
  const before = await listSaeCandidates(undefined, { reportId, networkOnly: true });
  if (!before.length) throw new Error("No hay candidatos asociados al informe.");
  // One transactional PATCH changes every row in this report and preserves source_position.
  await supabase.query("sae_candidates", {
    method: "PATCH", networkOnly: true, prefer: "return=minimal",
    query: `source_report_id=eq.${encodeURIComponent(reportId)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
    body: { alignment_offset_x: offsetX, alignment_offset_y: offsetY, updated_by: ownerId },
  });
  const saved = await listSaeCandidates(undefined, { reportId, networkOnly: true });
  const ids = new Set(saved.map(row => row.id));
  if (saved.length !== before.length || before.some(row => !ids.has(row.id)) ||
      saved.some(row => row.alignmentOffsetX !== offsetX || row.alignmentOffsetY !== offsetY)) {
    throw new Error("No se pudo verificar la posición guardada del informe SAE. Vuelve a abrirlo para consultar su estado.");
  }
  return saved;
}

export async function updateSaeCandidate(
  id: string,
  patch: Partial<SaeCandidate>,
) {
  const ownerId = await uid();
  const currentRows = await supabase.query("sae_candidates", {
    query: `select=id,source_position,status,fortnight,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`,
    networkOnly: true,
  });
  const current = currentRows?.[0];
  if (!current) throw new Error('El candidato ya no existe o no tiene permiso para modificarlo.');
  const body: any = { updated_by: ownerId };
  if (patch.normalizedName !== undefined)
    body.normalized_full_name = patch.normalizedName;
  if (patch.apellidos !== undefined) body.surnames = patch.apellidos || null;
  if (patch.nombre !== undefined) body.first_name = patch.nombre || null;
  if (patch.categoria !== undefined) body.category = patch.categoria || null;
  if (patch.obra !== undefined) body.work_name = patch.obra || null;
  if (patch.codigoObra !== undefined) body.work_code = patch.codigoObra || null;
  if (patch.offerNumber !== undefined)
    body.offer_number = patch.offerNumber || null;
  if (patch.mes !== undefined) body.hiring_month = monthNumber(patch.mes);
  if (patch.quincena !== undefined)
    body.fortnight = fortnightNumber(patch.quincena);
  if (patch.estado !== undefined) {
    body.status = statusToDb[patch.estado] || patch.estado;
    body.selected_for_hire = [
      "Preseleccionado",
      "1ª Quincena",
      "2ª Quincena",
      "Contratado",
    ].includes(patch.estado);
    if (patch.estado === "Contratado") body.result_label = "contratado";
    if (patch.estado === "No contratado") body.result_label = "no_contratado";
    if (!["Contratado", "No contratado"].includes(patch.estado))
      body.result_label = null;
  }
  if (patch.resultCode !== undefined) {
    body.result_code = patch.resultCode || null;
    if (patch.resultCode && patch.resultCode !== "2001" && !body.result_label)
      body.result_label = "no_contratado";
    if (!patch.resultCode && patch.estado !== "Contratado")
      body.result_label = null;
  }
  if (patch.linkedWorkerId !== undefined) {
    body.existing_worker_owner_id = patch.linkedWorkerId ? ownerId : null;
    body.existing_worker_id = patch.linkedWorkerId || null;
  }
  if (patch.pageNumber !== undefined)
    body.source_page = Math.max(1, Number(patch.pageNumber || 1));
  if (patch.fullNameOriginal !== undefined)
    body.original_full_name = patch.fullNameOriginal;
  if (patch.confidence !== undefined)
    body.confidence = String(patch.confidence).toLowerCase();
  if (
    patch.orderNumber !== undefined ||
    patch.overlayX !== undefined ||
    patch.overlayY !== undefined
  ) {
    const pos = { ...(current.source_position || {}) };
    if (patch.orderNumber !== undefined) pos.orderNumber = patch.orderNumber;
    if (patch.overlayX !== undefined) pos.x = patch.overlayX;
    if (patch.overlayY !== undefined) pos.y = patch.overlayY;
    body.source_position = pos;
  }
  const saved = await supabase.query("sae_candidates", {
    method: "PATCH",
    prefer: "return=representation",
    query: `id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(ownerId)}&updated_at=eq.${encodeURIComponent(current.updated_at)}`,
    networkOnly: true,
    body,
  });
  if (!saved?.length) throw new Error('El candidato ha cambiado en otro dispositivo. Actualice el informe antes de continuar.');
}

export const SAE_RESULT_CODES = [
  ["2000", "Admitido"],
  ["2001", "Contratará al candidato"],
  ["2100", "Rechazo voluntario"],
  ["2101", "No se ha presentado"],
  ["2103", "Ha dejado el proceso de selección"],
  ["2107", "No aceptó las condiciones del puesto"],
  ["2200", "No cumple los requisitos"],
  ["2210", "No corresponde al perfil por otros motivos"],
  ["2212", "Otros motivos"],
  ["2500", "Ya estaba ocupado el puesto de trabajo"],
] as const;


