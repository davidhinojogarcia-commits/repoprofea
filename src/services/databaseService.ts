import { getSessionUser, supabase } from "../lib/supabase";
import { syncMedicalAppointmentFromWorker } from "./medicalAppointmentAutoSync";

export type DatabaseRecord = Record<string, any> & {
  id?: string | number;
  ownerId?: string;
};
type ListOptions = {
  includeShared?: boolean;
  allForAdmin?: boolean;
  limitCount?: number;
  fresh?: boolean;
};

const TABLE_BY_COLLECTION: Record<string, string> = {
  appointments: "citas",
  citas: "citas",
  subcontractors: "subcontratas",
  subcontratas: "subcontratas",
  medicalExams: "reconocimientos",
  reconocimientos: "reconocimientos",
  contracts: "contrataciones",
  contratacion: "contrataciones",
  contrataciones: "contrataciones",
  works: "obras",
  obras: "obras",
  workers: "trabajadores",
  trabajadores: "trabajadores",
};

const canonicalTable = (name: string) => TABLE_BY_COLLECTION[name] || name;
const WORKER_DIRECTORY_SELECT = [
  'id',
  'owner_id',
  'obra_id',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'data',
].join(',');

const selectForTable = (table: string) =>
  table === 'trabajadores' ? WORKER_DIRECTORY_SELECT : '*';

const clean = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value, (_k, v) => (v === undefined ? null : v)));
const dateOrNull = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null;
const timeOrNull = (value: unknown) =>
  typeof value === "string" && /^\d{2}:\d{2}/.test(value)
    ? value.slice(0, 8)
    : null;
const isLegacyNumericTable = (table: string) => table === "trash";
const normalizeDni = (value: unknown) =>
  String(value || "")
    .replace(/[\s-]/g, "")
    .trim()
    .toUpperCase();

const resolveContractYear = (value: DatabaseRecord) => {
  const start = String(
    value.periodoInicio || value.periodo_inicio || "",
  ).trim();
  const startYear = start.match(/^(\d{4})-/)?.[1];
  if (startYear) return Number(startYear);
  const fortnight = String(value.quincena || "").trim();
  const fortnightYear = fortnight.match(/(?:^|\s)(20\d{2})(?:$|\s)/)?.[1];
  if (fortnightYear) return Number(fortnightYear);
  const registered = String(
    value.fechaRegistro || value.fecha_registro || "",
  ).trim();
  const registeredYear = registered.match(/^(\d{4})-/)?.[1];
  return registeredYear ? Number(registeredYear) : new Date().getFullYear();
};

async function requireUser() {
  const user = await getSessionUser();
  if (!user)
    throw new Error("Debes iniciar sesión para realizar esta operación.");
  return user;
}

async function resolveObraId(obra: unknown): Promise<string | null> {
  if (!obra || typeof obra !== "string") return null;
  const name = obra.trim();
  const rows = await supabase.query("obras", {
    query: `select=id&nombre=eq.${encodeURIComponent(name)}&limit=1`,
  });
  return rows?.[0]?.id || null;
}

async function enrichWorkerAnnualHiring(
  data: DatabaseRecord,
  ownerId: string,
): Promise<DatabaseRecord> {
  const dni = normalizeDni(data.dni);
  const annuality = resolveContractYear(data);
  if (!dni) {
    return {
      ...data,
      anualidadContratacion: annuality,
      numeroContratacionAnual: 1,
      contratacionesEnAnualidad: 1,
      esRepetidorAnual: false,
    };
  }

  const rows = await supabase.query("trabajadores", {
    query: `select=id,dni,periodo_inicio,quincena,fecha_registro,data&owner_id=eq.${encodeURIComponent(ownerId)}`,
  });
  const sameWorkerSameYear = (rows || []).filter((row: any) => {
    if (normalizeDni(row.dni || row.data?.dni) !== dni) return false;
    const hydrated = {
      ...(row.data || {}),
      periodoInicio: row.periodo_inicio || row.data?.periodoInicio,
      quincena: row.quincena || row.data?.quincena,
      fechaRegistro: row.fecha_registro || row.data?.fechaRegistro,
    };
    return resolveContractYear(hydrated) === annuality;
  });
  const hireNumber = sameWorkerSameYear.length + 1;
  return {
    ...data,
    anualidadContratacion: annuality,
    numeroContratacionAnual: hireNumber,
    contratacionesEnAnualidad: hireNumber,
    esRepetidorAnual: hireNumber > 1,
  };
}

