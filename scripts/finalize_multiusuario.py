from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app = ROOT / 'App.tsx'
a = app.read_text()

# Remove the explicit manual/batch Firestore sync API import.
a = a.replace('  triggerFirestoreDatabaseSync\n', '')
a = re.sub(r',\s*triggerFirestoreDatabaseSync\s*\n\}', '\n}', a, count=1)

# Remove the manual sync handler and the whole workspace/synchronization control
# section. Keep Google Drive integration separate.
def remove_between(start_marker, end_marker):
    global a
    start = a.find(start_marker)
    if start < 0:
        print('not found:', start_marker)
        return
    end = a.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f'End marker not found: {end_marker}')
    a = a[:start] + a[end:]

remove_between('  const handleForceSaveAllToCloud = async', '  const notificationAlertsCount =')
remove_between('  // Check URL parameters for direct workspace link or PIN code', '  // Register Service Worker on startup')
remove_between('  const handleForceSyncNow = async', '  const uploadToGoogleDrive = async')
remove_between('  const handleSyncPendingToCloud = async', '  // Effect to generate and render the worker PDF')

# Remove obsolete sync/workspace state. These are UI/cache settings, not business data.
state_patterns = [
    r"\n  const \[groupId, setGroupId\] = useState<string>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[isSyncing, setIsSyncing\] = useState<boolean>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[syncMode, setSyncMode\] = useState<'auto' \| 'manual'>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[syncEmail, setSyncEmail\] = useState<string>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[activeWorkspace, setActiveWorkspace\] = useState<Workspace \| null>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[activeWorkspaceId, setActiveWorkspaceId\] = useState<string>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[sharedWorkspaces, setSharedWorkspaces\] = useState<Workspace\[\]>\(\[\]\);",
    r"\n  const \[sessionId, setSessionId\] = useState<string>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[sessions, setSessions\] = useState<DeviceSession\[\]>\(\[\]\);",
    r"\n  const \[lastSyncTime, setLastSyncTime\] = useState<Date \| null>\(\(\) => \{.*?\n  \}\);",
    r"\n  const \[isSyncingNow, setIsSyncingNow\] = useState<boolean>\(false\);",
]
for pattern in state_patterns:
    a, n = re.subn(pattern, '\n', a, count=1, flags=re.S)
    if n != 1:
        print('state not found:', pattern[:80])

# Remove effects that persisted synchronization state to localStorage.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA_(groupId|isSyncing|syncMode|sessionId|lastSyncTime|syncEmail|activeWorkspace|activeWorkspaceId)'.*?\n  \}, \[[^\]]+\]\);", '', a, flags=re.S)

# Remove remaining session-disconnect handler.
a = re.sub(r"\n  const handleDisconnectSession = async \(\) => \{.*?\n  \};", '', a, count=1, flags=re.S)

# Firestore authoritative subscription: use the authenticated Firebase user from
# authService/AuthGate instead of the former Google user state.
a = a.replace("  useEffect(() => {\n    const uid = googleUser?.uid;\n    if (!uid) return;\n    const unsubscribe = subscribeToAccountWorkers(uid, workers => {\n      setPeople(workers.map(w => ({ ...w, sincronizadoEnNube: true })));\n      setLastSyncTime(new Date());", "  useEffect(() => {\n    const uid = auth.currentUser?.uid;\n    if (!uid) return;\n    const unsubscribe = subscribeToAccountWorkers(uid, workers => {\n      setPeople(workers.map(w => ({ ...w, sincronizadoEnNube: true })));" )
a = re.sub(r"\n    const unsubscribeTrash = subscribeToAccountTrash\(uid, trash => \{\n      setDeletedPeople\(trash\);\n    \}\);\n    return \(\) => \{ unsubscribe\(\); unsubscribeTrash\(\); \};\n  \}, \[googleUser\?\.uid\]\);", "\n    return () => unsubscribe();\n  }, []);", a, count=1)

# Add auth import for the authoritative subscription.
if "import { auth } from './src/lib/firebase';" not in a:
    anchor = "import { compressToGzip } from './src/lib/compression';\n"
    a = a.replace(anchor, anchor + "import { auth } from './src/lib/firebase';\n", 1)

# Remove the obsolete DatabaseSyncAlert render and stale sync labels from App.
a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)
a = a.replace('Conexión recuperada. Sincronización disponible.', 'Conexión recuperada.')
a = a.replace('Los cambios se aplicarán cuando se recupere la conexión.', 'Los cambios no se han podido guardar.')

app.write_text(a)

# Firebase client: email/password only; no Google provider or Google sign-in symbol.
firebase = ROOT / 'src/lib/firebase.ts'
s = firebase.read_text()
s = s.replace("  signInWithPopup,\n  GoogleAuthProvider,\n", '')
start = s.find('const provider = new GoogleAuthProvider();')
end = s.find('// Initialize Firestore', start)
if start >= 0 and end >= 0:
    s = s[:start] + s[end:]
# Remove old Google auth exports if they survived.
s = re.sub(r"\nexport const googleSignIn = async .*?\n\};\n", '\n', s, count=1, flags=re.S)
s = re.sub(r"\nexport const getAccessToken = async .*?\n\};\n", "\nexport const getAccessToken = async (): Promise<string | null> => null;\n", s, count=1, flags=re.S)
s = re.sub(r"\nexport const logoutGoogle = async \(\) => \{.*?\n\};\n", "\nexport const logoutGoogle = async () => { await auth.signOut(); };\n", s, count=1, flags=re.S)
# If auth imports are now too narrow, normalize the auth import.
s = re.sub(r"import \{\s*getAuth,.*?\n\} from 'firebase/auth';", "import { getAuth, onAuthStateChanged, User } from 'firebase/auth';", s, count=1, flags=re.S)
firebase.write_text(s)
print('Multiuser finalization applied.')
