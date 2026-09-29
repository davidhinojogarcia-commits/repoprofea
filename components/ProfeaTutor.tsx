import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleHelp, LifeBuoy, Loader2, MessageCircleQuestion, RotateCcw, Send, X } from 'lucide-react';
import type { ViewMode } from './Sidebar';
import {
  PROFEA_TUTOR_QUICK_QUESTIONS,
  PROFEA_TUTOR_VIEW_LABELS,
  getLocalTutorFallback,
  type ProfeaTutorView,
} from '../src/lib/profeaTutorKnowledge';

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
  onNavigate: (view: ViewMode) => void;
}

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const ProfeaTutor: React.FC<ProfeaTutorProps> = ({
  activeView,
  guidedMode = false,
  onNavigate,
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

  const ask = async (rawQuestion?: string, viewOverride?: ProfeaTutorView) => {
    const question = String(rawQuestion ?? input).trim();
    if (!question || busy) return;

    const userMessage: TutorMessage = { id: makeId(), role: 'user', text: question };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);

    try {
      const response = await fetch('/api/profea-tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          currentView: viewOverride || activeView,
          currentViewLabel: viewOverride ? (PROFEA_TUTOR_VIEW_LABELS[viewOverride] || activeLabel) : activeLabel,
          guidedMode,
          taskState,
          history: nextMessages.slice(-20).map(item => ({
            role: item.role,
            text: item.text,
            followUps: item.followUps || [],
            suggestedView: item.suggestedView || '',
          })),
        }),
      });

      if (!response.ok) throw new Error('Tutor no disponible');

      const data = await response.json();
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
      }]);
    } catch (error) {
      console.warn('Tutor PROFEA: usando ayuda local de respaldo.', error);
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
                      {message.role === 'assistant' && message.progressHint && (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                          {message.progressHint}
                        </div>
                      )}
                      {message.role === 'assistant' && message.suggestedView && (
                        <button
                          type="button"
                          onClick={() => navigate(message.suggestedView)}
                          className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-[#00548E] hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                        >
                          Ir a {message.suggestedLabel || PROFEA_TUTOR_VIEW_LABELS[message.suggestedView]}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {message.role === 'assistant' && Boolean(message.followUps?.length) && (
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