async function serialize(table: string, value: DatabaseRecord) {
  const data = clean(value);
  if (isLegacyNumericTable(table)) return { data };
  if (table === "trabajadores")
    return {
      obra_id:
        value.obraId || value.obra_id || (await resolveObraId(value.obra)),
      supervisor_responsable: value.supervisorResponsable || "",
      num_oferta: value.numOferta || "",
      obra: value.obra || "",
      categoria: value.categoria || "",
      quincena: value.quincena || "",
      apellidos_nombre: value.apellidosNombre || "",
      dni: value.dni || "",
      fecha_nacimiento: value.fechaNacimiento || "",
      periodo_inicio: value.periodoInicio || "",
      periodo_fin: value.periodoFin || "",
      telefono: value.telefono || "",
      numero_seguridad_social: value.numeroSeguridadSocial || null,
      iban: value.iban || null,
      calzado: value.calzado || "",
      formacion: value.formacion || "",
      lugar_formacion: value.lugarFormacion || null,
      cita_dia: value.citaDia || "",
      cita_hora: value.citaHora || "",
      sitio_reconocimiento: value.sitioReconocimiento || "",
      documentacion_completa: value.documentacionCompleta || "",
      observaciones: value.observaciones || null,
      fecha_registro: value.fechaRegistro || "",
      necesita_reconocimiento: value.necesitaReconocimiento || null,
      aptitud_medica: value.aptitudMedica || null,
      limitaciones_aptitud: value.limitacionesAptitud || null,
      reconocimiento_estado: value.reconocimientoEstado || null,
      reconocimiento_fecha: value.reconocimientoFecha || null,
      reconocimiento_validez: value.reconocimientoValidez || null,
      reconocimiento_limitaciones: value.reconocimientoLimitaciones || null,
      reconocimiento_observaciones: value.reconocimientoObservaciones || null,
      data,
    };
  if (table === "obras")
    return {
      codigo: value.codigo || value.code || "",
      nombre: value.nombre || value.name || value.obra || "",
      municipio: value.municipio || "",
      descripcion: value.descripcion || value.description || "",
      empresa: value.empresa || "",
      cif: value.cif || "",
      recurso_preventivo:
        value.recursoPreventivo || value.recurso_preventivo || "",
      recurso_preventivo_categoria:
        value.recursoPreventivoCategoria ||
        value.recurso_preventivo_categoria ||
        "",
    };
  const obraId =
    value.obraId || value.obra_id || (await resolveObraId(value.obra));
  if (table === "citas")
    return {
      obra_id: obraId,
      trabajador_id: value.trabajadorId ?? value.trabajador_id ?? null,
      cita_dia: dateOrNull(value.citaDia),
      cita_hora: timeOrNull(value.citaHora),
      sitio_reconocimiento: value.sitioReconocimiento || "",
      num_oferta: value.numOferta || "",
      quincena: value.quincena || "",
      supervisor_responsable: value.supervisorResponsable || "",
      telefono_supervisor: value.telefonoSupervisor || "",
      dia_comienzo: dateOrNull(value.diaComienzo),
      dia_fin_contrato: dateOrNull(value.diaFinContrato),
      dia_contratacion: dateOrNull(value.diaContratacion),
      data,
    };
  if (table === "subcontratas")
    return {
      obra_id: obraId,
      nombre_empresa: value.nombreEmpresa || "",
      cif: value.cif || "",
      municipio: value.municipio || "",
      persona_contacto: value.personaContacto || "",
      telefono: value.telefono || "",
      email: value.email || "",
      actividad_gremio: value.actividadGremio || "",
      fecha_inicio_prevista: dateOrNull(value.fechaInicioPrevista),
      supervisor_responsable: value.supervisorResponsable || "",
      recurso_preventivo: value.recursoPreventivo || "",
      numero_trabajadores_previstos: Number.isFinite(
        Number(value.numeroTrabajadoresPrevistos),
      )
        ? Number(value.numeroTrabajadoresPrevistos)
        : null,
      estado_expediente: value.estadoExpediente || "pendiente",
      notas: value.notas || "",
      data,
    };
  if (table === "reconocimientos")
    return {
      obra_id: obraId,
      trabajador_id:
        value.matchedPersonId ??
        value.trabajadorId ??
        value.trabajador_id ??
        null,
      dni: value.dni || "",
      apellidos_nombre: value.apellidosNombre || "",
      resultado: value.resultado || value.reconocimientoEstado || "Pendiente",
      limitaciones:
        value.limitaciones || value.reconocimientoLimitaciones || "",
      fecha_reconocimiento: dateOrNull(
        value.fechaReconocimiento || value.reconocimientoFecha,
      ),
      validez: dateOrNull(value.validez || value.reconocimientoValidez) || "",
      centro_medico: value.centroMedico || value.sitioReconocimiento || "",
      observaciones:
        value.observaciones || value.reconocimientoObservaciones || "",
      data,
    };
  if (table === "contrataciones")
    return {
      obra_id: obraId,
      trabajador_id:
        value.trabajadorId ?? value.trabajador_id ?? value.idTrabajador ?? null,
      num_oferta: value.numOferta || "",
      categoria: value.categoria || "",
      periodo_inicio: dateOrNull(value.periodoInicio),
      periodo_fin: dateOrNull(value.periodoFin),
      quincena: value.quincena || "",
      estado: value.estado || "",
      observaciones: value.observaciones || "",
      data,
    };
  return { data };
}

