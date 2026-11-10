import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => RecognitionInstance;

export function VisitVoiceDictation({ value, onChange, disabled = false, label = 'Dictar punto' }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [message, setMessage] = useState('');
  const recognition = useRef<RecognitionInstance | null>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const heard = useRef(new Set<number>());
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const w = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      const session = recognition.current;
      recognition.current = null;
      if (session) {
        session.onend = null;
        session.onresult = null;
        session.onerror = null;
        session.abort();
      }
    };
  }, []);

  const stop = () => {
    recognition.current?.stop();
    setListening(false);
    setInterim('');
  };

  const start = () => {
    if (disabled || recognition.current) return;
    const w = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) {
      setMessage('El reconocimiento de voz no está disponible en este navegador. Usa el micrófono del teclado.');
      return;
    }
    const session = new Constructor();
    session.lang = 'es-ES';
    session.continuous = true;
    session.interimResults = true;
    heard.current = new Set();
    session.onresult = event => {
      const fresh: string[] = [];
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i];
        const phrase = String(item?.[0]?.transcript || '').trim();
        if (!phrase) continue;
        if (item.isFinal) {
          if (!heard.current.has(i)) {
            heard.current.add(i);
            fresh.push(phrase);
          }
        } else pending += (pending ? ' ' : '') + phrase;
      }
      if (fresh.length) {
        const previous = latest.current.value;
        const updated = [previous.trimEnd(), ...fresh].filter(Boolean).join(' ');
        latest.current.value = updated;
        latest.current.onChange(updated.slice(0, 20000));
      }
      setInterim(pending);
    };
    session.onerror = event => {
      const error = event.error;
      setMessage(error === 'not-allowed' || error === 'service-not-allowed'
        ? 'Micrófono no autorizado. Revisa los permisos de Safari o utiliza el dictado del teclado.'
        : error === 'no-speech'
          ? 'No se detectó voz. Puedes volver a intentarlo.'
          : 'Se interrumpió el reconocimiento. El texto ya transcrito se conserva.');
      setInterim('');
    };
    session.onend = () => {
      if (recognition.current === session) recognition.current = null;
      setListening(false);
      setInterim('');
    };
    recognition.current = session;
    setMessage('');
    try {
      session.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setMessage('No se pudo iniciar el micrófono. Comprueba los permisos del navegador.');
    }
  };

  return <div className="space-y-1">
    <button type="button" disabled={disabled || (!supported && !listening)}
      onClick={listening ? stop : start}
      aria-pressed={listening}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00548E] disabled:opacity-60 ${listening ? 'border-red-600 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : 'border-slate-300 text-[#00548E] dark:border-slate-600 dark:text-blue-200'}`}>
      {listening ? <MicOff className="h-4 w-4" aria-hidden="true"/> : <Mic className="h-4 w-4" aria-hidden="true"/>}
      {listening ? 'Detener dictado' : label}
    </button>
    {listening && <p role="status" className="text-xs text-slate-600 dark:text-slate-300">Escuchando… {interim ? `Reconociendo: ${interim}` : 'habla con naturalidad.'}</p>}
    {!supported && <p className="text-xs text-slate-600 dark:text-slate-300">En este navegador puedes usar el micrófono del teclado para dictar.</p>}
    {message && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{message}</p>}
    {supported && <p className="text-xs text-slate-500 dark:text-slate-400">El navegador puede procesar tu voz mediante su servicio de reconocimiento. Revisa el texto antes de guardar.</p>}
  </div>;
}
