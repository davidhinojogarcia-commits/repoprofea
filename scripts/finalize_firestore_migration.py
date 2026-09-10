from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, pattern: str, replacement: str, flags=re.S):
    text = path.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}: {pattern[:100]}")
    path.write_text(updated)


def insert_once(path: Path, needle: str, replacement: str):
    text = path.read_text()
    if replacement in text:
        return
    if needle not in text:
        raise RuntimeError(f"Needle not found in {path}: {needle[:100]}")
    path.write_text(text.replace(needle, replacement, 1))

# ---------------------------------------------------------------------------
# Firestore settings: keep the old App API as a compatibility facade, but the
# actual source of truth is now userSettings/{uid} in Firestore.
# ---------------------------------------------------------------------------
firebase = ROOT / 'src/lib/firebase.ts'
replace_once(
    firebase,
    r"export async function syncAccountSettings\(.*?(?=export async function subscribeToAccountSettings)",
    """export async function syncAccountSettings(userId: string, settings: UserAccountSettings): Promise<void> {
  const uid = auth.currentUser?.uid || userId;
  if (!uid) throw new Error('Debes iniciar sesión para guardar la configuración.');
  await setDoc(doc(db, 'userSettings', uid), {
    ...sanitizeForFirestore(settings),
    ownerId: uid,
    updatedBy: uid,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

"""
)
replace_once(
    firebase,
    r"export function subscribeToAccountSettings\(.*?(?=export async function)",
    """export function subscribeToAccountSettings(userId: string, onUpdate: (settings: UserAccountSettings | null) => void, onError?: (err: any) => void): Unsubscribe {
  const uid = auth.currentUser?.uid || userId;
  if (!uid) return () => {};
  return onSnapshot(doc(db, 'userSettings', uid), snap => onUpdate(snap.exists() ? snap.data() as UserAccountSettings : null), onError);
}

"""
)

# ---------------------------------------------------------------------------
# Subcontractors: eliminate localStorage as DB. Existing component handlers
# already funnel mutations through setSubcontratistas, so wrap that setter and
# persist the resulting state to Firestore. Remote snapshots are marked as
# suppressed to avoid write-back loops.
# ---------------------------------------------------------------------------
subs = ROOT / 'components/SubcontratasSection.tsx'
insert_once(
    subs,
    "import { ChecklistConfigModal } from './ChecklistConfigModal';",
    """import { ChecklistConfigModal } from './ChecklistConfigModal';
import { auth } from '../src/lib/firebase';
import { createDocument, deleteDocument, updateDocument, subscribeToDocuments } from '../src/services/firestoreService';
import type { Unsubscribe } from 'firebase/firestore';"""
)
replace_once(
    subs,
    r"const \[subcontratistas, setSubcontratistas\] = useState<Subcontratista\[\]>\(\(\) => \{.*?\n  \}\);",
    """const [subcontratistas, setSubcontratistasState] = useState<Subcontratista[]>([]);
  const subcontratistasRef = useRef<Subcontratista[]>([]);
  const suppressSubPersistenceRef = useRef(false);
  const hydratedSubcontratasRef = useRef(false);

  useEffect(() => {
    subcontratistasRef.current = subcontratistas;
  }, [subcontratistas]);

  const persistSubcontratas = async (previous: Subcontratista[], next: Subcontratista[]) => {
    if (!auth.currentUser || suppressSubPersistenceRef.current || !hydratedSubcontratasRef.current) return;
    const previousById = new Map(previous.map(item => [item.id, item]));
    const nextById = new Map(next.map(item => [item.id, item]));
    try {
      for (const item of next) {
        const old = previousById.get(item.id);
        if (!old) await createDocument('subcontractors', item.id, item as any);
        else if (JSON.stringify(old) !== JSON.stringify(item)) await updateDocument('subcontractors', item.id, item as any);
      }
      for (const old of previous) {
        if (!nextById.has(old.id)) await deleteDocument('subcontractors', old.id);
      }
    } catch (error) {
      console.error('Error guardando subcontratas en Firestore:', error);
      onToast('No se pudieron guardar los cambios de subcontratas en Firebase.', 'error');
    }
  };

  const setSubcontratistas = useCallback((action: React.SetStateAction<Subcontratista[]>) => {
    setSubcontratistasState(previous => {
      const next = typeof action === 'function' ? (action as (prev: Subcontratista[]) => Subcontratista[])(previous) : action;
      void persistSubcontratas(previous, next);
      return next;
    });
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsubscribe: Unsubscribe = subscribeToDocuments<Subcontratista>('subcontractors', items => {
      suppressSubPersistenceRef.current = true;
      setSubcontratistasState(items);
      subcontratistasRef.current = items;
      hydratedSubcontratasRef.current = true;
      queueMicrotask(() => { suppressSubPersistenceRef.current = false; });
    }, { includeShared: true }, error => {
      console.error('Error leyendo subcontratas de Firestore:', error);
      onToast('No se pudieron cargar las subcontratas desde Firebase.', 'error');
    });
    return () => unsubscribe();
  }, []);
"""
)
# Remove old localStorage persistence and event synchronization blocks.
replace_once(
    subs,
    r"\n  // Save changes to localStorage and notify app for cloud synchronization.*?\n  // Modals & UI States",
    "\n  // Modals & UI States",
)
replace_once(
    subs,
    r"\n  const activeObraWorkers = useMemo\(\(\) => \{.*?\n  \}, \[workers, activeSubcontrata\?\.obra\]\);",
    """\n  const activeObraWorkers = useMemo(() => {
    const allWorkers = workers || [];
    if (!activeSubcontrata?.obra) return allWorkers;
    const cleanSubObra = activeSubcontrata.obra.trim().toLowerCase();
    const matched = allWorkers.filter(w => (w.obra || '').trim().toLowerCase() === cleanSubObra);
    return matched.length > 0 ? matched : allWorkers;
  }, [workers, activeSubcontrata?.obra]);"""
)
# Catalog persistence is handled by App's Firestore userSettings facade; do not
# write duplicate business databases here.
replace_once(
    subs,
    r"\n  const persistObrasList = \(updatedObras: string\[\]\) => \{.*?\n  \};",
    """\n  const persistObrasList = (updatedObras: string[]) => {
    onUpdateSavedObras?.(updatedObras);
  };"""
)

