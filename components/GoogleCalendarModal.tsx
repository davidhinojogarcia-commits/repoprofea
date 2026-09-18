import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, CheckCircle2, ExternalLink, Loader2, LogOut, Mail, X } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import {
  buildGoogleCalendarWebUrl,
  CalendarEventInput,
  connectGoogleCalendar,
  createGoogleCalendarEvent,
  disconnectGoogleCalendar,
  getGoogleCalendarConnection,
  isGoogleCalendarDirectConnectionAvailable,
  type GoogleCalendarConnection,
} from '../src/lib/googleCalendar';

interface GoogleCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: CalendarEventInput[];
  title?: string;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export const GoogleCalendarModal: React.FC<GoogleCalendarModalProps> = ({
  isOpen,
  onClose,
  events,
  title = 'Añadir avisos a Google Calendar',
  onToast,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(() => getGoogleCalendarConnection());
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [createdLinks, setCreatedLinks] = useState<{ summary: string; link: string }[]>([]);
  const [reminderMinutes, setReminderMinutes] = useState(60);
  const [profeaEmail, setProfeaEmail] = useState('');
  const directConnectionAvailable = isGoogleCalendarDirectConnectionAvailable();

  useEffect(() => {
    if (!isOpen) return;
    void supabase.auth.getUser().then(({ data }) => {
      const registeredEmail = String(data.user?.email || '').trim();
      setProfeaEmail(registeredEmail);
      const cached = getGoogleCalendarConnection();
      if (cached?.email && registeredEmail && cached.email.toLowerCase() !== registeredEmail.toLowerCase()) {
        disconnectGoogleCalendar();
        setConnection(null);
      } else {
        setConnection(cached);
      }
    });
    setSelectedIndexes(events.map((_, index) => index));
    setCreatedLinks([]);
  }, [isOpen, events]);

  const selectedEvents = useMemo(
    () => selectedIndexes
      .map(index => events[index])
      .filter((event): event is CalendarEventInput => Boolean(event)),
    [events, selectedIndexes],
  );

  if (!isOpen || events.length === 0) return null;

  const toggleEvent = (index: number) => {
    setSelectedIndexes(current =>
      current.includes(index)
        ? current.filter(item => item !== index)
        : [...current, index].sort((a, b) => a - b)
    );
  };

  const connect = async () => {
    if (!directConnectionAvailable) {
      onToast('La conexión directa no está configurada. Puedes añadir los avisos mediante Google Calendar Web.', 'success');
      return;
    }
    setIsConnecting(true);
    try {
      const connected = await connectGoogleCalendar(profeaEmail);
      setConnection(connected);
      onToast(`Google Calendar conectado con ${connected.email || 'la cuenta seleccionada'}`, 'success');
    } catch (error: any) {
      console.error(error);
      onToast(error?.message || 'No se pudo conectar Google Calendar.', 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    disconnectGoogleCalendar();
    setConnection(null);
    setCreatedLinks([]);
    onToast('Cuenta de Google Calendar desconectada de esta sesión.', 'success');
  };

  const handleSyncDirectly = async () => {
    if (!selectedEvents.length) {
      onToast('Selecciona al menos un aviso para añadirlo a Google Calendar.', 'error');
      return;
    }

    if (!directConnectionAvailable) {
      let opened = 0;
      selectedEvents.forEach((event) => {
        const popup = window.open(buildGoogleCalendarWebUrl({ ...event, reminderMinutes }, profeaEmail), '_blank', 'noopener,noreferrer');
        if (popup) opened += 1;
      });
      if (opened === selectedEvents.length) {
        onToast(`Se han abierto ${opened} aviso(s) en Google Calendar. Revisa cada uno y pulsa Guardar.`, 'success');
      } else if (opened > 0) {
        onToast(`Se han abierto ${opened} de ${selectedEvents.length} aviso(s). El navegador ha bloqueado alguna pestaña.`, 'error');
      } else {
        onToast('El navegador ha bloqueado la apertura de Google Calendar. Usa el botón “Web” de cada aviso.', 'error');
      }
      return;
    }

    let activeConnection = connection;
    if (!activeConnection) {
      setIsConnecting(true);
      try {
        activeConnection = await connectGoogleCalendar(profeaEmail);
        setConnection(activeConnection);
      } catch (error: any) {
        onToast(error?.message || 'No se pudo conectar Google Calendar.', 'error');
        setIsConnecting(false);
        return;
      }
      setIsConnecting(false);
    }

    setIsSubmitting(true);
    setCreatedLinks([]);
    let successCount = 0;
    const links: { summary: string; link: string }[] = [];

    try {
      for (const ev of selectedEvents) {
        const res = await createGoogleCalendarEvent({ ...ev, reminderMinutes }, profeaEmail);
        successCount += 1;
        if (res.htmlLink) links.push({ summary: ev.summary, link: res.htmlLink });
      }

      setCreatedLinks(links);
      onToast(
        `${successCount} aviso(s) añadido(s) a Google Calendar de ${activeConnection?.email || 'la cuenta conectada'}.`,
        'success',
      );
    } catch (err: any) {
      console.error('Error adding to Google Calendar:', err);
      setConnection(getGoogleCalendarConnection());
      onToast(err.message || 'Error al conectar con Google Calendar.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenWebFallback = (ev: CalendarEventInput) => {
    window.open(buildGoogleCalendarWebUrl(ev, profeaEmail), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-2xl w-full shadow-2xl space-y-5 relative overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/50 text-[#00548E] dark:text-blue-400 rounded-2xl">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">{title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Marca únicamente los avisos que quieras enviar a tu calendario.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {profeaEmail && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-slate-700 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-slate-200">
            <div><span className="font-bold">Cuenta corporativa PROFEA:</span> {profeaEmail}</div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Google Calendar solo podrá sincronizarse con esta misma cuenta.
            </div>
          </div>
        )}

        <div className={`rounded-2xl border p-4 ${connection ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : directConnectionAvailable ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50' : 'border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/30'}`}>
          {!directConnectionAvailable ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-black text-slate-800 dark:text-slate-100">Google Calendar Web disponible</div>
              <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                La conexión directa todavía no tiene configurado el identificador OAuth de Google. Mientras tanto, los avisos pueden abrirse en Google Calendar con todos sus datos para revisarlos y guardarlos.
              </div>
            </div>
          ) : connection ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Google Calendar conectado</div>
                  <div className="mt-1 flex items-center gap-1.5 truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                    <Mail className="h-4 w-4 shrink-0" /> {connection.email || 'Cuenta de Google'}
                  </div>
                </div>
              </div>
              <button type="button" onClick={disconnect} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 dark:border-emerald-900 dark:bg-slate-900 dark:text-slate-200">
                <LogOut className="h-4 w-4" /> Desconectar
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-black text-slate-800 dark:text-slate-100">Conecta tu cuenta de Google</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Los eventos se crearán únicamente en el calendario de {profeaEmail || 'tu cuenta corporativa PROFEA'}.</div>
              </div>
              <button type="button" disabled={isConnecting} onClick={() => void connect()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                {isConnecting ? 'Conectando…' : 'Conectar Google Calendar'}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Recordatorio de Google</div>
            <div className="mt-1 text-xs text-slate-400">Se aplicará a los avisos que marques.</div>
          </div>
          <select
            value={reminderMinutes}
            onChange={event => setReminderMinutes(Number(event.target.value))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value={0}>A la hora del evento</option>
            <option value={30}>30 minutos antes</option>
            <option value={60}>1 hora antes</option>
            <option value={1440}>1 día antes</option>
            <option value={2880}>2 días antes</option>
            <option value={10080}>1 semana antes</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Avisos disponibles · {selectedEvents.length} seleccionados
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelectedIndexes(events.map((_, index) => index))} className="text-xs font-bold text-[#00548E] hover:underline">Todos</button>
            <button type="button" onClick={() => setSelectedIndexes([])} className="text-xs font-bold text-slate-500 hover:underline">Ninguno</button>
          </div>
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {events.map((ev, i) => {
            const checked = selectedIndexes.includes(i);
            return (
              <div key={i} className={`rounded-2xl border p-3.5 transition ${checked ? 'border-blue-300 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/20' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEvent(i)}
                    className="mt-1 h-5 w-5 rounded border-slate-300 text-[#00548E] focus:ring-[#00548E]/30"
                    aria-label={`Seleccionar ${ev.summary}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2">
                      <span>{ev.summary}</span>
                      <button type="button" onClick={() => handleOpenWebFallback(ev)} className="text-[10px] text-[#00548E] dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0">
                        <ExternalLink className="w-3 h-3" /> Web
                      </button>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                      <span>📅 {ev.startIsoDate}{ev.endIsoDate && ev.endIsoDate !== ev.startIsoDate ? ` → ${ev.endIsoDate}` : ''}</span>
                      {ev.time && <span>⏰ {ev.time} h</span>}
                      {ev.location && <span>📍 {ev.location}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {createdLinks.length > 0 && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs space-y-1 text-emerald-800 dark:text-emerald-300">
            <div className="font-bold flex items-center gap-1.5"><Check className="w-4 h-4" /> Eventos creados:</div>
            {createdLinks.map((item, idx) => (
              <a key={idx} href={item.link} target="_blank" rel="noopener noreferrer" className="block hover:underline text-[11px] font-semibold truncate">
                Ver “{item.summary}” en Google Calendar
              </a>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSyncDirectly()}
            disabled={isSubmitting || isConnecting || selectedEvents.length === 0}
            className="flex-1 px-5 py-2.5 bg-[#00548E] hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            {isSubmitting
              ? 'Añadiendo seleccionados…'
              : directConnectionAvailable
                ? `Añadir ${selectedEvents.length} seleccionado(s) a Google Calendar`
                : `Abrir ${selectedEvents.length} seleccionado(s) en Google Calendar`}
          </button>
        </div>
      </div>
    </div>
  );
};
