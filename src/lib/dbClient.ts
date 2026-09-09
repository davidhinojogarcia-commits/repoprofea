import { Person, Subcontratista, ReporteTecnicoConfig, ObraRecursoPreventivo } from '../../types';

export interface DbHealthResponse {
  status: 'ok' | 'error';
  database?: string;
  counts?: {
    obras: number;
    workers: number;
    subcontratistas: number;
  };
  message?: string;
}

export interface DbSyncPayload {
  obras?: Array<{
    nombre: string;
    recursoPreventivoNombre?: string;
    recursoPreventivoCategoria?: string;
  }>;
  workers?: Person[];
  subcontratistas?: Subcontratista[];
  configs?: {
    pdf_config?: any;
    reporte_tecnico_config?: ReporteTecnicoConfig;
    obras_recursos_preventivos?: Record<string, any>;
    [key: string]: any;
  };
}

export interface DbSnapshotResponse {
  success: boolean;
  data: {
    obras: Array<{
      id: number;
      nombre: string;
      recursoPreventivoNombre: string | null;
      recursoPreventivoCategoria: string | null;
    }>;
    workers: Person[];
    subcontratistas: Subcontratista[];
    configs: {
      pdf_config: any;
      reporte_tecnico_config: ReporteTecnicoConfig | null;
      obras_recursos_preventivos: Record<string, any> | null;
    };
  };
}

// Check Cloud SQL database status
export async function checkDbHealth(): Promise<DbHealthResponse> {
  try {
    const res = await fetch('/api/db/health');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err: any) {
    return {
      status: 'error',
      message: err.message || 'No se pudo conectar a la base de datos.',
    };
  }
}

// Push local state snapshot to Cloud SQL PostgreSQL
export async function syncAllToDatabase(payload: DbSyncPayload): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/db/sync/all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Error al sincronizar con la base de datos (HTTP ${res.status})`);
  }

  return await res.json();
}

// Fetch complete dataset snapshot from Cloud SQL PostgreSQL
export async function fetchSnapshotFromDatabase(): Promise<DbSnapshotResponse> {
  const res = await fetch('/api/db/sync/all');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Error al obtener datos de la base de datos (HTTP ${res.status})`);
  }
  return await res.json();
}