# ---------------------------------------------------------------------------
# Appointments: generated tickets are persisted as first-class Firestore docs.
# ---------------------------------------------------------------------------
citas = ROOT / 'components/GestionCitas.tsx'
insert_once(
    citas,
    "import { ReconocimientosMedicosSection } from './ReconocimientosMedicosSection';",
    """import { ReconocimientosMedicosSection } from './ReconocimientosMedicosSection';
import { auth } from '../src/lib/firebase';
import { createDocument, deleteDocument, updateDocument, subscribeToDocuments } from '../src/services/firestoreService';
import type { Unsubscribe } from 'firebase/firestore';"""
)
replace_once(
    citas,
    r"const \[latestGeneratedCitas, setLatestGeneratedCitas\] = useState<ScheduledCita\[\]>\(\(\) => \{.*?\n  \}\);",
    """const [latestGeneratedCitas, setLatestGeneratedCitasState] = useState<ScheduledCita[]>([]);
  const suppressCitaPersistenceRef = React.useRef(false);
  const hydratedCitasRef = React.useRef(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsubscribe: Unsubscribe = subscribeToDocuments<ScheduledCita>('appointments', items => {
      suppressCitaPersistenceRef.current = true;
      setLatestGeneratedCitasState(items);
      hydratedCitasRef.current = true;
      queueMicrotask(() => { suppressCitaPersistenceRef.current = false; });
    }, { includeShared: true }, error => {
      console.error('Error leyendo citas de Firestore:', error);
      onToast('No se pudieron cargar las citas desde Firebase.', 'error');
    });
    return () => unsubscribe();
  }, []);

  const setLatestGeneratedCitas = useCallback((action: React.SetStateAction<ScheduledCita[]>) => {
    setLatestGeneratedCitasState(previous => {
      const next = typeof action === 'function' ? (action as (prev: ScheduledCita[]) => ScheduledCita[])(previous) : action;
      if (!suppressCitaPersistenceRef.current && hydratedCitasRef.current && auth.currentUser) {
        const previousById = new Map(previous.map((item, index) => [JSON.stringify(item), `${auth.currentUser!.uid}_${index}`]));
        const nextKeys = new Set(next.map(item => JSON.stringify(item)));
        void Promise.all(next.map((item, index) => {
          const id = `${auth.currentUser!.uid}_${item.citaDia}_${item.citaHora}_${index}`.replace(/[^a-zA-Z0-9_-]/g, '_');
          return createDocument('appointments', id, item as any).catch(async error => {
            if (error) throw error;
          });
        })).catch(error => {
          console.error('Error guardando citas en Firestore:', error);
          onToast('No se pudieron guardar las citas en Firebase.', 'error');
        });
      }
      return next;
    });
  }, []);
"""
)
replace_once(
    citas,
    r"\n  // Sync latest generated appointments to localStorage.*?\n  \}, \[latestGeneratedCitas, selectedPreviewIndex\]\);",
    """\n  useEffect(() => {
    if (latestGeneratedCitas.length > 0 && selectedPreviewIndex >= latestGeneratedCitas.length) {
      setSelectedPreviewIndex(0);
    }
  }, [latestGeneratedCitas, selectedPreviewIndex]);"""
)
replace_once(
    citas,
    r"\n      \} else \{\n        localStorage\.setItem\('telefonosGuardados', JSON\.stringify\(updated\)\);\n      \}",
    "\n      }"
)

print('Firestore finalization transformations applied.')
