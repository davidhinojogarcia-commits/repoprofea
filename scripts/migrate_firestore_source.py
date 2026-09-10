from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_function(text: str, name: str, replacement: str) -> str:
    marker = f"export async function {name}"
    start = text.find(marker)
    if start < 0:
        marker = f"export function {name}"
        start = text.find(marker)
    if start < 0:
        raise RuntimeError(f"Function not found: {name}")
    brace = text.find('{', start)
    if brace < 0:
        raise RuntimeError(f"Function body not found: {name}")
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
        if ch in ('\"', "'", '`'):
            in_str = ch
            continue
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[:start] + replacement + text[i+1:]
    raise RuntimeError(f"Unbalanced braces: {name}")


firebase = ROOT / 'src/lib/firebase.ts'
s = firebase.read_text()

# Auth is now email/password. Keep the legacy Google helpers only for Drive OAuth compatibility,
# but do not create a workspace/account as a side effect of login.
start = s.find('export const initAuth = (')
if start >= 0:
    brace = s.find('{', start)
    depth = 0
    in_str = None
    esc = False
    end = None
    for i in range(brace, len(s)):
        ch = s[i]
        if in_str:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == in_str: in_str = None
            continue
        if ch in ('\"', "'", '`'): in_str = ch; continue
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end:
        # include the trailing semicolon
        if end < len(s) and s[end] == ';': end += 1
        s = s[:start] + """export const initAuth = (\n  onAuthSuccess?: (user: User, token: string | null) => void,\n  onAuthFailure?: () => void\n) => {\n  return onAuthStateChanged(auth, (user: User | null) => {\n    if (user) onAuthSuccess?.(user, null);\n    else onAuthFailure?.();\n  });\n};""" + s[end:]

# Workspace metadata is now only a compatibility view; it is never persisted.
s = replace_function(s, 'getOrCreateUserWorkspace', """export async function getOrCreateUserWorkspace(user: { uid: string; email: string; displayName?: string | null; photoURL?: string | null }): Promise<Workspace> {\n  const email = (user.email || '').trim().toLowerCase();\n  const id = canonicalizeEmailKey(email);\n  return {\n    id,\n    name: `Espacio de ${user.displayName || email.split('@')[0] || 'Usuario'}`,\n    ownerEmail: email, ownerUid: user.uid, ownerName: user.displayName || email.split('@')[0] || 'Usuario',\n    ownerPhoto: user.photoURL || '', sharedWith: [], sharedWithEmails: [email],\n    accessCode: '', createdAt: new Date().toISOString(), lastSyncAt: new Date().toISOString()\n  };\n}""")
s = replace_function(s, 'getWorkspaceByIdOrEmail', """export async function getWorkspaceByIdOrEmail(idOrEmail: string): Promise<Workspace | null> {\n  const user = auth.currentUser;\n  if (!user) return null;\n  const requested = (idOrEmail || '').trim().toLowerCase();\n  if (!requested || (requested.includes('@') && requested !== (user.email || '').toLowerCase())) return null;\n  return getOrCreateUserWorkspace(user);\n}""")
s = replace_function(s, 'fetchSharedWorkspacesForEmail', """export async function fetchSharedWorkspacesForEmail(userEmail: string): Promise<Workspace[]> {\n  const user = auth.currentUser;\n  if (!user || (user.email || '').toLowerCase() != (userEmail || '').trim().toLowerCase()) return [];\n  return [await getOrCreateUserWorkspace(user)];\n}""")
s = replace_function(s, 'findWorkspaceByAccessCode', """export async function findWorkspaceByAccessCode(_code: string): Promise<Workspace | null> { return auth.currentUser ? getOrCreateUserWorkspace(auth.currentUser) : null; }""")

