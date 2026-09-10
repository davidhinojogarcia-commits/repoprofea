import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { databaseStore } from './databaseStore';

let firestoreDb: any = null;

export function getFirestoreServerDb() {
  if (firestoreDb) return firestoreDb;
  try {
    const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const app = initializeApp(cfg, 'server-firestore-sync');
      firestoreDb = getFirestore(app, cfg.firestoreDatabaseId);
      return firestoreDb;
    }
  } catch (err) {
    console.error('[FirestoreSync] Failed to initialize Firestore SDK:', err);
  }
  return null;
}

export async function syncFromFirestoreDatabase(targetWorkspaceId?: string) {
  const db = getFirestoreServerDb();
  if (!db) {
    throw new Error('No se pudo conectar a la base de datos de Firebase Firestore.');
  }

  const allWorkersMap = new Map<string, any>();
  const allTrashMap = new Map<string, any>();
  let mergedSettings: any = {};

  // 1. Scan all known sync_groups in Firestore
  const knownGroups = [
    'DAVIDHINOJOGARCIA@DIPUCADIZ.ES',
    'PROFEA-SYNC-879813',
    'PROFEA-SYNC-736765',
    'PROFEA-SYNC-104226',
    'PROFEA-SYNC-858818',
    'DAVIDHINOJOGARCIA@GMAIL.COM'
  ];

  for (const groupId of knownGroups) {
    try {
      const wSnap = await getDocs(collection(db, 'sync_groups', groupId, 'workers'));
      wSnap.forEach(d => {
        const w = d.data();
        const key = String(w.dni || w.id || d.id);
        if (!allWorkersMap.has(key)) {
          allWorkersMap.set(key, { ...w, sincronizadoEnNube: true });
        }
      });

      const tSnap = await getDocs(collection(db, 'sync_groups', groupId, 'trash'));
      tSnap.forEach(d => {
        const t = d.data();
        const key = String(t.person?.dni || t.person?.id || d.id);
        if (!allTrashMap.has(key)) {
          allTrashMap.set(key, t);
        }
      });
    } catch (e: any) {
      // transient or permission warning
    }
  }

  // 2. Scan all known workspaces in Firestore
  const knownWorkspaces = [
    'david_hinojo_garcia_dipucadiz_es',
    'davidhinojogarcia_gmail_com'
  ];
  if (targetWorkspaceId && !knownWorkspaces.includes(targetWorkspaceId)) {
    knownWorkspaces.push(targetWorkspaceId);
  }

  for (const wsId of knownWorkspaces) {
    try {
      const wSnap = await getDocs(collection(db, 'workspaces', wsId, 'workers'));
      wSnap.forEach(d => {
        const w = d.data();
        const key = String(w.dni || w.id || d.id);
        if (!allWorkersMap.has(key)) {
          allWorkersMap.set(key, { ...w, sincronizadoEnNube: true });
        }
      });

      const tSnap = await getDocs(collection(db, 'workspaces', wsId, 'trash'));
      tSnap.forEach(d => {
        const t = d.data();
        const key = String(t.person?.dni || t.person?.id || d.id);
        if (!allTrashMap.has(key)) {
          allTrashMap.set(key, t);
        }
      });

      const sDoc = await getDoc(doc(db, 'workspaces', wsId, 'settings', 'app_config'));
      if (sDoc.exists()) {
        mergedSettings = { ...mergedSettings, ...sDoc.data() };
      }
    } catch (e: any) {
      // transient warning
    }
  }

  const workers = Array.from(allWorkersMap.values());
  const trash = Array.from(allTrashMap.values());

  // Save to databaseStore
  const wsToUpdate = targetWorkspaceId || 'david_hinojo_garcia_dipucadiz_es';
  databaseStore.saveWorkersBatch(wsToUpdate, workers);
  if (Object.keys(mergedSettings).length > 0) {
    databaseStore.saveSettings(wsToUpdate, mergedSettings);
  }

  // Also mirror to davidhinojogarcia_gmail_com
  databaseStore.saveWorkersBatch('davidhinojogarcia_gmail_com', workers);

  console.log(`[FirestoreSync] Synced ${workers.length} workers and ${trash.length} trash records from Firestore database.`);
  return {
    success: true,
    workersCount: workers.length,
    trashCount: trash.length,
    workers,
    trash,
    settings: mergedSettings
  };
}
