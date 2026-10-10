import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleHelp, LifeBuoy, Loader2, MessageCircleQuestion, RotateCcw, Send, X } from 'lucide-react';
import type { ViewMode } from './Sidebar';
import {
  PROFEA_TUTOR_QUICK_QUESTIONS,
  PROFEA_TUTOR_VIEW_LABELS,
  getLocalTutorFallback,
  type ProfeaTutorView,
} from '../src/lib/profeaTutorKnowledge';
import { supabase } from '../src/lib/supabase';
import { PREVENTION_CATEGORIES, preventionToday } from '../src/lib/prevention';

type TutorMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  suggestedView?: ProfeaTutorView;
  suggestedLabel?: string;
  followUps?: string[];
  progressHint?: string;
  checkQuestion?: string;
  checkOptions?: string[];
  verified?: boolean;
  incidentForm?: boolean;
  incidentDefaults?: Record<string, string>;
  toolSummaries?: string[];
  pendingConfirmation?: {
    token: string;
    action: string;
    title: string;
    recordsAffected: number;
    destination?: string;
    consequences: string;
  };
  resultCards?: Array<{
    kind: 'worker';
    id: string;
    title: string;
    subtitle: string;
  }>;
};

type TutorTaskState = {
  title: string;
  currentStep: number;
  totalSteps: number;
  status: 'idle' | 'active' | 'diagnostic' | 'completed';
  nextAction: string;
};

const EMPTY_TASK: TutorTaskState = {
  title: '',
  currentStep: 0,
  totalSteps: 0,
  status: 'idle',
  nextAction: '',
};

const TUTOR_SESSION_KEY = 'profea:tutor:conversation:v2';

