import React, { useEffect, useRef, useState } from 'react';
import { visitRequest, downloadVisitFile } from '../src/services/visitMinutesService';
import { personName, type VisitCommand } from '../src/lib/visitMinutes';
import { VisitMinutesReadView } from './VisitMinutesReadView';
import { VisitSignaturePad } from './VisitSignaturePad';
import { visitInput } from './VisitContactsPanel';
export function VisitMinutesPortal({
  token
}: {
  token: string;
}) {
  const [session, setSession] = useState(''),
    [record, setRecord] = useState<any>(null),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [signing, setSigning] = useState(false),
    [comment, setComment] = useState('');
  const guard = useRef(false),
    operation = useRef<{
      key: string;
      id: string;
    } | null>(null);
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  const run = async (task: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (e: any) {
      setError(e.message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const act = (command: VisitCommand) => void run(async () => {
    const key = JSON.stringify(command);
    if (operation.current?.key !== key) operation.current = {
      key,
      id: crypto.randomUUID()
    };
    const r = await visitRequest({
      action: 'portal-command',
      token,
      session,
      revision: record.revision,
      operation: operation.current.id,
      command
    }, {
      public: true
    });
    setRecord(r.record);
    operation.current = null;
    setSigning(false);
    setMessage('Respuesta guardada y comprobada en el servidor.');
  });
  const person = record?.state.participants.find((p: any) => p.id === record.personId);
  return <main className="min-h-screen bg-slate-50 px-3 py-6 dark:bg-slate-950 text-slate-900 dark:text-slate-100"><div className="mx-auto max-w-4xl space-y-4">
    <header><p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">GestionProfea</p><h1 className="text-2xl font-black">Acta de visita de obra</h1></header>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</p>}{message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{message}</p>}
    {!record ? <section className="rounded-2xl border bg-white p-5 dark:bg-slate-900 space-y-4"><h2 className="text-lg font-bold">Verifica tu correo</h2><p>Solicita un código al correo al que se dirigió el acta. El enlace por sí solo no permite consultar su contenido ni firmar. El código caduca en diez minutos y admite cinco intentos.</p><button disabled={busy} onClick={() => void run(async () => {
          const r = await visitRequest({
            action: 'challenge',
            token
          }, {
            public: true
          });
          setMessage(r.message);
        })} className="rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50">Enviar código a mi correo</button><form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            const r = await visitRequest({
              action: 'verify',
              token,
              code
            }, {
              public: true
            });
            setSession(r.session);
            setRecord(r.record);
          });
        }} className="space-y-3"><label className="block font-bold">Código de seis dígitos<input className={visitInput} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value)} /></label><button disabled={busy} className="rounded-xl border px-4 py-3 font-bold">Verificar y abrir acta</button></form><p className="text-xs">No compartas el enlace ni el código. La verificación acredita acceso al correo, no equivale a identificación con certificado digital.</p></section> : <>
      <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void run(async () => {
            setRecord((await visitRequest({
              action: 'portal',
              token,
              session
            }, {
              public: true
            })).record);
          })} className="rounded-xl border px-4 py-3 font-bold">Actualizar acta</button><button disabled={busy} onClick={() => void run(async () => downloadVisitFile(await visitRequest({
            action: 'portal-pdf',
            token,
            session
          }, {
            public: true
          })))} className="rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white">{record.status === 'signed' ? 'Descargar acta firmada' : 'Consultar PDF completo'}</button></div>
      <VisitMinutesReadView state={record.state} number={record.number} />
      {person && <section className="rounded-2xl border bg-white p-4 dark:bg-slate-900 space-y-3"><h2 className="text-lg font-black">Tu participación: {personName(person)}</h2><p>{person.role} · Versión {record.version}</p>
        {['review', 'changes', 'rejected'].includes(record.status) && !record.state.responses[person.id] && <><label className="block font-bold">Comentario o reservas<textarea className={visitInput} rows={4} value={comment} onChange={e => setComment(e.target.value)} /></label><div className="flex flex-wrap gap-2">{([['agree', 'Doy mi conformidad'], ['changes', 'Solicitar cambios'], ['reject', 'Manifestar disconformidad']] as const).map(([decision, label]) => <button disabled={busy} key={decision} onClick={() => act({
                type: 'respond',
                personId: person.id,
                decision,
                comment,
                mode: 'email-code'
              })} className="rounded-xl border px-4 py-3 font-bold">{label}</button>)}</div></>}
        {(record.status==='signing'||record.state.content.workflow==='3.1'&&['review','changes','rejected'].includes(record.status))&&record.state.responses[person.id]&&person.signing!=='none'&&!record.state.signatures[person.id]&&(signing ? <VisitSignaturePad key={record.id+':'+record.version+':'+person.id} allowAgreement={record.state.responses[person.id]?.decision==='agree'} busy={busy} name={personName(person)} onCancel={() => setSigning(false)} onConfirm={(image,intent,note) => act({
            type: 'sign',
            intent, note,
            personId: person.id,
            image,
            mode: 'email-code'
          })} /> : <button disabled={busy} onClick={() => setSigning(true)} className="rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white">Firmar esta versión</button>)}
        {record.state.signatures[person.id] && <p role="status">Tu firma está guardada en esta versión.</p>}
      </section>}
    </>}
  </div></main>;
}
