import React, { useState, useEffect } from 'react';
import { 
  Cloud, 
  CloudOff, 
  RefreshCw, 
  Check, 
  AlertCircle,
  Copy,
  Smartphone,
  Laptop,
  Monitor,
  Tablet,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Mail,
  ArrowRight,
  ExternalLink,
  Users,
  HardHat,
  Building2,
  FolderSync,
  Clock,
  LogIn,
  LogOut,
  QrCode,
  Shield
} from 'lucide-react';
import { Person, DeletedPerson } from '../types';
import { DeviceSession, Workspace } from '../src/lib/firebase';

interface SincronizacionProps {
  syncEmail?: string;
  onUpdateSyncEmail?: (email: string) => Promise<void>;
  onDisconnectSyncEmail?: () => Promise<void>;
  googleUser: any;
  onGoogleLogin: () => Promise<void>;
  onGoogleLogout: () => Promise<void>;
  isOffline: boolean;
  people: Person[];
  deletedPeople: DeletedPerson[];
  savedObras: string[];
  savedCategorias?: string[];
  subcontratasCount?: number;
  sessions: DeviceSession[];
  currentSessionId: string;
  lastSyncTime: Date | null;
  isSyncingNow: boolean;
  onForceSyncNow: () => Promise<void>;
  onToast: (msg: string, type: 'success' | 'error') => void;
  // Legacy optional props for backward compatibility
  activeWorkspace?: Workspace | null;
  sharedWorkspaces?: Workspace[];
  onSelectWorkspace?: (workspaceId: string) => Promise<void>;
  onAddMember?: (email: string, role: 'editor' | 'viewer') => Promise<void>;
  onUpdateMemberRole?: (email: string, newRole: 'editor' | 'viewer') => Promise<void>;
  onRemoveMember?: (email: string) => Promise<void>;
  onJoinWorkspaceByCodeOrEmail?: (codeOrEmail: string) => Promise<boolean>;
  onUploadAllLocalToAccount?: () => Promise<void>;
  onDownloadAllFromAccount?: () => Promise<void>;
}

