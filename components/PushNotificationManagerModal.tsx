import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  BellOff, 
  BellRing, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  ShieldCheck, 
  Send, 
  Calendar, 
  Clock, 
  FileText, 
  User, 
  Building2, 
  Sparkles, 
  RefreshCw,
  Info
} from 'lucide-react';
import { Person } from '../types';
import { 
  requestNotificationPermission, 
  sendLocalSWNotification, 
  checkAndTriggerUpcomingAlerts, 
  getNotificationPreferences, 
  saveNotificationPreferences, 
  getSWRegistrationInfo, 
  getNotificationAlertsSummary,
  NotificationPreferences, 
  SWRegistrationState 
} from '../src/lib/pushNotifications';

interface PushNotificationManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  people: Person[];
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const PushNotificationManagerModal: React.FC<PushNotificationManagerModalProps> = ({
  isOpen,
  onClose,
  people,
  onToast
}) => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [swState, setSwState] = useState<SWRegistrationState | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences>(getNotificationPreferences());
  const [activeTab, setActiveTab] = useState<'summary' | 'citas_vencidas' | 'citas_hoy' | 'contratos_vencidos' | 'contratos_proximos'>('summary');
  const [isProcessing, setIsProcessing] = useState(false);

  // Load SW status & Notification Permission on modal open
  useEffect(() => {
    if (!isOpen) return;

    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification) {
      setPermission(window.Notification.permission);
    }

    getSWRegistrationInfo().then(info => {
      setSwState(info);
    });

    setPrefs(getNotificationPreferences());
  }, [isOpen]);

  if (!isOpen) return null;

  const alertsSummary = getNotificationAlertsSummary(people);

  const handleRequestPermission = async () => {
    setIsProcessing(true);
    try {
      const perm = await requestNotificationPermission();
      setPermission(perm);
      if (perm === 'granted') {
        onToast('Permisos de notificaciones push concedidos con éxito', 'success');
        await sendLocalSWNotification(
          '🔔 Notificaciones Push Activas',
          'El sistema PROFEA enviará alertas en segundo plano sobre citaciones médicas y fin de contratos.',
          'profea-activation'
        );
      } else if (perm === 'denied') {
        onToast('El navegador ha bloqueado el permiso de notificaciones', 'error');
      }
    } catch (err) {
      onToast('Error solicitando permiso de notificación', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTestNotification = async () => {
    setIsProcessing(true);
    try {
      const sent = await sendLocalSWNotification(
        '🩺 Prueba de Notificación Service Worker',
        'Notificación enviada correctamente a través del Service Worker de la Diputación de Cádiz.',
        'profea-test'
      );
      if (sent) {
        onToast('Notificación de prueba enviada', 'success');
      } else {
        onToast('No se pudo enviar la notificación. Verifique permisos.', 'error');
      }
    } catch (err) {
      onToast('Error al enviar la notificación de prueba', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTriggerManualAlerts = async () => {
    setIsProcessing(true);
    try {
      const result = await checkAndTriggerUpcomingAlerts(people, true);
      if (result.notificacionesEnviadas > 0) {
        onToast(`Se han enviado ${result.notificacionesEnviadas} notificaciones push al navegador`, 'success');
      } else {
        onToast('Análisis completado. No se generaron notificaciones nuevas o los permisos no están habilitados.', 'info');
      }
    } catch (err) {
      onToast('Error ejecutando la revisión de alertas', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTogglePref = (key: keyof NotificationPreferences) => {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    saveNotificationPreferences(updated);
    onToast('Preferencia de alertas actualizada', 'info');
  };

  const handleSendSingleAlert = async (person: Person, type: 'cita' | 'contrato') => {
    let title = '';
    let body = '';
    let tag = '';

    if (type === 'cita') {
      title = `🩺 Alerta Cita Médica: ${person.apellidosNombre}`;
      body = `Cita programada el ${person.citaDia || 'S/F'} a las ${person.citaHora || 'S/H'} en ${person.sitioReconocimiento || 'Centro Médico'}. Obra: ${person.obra || 'N/A'}.`;
      tag = `manual-cita-${person.id}`;
    } else {
      title = `📄 Alerta Fin de Contrato: ${person.apellidosNombre}`;
      body = `El contrato en la obra ${person.obra || 'N/A'} finaliza el ${person.periodoFin || 'S/F'}.`;
      tag = `manual-contrato-${person.id}`;
    }

    const ok = await sendLocalSWNotification(title, body, tag);
    if (ok) {
      onToast(`Notificación enviada para ${person.apellidosNombre}`, 'success');
    } else {
      onToast('Debe otorgar permisos de notificaciones push en el navegador primero', 'error');
    }
  };

  return (
    <div className="profea-notifications-overlay fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-md overflow-y-auto no-print" role="dialog" aria-modal="true" aria-labelledby="profea-notifications-title">
      <div className="profea-notifications-dialog relative w-full max-w-4xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col my-8 max-h-[90vh]">
        
        {/* Header Modal */}
        <div className="profea-notifications-header px-6 py-5 bg-gradient-to-r from-slate-900 via-[#00548E] to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/20">
              <BellRing className="w-6 h-6 text-amber-300 animate-bounce" />
            </div>
            <div>
              <h3 id="profea-notifications-title" className="text-lg font-black tracking-wide">Gestión de Notificaciones Push</h3>
              <p className="text-xs text-blue-100 font-medium">Alertas proactivas en navegador para Citas Médicas y Fines de Contrato</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            title="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="profea-notifications-body p-6 overflow-y-auto space-y-6 custom-scrollbar bg-slate-50 dark:bg-slate-950/60">
          
          {/* Permission Status Banner */}
          <div className="profea-notifications-permission bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              {permission === 'granted' ? (
                <div className="p-3 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-2xl shrink-0">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
              ) : permission === 'denied' ? (
                <div className="p-3 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-2xl shrink-0">
                  <BellOff className="w-7 h-7" />
                </div>
              ) : (
                <div className="p-3 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-2xl shrink-0">
                  <Bell className="w-7 h-7 animate-pulse" />
                </div>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    Estado de Permiso: {' '}
                    <span className={
                      permission === 'granted' ? 'text-emerald-600 dark:text-emerald-400 font-black' :
                      permission === 'denied' ? 'text-rose-600 dark:text-rose-400 font-black' :
                      'text-amber-600 dark:text-amber-400 font-black'
                    }>
                      {permission === 'granted' ? 'PERMITIDO (Activo)' : permission === 'denied' ? 'BLOQUEADO' : 'PENDIENTE'}
                    </span>
                  </h4>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {permission === 'granted'
                    ? 'El navegador tiene autorización para mostrar alertas en segundo plano cuando expiren citas médicas o contratos.'
                    : permission === 'denied'
                    ? 'El navegador tiene bloqueadas las notificaciones para esta web. Debes activarlas en la barra de direcciones (icono de candado) si deseas recibir avisos.'
                    : 'Haz clic en el botón para otorgar permiso al navegador y empezar a recibir alertas en segundo plano.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto shrink-0 justify-end">
              {permission !== 'granted' && (
                <button
                  onClick={handleRequestPermission}
                  disabled={isProcessing}
                  className="px-4 py-2.5 bg-brand-primary hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <BellRing className="w-4 h-4" />
                  Activar Permisos Push
                </button>
              )}

              {permission === 'granted' && (
                <button
                  onClick={handleTestNotification}
                  disabled={isProcessing}
                  className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Probar Push SW
                </button>
              )}

              <button
                onClick={handleTriggerManualAlerts}
                disabled={isProcessing}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs hover:scale-105 active:scale-95 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                Verificar Avisos Ahora
              </button>
            </div>
          </div>

          {/* Diagnostics Bar */}
          <div className="profea-notifications-diagnostics bg-slate-100 dark:bg-slate-900/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between text-xs gap-3">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
              <ShieldCheck className="w-4 h-4 text-brand-primary dark:text-blue-400 shrink-0" />
              <span>
                <strong>Service Worker:</strong> {swState?.active ? '✅ Activo y Escuchando' : swState?.registered ? '⏳ Registrado' : '⚠️ No Detectado'}
              </span>
              {swState?.scope && (
                <span className="text-[10px] font-mono text-slate-500 bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded">
                  {swState.scope}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-slate-500 text-[11px]">
              <Info className="w-3.5 h-3.5 text-slate-400" />
              <span>Las notificaciones se emiten a través de la API Web Notification del Service Worker.</span>
            </div>
          </div>

          {/* Preferences Section */}
          <div className="profea-notifications-preferences bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Configuración de Alertas Proactivas
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              
              {/* Citas Vencidas Switch */}
              <label className="profea-notifications-option flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-lg">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Citas Médicas VENCIDAS</span>
                    <span className="text-[11px] text-slate-500 block">Notificar citas pasadas no atendidas</span>
                  </div>
                </div>
                <input 
                  type="checkbox" 
                  checked={prefs.alertCitasVencidas}
                  onChange={() => handleTogglePref('alertCitasVencidas')}
                  className="w-4 h-4 text-brand-primary rounded focus:ring-brand-primary cursor-pointer accent-brand-primary"
                />
              </label>

              {/* Citas Hoy y Mañana Switch */}
              <label className="profea-notifications-option flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-lg">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Citas de HOY y MAÑANA</span>
                    <span className="text-[11px] text-slate-500 block">Alertar citaciones médicas inminentes</span>
                  </div>
                </div>
                <input 
                  type="checkbox" 
                  checked={prefs.alertCitasHoyManana}
                  onChange={() => handleTogglePref('alertCitasHoyManana')}
                  className="w-4 h-4 text-brand-primary rounded focus:ring-brand-primary cursor-pointer accent-brand-primary"
                />
              </label>

              {/* Contratos Vencidos Switch */}
              <label className="profea-notifications-option flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-lg">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Contratos VENCIDOS</span>
                    <span className="text-[11px] text-slate-500 block">Notificar trabajadores con contrato expirado</span>
                  </div>
                </div>
                <input 
                  type="checkbox" 
                  checked={prefs.alertContratosVencidos}
                  onChange={() => handleTogglePref('alertContratosVencidos')}
                  className="w-4 h-4 text-brand-primary rounded focus:ring-brand-primary cursor-pointer accent-brand-primary"
                />
              </label>

              {/* Contratos Próximos Switch */}
              <label className="profea-notifications-option flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-lg">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Fines de Contrato Próximos</span>
                    <span className="text-[11px] text-slate-500 block">Alertar contrataciones a punto de vencer (3 días)</span>
                  </div>
                </div>
                <input 
                  type="checkbox" 
                  checked={prefs.alertContratosProximos}
                  onChange={() => handleTogglePref('alertContratosProximos')}
                  className="w-4 h-4 text-brand-primary rounded focus:ring-brand-primary cursor-pointer accent-brand-primary"
                />
              </label>

            </div>
          </div>

          {/* Active Alerts Cards Metrics & Filterable List */}
          <div className="space-y-4">
            
            {/* Cards metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button 
                onClick={() => setActiveTab('citas_vencidas')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  activeTab === 'citas_vencidas' 
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 ring-2 ring-rose-400' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Citas Vencidas</span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-xl font-black text-rose-600 dark:text-rose-400">{alertsSummary.citasVencidas.length}</span>
                  <span className="text-xs text-slate-500">alertas</span>
                </div>
              </button>

              <button 
                onClick={() => setActiveTab('citas_hoy')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  activeTab === 'citas_hoy' 
                    ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 ring-2 ring-blue-400' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Citas Hoy / Mañana</span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-xl font-black text-blue-600 dark:text-blue-400">{alertsSummary.citasHoy.length + alertsSummary.citasManana.length}</span>
                  <span className="text-xs text-slate-500">alertas</span>
                </div>
              </button>

              <button 
                onClick={() => setActiveTab('contratos_vencidos')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  activeTab === 'contratos_vencidos' 
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 ring-2 ring-amber-400' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Contratos Vencidos</span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-xl font-black text-amber-600 dark:text-amber-400">{alertsSummary.contratosVencidos.length}</span>
                  <span className="text-xs text-slate-500">alertas</span>
                </div>
              </button>

              <button 
                onClick={() => setActiveTab('contratos_proximos')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  activeTab === 'contratos_proximos' 
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 ring-2 ring-emerald-400' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Fin Próximo (3 d)</span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">{alertsSummary.contratosProximos.length}</span>
                  <span className="text-xs text-slate-500">alertas</span>
                </div>
              </button>
            </div>

            {/* List Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveTab('summary')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === 'summary'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Resumen de Alertas ({alertsSummary.totalAlertas})
              </button>
              <button
                onClick={() => setActiveTab('citas_vencidas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === 'citas_vencidas'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100'
                }`}
              >
                🔴 Citas Vencidas ({alertsSummary.citasVencidas.length})
              </button>
              <button
                onClick={() => setActiveTab('citas_hoy')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === 'citas_hoy'
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 hover:bg-blue-100'
                }`}
              >
                🩺 Citas Hoy/Mañana ({alertsSummary.citasHoy.length + alertsSummary.citasManana.length})
              </button>
              <button
                onClick={() => setActiveTab('contratos_vencidos')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === 'contratos_vencidos'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100'
                }`}
              >
                ⛔ Contratos Vencidos ({alertsSummary.contratosVencidos.length})
              </button>
              <button
                onClick={() => setActiveTab('contratos_proximos')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === 'contratos_proximos'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100'
                }`}
              >
                📄 Fines Próximos ({alertsSummary.contratosProximos.length})
              </button>
            </div>

            {/* Render Tab Contents */}
            <div className="space-y-3">
              {activeTab === 'summary' && (
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
                  <h5 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                    Resumen del Diagnóstico de Alertas
                  </h5>
                  {alertsSummary.totalAlertas === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">¡Todo al día!</p>
                      <p className="text-xs text-slate-500 mt-1">No hay citaciones médicas ni contratos vencidos ni próximos a vencer.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      {alertsSummary.citasVencidas.length > 0 && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-xl flex items-center justify-between">
                          <span className="font-semibold text-rose-800 dark:text-rose-300">
                            🔴 {alertsSummary.citasVencidas.length} Cita(s) médica(s) vencida(s)
                          </span>
                          <button 
                            onClick={() => setActiveTab('citas_vencidas')}
                            className="text-rose-700 dark:text-rose-400 font-bold underline cursor-pointer"
                          >
                            Ver afectadas
                          </button>
                        </div>
                      )}

                      {(alertsSummary.citasHoy.length > 0 || alertsSummary.citasManana.length > 0) && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 rounded-xl flex items-center justify-between">
                          <span className="font-semibold text-blue-800 dark:text-blue-300">
                            🩺 {alertsSummary.citasHoy.length} cita(s) HOY y {alertsSummary.citasManana.length} MAÑANA
                          </span>
                          <button 
                            onClick={() => setActiveTab('citas_hoy')}
                            className="text-blue-700 dark:text-blue-400 font-bold underline cursor-pointer"
                          >
                            Ver citados
                          </button>
                        </div>
                      )}

                      {alertsSummary.contratosVencidos.length > 0 && (
                        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl flex items-center justify-between">
                          <span className="font-semibold text-amber-800 dark:text-amber-300">
                            ⛔ {alertsSummary.contratosVencidos.length} Contrato(s) vencido(s)
                          </span>
                          <button 
                            onClick={() => setActiveTab('contratos_vencidos')}
                            className="text-amber-700 dark:text-amber-400 font-bold underline cursor-pointer"
                          >
                            Ver detalles
                          </button>
                        </div>
                      )}

                      {alertsSummary.contratosProximos.length > 0 && (
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-xl flex items-center justify-between">
                          <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                            📄 {alertsSummary.contratosProximos.length} Contrato(s) que finalizan en menos de 3 días
                          </span>
                          <button 
                            onClick={() => setActiveTab('contratos_proximos')}
                            className="text-emerald-700 dark:text-emerald-400 font-bold underline cursor-pointer"
                          >
                            Ver lista
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Specific tab list rendering */}
              {activeTab === 'citas_vencidas' && (
                <div className="space-y-2">
                  {alertsSummary.citasVencidas.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4">No hay citas médicas vencidas.</p>
                  ) : (
                    alertsSummary.citasVencidas.map((p, idx) => (
                      <div key={`cv-${p.id}-${idx}`} className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-rose-200 dark:border-rose-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-rose-600" />
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{p.apellidosNombre}</span>
                            <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded font-mono">{p.dni}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span>📅 Cita vencida el: <strong>{p.citaDia}</strong> a las <strong>{p.citaHora || 'S/H'}</strong></span>
                            <span>🏥 Centro: {p.sitioReconocimiento || 'S/D'}</span>
                            <span>🏗️ Obra: {p.obra || 'S/D'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSendSingleAlert(p, 'cita')}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <Send className="w-3 h-3" />
                          Notificar Alerta
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'citas_hoy' && (
                <div className="space-y-2">
                  {[...alertsSummary.citasHoy, ...alertsSummary.citasManana].length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4">No hay citas para hoy ni mañana.</p>
                  ) : (
                    [...alertsSummary.citasHoy, ...alertsSummary.citasManana].map((p, idx) => (
                      <div key={`ch-${p.id}-${idx}`} className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-blue-200 dark:border-blue-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-blue-600" />
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{p.apellidosNombre}</span>
                            <span className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded font-bold">
                              {p.citaDia === new Date().toISOString().split('T')[0] ? 'HOY' : 'MAÑANA'}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span>📅 Fecha: <strong>{p.citaDia}</strong> a las <strong>{p.citaHora || 'S/H'}</strong></span>
                            <span>🏥 Centro: {p.sitioReconocimiento || 'S/D'}</span>
                            <span>🏗️ Obra: {p.obra || 'S/D'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSendSingleAlert(p, 'cita')}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <Send className="w-3 h-3" />
                          Enviar Recordatorio
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'contratos_vencidos' && (
                <div className="space-y-2">
                  {alertsSummary.contratosVencidos.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4">No hay contratos vencidos.</p>
                  ) : (
                    alertsSummary.contratosVencidos.map((p, idx) => (
                      <div key={`cvc-${p.id}-${idx}`} className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-amber-600" />
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{p.apellidosNombre}</span>
                            <span className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-0.5 rounded font-mono">{p.dni}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span>⛔ Fin contrato: <strong>{p.periodoFin}</strong></span>
                            <span>🏗️ Obra: {p.obra || 'S/D'}</span>
                            <span>⏱️ Quincena: {p.quincena || 'S/D'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSendSingleAlert(p, 'contrato')}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <Send className="w-3 h-3" />
                          Notificar Vencimiento
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'contratos_proximos' && (
                <div className="space-y-2">
                  {alertsSummary.contratosProximos.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4">No hay contratos que finalicen en los próximos 3 días.</p>
                  ) : (
                    alertsSummary.contratosProximos.map((p, idx) => (
                      <div key={`cp-${p.id}-${idx}`} className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{p.apellidosNombre}</span>
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-1.5 py-0.5 rounded font-mono">{p.dni}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span>📄 Finaliza el: <strong>{p.periodoFin}</strong></span>
                            <span>🏗️ Obra: {p.obra || 'S/D'}</span>
                            <span>⏱️ Quincena: {p.quincena || 'S/D'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSendSingleAlert(p, 'contrato')}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <Send className="w-3 h-3" />
                          Enviar Recordatorio
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

          </div>

        </div>


      </div>
    </div>
  );
};
