from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app = ROOT / 'App.tsx'
a = app.read_text()

def remove_between(text, start_marker, end_marker):
    start = text.find(start_marker)
    if start < 0:
        return text
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f'End marker not found: {end_marker}')
    return text[:start] + text[end:]

# Remove Google application sign-in and workspace/sync controls. Authentication is owned by AuthGate.
a = remove_between(a, '  const handleGoogleLogin = async', '  const uploadToGoogleDrive = async')
a = re.sub(r"\n  const \[googleUser, setGoogleUser\] = useState<any>\(null\);", '', a, count=1)
a = re.sub(r"\n  const \[googleToken, setGoogleToken\] = useState<string \| null>\(null\);", '', a, count=1)
a = re.sub(r"\n  const uploadToGoogleDrive = async \(blob: Blob, filename: string, showToastOnSuccess = true\) => \{.*?\n  \};", '', a, count=1, flags=re.S)

# Remove manual/batch sync handlers.
for start_marker, end_marker in [
    ('  const handleForceSaveAllToCloud = async', '  const notificationAlertsCount ='),
    ('  // Check URL parameters for direct workspace link or PIN code', '  // Register Service Worker on startup'),
    ('  const handleForceSyncNow = async', '  const uploadToGoogleDrive = async'),
    ('  const handleSyncPendingToCloud = async', '  // Effect to generate and render the worker PDF'),
]:
    a = remove_between(a, start_marker, end_marker)

# Remove legacy sync/workspace state as one block.
start = a.find('  const [groupId, setGroupId]')
if start >= 0:
    end = a.find('  const [autoSaveToDrive, setAutoSaveToDrive]', start)
    if end < 0:
        raise RuntimeError('Could not locate end of legacy sync state block')
    a = a[:start] + a[end:]

# Remove remaining workspace/session handlers and sync persistence effects.
for start_marker, end_marker in [
    ('  const handleDisconnectSession = async', '  const [searchTerm'),
    ('  const handleAddMember = async', '  const [searchTerm'),
    ('  const handleUpdateMemberRole = async', '  const [searchTerm'),
    ('  const handleRemoveMember = async', '  const [searchTerm'),
    ('  const handleSelectWorkspace = async', '  const [searchTerm'),
    ('  const handleJoinWorkspaceByCodeOrEmail = async', '  const [searchTerm'),
    ('  const handleUpdateSyncEmail = async', '  const [searchTerm'),
    ('  const handleDisconnectSyncEmail = async', '  const [searchTerm'),
]:
    a = remove_between(a, start_marker, end_marker)
a = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA_(groupId|isSyncing|syncMode|sessionId|lastSyncTime|syncEmail|activeWorkspace|activeWorkspaceId)'.*?\n  \}, \[[^\]]+\]\);", '', a, flags=re.S)

# Remove App-owned auth listener; AuthGate is the only authentication boundary.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    const unsubscribe = initAuth\(.*?\n  \}, \[\]\);", '', a, count=1, flags=re.S)

# Use the current Firebase Authentication session for the Firestore subscription.
a = a.replace('const uid = googleUser?.uid;', 'const uid = auth.currentUser?.uid;', 1)
a = re.sub(r"\n    const unsubscribeTrash = subscribeToAccountTrash\(uid, trash => \{\n      setDeletedPeople\(trash\);\n    \}\);", '', a, count=1)
a = re.sub(r"\n    return \(\) => \{ unsubscribe\(\); unsubscribeTrash\(\); \};\n  \}, \[googleUser\?\.uid\]\);", "\n    return () => unsubscribe();\n  }, []);", a, count=1)
if "import { auth } from './src/lib/firebase';" not in a:
    a = a.replace("import { compressToGzip } from './src/lib/compression';\n", "import { compressToGzip } from './src/lib/compression';\nimport { auth } from './src/lib/firebase';\n", 1)

a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)

# Remove synchronization fields from worker PDF QR links.
export_utils = ROOT / 'src/lib/exportUtils.ts'
e = export_utils.read_text()
e = re.sub(r"\n\s*const groupId = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_groupId'\) \|\| '' : '';", '', e)
e = re.sub(r"\n\s*const isSyncActive = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_isSyncing'\) === 'true' : false;", '', e)
e = re.sub(r"\n\s*if \(isSyncActive && groupId\) \{\n\s*qrText \+= `&sync=\$\{encodeURIComponent\(groupId\)\}`;\n\s*\}", '', e)
export_utils.write_text(e)

# Remove the manual sync implementation from the client data layer.
firebase = ROOT / 'src/lib/firebase.ts'
s = firebase.read_text()
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
s = cut_function(s, 'export async function triggerFirestoreDatabaseSync')
# Remove Google Authentication provider from Firebase Auth. Email/password remains the only provider.
s = re.sub(r"\nconst provider = new GoogleAuthProvider\(\);.*?\n\nlet isSigningIn = false;\nlet cachedAccessToken: string \| null = null;", '', s, count=1, flags=re.S)
s = s.replace('  signInWithPopup,\n  GoogleAuthProvider,\n', '')
s = re.sub(r"\nexport const googleSignIn = async .*?\n\};", '', s, count=1, flags=re.S)
s = re.sub(r"\nexport const logoutGoogle = async .*?\n\};", '', s, count=1, flags=re.S)
firebase.write_text(s)

print('Multiuser finalization applied.')
