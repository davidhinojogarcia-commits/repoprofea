from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app = ROOT / 'App.tsx'
a = app.read_text()

# Remove explicit manual sync API import.
a = re.sub(r"\n\s*triggerFirestoreDatabaseSync,?", '', a, count=1)

# Remove all old sync/workspace handler sections by stable markers.
def remove_between(start_marker, end_marker):
    global a
    start = a.find(start_marker)
    if start < 0:
        return
    end = a.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f'End marker not found: {end_marker}')
    a = a[:start] + a[end:]

remove_between('  const handleForceSaveAllToCloud = async', '  const notificationAlertsCount =')
remove_between('  // Check URL parameters for direct workspace link or PIN code', '  // Register Service Worker on startup')
remove_between('  const handleForceSyncNow = async', '  const uploadToGoogleDrive = async')
remove_between('  const handleSyncPendingToCloud = async', '  // Effect to generate and render the worker PDF')

# Remove the entire legacy sync/workspace state block in one deterministic operation.
start = a.find('  const [groupId, setGroupId]')
if start >= 0:
    end = a.find('  const [googleUser, setGoogleUser]', start)
    if end < 0:
        raise RuntimeError('Could not locate end of legacy sync state block')
    a = a[:start] + a[end:]

# Remove persistence effects for deleted sync state and obsolete session handler.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA_(groupId|isSyncing|syncMode|sessionId|lastSyncTime|syncEmail|activeWorkspace|activeWorkspaceId)'.*?\n  \}, \[[^\]]+\]\);", '', a, flags=re.S)
a = re.sub(r"\n  const handleDisconnectSession = async \(\) => \{.*?\n  \};", '', a, count=1, flags=re.S)
for pattern in [
    r"\n  const handleAddMember = async .*?\n  \};",
    r"\n  const handleUpdateMemberRole = async .*?\n  \};",
    r"\n  const handleRemoveMember = async .*?\n  \};",
    r"\n  const handleSelectWorkspace = async .*?\n  \};",
    r"\n  const handleJoinWorkspaceByCodeOrEmail = async .*?\n  \};",
    r"\n  const handleUpdateSyncEmail = async .*?\n  \};",
    r"\n  const handleDisconnectSyncEmail = async .*?\n  \};",
]:
    a = re.sub(pattern, '', a, count=1, flags=re.S)

# Remove the old App-owned Firebase auth listener. AuthGate owns the session.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    const unsubscribe = initAuth\(.*?\n  \}, \[\]\);", '', a, count=1, flags=re.S)

# The authoritative worker subscription uses Firebase Auth directly.
a = a.replace('const uid = googleUser?.uid;', 'const uid = auth.currentUser?.uid;', 1)
a = re.sub(r"\n    const unsubscribeTrash = subscribeToAccountTrash\(uid, trash => \{\n      setDeletedPeople\(trash\);\n    \}\);", '', a, count=1)
a = re.sub(r"\n    return \(\) => \{ unsubscribe\(\); unsubscribeTrash\(\); \};\n  \}, \[googleUser\?\.uid\]\);", "\n    return () => unsubscribe();\n  }, []);", a, count=1)
if "import { auth } from './src/lib/firebase';" not in a:
    a = a.replace("import { compressToGzip } from './src/lib/compression';\n", "import { compressToGzip } from './src/lib/compression';\nimport { auth } from './src/lib/firebase';\n", 1)

# Remove sync-specific render and wording.
a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)
a = a.replace('Conexión recuperada. Sincronización disponible.', 'Conexión recuperada.')
a = a.replace('Sincronización activa', 'Conectado')

# Remove obsolete QR sync query generation; keep direct worker PDF links.
export_utils = ROOT / 'src/lib/exportUtils.ts'
e = export_utils.read_text()
e = re.sub(r"\n\s*const groupId = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_groupId'\) \|\| '' : '';", '', e)
e = re.sub(r"\n\s*const isSyncActive = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_isSyncing'\) === 'true' : false;", '', e)
e = re.sub(r"\n\s*if \(isSyncActive && groupId\) \{\n\s*qrText \+= `&sync=\$\{encodeURIComponent\(groupId\)\}`;\n\s*\}", '', e)
export_utils.write_text(e)

app.write_text(a)

# Remove the obsolete manual sync implementation from firebase.ts.
firebase = ROOT / 'src/lib/firebase.ts'
s = firebase.read_text()
def remove_function(text, marker):
    start = text.find(marker)
    if start < 0:
        return text
    brace = text.find('{', start)
    if brace < 0:
        raise RuntimeError(f'Function body not found: {marker}')
    depth = 0; quote = None; esc = False
    for i in range(brace, len(text)):
        ch = text[i]
        if quote:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == quote: quote = None
            continue
        if ch in "'\"`": quote = ch
        elif ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                j = i + 1
                if j < len(text) and text[j] == ';': j += 1
                return text[:start] + text[j:]
    raise RuntimeError(f'Unbalanced function: {marker}')
s = remove_function(s, 'export async function triggerFirestoreDatabaseSync')
# Email/password authentication only. Remove the Google provider implementation,
# while leaving unrelated Google Drive code untouched elsewhere in the application.
s = re.sub(r"\nconst provider = new GoogleAuthProvider\(\);.*?\n\nlet isSigningIn = false;\nlet cachedAccessToken: string \| null = null;", '', s, count=1, flags=re.S)
s = s.replace('  signInWithPopup,\n  GoogleAuthProvider,\n', '')
s = re.sub(r"\nexport const googleSignIn = async .*?\n\};", '', s, count=1, flags=re.S)
firebase.write_text(s)
print('Multiuser finalization applied.')
