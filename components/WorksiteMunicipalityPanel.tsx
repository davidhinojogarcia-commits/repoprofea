import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, Save, X } from 'lucide-react';
import { supabase } from '../src/lib/supabase';

export const WORKSITE_MUNICIPALITY_CACHE_KEY = 'profea:worksite-municipalities:v1';

type Work = { id: string; nombre: string; municipio?: string | null };

const cacheWorks = (rows: Work[]) => {
  try {
    const map = Object.fromEntries(rows.map(row => [String(row.nombre || '').trim(), String(row.municipio || '').trim()]));
    localStorage.setItem(WORKSITE_MUNICIPALITY_CACHE_KEY, JSON.stringify(map));
  } catch {}
};

export const WorksiteMunicipalityPanel: React.FC = () => {
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(false);
  const [works, setWorks] = useState<Work[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = (await supabase.query('obras', { query: 'select=id,nombre,municipio&order=nombre.asc' })) || [];
      const normalized = rows as Work[];
      setWorks(normalized);
      setEditing(Object.fromEntries(normalized.map(row => [row.id, String(row.municipio || '')])));
      cacheWorks(normalized);
    } catch (error) {
      console.error('No se pudieron cargar los municipios de las obras:', error);
    }
  }, []);

  useEffect(() => {
    const onNavigation = (event: Event) => {
      const view = (event as CustomEvent<{ view?: string }>).detail?.view;
      const isWorksite = view === 'documentacion_obra';
      setActive(isWorksite);
      if (isWorksite) void load();
      else setOpen(false);
    };
    window.addEventListener('profea:navigate', onNavigation as EventListener);
    return () => window.removeEventListener('profea:navigate', onNavigation as EventListener);
  }, [load]);

  const save = async (work: Work) => {
    const municipio = String(editing[work.id] || '').trim();
    if (!municipio) return;
    setBusy(work.id);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error('Sesión no disponible');
      await supabase.query('obras', { method: 'PATCH', prefer: 'return=minimal', query: `id=eq.${encodeURIComponent(work.id)}`, body: { municipio, updated_by: data.user.id } });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!active) return null;
  const pending = works.filter(work => !String(work.municipio || '').trim()).length;

  return <>
    <button type="button" onClick={() => setOpen(true)} className="fixed right-5 bottom-5 z-[60] inline-flex items-center gap-2 rounded-2xl bg-[#00548E] text-white px-4 py-3 font-bold shadow-xl">
      <MapPin className="w-4 h-4" /> Municipios {pending ? `(${pending} pendientes)` : ''}
    </button>
    {open && <div className="fixed inset-0 z-[70] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800"><div><h2 className="font-black text-lg">Municipio de cada obra</h2><p className="text-xs text-slate-500 mt-1">Dato maestro usado automáticamente en los documentos. Las obras sin municipio quedan pendientes; no se inventa ningún valor.</p></div><button type="button" onClick={() => setOpen(false)} className="p-2 rounded-xl"><X className="w-5 h-5" /></button></div>
        <div className="p-5 space-y-3 overflow-y-auto max-h-[68vh]">{works.map(work => <div key={work.id} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-center rounded-2xl border border-slate-200 dark:border-slate-800 p-3"><div className="font-bold text-sm">{work.nombre}</div><input value={editing[work.id] || ''} onChange={e => setEditing(prev => ({ ...prev, [work.id]: e.target.value }))} placeholder="Municipio pendiente de indicar" className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"/><button type="button" disabled={busy === work.id || !String(editing[work.id] || '').trim()} onClick={() => void save(work)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00548E] text-white px-3 py-2 text-sm font-bold disabled:opacity-50"><Save className="w-4 h-4" /> Guardar</button></div>)}</div>
      </div>
    </div>}
  </>;
};
