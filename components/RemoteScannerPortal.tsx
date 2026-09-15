import React from 'react';
import { Camera, CheckCircle2, Loader2, RefreshCw, Smartphone, XCircle } from 'lucide-react';
import { supabase } from '../src/lib/supabase';

const compressForTransfer = async (file: File): Promise<string> => {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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

export const RemoteScannerPortal: React.FC<{ token: string }> = ({ token }) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [checking, setChecking] = React.useState(true);
  const [valid, setValid] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [lastSent, setLastSent] = React.useState('');
  const [error, setError] = React.useState('');

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

  React.useEffect(() => { void validate(); }, [validate]);

  const handleCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !valid) return;
    setSending(true);
    setError('');
    try {
      const imageData = await compressForTransfer(file);
      await supabase.rpc('scanner_mobile_upload', {
        p_token: token,
        p_image_data: imageData,
        p_file_name: file.name || `Captura_${Date.now()}.jpg`,
      });
      setLastSent(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (e: any) {
      console.error(e);
      setError(e?.message?.includes('expired') ? 'La sesión ha caducado. Genera un nuevo QR en el ordenador.' : 'No se ha podido enviar la fotografía. Inténtalo de nuevo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/20 flex items-center justify-center mb-4"><Smartphone className="w-6 h-6 text-blue-400"/></div>
          <h1 className="text-xl font-black">Escáner móvil GestionProfea</h1>
          <p className="text-sm text-slate-400 mt-1">Cámara vinculada a la contratación del día.</p>
        </div>
        <div className="p-6 space-y-5">
          {checking ? (
            <div className="py-10 text-center"><Loader2 className="w-9 h-9 animate-spin mx-auto text-blue-400"/><p className="mt-3 text-sm text-slate-300">Validando conexión…</p></div>
          ) : valid ? (
            <>
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0"/><div><p className="font-bold text-sm">Móvil vinculado</p><p className="text-xs text-slate-400 mt-1">Puedes fotografiar todos los documentos de la jornada. Cada captura aparecerá automáticamente en el ordenador.</p></div></div>
              <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapture}/>
              <button type="button" disabled={sending} onClick={() => inputRef.current?.click()} className="w-full min-h-16 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 flex items-center justify-center gap-3 font-black text-base shadow-lg shadow-blue-950/40">
                {sending ? <Loader2 className="w-6 h-6 animate-spin"/> : <Camera className="w-6 h-6"/>}
                {sending ? 'ENVIANDO…' : 'FOTOGRAFIAR DOCUMENTO'}
              </button>
              {lastSent && <div className="text-center text-sm text-emerald-300">Última captura enviada a las {lastSent}</div>}
              <p className="text-xs text-center text-slate-500">No cierres esta página durante la contratación. Puedes bloquear y desbloquear el móvil entre capturas.</p>
            </>
          ) : (
            <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-5 text-center"><XCircle className="w-8 h-8 text-red-400 mx-auto"/><p className="font-bold mt-2">Vinculación no disponible</p><p className="text-sm text-slate-400 mt-2">{error}</p><button type="button" onClick={() => void validate()} className="mt-4 px-4 py-2 rounded-xl bg-slate-800 text-sm font-bold inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Reintentar</button></div>
          )}
          {error && valid && <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200">{error}</div>}
        </div>
      </div>
    </div>
  );
};