# Account workers/trash are redirected to top-level collections owned by the authenticated UID.
s = replace_function(s, 'syncWorkerToAccount', """export async function syncWorkerToAccount(userId: string, person: Person): Promise<void> {\n  return createFirestoreWorker(userId, person);\n}""")
s = replace_function(s, 'deleteWorkerFromAccount', """export async function deleteWorkerFromAccount(userId: string, personId: number): Promise<void> {\n  return deleteFirestoreWorker(userId, personId);\n}""")
s = replace_function(s, 'syncDeletedWorkerToAccount', """export async function syncDeletedWorkerToAccount(userId: string, deletedPerson: DeletedPerson): Promise<void> {\n  if (!userId || !deletedPerson?.person?.id) return;\n  const worker = { ...deletedPerson.person, ownerId: auth.currentUser?.uid || userId };\n  await setDoc(doc(db, 'trash', String(deletedPerson.person.id)), sanitizeForFirestore({ person: worker, fechaEliminacion: deletedPerson.fechaEliminacion || new Date().toISOString(), ownerId: auth.currentUser?.uid || userId }));\n}""")
s = replace_function(s, 'deleteFromAccountTrash', """export async function deleteFromAccountTrash(_userId: string, personId: number): Promise<void> {\n  await deleteDoc(doc(db, 'trash', String(personId)));\n}""")
s = replace_function(s, 'fetchAccountData', """export async function fetchAccountData(userId: string): Promise<{ workers: Person[]; trash: DeletedPerson[]; settings: UserAccountSettings | null }> {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid) return { workers: [], trash: [], settings: null };\n  const workersSnap = await getDocs(collection(db, 'workers'));\n  const workers = workersSnap.docs.filter(d => d.data().ownerId === uid).map(d => d.data() as Person);\n  const trashSnap = await getDocs(collection(db, 'trash'));\n  const trash = trashSnap.docs.filter(d => d.data().ownerId === uid).map(d => d.data() as DeletedPerson);\n  return { workers, trash, settings: null };\n}""")
s = replace_function(s, 'subscribeToAccountWorkers', """export function subscribeToAccountWorkers(userId: string, onUpdate: (workers: Person[]) => void, onError?: (err: any) => void): Unsubscribe {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid) return () => {};\n  return onSnapshot(collection(db, 'workers'), snap => onUpdate(snap.docs.filter(d => d.data().ownerId === uid).map(d => ({ ...d.data(), sincronizadoEnNube: true } as Person))), onError);\n}""")
s = replace_function(s, 'subscribeToAccountTrash', """export function subscribeToAccountTrash(userId: string, onUpdate: (trash: DeletedPerson[]) => void, onError?: (err: any) => void): Unsubscribe {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid) return () => {};\n  return onSnapshot(collection(db, 'trash'), snap => onUpdate(snap.docs.filter(d => d.data().ownerId === uid).map(d => d.data() as DeletedPerson)), onError);\n}""")

# CRUD worker functions: permanent source of truth is top-level workers/trash.
s = replace_function(s, 'createFirestoreWorker', """export async function createFirestoreWorker(userId: string, worker: Person): Promise<void> {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid || !worker?.id) return;\n  const payload = sanitizeForFirestore({ ...worker, ownerId: worker.ownerId || uid, sincronizadoEnNube: true, _lastUpdated: new Date().toISOString() });\n  await setDoc(doc(db, 'workers', String(worker.id)), payload, { merge: true });\n}""")
s = replace_function(s, 'updateFirestoreWorker', """export async function updateFirestoreWorker(userId: string, worker: Person): Promise<void> { return createFirestoreWorker(userId, worker); }""")
s = replace_function(s, 'deleteFirestoreWorker', """export async function deleteFirestoreWorker(userId: string, workerId: number | string, deletedRecord?: DeletedPerson): Promise<void> {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid || !workerId) return;\n  await deleteDoc(doc(db, 'workers', String(workerId)));\n  if (deletedRecord) await setDoc(doc(db, 'trash', String(workerId)), sanitizeForFirestore({ ...deletedRecord, ownerId: uid, _lastUpdated: new Date().toISOString() }));\n}""")
s = replace_function(s, 'restoreFirestoreWorker', """export async function restoreFirestoreWorker(userId: string, worker: Person): Promise<void> {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid || !worker?.id) return;\n  await deleteDoc(doc(db, 'trash', String(worker.id)));\n  await createFirestoreWorker(uid, worker);\n}""")
s = replace_function(s, 'permanentDeleteFirestoreWorker', """export async function permanentDeleteFirestoreWorker(_userId: string, workerId: number | string): Promise<void> {\n  if (!workerId) return;\n  await deleteDoc(doc(db, 'trash', String(workerId)));\n}""")
s = replace_function(s, 'fetchFirestoreWorkers', """export async function fetchFirestoreWorkers(userId: string): Promise<Person[]> {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid) return [];\n  const snap = await getDocs(collection(db, 'workers'));\n  return snap.docs.filter(d => d.data().ownerId === uid).map(d => ({ ...d.data(), sincronizadoEnNube: true } as Person));\n}""")
s = replace_function(s, 'subscribeToFirestoreUserWorkers', """export function subscribeToFirestoreUserWorkers(userId: string, onUpdate: (workers: Person[]) => void): Unsubscribe {\n  const uid = auth.currentUser?.uid || userId;\n  if (!uid) return () => {};\n  return onSnapshot(collection(db, 'workers'), snap => onUpdate(snap.docs.filter(d => d.data().ownerId === uid).map(d => ({ ...d.data(), sincronizadoEnNube: true } as Person))), err => handleFirestoreError(err, OperationType.GET, 'workers'));\n}""")

