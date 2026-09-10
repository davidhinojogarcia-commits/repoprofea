import { compressToGzip, isCompressionSupported } from './compression';
import { Person, DeletedPerson } from '../../types';
import { buildSupabaseSystemBackup } from '../services/backupExportService';

export type BackupFrequency = 'daily' | 'every_6h' | 'every_12h' | 'weekly';

export interface BackupHistoryEntry {
  id: string;
  date: string; // ISO string
  fileName: string;
  fileSize: number; // in bytes
  accountEmail: string;
  status: 'success' | 'error';
  errorMessage?: string;
  driveFileId?: string;
}

export interface DriveAutoBackupConfig {
  enabled: boolean;
  targetAccountEmail: string; // Cuenta específica de Google Drive para las copias
  frequency: BackupFrequency;
  hourOfDay: number; // 0 - 23 (ej. 20 para las 20:00)
  minuteOfHour: number; // 0 - 59 (ej. 0)
  dayOfWeek: number; // 1 = Lunes, 5 = Viernes, etc. (para copias semanales)
  folderName: string; // default "PROFEA_Cádiz/Copias_Seguridad"
  compressGzip: boolean; // default true
  showNotificationToast: boolean; // default true
  lastBackupDate: string | null;
  lastBackupFileName: string | null;
  lastBackupSize: number | null;
  lastBackupStatus: 'idle' | 'success' | 'error' | 'in_progress';
  lastBackupMessage: string | null;
  history: BackupHistoryEntry[];
}

export const STORAGE_KEY_DRIVE_BACKUP_CONFIG = 'personasPROFEA_driveAutoBackupConfig_v1';

export const DEFAULT_DRIVE_BACKUP_CONFIG: DriveAutoBackupConfig = {
  enabled: false,
  targetAccountEmail: '',
  frequency: 'daily',
  hourOfDay: 20, // 20:00
  minuteOfHour: 0,
  dayOfWeek: 5, // Viernes
  folderName: 'PROFEA_Cádiz/Copias_Seguridad',
  compressGzip: true,
  showNotificationToast: true,
  lastBackupDate: null,
  lastBackupFileName: null,
  lastBackupSize: null,
  lastBackupStatus: 'idle',
  lastBackupMessage: null,
  history: []
};

/**
 * Sanea el historial de copias de seguridad eliminando IDs duplicados y asegurando identificadores únicos
 */
export function sanitizeHistory(historyList: any[]): BackupHistoryEntry[] {
  if (!Array.isArray(historyList)) return [];
  const seen = new Set<string>();
  const sanitized: BackupHistoryEntry[] = [];
  for (let i = 0; i < historyList.length; i++) {
    const item = historyList[i];
    if (!item) continue;
    let id = String(item.id || `hist_${Date.now()}_${i}`);
    if (seen.has(id)) {
      id = `${id}_${i}_${Math.random().toString(36).slice(2, 6)}`;
    }
    seen.add(id);
    sanitized.push({ ...item, id });
  }
  return sanitized.slice(0, 15);
}

/**
 * Carga la configuración de copia de seguridad automática desde localStorage
 */
export function loadDriveBackupConfig(): DriveAutoBackupConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DRIVE_BACKUP_CONFIG);
    if (!raw) return { ...DEFAULT_DRIVE_BACKUP_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DRIVE_BACKUP_CONFIG,
      ...parsed,
      history: sanitizeHistory(parsed.history)
    };
  } catch (e) {
    console.warn('Error al cargar configuración de copias de Drive:', e);
    return { ...DEFAULT_DRIVE_BACKUP_CONFIG };
  }
}

/**
 * Guarda la configuración de copias automáticas en localStorage
 */
export function saveDriveBackupConfig(config: DriveAutoBackupConfig): void {
  try {
    const sanitized = {
      ...config,
      history: sanitizeHistory(config.history)
    };
    localStorage.setItem(STORAGE_KEY_DRIVE_BACKUP_CONFIG, JSON.stringify(sanitized));
  } catch (e) {
    console.warn('Error al guardar configuración de copias de Drive:', e);
  }
}

/**
 * Construye la copia completa leyendo directamente de Supabase.
 * Los parámetros históricos se conservan temporalmente para no romper la UI,
 * pero los datos empresariales nunca se toman del estado local.
 */
export async function buildCompleteSystemBackup(data: {
  people: Person[];
  deletedPeople: DeletedPerson[];
  savedObras: string[];
  savedLugares: string[];
  savedSitios: string[];
  savedTelefonos: string[];
  savedCategorias: string[];
  workStartHour?: string;
  workEndHour?: string;
  accountEmail?: string;
}) {
  return buildSupabaseSystemBackup(data.accountEmail || '');
}