async function syncSubcontrataChecklist(
  subcontrataId: string,
  value: DatabaseRecord,
) {
  const checklist = Array.isArray(value.checklist) ? value.checklist : [];
  const existing = await supabase.query("subcontrata_documentos", {
    query: `select=id&subcontrata_id=eq.${encodeURIComponent(subcontrataId)}`,
  });
  const nextIds = new Set<string>();

  const upsertRows = checklist.map((rawItem, index) => {
    const item = rawItem || {};
    const sourceId = String(item.id || `item_${index + 1}`);
    const itemId = `${subcontrataId}:${sourceId}`;
    nextIds.add(itemId);
    return {
      id: itemId,
      subcontrata_id: subcontrataId,
      categoria: item.categoria || "empresa",
      nombre: item.nombre || "",
      descripcion: item.descripcion || "",
      normativa: item.normativa || "",
      obligatorio: item.obligatorio !== false,
      estado: item.estado || "pendiente",
      fecha_entrega: dateOrNull(item.fechaEntrega),
      fecha_caducidad: dateOrNull(item.fechaCaducidad),
      observaciones: item.observaciones || "",
      documento_nombre: item.documentoNombre || "",
      data: clean(item),
    };
  });

  if (upsertRows.length) {
    await supabase.query("subcontrata_documentos", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: upsertRows,
    });
  }

  const deletedIds = (existing || [])
    .map((row: any) => String(row.id))
    .filter((id: string) => !nextIds.has(id));

  if (deletedIds.length) {
    const values = deletedIds.map((id: string) => JSON.stringify(id)).join(",");
    await supabase.query("subcontrata_documentos", {
      method: "DELETE",
      prefer: "return=minimal",
      query: `id=in.${encodeURIComponent(`(${values})`)}&subcontrata_id=eq.${encodeURIComponent(subcontrataId)}`,
    });
  }
}

