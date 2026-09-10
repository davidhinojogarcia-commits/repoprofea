from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

# Idempotent brace-aware function remover for App.tsx legacy handlers.
def cut_function(text, marker):
    start = text.find(marker)
    if start < 0: return text
    brace = text.find('{', start)
    if brace < 0: return text
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
    return text

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
# Remove the legacy state block.
start = a.find('  const [groupId, setGroupId]')
if start >= 0:
    end = a.find('  const [autoSaveToDrive, setAutoSaveToDrive]', start)
    if end >= 0: a = a[:start] + a[end:]
a = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA_(groupId|isSyncing|syncMode|sessionId|lastSyncTime|syncEmail|activeWorkspace|activeWorkspaceId)'.*?\n  \}, \[[^\]]+\]\);", '', a, flags=re.S)
a = a.replace('setLastSyncTime(new Date());', '')
a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)
# App uses Firebase Auth for its Firestore subscription.
a = a.replace('const uid = googleUser?.uid;', 'const uid = auth.currentUser?.uid;', 1)
if "import { auth } from './src/lib/firebase';" not in a:
    a = a.replace("import { compressToGzip } from './src/lib/compression';\n", "import { compressToGzip } from './src/lib/compression';\nimport { auth } from './src/lib/firebase';\n", 1)
# Global toast: green success / red error, auto-dismissed.
if 'setTimeout(() => setToast(null), 3500)' not in a:
    anchor = "  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);\n"
    if anchor in a:
        a = a.replace(anchor, anchor + "  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3500); return () => window.clearTimeout(timer); }, [toast]);\n", 1)
if 'aria-live="polite"' not in a:
    marker = '          {/* Footer Copyright */}'
    toast_markup = '''          {toast && (\n            <div aria-live="polite" role="status" className={`fixed top-5 right-5 z-[200] max-w-sm rounded-xl px-4 py-3 shadow-xl border text-sm font-semibold ${toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200'}`}>\n              {toast.type === 'success' ? '✓' : '✕'} {toast.message}\n            </div>\n          )}\n\n'''
    a = a.replace(marker, toast_markup + marker, 1)
app_path.write_text(a)

# Remove synchronization QR parameters.
export_path = ROOT / 'src/lib/exportUtils.ts'
e = export_path.read_text()
e = re.sub(r"\n\s*const groupId = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_groupId'\) \|\| '' : '';", '', e)
e = re.sub(r"\n\s*const isSyncActive = typeof window !== 'undefined' \? window\.localStorage\.getItem\('personasPROFEA_isSyncing'\) === 'true' : false;", '', e)
e = re.sub(r"\n\s*if \(isSyncActive && groupId\) \{\n\s*qrText \+= `&sync=\$\{encodeURIComponent\(groupId\)\}`;\n\s*\}", '', e)
export_path.write_text(e)

# Firebase Auth: email/password is the application authentication mechanism.
firebase_path = ROOT / 'src/lib/firebase.ts'
s = firebase_path.read_text()
s = re.sub(r"import \{\s*getAuth,.*?\n\} from 'firebase/auth';", "import { getAuth, onAuthStateChanged, User } from 'firebase/auth';", s, count=1, flags=re.S)
s = re.sub(r"\nexport const getAccessToken = async \(\): Promise<string \| null> => \{.*?\n\};", "\nexport const getAccessToken = async (): Promise<string | null> => null;", s, count=1, flags=re.S)
s = cut_function(s, 'export const googleSignIn = async')
s = cut_function(s, 'export const logoutGoogle = async')
# Compatibility shim only for unrelated calendar imports; it cannot authenticate.
if 'export const googleSignIn = async (): Promise<never>' not in s:
    s += "\nexport const googleSignIn = async (): Promise<never> => { throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.'); };\n"
s = cut_function(s, 'export async function triggerFirestoreDatabaseSync')
# Remove a known malformed fragment left by an older migration pass.
s = s.replace("\n> {\n  const data = await fetchAccountData(auth.currentUser?.uid || '');\n  return { ...data, count: data.workers.length };\n}\n", '\n')
firebase_path.write_text(s)
print('Final Firebase multiuser cleanup completed.')
