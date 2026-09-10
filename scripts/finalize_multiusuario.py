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

# Remove legacy sync/workspace state as one block.
start = a.find('  const [groupId, setGroupId]')
if start >= 0:
    end = a.find('  const [googleUser, setGoogleUser]', start)
    if end < 0:
        raise RuntimeError('Could not locate end of legacy sync state block')
    a = a[:start] + a[end:]

# Remove obsolete workspace/session handlers that may occur outside the main block.
for marker, end_marker in [
    ('  const handleDisconnectSession = async', '  const [searchTerm'),
    ('  const handleAddMember = async', '  const uploadToGoogleDrive'),
    ('  const handleUpdateMemberRole = async', '  const uploadToGoogleDrive'),
    ('  const handleRemoveMember = async', '  const uploadToGoogleDrive'),
    ('  const handleSelectWorkspace = async', '  const uploadToGoogleDrive'),
    ('  const handleJoinWorkspaceByCodeOrEmail = async', '  const uploadToGoogleDrive'),
    ('  const handleUpdateSyncEmail = async', '  const uploadToGoogleDrive'),
    ('  const handleDisconnectSyncEmail = async', '  const uploadToGoogleDrive'),
]:
    remove_between(marker, end_marker)

# Remove App-owned auth listener; AuthGate is the sole application auth boundary.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    const unsubscribe = initAuth\(.*?\n  \}, \[\]\);", '', a, count=1, flags=re.S)

# Remove old Google sign-in flow from App. Google is not an application authentication provider.
remove_between('  const handleGoogleLogin = async', '  const uploadToGoogleDrive = async')

# Remove Google token/user state only if Drive code is no longer wired from App.
a = re.sub(r"\n  const \[googleUser, setGoogleUser\] = useState<any>\(null\);", '', a, count=1)
a = re.sub(r"\n  const \[googleToken, setGoogleToken\] = useState<string \| null>\(null\);", '', a, count=1)

# If Drive helper remains, make it a no-op instead of referencing removed Google auth state.
a = re.sub(r"\n  const uploadToGoogleDrive = async \(blob: Blob, filename: string, showToastOnSuccess = true\) => \{.*?\n  \};", "\n  const uploadToGoogleDrive = async (_blob: Blob, _filename: string, _showToastOnSuccess = true) => { return; };", a, count=1, flags=re.S)

# Firestore authoritative subscription uses Firebase Auth directly.
a = a.replace('const uid = googleUser?.uid;', 'const uid = auth.currentUser?.uid;', 1)
a = re.sub(r"\n    const unsubscribeTrash = subscribeToAccountTrash\(uid, trash => \{\n      setDeletedPeople\(trash\);\n    \}\);", '', a, count=1)
a = re.sub(r"\n    return \(\) => \{ unsubscribe\(\); unsubscribeTrash\(\); \};\n  \}, \[googleUser\?\.uid\]\);", "\n    return () => unsubscribe();\n  }, []);", a, count=1)
if "import { auth } from './src/lib/firebase';" not in a:
    a = a.replace("import { compressToGzip } from './src/lib/compression';\n", "import { compressToGzip } from './src/lib/compression';\nimport { auth } from './src/lib/firebase';\n", 1)

# Remove explicit sync alert render and sync URL query generation in PDF exports.
a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)
export_utils = ROOT / 'src/lib/exportUtils.ts'
e = export_utils.read_text()
e = re.sub(r"\n\s*const groupId = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_groupId'\) \|\| '' : '';", '', e)
e = re.sub(r"\n\s*const isSyncActive = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_isSyncing'\) === 'true' : false;", '', e)
e = re.sub(r"\n\s*if \(isSyncActive && groupId\) \{\n\s*qrText \+= `&sync=\$\{encodeURIComponent\(groupId\)\}`;\n\s*\}", '', e)
export_utils.write_text(e)

# Remove manual sync implementation from firebase.ts.
firebase = ROOT / 'src/lib/firebase.ts'
s = firebase.read_text()
s = remove_function = s

def cut_function(text, marker):
    start = text.find(marker)
    if start < 0: return text
    brace = text.find('{', start)
    if brace < 0: raise RuntimeError(f'Function body not found: {marker}')
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
# Remove Google provider/auth implementation while retaining the email/password Firebase Auth API.
s = re.sub(r"\nconst provider = new GoogleAuthProvider\(\);.*?\n\nlet isSigningIn = false;\nlet cachedAccessToken: string \| null = null;", '', s, count=1, flags=re.S)
s = s.replace('  signInWithPopup,\n  GoogleAuthProvider,\n', '')
s = re.sub(r"\nexport const googleSignIn = async .*?\n\};", '', s, count=1, flags=re.S)
# Remove compatibility symbols if they are no longer referenced by the application.
s = re.sub(r"\nexport const logoutGoogle = async .*?\n\};", '', s, count=1, flags=re.S)
firebase.write_text(s)
print('Residual sync/workspace/Google application flow removed.')
