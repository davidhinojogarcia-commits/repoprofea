import React, { useState } from 'react';
import { Calendar, Check, Loader2, ExternalLink, X } from 'lucide-react';
import { createGoogleCalendarEvent, buildGoogleCalendarWebUrl, CalendarEventInput } from '../src/lib/googleCalendar';

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
  title = "Añadir Eventos a Google Calendar",
  onToast
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdLinks, setCreatedLinks] = useState<{ summary: string; link: string }[]>([]);

  if (!isOpen || events.length === 0) return null;

  const handleSyncDirectly = async () => {
    setIsSubmitting(true);
    setCreatedLinks([]);
    let successCount = 0;
    const links: { summary: string; link: string }[] = [];

    try {
      for (const ev of events) {
        const res = await createGoogleCalendarEvent(ev);
        successCount++;
        if (res.htmlLink) {
          links.push({ summary: ev.summary, link: res.htmlLink });
        }
      }

      setCreatedLinks(links);
      onToast(`¡${successCount} evento(s) añadido(s) correctamente a Google Calendar!`, 'success');
    } catch (err: any) {
      console.error('Error adding to Google Calendar:', err);
      onToast(err.message || 'Error al conectar con la API de Google Calendar.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenWebFallback = (ev: CalendarEventInput) => {
    const webUrl = buildGoogleCalendarWebUrl(ev);
    window.open(webUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 relative overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/50 text-[#00548E] dark:text-blue-400 rounded-2xl">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">{title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Se {events.length === 1 ? 'creará 1 evento' : `crearán ${events.length} eventos`} en su calendario oficial de Google
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Confirmation Event List Preview */}
        <div className="space-y-3 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Detalles del evento a confirmar:
          </div>
          {events.map((ev, i) => (
            <div key={i} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-1">
              <div className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2">
                <span className="truncate">{ev.summary}</span>
                <button
                  type="button"
                  onClick={() => handleOpenWebFallback(ev)}
                  className="text-[10px] text-[#00548E] dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
                  title="Abrir plantilla en enlace web de Google Calendar"
                >
                  <ExternalLink className="w-3 h-3" /> Abrir Web
                </button>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>📅 <strong>Fecha:</strong> {ev.startIsoDate} {ev.endIsoDate && ev.endIsoDate !== ev.startIsoDate ? `al ${ev.endIsoDate}` : ''}</span>
                {ev.time && <span>⏰ <strong>Hora:</strong> {ev.time} h</span>}
                {ev.location && <span>📍 <strong>Lugar:</strong> {ev.location}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Successful Created Links */}
        {createdLinks.length > 0 && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs space-y-1 text-emerald-800 dark:text-emerald-300">
            <div className="font-bold flex items-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-600" />
              Eventos creados en Google Calendar:
            </div>
            {createdLinks.map((item, idx) => (
              <a
                key={idx}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block hover:underline text-[11px] font-semibold flex items-center gap-1 text-emerald-700 dark:text-emerald-300 truncate"
              >
                <ExternalLink className="w-3 h-3" /> Ver "{item.summary}" en Google Calendar
              </a>
            ))}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleSyncDirectly}
            disabled={isSubmitting}
            className="flex-1 px-5 py-2.5 bg-[#00548E] hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Programando en Google...</span>
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4" />
                <span>Confirmar y Añadir a Google Calendar</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
