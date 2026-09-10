import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');

const firebasePath = 'src/lib/firebase.ts';
let firebase = read(firebasePath);

// Firebase Authentication: email/password only. Google OAuth is deliberately removed.
firebase = firebase.replace(/import \{[\s\S]*?\} from 'firebase\/auth';/, `import {\n  getAuth,\n  onAuthStateChanged,\n  signInWithEmailAndPassword,\n  createUserWithEmailAndPassword,\n  sendPasswordResetEmail,\n  updateProfile,\n  User\n} from 'firebase/auth';`);
firebase = firebase.replace(/\/\/ Initialize Provider[\s\S]*?let isSigningIn = false;\nlet cachedAccessToken: string \| null = null;/, '');

const authStart = firebase.indexOf('export const googleSignIn = async');
const authEnd = firebase.indexOf('// Initialize Firestore', authStart);
if (authStart >= 0 && authEnd > authStart) {
  firebase = firebase.slice(0, authStart) + `export async function emailPasswordSignIn(email: string, password: string) {\n  const result = await signInWithEmailAndPassword(auth, email.trim(), password);\n  await saveUserProfile(result.user);\n  return result.user;\n}\n\nexport async function registerEmailPassword(email: string, password: string, displayName?: string) {\n  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);\n  if (displayName?.trim()) await updateProfile(result.user, { displayName: displayName.trim() });\n  await saveUserProfile(result.user);\n  return result.user;\n}\n\nexport async function resetEmailPassword(email: string) {\n  return sendPasswordResetEmail(auth, email.trim());\n}\n\n// Compatibility exports kept only so legacy UI code compiles. No Google provider exists.\nexport const googleSignIn = async () => {\n  throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.');\n};\n\nexport const getAccessToken = async (): Promise<string | null> => null;\n\nexport const logoutGoogle = async () => {\n  await auth.signOut();\n};\n\n` + firebase.slice(authEnd);
}

// No localStorage is used by the Firebase layer for quota or business data.
firebase = firebase.replace(/const QUOTA_STORAGE_KEY = '[^']*';\n/, '');
firebase = firebase.replace(/\s*localStorage\.removeItem\(QUOTA_STORAGE_KEY\);/, '');

// All business data is tenant-owned by the authenticated UID. Workspace/account APIs are
// compatibility names only; they no longer point at workspace/account collections.
firebase = firebase.replace(/collection\(db, 'workspaces', cleanWsId, 'workers'\)/g, "collection(db, 'users', auth.currentUser!.uid, 'workers')");
firebase = firebase.replace(/collection\(db, 'workspaces', cleanWsId, 'trash'\)/g, "collection(db, 'users', auth.currentUser!.uid, 'trash')");
firebase = firebase.replace(/collection\(db, workspaceId, 'workers'\)/g, "collection(db, 'users', auth.currentUser!.uid, 'workers')");
firebase = firebase.replace(/collection\(db, workspaceId, 'trash'\)/g, "collection(db, 'users', auth.currentUser!.uid, 'trash')");
firebase = firebase.replace(/collection\(db, userId, 'workers'\)/g, "collection(db, 'users', userId, 'workers')");
firebase = firebase.replace(/collection\(db, userId, 'trash'\)/g, "collection(db, 'users', userId, 'trash')");

// Settings are stored under the authenticated user's document.
firebase = firebase.replace(/doc\(db, 'workspaces', cleanWsId, 'settings', 'app_config'\)/g, "doc(db, 'users', auth.currentUser!.uid, 'settings', 'app_config')");
firebase = firebase.replace(/doc\(db, workspaceId, 'settings', 'app_config'\)/g, "doc(db, 'users', auth.currentUser!.uid, 'settings', 'app_config')");
firebase = firebase.replace(/collection\(db, 'workspaces', workspaceId, 'sessions'\)/g, "collection(db, 'users', auth.currentUser!.uid, 'sessions')");

// Account-scoped data also maps to the same canonical user document.
firebase = firebase.replace(/doc\(db, 'accounts', cleanId\)/g, "doc(db, 'users', cleanId)");
firebase = firebase.replace(/collection\(db, 'accounts', accountId, 'workers'\)/g, "collection(db, 'users', accountId, 'workers')");
firebase = firebase.replace(/collection\(db, 'accounts', accountId, 'trash'\)/g, "collection(db, 'users', accountId, 'trash')");
firebase = firebase.replace(/doc\(db, 'accounts', accountId, 'settings', 'app_config'\)/g, "doc(db, 'users', accountId, 'settings', 'app_config')");

// Prevent legacy fallback writes to server-side sync stores.
firebase = firebase.replace(/fetch\('\/api\/database\/save-workers-batch'[\s\S]*?\);/g, '');

write(firebasePath, firebase);

const appPath = 'App.tsx';
let app = read(appPath);

// Remove the manual Firebase synchronization UI introduced by the previous iteration.
app = app.replace(/import \{ DatabaseSyncAlert \} from '[^']*';\n/g, '');
app = app.replace(/import \{ FirebaseSyncModal \} from '[^']*';\n/g, '');
app = app.replace(/import \{ executeDatabaseSync, notifyDatabaseSync \} from '[^']*';\n/g, '');
app = app.replace(/import \{\n  createFirestoreWorker,[\s\S]*?\n\} from '\.\/src\/lib\/firebase';\n/g, '');
app = app.replace(/\s*DEFAULT_WORKSPACE_ID,\n\s*isQuotaExceeded,\n/g, '\n');

// Remove the sync modal state and handlers.
app = app.replace(/\n\s*const \[isFirebaseSyncModalOpen,[\s\S]*?\n\s*};\n\n\s*const handleForceSaveAllToCloud[\s\S]*?\n\s*};/g, '');

// Do not persist business data in browser storage. Firestore listeners are the source of truth.
app = app.replace(/\n\s*useEffect\(\(\) => \{\n\s*localStorage\.setItem\('personasPROFEA', JSON\.stringify\(people\)\);\n\s*\}, \[people\]\);/g, '');
app = app.replace(/\n\s*useEffect\(\(\) => \{\n\s*localStorage\.setItem\('personasEliminadasPROFEA', JSON\.stringify\(deletedPeople\)\);\n\s*\}, \[deletedPeople\]\);/g, '');

// Never restore business records from localStorage at startup.
app = app.replace(/const \[people, setPeopleRaw\] = useState<Person\[\]>\(\(\) => \{[\s\S]*?\n\s*\}\);/, "const [people, setPeopleRaw] = useState<Person[]>([]);");

// Remove the sync-related header props.
app = app.replace(/\n\s*onOpenFirebaseSync=\{\(\) => setIsFirebaseSyncModalOpen\(true\)\}/g, '');
app = app.replace(/\n\s*isSyncingFirebase=\{isSyncingFirebase\}/g, '');
app = app.replace(/\n\s*firebaseWorkersCount=\{people\.length\}/g, '');

// Remove any rendered Firebase sync modal/alert blocks.
app = app.replace(/\n\s*<FirebaseSyncModal[\s\S]*?\/>/g, '');
app = app.replace(/\n\s*<DatabaseSyncAlert[\s\S]*?\/>/g, '');

write(appPath, app);

console.log('Firebase multiuser migration transformations applied.');
