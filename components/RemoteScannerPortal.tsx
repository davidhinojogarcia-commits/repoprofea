import React from 'react';
import { Camera, CameraIcon, Check, CheckCircle2, Loader2, RefreshCw, RotateCcw, Smartphone, SwitchCamera, X, XCircle } from 'lucide-react';
import { supabase } from '../src/lib/supabase';

const compressDataUrlForTransfer = async (raw: string): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1500;
      let width = img.width;
      let height = img.height;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No se pudo preparar la imagen.'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('Imagen no válida.'));
    img.src = raw;
  });
};

const fileToDataUrl = async (file: File): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
};

export const RemoteScannerPortal: React.FC<{ token: string }> = ({ token }) => {
  const fallbackInputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const [checking, setChecking] = React.useState(true);
  const [valid, setValid] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [cameraLoading, setCameraLoading] = React.useState(false);
  const [cameraActive, setCameraActive] = React.useState(false);
  const [cameraError, setCameraError] = React.useState('');
  const [facingMode, setFacingMode] = React.useState<'environment' | 'user'>('environment');
  const [capturedImage, setCapturedImage] = React.useState('');
  const [lastSent, setLastSent] = React.useState('');
  const [error, setError] = React.useState('');

  const stopCamera = React.useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  const validate = React.useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      const result = await supabase.rpc('scanner_mobile_status', { p_token: token });
      setValid(Boolean(result?.valid));
      if (!result?.valid) setError('Este QR ha caducado o ya no está activo. Genera uno nuevo desde GestionProfea.');
    } catch (e) {
      console.error(e);
      setValid(false);
      setError('No se ha podido validar la vinculación del escáner.');
    } finally {
      setChecking(false);
    }
  }, [token]);

  React.useEffect(() => {
    void validate();
    return () => stopCamera();
  }, [validate, stopCamera]);

  const startCamera = React.useCallback(async (mode: 'environment' | 'user' = facingMode) => {
    setCameraError('');
    setCapturedImage('');

    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackInputRef.current?.click();
      return;
    }

    setCameraLoading(true);
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setFacingMode(mode);
      setCameraActive(true);

      await new Promise(resolve => setTimeout(resolve, 30));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e: any) {
      console.error('No se pudo iniciar la cámara:', e);
      setCameraError(
        e?.name === 'NotAllowedError'
          ? 'No se ha autorizado el acceso a la cámara. Activa el permiso de cámara en el navegador.'
          : 'No se ha podido abrir la cámara integrada. Puedes usar la cámara del sistema como alternativa.'
      );
    } finally {
      setCameraLoading(false);
    }
  }, [facingMode, stopCamera]);

  const switchCamera = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    await startCamera(next);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const raw = canvas.toDataURL('image/jpeg', 0.95);
    setCapturedImage(raw);
    stopCamera();
  };

  const sendImageData = async (raw: string, fileName: string) => {
    if (!raw || !valid) return;
    setSending(true);
    setError('');

    try {
      const imageData = await compressDataUrlForTransfer(raw);
      await supabase.rpc('scanner_mobile_upload', {
        p_token: token,
        p_image_data: imageData,
        p_file_name: fileName,
      });
      setLastSent(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCapturedImage('');
      setCameraError('');
      window.setTimeout(() => { void startCamera('environment'); }, 250);
    } catch (e: any) {
      console.error(e);
      setError(e?.message?.includes('expired') ? 'La sesión ha caducado. Genera un nuevo QR en el ordenador.' : 'No se ha podido enviar la fotografía. Inténtalo de nuevo.');
    } finally {
      setSending(false);
    }
  };

  const confirmCapturedPhoto = async () => {
    await sendImageData(capturedImage, `Captura_${Date.now()}.jpg`);
  };

  const retakePhoto = async () => {
    setCapturedImage('');
    await startCamera(facingMode);
  };

  const handleFallbackCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !valid) return;

    try {
      const raw = await fileToDataUrl(file);
      await sendImageData(raw, file.name || `Captura_${Date.now()}.jpg`);
    } catch (e) {
      console.error(e);
      setError('No se ha podido leer la fotografía.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white px-3 py-4 sm:px-4 sm:py-8 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/20 flex items-center justify-center mb-4"><Smartphone className="w-6 h-6 text-blue-400"/></div>
          <h1 className="text-xl font-black">Escáner móvil GestionProfea</h1>
          <p className="text-sm text-slate-400 mt-1">Vista previa en directo y disparo desde el móvil.</p>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {checking ? (
            <div className="py-10 text-center"><Loader2 className="w-9 h-9 animate-spin mx-auto text-blue-400"/><p className="mt-3 text-sm text-slate-300">Validando conexión…</p></div>
          ) : valid ? (
            <>
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-3 flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0"/>
                <div>
                  <p className="font-bold text-sm">Móvil vinculado</p>
                  <p className="text-xs text-slate-400 mt-1">Enfoca el documento, dispara, revisa la foto y confirma el envío.</p>
                </div>
              </div>

              <input
                ref={fallbackInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFallbackCapture}
              />

              {!cameraActive && !capturedImage && (
                <div className="space-y-3">
                  <button
                    type="button"
                    disabled={cameraLoading || sending}
                    onClick={() => void startCamera('environment')}
                    className="w-full min-h-16 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 flex items-center justify-center gap-3 font-black text-base shadow-lg shadow-blue-950/40"
                  >
                    {cameraLoading ? <Loader2 className="w-6 h-6 animate-spin"/> : <Camera className="w-6 h-6"/>}
                    {cameraLoading ? 'ABRIENDO CÁMARA…' : 'ABRIR CÁMARA'}
                  </button>

                  {cameraError && (
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-100">
                      <p>{cameraError}</p>
                      <button
                        type="button"
                        onClick={() => fallbackInputRef.current?.click()}
                        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-white"
                      >
                        <CameraIcon className="w-4 h-4"/> Usar cámara del sistema
                      </button>
                    </div>
                  )}
                </div>
              )}

              {cameraActive && (
                <div className="overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-xl">
                  <div className="relative aspect-[3/4] bg-black">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`h-full w-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
                    />

                    <div className="pointer-events-none absolute inset-4 rounded-2xl border-2 border-white/60 shadow-[0_0_0_999px_rgba(0,0,0,0.12)]" />

                    <div className="absolute top-3 right-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void switchCamera()}
                        className="pointer-events-auto rounded-full bg-black/55 p-3 text-white backdrop-blur"
                        aria-label="Cambiar cámara"
                      >
                        <SwitchCamera className="w-5 h-5"/>
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="pointer-events-auto rounded-full bg-black/55 p-3 text-white backdrop-blur"
                        aria-label="Cerrar cámara"
                      >
                        <X className="w-5 h-5"/>
                      </button>
                    </div>

                    <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/75 to-transparent pb-5 pt-12">
                      <button
                        type="button"
                        onClick={capturePhoto}
                        className="pointer-events-auto h-20 w-20 rounded-full border-4 border-white bg-white/20 p-1 shadow-2xl active:scale-95"
                        aria-label="Hacer foto"
                      >
                        <span className="block h-full w-full rounded-full bg-white" />
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-3 text-center text-xs text-slate-400">Coloca el documento dentro del marco y pulsa el botón blanco.</div>
                </div>
              )}

              {capturedImage && (
                <div className="overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-xl">
                  <img src={capturedImage} alt="Vista previa de la captura" className="max-h-[68vh] w-full object-contain bg-black"/>
                  <div className="grid grid-cols-2 gap-3 p-3 bg-slate-900">
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void retakePhoto()}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-3 text-sm font-black text-white"
                    >
                      <RotateCcw className="w-5 h-5"/> Repetir
                    </button>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void confirmCapturedPhoto()}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-3 text-sm font-black text-white disabled:opacity-60"
                    >
                      {sending ? <Loader2 className="w-5 h-5 animate-spin"/> : <Check className="w-5 h-5"/>}
                      {sending ? 'Enviando…' : 'Usar foto'}
                    </button>
                  </div>
                </div>
              )}

              {lastSent && <div className="text-center text-sm font-semibold text-emerald-300">Última captura enviada a las {lastSent}</div>}
              <p className="text-xs text-center text-slate-500">Después de enviar una foto, la cámara vuelve a abrirse automáticamente para la siguiente captura.</p>
            </>
          ) : (
            <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-5 text-center">
              <XCircle className="w-8 h-8 text-red-400 mx-auto"/>
              <p className="font-bold mt-2">Vinculación no disponible</p>
              <p className="text-sm text-slate-400 mt-2">{error}</p>
              <button type="button" onClick={() => void validate()} className="mt-4 px-4 py-2 rounded-xl bg-slate-800 text-sm font-bold inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Reintentar</button>
            </div>
          )}

          {error && valid && <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200">{error}</div>}
        </div>
      </div>
    </div>
  );
};
