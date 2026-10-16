import React, { useEffect, useRef, useState } from 'react';
import { visitRequest } from '../src/services/visitMinutesService';
import { cleanContact, personName, type VisitContact } from '../src/lib/visitMinutes';
export const visitInput = 'min-h-[46px] w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const blank = (): VisitContact => ({
  id: crypto.randomUUID(),
  revision: 0,
  firstName: '',
  lastName: '',
  role: 'Dirección de obra',
  entity: '',
  phone: '',
  email: '',
  active: true,
  assignments: []
});
export function VisitContactsPanel() {
  const [contacts, setContacts] = useState<VisitContact[]>([]),
    [works, setWorks] = useState<any[]>([]),
    [draft, setDraft] = useState<VisitContact | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  const guard = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([visitRequest({
      action: 'contacts'
    }, {
      signal: c.signal
    }), visitRequest({
      action: 'works'
    }, {
      signal: c.signal
    })]).then(([a, b]) => {
      setContacts(a.contacts);
      setWorks(b.works);
      setLoaded(true);
    }).catch(e => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => c.abort();
  }, []);
  const save = async () => {
    if (!draft || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      cleanContact(draft);
      const r = await visitRequest({
        action: 'save-contact',
        contact: draft
      });
      setContacts(current => [r.contact, ...current.filter(c => c.id !== r.contact.id)]);
      setDraft(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-700 dark:bg-slate-900 space-y-4 text-slate-900 dark:text-slate-100">
    <h2 className="text-xl font-black">Dirección facultativa</h2><p className="text-sm">Contactos y funciones por obra para las actas de visitas. Las firmas se recogen en cada acta; no se guardan firmas reutilizables en este directorio.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {!loaded && !error && <p role="status">Cargando contactos…</p>}
    <button type="button" disabled={!loaded || busy} onClick={() => setDraft(blank())} className="rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50">Añadir persona</button>
    {draft && <form onSubmit={e => {
      e.preventDefault();
      void save();
    }} className="rounded-xl border border-blue-300 p-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">{([['firstName', 'Nombre'], ['lastName', 'Apellidos'], ['role', 'Cargo / función'], ['entity', 'Entidad / empresa'], ['phone', 'Teléfono'], ['email', 'Correo electrónico']] as const).map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<input required={['firstName', 'lastName', 'role'].includes(key)} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} className={visitInput} value={draft[key]} onChange={e => setDraft({
            ...draft,
            [key]: e.target.value
          })} /></label>)}</div>
      {!draft.email && <p className="text-sm text-amber-700 dark:text-amber-300">Sin correo no podrá recibir enlaces o documentos por email. Puedes completar este dato antes de incorporarlo a un acta.</p>}
      <label className="flex gap-2"><input type="checkbox" checked={draft.active} onChange={e => setDraft({
          ...draft,
          active: e.target.checked
        })} />Contacto activo</label>
      <fieldset className="space-y-2"><legend className="font-bold">Obras y función en cada una</legend>{works.map(work => {
          const assigned = draft.assignments.find(a => a.worksiteId === work.id);
          return <div key={work.id} className="rounded-lg border p-3"><label className="flex gap-2"><input type="checkbox" checked={!!assigned} onChange={e => setDraft({
                ...draft,
                assignments: e.target.checked ? [...draft.assignments, {
                  worksiteId: work.id,
                  role: draft.role
                }] : draft.assignments.filter(a => a.worksiteId !== work.id)
              })} />{work.codigo} · {work.nombre}</label>{assigned && <input aria-label={`Función en ${work.nombre}`} className={visitInput + ' mt-2'} value={assigned.role} onChange={e => setDraft({
              ...draft,
              assignments: draft.assignments.map(a => a.worksiteId === work.id ? {
                ...a,
                role: e.target.value
              } : a)
            })} />}</div>;
        })}</fieldset>
      <div className="flex gap-2"><button disabled={busy} className="rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white">{busy ? 'Guardando…' : 'Guardar contacto'}</button><button type="button" disabled={busy} className="rounded-xl border px-4 py-3" onClick={() => setDraft(null)}>Cancelar</button></div>
    </form>}
    <div className="space-y-2">{contacts.map(c => <button type="button" disabled={busy} key={c.id} onClick={() => setDraft(structuredClone(c))} className="block w-full rounded-xl border border-slate-200 p-4 text-left dark:border-slate-700"><strong>{personName(c)}</strong><span className="ml-2 text-xs">{c.active ? 'Activo' : 'Inactivo'}</span><p>{c.role} · {c.entity}</p><p className="text-sm break-all">{c.email || 'Sin correo'} · {c.phone}</p><p className="text-xs">{c.assignments.length} obra(s) asociada(s) · Editar</p></button>)}{loaded && !contacts.length && <p>No hay personas registradas todavía.</p>}</div>
  </section>;
}
