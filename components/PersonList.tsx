import { reportOperationalError } from '../src/lib/operationalLog';
import React, { lazy, Suspense, useMemo, useState } from 'react';
import { PersonList as PersonListView } from './PersonListView';
import { DirectoryStatusFilter } from './DirectoryStatusFilter';
import type { DirectoryStatusValue } from './DirectoryStatusFilter';
import { moveWorkersToTrashBulk } from '../src/services/workerImportService';

const PartsPanel=lazy(()=>import('./PartsPanel'));
const WorkerCardScanner=lazy(()=>import('./WorkerCardScanner'));
const getStatus = (person: any): DirectoryStatusValue => {
  const raw = String(person?.aptitudMedica || person?.reconocimientoEstado || '').toLowerCase();
  if (raw.includes('no apto')) return 'no_apto';
  if (raw.includes('limit')) return 'limitaciones';
  if (raw === 'apto' || raw.includes(' apto')) return 'apto';
  return 'pendiente';
};

export const PersonList: React.FC<React.ComponentProps<typeof PersonListView> & {accountId?:string}> = (props) => {
  const [partsWorker,setPartsWorker]=useState<number|null>(null);
  const [scanning, setScanning] = useState(false);
  const closeScanner = React.useCallback(() => setScanning(false), []);
  const openScannedWorker = React.useCallback((id: number) => {
    const worker = props.people.find(person => Number(person.id) === id);
    if (!worker) return false;
    props.onEdit(worker);
    return true;
  }, [props.people, props.onEdit]);
  const [statusFilters, setStatusFilters] = useState<DirectoryStatusValue[]>([]);

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

  const visiblePeople = useMemo(
    () => statusFilters.length === 0 ? props.people : props.people.filter(person => statusFilters.includes(getStatus(person))),
    [props.people, statusFilters],
  );

  return <div>
    <details className="m-3 rounded-xl border p-3"><summary className="cursor-pointer font-bold">Partes y avisos · historial restringido</summary><label className="block mt-2">Seleccionar contratación por ID<select className="mt-1 w-full rounded-xl border bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-white" value={partsWorker??''} onChange={e=>setPartsWorker(e.target.value?Number(e.target.value):null)}><option value="">Selecciona un trabajador</option>{props.people.map(p=><option key={p.id} value={p.id}>{p.apellidosNombre} · {p.obra} · ID {p.id}</option>)}</select></label>{partsWorker!==null&&<Suspense fallback={<p>Cargando historial…</p>}><PartsPanel key={props.accountId+':'+partsWorker} accountId={props.accountId} workerId={partsWorker}/></Suspense>}</details>
    {props.people.length > 0 && <DirectoryStatusFilter value={statusFilters} onChange={setStatusFilters} counts={counts} />}
    <PersonListView {...props} people={visiblePeople} onDeleteMultiple={handleDeleteMultiple} onScanWorkerCard={() => setScanning(true)} />
    {scanning && <Suspense fallback={<p role="status">Preparando escáner…</p>}><WorkerCardScanner onClose={closeScanner} onFound={openScannedWorker} /></Suspense>}
  </div>;
};
