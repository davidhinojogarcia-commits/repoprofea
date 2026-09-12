import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { supabase, type SupabaseUser } from '../src/lib/supabase';
import { Eye, EyeOff, KeyRound, Loader2, LogIn } from 'lucide-react';
import { authErrorMessage, getCurrentRole, signInWithEmail, signOutUser, subscribeToAuth, type AppRole } from '../src/lib/authService';
import { hydrateStoredSubcontratasPreferences } from '../src/lib/subcontratasDefaults';
import { hydrateStoredPdfConfig } from '../src/lib/exportUtils';
import { clearUserActivity, initializeUserActivity, useIdleTimeout } from '../src/hooks/useIdleTimeout';

interface AuthGateProps { children: React.ReactNode; }

export interface AuthShellValue {
  user: SupabaseUser;
  role: AppRole;
  signingOut: boolean;
  signOut: () => Promise<void>;
}

export const AuthShellContext = React.createContext<AuthShellValue | null>(null);
export function useAuthShell() {
  const value = React.useContext(AuthShellContext);
  if (!value) throw new Error('useAuthShell debe usarse dentro de AuthGate.');
  return value;
}

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
  const [notice, setNotice] = useState('');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const explicitSignOutRef = useRef(false);
  const authValidationRef = useRef(0);
  const roleRef = useRef<AppRole | null>(null);
  const authTaskTimerRef = useRef<number | null>(null);

  useEffect(() => { roleRef.current = role; }, [role]);

  useEffect(() => {
    const validateAuthenticatedUser = async (currentUser: SupabaseUser, event: AuthChangeEvent) => {
      const validationId = ++authValidationRef.current;
      setUser(currentUser);

      if (event === 'TOKEN_REFRESHED' && roleRef.current) {
        setLoading(false);
        return;
      }

      setError('');
      try {
        const currentRole = await getCurrentRole();
        if (validationId !== authValidationRef.current) return;
        if (currentRole) {
          await Promise.all([
            hydrateStoredSubcontratasPreferences().catch(err => console.warn('No se pudieron precargar preferencias de subcontratas:', err)),
            hydrateStoredPdfConfig().catch(err => console.warn('No se pudo precargar la configuración PDF:', err)),
          ]);
          if (validationId !== authValidationRef.current) return;
        }
        setRole(currentRole);
        if (!currentRole) {
          setError('Tu cuenta no tiene un rol autorizado. Contacta con un administrador.');
          await signOutUser();
        }
      } catch {
        if (validationId !== authValidationRef.current) return;
        setRole(null);
        setError('No se ha podido validar tu cuenta. Contacta con un administrador.');
        await signOutUser().catch(() => undefined);
      } finally {
        if (validationId === authValidationRef.current) setLoading(false);
      }
    };

    const unsubscribe = subscribeToAuth((currentUser, event) => {
      if (!currentUser) {
        ++authValidationRef.current;
        setUser(null);
        setRole(null);
        setSigningOut(false);
        setLoading(false);
        if (explicitSignOutRef.current) {
          explicitSignOutRef.current = false;
          setEmail('');
          setPassword('');
          setShowPassword(false);
          setError('');
        }
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        ++authValidationRef.current;
        setUser(currentUser);
        setRole(null);
        setPasswordRecovery(true);
        setError('');
        setNotice('');
        setLoading(false);
        return;
      }

      if (authTaskTimerRef.current) window.clearTimeout(authTaskTimerRef.current);
      authTaskTimerRef.current = window.setTimeout(() => {
        authTaskTimerRef.current = null;
        void validateAuthenticatedUser(currentUser, event);
      }, 0);
    });

    return () => {
      unsubscribe();
      if (authTaskTimerRef.current) window.clearTimeout(authTaskTimerRef.current);
    };
  }, []);

  const handleIdleTimeout = useCallback(async () => {
    if (!user || passwordRecovery) return;
    setNotice('Tu sesión se ha cerrado por inactividad.');
    setError('');
    clearUserActivity(user.id);
    try {
      await signOutUser();
    } finally {
      window.history.replaceState({}, '', '/');
    }
  }, [user, passwordRecovery]);

  const { warningOpen, remainingMs, continueSession } = useIdleTimeout({
    userId: passwordRecovery ? null : user?.id || null,
    onTimeout: handleIdleTimeout,
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    explicitSignOutRef.current = false;
    setError('');
    setNotice('');
    if (!email.trim() || !password) {
      setError('Introduce tu correo electrónico y contraseña.');
      return;
    }
    setSubmitting(true);
    try {
      const signedInUser = await signInWithEmail(email, password);
      initializeUserActivity(signedInUser.id);
      setPassword('');
      window.history.replaceState({}, '', '/');
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      await supabase.auth.signOut({ scope: 'local' });
      setPasswordRecovery(false);
      setUser(null);
      setRole(null);
      setNewPassword('');
      setConfirmPassword('');
      setShowNewPassword(false);
      setNotice('Contraseña actualizada correctamente. Ya puedes iniciar sesión con la nueva contraseña.');
      window.history.replaceState({}, '', '/');
    } catch (err:any) {
      setError(err?.message || 'No se ha podido actualizar la contraseña. Solicita un nuevo enlace de recuperación.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    explicitSignOutRef.current = true;
    setSigningOut(true);
    setError('');
    setNotice('');
    if (user) clearUserActivity(user.id);
    try {
      await signOutUser();
      window.history.replaceState({}, '', '/');
    } catch (err) {
      explicitSignOutRef.current = false;
      setError(authErrorMessage(err));
      setSigningOut(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-brand-primary" /></div>;

  if (passwordRecovery && user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 p-8">
          <div className="text-center mb-7">
            <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-brand-primary"><KeyRound size={24}/></div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Crear nueva contraseña</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Introduce una nueva contraseña para {user.email || 'tu cuenta'}.</p>
          </div>
          <form onSubmit={handlePasswordRecovery} className="space-y-5">
            <div><label htmlFor="new-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Nueva contraseña</label><div className="relative"><input id="new-password" type={showNewPassword?'text':'password'} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={8} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 pr-12 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/30" disabled={submitting}/><button type="button" aria-label={showNewPassword?'Ocultar contraseña':'Mostrar contraseña'} onClick={()=>setShowNewPassword(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-primary">{showNewPassword?<EyeOff size={20}/>:<Eye size={20}/>}</button></div></div>
            <div><label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Repetir contraseña</label><input id="confirm-password" type={showNewPassword?'text':'password'} autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={8} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/30" disabled={submitting}/></div>
            {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-brand-primary hover:bg-brand-secondary text-white py-3.5 font-semibold flex items-center justify-center gap-2 disabled:opacity-60">{submitting?<Loader2 className="h-5 w-5 animate-spin"/>:<KeyRound className="h-5 w-5"/>}{submitting?'Actualizando…':'Guardar nueva contraseña'}</button>
          </form>
        </div>
      </div>
    );
  }

  if (user && role) {
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(seconds / 60);
    const secs = String(seconds % 60).padStart(2, '0');
    return (
      <AuthShellContext.Provider value={{ user, role, signingOut, signOut: handleSignOut }}>
        <div className="min-h-screen">{children}</div>
        {warningOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="idle-title">
            <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl dark:border-amber-900 dark:bg-slate-900">
              <h2 id="idle-title" className="text-xl font-bold text-slate-900 dark:text-white">Tu sesión está a punto de cerrarse por inactividad.</h2>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Tu sesión se cerrará en 2 minutos por inactividad.</p>
              <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-300">Tiempo restante: {minutes}:{secs}</p>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" onClick={handleSignOut} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cerrar sesión</button>
                <button type="button" onClick={continueSession} className="rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-secondary">Continuar sesión</button>
              </div>
            </div>
          </div>
        )}
      </AuthShellContext.Provider>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 p-8">
        <div className="text-center mb-8">
          <img src="/logo-diputacion-profea.svg" alt="PROFEA" className="h-16 w-auto mx-auto mb-5 dark:hidden"/>
          <img src="/logo-diputacion-profea-dark.svg" alt="PROFEA" className="h-16 w-auto mx-auto mb-5 hidden dark:block"/>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Acceso a PROFEA</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Inicia sesión para continuar</p>
        </div>
        {notice && <div role="status" className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">{notice}</div>}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div><label htmlFor="login-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Correo electrónico</label><input id="login-email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/30" placeholder="correo@ejemplo.es" disabled={submitting}/></div>
          <div><label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Contraseña</label><div className="relative"><input id="login-password" type={showPassword?'text':'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 pr-12 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/30" disabled={submitting}/><button type="button" aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'} onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-primary hover:text-brand-secondary transition-colors">{showPassword?<EyeOff size={20}/>:<Eye size={20}/>}</button></div></div>
          {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          <button type="submit" disabled={submitting} className="w-full rounded-xl bg-brand-primary hover:bg-brand-secondary text-white py-3.5 font-semibold flex items-center justify-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 disabled:opacity-60">{submitting?<Loader2 className="h-5 w-5 animate-spin"/>:<LogIn className="h-5 w-5"/>}{submitting?'Iniciando sesión…':'Iniciar sesión'}</button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">El acceso es gestionado exclusivamente por un administrador.</p>
      </div>
    </div>
  );
}
