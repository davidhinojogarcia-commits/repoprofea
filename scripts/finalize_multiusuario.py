from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

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

def remove_between(text, start_marker, end_marker):
    start = text.find(start_marker)
    if start < 0: return text
    end = text.find(end_marker, start)
    if end < 0: raise RuntimeError(f'End marker not found: {end_marker}')
    return text[:start] + text[end:]

app_path = ROOT / 'App.tsx'
a = app_path.read_text()
for marker in [
    '  const handleGoogleLogin = async', '  const handleGoogleLogout = async',
    '  const handleForceSaveAllToCloud = async', '  const handleForceSyncNow = async',
    '  const handleSyncPendingToCloud = async', '  const handleUploadAllLocalToAccount = async',
    '  const handleDownloadAllFromAccount = async', '  const handleUpdateSyncEmail = async',
    '  const handleDisconnectSyncEmail = async', '  const handleAddMember = async',
    '  const handleRemoveMember = async', '  const handleSelectWorkspace = async',
    '  const handleJoinWorkspaceByCodeOrEmail = async', '  const handleDisconnectSession = async',
]:
    a = cut_function(a, marker)
a = remove_between(a, '  // Compute effective sync email & workspace ID', '  const uploadToGoogleDrive = async')
start = a.find('  const [groupId, setGroupId]')
if start >= 0:
    end = a.find('  const [autoSaveToDrive, setAutoSaveToDrive]', start)
    if end < 0: raise RuntimeError('Legacy sync state block end not found')
    a = a[:start] + a[end:]
a = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA_(groupId|isSyncing|syncMode|sessionId|lastSyncTime|syncEmail|activeWorkspace|activeWorkspaceId)'.*?\n  \}, \[[^\]]+\]\);", '', a, flags=re.S)
a = a.replace('setLastSyncTime(new Date());', '')
a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)
a = a.replace('Sincronización activa', 'Conectado')
if "import { auth } from './src/lib/firebase';" not in a:
    a = a.replace("import { compressToGzip } from './src/lib/compression';\n", "import { compressToGzip } from './src/lib/compression';\nimport { auth } from './src/lib/firebase';\n", 1)
a = a.replace('const uid = googleUser?.uid;', 'const uid = auth.currentUser?.uid;', 1)
app_path.write_text(a)

# Remove sync fields from QR generation.
export_path = ROOT / 'src/lib/exportUtils.ts'
e = export_path.read_text()
e = re.sub(r"\n\s*const groupId = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_groupId'\) \|\| '' : '';", '', e)
e = re.sub(r"\n\s*const isSyncActive = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_isSyncing'\) === 'true' : false;", '', e)
e = re.sub(r"\n\s*if \(isSyncActive && groupId\) \{\n\s*qrText \+= `&sync=\$\{encodeURIComponent\(groupId\)\}`;\n\s*\}", '', e)
export_path.write_text(e)

# Firebase Auth remains email/password only. Google helpers are retained as compatibility
# shims for unrelated calendar code, but they cannot sign the application in.
firebase_path = ROOT / 'src/lib/firebase.ts'
s = firebase_path.read_text()
s = cut_function(s, 'export async function triggerFirestoreDatabaseSync')
s = re.sub(r"import \{\s*getAuth,.*?\n\} from 'firebase/auth';", "import { getAuth, onAuthStateChanged, User } from 'firebase/auth';", s, count=1, flags=re.S)
s = re.sub(r"\nexport const getAccessToken = async \(\): Promise<string \| null> => \{.*?\n\};", "\nexport const getAccessToken = async (): Promise<string | null> => null;", s, count=1, flags=re.S)
s = cut_function(s, 'export const googleSignIn = async')
s = cut_function(s, 'export const logoutGoogle = async')
shim = "\nexport const googleSignIn = async (): Promise<never> => { throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.'); };\n"
s += shim
firebase_path.write_text(s)
print('Final migration cleanup complete.')
