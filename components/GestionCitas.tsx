import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Calendar, Sparkles, Download, Clock, MapPin, Printer, RefreshCw, 
  Trash2, Plus, Info, LayoutGrid, FileText, Check, AlertCircle, ChevronRight,
  Activity, FileCheck, ShieldAlert
} from 'lucide-react';
import { Person } from '../types';
import { formatDate, generateMedicalTicketsPDF, TicketData } from '../src/lib/exportUtils';
import { GoogleCalendarModal } from './GoogleCalendarModal';
import { CalendarEventInput } from '../src/lib/googleCalendar';
import { ReconocimientosMedicosSection } from './ReconocimientosMedicosSection';
import { createDocument, deleteDocument, subscribeToDocuments } from '../src/services/databaseService';

interface GestionCitasProps {
  people: Person[];
  savedSitios: string[];
  savedTelefonos: string[];
  onUpdatePeople: (updatedPeople: Person[]) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  workStartHour?: string;
  workEndHour?: string;
  onUpdateWorkStartHour?: (hour: string) => void;
  onUpdateSavedTelefonos?: (telefonos: string[]) => void;
}

interface ScheduledCita {
  id?: string;
  citaDia: string;
  citaHora: string;
  sitioReconocimiento: string;
  obra?: string;
  numOferta?: string;
  quincena?: string;
  supervisorResponsable?: string;
  telefonoSupervisor?: string;
  diaComienzo?: string;
  diaFinContrato?: string;
  diaContratacion?: string;
}

