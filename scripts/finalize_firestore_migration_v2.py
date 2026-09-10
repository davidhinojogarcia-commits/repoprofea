from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_function(text: str, marker: str, replacement: str) -> str:
    start = text.find(marker)
    if start < 0:
        raise RuntimeError(f'Function not found: {marker}')
    brace = text.find('{', start)
    if brace < 0:
        raise RuntimeError(f'Function body not found: {marker}')
    depth = 0
    in_str = None
    esc = False
    for i in range(brace, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in ('"', "'", '`'):
            in_str = ch
            continue
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[:start] + replacement + text[i + 1:]
    raise RuntimeError(f'Unbalanced function: {marker}')


def replace_if_present(path: Path, marker: str, replacement: str):
    text = path.read_text()
    if marker in text:
        path.write_text(replace_function(text, marker, replacement))


def insert_once(path: Path, needle: str, replacement: str):
    text = path.read_text()
    if replacement in text: return
    if needle not in text: raise RuntimeError(f'Needle not found in {path}: {needle}')
    path.write_text(text.replace(needle, replacement, 1))

# User settings move from users/{uid}/settings/app_config to userSettings/{uid}.
firebase = ROOT / 'src/lib/firebase.ts'
replace_if_present(firebase, 'export async function syncAccountSettings', """export async function syncAccountSettings(userId: string, settings: UserAccountSettings): Promise<void> {
  const uid = auth.currentUser?.uid || userId;
  if (!uid) throw new Error('Debes iniciar sesión para guardar la configuración.');
  await setDoc(doc(db, 'userSettings', uid), {
    ...sanitizeForFirestore(settings),
    ownerId: uid,
    updatedBy: uid,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}""")
replace_if_present(firebase, 'export function subscribeToAccountSettings', """export function subscribeToAccountSettings(
  userId: string,
  onUpdate: (settings: UserAccountSettings) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const uid = auth.currentUser?.uid || userId;
  if (!uid) return () => {};
  return onSnapshot(doc(db, 'userSettings', uid), snap => {
    if (snap.exists()) onUpdate(snap.data() as UserAccountSettings);
  }, onError);
}""")

# Subcontractors: no localStorage database. The existing setter is wrapped so all
# existing component handlers automatically persist their resulting state.
subs = ROOT / 'components/SubcontratasSection.tsx'
insert_once(subs, "import { ChecklistConfigModal } from './ChecklistConfigModal';", """import { ChecklistConfigModal } from './ChecklistConfigModal';
import { auth } from '../src/lib/firebase';
import { createDocument, deleteDocument, updateDocument, subscribeToDocuments } from '../src/services/firestoreService';
import type { Unsubscribe } from 'firebase/firestore';""")
text = subs.read_text()
if 'setSubcontratistasState' not in text:
    text = re.sub(r"const \[subcontratistas, setSubcontratistas\] = useState<Subcontratista\[\]>\(\(\) => \{.*?\n  \}\);", """const [subcontratistas, setSubcontratistasState] = useState<Subcontratista[]>([]);
  const suppressSubPersistenceRef = useRef(false);
  const hydratedSubcontratasRef = useRef(false);

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
      hydratedSubcontratasRef.current = true;
      queueMicrotask(() => { suppressSubPersistenceRef.current = false; });
    }, { includeShared: true }, error => {
      console.error('Error leyendo subcontratas de Firestore:', error);
      onToast('No se pudieron cargar las subcontratas desde Firebase.', 'error');
    });
    return () => unsubscribe();
  }, []);""", text, count=1, flags=re.S)
    subs.write_text(text)
replace_if_present(subs, '  // Save changes to localStorage and notify app for cloud synchronization', '')
# The previous replacement removes only if a function marker, so explicitly remove the old effects.
text = subs.read_text()
text = re.sub(r"\n  // Save changes to localStorage and notify app for cloud synchronization.*?\n  // Modals & UI States", "\n  // Modals & UI States", text, count=1, flags=re.S)
text = re.sub(r"\n  // Listen for real-time cloud updates from other devices.*?\n  // Modals & UI States", "\n  // Modals & UI States", text, count=1, flags=re.S)
text = re.sub(r"\n  const activeObraWorkers = useMemo\(\(\) => \{.*?\n  \}, \[workers, activeSubcontrata\?\.obra\]\);", """\n  const activeObraWorkers = useMemo(() => {
    const allWorkers = workers || [];
    if (!activeSubcontrata?.obra) return allWorkers;
    const cleanSubObra = activeSubcontrata.obra.trim().toLowerCase();
    const matched = allWorkers.filter(w => (w.obra || '').trim().toLowerCase() === cleanSubObra);
    return matched.length > 0 ? matched : allWorkers;
  }, [workers, activeSubcontrata?.obra]);""", text, count=1, flags=re.S)
text = re.sub(r"\n  const persistObrasList = \(updatedObras: string\[\]\) => \{.*?\n  \};", """\n  const persistObrasList = (updatedObras: string[]) => {
    onUpdateSavedObras?.(updatedObras);
  };""", text, count=1, flags=re.S)
subs.write_text(text)

# Appointments: no localStorage history; Firestore is authoritative.
citas = ROOT / 'components/GestionCitas.tsx'
insert_once(citas, "import { ReconocimientosMedicosSection } from './ReconocimientosMedicosSection';", """import { ReconocimientosMedicosSection } from './ReconocimientosMedicosSection';
import { auth } from '../src/lib/firebase';
import { createDocument, subscribeToDocuments } from '../src/services/firestoreService';
import type { Unsubscribe } from 'firebase/firestore';""")
text = citas.read_text()
if 'setLatestGeneratedCitasState' not in text:
    text = re.sub(r"const \[latestGeneratedCitas, setLatestGeneratedCitas\] = useState<ScheduledCita\[\]>\(\(\) => \{.*?\n  \}\);", """const [latestGeneratedCitas, setLatestGeneratedCitasState] = useState<ScheduledCita[]>([]);
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
        const uid = auth.currentUser.uid;
        void Promise.all(next.map((item, index) => {
          const stableId = (item as ScheduledCita & { id?: string }).id || `${uid}_${item.citaDia}_${item.citaHora}_${index}`.replace(/[^a-zA-Z0-9_-]/g, '_');
          return createDocument('appointments', stableId, item as any);
        })).catch(error => {
          console.error('Error guardando citas en Firestore:', error);
          onToast('No se pudieron guardar las citas en Firebase.', 'error');
        });
      }
      return next;
    });
  }, []);
""", text, count=1, flags=re.S)
text = re.sub(r"\n  // Sync latest generated appointments to localStorage.*?\n  \}, \[latestGeneratedCitas, selectedPreviewIndex\]\);", """\n  useEffect(() => {
    if (latestGeneratedCitas.length > 0 && selectedPreviewIndex >= latestGeneratedCitas.length) setSelectedPreviewIndex(0);
  }, [latestGeneratedCitas, selectedPreviewIndex]);""", text, count=1, flags=re.S)
text = re.sub(r"\n      \} else \{\n        localStorage\.setItem\('telefonosGuardados', JSON\.stringify\(updated\)\);\n      \}", "\n      }", text, count=1)
citas.write_text(text)

# Remove manual sync UI from App/Header. Google OAuth remains available only for Drive/Calendar integrations.
header = ROOT / 'components/Header.tsx'
h = header.read_text()
h = re.sub(r"\s*onOpenFirebaseSync\?: \(\) => void;\n  isSyncingFirebase\?: boolean;\n  firebaseWorkersCount\?: number;", '', h, count=1)
h = re.sub(r"\s*onOpenFirebaseSync,\n  isSyncingFirebase = false,\n  firebaseWorkersCount = 0", '', h, count=1)
h = re.sub(r"\n\s*\{onOpenFirebaseSync && \(.*?\n\s*\)\}", '', h, count=1, flags=re.S)
header.write_text(h)

app = ROOT / 'App.tsx'
a = app.read_text()
a = re.sub(r"import \{ DatabaseSyncAlert \} from './components/DatabaseSyncAlert';\n", '', a, count=1)
a = re.sub(r"import \{ FirebaseSyncModal \} from './components/FirebaseSyncModal';\n", '', a, count=1)
a = re.sub(r"import \{ executeDatabaseSync, notifyDatabaseSync \} from './src/lib/syncNotifier';\n", '', a, count=1)
a = re.sub(r"\s*const \[isFirebaseSyncModalOpen, setIsFirebaseSyncModalOpen\] = useState\(false\);\n\s*const \[isSyncingFirebase, setIsSyncingFirebase\] = useState\(false\);\n\s*const handlePerformFirebaseSync = async \(\): Promise<number> => \{.*?\n\s*\};", '', a, count=1, flags=re.S)
a = re.sub(r"\n\s*onOpenFirebaseSync=\{\(\) => setIsFirebaseSyncModalOpen\(true\)\}\n\s*isSyncingFirebase=\{isSyncingFirebase\}\n\s*firebaseWorkersCount=\{people.length\}", '', a, count=1)
a = re.sub(r"\n\s*<FirebaseSyncModal\n\s*isOpen=\{isFirebaseSyncModalOpen\}.*?\n\s*/>", '', a, count=1, flags=re.S)
a = re.sub(r"\n\s*<DatabaseSyncAlert.*?\n\s*/>", '', a, count=1, flags=re.S)
app.write_text(a)

print('Final Firestore migration applied successfully.')
