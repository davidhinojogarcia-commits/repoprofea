import React, { useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleHelp, LifeBuoy, Loader2, MessageCircleQuestion, Send, X } from 'lucide-react';
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
};

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
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeLabel = PROFEA_TUTOR_VIEW_LABELS[activeView as ProfeaTutorView] || 'GestionProfea';

  const greeting = useMemo(
    () => guidedMode
      ? `Estás en ${activeLabel}. Dime qué quieres hacer y te guío paso a paso con instrucciones sencillas.`
      : `Estás en ${activeLabel}. Pregúntame cómo hacer cualquier tarea en GestionProfea.`,
    [activeLabel, guidedMode],
  );

  const navigate = (view?: ProfeaTutorView) => {
    if (!view) return;
    onNavigate(view as ViewMode);
    setOpen(false);
  };

  const ask = async (rawQuestion?: string) => {
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
          currentView: activeView,
          currentViewLabel: activeLabel,
          guidedMode,
          history: nextMessages.slice(-8).map(item => ({ role: item.role, text: item.text })),
        }),
      });

      if (!response.ok) throw new Error('Tutor no disponible');

      const data = await response.json();
      const answer = String(data?.answer || '').trim();
      if (!answer) throw new Error('Respuesta vacía');

      setMessages(current => [...current, {
        id: makeId(),
        role: 'assistant',
        text: answer,
        suggestedView: data?.suggestedView || undefined,
        suggestedLabel: data?.suggestedLabel || undefined,
      }]);
    } catch (error) {
      console.warn('Tutor PROFEA: usando ayuda local de respaldo.', error);
      const fallback = getLocalTutorFallback(question, activeView);
      setMessages(current => [...current, {
        id: makeId(),
        role: 'assistant',
        text: fallback.answer,
        suggestedView: fallback.view,
        suggestedLabel: fallback.view ? PROFEA_TUTOR_VIEW_LABELS[fallback.view] : undefined,
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200/70 bg-white/65 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-200"
              aria-label="Cerrar Tutor PROFEA"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="max-h-[calc(min(76dvh,680px)-150px)] overflow-y-auto px-4 py-4">
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
                placeholder="Pregúntame cómo hacer una tarea…"
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
              Ayuda de uso de GestionProfea. Comprueba los datos antes de realizar cambios administrativos.
            </p>
          </div>
        </section>
      )}
    </>
  );
};
