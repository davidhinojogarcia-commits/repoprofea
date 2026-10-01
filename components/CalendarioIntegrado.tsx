import React, { useState, useMemo, useEffect } from 'react';
import ModalPortal from './ModalPortal';
import { 
  Calendar as CalendarIcon, CalendarDays, ChevronLeft, ChevronRight, Filter, 
  Search, RotateCcw, Clock, MapPin, User, Briefcase, FileText, Printer, 
  Download, Eye, CheckCircle2, AlertCircle, Sparkles, ExternalLink, X, 
  Tag, Layers, Building2, UserCheck, UserMinus, Plus, Bell, BellRing, CalendarCheck
} from 'lucide-react';
import { Person } from '../types';
import { formatDate } from '../src/lib/exportUtils';
import { GoogleCalendarModal } from './GoogleCalendarModal';
import { CalendarEventInput } from '../src/lib/googleCalendar';
import { requestNotificationPermission, sendLocalSWNotification, checkAndTriggerUpcomingAlerts } from '../src/lib/pushNotifications';

interface CalendarioIntegradoProps {
  people: Person[];
  savedObras: string[];
  onEditPerson?: (person: Person) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  googleToken?: string | null;
  onOpenNotificationManager?: () => void;
}

type ViewModeCalendar = 'month' | 'week' | 'agenda';
type FilterEventType = 'ALL' | 'CITAS' | 'CONTRATOS';

