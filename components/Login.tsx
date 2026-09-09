import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../src/lib/firebase';

export const Login: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setMessage({ type: 'error', text: 'Introduce un correo electrónico válido.' });
      return;
    }
    if (password.length < 6) {
      setMessage({ type: 'error', text: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    setBusy(true);
    try {
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
        setMessage({ type: 'success', text: 'Cuenta creada correctamente. Preparando tus datos…' });
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      }
    } catch (error: any) {
      const code = error?.code || '';
      const messages: Record<string, string> = {
        'auth/invalid-credential': 'Correo o contraseña incorrectos.',
        'auth/user-not-found': 'No existe una cuenta con ese correo.',
        'auth/wrong-password': 'Correo o contraseña incorrectos.',
        'auth/email-already-in-use': 'Ese correo ya tiene una cuenta. Inicia sesión.',
        'auth/weak-password': 'La contraseña es demasiado débil.',
        'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
        'auth/invalid-email': 'El correo electrónico no es válido.',
      };
      setMessage({ type: 'error', text: messages[code] || 'No se pudo completar la operación. Inténtalo de nuevo.' });
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setMessage({ type: 'error', text: 'Introduce primero tu correo para recuperar la contraseña.' });
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setMessage({ type: 'success', text: 'Te hemos enviado un correo para restablecer la contraseña.' });
    } catch {
      setMessage({ type: 'error', text: 'No se pudo enviar el correo de recuperación.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl p-7 sm:p-9">
          <div className="flex justify-center mb-6">
            <img src="/logo-diputacion-profea.svg" alt="PROFEA Diputación de Cádiz" className="h-14 w-auto dark:hidden" />
            <img src="/logo-diputacion-profea-dark.svg" alt="PROFEA Diputación de Cádiz" className="h-14 w-auto hidden dark:block" />
          </div>

          <div className="text-center mb-7">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Gestión PROFEA</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Accede a tus datos desde cualquier dispositivo</p>
          </div>

          <div className="grid grid-cols-2 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-6">
            <button type="button" onClick={() => { setMode('login'); setMessage(null); }} className={`py-2.5 rounded-lg text-sm font-semibold transition ${mode === 'login' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>Iniciar sesión</button>
            <button type="button" onClick={() => { setMode('register'); setMessage(null); }} className={`py-2.5 rounded-lg text-sm font-semibold transition ${mode === 'register' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>Crear cuenta</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Nombre</label>
                <input value={name} onChange={e => setName(e.target.value)} type="text" autoComplete="name" placeholder="Tu nombre" className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Correo electrónico</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required placeholder="tu@correo.com" className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Contraseña</label>
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={6} placeholder="Mínimo 6 caracteres" className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {message && <div className={`rounded-xl px-4 py-3 text-sm ${message.type === 'error' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>{message.text}</div>}

            <button disabled={busy} className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? 'Procesando…' : mode === 'register' ? 'Crear mi cuenta' : 'Entrar en la aplicación'}
            </button>
          </form>

          {mode === 'login' && (
            <button type="button" onClick={resetPassword} disabled={busy} className="w-full mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400">¿Has olvidado tu contraseña?</button>
          )}

          <p className="text-[11px] text-center text-slate-400 mt-7 leading-relaxed">Tus datos de trabajo se almacenan separados por cuenta. Nadie que use otra cuenta podrá acceder a tus registros.</p>
        </div>
      </div>
    </main>
  );
};
