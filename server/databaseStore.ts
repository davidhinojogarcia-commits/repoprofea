import fs from 'fs';
import path from 'path';

export interface SyncData {
  workers: any[];
  deletedPeople: any[];
  settings: {
    savedObras?: string[];
    savedLugares?: string[];
    savedSitios?: string[];
    savedTelefonos?: string[];
    savedCategorias?: string[];
    workStartHour?: string;
    workEndHour?: string;
    subcontratas?: any[];
    [key: string]: any;
  };
  lastUpdated: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'database_sync.json');
const INITIAL_WORKERS_FILE = path.join(DATA_DIR, 'initial_workers.json');
const INITIAL_SETTINGS_FILE = path.join(DATA_DIR, 'initial_settings.json');

// Canonical workspace ID helper
export function normalizeWorkspaceId(id?: string): string {
  if (!id) return 'david_hinojo_garcia_dipucadiz_es';
  const clean = id.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  // Map any David Hinojo email/alias to the same primary workspace
  if (
    clean.includes('david_hinojo_garcia') || 
    clean.includes('davidhinojogarcia') || 
    clean.includes('dipucadiz') ||
    clean === 'default'
  ) {
    return 'david_hinojo_garcia_dipucadiz_es';
  }
  return clean;
}

class DatabaseStore {
  private inMemoryDb: Record<string, SyncData> = {};
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.inMemoryDb = JSON.parse(raw);
      } else {
        this.inMemoryDb = {};
      }

      // Seed default workspace if empty or lacking workers
      const defaultId = 'david_hinojo_garcia_dipucadiz_es';
      if (!this.inMemoryDb[defaultId] || !this.inMemoryDb[defaultId].workers || this.inMemoryDb[defaultId].workers.length === 0) {
        let seededWorkers: any[] = [];
        let seededSettings: any = {};

        if (fs.existsSync(INITIAL_WORKERS_FILE)) {
          try {
            seededWorkers = JSON.parse(fs.readFileSync(INITIAL_WORKERS_FILE, 'utf-8'));
          } catch (e) {
            console.error('Error reading initial_workers.json:', e);
          }
        }

        if (fs.existsSync(INITIAL_SETTINGS_FILE)) {
          try {
            seededSettings = JSON.parse(fs.readFileSync(INITIAL_SETTINGS_FILE, 'utf-8'));
          } catch (e) {
            console.error('Error reading initial_settings.json:', e);
          }
        }

        this.inMemoryDb[defaultId] = {
          workers: seededWorkers.map(w => ({ ...w, sincronizadoEnNube: true })),
          deletedPeople: [],
          settings: seededSettings,
          lastUpdated: new Date().toISOString()
        };

        // Also alias to davidhinojogarcia_gmail_com
        this.inMemoryDb['davidhinojogarcia_gmail_com'] = this.inMemoryDb[defaultId];

        this.flushSync();
        console.log(`[DatabaseStore] Initialized with ${seededWorkers.length} workers.`);
      }
    } catch (err) {
      console.error('[DatabaseStore] Init error:', err);
    }
  }

  private scheduleFlush() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.flushSync();
    }, 500);
  }

  private flushSync() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.inMemoryDb, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DatabaseStore] Failed to write database_sync.json:', err);
    }
  }

  public getWorkspace(rawId?: string): SyncData {
    const wsId = normalizeWorkspaceId(rawId);
    
    // Check if this is the master / default workspace for admin
    const isMasterWorkspace = !rawId || 
      rawId === 'default' || 
      wsId === 'david_hinojo_garcia_dipucadiz_es' || 
      wsId === 'davidhinojogarcia_gmail_com' ||
      wsId === 'admin' ||
      wsId === 'dhg' ||
      wsId === 'user_dhg';

    if (!this.inMemoryDb[wsId]) {
      if (isMasterWorkspace && this.inMemoryDb['david_hinojo_garcia_dipucadiz_es']) {
        return this.inMemoryDb['david_hinojo_garcia_dipucadiz_es'];
      }
      // Standard users start strictly with an empty, isolated workspace
      this.inMemoryDb[wsId] = {
        workers: [],
        deletedPeople: [],
        settings: {},
        lastUpdated: new Date().toISOString()
      };
      this.scheduleFlush();
    }
    return this.inMemoryDb[wsId];
  }

  public saveWorker(rawId: string, worker: any): SyncData {
    const wsId = normalizeWorkspaceId(rawId);
    const data = this.getWorkspace(wsId);

    const workerWithCloudFlag = {
      ...worker,
      sincronizadoEnNube: true,
      _lastUpdated: new Date().toISOString()
    };

    const idx = data.workers.findIndex(w => String(w.id) === String(worker.id));
    if (idx >= 0) {
      data.workers[idx] = workerWithCloudFlag;
    } else {
      data.workers.push(workerWithCloudFlag);
    }

    data.lastUpdated = new Date().toISOString();
    this.inMemoryDb[wsId] = data;
    this.scheduleFlush();
    return data;
  }

  public saveWorkersBatch(rawId: string, newWorkers: any[]): SyncData {
    const wsId = normalizeWorkspaceId(rawId);
    const data = this.getWorkspace(wsId);

    for (const nw of newWorkers) {
      const workerWithCloud = {
        ...nw,
        sincronizadoEnNube: true,
        _lastUpdated: new Date().toISOString()
      };
      const idx = data.workers.findIndex(w => String(w.id) === String(nw.id));
      if (idx >= 0) {
        data.workers[idx] = workerWithCloud;
      } else {
        data.workers.push(workerWithCloud);
      }
    }

    data.lastUpdated = new Date().toISOString();
    this.inMemoryDb[wsId] = data;
    this.scheduleFlush();
    return data;
  }

  public deleteWorker(rawId: string, workerId: string | number, deletedRecord?: any): SyncData {
    const wsId = normalizeWorkspaceId(rawId);
    const data = this.getWorkspace(wsId);

    data.workers = data.workers.filter(w => String(w.id) !== String(workerId));
    if (deletedRecord) {
      data.deletedPeople = data.deletedPeople.filter(dp => String(dp?.person?.id) !== String(workerId));
      data.deletedPeople.push(deletedRecord);
    }

    data.lastUpdated = new Date().toISOString();
    this.inMemoryDb[wsId] = data;
    this.scheduleFlush();
    return data;
  }

  public restoreWorker(rawId: string, worker: any): SyncData {
    const wsId = normalizeWorkspaceId(rawId);
    const data = this.getWorkspace(wsId);

    data.deletedPeople = data.deletedPeople.filter(dp => String(dp?.person?.id) !== String(worker.id));
    this.saveWorker(wsId, worker);
    return data;
  }

  public saveSettings(rawId: string, settings: any): SyncData {
    const wsId = normalizeWorkspaceId(rawId);
    const data = this.getWorkspace(wsId);

    data.settings = {
      ...data.settings,
      ...settings,
      lastUpdated: new Date().toISOString()
    };

    data.lastUpdated = new Date().toISOString();
    this.inMemoryDb[wsId] = data;
    this.scheduleFlush();
    return data;
  }

  public setFullState(rawId: string, fullState: { workers?: any[]; deletedPeople?: any[]; settings?: any }): SyncData {
    const wsId = normalizeWorkspaceId(rawId);
    const data = this.getWorkspace(wsId);

    if (Array.isArray(fullState.workers)) {
      data.workers = fullState.workers.map(w => ({ ...w, sincronizadoEnNube: true }));
    }
    if (Array.isArray(fullState.deletedPeople)) {
      data.deletedPeople = fullState.deletedPeople;
    }
    if (fullState.settings && typeof fullState.settings === 'object') {
      data.settings = {
        ...data.settings,
        ...fullState.settings
      };
    }

    data.lastUpdated = new Date().toISOString();
    this.inMemoryDb[wsId] = data;
    this.scheduleFlush();
    return data;
  }

  public getAllWorkersAcrossWorkspaces(): any[] {
    const allWorkers: any[] = [];
    const seenIds = new Set<string>();

    for (const [wsId, wsData] of Object.entries(this.inMemoryDb)) {
      if (!Array.isArray(wsData?.workers)) continue;
      for (const worker of wsData.workers) {
        const uniqueKey = `${wsId}_${worker.id}`;
        if (!seenIds.has(uniqueKey)) {
          seenIds.add(uniqueKey);
          allWorkers.push({
            ...worker,
            ownerId: worker.ownerId || wsId,
            ownerDisplayName: worker.ownerDisplayName || wsId.replace(/_/g, ' ')
          });
        }
      }
    }
    return allWorkers;
  }

  public getWorkspaceWorkersCount(rawId: string): number {
    const wsId = normalizeWorkspaceId(rawId);
    return this.inMemoryDb[wsId]?.workers?.length || 0;
  }
}

export const databaseStore = new DatabaseStore();
