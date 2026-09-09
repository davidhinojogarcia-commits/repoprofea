import React, { useState } from 'react';
import { 
  Cloud, Calendar, Clock, CheckCircle2, AlertTriangle, RefreshCw, 
  Play, FileArchive, FolderOpen, ShieldCheck, Mail, HardDrive,
  Check, LogIn, Sparkles, ChevronDown, ChevronUp, History, Info
} from 'lucide-react';
import { 
  DriveAutoBackupConfig, 
  BackupFrequency 
} from '../src/lib/driveBackup';

interface DriveAutoBackupSettingsProps {
  config: DriveAutoBackupConfig;
  onChangeConfig: (newConfig: DriveAutoBackupConfig) => void;
  googleUser: any;
  googleToken: string | null;
  onGoogleLogin: () => void;
  onExecuteBackupNow: () => Promise<void>;
  isBackingUpNow: boolean;
}

export const DriveAutoBackupSettings: React.FC<DriveAutoBackupSettingsProps> = ({
  config,
  onChangeConfig,
  googleUser,
  googleToken,
  onGoogleLogin,
  onExecuteBackupNow,
  isBackingUpNow
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [customEmailInput, setCustomEmailInput] = useState(config.targetAccountEmail || '');
  const [isSavedEmail, setIsSavedEmail] = useState(true);

  const activeEmail = (googleUser?.email || '').trim().toLowerCase();
  const targetEmail = (config.targetAccountEmail || '').trim().toLowerCase();
  const isAccountMatched = Boolean(activeEmail && targetEmail && activeEmail === targetEmail);
  const hasNoTarget = !targetEmail;

  const handleToggleEnabled = (enabled: boolean) => {
    // If enabling and no target email is set yet, default to current Google account if available
    let nextTarget = config.targetAccountEmail;
    if (enabled && !nextTarget && activeEmail) {
      nextTarget = activeEmail;
      setCustomEmailInput(activeEmail);
    }
    onChangeConfig({
      ...config,
      enabled,
      targetAccountEmail: nextTarget
    });
  };

  const handleSaveTargetEmail = (emailToSave: string) => {
    const clean = emailToSave.trim().toLowerCase();
    onChangeConfig({
      ...config,
      targetAccountEmail: clean
    });
    setCustomEmailInput(clean);
    setIsSavedEmail(true);
  };

  const handleFrequencyChange = (freq: BackupFrequency) => {
    onChangeConfig({
      ...config,
      frequency: freq
    });
  };

  const handleHourChange = (hour: number) => {
    onChangeConfig({
      ...config,
      hourOfDay: hour
    });
  };

  const handleDayOfWeekChange = (day: number) => {
    onChangeConfig({
      ...config,
      dayOfWeek: day
    });
  };

  const handleFormatChange = (compressGzip: boolean) => {
    onChangeConfig({
      ...config,
      compressGzip
    });
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return 'Nunca';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  const daysOfWeek = [
    { value: 1, label: 'Lunes' },
    { value: 2, label: 'Martes' },
    { value: 3, label: 'Miércoles' },
    { value: 4, label: 'Jueves' },
    { value: 5, label: 'Viernes' },
    { value: 6, label: 'Sábado' },
    { value: 0, label: 'Domingo' }
  ];

  return (
    <div className="space-y-6">
      {/* Main Switch Card */}
      <div className={`p-6 rounded-2xl border transition-all ${
        config.enabled 
          ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/60 shadow-sm' 
          : 'bg-slate-50/70 dark:bg-slate-850/30 border-slate-200 dark:border-slate-800'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-xl ${
                config.enabled 
                  ? 'bg-blue-600 text-white shadow-xs' 
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  Copias de Seguridad Automáticas a Google Drive
                  {config.enabled && (
                    <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 rounded-full">
                      Programada
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Guarda periódicamente en segundo plano una copia íntegra de trabajadores, histórico, obras y configuración en una cuenta de Google Drive.
                </p>
              </div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              id="switch-drive-auto-backup"
              className="sr-only peer"
              checked={config.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <div className="w-12 h-6.5 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500/20 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5.5 after:w-5.5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>

      {config.enabled && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Account Configuration Box */}
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Cuenta de Google Drive Específica
              </h4>
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                Destino exclusivo de las copias
              </span>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                Indique la dirección de correo de la cuenta de Google donde desea que se alojen automáticamente todas las copias de seguridad de PROFEA:
              </p>

              <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
                <div className="relative flex-1">
                  <input
                    type="email"
                    id="input-drive-target-email"
                    value={customEmailInput}
                    onChange={(e) => {
                      setCustomEmailInput(e.target.value);
                      setIsSavedEmail(false);
                    }}
                    placeholder="ejemplo@gmail.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>

                <button
                  type="button"
                  onClick={() => handleSaveTargetEmail(customEmailInput)}
                  disabled={isSavedEmail || !customEmailInput.trim()}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  Guardar Cuenta
                </button>

                {activeEmail && activeEmail !== targetEmail && (
                  <button
                    type="button"
                    onClick={() => handleSaveTargetEmail(activeEmail)}
                    className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 border border-slate-200 dark:border-slate-700"
                    title={`Establecer ${activeEmail} como cuenta de destino`}
                  >
                    Usar {activeEmail}
                  </button>
                )}
              </div>

              {/* Status Verification Card */}
              <div className="pt-2">
                {hasNoTarget ? (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 flex items-center gap-3 text-xs text-amber-800 dark:text-amber-300 font-medium">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Por favor, introduce y guarda la dirección de correo de Google Drive donde deseas recibir las copias.</span>
                  </div>
                ) : !googleToken ? (
                  <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-start gap-2.5 text-amber-800 dark:text-amber-300 font-medium">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-bold">Autorización pendiente con Google Drive</strong>
                        Debe iniciar sesión con <span className="underline font-mono font-bold">{targetEmail}</span> para autorizar las subidas en segundo plano.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onGoogleLogin}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer shrink-0 transition-colors"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      Conectar {targetEmail}
                    </button>
                  </div>
                ) : !isAccountMatched ? (
                  <div className="p-4 rounded-xl bg-orange-50/70 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-start gap-2.5 text-orange-800 dark:text-orange-300 font-medium">
                      <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-bold">Sesión activa distinta de la cuenta destino</strong>
                        Actualmente está conectado como <span className="font-mono font-bold underline">{activeEmail}</span>, pero ha configurado como destino <span className="font-mono font-bold underline">{targetEmail}</span>.
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={onGoogleLogin}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer transition-colors"
                      >
                        Cambiar a {targetEmail}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveTargetEmail(activeEmail)}
                        className="inline-flex items-center justify-center px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 font-bold rounded-lg text-xs cursor-pointer hover:bg-slate-50 transition-colors"
                      >
                        Usar {activeEmail}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <div className="flex items-center gap-2 font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Conexión verificada y autorizada con la cuenta destino: <strong className="font-mono">{targetEmail}</strong></span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 rounded-md">
                      Listo para backup
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Scheduling Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Frequency Configuration */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Frecuencia de las Copias
              </h4>

              <div className="space-y-2">
                {[
                  { id: 'daily', label: 'Diaria (Recomendado)', desc: 'Una vez al día a la hora estipulada' },
                  { id: 'every_6h', label: 'Cada 6 Horas', desc: 'Cuatro copias automáticas al día' },
                  { id: 'every_12h', label: 'Cada 12 Horas', desc: 'Dos copias automáticas al día' },
                  { id: 'weekly', label: 'Semanal', desc: 'Una vez a la semana el día elegido' }
                ].map((item) => (
                  <label 
                    key={item.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all select-none ${
                      config.frequency === item.id 
                        ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200 shadow-xs' 
                        : 'bg-slate-50/50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="backup-frequency"
                      checked={config.frequency === item.id}
                      onChange={() => handleFrequencyChange(item.id as BackupFrequency)}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="text-xs">
                      <span className="font-bold block">{item.label}</span>
                      <span className="text-slate-500 dark:text-slate-400 text-[11px]">{item.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Time & Day Picker */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Hora y Día de Ejecución
              </h4>

              <div className="space-y-4">
                {/* Hour selection */}
                {(config.frequency === 'daily' || config.frequency === 'weekly') && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Hora de ejecución programada
                    </label>
                    <select
                      value={config.hourOfDay ?? 20}
                      onChange={(e) => handleHourChange(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      {Array.from({ length: 24 }).map((_, h) => {
                        const formatted = `${String(h).padStart(2, '0')}:00`;
                        return (
                          <option key={h} value={h}>
                            {formatted} {h === 20 ? '(Por defecto - Cierre de jornada)' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                      Si la aplicación está abierta a esa hora, la copia se subirá automáticamente en segundo plano.
                    </p>
                  </div>
                )}

                {/* Day selection if weekly */}
                {config.frequency === 'weekly' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Día de la semana
                    </label>
                    <select
                      value={config.dayOfWeek ?? 5}
                      onChange={(e) => handleDayOfWeekChange(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      {daysOfWeek.map((d) => (
                        <option key={d.value} value={d.value}>
                          Cada {d.label} {d.value === 5 ? '(Recomendado - Fin de semana)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Format selection */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                    Formato de Archivo en Google Drive
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleFormatChange(true)}
                      className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                        config.compressGzip 
                          ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-200 font-bold' 
                          : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <span className="block font-bold">.json.gz (Comprimido)</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Ahorra 85% de espacio</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFormatChange(false)}
                      className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                        !config.compressGzip 
                          ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-200 font-bold' 
                          : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <span className="block font-bold">.json (Estándar)</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Texto plano legible</span>
                    </button>
                  </div>
                </div>

                {/* Folder destination badge */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Carpeta en Drive: <strong className="text-slate-800 dark:text-slate-200">Mi unidad &gt; PROFEA_Cádiz &gt; Copias_Seguridad</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Backup Status & Manual Trigger Action Card */}
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                  ESTADO DE LA ÚLTIMA COPIA DE SEGURIDAD
                </span>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${
                    config.lastBackupStatus === 'success' 
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' 
                      : config.lastBackupStatus === 'error'
                      ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}>
                    {config.lastBackupStatus === 'success' ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : config.lastBackupStatus === 'error' ? (
                      <AlertTriangle className="w-5 h-5" />
                    ) : (
                      <Clock className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {config.lastBackupDate 
                        ? `Última copia: ${formatDate(config.lastBackupDate)}` 
                        : 'Aún no se ha realizado ninguna copia'}
                    </h5>
                    {config.lastBackupFileName && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                        {config.lastBackupFileName} ({formatFileSize(config.lastBackupSize || 0)})
                      </p>
                    )}
                    {config.lastBackupMessage && (
                      <p className={`text-[11px] mt-0.5 ${
                        config.lastBackupStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-500'
                      }`}>
                        {config.lastBackupMessage}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  id="btn-force-drive-backup-now"
                  onClick={onExecuteBackupNow}
                  disabled={isBackingUpNow || !googleToken}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Subir inmediatamente una copia completa a la carpeta de Google Drive"
                >
                  {isBackingUpNow ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Subiendo a Google Drive...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Hacer Copia en Google Drive Ahora
                    </>
                  )}
                </button>

                {config.history && config.history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHistory(!showHistory)}
                    className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-all border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5" />
                    Historial ({config.history.length})
                    {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* History Table Dropdown */}
            {showHistory && config.history && config.history.length > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <h6 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                  Registro de Copias Automáticas Recientes en Google Drive:
                </h6>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-[11px]">
                        <th className="py-2 px-3 font-semibold">Fecha y Hora</th>
                        <th className="py-2 px-3 font-semibold">Archivo</th>
                        <th className="py-2 px-3 font-semibold">Tamaño</th>
                        <th className="py-2 px-3 font-semibold">Cuenta Destino</th>
                        <th className="py-2 px-3 font-semibold text-right">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {config.history.map((h, hIdx) => (
                        <tr key={`drive_hist_${h.id || 'entry'}_${hIdx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{formatDate(h.date)}</td>
                          <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400">{h.fileName}</td>
                          <td className="py-2 px-3 text-slate-500">{formatFileSize(h.fileSize)}</td>
                          <td className="py-2 px-3 text-slate-500">{h.accountEmail || '-'}</td>
                          <td className="py-2 px-3 text-right">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              h.status === 'success' 
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' 
                                : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'
                            }`}>
                              {h.status === 'success' ? 'Completada' : 'Error'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