export const Sincronizacion: React.FC<SincronizacionProps> = ({
  syncEmail = '',
  onUpdateSyncEmail,
  onDisconnectSyncEmail,
  googleUser,
  onGoogleLogin,
  onGoogleLogout,
  isOffline,
  people,
  deletedPeople,
  savedObras,
  savedCategorias = [],
  subcontratasCount = 0,
  sessions,
  currentSessionId,
  lastSyncTime,
  isSyncingNow,
  onForceSyncNow,
  onToast
}) => {
  // Current active email (from Google auth or manually configured syncEmail)
  const currentEmail = (googleUser?.email || syncEmail || '').trim().toLowerCase();
  const isConnected = !!currentEmail && !isOffline;

  const [inputEmail, setInputEmail] = useState(currentEmail || 'davidhinojogarcia@gmail.com');
  const [isEditingEmail, setIsEditingEmail] = useState(!currentEmail);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQr, setShowQr] = useState(false);

  // Sync internal input when currentEmail updates from outside
  useEffect(() => {
    if (currentEmail) {
      setInputEmail(currentEmail);
      setIsEditingEmail(false);
    }
  }, [currentEmail]);

  // Handle saving new email
  const handleConnectEmail = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = inputEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@') || !clean.includes('.')) {
      onToast('Por favor, introduce un correo electrónico válido.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      if (onUpdateSyncEmail) {
        await onUpdateSyncEmail(clean);
      } else {
        localStorage.setItem('personasPROFEA_syncEmail', clean);
        await onForceSyncNow();
      }
      setIsEditingEmail(false);
      onToast(`Sincronización vinculada correctamente con ${clean}`, 'success');
    } catch (err) {
      console.error(err);
      onToast('Error al conectar la sincronización.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (confirm(`¿Deseas desvincular la sincronización del correo ${currentEmail} en este dispositivo? Tus datos locales no se borrarán.`)) {
      if (onDisconnectSyncEmail) {
        await onDisconnectSyncEmail();
      } else {
        localStorage.removeItem('personasPROFEA_syncEmail');
      }
      setIsEditingEmail(true);
      onToast('Sincronización desvinculada en este dispositivo.', 'success');
    }
  };

  const shareableUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?syncEmail=${encodeURIComponent(currentEmail)}`
    : '';

  const handleCopyShareLink = () => {
    if (!shareableUrl) return;
    navigator.clipboard.writeText(shareableUrl);
    setCopiedLink(true);
    onToast('Enlace directo copiado al portapapeles. Ábrelo en tu móvil.', 'success');
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const formatLastSync = (date: Date | null) => {
    if (!date) return 'Pendiente de sincronizar';
    const now = new Date();
    const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSecs < 10) return 'Hace unos segundos';
    if (diffSecs < 60) return `Hace ${diffSecs} segundos`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `Hace ${diffMins} min`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{isConnected ? 'Sincronización Multidispositivo Activa' : 'Sincronización Pendiente'}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              Sincronización en Tiempo Real
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              Introduce tu correo electrónico para que aparezcan exactamente los mismos datos en todos tus dispositivos (ordenador, teléfono móvil y tablet). Cualquier cambio se actualizará al instante.
            </p>
          </div>

          {/* Quick Action Button */}
          {isConnected && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                id="btn-forzar-sincronizacion"
                onClick={() => onForceSyncNow()}
                disabled={isSyncingNow || isOffline}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium text-sm rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Comprobar y forzar actualización inmediata de todos los datos en la nube"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncingNow ? 'animate-spin' : ''}`} />
                <span>{isSyncingNow ? 'Sincronizando...' : 'Sincronizar Ahora'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Email Connection Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Tu Correo de Sincronización
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                La clave única para vincular todos tus teléfonos, tablets y ordenadores
              </p>
            </div>
          </div>

          {currentEmail && !isEditingEmail && (
            <button
              onClick={() => setIsEditingEmail(true)}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline cursor-pointer"
            >
              Cambiar correo
            </button>
          )}
        </div>

        {/* If user has an active email and is not currently editing */}
        {currentEmail && !isEditingEmail ? (
          <div className="space-y-6">
            <div className="p-5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Dispositivo Vinculado y Activo
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200">
                      Nube Conectada
                    </span>
                  </div>
                  <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {currentEmail}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Última sincronización: <span className="font-semibold text-slate-700 dark:text-slate-300">{formatLastSync(lastSyncTime)}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleDisconnect}
                  className="px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl border border-rose-200 dark:border-rose-900/60 transition-colors cursor-pointer w-full sm:w-auto text-center"
                >
                  Desvincular
                </button>
              </div>
            </div>

            {/* Google Account Status if connected via Google */}
            {googleUser && (
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  {googleUser.photoURL ? (
                    <img src={googleUser.photoURL} alt={googleUser.displayName || 'Google User'} className="w-8 h-8 rounded-full border border-slate-300 dark:border-slate-700" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                      {(googleUser.displayName || googleUser.email || 'G')[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      Sesión de Google iniciada: {googleUser.displayName || googleUser.email}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Integrado con Google Drive para copias de seguridad automáticas
                    </p>
                  </div>
                </div>

                <button
                  onClick={onGoogleLogout}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  Cerrar Google
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Form to input email */
          <form onSubmit={handleConnectEmail} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="input-sync-email" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Introduce tu correo electrónico:
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-5 h-5" />
                </div>
                <input
                  id="input-sync-email"
                  type="email"
                  value={inputEmail}
                  onChange={(e) => setInputEmail(e.target.value)}
                  placeholder="ejemplo: davidhinojogarcia@gmail.com"
                  required
                  className="w-full pl-11 pr-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Usa este mismo correo en tu móvil, tablet u ordenador de oficina para que todos muestren los mismos datos.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={isSaving || isOffline}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-bold rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Conectando con la nube...</span>
                  </>
                ) : (
                  <>
                    <Cloud className="w-4 h-4" />
                    <span>Sincronizar automáticamente con este correo</span>
                  </>
                )}
              </button>

              {!googleUser && (
                <button
                  type="button"
                  onClick={onGoogleLogin}
                  disabled={isOffline}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-sm font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  title="Conectar automáticamente usando tu cuenta de Google"
                >
                  <LogIn className="w-4 h-4 text-blue-500" />
                  <span>O conectar con Google</span>
                </button>
              )}

              {currentEmail && (
                <button
                  type="button"
                  onClick={() => {
                    setInputEmail(currentEmail);
                    setIsEditingEmail(false);
                  }}
                  className="px-4 py-3 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* How to use on other devices: 3-Step Guide */}
      <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>¿Cómo ver los mismos datos en tu móvil, tablet u otro PC?</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
            Solo necesitas introducir tu correo una única vez en cada dispositivo nuevo:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-sm">
              1
            </div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Abre la app en tu móvil
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Abre este mismo enlace en el navegador de tu teléfono o tablet.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-sm">
              2
            </div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Introduce tu correo
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Ve a la sección <strong>Sincronización</strong> y pon <span className="text-blue-600 dark:text-blue-400 font-semibold">{currentEmail || 'tu correo'}</span>.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-sm">
              3
            </div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              ¡Sincronizado al instante!
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Todos tus trabajadores, obras y subcontratas aparecerán automáticamente en tu pantalla.
            </p>
          </div>
        </div>

        {/* Quick Link Share & QR */}
        {currentEmail && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyShareLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer shadow-xs"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                <span>{copiedLink ? '¡Enlace copiado!' : 'Copiar enlace directo para móvil'}</span>
              </button>

              <button
                onClick={() => setShowQr(!showQr)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer shadow-xs"
              >
                <QrCode className="w-3.5 h-3.5 text-slate-400" />
                <span>{showQr ? 'Ocultar código QR' : 'Escanear con cámara móvil'}</span>
              </button>
            </div>

            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Cualquier cambio hecho en cualquier dispositivo se guarda en tiempo real.
            </span>
          </div>
        )}

        {/* QR Display */}
        {showQr && shareableUrl && (
          <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row items-center gap-6 justify-center text-center sm:text-left">
            <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-xs">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(shareableUrl)}`}
                alt="QR Code Sincronización"
                className="w-32 h-32"
              />
            </div>
            <div className="space-y-1 max-w-sm">
              <p className="text-xs font-bold text-slate-900 dark:text-white">
                Escanea con la cámara de tu móvil
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Abrirá la aplicación en tu teléfono con tu correo <span className="font-semibold text-blue-600 dark:text-blue-400">{currentEmail}</span> ya configurado para que sincronice en el acto.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Synchronized Data Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
            <Users className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Trabajadores</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {people.length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Sincronizados en la nube
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
            <Building2 className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Obras PFEA</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {savedObras.length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Catálogo compartido
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
            <HardHat className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Subcontratas CAE</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {subcontratasCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Expedientes vigentes
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
            <Trash2 className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Papelera</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {deletedPeople.length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Histórico recuperable
          </p>
        </div>
      </div>

      {/* Connected Devices Real-Time List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Laptop className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span>Tus Dispositivos Conectados ({sessions.length > 0 ? sessions.length : 1})</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dispositivos que están compartiendo tus datos en tiempo real bajo tu correo
            </p>
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>En vivo</span>
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {sessions && sessions.length > 0 ? (
            sessions.map((session, sIdx) => {
              const isCurrent = session.id === currentSessionId;
              const isPhone = session.deviceName.toLowerCase().includes('android') || 
                              session.deviceName.toLowerCase().includes('ios') || 
                              session.deviceName.toLowerCase().includes('iphone');
              const isMacOrWin = session.deviceName.toLowerCase().includes('windows') || 
                                 session.deviceName.toLowerCase().includes('mac');

              return (
                <div key={`sess_${session.id}_${sIdx}`} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                      {isPhone ? <Smartphone className="w-5 h-5" /> : isMacOrWin ? <Laptop className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          {session.deviceName}
                        </span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                            Este dispositivo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {session.userEmail || currentEmail} · Activo {new Date(session.lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>

                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Conectado y sincronizando" />
                </div>
              );
            })
          ) : (
            <div className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                  <Laptop className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      Este navegador / dispositivo
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                      Sesión activa
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {currentEmail || 'davidhinojogarcia@gmail.com'} · Conectado a la nube
                  </p>
                </div>
              </div>

              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Conectado" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
