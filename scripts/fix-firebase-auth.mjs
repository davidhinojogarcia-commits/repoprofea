import fs from 'node:fs';

const path = 'src/lib/firebase.ts';
let src = fs.readFileSync(path, 'utf8');
const firestoreMarker = '// Initialize Firestore';
const firestoreIndex = src.indexOf(firestoreMarker);
if (firestoreIndex < 0) throw new Error('Firestore marker not found');

const header = `import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  getDocFromServer,
  enableNetwork,
  setLogLevel,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  deleteDoc,
  Unsubscribe
} from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  User
} from 'firebase/auth';
import { Person, DeletedPerson, PdfCustomConfig, UserAccount } from '../../types';
import firebaseConfig from '../../firebase-applet-config.json';

`;

const authBlock = `// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

// Firebase Authentication is email/password only. Google OAuth is not configured.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => onAuthStateChanged(auth, async (user) => {
  if (user) {
    await saveUserProfile(user).catch(err => console.warn('Could not auto-save user profile:', err));
    onAuthSuccess?.(user, null);
  } else {
    onAuthFailure?.();
  }
});

export async function emailPasswordSignIn(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  await saveUserProfile(result.user);
  return result.user;
}

export async function registerEmailPassword(email: string, password: string, displayName?: string) {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName?.trim()) await updateProfile(result.user, { displayName: displayName.trim() });
  await saveUserProfile(result.user);
  return result.user;
}

export async function resetEmailPassword(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

// Legacy symbol retained only to avoid breaking older UI imports; it cannot authenticate with Google.
export const googleSignIn = async () => {
  throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.');
};

export const getAccessToken = async (): Promise<string | null> => null;

export const logoutGoogle = async () => {
  await auth.signOut();
};

`;

src = header + authBlock + src.slice(firestoreIndex);
fs.writeFileSync(path, src, 'utf8');
console.log('Firebase auth section normalized.');
