from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def cut_function(text, marker):
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

app_path = ROOT / 'App.tsx'
a = app_path.read_text()
# Remove old Google sign-in handlers from the application authentication flow.
for marker in [
    '  const handleGoogleLogin = async',
    '  const handleGoogleLogout = async',
    '  const handleForceSaveAllToCloud = async',
    '  const handleForceSyncNow = async',
    '  const handleSyncPendingToCloud = async',
    '  const handleUploadAllLocalToAccount = async',
    '  const handleDownloadAllFromAccount = async',
    '  const handleUpdateSyncEmail = async',
    '  const handleDisconnectSyncEmail = async',
    '  const handleAddMember = async',
    '  const handleRemoveMember = async',
    '  const handleSelectWorkspace = async',
    '  const handleJoinWorkspaceByCodeOrEmail = async',
    '  const handleDisconnectSession = async',
]:
    a = cut_function(a, marker)

# Remove the legacy sync/workspace state section.
start = a.find('  const [groupId, setGroupId]')
if start >= 0:
    end = a.find('  const [autoSaveToDrive, setAutoSaveToDrive]', start)
    if end < 0:
        raise RuntimeError('Legacy sync state block end not found')
    a = a[:start] + a[end:]

# Remove all local persistence specifically used for synchronization/workspaces.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA_(groupId|isSyncing|syncMode|sessionId|lastSyncTime|syncEmail|activeWorkspace|activeWorkspaceId)'.*?\n  \}, \[[^\]]+\]\);", '', a, flags=re.S)

# Remove stale references left by the former synchronization subscription.
a = a.replace('      setLastSyncTime(new Date());\n', '')
a = a.replace('setLastSyncTime(new Date());', '')
a = a.replace('  // Effect to generate and render the worker PDF once the data is fully populated/synced', '  // Effect to generate the worker PDF once the data is populated')

# AuthGate owns authentication; App must not start another auth listener.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    const unsubscribe = initAuth\(.*?\n  \}, \[\]\);", '', a, count=1, flags=re.S)

# Use Firebase Auth for the authoritative Firestore worker subscription.
a = a.replace('const uid = googleUser?.uid;', 'const uid = auth.currentUser?.uid;', 1)
a = re.sub(r"\n    const unsubscribeTrash = subscribeToAccountTrash\(uid, trash => \{\n      setDeletedPeople\(trash\);\n    \}\);", '', a, count=1)
a = re.sub(r"\n    return \(\) => \{ unsubscribe\(\); unsubscribeTrash\(\); \};\n  \}, \[googleUser\?\.uid\]\);", "\n    return () => unsubscribe();\n  }, []);", a, count=1)
if "import { auth } from './src/lib/firebase';" not in a:
    a = a.replace("import { compressToGzip } from './src/lib/compression';\n", "import { compressToGzip } from './src/lib/compression';\nimport { auth } from './src/lib/firebase';\n", 1)

a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)
app_path.write_text(a)

# Remove synchronization parameters from worker PDF QR codes.
export_path = ROOT / 'src/lib/exportUtils.ts'
e = export_path.read_text()
e = re.sub(r"\n\s*const groupId = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_groupId'\) \|\| '' : '';", '', e)
e = re.sub(r"\n\s*const isSyncActive = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_isSyncing'\) === 'true' : false;", '', e)
e = re.sub(r"\n\s*if \(isSyncActive && groupId\) \{\n\s*qrText \+= `&sync=\$\{encodeURIComponent\(groupId\)\}`;\n\s*\}", '', e)
export_path.write_text(e)

# Remove the explicit manual sync implementation and Google application auth from firebase.ts.
firebase_path = ROOT / 'src/lib/firebase.ts'
s = firebase_path.read_text()
s = cut_function(s, 'export async function triggerFirestoreDatabaseSync')
s = re.sub(r"\nconst provider = new GoogleAuthProvider\(\);.*?\n\nlet isSigningIn = false;\nlet cachedAccessToken: string \| null = null;", '', s, count=1, flags=re.S)
s = s.replace('  signInWithPopup,\n  GoogleAuthProvider,\n', '')
s = cut_function(s, 'export const googleSignIn = async')
s = cut_function(s, 'export const logoutGoogle = async')
firebase_path.write_text(s)
print('Final legacy sync/auth cleanup applied.')
