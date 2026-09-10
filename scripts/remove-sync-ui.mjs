import fs from 'node:fs';

const path = 'App.tsx';
let app = fs.readFileSync(path, 'utf8');
const before = app;

const remove = (pattern, label) => {
  const next = app.replace(pattern, '');
  if (next !== app) console.log(`removed ${label}`);
  app = next;
};

remove(/import \{ DatabaseSyncAlert \} from '[^']+';\n/g, 'DatabaseSyncAlert import');
remove(/import \{ FirebaseSyncModal \} from '[^']+';\n/g, 'FirebaseSyncModal import');
remove(/import \{ executeDatabaseSync, notifyDatabaseSync \} from '[^']+';\n/g, 'syncNotifier import');
remove(/import \{\n  createFirestoreWorker,[\s\S]*?\n\} from '\.\/src\/lib\/firebase';\n/g, 'legacy Firebase sync CRUD import');

app = app.replace(/\n\s*DEFAULT_WORKSPACE_ID,\n\s*isQuotaExceeded,\n/g, '\n');

remove(/\n\s*const \[isFirebaseSyncModalOpen, isSyncingFirebase\] = useState[^;]*;[\s\S]*?\n\s*const handleForceSaveAllToCloud[\s\S]*?\n\s*};/g, 'manual Firebase sync state/handlers');
remove(/\n\s*const \[isFirebaseSyncModalOpen,[\s\S]*?\n\s*};\n\n\s*const handleForceSaveAllToCloud[\s\S]*?\n\s*};/g, 'manual Firebase sync state/handlers variant');

remove(/\n\s*useEffect\(\(\) => \{\n\s*localStorage\.setItem\('personasPROFEA', JSON\.stringify\(people\)\);\n\s*\}, \[people\]\);/g, 'people localStorage persistence');
remove(/\n\s*useEffect\(\(\) => \{\n\s*localStorage\.setItem\('personasEliminadasPROFEA', JSON\.stringify\(deletedPeople\)\);\n\s*\}, \[deletedPeople\]\);/g, 'trash localStorage persistence');

const peopleInitializer = /const \[people, setPeopleRaw\] = useState<Person\[\]>\(\(\) => \{[\s\S]*?\n\s*\}\);/;
if (peopleInitializer.test(app)) {
  app = app.replace(peopleInitializer, 'const [people, setPeopleRaw] = useState<Person[]>([]);');
  console.log('removed people localStorage initializer');
}

remove(/\n\s*onOpenFirebaseSync=\{\(\) => setIsFirebaseSyncModalOpen\(true\)\}/g, 'Firebase sync header button');
remove(/\n\s*isSyncingFirebase=\{isSyncingFirebase\}/g, 'Firebase sync header state');
remove(/\n\s*firebaseWorkersCount=\{people\.length\}/g, 'Firebase sync header count');

remove(/\n\s*<FirebaseSyncModal[\s\S]*?\/>/g, 'Firebase sync modal');
remove(/\n\s*<DatabaseSyncAlert[\s\S]*?\/>/g, 'Database sync alert');

// The synchronization view is obsolete: Firebase is now transparent infrastructure.
remove(/\n\s*\{activeView === 'sincronizacion' && \([\s\S]*?\n\s*\)\}/g, 'Sincronizacion view');

fs.writeFileSync(path, app, 'utf8');
console.log(`App changed: ${before !== app}`);
