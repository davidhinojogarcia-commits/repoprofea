import { reportOperationalError } from '../src/lib/operationalLog';
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PersonList as PersonListView } from './PersonListView';
import { DirectoryStatusFilter } from './DirectoryStatusFilter';
import type { DirectoryStatusValue } from './DirectoryStatusFilter';
import { moveWorkersToTrashBulk } from '../src/services/workerImportService';
import { partsRequest } from '../src/services/partsService';
import type { Person } from '../types';
import ModalPortal from './ModalPortal';

const PartsPanel = lazy(() => import('./PartsPanel'));
const WorkerCardScanner = lazy(() => import('./WorkerCardScanner'));
const WorkerCardPairing = lazy(() => import('./WorkerCardPairing'));
type PartsFilter = 'all' | 'with' | 'without' | 'pending' | 'repeated';
type PartSummary = { workerId: number; status: string; repetition: number };
const inactiveStatuses = new Set(['archived','dismissed','closed','annulled']);
const cleanDni = (value: string) => String(value || '').toUpperCase().replace(/[\s-]/g, '');
const getStatus = (person: any): DirectoryStatusValue => {
  const raw = String(person?.aptitudMedica || person?.reconocimientoEstado || '').toLowerCase();
  if (raw.includes('no apto')) return 'no_apto';
  if (raw.includes('limit')) return 'limitaciones';
  if (raw === 'apto' || raw.includes(' apto')) return 'apto';
  return 'pendiente';
};