// Date normalization helper to convert any string format (YYYY-MM-DD, DD/MM/YYYY) to YYYY-MM-DD
export function toIsoDate(dateStr?: string): string | null {
  if (!dateStr) return null;
  const clean = dateStr.trim();
  if (!clean) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }
  const ddmmyyyy = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0');
    const month = ddmmyyyy[2].padStart(2, '0');
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  const yyyymmdd = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmdd) {
    const year = yyyymmdd[1];
    const month = yyyymmdd[2].padStart(2, '0');
    const day = yyyymmdd[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

export const CalendarioIntegrado: React.FC<CalendarioIntegradoProps> = ({
  people,
  savedObras,
  onEditPerson,
  onToast,
  googleToken,
  onOpenNotificationManager
}) => {
  // Calendar View State
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<ViewModeCalendar>('month');

  // Filters
  const [filterObra, setFilterObra] = useState<string>('ALL');
  const [filterQuincena, setFilterQuincena] = useState<string>('ALL');
  const [filterEventType, setFilterEventType] = useState<FilterEventType>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Day Detail Modal
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);

  // Google Calendar modal state
  const [isGCalModalOpen, setIsGCalModalOpen] = useState(false);

  // Push Notification State (Service Worker)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    return typeof window !== 'undefined' && 'Notification' in window && window.Notification ? window.Notification.permission : 'default';
  });

  const handleToggleNotifications = async () => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      onToast('Notificaciones Push del Service Worker activadas correctamente', 'success');
      await sendLocalSWNotification(
        '🔔 Notificaciones Push Activas',
        'Recibirás alertas en segundo plano sobre citaciones médicas y finalización de contratos.',
        'profea-welcome'
      );
    } else {
      onToast('Permiso de notificaciones denegado en el navegador', 'error');
    }
  };

  const handleTestNotification = async () => {
    const sent = await sendLocalSWNotification(
      '🩺 Alerta de Prueba (Service Worker)',
      'Notificación en segundo plano enviada correctamente a través del Service Worker de PROFEA.',
      'profea-test'
    );
    if (sent) {
      onToast('Notificación de prueba enviada al sistema', 'success');
    } else {
      onToast('Debe habilitar los permisos de notificación primero', 'error');
    }
  };

  // Month Names in Spanish
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Unique quincenas from people
  const uniqueQuincenas = useMemo(() => {
    const setQ = new Set<string>();
    people.forEach(p => {
      if (p.quincena) setQ.add(p.quincena);
    });
    return Array.from(setQ).sort();
  }, [people]);

  // Unique Obras
  const allObras = useMemo(() => {
    const setO = new Set<string>(savedObras);
    people.forEach(p => {
      if (p.obra) setO.add(p.obra);
    });
    return Array.from(setO).filter(Boolean).sort();
  }, [people, savedObras]);

  // Filtered People according to controls
  const filteredPeople = useMemo(() => {
    return people.filter(p => {
      if (filterObra !== 'ALL' && p.obra !== filterObra) return false;
      if (filterQuincena !== 'ALL' && p.quincena !== filterQuincena) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = p.apellidosNombre?.toLowerCase().includes(q);
        const matchDni = p.dni?.toLowerCase().includes(q);
        const matchObra = p.obra?.toLowerCase().includes(q);
        const matchCat = p.categoria?.toLowerCase().includes(q);
        if (!matchName && !matchDni && !matchObra && !matchCat) return false;
      }
      return true;
    });
  }, [people, filterObra, filterQuincena, searchQuery]);

  const googleCalendarEvents = useMemo<CalendarEventInput[]>(() => {
    const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const result: CalendarEventInput[] = [];

    filteredPeople.forEach(person => {
      const appointment = toIsoDate(person.citaDia);
      if ((filterEventType === 'ALL' || filterEventType === 'CITAS') && appointment?.startsWith(monthPrefix)) {
        result.push({
          summary: `Reconocimiento médico · ${person.apellidosNombre}`,
          description: `Trabajador: ${person.apellidosNombre}\nDNI: ${person.dni || '-'}\nObra: ${person.obra || '-'}\nCategoría: ${person.categoria || '-'}`,
          location: person.sitioReconocimiento || 'Centro de reconocimiento médico',
          startIsoDate: appointment,
          time: person.citaHora || '08:00',
          durationMinutes: 30,
          reminderMinutes: 1440,
        });
      }

      if (filterEventType === 'ALL' || filterEventType === 'CONTRATOS') {
        const start = toIsoDate(person.periodoInicio);
        if (start?.startsWith(monthPrefix)) {
          result.push({
            summary: `Inicio contrato PROFEA · ${person.apellidosNombre}`,
            description: `Trabajador: ${person.apellidosNombre}\nDNI: ${person.dni || '-'}\nObra: ${person.obra || '-'}\nCategoría: ${person.categoria || '-'}\nOferta: ${person.numOferta || '-'}`,
            location: person.obra || 'PROFEA',
            startIsoDate: start,
            reminderMinutes: 1440,
          });
        }

        const end = toIsoDate(person.periodoFin);
        if (end?.startsWith(monthPrefix)) {
          result.push({
            summary: `Fin contrato PROFEA · ${person.apellidosNombre}`,
            description: `Trabajador: ${person.apellidosNombre}\nDNI: ${person.dni || '-'}\nObra: ${person.obra || '-'}\nCategoría: ${person.categoria || '-'}`,
            location: person.obra || 'PROFEA',
            startIsoDate: end,
            reminderMinutes: 1440,
          });
        }
      }
    });

    return result;
  }, [filteredPeople, filterEventType, currentDate]);


  // Map of events by ISO Date String (YYYY-MM-DD)
  // Store citas, inicios de contrato, fines de contrato, y contratos activos
  const eventsByDate = useMemo(() => {
    const map: Record<string, {
      citas: Person[];
      starts: Person[];
      ends: Person[];
      activeContracts: Person[];
    }> = {};

    const ensureKey = (key: string) => {
      if (!map[key]) {
        map[key] = { citas: [], starts: [], ends: [], activeContracts: [] };
      }
    };

    filteredPeople.forEach(p => {
      // 1. Cita Médica
      if (filterEventType === 'ALL' || filterEventType === 'CITAS') {
        const citaIso = toIsoDate(p.citaDia);
        if (citaIso) {
          ensureKey(citaIso);
          map[citaIso].citas.push(p);
        }
      }

      // 2. Contratos (Inicio y Fin)
      if (filterEventType === 'ALL' || filterEventType === 'CONTRATOS') {
        const startIso = toIsoDate(p.periodoInicio);
        const endIso = toIsoDate(p.periodoFin);

        if (startIso) {
          ensureKey(startIso);
          map[startIso].starts.push(p);
        }

        if (endIso) {
          ensureKey(endIso);
          map[endIso].ends.push(p);
        }
      }
    });

    return map;
  }, [filteredPeople, filterEventType]);

  // Helper to get events for a specific date ISO string
  const getEventsForDay = (dateIso: string) => {
    const dayData = eventsByDate[dateIso] || { citas: [], starts: [], ends: [], activeContracts: [] };
    
    // Calculate active contracts for this day if event type includes contracts
    if (filterEventType === 'ALL' || filterEventType === 'CONTRATOS') {
      const active: Person[] = [];
      filteredPeople.forEach(p => {
        const startIso = toIsoDate(p.periodoInicio);
        const endIso = toIsoDate(p.periodoFin);
        if (startIso && endIso) {
          if (dateIso >= startIso && dateIso <= endIso) {
            // Check if not already added in starts/ends
            active.push(p);
          }
        }
      });
      return { ...dayData, activeContracts: active };
    }

    return dayData;
  };

  // Days matrix for Month View
  const monthDays = useMemo(() => {
    const year = currentYear;
    const month = currentMonth;

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Monday as 0, Sunday as 6
    let startDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const totalDaysInMonth = lastDayOfMonth.getDate();

    const days: { date: Date; iso: string; isCurrentMonth: boolean; isToday: boolean }[] = [];

    const todayIso = new Date().toISOString().split('T')[0];

    // Previous month padding days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      const iso = d.toISOString().split('T')[0];
      days.push({
        date: d,
        iso,
        isCurrentMonth: false,
        isToday: iso === todayIso
      });
    }

    // Current month days
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const d = new Date(year, month, day);
      const iso = d.toISOString().split('T')[0];
      days.push({
        date: d,
        iso,
        isCurrentMonth: true,
        isToday: iso === todayIso
      });
    }

    // Next month padding days to complete 35 or 42 cells grid
    const remaining = (7 - (days.length % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      const d = new Date(year, month + 1, day);
      const iso = d.toISOString().split('T')[0];
      days.push({
        date: d,
        iso,
        isCurrentMonth: false,
        isToday: iso === todayIso
      });
    }

    return days;
  }, [currentYear, currentMonth]);

  // Monthly stats summary
  const monthlyStats = useMemo(() => {
    let citasCount = 0;
    let startsCount = 0;
    let endsCount = 0;

    const prefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    filteredPeople.forEach(p => {
      const cIso = toIsoDate(p.citaDia);
      const sIso = toIsoDate(p.periodoInicio);
      const eIso = toIsoDate(p.periodoFin);

      if (cIso && cIso.startsWith(prefix)) citasCount++;
      if (sIso && sIso.startsWith(prefix)) startsCount++;
      if (eIso && eIso.startsWith(prefix)) endsCount++;
    });

    return { citasCount, startsCount, endsCount };
  }, [filteredPeople, currentYear, currentMonth]);

  // Agenda list items (all upcoming/current events sorted by date in current month or full list)
  const agendaEvents = useMemo(() => {
    const list: {
      dateIso: string;
      citas: Person[];
      starts: Person[];
      ends: Person[];
    }[] = [];

    const keys = Object.keys(eventsByDate).sort();
    keys.forEach(k => {
      const item = eventsByDate[k];
      if (item.citas.length > 0 || item.starts.length > 0 || item.ends.length > 0) {
        list.push({
          dateIso: k,
          citas: item.citas,
          starts: item.starts,
          ends: item.ends
        });
      }
    });

    return list;
  }, [eventsByDate]);

  const resetFilters = () => {
    setFilterObra('ALL');
    setFilterQuincena('ALL');
    setFilterEventType('ALL');
    setSearchQuery('');
  };

  const hasActiveFilters = filterObra !== 'ALL' || filterQuincena !== 'ALL' || filterEventType !== 'ALL' || searchQuery !== '';

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Title Header */}
      <div className="ui-surface p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-[var(--ui-gradient-brand)] text-white rounded-xl shadow-sm">
              <CalendarDays className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
                Calendario Integrado de Citas y Contratos
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Vista unificada de reconocimientos médicos y periodos de contratación del personal PROFEA
              </p>
            </div>
          </div>
        </div>

        {/* Top Actions: Push Notifications & View mode switcher */}
        <div className="flex flex-wrap items-center gap-2.5 self-start md:self-auto">
          <button
            type="button"
            onClick={() => {
              if (!googleCalendarEvents.length) {
                onToast('No hay avisos del mes visible para enviar a Google Calendar.', 'error');
                return;
              }
              setIsGCalModalOpen(true);
            }}
            className="px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-[#00548E] border border-blue-200 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800"
            title="Seleccionar manualmente qué avisos enviar a Google Calendar"
          >
            <CalendarCheck className="w-4 h-4" />
            Google Calendar
          </button>
          {/* Push Notifications SW Toggle */}
          <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={onOpenNotificationManager ? onOpenNotificationManager : handleToggleNotifications}
              title={notificationPermission === 'granted' ? 'Gestionar Notificaciones Push y Alertas' : 'Activar Notificaciones Push del Service Worker'}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                notificationPermission === 'granted'
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100'
              }`}
            >
              {notificationPermission === 'granted' ? (
                <BellRing className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-pulse" />
              ) : (
                <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              )}
              <span>
                {notificationPermission === 'granted' ? 'Gestionar Alertas Push' : 'Activar Notificaciones Push'}
              </span>
            </button>

            {notificationPermission === 'granted' && (
              <button
                onClick={handleTestNotification}
                title="Enviar notificación de prueba al navegador"
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
              >
                Probar
              </button>
            )}
          </div>

          {/* View mode switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200/80 dark:border-slate-700">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'month'
                  ? 'bg-white dark:bg-slate-900 text-[#00548E] dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Mes
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'week'
                  ? 'bg-white dark:bg-slate-900 text-[#00548E] dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Semana
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'agenda'
                  ? 'bg-white dark:bg-slate-900 text-[#00548E] dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Agenda
            </button>
          </div>
        </div>
      </div>

      {/* Control Bar: Filters & Navigation */}
      <div className="ui-surface p-5 space-y-4">
        
        {/* Month Navigation & Stats Summary Row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          
          {/* Month / Year Navigator */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevMonth}
              className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Mes Anterior"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 min-w-[180px] text-center capitalize tracking-tight">
              {monthNames[currentMonth]} {currentYear}
            </h3>
            <button
              onClick={handleNextMonth}
              className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Mes Siguiente"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            <button
              onClick={handleToday}
              className="ml-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 text-[#00548E] dark:text-blue-400 hover:bg-blue-100 text-xs font-bold rounded-xl border border-blue-200/60 dark:border-blue-900/40 transition-colors cursor-pointer"
            >
              Hoy
            </button>
          </div>

          {/* Quick Monthly Stats Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 rounded-xl text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Reconocimientos Médicos:</span>
              <strong className="font-extrabold">{monthlyStats.citasCount}</strong>
            </div>

            <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/40 rounded-xl text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Inicios Contrato:</span>
              <strong className="font-extrabold">{monthlyStats.startsCount}</strong>
            </div>

            <div className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/60 dark:border-rose-900/40 rounded-xl text-xs font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
              <UserMinus className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>Fines Contrato:</span>
              <strong className="font-extrabold">{monthlyStats.endsCount}</strong>
            </div>
          </div>
        </div>

        {/* Filter Controls Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          
          {/* Obra */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
              Obra / Localidad
            </label>
            <select
              value={filterObra}
              onChange={e => setFilterObra(e.target.value)}
              className="w-full p-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              <option value="ALL">Todas las Obras</option>
              {allObras.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          {/* Quincena */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
              Quincena
            </label>
            <select
              value={filterQuincena}
              onChange={e => setFilterQuincena(e.target.value)}
              className="w-full p-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              <option value="ALL">Todas las Quincenas</option>
              {uniqueQuincenas.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>

          {/* Event Type Filter */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
              Tipo de Eventos
            </label>
            <select
              value={filterEventType}
              onChange={e => setFilterEventType(e.target.value as FilterEventType)}
              className="w-full p-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none font-medium"
            >
              <option value="ALL">🔍 Todos los Eventos (Reconocimientos + Contratos)</option>
              <option value="CITAS">🩺 Reconocimientos Médicos Únicamente</option>
              <option value="CONTRATOS">💼 Periodos de Contratación Únicamente</option>
            </select>
          </div>

          {/* Search Box */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
              Búsqueda de Trabajador
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Nombre, DNI o Categoría..."
                className="w-full p-2 pl-7 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2.5" />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Legend & Reset Button Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Leyenda:</span>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Reconocimiento Médico
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Inicio Contrato
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-800 dark:text-rose-300">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              Fin Contrato
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-800 dark:text-blue-300">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              Contrato Activo
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restablecer Filtros
            </button>
          )}
        </div>
      </div>

      {/* CALENDAR VIEWS */}

      {/* 1. MONTH VIEW */}
      {viewMode === 'month' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          
          {/* Weekday Header */}
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-center py-2.5 text-xs font-extrabold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
            <div>Lun</div>
            <div>Mar</div>
            <div>Mié</div>
            <div>Jue</div>
            <div>Vie</div>
            <div>Sáb</div>
            <div>Dom</div>
          </div>

          {/* Month Grid Cells */}
          <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-slate-200/80 dark:divide-slate-800 bg-slate-200/40 dark:bg-slate-800/40">
            {monthDays.map((d, idx) => {
              const dayData = getEventsForDay(d.iso);
              const totalEventsCount = dayData.citas.length + dayData.starts.length + dayData.ends.length;
              
              const dayNum = d.date.getDate();

              return (
                <div
                  key={d.iso + '_' + idx}
                  onClick={() => setSelectedDayIso(d.iso)}
                  className={`min-h-[110px] p-1.5 sm:p-2 transition-all flex flex-col justify-between cursor-pointer group hover:bg-blue-50/40 dark:hover:bg-slate-800/80 ${
                    d.isCurrentMonth
                      ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100'
                      : 'bg-slate-50/70 dark:bg-slate-900/40 text-slate-400 dark:text-slate-600'
                  }`}
                >
                  {/* Top Day Number Row */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-black w-6 h-6 rounded-full flex items-center justify-center ${
                        d.isToday
                          ? 'bg-[#00548E] text-white shadow-xs scale-105'
                          : d.isCurrentMonth
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {dayNum}
                    </span>

                    {totalEventsCount > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {totalEventsCount}
                      </span>
                    )}
                  </div>

                  {/* Day Content Badges Preview */}
                  <div className="my-1 space-y-1 overflow-hidden max-h-[85px]">
                    
                    {/* Citas RRMM */}
                    {dayData.citas.slice(0, 2).map((p, pIdx) => (
                      <div
                        key={'c_' + p.id + '_' + pIdx}
                        className="px-1.5 py-0.5 bg-amber-100/90 dark:bg-amber-950/70 border border-amber-300/60 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-md text-[10px] font-semibold truncate flex items-center gap-1 shadow-2xs"
                        title={`Reconocimiento Médico: ${p.apellidosNombre} (${p.citaHora || 'S/H'}) - ${p.sitioReconocimiento || ''}`}
                      >
                        <Clock className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                        <span className="truncate">{p.citaHora ? `${p.citaHora} ` : ''}{p.apellidosNombre}</span>
                      </div>
                    ))}

                    {/* Starts of Contract */}
                    {dayData.starts.slice(0, 2).map((p, pIdx) => (
                      <div
                        key={'s_' + p.id + '_' + pIdx}
                        className="px-1.5 py-0.5 bg-emerald-100/90 dark:bg-emerald-950/70 border border-emerald-300/60 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 rounded-md text-[10px] font-semibold truncate flex items-center gap-1 shadow-2xs"
                        title={`Inicio Contrato: ${p.apellidosNombre} - Obra: ${p.obra}`}
                      >
                        <UserCheck className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                        <span className="truncate">Inicio: {p.apellidosNombre}</span>
                      </div>
                    ))}

                    {/* Ends of Contract */}
                    {dayData.ends.slice(0, 1).map((p, pIdx) => (
                      <div
                        key={'e_' + p.id + '_' + pIdx}
                        className="px-1.5 py-0.5 bg-rose-100/90 dark:bg-rose-950/70 border border-rose-300/60 dark:border-rose-800 text-rose-900 dark:text-rose-200 rounded-md text-[10px] font-semibold truncate flex items-center gap-1 shadow-2xs"
                        title={`Fin Contrato: ${p.apellidosNombre}`}
                      >
                        <UserMinus className="w-2.5 h-2.5 text-rose-600 shrink-0" />
                        <span className="truncate">Fin: {p.apellidosNombre}</span>
                      </div>
                    ))}

                    {/* More badge */}
                    {totalEventsCount > 3 && (
                      <div className="text-[9px] font-bold text-[#00548E] dark:text-blue-400 hover:underline pt-0.5">
                        +{totalEventsCount - 3} evento(s) más...
                      </div>
                    )}
                  </div>

                  {/* Bottom Active Indicator */}
                  {dayData.activeContracts.length > 0 && totalEventsCount === 0 && (
                    <div className="text-[9px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30 px-1 py-0.5 rounded truncate">
                      {dayData.activeContracts.length} trab. activo(s)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs p-6 space-y-6">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <Layers className="w-4 h-4 text-[#00548E]" />
            Desglose Semanal de Eventos ({monthNames[currentMonth]} {currentYear})
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {monthDays.slice(0, 7).map((dayObj, idx) => {
              const dayData = getEventsForDay(dayObj.iso);
              const dayName = dayObj.date.toLocaleDateString('es-ES', { weekday: 'short' });
              
              return (
                <div 
                  key={'week_' + idx}
                  onClick={() => setSelectedDayIso(dayObj.iso)}
                  className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl p-3 space-y-2 hover:border-[#00548E] transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                    <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-300">
                      {dayName} {dayObj.date.getDate()}
                    </span>
                    {dayObj.isToday && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-[#00548E] text-white font-extrabold rounded-full">
                        HOY
                      </span>
                    )}
                  </div>

                  {/* Citas */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Citas:</span>
                    {dayData.citas.length === 0 ? (
                      <span className="text-[10px] text-slate-400 italic block">Ninguna</span>
                    ) : (
                      dayData.citas.map((p, idx) => (
                        <div key={'wc_' + p.id + '_' + idx} className="p-1.5 bg-amber-100/90 dark:bg-amber-950/70 border border-amber-300/60 dark:border-amber-800 rounded-lg text-[10px] text-amber-900 dark:text-amber-200">
                          <strong>{p.citaHora || 'S/H'}</strong>: {p.apellidosNombre}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Starts */}
                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Inicios Contrato:</span>
                    {dayData.starts.length === 0 ? (
                      <span className="text-[10px] text-slate-400 italic block">Ninguno</span>
                    ) : (
                      dayData.starts.map((p, idx) => (
                        <div key={'ws_' + p.id + '_' + idx} className="p-1.5 bg-emerald-100/90 dark:bg-emerald-950/70 border border-emerald-300/60 dark:border-emerald-800 rounded-lg text-[10px] text-emerald-900 dark:text-emerald-200">
                          {p.apellidosNombre} ({p.obra})
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. AGENDA VIEW */}
      {viewMode === 'agenda' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#00548E]" />
              Lista Cronológica de Eventos Registrados
            </h4>
            <span className="text-xs text-slate-400 font-semibold">
              {agendaEvents.length} días con actividad
            </span>
          </div>

          {agendaEvents.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <CalendarIcon className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto" />
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                No hay citas ni contrataciones registradas que coincidan con los filtros actuales.
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
              {agendaEvents.map(item => {
                const dateParts = item.dateIso.split('-');
                const formattedDateStr = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

                return (
                  <div
                    key={item.dateIso}
                    onClick={() => setSelectedDayIso(item.dateIso)}
                    className="p-4 bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-3 hover:border-blue-300 transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-2">
                      <span className="text-xs font-black text-[#00548E] dark:text-blue-400 flex items-center gap-1.5">
                        <CalendarDays className="w-4 h-4" />
                        {formattedDateStr}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-full">
                        {item.citas.length + item.starts.length + item.ends.length} eventos
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Citas */}
                      {item.citas.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Reconocimientos Médicos ({item.citas.length})
                          </span>
                          <div className="space-y-1">
                            {item.citas.map((p, idx) => (
                              <div key={'ag_c_' + p.id + '_' + idx} className="p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 rounded-xl text-xs flex items-center justify-between">
                                <div>
                                  <span className="font-bold text-slate-800 dark:text-slate-100">{p.apellidosNombre}</span>
                                  <span className="text-[10px] text-slate-400 block font-mono">DNI: {p.dni} | Hora: {p.citaHora || 'No asignada'}</span>
                                </div>
                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-200/60 text-amber-900 rounded font-bold">
                                  {p.obra || 'S/O'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Starts */}
                      {item.starts.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                            <UserCheck className="w-3 h-3" /> Inicios de Contrato ({item.starts.length})
                          </span>
                          <div className="space-y-1">
                            {item.starts.map((p, idx) => (
                              <div key={'ag_s_' + p.id + '_' + idx} className="p-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 rounded-xl text-xs flex items-center justify-between">
                                <div>
                                  <span className="font-bold text-slate-800 dark:text-slate-100">{p.apellidosNombre}</span>
                                  <span className="text-[10px] text-slate-400 block">Cat: {p.categoria || 'Peón'} | Quincena: {p.quincena || '-'}</span>
                                </div>
                                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-200/60 text-emerald-900 rounded font-bold">
                                  {p.obra}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SELECTED DAY SLIDE-OVER DETAIL MODAL */}
      {selectedDayIso && (() => {
        const dayData = getEventsForDay(selectedDayIso);
        const parts = selectedDayIso.split('-');
        const dateFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;

        return (
          <ModalPortal label="CalendarioIntegrado"><div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 space-y-6 shadow-2xl max-h-[90vh] flex flex-col">
              
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-[#00548E] dark:text-blue-400 rounded-2xl">
                    <CalendarDays className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">
                      Detalle de Eventos ({dateFormatted})
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      Reconocimientos médicos y vigencia de contrataciones para esta fecha
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedDayIso(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-5 pr-1">
                
                {/* 1. CITAS RRMM SECTION */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      Reconocimientos Médicos Programados ({dayData.citas.length})
                    </h4>
                  </div>

                  {dayData.citas.length === 0 ? (
                    <p className="text-xs text-slate-400 italic bg-amber-50/50 dark:bg-amber-950/20 p-3 rounded-xl border border-amber-200/40 dark:border-amber-900/20">
                      No hay reconocimientos médicos programados para este día.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {dayData.citas.map((p, pIdx) => (
                        <div
                          key={'md_c_' + p.id + '_' + pIdx}
                          className="p-3 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                              {p.apellidosNombre}
                            </span>
                            <span className="text-xs font-black text-amber-800 dark:text-amber-300 px-2 py-0.5 bg-amber-200/60 dark:bg-amber-900/60 rounded-lg">
                              Hora: {p.citaHora || 'No asignada'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-slate-600 dark:text-slate-300">
                            <div><strong className="text-slate-500">DNI:</strong> {p.dni}</div>
                            <div><strong className="text-slate-500">Obra:</strong> {p.obra || '-'}</div>
                            <div className="sm:col-span-2"><strong className="text-slate-500">Centro Médico:</strong> {p.sitioReconocimiento || 'No especificado'}</div>
                            {p.telefono && <div><strong className="text-slate-500">Teléfono:</strong> {p.telefono}</div>}
                          </div>

                          {onEditPerson && (
                            <div className="pt-1 flex justify-end">
                              <button
                                onClick={() => {
                                  setSelectedDayIso(null);
                                  onEditPerson(p);
                                }}
                                className="text-xs font-bold text-[#00548E] hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" /> Editar Datos del Trabajador
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. INICIOS DE CONTRATO */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4" />
                    Inicios de Contrato ({dayData.starts.length})
                  </h4>

                  {dayData.starts.length === 0 ? (
                    <p className="text-xs text-slate-400 italic bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-200/40 dark:border-emerald-900/20">
                      No hay contratos que comiencen formalmente en esta fecha.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {dayData.starts.map((p, pIdx) => (
                        <div
                          key={'md_s_' + p.id + '_' + pIdx}
                          className="p-3 bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                              {p.apellidosNombre}
                            </span>
                            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 px-2 py-0.5 bg-emerald-200/60 dark:bg-emerald-900/60 rounded-lg">
                              Obra: {p.obra}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-slate-600 dark:text-slate-300">
                            <div><strong className="text-slate-500">DNI:</strong> {p.dni}</div>
                            <div><strong className="text-slate-500">Categoría:</strong> {p.categoria || 'Peón'}</div>
                            <div><strong className="text-slate-500">Quincena:</strong> {p.quincena || '-'}</div>
                            <div><strong className="text-slate-500">Duración:</strong> {formatDate(p.periodoInicio)} al {formatDate(p.periodoFin)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. FINES DE CONTRATO */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                    <UserMinus className="w-4 h-4" />
                    Fines de Contrato ({dayData.ends.length})
                  </h4>

                  {dayData.ends.length === 0 ? (
                    <p className="text-xs text-slate-400 italic bg-rose-50/50 dark:bg-rose-950/20 p-3 rounded-xl border border-rose-200/40 dark:border-rose-900/20">
                      No hay contratos que finalicen en esta fecha.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {dayData.ends.map((p, pIdx) => (
                        <div
                          key={'md_e_' + p.id + '_' + pIdx}
                          className="p-3 bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-2xl space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                              {p.apellidosNombre}
                            </span>
                            <span className="text-xs font-bold text-rose-800 dark:text-rose-300 px-2 py-0.5 bg-rose-200/60 dark:bg-rose-900/60 rounded-lg">
                              Obra: {p.obra}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-slate-600 dark:text-slate-300">
                            <div><strong className="text-slate-500">DNI:</strong> {p.dni}</div>
                            <div><strong className="text-slate-500">Categoría:</strong> {p.categoria || 'Peón'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  onClick={() => setSelectedDayIso(null)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cerrar
                </button>
              </div>

            </div>
          </div></ModalPortal>
        );
      })()}

      <GoogleCalendarModal
        isOpen={isGCalModalOpen}
        onClose={() => setIsGCalModalOpen(false)}
        events={googleCalendarEvents}
        title={`Avisos de ${monthNames[currentMonth]} ${currentYear}`}
        onToast={onToast}
      />
    </div>
  );
};
