import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { LogOut, Cloud, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import App from '../App';
import { Login } from './Login';
import { auth } from '../src/lib/firebase';
import { loadUserCloudState, uploadExistingLocalState, startUserCloudSync } from '../src/lib/userCloudStore';

const getCloudErrorMessage = (err: any) => {
  const code = String(err?.code || '').toLowerCase();
  if (code.includes('permission-denied')) {
    return 'La sesión es correcta, pero Firestore ha rechazado el acceso. Comprueba las reglas de seguridad de la base de datos.';
  }
  if (code.includes('unavailable') || code.includes('network')) {
    return 'La sesión es correcta, pero la base de datos no está disponible temporalmente. Tus cambios se conservarán localmente y se intentará sincronizar de nuevo.';
  }
  return 'La sesión es correcta, pero no se ha podido preparar la sincronización con la nube. Puedes continuar trabajando y volver a intentarlo.';
};

export const AuthGate: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const stopCloudSyncRef = useRef<(() => void) | null>(null);

  const prepareCloud = async (currentUser: User) => {
    setChecking(true);
    setCloudError(null);

    try {
      const previousUid = localStorage.getItem('personasPROFEA_activeUid');
      if (previousUid && previousUid !== currentUser.uid) {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith('personasPROFEA') ||
              ['obrasGuardadas', 'lugaresFormacion', 'sitiosReconocimiento', 'telefonosGuardados', 'categoriasGuardadas', 'workStartHour', 'workEndHour'].includes(key))
          ) {
            localStorage.removeItem(key);
          }
        }
      }

      localStorage.setItem('personasPROFEA_activeUid', currentUser.uid);

      const result = await loadUserCloudState(currentUser.uid);
      if (!result.hasCloudData) {
        await uploadExistingLocalState(currentUser.uid);
      }
    } catch (err: any) {
      console.error('[PROFEA Cloud] Error preparando cuenta:', err?.code || err, err);
      setCloudError(getCloudErrorMessage(err));
    }

    // Authentication must never be blocked by a cloud/database outage.
    try {
      if (stopCloudSyncRef.current) stopCloudSyncRef.current();
      stopCloudSyncRef.current = startUserCloudSync(currentUser.uid);
    } catch (err: any) {
      console.error('[PROFEA Cloud] Error iniciando sincronización:', err?.code || err, err);
      setCloudError(getCloudErrorMessage(err));
    } finally {
      setCloudReady(true);
      setChecking(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (cancelled) return;
      setUser(currentUser);
      setCloudReady(false);
      setCloudError(null);

      if (stopCloudSyncRef.current) {
        stopCloudSyncRef.current();
        stopCloudSyncRef.current = null;
      }

      if (!currentUser) {
        setChecking(false);
        return;
      }

      await prepareCloud(currentUser);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (stopCloudSyncRef.current) stopCloudSyncRef.current();
    };
  }, []);

  const logout = async () => {
    if (stopCloudSyncRef.current) {
      stopCloudSyncRef.current();
      stopCloudSyncRef.current = null;
    }
    await auth.signOut();
  };

  const retryCloud = async () => {
    if (user) await prepareCloud(user);
  };

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

  return (
    <div className="min-h-screen">
      <App />

      {cloudError && (
        <div className="fixed left-4 right-4 sm:left-auto sm:right-4 top-4 z-[110] no-print max-w-md">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/90 shadow-xl p-4 backdrop-blur">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Sesión iniciada correctamente</p>
                <p className="text-xs leading-5 text-amber-800 dark:text-amber-200 mt-1">{cloudError}</p>
                <button
                  onClick={retryCloud}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reintentar sincronización
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
