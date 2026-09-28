import React, { useState } from 'react';
import { Copy, Link2, Loader2, MessageCircle, QrCode, RotateCcw, X } from 'lucide-react';
import QRCode from 'qrcode';
import { createForemanPortalAccess, revokeForemanPortalAccess } from '../src/services/foremanPortalService';

export const ForemanAccessButton: React.FC<{ obra: string; foremanName: string; phone?: string }> = ({ obra, foremanName, phone }) => {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const ensure = async () => {
    setBusy(true);
    try {
      const token = await createForemanPortalAccess(obra, foremanName);
      const next = `${window.location.origin}/?encargado=${encodeURIComponent(token)}`;
      setUrl(next);
      setQr(await QRCode.toDataURL(next, { width: 320, margin: 1 }));
      setOpen(true);
    } finally { setBusy(false); }
  };
  const share = () => {
    const digits = String(phone || '').replace(/\D/g, '');
    const normalized = digits.length === 9 ? `34${digits}` : digits;
    const text = `Acceso móvil a la documentación de la obra ${obra}:\n${url}`;
    if (normalized) window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    else navigator.clipboard?.writeText(text);
  };
  return <>
    <button type="button" onClick={() => void ensure()} disabled={busy || !foremanName}
      className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg"
      title="Acceso móvil del encargado">
      {busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <QrCode className="w-4 h-4"/>}
    </button>
    {open && <div className="fixed inset-0 z-[120] bg-slate-950/60 p-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-black">Acceso móvil del encargado</h3><p className="text-xs text-slate-500 mt-1">{obra} · {foremanName}</p></div>
          <button onClick={()=>setOpen(false)} className="p-2 rounded-xl border"><X className="w-4 h-4"/></button>
        </div>
        {qr && <img src={qr} alt="QR acceso encargado" className="mx-auto my-5 w-64 h-64 rounded-2xl border bg-white p-2"/>}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-xs break-all">{url}</div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button onClick={()=>navigator.clipboard?.writeText(url)} className="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-black"><Copy className="w-4 h-4"/>Copiar enlace</button>
          <button onClick={share} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-3 text-sm font-black"><MessageCircle className="w-4 h-4"/>WhatsApp</button>
          <button onClick={async()=>{await revokeForemanPortalAccess(obra); setUrl(''); setQr(''); setOpen(false);}} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 text-rose-700 px-3 py-3 text-sm font-black"><RotateCcw className="w-4 h-4"/>Revocar acceso</button>
        </div>
        <p className="mt-4 text-[11px] text-slate-500">El enlace solo permite gestionar documentación de esta obra. No da acceso al resto de GestionProfea.</p>
      </div>
    </div>}
  </>;
};
