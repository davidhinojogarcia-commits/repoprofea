import React, { FormEvent, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../src/lib/firebase';
import { AdminPanel } from './AdminPanel';

export interface AuthProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  active: boolean;
  permissions: Record<string, boolean>;
}

const DEFAULT_PERMISSIONS = {
  dashboard: true,
  trabajadores: true,
  citas: true,
  calendario: true,
  subcontratas: true,
  papelera: true,
  configuracion: true,
  usuarios: false,
  auditoria: false,
};

async function loadOrCreateProfile(user: User): Promise<AuthProfile> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() as AuthProfile;
  const profile: AuthProfile = {
    uid: user.uid,
    email: (user.email || '').toLowerCase(),
    displayName: user.displayName || user.email?.split('@')[0] || 'Usuario',
    role: 'user',
    active: true,
    permissions: DEFAULT_PERMISSIONS,
  };
  await setDoc(ref, profile);
  return profile;
}

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => onAuthStateChanged(auth, async currentUser => {
    try {
      if (!currentUser) {
        setUser(null); setProfile(null); return;
      }
      const currentProfile = await loadOrCreateProfile(currentUser);
      if (!currentProfile.active) {
        await auth.signOut();
        setError('Tu cuenta está desactivada. Contacta con un administrador.');
        return;
      }
      setUser(currentUser); setProfile(currentProfile);
    } catch (err: any) {
      setError(err?.message || 'No se ha podido cargar el perfil.');
      await auth.signOut().catch(() => {});
    } finally {
      setLoading(false);
    }
  }), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (displayName.trim()) await updateProfile(credential.user, { displayName: displayName.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: any) {
      const messages: Record<string, string> = {
        'auth/invalid-credential': 'Correo o contraseña incorrectos.',
        'auth/user-disabled': 'Esta cuenta está desactivada.',
        'auth/email-already-in-use': 'Ese correo ya está registrado.',
        'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
        'auth/invalid-email': 'El correo electrónico no es válido.',
      };
      setError(messages[err?.code] || err?.message || 'No se ha podido completar la operación.');
    } finally { setBusy(false); }
  };

  const resetPassword = async () => {
    if (!email.trim()) { setError('Introduce primero tu correo electrónico.'); return; }
    setError('');
    try { await sendPasswordResetEmail(auth, email.trim()); setError('Se ha enviado el correo para restablecer la contraseña.'); }
    catch (err: any) { setError(err?.message || 'No se ha podido enviar el correo de recuperación.'); }
  };

  if (loading) return <div className="min-h-screen grid place-items-center bg-slate-50 text-slate-700">Cargando sesión…</div>;

  if (user && profile) return (
    <div className="min-h-screen">
      {children}
      <div className="fixed bottom-4 right-4 z-[90] flex gap-2">
        {profile.role === 'admin' && <button onClick={() => setShowAdmin(true)} className="rounded-xl bg-slate-900 text-white px-4 py-2 shadow-lg">Administración</button>}
        <button onClick={() => auth.signOut()} className="rounded-xl bg-white dark:bg-slate-800 border px-4 py-2 shadow-lg">Cerrar sesión</button>
      </div>
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950 p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 p-8 space-y-5">
        <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Sistema de Gestión PROFEA</h1><p className="text-sm text-slate-500 mt-1">Acceso mediante Firebase Authentication</p></div>
        {mode === 'register' && <input className="w-full rounded-xl border p-3 bg-transparent" placeholder="Nombre" value={displayName} onChange={e => setDisplayName(e.target.value)} />}
        <input className="w-full rounded-xl border p-3 bg-transparent" type="email" autoComplete="email" placeholder="Correo electrónico" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="w-full rounded-xl border p-3 bg-transparent" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-blue-700 text-white p-3 font-semibold disabled:opacity-50">{busy ? 'Procesando…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</button>
        {mode === 'login' && <button type="button" onClick={resetPassword} className="w-full text-sm text-blue-700">Restablecer contraseña</button>}
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} className="w-full text-sm text-slate-600 dark:text-slate-300">{mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo una cuenta'}</button>
      </form>
    </div>
  );
};