/**
 * Busca o crea una carpeta en Google Drive por nombre y padre opcional
 */
async function getOrCreateDriveFolder(
  token: string, 
  folderName: string, 
  parentFolderId?: string
): Promise<string> {
  const parentQuery = parentFolderId 
    ? `and '${parentFolderId}' in parents` 
    : `and 'root' in parents`;
  
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false ${parentQuery}&fields=files(id,name)`;
  
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!searchRes.ok) {
    throw new Error(`Error buscando carpeta '${folderName}' en Drive (${searchRes.status})`);
  }
  
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Si no existe, crearla
  const body: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentFolderId) {
    body.parents = [parentFolderId];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!createRes.ok) {
    throw new Error(`No se pudo crear la carpeta '${folderName}' en Google Drive`);
  }

  const createData = await createRes.json();
  return createData.id;
}

/**
 * Sube un archivo a Google Drive dentro de la estructura de carpetas especificada
 */
export async function uploadBackupFileToDrive(
  token: string,
  blob: Blob,
  fileName: string,
  targetAccountEmail: string
): Promise<{ fileId: string; fileName: string; folderId: string; size: number }> {
  // 1. Obtener o crear carpeta raíz 'PROFEA_Cádiz'
  const rootFolderId = await getOrCreateDriveFolder(token, 'PROFEA_Cádiz');

  // 2. Obtener o crear subcarpeta 'Copias_Seguridad'
  const backupFolderId = await getOrCreateDriveFolder(token, 'Copias_Seguridad', rootFolderId);

  // 3. Subir archivo mediante upload multipart
  const metadata = {
    name: fileName,
    parents: [backupFolderId],
    description: `Copia de seguridad automática del Sistema de Gestión PROFEA para la cuenta ${targetAccountEmail || 'general'}. Generada el ${new Date().toLocaleString('es-ES')}`
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('file', blob);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    const errMsg = errData?.error?.message || `Error de subida HTTP ${uploadRes.status}`;
    throw new Error(`Fallo al subir a Google Drive: ${errMsg}`);
  }

  const uploadData = await uploadRes.json();
  return {
    fileId: uploadData.id,
    fileName: uploadData.name || fileName,
    folderId: backupFolderId,
    size: blob.size
  };
}

/**
 * Determina si ha llegado el momento programado para realizar una copia automática
 */
export function isBackupDue(config: DriveAutoBackupConfig): boolean {
  if (!config.enabled) return false;

  const now = new Date();
  const lastDate = config.lastBackupDate ? new Date(config.lastBackupDate) : null;

  switch (config.frequency) {
    case 'daily': {
      // Hora objetivo
      const targetHour = config.hourOfDay ?? 20;
      const targetMinute = config.minuteOfHour ?? 0;
      
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      // ¿Es la hora o posterior hoy?
      const isPastTargetTime = (currentHour > targetHour) || (currentHour === targetHour && currentMinute >= targetMinute);
      if (!isPastTargetTime) return false;

      // ¿Ya se ha ejecutado hoy?
      if (lastDate) {
        const isSameDay = 
          lastDate.getFullYear() === now.getFullYear() &&
          lastDate.getMonth() === now.getMonth() &&
          lastDate.getDate() === now.getDate();
        if (isSameDay) return false;
      }

      return true;
    }

    case 'every_6h': {
      if (!lastDate) return true;
      const diffMs = now.getTime() - lastDate.getTime();
      return diffMs >= 6 * 3600 * 1000;
    }

    case 'every_12h': {
      if (!lastDate) return true;
      const diffMs = now.getTime() - lastDate.getTime();
      return diffMs >= 12 * 3600 * 1000;
    }

    case 'weekly': {
      const targetDay = config.dayOfWeek ?? 5; // 5 = Viernes por defecto
      const targetHour = config.hourOfDay ?? 20;
      const targetMinute = config.minuteOfHour ?? 0;

      const currentDay = now.getDay();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      if (currentDay !== targetDay) return false;

      const isPastTargetTime = (currentHour > targetHour) || (currentHour === targetHour && currentMinute >= targetMinute);
      if (!isPastTargetTime) return false;

      // Si ya se ejecutó en los últimos 6 días, no repetir esta semana
      if (lastDate) {
        const diffDays = (now.getTime() - lastDate.getTime()) / (1000 * 3600 * 24);
        if (diffDays < 6) return false;
      }

      return true;
    }

    default:
      return false;
  }
}
