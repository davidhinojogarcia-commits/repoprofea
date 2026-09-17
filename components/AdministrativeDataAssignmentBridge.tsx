import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Search, ShieldCheck, X } from 'lucide-react';
import type { Person } from '../types';
import { getDocuments, updateDocument } from '../src/services/databaseService';
import { formatIban, formatSpanishSocialSecurityNumber, normalizeIban, normalizeSpanishSocialSecurityNumber } from '../src/lib/personalDataValidators';

type ScanDetail = {
  dni?: string;
  birthDate?: string;
  nuss?: string;
  iban?: string;
  documentText?: string;
};

const norm = (v: unknown) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const AdministrativeDataAssignmentBridge: React.FC = () => {
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [workers, setWorkers] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<ScanDetail>;
      const next = custom.detail || {};
      if (!next.dni && !next.birthDate && !next.nuss && !next.iban) return;

      // Este listener se registra en fase de captura para evitar que el antiguo
      // formulario de alta interprete automáticamente que existe un trabajador
      // "en curso". Primero debe decidirlo el usuario.
      event.stopImmediatePropagation();
      setDetail(next);
      setSaved(false);
      setQuery('');
      setSelectedId(null);
      void getDocuments<Person>('trabajadores', { limitCount: 5000 })
        .then(items => {
          setWorkers(items);
          const detectedDni = norm(next.dni).replace(/[\s-]/g, '');
          if (detectedDni) {
            const match = items.find(w => norm(w.dni).replace(/[\s-]/g, '') === detectedDni);
            if (match) setSelectedId(match.id);
          }
        })
        .catch(() => setWorkers([]));
    };
    window.addEventListener('profea:administrative-data-recognized', handler as EventListener, true);
    return () => window.removeEventListener('profea:administrative-data-recognized', handler as EventListener, true);
  }, []);

  const filtered = useMemo(() => {
    const q = norm(query);
    const list = !q ? workers : workers.filter(w => norm(`${w.apellidosNombre} ${w.dni} ${w.obra} ${w.numOferta} ${w.categoria}`).includes(q));
    return list.slice(0, 80);
  }, [workers, query]);

  const selected = workers.find(w => w.id === selectedId) || null;

  const assign = async () => {
    if (!detail || !selected) return;
    setBusy(true);
    try {
      const patch: Partial<Person> & Record<string, unknown> = {};
      if (detail.dni) patch.dni = String(detail.dni).replace(/[\s-]/g, '').toUpperCase();
      if (detail.birthDate) patch.fechaNacimiento = detail.birthDate;
      if (detail.nuss) patch.numeroSeguridadSocial = normalizeSpanishSocialSecurityNumber(detail.nuss);
      if (detail.iban) patch.iban = normalizeIban(detail.iban);
      patch.datosAdministrativosActualizados = new Date().toISOString();
      patch.origenDatosAdministrativos = 'Escáner GestionPROFEA';
      await updateDocument('trabajadores', selected.id, patch as any);
      setSaved(true);
      window.dispatchEvent(new CustomEvent('profea:worker-administrative-data-updated', { detail: { workerId: selected.id } }));
      window.setTimeout(() => setDetail(null), 900);
    } catch (e: any) {
      window.alert(e?.message || 'No se han podido guardar los datos en la ficha del trabajador.');
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return null;
  return <div className="fixed inset-0 z-[320] bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center">
    <div className="w-full max-w-3xl max-h-[94vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-950 border dark:border-slate-800 shadow-2xl">
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b dark:border-slate-800 p-5 flex items-start justify-between gap-3">
        <div><h2 className="font-black text-xl">Asignar datos administrativos</h2><p className="text-sm text-slate-500 mt-1">Selecciona el trabajador al que pertenece el documento escaneado.</p></div>
        <button type="button" onClick={() => setDetail(null)} className="p-2 rounded-xl border"><X className="w-5 h-5"/></button>
      </div>
      <div className="p-5 space-y-5">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          {detail.dni && <div className="rounded-xl border p-3"><div className="text-[10px] uppercase font-black text-slate-400">DNI / NIE reconocido</div><div className="font-black mt-1">{detail.dni}</div></div>}
          {detail.birthDate && <div className="rounded-xl border p-3"><div className="text-[10px] uppercase font-black text-slate-400">Nacimiento</div><div className="font-black mt-1">{detail.birthDate.split('-').reverse().join('/')}</div></div>}
          {detail.nuss && <div className="rounded-xl border p-3"><div className="text-[10px] uppercase font-black text-slate-400">Seguridad Social</div><div className="font-black mt-1">{formatSpanishSocialSecurityNumber(detail.nuss)}</div></div>}
          {detail.iban && <div className="rounded-xl border p-3"><div className="text-[10px] uppercase font-black text-slate-400">Cuenta bancaria / IBAN</div><div className="font-black mt-1 break-all">{formatIban(detail.iban)}</div></div>}
        </div>

        <label className="block"><span className="text-xs font-black uppercase text-slate-500">Buscar trabajador</span><div className="mt-1.5 relative"><Search className="absolute left-3 top-3 w-4 h-4 text-slate-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="DNI, nombre, apellidos, obra, oferta o categoría…" className="w-full rounded-xl border bg-white dark:bg-slate-900 pl-10 pr-3 py-2.5"/></div></label>

        <div className="max-h-72 overflow-y-auto rounded-2xl border dark:border-slate-800 divide-y dark:divide-slate-800">
          {filtered.map(worker => <button key={worker.id} type="button" onClick={() => setSelectedId(worker.id)} className={`w-full text-left p-3 transition-colors ${selectedId === worker.id ? 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-inset ring-blue-500' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}>
            <div className="font-black text-sm">{worker.apellidosNombre || 'Sin nombre'} <span className="font-mono font-medium text-slate-500">· {worker.dni || 'Sin DNI'}</span></div>
            <div className="text-xs text-slate-500 mt-1">{worker.obra || 'Sin obra'} · {worker.categoria || 'Sin categoría'} · Oferta {worker.numOferta || '—'}</div>
          </button>)}
          {!filtered.length && <div className="p-5 text-sm text-slate-500 text-center">No se han encontrado trabajadores.</div>}
        </div>

        {selected && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex gap-3"><ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0"/><div><div className="font-black">Se asignará a {selected.apellidosNombre}</div><div className="text-xs mt-1 text-emerald-800 dark:text-emerald-300">Los datos se guardarán en su ficha y quedarán disponibles para las exportaciones.</div></div></div>}
        {saved && <div className="rounded-xl bg-emerald-600 text-white p-3 font-black flex items-center gap-2"><CheckCircle2 className="w-5 h-5"/>Datos guardados en la ficha del trabajador.</div>}

        <div className="flex justify-end gap-2"><button type="button" onClick={() => setDetail(null)} className="px-4 py-3 rounded-xl border font-bold">Cancelar</button><button type="button" disabled={!selected || busy} onClick={() => void assign()} className="px-5 py-3 rounded-xl bg-[#00548E] text-white font-black disabled:opacity-40">{busy ? 'Guardando…' : 'Asignar y guardar'}</button></div>
      </div>
    </div>
  </div>;
};
