import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { workerTokenFromQr } from '../src/lib/workerQrScan';
import { decodeQrFrame } from '../src/lib/qrFrameDecoder';
import { resolveWorkerCardOwner } from '../src/services/workerQrShareService';

type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]> };
export default function WorkerCardScanner({ onClose, onFound, onRemoteToken }: { onClose: () => void; onFound?: (id: number) => boolean; onRemoteToken?: (token: string) => Promise<boolean> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onClose, onFound, onRemoteToken });
  const photoReader = useRef<((file: File) => Promise<void>) | null>(null);
  const [message, setMessage] = useState('Solicitando acceso a la cámara…');
  const [restart, setRestart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  useEffect(() => { callbacks.current = { onClose, onFound, onRemoteToken }; }, [onClose, onFound, onRemoteToken]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); callbacks.current.onClose(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    let active = true, pending = false, done = false, scanning = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let detector: NativeDetector | undefined;
    let attempt = 0;
    const canvas = document.createElement('canvas');
    const stopCamera = () => stream?.getTracks().forEach(track => track.stop());
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (active && stream?.active && !pending && !done) timer = window.setTimeout(() => void scan(), 350);
    };
    const accept = async (raw: string) => {
      if (!active || pending || done) return false;
      const token = workerTokenFromQr(raw, window.location.origin);
      if (!token) { setMessage('QR leído, pero no corresponde a un carnet de esta aplicación.'); return false; }
      pending = true; done = true;
      setCompleted(true);
      if (timer !== undefined) window.clearTimeout(timer);
      stopCamera();
      setBusy(true); setMessage('Comprobando carnet…');
      try {
        if (callbacks.current.onRemoteToken) {
          const sent = await callbacks.current.onRemoteToken(token);
          if (active) setMessage(sent ? 'Carnet enviado al ordenador. Pulsa Reintentar para otro trabajador.' : 'Carnet o vinculación no disponible.');
        } else {
          const id = await resolveWorkerCardOwner(token);
          if (!active) return true;
          if (id && callbacks.current.onFound?.(id)) { callbacks.current.onClose(); return true; }
          setMessage('Carnet no disponible para esta cuenta o trabajador no cargado.');
        }
      } catch {
        if (active) setMessage('No se ha podido verificar el carnet. Comprueba la conexión y vuelve a intentarlo.');
      } finally { pending = false; if (active) setBusy(false); }
      return true;
    };
    const scan = async () => {
      if (!active || pending || done || scanning) return;
      scanning = true;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        let raw: string | undefined;
        if (detector) {
          try {
            const results = await detector.detect(video);
            raw = results.find(result => result.rawValue && workerTokenFromQr(result.rawValue, window.location.origin))?.rawValue || results[0]?.rawValue;
          } catch { detector = undefined; }
        }
        if (!active || pending || done) return;
        raw ||= decodeQrFrame(video, video.videoWidth, video.videoHeight, canvas, attempt++) || undefined;
        if (raw) await accept(raw);
      } catch {
        // Transient camera/canvas failures must not stop the next frame.
      } finally { scanning = false; schedule(); }
    };
    const readPhoto = async (file: File) => {
      if (!active || pending || done) return;
      if (!file.type.startsWith('image/') || file.size > 20_000_000) { setMessage('Elige una imagen del QR de menos de 20 MB.'); return; }
      pending = true; setBusy(true);
      if (timer !== undefined) window.clearTimeout(timer);
      const url = URL.createObjectURL(file);
      try {
        setMessage('Leyendo el QR de la imagen…');
        const image = new Image();
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('image')); image.src = url; });
        if (!active) return;
        const raw = decodeQrFrame(image, image.naturalWidth, image.naturalHeight, canvas);
        pending = false;
        if (raw) await accept(raw);
        else setMessage('No se distingue un QR en la imagen. Haz una foto más cercana, enfocada y sin reflejos.');
      } catch { if (active) setMessage('No se ha podido leer la imagen. Prueba con otra foto del QR.'); }
      finally { URL.revokeObjectURL(url); pending = false; if (active) { setBusy(false); schedule(); } }
    };
    photoReader.current = readPhoto;
    setBusy(false); setCompleted(false); setMessage('Solicitando acceso a la cámara…');
    void (async () => {
      try {
        const Constructor = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => NativeDetector }).BarcodeDetector;
        if (Constructor) { try { detector = new Constructor({ formats: ['qr_code'] }); } catch { /* Use the portable decoder. */ } }
        if (!navigator.mediaDevices?.getUserMedia) { setMessage('No se puede abrir la cámara aquí. Puedes leer una foto del QR.'); return; }
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!active || done) { camera.getTracks().forEach(track => track.stop()); return; }
        stream = camera;
        if (!videoRef.current) { stopCamera(); return; }
        videoRef.current.srcObject = camera;
        await videoRef.current.play();
        const track = camera.getVideoTracks()[0];
        try {
          const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { focusMode?: string[] };
          if (capabilities?.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
        } catch { /* Focus controls are optional; decoding must keep working. */ }
        if (!active || done) { stopCamera(); return; }
        if (!pending) setMessage('Centra el QR y acércate hasta verlo nítido. Evita los reflejos.');
        schedule();
      } catch { stopCamera(); if (active && !done && !pending) setMessage('No se ha podido abrir la cámara. Revisa los permisos o lee una foto del QR.'); }
    })();
    return () => {
      active = false;
      if (photoReader.current === readPhoto) photoReader.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
      stopCamera();
    };
  }, [restart]);

  return <ModalPortal label="Escanear carnet">
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3">
      <section role="dialog" aria-modal="true" aria-labelledby="scan-title" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-4 text-slate-900 dark:bg-slate-900 dark:text-white">
        <header className="flex items-center justify-between gap-3"><h2 id="scan-title" className="font-bold flex items-center gap-2"><Camera className="h-5 w-5"/> Escanear carnet</h2><button type="button" aria-label="Cerrar escáner" onClick={onClose} className="min-h-11 min-w-11 rounded-xl border p-2"><X /></button></header>
        <div className="relative mt-4"><video ref={videoRef} muted playsInline autoPlay className="aspect-video w-full rounded-xl bg-slate-950 object-contain" aria-label="Vista de la cámara"/><div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="aspect-square h-3/4 rounded-xl border-2 border-white/80"/></div></div>
        <p role="status" className="mt-3 text-sm">{message}</p>
        <input ref={inputRef} type="file" accept="image/*" disabled={busy || completed} aria-label="Imagen del código QR" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void photoReader.current?.(file); }}/>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setRestart(n => n + 1)} className="min-h-11 rounded-xl border px-4 py-2 font-bold disabled:opacity-50">Reintentar</button><button type="button" disabled={busy || completed} onClick={() => inputRef.current?.click()} className="min-h-11 inline-flex items-center gap-2 rounded-xl border px-4 py-2 font-bold disabled:opacity-50"><ImagePlus className="h-5 w-5"/>Leer una foto del QR</button></div>
      </section>
    </div>
  </ModalPortal>;
}
