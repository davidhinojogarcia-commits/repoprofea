from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def remove_block(path: Path, pattern: str):
    text = path.read_text()
    updated, count = re.subn(pattern, '', text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'Could not remove expected block from {path}: {pattern[:120]}')
    path.write_text(updated)

# Header: Firestore is automatic; there is no manual sync button anymore.
header = ROOT / 'components/Header.tsx'
text = header.read_text()
text = re.sub(r"\s*onOpenFirebaseSync\?: \(\) => void;\n  isSyncingFirebase\?: boolean;\n  firebaseWorkersCount\?: number;", '', text, count=1)
text = re.sub(r"\s*onOpenFirebaseSync,\n  isSyncingFirebase = false,\n  firebaseWorkersCount = 0", '', text, count=1)
text = re.sub(r"\n\s*\{onOpenFirebaseSync && \(.*?\n\s*\)\}", '', text, count=1, flags=re.S)
header.write_text(text)

# App: remove the old manual sync modal, handler and Header props. Keep all
# unrelated Google Drive OAuth functionality intact.
app = ROOT / 'App.tsx'
a = app.read_text()
a = re.sub(r"import \{ DatabaseSyncAlert \} from './components/DatabaseSyncAlert';\n", '', a, count=1)
a = re.sub(r"import \{ FirebaseSyncModal \} from './components/FirebaseSyncModal';\n", '', a, count=1)
a = re.sub(r"import \{ executeDatabaseSync, notifyDatabaseSync \} from './src/lib/syncNotifier';\n", '', a, count=1)
a = re.sub(r"\s*const \[isFirebaseSyncModalOpen, setIsFirebaseSyncModalOpen\] = useState\(false\);\n\s*const \[isSyncingFirebase, setIsSyncingFirebase\] = useState\(false\);\n\s*const handlePerformFirebaseSync = async \(\): Promise<number> => \{.*?\n\s*\};", '', a, count=1, flags=re.S)
a = re.sub(r"\n\s*onOpenFirebaseSync=\{\(\) => setIsFirebaseSyncModalOpen\(true\)\}\n\s*isSyncingFirebase=\{isSyncingFirebase\}\n\s*firebaseWorkersCount=\{people.length\}", '', a, count=1)
a = re.sub(r"\n\s*<FirebaseSyncModal\n\s*isOpen=\{isFirebaseSyncModalOpen\}.*?\n\s*/>", '', a, count=1, flags=re.S)
# Remove stale explicit DatabaseSyncAlert render if still present.
a = re.sub(r"\n\s*<DatabaseSyncAlert.*?\n\s*/>", '', a, count=1, flags=re.S)
app.write_text(a)

print('Legacy manual Firebase sync UI removed.')
