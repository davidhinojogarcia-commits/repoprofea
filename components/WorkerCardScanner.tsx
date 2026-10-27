import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { workerTokenFromQr } from '../src/lib/workerQrScan';
import { resolveWorkerCardOwner } from '../src/services/workerQrShareService';

export default function WorkerCardScanner({ onClose, onFound, onRemoteToken }: { onClose: () => void; onFound?: (id: number) => boolean; onRemoteToken?: (token: string) => Promise<boolean> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const foundRef = useRef(onFound);
  const remoteRef = useRef(onRemoteToken);
  const [message, setMessage] = useState('Solicitando acceso a la cámara…');
  const [restart, setRestart] = useState(0);
  useEffect(() => { foundRef.current = onFound; remoteRef.current = onRemoteToken; }, [onFound, onRemoteToken]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  useEffect(() => {
    let active = true;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let pending = false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scan = async () => {
      if (!active) return;
      const video = videoRef.current;
      if (!pending && context && video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
        if (result) {
          const token = workerTokenFromQr(result.data, window.location.origin);
          if (!token) {
            setMessage('El código no corresponde a un carnet de esta aplicación.');
          } else {
            pending = true;
            setMessage('Comprobando carnet…');
            try {
              if (remoteRef.current) {
                const sent = await remoteRef.current(token);
                if (!active) return;
                setMessage(sent ? 'Carnet enviado al ordenador. Pulsa Reintentar para otro trabajador.' : 'Carnet o vinculación no disponible.');
              } else {
                const id = await resolveWorkerCardOwner(token);
                if (!active) return;
                if (id && foundRef.current?.(id)) { onClose(); return; }
                setMessage('Carnet no disponible para esta cuenta o trabajador no cargado.');
              }
            } catch {
              if (active) setMessage('No se ha podido verificar el carnet. Comprueba la conexión y vuelve a intentarlo.');
            }
            // Stop scanning after a result; explicit retry avoids repeated RPCs/logs.
            return;
          }
        }
      }
      timer = window.setTimeout(() => void scan(), 350);
    };
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia || !context) {
        setMessage('Este dispositivo no permite acceder a la cámara desde el navegador.'); return;
      }
      try {
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active) { camera.getTracks().forEach(track => track.stop()); return; }
        stream = camera;
        if (!videoRef.current) return;
        videoRef.current.srcObject = camera;
        await videoRef.current.play();
        if (!active) return;
        setMessage('Sitúa el QR del carnet dentro de la imagen.');
        void scan();
      } catch {
        stream?.getTracks().forEach(track => track.stop());
        if (active) setMessage('No se ha podido abrir la cámara. Revisa los permisos y vuelve a intentarlo.');
      }
    })();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [restart, onClose]);

  return <ModalPortal label="Escanear carnet">
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3">
      <section role="dialog" aria-modal="true" aria-labelledby="scan-title" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-4 text-slate-900 dark:bg-slate-900 dark:text-white">
        <header className="flex items-center justify-between gap-3"><h2 id="scan-title" className="font-bold flex items-center gap-2"><Camera className="h-5 w-5"/> Escanear carnet</h2><button type="button" aria-label="Cerrar escáner" onClick={onClose} className="min-h-11 min-w-11 rounded-xl border p-2"><X /></button></header>
        <video ref={videoRef} muted playsInline className="mt-4 aspect-video w-full rounded-xl bg-slate-950 object-contain" aria-label="Vista de la cámara" />
        <p role="status" className="mt-3 text-sm">{message}</p>
        <button type="button" onClick={() => setRestart(n => n + 1)} className="mt-3 min-h-11 rounded-xl border px-4 py-2 font-bold">Reintentar</button>
      </section>
    </div>
  </ModalPortal>;
}
