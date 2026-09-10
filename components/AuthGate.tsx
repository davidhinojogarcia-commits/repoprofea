import React, { useEffect, useState } from 'react';
import type { SupabaseUser } from '../src/lib/supabase';
import { Eye, EyeOff, Loader2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { authErrorMessage, getCurrentRole, signInWithEmail, signOutUser, subscribeToAuth, type AppRole } from '../src/lib/authService';

const AdminPanel = React.lazy(() => import('./AdminPanel').then(module => ({ default: module.AdminPanel })));

interface AuthGateProps { children: React.ReactNode; }

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => subscribeToAuth(async currentUser => {
    setUser(currentUser); setError('');
    if (currentUser) {
      try {
        const currentRole = await getCurrentRole();
        setRole(currentRole);
        if (!currentRole) {
          await signOutUser();
          setError('Tu cuenta no tiene un rol autorizado. Contacta con un administrador.');
        }
      } catch {
        setRole(null);
        await signOutUser().catch(() => undefined);
        setError('No se ha podido validar tu cuenta. Contacta con un administrador.');
      }
    } else {
      setRole(null);
      setAdminOpen(false);
      setSigningOut(false);
    }
    setLoading(false);
  }), []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Introduce tu correo electrónico y contraseña.');
      return;
    }
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      setPassword('');
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      setAdminOpen(false);
      await signOutUser();
    } catch (err) {
      setError(authErrorMessage(err));
      setSigningOut(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-slate-600" /></div>;

  if (user && role) return <div className="min-h-screen">
    <>{children}</>
    <div className="fixed bottom-5 left-5 z-[90] flex flex-col sm:flex-row gap-2">
      {role === 'admin' && <button type="button" onClick={() => setAdminOpen(true)} className="rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-lg px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2"><ShieldCheck size={17}/> Administración</button>}
      <button type="button" onClick={handleSignOut} disabled={signingOut} className="rounded-full bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 shadow-lg px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60" aria-label="Cerrar sesión">
        {signingOut ? <Loader2 size={17} className="animate-spin"/> : <LogOut size={17}/>} {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
      </button>
    </div>
    {role === 'admin' && adminOpen && <React.Suspense fallback={<div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-white"/></div>}><AdminPanel onClose={() => setAdminOpen(false)} /></React.Suspense>}
  </div>;

  return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4"><div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 p-8"><div className="text-center mb-8"><img src="/logo-diputacion-profea.svg" alt="PROFEA" className="h-16 w-auto mx-auto mb-5 dark:hidden"/><img src="/logo-diputacion-profea-dark.svg" alt="PROFEA" className="h-16 w-auto mx-auto mb-5 hidden dark:block"/><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Acceso a PROFEA</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Inicia sesión para continuar</p></div><form onSubmit={handleSubmit} className="space-y-5"><div><label htmlFor="login-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Correo electrónico</label><input id="login-email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-500" placeholder="correo@ejemplo.es" disabled={submitting}/></div><div><label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Contraseña</label><div className="relative"><input id="login-password" type={showPassword?'text':'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 pr-12 outline-none focus:ring-2 focus:ring-slate-500" disabled={submitting}/><button type="button" aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'} onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">{showPassword?<EyeOff size={20}/>:<Eye size={20}/>}</button></div></div>{error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>}<button type="submit" disabled={submitting} className="w-full rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-3.5 font-semibold flex items-center justify-center gap-2 disabled:opacity-60">{submitting?<Loader2 className="h-5 w-5 animate-spin"/>:<LogIn className="h-5 w-5"/>}{submitting?'Iniciando sesión…':'Iniciar sesión'}</button></form><p className="mt-6 text-center text-xs text-slate-400">El acceso es gestionado exclusivamente por un administrador.</p></div></div>;
}