# Workspace worker API is now a compatibility facade over the same top-level source.
s = replace_function(s, 'syncWorkerToWorkspace', """export async function syncWorkerToWorkspace(_workspaceId: string, person: Person): Promise<void> { return createFirestoreWorker(auth.currentUser?.uid || '', person); }""")
s = replace_function(s, 'deleteWorkerFromWorkspace', """export async function deleteWorkerFromWorkspace(_workspaceId: string, personId: number, deletedRecord?: DeletedPerson): Promise<void> { return deleteFirestoreWorker(auth.currentUser?.uid || '', personId, deletedRecord); }""")
s = replace_function(s, 'syncDeletedWorkerToWorkspace', """export async function syncDeletedWorkerToWorkspace(_workspaceId: string, deletedPerson: DeletedPerson): Promise<void> { return syncDeletedWorkerToAccount(auth.currentUser?.uid || '', deletedPerson); }""")
s = replace_function(s, 'deleteFromWorkspaceTrash', """export async function deleteFromWorkspaceTrash(_workspaceId: string, personId: number): Promise<void> { return deleteFromAccountTrash(auth.currentUser?.uid || '', personId); }""")
s = replace_function(s, 'fetchWorkspaceData', """export async function fetchWorkspaceData(_workspaceId: string): Promise<{ workers: Person[]; trash: DeletedPerson[]; settings: UserAccountSettings | null; workspace: Workspace | null }> {\n  const data = await fetchAccountData(auth.currentUser?.uid || '');\n  return { ...data, workspace: auth.currentUser ? await getOrCreateUserWorkspace(auth.currentUser) : null };\n}""")
s = replace_function(s, 'subscribeToWorkspaceWorkers', """export function subscribeToWorkspaceWorkers(_workspaceId: string, onUpdate: (workers: Person[]) => void, onError?: (err: any) => void): Unsubscribe { return subscribeToAccountWorkers(auth.currentUser?.uid || '', onUpdate, onError); }""")
s = replace_function(s, 'subscribeToWorkspaceTrash', """export function subscribeToWorkspaceTrash(_workspaceId: string, onUpdate: (trash: DeletedPerson[]) => void, onError?: (err: any) => void): Unsubscribe { return subscribeToAccountTrash(auth.currentUser?.uid || '', onUpdate, onError); }""")

firebase.write_text(s)

# App: remove local worker data as a source. The first render starts empty and Firestore hydrates it.
app = ROOT / 'App.tsx'
a = app.read_text()
a = re.sub(r"const \[people, setPeopleRaw\] = useState<Person\[\]>\(\(\) => \{.*?\n  \}\);", "const [people, setPeopleRaw] = useState<Person[]>([]);", a, count=1, flags=re.S)
# Disable legacy automatic/manual synchronization effect while retaining the rest of the UI temporarily.
marker = "  // Register device session and subscribe to active sessions across devices"
start = a.find(marker)
if start >= 0:
    end = a.find("  const handleDisconnectSession = async () => {", start)
    if end > start:
        replacement = """  // Firestore is the permanent source of truth.\n  useEffect(() => {\n    const uid = googleUser?.uid;\n    if (!uid) return;\n    const unsubscribe = subscribeToAccountWorkers(uid, workers => {\n      setPeople(workers.map(w => ({ ...w, sincronizadoEnNube: true })));\n      setLastSyncTime(new Date());\n    }, error => {\n      console.error('Error leyendo trabajadores de Firestore:', error);\n      setToast({ message: 'Error al leer los trabajadores desde Firebase.', type: 'error' });\n    });\n    const unsubscribeTrash = subscribeToAccountTrash(uid, trash => {\n      setDeletedPeople(trash);\n    });\n    return () => { unsubscribe(); unsubscribeTrash(); };\n  }, [googleUser?.uid]);\n\n"""
        a = a[:start] + replacement + a[end:]
# Prevent the old offline state from implying local persistence as the database.
a = a.replace("setToast({ message: 'Sin conexión a internet. Los cambios se guardarán localmente.', type: 'error' });", "setToast({ message: 'Sin conexión a internet. Los cambios se aplicarán cuando se recupere la conexión.', type: 'error' });")
app.write_text(a)
EOF