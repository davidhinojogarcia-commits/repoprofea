import React, { useEffect, useRef, useState } from 'react';
import { SIGNATURE_INK } from '../src/lib/signatureInk';
export function VisitSignaturePad({
  name,
  allowAgreement = true,
  busy,
  onConfirm,
  onCancel
}: {
  key?: string;
  name: string;
  allowAgreement?: boolean;
  busy: boolean;
  onConfirm: (image: string, intent?: 'agreement'|'reservations'|'knowledge', note?: string) => void;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    last = useRef<{
      x: number;
      y: number;
    } | null>(null);
  const [hasInk, setHasInk] = useState(false),
    [intent,setIntent]=useState<'agreement'|'reservations'|'knowledge'>(allowAgreement?'agreement':'knowledge'),
    [note,setNote]=useState(''),
    [ack, setAck] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const resize = () => {
      const r = c.getBoundingClientRect(),
        ratio = Math.min(2, Math.max(1, devicePixelRatio || 1));
      const width = Math.max(1, Math.round(r.width * ratio)),
        height = Math.max(1, Math.round(r.height * ratio));
      if (c.width === width && c.height === height) return;
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext('2d')?.drawImage(c, 0, 0);
      c.width = width;
      c.height = height;
      const pixels=copy.getContext('2d')?.getImageData(0,0,copy.width,copy.height).data;
      let right=0,bottom=0;
      if(pixels)for(let y=0;y<copy.height;y++)for(let x=0;x<copy.width;x++)if(pixels[(y*copy.width+x)*4+3]>10){right=Math.max(right,x);bottom=Math.max(bottom,y);}
      // Fit the ink, not the empty area: rotating back must not progressively
      // shrink a signature that already fits the smaller viewport.
      const scale = Math.min(1,width/Math.max(1,right+8),height/Math.max(1,bottom+8));
      c.getContext('2d')?.drawImage(copy, 0, 0, copy.width * scale, copy.height * scale);
      drawing.current = false;
      last.current = null;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(c);
    return () => observer.disconnect();
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * e.currentTarget.width / r.width,
      y: (e.clientY - r.top) * e.currentTarget.height / r.height
    };
  };
  const clear = () => {
    const c = canvas.current;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    setError('');
  };
  const confirm = () => {
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!c || !ctx || !hasInk || !ack) return;
    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = c.width,
      y0 = c.height,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (pixels.data[(y * c.width + x) * 4 + 3] > 10) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    if (x1 < x0) {
      setError('Realiza tu firma antes de confirmar.');
      return;
    }
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 17;
    out.height = y1 - y0 + 17;
    out.getContext('2d')?.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 8, 8, x1 - x0 + 1, y1 - y0 + 1);
    if(intent==='reservations'&&!note.trim()){setError('Explica las reservas de tu firma.');return;}
    onConfirm(out.toDataURL('image/png'),intent,note);
  };
  return <div className="rounded-2xl border border-blue-300 bg-white p-4 text-slate-900 space-y-3">
    <h3 className="font-black">Firma de {name}</h3><p className="text-sm">Comprueba tu identidad y el contenido del acta antes de firmar. Puedes borrar y repetir antes de confirmar.</p>
    <canvas ref={canvas} width={1200} height={400} aria-label={`Zona de firma de ${name}`} className="visit-signature-surface w-full rounded-xl border border-slate-400 bg-white" style={{
      height: 190,
      touchAction: 'none'
    }} onPointerDown={e => {
      if (busy) return;
      const ctx = e.currentTarget.getContext('2d');
      if (!ctx) {
        setError('Este dispositivo no permite capturar la firma.');
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      last.current = point(e);
      ctx.lineWidth = 2.4 * e.currentTarget.width / e.currentTarget.getBoundingClientRect().width;
      ctx.strokeStyle = SIGNATURE_INK;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
    }} onPointerMove={e => {
      if (!drawing.current || !last.current) return;
      const ctx = e.currentTarget.getContext('2d');
      if (!ctx) return;
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      setHasInk(true);
    }} onPointerUp={() => {
      drawing.current = false;
      last.current = null;
    }} onPointerCancel={() => {
      drawing.current = false;
      last.current = null;
    }} />
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />Soy {name}; he leído esta versión y confirmo que el trazo es mi firma.</label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <label className="block font-bold">Alcance de la firma<select aria-label="Alcance de la firma" className="block w-full rounded-xl border p-3" value={intent} onChange={e=>setIntent(e.target.value as typeof intent)}>{allowAgreement&&<option value="agreement">Conformidad con el contenido del acta</option>}<option value="reservations">Firma con reservas</option><option value="knowledge">Simple conocimiento</option></select></label><label className="block">Reservas o aclaraciones<textarea className="block w-full rounded-xl border p-3" value={note} maxLength={5000} onChange={e=>setNote(e.target.value)}/></label><p className="text-sm">Esta firma no verifica la ejecución de las órdenes.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={clear} className="rounded-xl border px-4 py-3 font-bold">Borrar / repetir</button><button type="button" disabled={busy || !hasInk || !ack} onClick={confirm} className="rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50">Confirmar firma</button><button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border px-4 py-3">Cancelar</button></div>
  </div>;
}
