import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { LogOut, Cloud, Loader2 } from 'lucide-react';
import App from '../App';
import { Login } from './Login';
import { auth } from '../src/lib/firebase';
import { loadUserCloudState, uploadExistingLocalState, startUserCloudSync } from '../src/lib/userCloudStore';

export const AuthGate: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [cloudReady, setCloudReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopCloudSync: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (cancelled) return;
      setUser(currentUser);
      setCloudReady(false);
      setError(null);

      if (!currentUser) {
        if (stopCloudSync) stopCloudSync();
        stopCloudSync = null;
        setChecking(false);
        return;
      }

      setChecking(true);
      try {
        const previousUid = localStorage.getItem('personasPROFEA_activeUid');
        if (previousUid && previousUid !== currentUser.uid) {
          // Never expose the previous account's records to the new account on this device.
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('personasPROFEA') || ['obrasGuardadas','lugaresFormacion','sitiosReconocimiento','telefonosGuardados','categoriasGuardadas','workStartHour','workEndHour'].includes(key))) {
              localStorage.removeItem(key);
            }
          }
        }

        localStorage.setItem('personasPROFEA_activeUid', currentUser.uid);
        const result = await loadUserCloudState(currentUser.uid);
        if (!result.hasCloudData) {
          // First login: preserve any existing local records and make them the initial cloud dataset.
          await uploadExistingLocalState(currentUser.uid);
        }
        if (cancelled) return;
        stopCloudSync = startUserCloudSync(currentUser.uid);
        setCloudReady(true);
      } catch (err: any) {
        console.error('[PROFEA Cloud] Error preparando cuenta:', err);
        if (!cancelled) setError('No se ha podido conectar con la base de datos. Comprueba tu conexión e inténtalo de nuevo.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (stopCloudSync) stopCloudSync();
    };
  }, []);

  const logout = async () => {
    if (stopCloudSyncSafe) stopCloudSyncSafe();
    await auth.signOut();
  };

  // Kept outside render lifecycle through a tiny indirection; AuthGate's effect owns the actual cleanup.
  const stopCloudSyncSafe = () => undefined;

  if (!user) return <Login />;
  if (checking || !cloudReady) {
    return (
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg mb-5"><Cloud className="w-7 h-7" /></div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Preparando tu espacio</h1>
          <p className="text-sm text-slate-500 mt-2">Cargando tus datos de la nube…</p>
          <Loader2 className="w-5 h-5 animate-spin mx-auto mt-5 text-blue-600" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 p-7 text-center">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Error de conexión</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{error}</p>
          <button onClick={() => auth.signOut()} className="mt-5 px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold">Volver al inicio de sesión</button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <App />
      <div className="fixed right-4 top-4 z-[100] no-print">
        <div className="flex items-center gap-2 rounded-full bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg px-3 py-2 backdrop-blur">
          <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-[11px] font-bold">{(user.displayName || user.email || 'U')[0].toUpperCase()}</div>
          <span className="hidden sm:block text-xs font-semibold text-slate-700 dark:text-slate-200 max-w-[180px] truncate">{user.email}</span>
          <button onClick={logout} title="Cerrar sesión" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-rose-600"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
};