interface ProfeaTutorProps {
  activeView: ViewMode;
  guidedMode?: boolean;
  activeObra?: string;
  activePeriod?: string;
  onNavigate: (view: ViewMode) => void;
  onApplyFilters?: (filters: { obra?: string; periodo?: string }) => void;
  onOpenWorker?: (worker: { id: string; name: string; obra?: string; periodo?: string }) => void;
}

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const ProfeaTutor: React.FC<ProfeaTutorProps> = ({
  activeView,
  guidedMode = false,
  activeObra = '',
  activePeriod = '',
  onNavigate,
  onApplyFilters,
  onOpenWorker,
}) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<TutorMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem(TUTOR_SESSION_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed?.messages) ? parsed.messages.slice(-30) : [];
    } catch {
      return [];
    }
  });
  const [taskState, setTaskState] = useState<TutorTaskState>(() => {
    try {
      const saved = sessionStorage.getItem(TUTOR_SESSION_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      return parsed?.taskState && typeof parsed.taskState === 'object'
        ? { ...EMPTY_TASK, ...parsed.taskState }
        : EMPTY_TASK;
    } catch {
      return EMPTY_TASK;
    }
  });
  const sessionGeneration = useRef(0);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id || '';
      const previous = sessionStorage.getItem('profea:tutor:user');
      if (previous !== userId) {
        sessionGeneration.current += 1;
        sessionStorage.removeItem(TUTOR_SESSION_KEY);
        setMessages([]); setTaskState(EMPTY_TASK);
      }
      sessionStorage.setItem('profea:tutor:user', userId);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeLabel = PROFEA_TUTOR_VIEW_LABELS[activeView as ProfeaTutorView] || 'GestionProfea';
  const lastAssistantId = useMemo(
    () => [...messages].reverse().find(message => message.role === 'assistant')?.id || '',
    [messages],
  );
  const universalActions = useMemo(() => {
    if (taskState.status === 'diagnostic') {
      return ['Sí, eso lo veo', 'No aparece', 'Me da un error', 'Prueba otra solución'];
    }
    if (taskState.status === 'completed') {
      return ['Repasemos lo que he hecho', 'Quiero hacer otra tarea', 'Volver al menú inicial'];
    }
    if (taskState.status === 'active') {
      return ['Ya lo he hecho · Continuar', 'No encuentro lo que me dices', '¿Qué viene después?', 'Explícamelo más despacio'];
    }
    return ['Guíame paso a paso', '¿Dónde tengo que entrar?', 'Explícame esta pantalla'];
  }, [taskState.status]);

  const greeting = useMemo(
    () => guidedMode
      ? `Estás en ${activeLabel}. Dime qué quieres hacer y te guío paso a paso con instrucciones sencillas.`
      : `Estás en ${activeLabel}. Pregúntame cómo hacer cualquier tarea en GestionProfea.`,
    [activeLabel, guidedMode],
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(TUTOR_SESSION_KEY, JSON.stringify({
        messages: messages.slice(-30),
        taskState,
      }));
    } catch {}
  }, [messages, taskState]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 40);
  }, [open, messages.length, busy, taskState.currentStep, taskState.status]);

  const resetTutor = () => {
    setMessages([]);
    setTaskState(EMPTY_TASK);
    setInput('');
    try { sessionStorage.removeItem(TUTOR_SESSION_KEY); } catch {}
    window.setTimeout(() => inputRef.current?.focus(), 40);
  };

  const navigate = (view?: ProfeaTutorView) => {
    if (!view || busy) return;
    onNavigate(view as ViewMode);
    const label = PROFEA_TUTOR_VIEW_LABELS[view] || view;
    window.setTimeout(() => {
      void ask(`Ya he abierto ${label}. Continúa guiándome desde aquí sin repetir los pasos anteriores.`, view);
    }, 120);
  };

  const ask = async (rawQuestion?: string, viewOverride?: ProfeaTutorView, confirmationToken?: string) => {
    const question = String(rawQuestion ?? input).trim();
    if (!question || busy) return;

    const requestGeneration = sessionGeneration.current;
    const userMessage: TutorMessage = { id: makeId(), role: 'user', text: question };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw Object.assign(new Error('Tu sesión no está disponible. Vuelve a iniciar sesión antes de ejecutar operaciones.'), { sessionError: true });
      const requestId = makeId();
      const response = await fetch('/api/profea-tutor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          requestId,
          question,
          confirmationToken: confirmationToken || undefined,
          currentView: viewOverride || activeView,
          currentViewLabel: viewOverride ? (PROFEA_TUTOR_VIEW_LABELS[viewOverride] || activeLabel) : activeLabel,
          guidedMode,
          context: {
            currentView: viewOverride || activeView,
            currentViewLabel: viewOverride ? (PROFEA_TUTOR_VIEW_LABELS[viewOverride] || activeLabel) : activeLabel,
            obra: activeObra,
            periodo: activePeriod,
            filters: { obra: activeObra, periodo: activePeriod },
          },
          taskState,
          history: nextMessages.slice(-20).map(item => ({
            role: item.role,
            text: item.text,
            followUps: item.followUps || [],
            suggestedView: item.suggestedView || '',
          })),
        }),
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw Object.assign(new Error(failure.error || 'El Tutor no pudo completar la operación. Comprueba el estado del módulo antes de repetirla.'), { sessionError: response.status === 401 || response.status === 403 });
      }

      const data = await response.json();
      if (requestGeneration !== sessionGeneration.current) return;
      if (confirmationToken) setMessages(current => current.map(item => ({ ...item, pendingConfirmation: undefined })));

      const clientActions = Array.isArray(data?.clientActions) ? data.clientActions : [];
      for (const action of clientActions) {
        if (action?.type === 'navigate' && action?.view) {
          onNavigate(action.view as ViewMode);
        } else if (action?.type === 'apply_filters') {
          onApplyFilters?.({
            obra: String(action?.obra || '').trim() || undefined,
            periodo: String(action?.periodo || '').trim() || undefined,
          });
        }
      }
      const answer = String(data?.answer || '').trim();
      if (!answer) throw new Error('Respuesta vacía');

      const followUps = Array.isArray(data?.followUps)
        ? data.followUps.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 4)
        : [];
      const interactiveFollowUps = followUps.length
        ? followUps
        : ['¿Cuál es el siguiente paso?', 'Explícame qué debo comprobar ahora', 'Tengo otra duda sobre este proceso'];
      const checkQuestion = String(data?.checkQuestion || '').trim();
      const checkOptions = Array.isArray(data?.checkOptions)
        ? data.checkOptions.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 4)
        : [];
      const nextTask: TutorTaskState = {
        title: String(data?.taskTitle || '').trim(),
        currentStep: Math.max(0, Number(data?.currentStep) || 0),
        totalSteps: Math.max(0, Number(data?.totalSteps) || 0),
        status: ['active','diagnostic','completed'].includes(String(data?.taskStatus))
          ? data.taskStatus
          : 'idle',
        nextAction: String(data?.nextAction || '').trim(),
      };
      const resultCards = Array.isArray(data?.toolResults)
        ? data.toolResults.flatMap((result: any) => {
            if (!['search_workers', 'list_pending_medical'].includes(String(result?.name)) || !Array.isArray(result?.data)) return [];
            return result.data.slice(0, 12).map((worker: any) => ({
              kind: 'worker' as const,
              id: String(worker?.id || ''),
              title: String(worker?.nombre || 'Trabajador'),
              subtitle: [worker?.obra, worker?.periodo, worker?.reconocimiento].filter(Boolean).join(' · '),
            }));
          })
        : [];
      setTaskState(nextTask);
      setMessages(current => [...current, {
        id: makeId(),
        role: 'assistant',
        text: answer,
        suggestedView: data?.suggestedView || undefined,
        suggestedLabel: data?.suggestedLabel || undefined,
        followUps: interactiveFollowUps,
        progressHint: String(data?.progressHint || '').trim() || undefined,
        checkQuestion: checkQuestion || undefined,
        checkOptions,
        verified: Boolean(data?.verified),
        incidentForm: Boolean(data?.incidentForm),
        incidentDefaults: data?.incidentDefaults || {},
        toolSummaries: Array.isArray(data?.toolResults)
          ? data.toolResults.map((result: any) => String(result?.summary || '').trim()).filter(Boolean).slice(0, 4)
          : [],
        pendingConfirmation: data?.pendingConfirmation?.token ? data.pendingConfirmation : undefined,
        resultCards,
      }]);
    } catch (error: any) {
      if (requestGeneration !== sessionGeneration.current) return;
      const operationRequested = /^(?:por favor[, ]+)?(?:registra|registrar|crea|crear|anota|anotar|guarda|guardar|borra|borrar|elimina|eliminar|aplica|aplicar|filtra|filtrar)\b/i.test(question.trim());
      if (error?.sessionError || operationRequested || confirmationToken) {
        setTaskState(current => ({ ...current, status: 'diagnostic' }));
        setMessages(current => [...current, { id: makeId(), role: 'assistant', text: error?.sessionError ? error.message : 'No se ha podido confirmar el resultado. Comprueba el estado del módulo antes de repetir la operación.', verified: false }]);
        return;
      }
      console.warn('Tutor PROFEA: usando ayuda local de respaldo.');
      const fallback = getLocalTutorFallback(question, activeView);
      if (taskState.status === 'idle') {
        setTaskState({
          title: 'Ayuda en GestionProfea',
          currentStep: 1,
          totalSteps: 0,
          status: 'active',
          nextAction: 'Continúa indicando qué ves en pantalla o qué paso has completado.',
        });
      }
      setMessages(current => [...current, {
        id: makeId(),
        role: 'assistant',
        text: fallback.answer,
        suggestedView: fallback.view,
        suggestedLabel: fallback.view ? PROFEA_TUTOR_VIEW_LABELS[fallback.view] : undefined,
        followUps: ['¿Cuál es el siguiente paso?', 'Explícamelo más despacio', 'Tengo otra duda sobre esto'],
        checkQuestion: '¿Has podido hacer el paso que te indiqué?',
        checkOptions: ['Sí, ya está', 'No lo encuentro', 'Me da un error'],
      }]);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            window.setTimeout(() => inputRef.current?.focus(), 80);
          }}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 sm:bottom-6 sm:right-6 z-[180] group flex items-center gap-2 rounded-full border border-white/55 bg-white/55 px-3.5 py-3 text-[#00548E] shadow-[0_10px_35px_rgba(15,42,75,0.18)] backdrop-blur-xl transition hover:bg-white/75 hover:shadow-[0_14px_42px_rgba(15,42,75,0.24)] dark:border-white/15 dark:bg-slate-900/55 dark:text-blue-200 dark:hover:bg-slate-900/75"
          style={{ WebkitBackdropFilter: 'blur(18px)', backdropFilter: 'blur(18px)' }}
          aria-label="Abrir Tutor PROFEA"
          title="Tutor PROFEA"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#00548E]/10 dark:bg-blue-300/10">
            <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="hidden sm:block max-w-0 overflow-hidden whitespace-nowrap text-sm font-black opacity-0 transition-all duration-200 group-hover:max-w-32 group-hover:opacity-100">
            Tutor PROFEA
          </span>
        </button>
      )}

      {open && (
        <section
          className="fixed z-[9900] inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-5 sm:bottom-5 w-auto sm:w-[390px] max-h-[min(76dvh,680px)] overflow-hidden rounded-[28px] border border-white/60 bg-white/82 shadow-[0_24px_70px_rgba(15,42,75,0.28)] backdrop-blur-2xl dark:border-white/15 dark:bg-slate-950/82"
          style={{ WebkitBackdropFilter: 'blur(26px)', backdropFilter: 'blur(26px)' }}
          aria-label="Tutor PROFEA"
        >
          <header className="flex items-start justify-between gap-3 border-b border-slate-200/70 bg-gradient-to-r from-[#00548E]/10 via-white/35 to-white/20 px-4 py-3.5 dark:border-slate-700/70 dark:from-blue-500/10 dark:via-slate-900/25 dark:to-slate-900/10">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#00548E] text-white shadow-sm">
                <LifeBuoy className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="font-black text-slate-950 dark:text-white">Tutor PROFEA</h2>
                <p className="truncate text-[11px] font-bold text-slate-500 dark:text-slate-300">Ayuda sobre {activeLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={resetTutor}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200/70 bg-white/65 text-slate-500 hover:bg-white dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-300"
                  aria-label="Empezar una ayuda nueva"
                  title="Nueva consulta"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200/70 bg-white/65 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-200"
                aria-label="Cerrar Tutor PROFEA"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="max-h-[calc(min(76dvh,680px)-150px)] overflow-y-auto px-4 py-4">
            {taskState.status !== 'idle' && taskState.title && (
              <div className="mb-3 rounded-2xl border border-blue-200/80 bg-blue-50/75 p-3 dark:border-blue-800/60 dark:bg-blue-950/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-black uppercase tracking-[.14em] text-[#00548E] dark:text-blue-300">Tarea en curso</div>
                    <div className="truncate text-sm font-black text-slate-900 dark:text-white">{taskState.title}</div>
                  </div>
                  {taskState.status === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : taskState.totalSteps > 0 ? (
                    <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-black text-[#00548E] dark:bg-slate-900/80 dark:text-blue-200">
                      {taskState.currentStep}/{taskState.totalSteps}
                    </span>
                  ) : null}
                </div>
                {taskState.nextAction && (
                  <div className="mt-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">{taskState.nextAction}</div>
                )}
                {taskState.status !== 'completed' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => void ask('Ya he completado este paso. Continúa con el siguiente sin repetir lo anterior.')} className="min-h-9 rounded-xl bg-[#00548E] px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                      Ya está · Siguiente
                    </button>
                    <button type="button" disabled={busy} onClick={() => void ask('Estoy atascado en este paso. Ayúdame a comprobarlo una cosa cada vez.')} className="min-h-9 rounded-xl border border-amber-300 bg-white/80 px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-50 dark:bg-slate-900/80 dark:text-amber-200">
                      Estoy atascado
                    </button>
                  </div>
                )}
              </div>
            )}
            {messages.length === 0 ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-blue-100/80 bg-blue-50/70 p-4 text-sm leading-6 text-slate-700 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-slate-200">
                  <div className="mb-1 flex items-center gap-2 font-black text-[#00548E] dark:text-blue-300">
                    <CircleHelp className="h-4 w-4" />
                    ¿En qué te ayudo?
                  </div>
                  {greeting}
                </div>
                <div className="space-y-2">
                  {PROFEA_TUTOR_QUICK_QUESTIONS.map(question => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => void ask(question)}
                      className="w-full rounded-2xl border border-slate-200/80 bg-white/60 px-3.5 py-3 text-left text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/70 dark:border-slate-700 dark:bg-slate-900/55 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/25"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map(message => (
                  <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={`max-w-[88%] rounded-2xl px-3.5 py-3 text-sm leading-6 ${
                      message.role === 'user'
                        ? 'bg-[#00548E] text-white rounded-br-md'
                        : 'border border-slate-200/80 bg-white/68 text-slate-800 rounded-bl-md dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-100'
                    }`}>
                      <div className="whitespace-pre-wrap">{message.text}</div>
                      {message.role === 'assistant' && message.id === lastAssistantId && message.incidentForm && (
                        <form className="mt-3 grid min-w-0 gap-3" onSubmit={event => {
                          event.preventDefault();
                          const values = new FormData(event.currentTarget);
                          const fields = ['obra', 'fecha', 'categoría', 'prioridad', 'título', 'tarea', 'descripción', 'medidas', 'responsable', 'plazo'];
                          const command = 'Registra una incidencia;\n' + fields.map(key => `${key}: ${String(values.get(key) || '').trim().replace(/[;\r\n]+/g, ', ')}`).join('\n');
                          void ask(command);
                        }}>
                          <p className="text-xs font-semibold">Se guardará al pulsar Registrar incidencia. Revisa la obra y los datos.</p>
                          {(['obra', 'fecha', 'título', 'tarea', 'descripción', 'medidas', 'responsable', 'plazo'] as const).map(field => (
                            <label key={field} className="grid min-w-0 gap-1 text-xs font-bold">
                              {field.charAt(0).toUpperCase() + field.slice(1)}
                              {field === 'descripción' || field === 'medidas' ? (
                                <textarea name={field} required={field === 'descripción'} rows={3} maxLength={1800} defaultValue={message.incidentDefaults?.[field.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] || ''} className="w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
                              ) : (
                                <input name={field} required={!['medidas', 'responsable', 'plazo'].includes(field)} type={field === 'fecha' || field === 'plazo' ? 'date' : 'text'} defaultValue={message.incidentDefaults?.[field.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] || (field === 'obra' ? activeObra : '')} max={field === 'fecha' ? preventionToday() : undefined} maxLength={field === 'título' || field === 'responsable' ? 200 : 300} className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
                              )}
                            </label>
                          ))}
                          <label className="grid gap-1 text-xs font-bold">Categoría
                            <select name="categoría" required defaultValue={PREVENTION_CATEGORIES.find(category => category.toLocaleLowerCase() === String(message.incidentDefaults?.categoria || '').toLocaleLowerCase()) || ''} className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white">
                              <option value="" disabled>Selecciona una categoría</option>
                              {PREVENTION_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-bold">Prioridad
                            <select name="prioridad" required defaultValue={['Baja', 'Media', 'Alta'].find(priority => priority.toLocaleLowerCase() === String(message.incidentDefaults?.prioridad || '').toLocaleLowerCase()) || ''} className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white">
                              <option value="" disabled>Selecciona la prioridad</option>
                              {['Baja', 'Media', 'Alta'].map(priority => <option key={priority} value={priority}>{priority}</option>)}
                            </select>
                          </label>
                          <button disabled={busy} type="submit" className="min-h-11 rounded-xl bg-[#00548E] px-3 py-2 font-bold text-white disabled:opacity-50">Registrar incidencia</button>
                        </form>
                      )}
                      {message.role === 'assistant' && message.verified && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[.08em] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Verificado
                        </div>
                      )}
                      {message.role === 'assistant' && message.toolSummaries && message.toolSummaries.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {message.toolSummaries.map((summary, index) => (
                            <div key={`${message.id}-tool-${index}`} className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                              {summary}
                            </div>
                          ))}
                        </div>
                      )}
                      {message.role === 'assistant' && message.resultCards && message.resultCards.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {message.resultCards.map(card => (
                            <div key={`${message.id}-worker-${card.id}`} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                              <div className="text-sm font-black text-slate-900 dark:text-white">{card.title}</div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">{card.subtitle}</div>
                              <button
                                type="button"
                                className="mt-2 min-h-10 rounded-xl bg-[#00548E] px-3 py-2 text-xs font-black text-white"
                                onClick={() => onOpenWorker?.({ id: card.id, name: card.title })}
                              >
                                Abrir trabajador
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {message.role === 'assistant' && message.pendingConfirmation && (
                        <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
                          <div className="text-sm font-black">{message.pendingConfirmation.title}</div>
                          <div className="mt-1 text-xs font-semibold">
                            Registros afectados: {message.pendingConfirmation.recordsAffected}
                          </div>
                          {message.pendingConfirmation.destination && (
                            <div className="mt-1 text-xs font-semibold">Destino: {message.pendingConfirmation.destination}</div>
                          )}
                          <div className="mt-1 text-xs">{message.pendingConfirmation.consequences}</div>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void ask(
                                `Confirmo: ${message.pendingConfirmation?.title || 'esta operación'}`,
                                undefined,
                                message.pendingConfirmation?.token,
                              )}
                              className="min-h-11 flex-1 rounded-xl bg-amber-700 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setMessages(current => current.map(item =>
                                item.id === message.id ? { ...item, pendingConfirmation: undefined } : item
                              ))}
                              className="min-h-11 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-black text-amber-900 disabled:opacity-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-100"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                      {message.role === 'assistant' && message.progressHint && (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                          {message.progressHint}
                        </div>
                      )}
                      {message.role === 'assistant' && message.id === lastAssistantId && message.suggestedView && (
                        <button
                          type="button"
                          onClick={() => navigate(message.suggestedView)}
                          className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-[#00548E] hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                        >
                          Ir a {message.suggestedLabel || PROFEA_TUTOR_VIEW_LABELS[message.suggestedView]}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {message.role === 'assistant' && message.id === lastAssistantId && message.checkQuestion && (
                        <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50/80 p-3 dark:border-blue-800 dark:bg-blue-950/30">
                          <div className="text-xs font-black leading-5 text-slate-800 dark:text-slate-100">{message.checkQuestion}</div>
                          {Boolean(message.checkOptions?.length) && (
                            <div className="mt-2 grid gap-2">
                              {message.checkOptions?.map((option, index) => (
                                <button
                                  key={`${message.id}-check-${index}`}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void ask(option)}
                                  className="min-h-9 rounded-xl border border-blue-200 bg-white/90 px-3 py-2 text-left text-xs font-black text-[#00548E] transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-slate-900/90 dark:text-blue-200"
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {message.role === 'assistant' && message.id === lastAssistantId && Boolean(message.followUps?.length) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.followUps?.map((suggestion, index) => (
                            <button
                              key={`${message.id}-follow-${index}`}
                              type="button"
                              disabled={busy}
                              onClick={() => void ask(suggestion)}
                              className="min-h-9 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-xs font-black text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-blue-700"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200/80 bg-white/68 px-3.5 py-3 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-300">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Preparando los pasos…
                    </div>
                  </div>
                )}
                {!busy && lastAssistantId && (
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/55">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-slate-500 dark:text-slate-400">Continuar la ayuda</div>
                    <div className="grid grid-cols-2 gap-2">
                      {universalActions.map(action => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => void ask(action)}
                          className="min-h-10 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] font-black leading-4 text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t border-slate-200/70 bg-white/55 p-3 dark:border-slate-700/70 dark:bg-slate-950/45">
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200/80 bg-white/75 p-2 shadow-inner dark:border-slate-700 dark:bg-slate-900/75">
              <textarea
                ref={inputRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                rows={1}
                placeholder="Cuéntame qué ves o qué quieres hacer ahora…"
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void ask()}
                disabled={busy || !input.trim()}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#00548E] text-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Enviar pregunta"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 px-1 text-[10px] leading-4 text-slate-400">
              Puedes seguir preguntando durante todo el proceso. El Tutor recuerda el hilo de esta conversación.
            </p>
          </div>
        </section>
      )}
    </>
  );
};

