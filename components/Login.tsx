import React, { useState } from 'react';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { auth } from '../src/lib/firebase';

type Mode = 'login' | 'register' | 'reset';

const firebaseErrorMessage = (err: any, mode: Mode) => {
  const code = String(err?.code || '').toLowerCase();
  if (code.includes('invalid-credential')) return 'El correo o la contraseña no son correctos.';
  if (code.includes('user-not-found')) return 'No existe una cuenta con ese correo electrónico.';
  if (code.includes('wrong-password')) return 'La contraseña no es correcta.';
  if (code.includes('email-already-in-use')) return 'Ya existe una cuenta con ese correo electrónico.';
  if (code.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  if (code.includes('invalid-email')) return 'Introduce un correo electrónico válido.';
  if (code.includes('network-request-failed')) return 'No hay conexión con Firebase. Comprueba tu conexión a Internet.';
  if (code.includes('operation-not-allowed')) return 'El acceso por correo y contraseña no está habilitado en Firebase.';
  if (code.includes('invalid-api-key') || code.includes('app-not-authorized')) return 'La configuración de Firebase no autoriza esta aplicación.';
  if (mode === 'reset') return 'No se pudo enviar el correo de recuperación. Comprueba la dirección e inténtalo de nuevo.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
};

export const Login: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const cleanEmail = email.trim().toLowerCase();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    if (!cleanEmail) {
      setMessage({ type: 'error', text: 'Introduce tu correo electrónico.' });
      return;
    }
    if (mode !== 'reset' && !password) {
      setMessage({ type: 'error', text: 'Introduce tu contraseña.' });
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        if (password.length < 6) {
          setMessage({ type: 'error', text: 'La contraseña debe tener al menos 6 caracteres.' });
          return;
        }
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
        setMessage({ type: 'success', text: 'Cuenta creada correctamente. Entrando en la aplicación…' });
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, cleanEmail);
        setMessage({ type: 'success', text: 'Te hemos enviado un correo para restablecer la contraseña.' });
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
        setMessage({ type: 'success', text: 'Inicio de sesión correcto. Entrando…' });
      }
    } catch (err: any) {
      console.error('[PROFEA Auth]', err?.code || err, err);
      setMessage({ type: 'error', text: firebaseErrorMessage(err, mode) });
    } finally {
      setLoading(false);
    }
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setMessage(null);
    setPassword('');
  };

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8">
          <div className="text-center mb-7">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg mb-4">
              <LockKeyhole className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">PROFEA</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestión de obras y personal</p>
          </div>

          {mode !== 'reset' && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-6">
              <button type="button" onClick={() => changeMode('login')} className={`rounded-lg py-2 text-sm font-semibold transition ${mode === 'login' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>Iniciar sesión</button>
              <button type="button" onClick={() => changeMode('register')} className={`rounded-lg py-2 text-sm font-semibold transition ${mode === 'register' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>Crear cuenta</button>
            </div>
          )}

          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5">
            {mode === 'login' ? 'Accede a tu cuenta' : mode === 'register' ? 'Crea tu cuenta' : 'Recuperar contraseña'}
          </h2>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Nombre</span>
                <div className="relative mt-1">
                  <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 py-3 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Tu nombre" />
                </div>
              </label>
            )}

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Correo electrónico</span>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 py-3 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="correo@ejemplo.com" />
              </div>
            </label>

            {mode !== 'reset' && (
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Contraseña</span>
                <div className="relative mt-1">
                  <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={6} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 py-3 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
            )}

            {message && (
              <div className={`rounded-xl px-3 py-2.5 text-xs font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                {message.text}
              </div>
            )}

            <button type="submit" disabled={loading} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 text-sm flex items-center justify-center gap-2 transition-colors">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Crear cuenta' : 'Enviar recuperación'}
            </button>
          </form>

          {mode === 'login' && (
            <button type="button" onClick={() => changeMode('reset')} className="w-full mt-4 text-xs font-semibold text-blue-600 hover:text-blue-700">¿Has olvidado tu contraseña?</button>
          )}
          {mode === 'reset' && (
            <button type="button" onClick={() => changeMode('login')} className="w-full mt-4 text-xs font-semibold text-blue-600 hover:text-blue-700">Volver al inicio de sesión</button>
          )}
        </div>
      </div>
    </main>
  );
};