export const PersonList: React.FC<React.ComponentProps<typeof PersonListView> & { accountId?: string }> = (props) => {
  const [partsWorker, setPartsWorker] = useState<number | null>(null);
  const [partsFilter, setPartsFilter] = useState<PartsFilter>('all');
  const [partsRecords, setPartsRecords] = useState<PartSummary[]>([]);
  const [partsLoading, setPartsLoading] = useState(false);
  const [partsLoaded, setPartsLoaded] = useState(false);
  const [partsError, setPartsError] = useState('');
  const [partsReload, setPartsReload] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [pairing, setPairing] = useState(false);
  const closeScanner = React.useCallback(() => setScanning(false), []);
  const openScannedWorker = React.useCallback((id: number) => {
    const worker = props.people.find(person => Number(person.id) === id);
    if (!worker) return false;
    props.onEdit(worker);
    return true;
  }, [props.people, props.onEdit]);
  const [statusFilters, setStatusFilters] = useState<DirectoryStatusValue[]>([]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setPartsLoading(true);
    setPartsLoaded(false);
    setPartsError('');
    setPartsRecords([]);
    if (!props.accountId) { setPartsLoading(false); return () => controller.abort(); }
    void (async () => {
      try {
        const collected: PartSummary[] = [];
        let cursor: unknown = null;
        const cursors = new Set<string>();
        // El servidor decide los expedientes accesibles. No solicitar datos de otro supervisor.
        for (let page = 0; page < 200; page++) {
          const result: any = await partsRequest({ action: 'list', filters: {}, cursor }, undefined, controller.signal);
          if (!Array.isArray(result.rows)) throw new Error('No se pudo verificar la lista completa de expedientes.');
          for (const row of result.rows) {
            const workerId = Number(row.worker_id ?? row.workerId);
            if (!Number.isSafeInteger(workerId) || workerId <= 0) throw new Error('Expediente sin identificación de trabajador verificable.');
            collected.push({ workerId, status: String(row.status || ''), repetition: Number(row.reiteration_level || 0) });
          }
          const next: unknown = result.cursor ?? null;
          if (next === null || next === '') {
            if (active) { setPartsRecords(collected); setPartsLoaded(true); }
            return;
          }
          const cursorKey = JSON.stringify(next);
          if (!cursorKey || cursors.has(cursorKey)) throw new Error('Paginación de expedientes inconsistente.');
          cursors.add(cursorKey);
          cursor = next;
        }
        throw new Error('Historial demasiado extenso: no se permite aplicar filtros sobre resultados incompletos.');
      } catch (error: any) {
        if (active && error?.name !== 'AbortError') {
          setPartsError(error?.message || 'No fue posible consultar los expedientes.');
          reportOperationalError('directorio-partes-listado', error);
        }
      } finally { if (active) setPartsLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [props.accountId, partsReload]);

  const handleDeleteMultiple = async (ids: number[]) => {
    if (!ids?.length) return;
    if (!window.confirm(`¿Está seguro de que desea enviar ${ids.length} registros a la Papelera? Se almacenarán allí durante 30 días.`)) return;
    try {
      await moveWorkersToTrashBulk(ids);
      props.onToast?.(`${ids.length} registros enviados a la Papelera correctamente`, 'success');
    } catch (error) {
      reportOperationalError('Error en baja múltiple de Supabase:', error);
      props.onToast?.('No se pudieron enviar todos los registros a la Papelera.', 'error');
    }
  };

  const counts = useMemo(() => {
    const result: Record<DirectoryStatusValue, number> = { apto: 0, limitaciones: 0, no_apto: 0, pendiente: 0 };
    props.people.forEach(person => { result[getStatus(person)] += 1; });
    return result;
  }, [props.people]);

  const samePersonIds = useMemo(() => {
    const byDni = new Map<string, number[]>();
    for (const p of props.people) {
      const key = cleanDni(p.dni || '');
      if (!key) continue;
      byDni.set(key, [...(byDni.get(key) || []), Number(p.id)]);
    }
    const result = new Map<number, number[]>();
    for (const p of props.people) result.set(Number(p.id), byDni.get(cleanDni(p.dni || '')) || [Number(p.id)]);
    return result;
  }, [props.people]);

  const recordsById = useMemo(() => {
    const map = new Map<number, PartSummary[]>();
    for (const part of partsRecords) map.set(part.workerId, [...(map.get(part.workerId) || []), part]);
    return map;
  }, [partsRecords]);
  const relatedRecords = useCallback((id: number) => (samePersonIds.get(id) || [id]).flatMap(key => recordsById.get(key) || []), [samePersonIds, recordsById]);
  const recordMatch = useCallback((id: number) => {
    const records = relatedRecords(id);
    if (partsFilter === 'with') return records.length > 0;
    if (partsFilter === 'without') return records.length === 0;
    if (partsFilter === 'pending') return records.some(r => !inactiveStatuses.has(r.status));
    if (partsFilter === 'repeated') return records.some(r => r.repetition >= 2);
    return true;
  }, [partsFilter, relatedRecords]);

  const visiblePeople = useMemo(() =>
    props.people.filter(person => (statusFilters.length === 0 || statusFilters.includes(getStatus(person))) && (!partsLoaded || recordMatch(Number(person.id)))),
    [props.people, statusFilters, partsLoaded, recordMatch],
  );
  const openParts = useCallback((person: Person) => setPartsWorker(Number(person.id)), []);
  const renderPartsAction = useCallback((person: Person) => {
    const num = relatedRecords(Number(person.id)).length;
    return <button type="button" onClick={() => openParts(person)}
      aria-label={`Consultar partes y avisos de ${person.apellidosNombre}`}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#00548E]/30 bg-blue-50 px-3 py-2 text-xs font-bold text-[#00548E] hover:bg-blue-100 dark:border-blue-700 dark:bg-slate-800 dark:text-blue-200">
      Partes y avisos {partsLoaded ? <span className="rounded-full bg-[#00548E] px-2 py-0.5 text-white">{num}</span> : <span className="text-[10px] font-normal">Consultar</span>}
    </button>;
  }, [partsLoaded, relatedRecords, openParts]);

  const chosenPerson = props.people.find(person => Number(person.id) === partsWorker);
  const chosenLinkedPeople = chosenPerson ? props.people.filter(person => (samePersonIds.get(Number(chosenPerson.id)) || []).includes(Number(person.id))) : [];

  return <div>
    {props.people.length > 0 && <DirectoryStatusFilter value={statusFilters} onChange={setStatusFilters} counts={counts} />}
    <PersonListView {...props} people={visiblePeople} renderPartsAction={renderPartsAction}
      renderPartsFilter={
        <div className="flex min-w-0 w-full flex-col justify-center gap-1 px-1 py-1">
          <label htmlFor="directory-parts-filter" className="text-xs font-bold text-slate-700 dark:text-slate-200">Partes y avisos</label>
          <div className="flex min-w-0 w-full items-center gap-2">
            <select id="directory-parts-filter" aria-label="Partes y avisos" value={partsFilter} disabled={!partsLoaded}
              onChange={event => setPartsFilter(event.target.value as PartsFilter)}
              className="min-h-11 min-w-0 w-full flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              <option value="all">Todos</option>
              <option value="with">Con partes o avisos</option>
              <option value="without">Sin partes ni avisos</option>
              <option value="pending">Expedientes pendientes</option>
              <option value="repeated">Avisos reiterados</option>
            </select>
            <button type="button" onClick={() => setPartsReload(x => x + 1)} aria-label="Actualizar partes y avisos" title="Actualizar partes y avisos"
              className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg border border-slate-300 bg-white text-lg font-bold text-[#00548E] hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-slate-800">↻</button>
          </div>
          {partsLoading && <span role="status" className="text-[11px] text-slate-600 dark:text-slate-300">Comprobando expedientes autorizados…</span>}
          {partsError && <span role="alert" className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">Filtro temporalmente no disponible. Comprueba la conexión.</span>}
          {partsLoaded && <span className="sr-only">Los avisos no implican sanción automática.</span>}
        </div>
      }
      onDeleteMultiple={handleDeleteMultiple} onScanWorkerCard={() => setScanning(true)} onPairWorkerCard={() => setPairing(true)} />
    {partsWorker !== null && chosenPerson && <ModalPortal label="Historial restringido de partes y avisos">
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/70 p-3">
        <div role="dialog" aria-modal="true" aria-label="Historial de partes y avisos del trabajador" className="mx-auto my-4 max-w-4xl rounded-2xl bg-white p-4 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-lg font-black">Partes y avisos · {chosenPerson.apellidosNombre}</h3><p className="text-xs text-slate-600 dark:text-slate-300">Historial reservado al supervisor autorizado</p></div>
            <button type="button" className="min-h-11 rounded-xl border px-4 font-bold" onClick={() => {setPartsWorker(null);setPartsReload(x=>x+1);}}>Cerrar</button>
          </div>
          {chosenLinkedPeople.length > 1 && <label className="mb-3 block text-sm font-bold">Contratación / anualidad
            <select aria-label="Contratación del trabajador" value={partsWorker} onChange={e=>setPartsWorker(Number(e.target.value))} className="mt-1 min-h-11 w-full rounded-xl border bg-white px-3 dark:bg-slate-800">
              {chosenLinkedPeople.map(p=><option key={p.id} value={p.id}>{p.obra} · {p.periodoInicio} · ID {p.id}</option>)}
            </select>
          </label>}
          <Suspense fallback={<p>Cargando expedientes…</p>}><PartsPanel key={props.accountId+':'+partsWorker} accountId={props.accountId} workerId={partsWorker}/></Suspense>
        </div>
      </div>
    </ModalPortal>}
    {pairing && <Suspense fallback={<p role="status">Preparando vinculación…</p>}><WorkerCardPairing onClose={() => setPairing(false)} onWorker={openScannedWorker} /></Suspense>}
    {scanning && <Suspense fallback={<p role="status">Preparando escáner…</p>}><WorkerCardScanner onClose={closeScanner} onFound={openScannedWorker} /></Suspense>}
  </div>;
};
