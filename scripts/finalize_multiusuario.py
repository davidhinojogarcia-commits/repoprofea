from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app = ROOT / 'App.tsx'
a = app.read_text()

# Remove explicit manual/batch sync API import.
a = re.sub(r"\n\s*triggerFirestoreDatabaseSync,?", '', a, count=1)

# Remove manual sync handlers while preserving the existing PROFEA UI.
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

# Remove synchronization/workspace state declarations.
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
    a, _ = re.subn(pattern, '\n', a, count=1, flags=re.S)

# Remove sync/workspace persistence effects.
a = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA_(groupId|isSyncing|syncMode|sessionId|lastSyncTime|syncEmail|activeWorkspace|activeWorkspaceId)'.*?\n  \}, \[[^\]]+\]\);", '', a, flags=re.S)

# Remove workspace/session handlers.
for pattern in [
    r"\n  const handleDisconnectSession = async \(\) => \{.*?\n  \};",
    r"\n  const handleAddMember = async .*?\n  \};",
    r"\n  const handleUpdateMemberRole = async .*?\n  \};",
    r"\n  const handleRemoveMember = async .*?\n  \};",
    r"\n  const handleSelectWorkspace = async .*?\n  \};",
    r"\n  const handleJoinWorkspaceByCodeOrEmail = async .*?\n  \};",
    r"\n  const handleUpdateSyncEmail = async .*?\n  \};",
    r"\n  const handleDisconnectSyncEmail = async .*?\n  \};",
]:
    a = re.sub(pattern, '', a, count=1, flags=re.S)

# Firestore authoritative subscription uses the Firebase Auth session.
a = a.replace('const uid = googleUser?.uid;', 'const uid = auth.currentUser?.uid;', 1)
a = re.sub(r"\n    const unsubscribeTrash = subscribeToAccountTrash\(uid, trash => \{\n      setDeletedPeople\(trash\);\n    \}\);", '', a, count=1)
a = re.sub(r"\n    return \(\) => \{ unsubscribe\(\); unsubscribeTrash\(\); \};\n  \}, \[googleUser\?\.uid\]\);", "\n    return () => unsubscribe();\n  }, []);", a, count=1)
if "import { auth } from './src/lib/firebase';" not in a:
    a = a.replace("import { compressToGzip } from './src/lib/compression';\n", "import { compressToGzip } from './src/lib/compression';\nimport { auth } from './src/lib/firebase';\n", 1)

# Remove the explicit sync alert render.
a = re.sub(r"\n\s*<DatabaseSyncAlert\s*/>", '', a)

app.write_text(a)

# Remove the legacy manual sync function from firebase.ts.
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
firebase.write_text(s)
print('Multiuser finalization applied.')
