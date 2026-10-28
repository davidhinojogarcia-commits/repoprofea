import React, { useCallback, useState } from 'react';
import WorkerCardScanner from './WorkerCardScanner';
import { connectCardPairing, sendPairedCard } from '../src/services/workerCardPairing';

export default function WorkerCardPairMobile({ token }: { token: string }) {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = useCallback(() => { setSecret(''); window.location.replace('/'); }, []);
  const send = useCallback((workerToken: string) => sendPairedCard(secret, workerToken), [secret]);
  const connect = async () => {
    if (busy) return; setBusy(true); setError('');
    try { const next = await connectCardPairing(token); setSecret(next); window.history.replaceState(null, '', '/'); }
    catch { setError('No se ha podido vincular. Comprueba que usas la misma cuenta y que el QR no ha caducado ni se ha usado.'); }
    finally { setBusy(false); }
  };
  if (secret) return <WorkerCardScanner onClose={close} onRemoteToken={send} />;
  return <main className="min-h-screen bg-slate-100 p-5 flex items-center justify-center"><section className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-xl"><h1 className="text-xl font-bold">Vincular cámara del móvil</h1><p className="mt-3 text-sm">Confirma la vinculación con el ordenador. Debes utilizar la misma cuenta de supervisor.</p>{error && <p role="alert" className="mt-3 text-sm">{error}</p>}<button type="button" disabled={busy} onClick={() => void connect()} className="mt-5 min-h-11 rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white">{busy ? 'Vinculando…' : 'Confirmar vinculación'}</button></section></main>;
}
