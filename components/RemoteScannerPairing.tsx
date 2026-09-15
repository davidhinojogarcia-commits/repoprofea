import React from 'react';
import QRCode from 'qrcode';
import { Smartphone, QrCode, Wifi, CheckCircle2, RefreshCw } from 'lucide-react';
import { getOrCreateDailyRemoteScannerSession, subscribeToRemoteScannerCaptures } from '../src/services/remoteScannerService';

interface RemoteScannerPairingProps {
  onCapture: (imageData: string, fileName: string) => void;
  onToast: (msg: string, type: 'success' | 'error') => void;
}

export const RemoteScannerPairing: React.FC<RemoteScannerPairingProps> = ({ onCapture, onToast }) => {
  const [qrDataUrl, setQrDataUrl] = React.useState('');
  const [pairingUrl, setPairingUrl] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');

  const connect = React.useCallback(async () => {
    setStatus('loading');
    try {
      const session = await getOrCreateDailyRemoteScannerSession();
      setPairingUrl(session.pairingUrl);
      setExpiresAt(session.expiresAt);
      setQrDataUrl(await QRCode.toDataURL(session.pairingUrl, { width: 260, margin: 1 }));
      setStatus('ready');
      const unsubscribe = subscribeToRemoteScannerCaptures(session.id, capture => {
        onCapture(capture.imageData, capture.fileName);
        onToast('Nueva captura recibida desde el móvil', 'success');
      });
      return unsubscribe;
    } catch (error: any) {
      console.error('Remote scanner pairing error:', error);
      setStatus('error');
      onToast(error?.message || 'No se ha podido preparar el escáner móvil.', 'error');
      return undefined;
    }
  }, [onCapture, onToast]);

  React.useEffect(() => {
    let cleanup: undefined | (() => void);
    void connect().then(fn => { cleanup = fn; });
    return () => cleanup?.();
  }, [connect]);

  if (status === 'loading') {
    return <div className="rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 p-5 flex items-center gap-3"><RefreshCw className="w-5 h-5 animate-spin text-[#00548E]"/><div><p className="text-sm font-bold text-slate-800 dark:text-slate-100">Preparando escáner móvil…</p><p className="text-xs text-slate-500 dark:text-slate-400">Creando la vinculación para la contratación de hoy.</p></div></div>;
  }

  if (status === 'error') {
    return <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-5"><p className="text-sm font-bold text-amber-900 dark:text-amber-200">El escáner móvil necesita la migración de base de datos pendiente.</p><button type="button" onClick={() => void connect()} className="mt-3 px-4 py-2 rounded-xl bg-[#00548E] text-white text-xs font-bold">Reintentar</button></div>;
  }

  return (
    <div className="rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/25 dark:to-slate-900 p-5">
      <div className="flex flex-col lg:flex-row gap-5 items-center lg:items-start">
        <div className="bg-white rounded-2xl p-3 shadow-sm border border-slate-200 shrink-0">
          {qrDataUrl ? <img src={qrDataUrl} alt="QR para vincular la cámara del móvil" className="w-44 h-44" /> : <QrCode className="w-44 h-44 text-slate-300" />}
        </div>
        <div className="flex-1 text-center lg:text-left">
          <div className="flex items-center justify-center lg:justify-start gap-2 text-[#00548E] dark:text-blue-400"><Smartphone className="w-5 h-5"/><h4 className="font-bold text-base">Cámara del móvil para toda la jornada</h4></div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Escanea este QR una sola vez. El móvil quedará vinculado como cámara remota hasta el final de hoy, aunque cambies de trabajador durante la contratación.</p>
          <div className="mt-4 grid gap-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600"/>No necesitas cable ni instalar otra app.</div>
            <div className="flex items-center gap-2"><Wifi className="w-4 h-4 text-blue-600"/>Las fotos llegan automáticamente a este escáner.</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600"/>Válido hasta {expiresAt ? new Date(expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : 'fin de jornada'}.</div>
          </div>
          <p className="mt-4 text-[11px] text-slate-400 break-all">{pairingUrl}</p>
        </div>
      </div>
    </div>
  );
};