export const GestionCitas: React.FC<GestionCitasProps> = ({
  people,
  savedSitios,
  savedTelefonos,
  onUpdatePeople,
  onToast,
  workStartHour = '08:00',
  workEndHour = '15:00',
  onUpdateWorkStartHour,
  onUpdateSavedTelefonos
}) => {
  // Mode selection: 'ai', 'manual' or 'reconocimientos'
  const [activeTab, setActiveTab] = useState<'ai' | 'manual' | 'reconocimientos'>('reconocimientos');
  
  // AI scheduling prompt
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [selectedDefaultSite, setSelectedDefaultSite] = useState(savedSitios[0] || 'Centro de Prevención Diputación de Cádiz');

  // Manual fast batch generation form states
  const [manualCount, setManualCount] = useState<number>(5);
  const [manualWorkersPerSlot, setManualWorkersPerSlot] = useState<number>(1);
  const [manualCitaDia, setManualCitaDia] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [manualCitaHora, setManualCitaHora] = useState<string>('08:00');
  const [manualInterval, setManualInterval] = useState<number>(10);
  const [manualSitio, setManualSitio] = useState<string>(savedSitios[0] || 'Centro de Prevención Diputación de Cádiz');
  const [manualObra, setManualObra] = useState<string>('BORNOS');
  const [manualNumOferta, setManualNumOferta] = useState<string>('11002GR');
  const [manualDiaComienzo, setManualDiaComienzo] = useState<string>(() => {
    // Default start date is 3 days after today
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toISOString().split('T')[0];
  });
  const [manualDiaFinContrato, setManualDiaFinContrato] = useState<string>(() => {
    // Default contract end date is 18 days after today
    const date = new Date();
    date.setDate(date.getDate() + 18);
    return date.toISOString().split('T')[0];
  });
  const [manualSupervisor, setManualSupervisor] = useState<string>('');
  const [manualTelefonoSupervisor, setManualTelefonoSupervisor] = useState<string>('');
  const [manualDiaContratacion, setManualDiaContratacion] = useState<string>('');
  const [manualQuincena, setManualQuincena] = useState<string>(() => {
    const today = new Date();
    const day = today.getDate();
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    const month = monthNames[today.getMonth()];
    return day <= 15 ? `1ª Quincena de ${month}` : `2ª Quincena de ${month}`;
  });

  const memorizeTelefono = (phone: string) => {
    if (!phone || !phone.trim()) return;
    const cleanPhone = phone.trim();
    if (!savedTelefonos.includes(cleanPhone)) {
      const updated = [...savedTelefonos, cleanPhone];
      if (onUpdateSavedTelefonos) {
        onUpdateSavedTelefonos(updated);
      }
    }
  };

  // Persistencia directa de citaciones en Supabase
  const [latestGeneratedCitas, setLatestGeneratedCitasState] = useState<ScheduledCita[]>([]);
  const suppressCitaPersistenceRef = React.useRef(false);
  const hydratedCitasRef = React.useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToDocuments<ScheduledCita>('citas', items => {
      suppressCitaPersistenceRef.current = true;
      setLatestGeneratedCitasState(items);
      hydratedCitasRef.current = true;
      queueMicrotask(() => { suppressCitaPersistenceRef.current = false; });
    }, { includeShared: true }, error => {
      console.error('Error leyendo citas de Supabase:', error);
      onToast('No se pudieron cargar las citas desde Supabase.', 'error');
    });
    return () => unsubscribe();
  }, []);

  const setLatestGeneratedCitas = useCallback((action: React.SetStateAction<ScheduledCita[]>) => {
    setLatestGeneratedCitasState(previous => {
      const next = typeof action === 'function' ? (action as (prev: ScheduledCita[]) => ScheduledCita[])(previous) : action;
      const withIds = next.map(item => item.id ? item : { ...item, id: crypto.randomUUID() });
      if (!suppressCitaPersistenceRef.current && hydratedCitasRef.current) {
        const nextIds = new Set(withIds.map(item => item.id));
        const removed = previous.filter(item => item.id && !nextIds.has(item.id));
        void Promise.all([
          ...withIds.map(item => createDocument('citas', item.id!, item as any)),
          ...removed.map(item => deleteDocument('citas', item.id!)),
        ]).catch(error => {
          console.error('Error guardando citas en Supabase:', error);
          onToast('No se pudieron guardar las citas en Supabase.', 'error');
        });
      }
      return withIds;
    });
  }, []);


  // Selected ticket index for active visual A4 mockup preview
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number>(0);

  // Google Calendar Modal state
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [modalCalendarEvents, setModalCalendarEvents] = useState<CalendarEventInput[]>([]);

  const handleOpenCalendarModalForCitas = () => {
    if (latestGeneratedCitas.length === 0) {
      onToast("No hay citas registradas para exportar a Google Calendar.", "error");
      return;
    }

    const events: CalendarEventInput[] = latestGeneratedCitas.map((c, i) => ({
      summary: `Reconocimiento Médico PROFEA ${c.obra ? `- ${c.obra}` : ''} (Cita #${i + 1})`,
      description: `Citación médica PROFEA\nObra: ${c.obra || '-'}\nNº Oferta: ${c.numOferta || '-'}\nQuincena: ${c.quincena || '-'}\nComienzo Obra: ${c.diaComienzo ? formatDate(c.diaComienzo) : '-'}\nSupervisor: ${c.supervisorResponsable || '-'}${c.telefonoSupervisor ? ` (${c.telefonoSupervisor})` : ''}`,
      location: c.sitioReconocimiento || 'Centro de Prevención Diputación de Cádiz',
      startIsoDate: c.citaDia,
      time: c.citaHora || '08:00',
      durationMinutes: 15
    }));

    setModalCalendarEvents(events);
    setIsCalendarModalOpen(true);
  };

  useEffect(() => {
    if (latestGeneratedCitas.length > 0 && selectedPreviewIndex >= latestGeneratedCitas.length) setSelectedPreviewIndex(0);
  }, [latestGeneratedCitas, selectedPreviewIndex]);

  // Auto-detect supervisor when manualObra or manualNumOferta changes
  useEffect(() => {
    let supName = '';
    if (manualObra) {
      const found = people.find(
        p => p.obra?.trim().toLowerCase() === manualObra.trim().toLowerCase() && p.supervisorResponsable?.trim()
      );
      if (found) {
        supName = found.supervisorResponsable;
      }
    }
    if (!supName && manualNumOferta) {
      const found = people.find(
        p => p.numOferta?.trim().toLowerCase() === manualNumOferta.trim().toLowerCase() && p.supervisorResponsable?.trim()
      );
      if (found) {
        supName = found.supervisorResponsable;
      }
    }

    if (supName) {
      setManualSupervisor(supName);
      // Try to find if we have a phone number for this supervisor in recent appointments or saved lists
      const foundCitaWithPhone = latestGeneratedCitas.find(
        c => c.supervisorResponsable?.trim().toLowerCase() === supName.trim().toLowerCase() && c.telefonoSupervisor?.trim()
      );
      if (foundCitaWithPhone && foundCitaWithPhone.telefonoSupervisor) {
        setManualTelefonoSupervisor(foundCitaWithPhone.telefonoSupervisor);
      } else {
        setManualTelefonoSupervisor('');
      }
    }
  }, [manualObra, manualNumOferta, people]);

  // Auto-detect supervisor's phone when supervisor name changes manually
  useEffect(() => {
    if (manualSupervisor) {
      const foundCitaWithPhone = latestGeneratedCitas.find(
        c => c.supervisorResponsable?.trim().toLowerCase() === manualSupervisor.trim().toLowerCase() && c.telefonoSupervisor?.trim()
      );
      if (foundCitaWithPhone && foundCitaWithPhone.telefonoSupervisor) {
        setManualTelefonoSupervisor(foundCitaWithPhone.telefonoSupervisor);
      }
    }
  }, [manualSupervisor, latestGeneratedCitas]);

  // Handle AI Prompt Order
  const handleAIOrder = async () => {
    if (!aiPrompt.trim()) {
      onToast("Por favor, introduzca una instrucción u orden para la IA.", "error");
      return;
    }

    setIsAiGenerating(true);
    try {
      const response = await fetch('/api/schedule-appointments-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workers: [], // Tickets are anonymous, no system workers needed
          instructions: aiPrompt,
          savedSitios: savedSitios.length > 0 ? savedSitios : [selectedDefaultSite],
          workStartHour,
          workEndHour
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Error en la respuesta del servidor de IA.");
      }

      const data = await response.json();
      if (data.success && data.schedule) {
        const schedule: ScheduledCita[] = data.schedule;

        if (schedule.length === 0) {
          onToast("La IA no devolvió ninguna citación estructurada. Intente reformular su orden.", "error");
          return;
        }

        // Enrich generated items with auto-detected supervisor names and supervisor phone numbers
        const enrichedSchedule = schedule.map(item => {
          let supervisor = item.supervisorResponsable || '';
          if (!supervisor && item.obra) {
            const found = people.find(p => p.obra?.trim().toLowerCase() === item.obra?.trim().toLowerCase() && p.supervisorResponsable?.trim());
            if (found) {
              supervisor = found.supervisorResponsable;
            }
          }

          let telSup = item.telefonoSupervisor || '';
          if (!telSup && supervisor) {
            const prevCita = latestGeneratedCitas.find(
              c => c.supervisorResponsable?.trim().toLowerCase() === supervisor.trim().toLowerCase() && c.telefonoSupervisor?.trim()
            );
            if (prevCita && prevCita.telefonoSupervisor) {
              telSup = prevCita.telefonoSupervisor;
            }
          }

          const getQuincenaFromDate = (dateStr: string) => {
            if (!dateStr) return '';
            try {
              const parts = dateStr.split('-');
              const day = parseInt(parts[2], 10);
              const monthIdx = parseInt(parts[1], 10) - 1;
              const monthNames = [
                'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
              ];
              const month = monthNames[monthIdx];
              return day <= 15 ? `1ª Quincena de ${month}` : `2ª Quincena de ${month}`;
            } catch(e) {
              return '';
            }
          };

          return {
            ...item,
            quincena: item.quincena || getQuincenaFromDate(item.citaDia),
            supervisorResponsable: supervisor,
            telefonoSupervisor: telSup
          };
        });

        // Prepend new appointments to current list
        setLatestGeneratedCitas(prev => [...enrichedSchedule, ...prev]);
        setSelectedPreviewIndex(0);

        // Download PDF immediately
        const ticketsData: TicketData[] = enrichedSchedule.map(item => {
          return {
            apellidosNombre: '', // strictly anonymous
            dni: '',
            obra: item.obra || 'BORNOS',
            numOferta: item.numOferta || '11002GR',
            quincena: item.quincena,
            citaDia: item.citaDia,
            citaHora: item.citaHora,
            sitioReconocimiento: item.sitioReconocimiento,
            supervisorResponsable: item.supervisorResponsable,
            telefono: item.telefonoSupervisor || '',
            diaComienzo: item.diaComienzo,
            workStartHour: workStartHour,
            diaContratacion: item.diaContratacion || ''
          };
        });

        const supervisorPhones: { [key: string]: string } = {};
        enrichedSchedule.forEach(item => {
          if (item.supervisorResponsable) {
            if (item.telefonoSupervisor) {
              supervisorPhones[item.supervisorResponsable] = item.telefonoSupervisor;
            } else if (!supervisorPhones[item.supervisorResponsable] && savedTelefonos[0]) {
              supervisorPhones[item.supervisorResponsable] = savedTelefonos[0];
            }
          }
        });

        const { doc, filename } = await generateMedicalTicketsPDF(ticketsData, supervisorPhones, workStartHour);
        doc.save(filename);

        onToast(`¡IA completada! Se han generado ${schedule.length} citas médicas y se ha descargado el PDF de tickets.`, "success");
        setAiPrompt('');
      } else {
        throw new Error("No se pudo procesar la orden con la IA.");
      }
    } catch (error: any) {
      console.error("AI Order Error:", error);
      onToast(error.message || "Error al comunicarse con la IA.", "error");
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Handle Manual Fast Batch Generation
  const handleManualBatchGenerate = async () => {
    if (!manualCitaDia) {
      onToast("Debe seleccionar el día de las citas.", "error");
      return;
    }
    if (!manualCitaHora) {
      onToast("Debe especificar la hora inicial de las citas.", "error");
      return;
    }

    const generated: ScheduledCita[] = [];
    const baseHourMinutes = parseTime(manualCitaHora);

    for (let i = 0; i < manualCount; i++) {
      const slotIndex = Math.floor(i / manualWorkersPerSlot);
      const slotMinutes = baseHourMinutes + slotIndex * manualInterval;
      const timeStr = formatTime(slotMinutes);
      
      generated.push({
        citaDia: manualCitaDia,
        citaHora: timeStr,
        sitioReconocimiento: manualSitio,
        obra: manualObra || 'BORNOS',
        numOferta: manualNumOferta || '11002GR',
        quincena: manualQuincena,
        diaComienzo: manualDiaComienzo || manualCitaDia,
        diaFinContrato: manualDiaFinContrato || '',
        supervisorResponsable: manualSupervisor || '',
        telefonoSupervisor: manualTelefonoSupervisor || '',
        diaContratacion: manualDiaContratacion || ''
      });
    }

    if (manualTelefonoSupervisor) {
      memorizeTelefono(manualTelefonoSupervisor);
    }

    setLatestGeneratedCitas(prev => [...generated, ...prev]);
    setSelectedPreviewIndex(0);

    // Export PDF immediately
    const ticketsData: TicketData[] = generated.map(item => ({
      apellidosNombre: '', // strictly anonymous
      dni: '',
      obra: item.obra,
      numOferta: item.numOferta,
      quincena: item.quincena,
      citaDia: item.citaDia,
      citaHora: item.citaHora,
      sitioReconocimiento: item.sitioReconocimiento,
      supervisorResponsable: item.supervisorResponsable || '',
      telefono: item.telefonoSupervisor || '',
      diaComienzo: item.diaComienzo,
      diaFinContrato: item.diaFinContrato,
      workStartHour: workStartHour,
      diaContratacion: item.diaContratacion
    }));

    const supervisorPhones: { [key: string]: string } = {};
    if (manualSupervisor) {
      if (manualTelefonoSupervisor) {
        supervisorPhones[manualSupervisor] = manualTelefonoSupervisor;
      } else if (savedTelefonos[0]) {
        supervisorPhones[manualSupervisor] = savedTelefonos[0];
      }
    }

    const { doc, filename } = await generateMedicalTicketsPDF(ticketsData, supervisorPhones, workStartHour);
    doc.save(filename);

    onToast(`Se han generado manualmente ${manualCount} citas anónimas escalonadas y se ha descargado el PDF.`, "success");
  };

  // Helper to parse "HH:MM" to total minutes
  const parseTime = (time: string): number => {
    const parts = time.split(':');
    const h = parseInt(parts[0] || '8', 10);
    const m = parseInt(parts[1] || '0', 10);
    return h * 60 + m;
  };

  // Helper to format total minutes to "HH:MM"
  const formatTime = (totalMin: number): string => {
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  // Download PDF of the whole current history or selected appointments
  const handleDownloadAllHistoryPDF = async () => {
    if (latestGeneratedCitas.length === 0) {
      onToast("No hay citas registradas para exportar.", "error");
      return;
    }

    const ticketsData: TicketData[] = latestGeneratedCitas.map(item => {
      let supervisor = item.supervisorResponsable || '';
      if (!supervisor && item.obra) {
        const found = people.find(p => p.obra?.trim().toLowerCase() === item.obra?.trim().toLowerCase() && p.supervisorResponsable?.trim());
        if (found) {
          supervisor = found.supervisorResponsable;
        }
      }
      return {
        apellidosNombre: '', // strictly anonymous
        dni: '',
        obra: item.obra,
        numOferta: item.numOferta,
        quincena: item.quincena,
        citaDia: item.citaDia,
        citaHora: item.citaHora,
        sitioReconocimiento: item.sitioReconocimiento,
        supervisorResponsable: supervisor,
        telefono: item.telefonoSupervisor || '',
        diaComienzo: item.diaComienzo,
        diaFinContrato: item.diaFinContrato,
        workStartHour: workStartHour,
        diaContratacion: item.diaContratacion
      };
    });

    const supervisorPhones: { [key: string]: string } = {};
    latestGeneratedCitas.forEach(item => {
      if (item.supervisorResponsable) {
        if (item.telefonoSupervisor) {
          supervisorPhones[item.supervisorResponsable] = item.telefonoSupervisor;
        } else if (!supervisorPhones[item.supervisorResponsable] && savedTelefonos[0]) {
          supervisorPhones[item.supervisorResponsable] = savedTelefonos[0];
        }
      }
    });

    const { doc, filename } = await generateMedicalTicketsPDF(ticketsData, supervisorPhones, workStartHour);
    doc.save(filename);
    onToast(`Se ha descargado el documento PDF con las ${latestGeneratedCitas.length} citas médicas.`, "success");
  };

  // Quick preset loader helper
  const applyPreset = (text: string) => {
    setAiPrompt(text);
    onToast("Orden cargada en el asistente de IA.", "success");
  };

  // Clear current active list
  const handleClearList = () => {
    if (confirm("¿Está seguro de que desea limpiar el historial reciente de citaciones generadas?")) {
      setLatestGeneratedCitas([]);
      setSelectedPreviewIndex(0);
      onToast("Historial de citas médicas limpiado.", "success");
    }
  };

  // Delete a single ticket from history
  const handleDeleteSingleTicket = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setLatestGeneratedCitas(prev => {
      const updated = prev.filter((_, idx) => idx !== index);
      if (selectedPreviewIndex >= updated.length && updated.length > 0) {
        setSelectedPreviewIndex(updated.length - 1);
      }
      return updated;
    });
    onToast("Ticket eliminado del historial.", "success");
  };

  const activeTicket = latestGeneratedCitas[selectedPreviewIndex] || null;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* 1. Header Banner */}
      <div className="bg-[var(--ui-gradient-brand)] text-white rounded-[var(--ui-radius-xl)] p-6 sm:p-8 shadow-[var(--ui-shadow-md)] relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-96 h-96 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 translate-y-24 w-64 h-64 rounded-full bg-blue-500/10 pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <span className="text-xs font-bold tracking-widest uppercase text-blue-200">ÁREA DE COOPERACIÓN | GESTIÓN PROFEA DIPUTACIÓN DE CÁDIZ</span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Citaciones para Reconocimiento Médico</h1>
            <p className="text-sm text-blue-100 max-w-2xl font-medium">
              Gestione y genere de forma ágil, rápida y anónima los resguardos para el reconocimiento médico. 
              Los tickets son 100% anónimos para rellenar a mano el día de la firma del contrato PROFEA.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 bg-white/10 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/15">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-blue-200">DOCUMENTO OFICIAL</div>
              <div className="text-sm font-bold">Fichas en Blanco (A4)</div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Main Centered Layout */}
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Navigation Selector between Reconocimientos Médicos & Generador de Citas */}
        <div className="ui-surface p-2 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('reconocimientos')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'reconocimientos'
                ? 'bg-[#00548E] text-white shadow-md'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Reconocimientos Médicos (IA PDF)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'ai'
                ? 'bg-[#00548E] text-white shadow-md'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>Planificar Citas (IA)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'manual'
                ? 'bg-[#00548E] text-white shadow-md'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            <span>Generador Manual Citas</span>
          </button>
        </div>

        {/* SECTION: Reconocimientos Médicos de Trabajadores Contratados */}
        {activeTab === 'reconocimientos' && (
          <ReconocimientosMedicosSection
            people={people}
            onUpdatePeople={onUpdatePeople}
            onToast={onToast}
          />
        )}

        {/* SECTION: Citaciones Médicas (AI y Manual) */}
        {activeTab !== 'reconocimientos' && (
        <div className="space-y-6">
          
          {/* Card: Configuración de la hora de comienzo de trabajo */}
          <div className="ui-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-[#00548E]/10 dark:bg-blue-500/20 text-[#00548E] dark:text-blue-400 rounded-2xl">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wider">Hora de Entrada (Comienzo del Trabajo)</h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">Defina la hora oficial de entrada que aparecerá impresa en los resguardos.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-2xl border border-slate-100 dark:border-slate-800">
              <input
                type="time"
                value={workStartHour}
                onChange={(e) => {
                  if (onUpdateWorkStartHour) {
                    onUpdateWorkStartHour(e.target.value);
                    onToast(`Hora de comienzo de trabajo establecida en ${e.target.value} h`, "success");
                  }
                }}
                className="px-3 py-1.5 text-xs font-bold bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#00548E]"
              />
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 pr-1">h</span>
            </div>
          </div>
          
          {/* Card: Generador de Citaciones */}
          <div className="ui-surface p-6 space-y-6">
            
            {/* Tabs for choosing generator method */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl w-full sm:w-auto">
                <button
                  onClick={() => setActiveTab('ai')}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all w-1/2 sm:w-auto cursor-pointer ${
                    activeTab === 'ai' 
                      ? 'bg-white dark:bg-slate-900 text-[#00548E] dark:text-blue-400 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Asistente con IA
                </button>
                <button
                  onClick={() => setActiveTab('manual')}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all w-1/2 sm:w-auto cursor-pointer ${
                    activeTab === 'manual' 
                      ? 'bg-white dark:bg-slate-900 text-[#00548E] dark:text-blue-400 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  Generador Manual
                </button>
              </div>
              <span className="hidden sm:inline-block text-[11px] font-bold text-[#00548E] dark:text-blue-400 uppercase tracking-widest">
                {activeTab === 'ai' ? 'IA ACTIVA' : 'SISTEMA RÁPIDO'}
              </span>
            </div>

            {/* TAB CONTENT: AI ASSISTANT */}
            {activeTab === 'ai' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-2xl p-4 flex items-start gap-3">
                  <Info className="w-5 h-5 text-[#00548E] dark:text-blue-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs text-slate-600 dark:text-slate-350">
                    <p className="font-semibold text-[#00548E] dark:text-blue-400">¿Cómo dar una orden a la IA?</p>
                    <p>La IA analizará sus instrucciones de manera inteligente. Puede pedirle el número de trabajadores, el día, la hora de inicio, el centro médico e inclusive el día de comienzo de la obra. La IA calculará los horarios escalonados de manera automatizada.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    Instrucción libre para planificar
                  </label>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Ej: Para el día 13 de febrero de 2026, cita a 11 trabajadores en Bornos en el/a UNIDAD MOVIL de 2 en 2 cada 10 min a partir de las 08:10. La obra nº es la 11002GR y empieza el día 16 de febrero de 2026."
                    rows={4}
                    className="w-full p-4 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#00548E] focus:ring-1 focus:ring-[#00548E] placeholder:text-slate-400 font-medium leading-relaxed"
                  />
                </div>

                {/* Quick Preset Buttons */}
                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Órdenes rápidas recomendadas (PROFEA Cádiz):</span>
                  <div className="grid grid-cols-1 gap-2.5">
                    <button 
                      onClick={() => applyPreset("Cita a 11 trabajadores el día 13-02-2026 a las 08:10 horas en el/a UNIDAD MOVIL UBICADA EN BORNOS: NAVE DEL AYUNTAMIENTO, CALLE BLAS INFANTE S/N, BORNOS, de la obra nº 11002GR. El día de comienzo de la obra está previsto para el lunes 16-02-2026.")}
                      className="text-left p-3 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-150 dark:border-slate-800 rounded-xl transition-colors flex items-start gap-2.5 group"
                    >
                      <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="font-bold text-[11px] text-[#00548E] dark:text-blue-400">Bornos PROFEA - 11 trabajadores (13-02-2026)</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">11 citas a las 08:10 h en Unidad Móvil Bornos. Comienzo de obra el 16-02-2026.</div>
                      </div>
                    </button>

                    <button 
                      onClick={() => applyPreset("Por favor, planifica 6 citas médicas para el día 22 de julio de 2026, a partir de las 09:00 de la mañana en el Centro de Prevención Diputación de Cádiz, de 1 en 1 cada 10 minutos. Es la obra 11005GR de Bornos y el comienzo del trabajo es el día 27-07-2026.")}
                      className="text-left p-3 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-150 dark:border-slate-800 rounded-xl transition-colors flex items-start gap-2.5 group"
                    >
                      <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="font-bold text-[11px] text-[#00548E] dark:text-blue-400">Escalonado Manual - 6 trabajadores (22-07-2026)</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">Citas de 1 en 1 cada 10 minutos. Comienzo de obra el 27-07-2026.</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Site choice for backup and trigger button */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 items-end">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Centro de Prevención Recomendado</label>
                    <input 
                      type="text"
                      list="sitios-sugeridos"
                      value={selectedDefaultSite}
                      onChange={(e) => setSelectedDefaultSite(e.target.value)}
                      placeholder="Ej: Centro de Prevención Diputación"
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#00548E]"
                    />
                    <datalist id="sitios-sugeridos">
                      {savedSitios.map(s => <option key={s} value={s} />)}
                      <option value="Centro de Prevención de la Diputación de Cádiz" />
                      <option value="UNIDAD MOVIL UBICADA EN BORNOS: NAVE DEL AYUNTAMIENTO, CALLE BLAS INFANTE S/N, BORNOS" />
                    </datalist>
                  </div>

                  <button
                    onClick={handleAIOrder}
                    disabled={isAiGenerating}
                    className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-[#00548E] hover:from-blue-700 hover:to-[#004270] disabled:from-slate-300 disabled:to-slate-400 text-white rounded-xl text-xs font-extrabold tracking-wider uppercase shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer h-[38px]"
                  >
                    {isAiGenerating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Procesando Orden...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Organizar e Imprimir con IA
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB CONTENT: DIRECT MANUAL BUILDER */}
            {activeTab === 'manual' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Nº de Citas</label>
                    <input 
                      type="number"
                      min={1}
                      max={100}
                      value={manualCount}
                      onChange={(e) => setManualCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Trabajadores por Cita</label>
                    <input 
                      type="number"
                      min={1}
                      max={20}
                      value={manualWorkersPerSlot}
                      onChange={(e) => setManualWorkersPerSlot(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Día de Cita</label>
                    <input 
                      type="date"
                      value={manualCitaDia}
                      onChange={(e) => setManualCitaDia(e.target.value)}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Hora Inicial</label>
                    <input 
                      type="text"
                      placeholder="Ej: 08:00"
                      value={manualCitaHora}
                      onChange={(e) => setManualCitaHora(e.target.value)}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Escalonado (min)</label>
                    <input 
                      type="number"
                      min={0}
                      max={60}
                      value={manualInterval}
                      onChange={(e) => setManualInterval(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Código/Nº Oferta</label>
                    <input 
                      type="text"
                      value={manualNumOferta}
                      onChange={(e) => setManualNumOferta(e.target.value)}
                      placeholder="Ej: 11002GR"
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Localidad Obra</label>
                    <input 
                      type="text"
                      value={manualObra}
                      onChange={(e) => setManualObra(e.target.value)}
                      placeholder="Ej: BORNOS"
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Quincena / Periodo</label>
                    <input 
                      type="text"
                      value={manualQuincena}
                      onChange={(e) => setManualQuincena(e.target.value)}
                      placeholder="Ej: 1ª Quincena de Julio"
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[#00548E] dark:text-blue-400 font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Día de Comienzo Obra</label>
                    <input 
                      type="date"
                      value={manualDiaComienzo}
                      onChange={(e) => setManualDiaComienzo(e.target.value)}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Fin de Contrato</label>
                    <input 
                      type="date"
                      value={manualDiaFinContrato}
                      onChange={(e) => setManualDiaFinContrato(e.target.value)}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  
                  <div className="space-y-1.5 col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Lugar del Reconocimiento Médico</label>
                    <input 
                      type="text"
                      list="manual-sitios-list"
                      value={manualSitio}
                      onChange={(e) => setManualSitio(e.target.value)}
                      placeholder="Ej: Unidad Móvil Bornos"
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                    <datalist id="manual-sitios-list">
                      {savedSitios.map(s => <option key={s} value={s} />)}
                      <option value="UNIDAD MOVIL UBICADA EN BORNOS: NAVE DEL AYUNTAMIENTO, CALLE BLAS INFANTE S/N, BORNOS" />
                      <option value="Centro de Prevención de la Diputación de Cádiz" />
                    </datalist>
                  </div>

                  <div className="space-y-1.5 col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Supervisor (Opcional)</label>
                    <input 
                      type="text"
                      value={manualSupervisor}
                      onChange={(e) => setManualSupervisor(e.target.value)}
                      placeholder="Ej: Francisco Gómez"
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5 col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Teléfono Supervisor</label>
                    <input 
                      type="tel"
                      list="manual-telefonos-list"
                      value={manualTelefonoSupervisor}
                      onChange={(e) => setManualTelefonoSupervisor(e.target.value)}
                      placeholder="Ej: 600 123 456"
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <datalist id="manual-telefonos-list">
                      {savedTelefonos.map(t => <option key={t} value={t} />)}
                    </datalist>
                  </div>

                  <div className="space-y-1.5 col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Día de Contratación (Firma)</label>
                    <input 
                      type="date"
                      value={manualDiaContratacion}
                      onChange={(e) => setManualDiaContratacion(e.target.value)}
                      className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                </div>

                <button
                  onClick={handleManualBatchGenerate}
                  className="w-full mt-2 py-3 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl text-xs font-bold tracking-wider uppercase shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Generar y Descargar Lote Manual
                </button>
              </div>
            )}

          </div>

          {/* Card: Historial Reciente de Citas */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Citaciones Recientemente Planificadas</h3>
                  <p className="text-[11px] text-slate-400">Listado de tickets generados en su sesión actual ({latestGeneratedCitas.length})</p>
                </div>
              </div>
              
              {latestGeneratedCitas.length > 0 && (
                <button
                  onClick={handleClearList}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpiar Todo
                </button>
              )}
            </div>

            {latestGeneratedCitas.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-2.5 text-slate-400">
                <Calendar className="w-8 h-8 opacity-60" />
                <p className="text-xs font-semibold">No se han generado citaciones anónimas todavía.</p>
                <p className="text-[10px] text-slate-500 max-w-sm">Use el Asistente con IA de arriba o cargue un lote manual para comenzar a imprimir de inmediato.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden max-h-[300px] overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/80 dark:bg-slate-850/60 border-b border-slate-100 dark:border-slate-800 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                        <th className="py-2.5 px-3">Lugar del Reconocimiento</th>
                        <th className="py-2.5 px-3">Obra / Inicio</th>
                        <th className="py-2.5 px-3 text-right">Día y Hora</th>
                        <th className="py-2.5 px-3 text-center w-12">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      {latestGeneratedCitas.map((cita, idx) => {
                        const isSelected = selectedPreviewIndex === idx;
                        return (
                          <tr 
                            key={idx}
                            onClick={() => setSelectedPreviewIndex(idx)}
                            className={`cursor-pointer transition-all ${
                              isSelected 
                                ? 'bg-[#00548E]/10 dark:bg-blue-950/30 font-bold border-l-4 border-[#00548E] dark:border-blue-400' 
                                : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/10'
                            }`}
                          >
                            <td className="py-3 px-3">
                              <div className="text-slate-800 dark:text-slate-100 truncate max-w-[170px]" title={cita.sitioReconocimiento}>
                                🏥 {cita.sitioReconocimiento}
                              </div>
                              <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                                Ticket #{latestGeneratedCitas.length - idx} (Anónimo)
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="text-slate-700 dark:text-slate-350 truncate max-w-[130px]" title={`Obra: ${cita.obra}`}>
                                🏗️ {cita.obra || 'BORNOS'}
                              </div>
                              <div className="text-[9px] font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                                <span className="font-mono text-[#00548E] dark:text-blue-300">[{cita.numOferta || '11002GR'}]</span>
                                📅 Inicio: {cita.diaComienzo ? formatDate(cita.diaComienzo) : '-'}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <span className="inline-block px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950/45 text-blue-700 dark:text-blue-300 rounded font-bold text-[9px] tracking-wide">
                                {formatDate(cita.citaDia)}
                              </span>
                              <div className="text-[11px] font-bold text-slate-700 dark:text-slate-350 mt-1 font-mono">
                                ⏰ {cita.citaHora} h
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                onClick={(e) => handleDeleteSingleTicket(idx, e)}
                                className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Eliminar este ticket"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Panel de Edición/Detalle de Citación Seleccionada */}
                {activeTicket && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-850/50 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                      <h4 className="text-xs font-extrabold text-[#00548E] dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Info className="w-4 h-4 text-[#00548E] dark:text-blue-400" />
                        Modificar Datos del Ticket #{latestGeneratedCitas.length - selectedPreviewIndex}
                      </h4>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 text-slate-500 rounded">ANÓNIMO</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lugar Reconocimiento</label>
                        <input
                          type="text"
                          list="edit-sitios-list"
                          value={activeTicket.sitioReconocimiento || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              sitioReconocimiento: e.target.value
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#00548E] dark:focus:ring-blue-500"
                        />
                        <datalist id="edit-sitios-list">
                          {savedSitios.map(s => <option key={s} value={s} />)}
                        </datalist>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Localidad Obra</label>
                          <input
                            type="text"
                            value={activeTicket.obra || ''}
                            onChange={(e) => {
                              const updated = [...latestGeneratedCitas];
                              updated[selectedPreviewIndex] = {
                                ...activeTicket,
                                obra: e.target.value
                              };
                              setLatestGeneratedCitas(updated);
                            }}
                            className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Código/Nº Oferta</label>
                          <input
                            type="text"
                            value={activeTicket.numOferta || ''}
                            onChange={(e) => {
                              const updated = [...latestGeneratedCitas];
                              updated[selectedPreviewIndex] = {
                                ...activeTicket,
                                numOferta: e.target.value
                              };
                              setLatestGeneratedCitas(updated);
                            }}
                            className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fecha Cita</label>
                        <input
                          type="date"
                          value={activeTicket.citaDia || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              citaDia: e.target.value
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Hora Cita</label>
                        <input
                          type="text"
                          value={activeTicket.citaHora || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              citaHora: e.target.value
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Quincena / Periodo</label>
                        <input
                          type="text"
                          value={activeTicket.quincena || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              quincena: e.target.value
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-[#00548E] dark:text-blue-400 font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Inicio Obra</label>
                        <input
                          type="date"
                          value={activeTicket.diaComienzo || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              diaComienzo: e.target.value
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fin Contrato</label>
                        <input
                          type="date"
                          value={activeTicket.diaFinContrato || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              diaFinContrato: e.target.value
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Día Firma Contrato</label>
                        <input
                          type="date"
                          value={activeTicket.diaContratacion || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              diaContratacion: e.target.value
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supervisor Responsable</label>
                        <input
                          type="text"
                          value={activeTicket.supervisorResponsable || ''}
                          onChange={(e) => {
                            const updated = [...latestGeneratedCitas];
                            const name = e.target.value;
                            let phone = activeTicket.telefonoSupervisor || '';
                            if (!phone) {
                              const found = latestGeneratedCitas.find(
                                c => c.supervisorResponsable?.trim().toLowerCase() === name.trim().toLowerCase() && c.telefonoSupervisor?.trim()
                              );
                              if (found && found.telefonoSupervisor) {
                                phone = found.telefonoSupervisor;
                              }
                            }
                            updated[selectedPreviewIndex] = {
                              ...activeTicket,
                              supervisorResponsable: name,
                              telefonoSupervisor: phone
                            };
                            setLatestGeneratedCitas(updated);
                          }}
                          placeholder="Ej: Francisco Gómez"
                          className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Teléfono Supervisor</label>
                        <div className="flex gap-2">
                          <input
                            type="tel"
                            list="edit-telefonos-list"
                            value={activeTicket.telefonoSupervisor || ''}
                            onChange={(e) => {
                              const updated = [...latestGeneratedCitas];
                              updated[selectedPreviewIndex] = {
                                ...activeTicket,
                                telefonoSupervisor: e.target.value
                              };
                              setLatestGeneratedCitas(updated);
                            }}
                            placeholder="Ej: 600 123 456"
                            className="w-full p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <datalist id="edit-telefonos-list">
                            {savedTelefonos.map(t => <option key={t} value={t} />)}
                          </datalist>

                          <button
                            type="button"
                            onClick={() => {
                              if (activeTicket.telefonoSupervisor) {
                                memorizeTelefono(activeTicket.telefonoSupervisor);
                                onToast(`Teléfono ${activeTicket.telefonoSupervisor} memorizado correctamente.`, "success");
                              } else {
                                onToast("Introduzca un teléfono primero para memorizar.", "error");
                              }
                            }}
                            className="px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/45 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40 rounded-xl text-[10px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-950/30 transition-all cursor-pointer flex items-center gap-1 shrink-0 uppercase tracking-wider"
                          >
                            <Check className="w-3 h-3" />
                            Memorizar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleDownloadAllHistoryPDF}
                    className="w-full py-2.5 border border-[#00548E] dark:border-blue-400 text-[#00548E] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                  >
                    <Download className="w-4 h-4" />
                    Descargar PDF ({latestGeneratedCitas.length})
                  </button>

                  <button
                    onClick={handleOpenCalendarModalForCitas}
                    className="w-full py-2.5 bg-[#00548E] hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                  >
                    <Calendar className="w-4 h-4" />
                    Añadir a Google Calendar
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
        )}

        {/* PDF Instructions / Especificaciones Técnicas del PDF */}
        <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-3 text-xs leading-relaxed">
          <span className="font-bold text-slate-700 dark:text-slate-300 block flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
            <Info className="w-4 h-4 text-[#00548E]" />
            Especificaciones Técnicas del PDF
          </span>
          <ul className="space-y-2 text-[11px] text-slate-600 dark:text-slate-400 list-inside list-disc">
            <li>
              <strong className="text-slate-700 dark:text-slate-300">Documento de 2 Páginas (A4)</strong>: El PDF incluye la Comunicación oficial y un Anexo legal de justificante de entrega con casillas de firma pre-rellenadas de manera autónoma.
            </li>
            <li>
              <strong className="text-slate-700 dark:text-slate-300">Totalmente Autónomo</strong>: Se descargará directamente al ordenador en un solo clic, listo para abrir e imprimir en papel.
            </li>
            <li>
              <strong className="text-slate-700 dark:text-slate-300">Convenio de la Construcción de Cádiz</strong>: El texto cumple legalmente con la citación obligatoria de la Ordenanza de Prevención de Cádiz.
            </li>
          </ul>
        </div>

      </div>

      {/* Google Calendar Modal */}
      <GoogleCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        events={modalCalendarEvents}
        title="Añadir Citaciones Médicas a Google Calendar"
        onToast={onToast}
      />

    </div>
  );
};