function hydrate(row: any, table: string): any {
  if (table === "obras")
    return {
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      municipio: row.municipio,
      descripcion: row.descripcion,
      empresa: row.empresa,
      cif: row.cif,
      recursoPreventivo: row.recurso_preventivo,
      recursoPreventivoCategoria: row.recurso_preventivo_categoria,
      ownerId: row.owner_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  return {
    ...(row.data || {}),
    id: row.id,
    ownerId: row.owner_id,
    obraId: row.obra_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export async function createDocument<T extends DatabaseRecord>(
  collectionName: string,
  id: string | number,
  data: T,
) {
  const user = await requireUser();
  const table = canonicalTable(collectionName);
  const effectiveData =
    table === "trabajadores"
      ? await enrichWorkerAnnualHiring(data, user.id)
      : data;
  const serialized = await serialize(table, effectiveData);
  const body =
    table === "trabajadores"
      ? {
          owner_id: user.id,
          id: Number(id),
          ...serialized,
          created_by: user.id,
          updated_by: user.id,
        }
      : table === "obras"
        ? {
            owner_id: user.id,
            id: String(id),
            ...serialized,
            created_by: user.id,
            updated_by: user.id,
          }
      : isLegacyNumericTable(table)
        ? {
            owner_id: user.id,
            id: Number(id),
            ...serialized,
            created_by: user.id,
            updated_by: user.id,
          }
        : { id: String(id), ...serialized };
  await supabase.query(table, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body,
  });
  if (table === "trabajadores") {
    void syncMedicalAppointmentFromWorker(effectiveData, id, user.id).catch(
      (error) => {
        console.error("Error sincronizando cita médica automática:", error);
      },
    );
  }
  if (table === "subcontratas")
    await syncSubcontrataChecklist(String(id), effectiveData);
}

export async function updateDocument<T extends DatabaseRecord>(
  collectionName: string,
  id: string | number,
  patch: Partial<T>,
  options: { current?: T } = {},
): Promise<T> {
  const user = await requireUser();
  const table = canonicalTable(collectionName);
  const current = options.current ?? await getDocument<T>(collectionName, id);
  if (!current)
    throw new Error("El registro ya no existe o no tienes permiso para verlo.");
  const merged = { ...current, ...patch, id } as DatabaseRecord;
  const body: any = await serialize(table, merged);
  if (isLegacyNumericTable(table) || table === "trabajadores" || table === "obras")
    body.updated_by = user.id;

  const requireVerifiedWorkerUpdate = table === "trabajadores";
  const mutationResult = await supabase.query(table, {
    method: "PATCH",
    prefer: requireVerifiedWorkerUpdate ? "return=representation" : "return=minimal",
    query: `id=eq.${encodeURIComponent(String(id))}`,
    body,
  });

  let persisted = merged as T;
  if (requireVerifiedWorkerUpdate) {
    if (!Array.isArray(mutationResult) || mutationResult.length === 0) {
      throw new Error(
        "Supabase no confirmó la modificación. Comprueba que tienes permiso de edición sobre este trabajador.",
      );
    }

    const returnedRow = mutationResult[0];
    if (returnedRow?.__offlinePending) {
      persisted = { ...(merged as T), __offlinePending: true } as T;
    } else {
      persisted = hydrate(returnedRow, table) as T;
    }
  }

  if (table === "trabajadores") {
    void syncMedicalAppointmentFromWorker(merged, id, user.id).catch(
      (error) => {
        console.error("Error actualizando cita médica automática:", error);
      },
    );
  }
  if (table === "subcontratas")
    await syncSubcontrataChecklist(String(id), merged);

  return persisted;
}

export async function deleteDocument(
  collectionName: string,
  id: string | number,
) {
  await requireUser();
  await supabase.query(canonicalTable(collectionName), {
    method: "DELETE",
    prefer: "return=minimal",
    query: `id=eq.${encodeURIComponent(String(id))}`,
  });
}

export async function getDocument<T = DatabaseRecord>(
  collectionName: string,
  id: string | number,
): Promise<T | null> {
  await requireUser();
  const table = canonicalTable(collectionName);
  const rows = await supabase.query(table, {
    query: `select=*&id=eq.${encodeURIComponent(String(id))}&limit=1`,
  });
  return rows?.[0] ? (hydrate(rows[0], table) as T) : null;
}

export async function getDocuments<T = DatabaseRecord>(
  collectionName: string,
  options: ListOptions = {},
): Promise<T[]> {
  await requireUser();
  const table = canonicalTable(collectionName);
  const limit = options.limitCount ? `&limit=${options.limitCount}` : "";
  const rows = await supabase.query(table, {
    query: `select=${selectForTable(table)}&order=updated_at.desc${limit}`,
    fresh: options.fresh === true,
  });
  return (rows || []).map((row: any) => hydrate(row, table) as T);
}

export function subscribeToDocuments<T = DatabaseRecord>(
  collectionName: string,
  onUpdate: (items: T[]) => void,
  options: ListOptions = {},
  onError?: (error: Error) => void,
) {
  let active = true;
  let refreshTimer: number | null = null;
  let retryTimer: number | null = null;
  let consecutiveReadFailures = 0;
  let readInFlight = false;
  let refreshPending = false;
  const table = canonicalTable(collectionName);

  const run = async (fresh = false) => {
    if (!active || document.visibilityState === 'hidden') return;
    if (readInFlight) { refreshPending = true; return; }
    readInFlight = true;
    try {
      if (!active) return;
      const items = await getDocuments<T>(collectionName, { ...options, fresh });
      consecutiveReadFailures = 0;
      if (active) onUpdate(items);
    } catch (error) {
      if (!active) return;
      if ([401, 402, 403, 429].includes(Number((error as any)?.status))) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      consecutiveReadFailures += 1;
      if (consecutiveReadFailures < 3) {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(
          () => {
            retryTimer = null;
            void run(true);
          },
          consecutiveReadFailures === 1 ? 500 : 1500,
        );
        return;
      }
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      readInFlight = false;
      if (refreshPending && active) { refreshPending = false; scheduleRefresh(); }
    }
  };

  const scheduleRefresh = () => {
    if (!active || document.visibilityState === 'hidden' || refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void run(true);
    }, table === "trabajadores" ? 1_000 : 600);
  };

  const handleResume = () => {
    if (!active) return;
    if (document.visibilityState === "hidden") return;
    consecutiveReadFailures = 0;
    scheduleRefresh();
  };

  void run();
  const channel = supabase
    .channel(`profea:${table}:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      scheduleRefresh,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        consecutiveReadFailures = 0;
      }
    });

  window.addEventListener("online", handleResume);
  document.addEventListener("visibilitychange", handleResume);

  return () => {
    active = false;
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    window.removeEventListener("online", handleResume);
    document.removeEventListener("visibilitychange", handleResume);
    void supabase.removeChannel(channel);
  };
}

export const getSharedDocuments = getDocuments;
