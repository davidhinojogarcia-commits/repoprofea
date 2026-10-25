import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useMemo, useState } from 'react';
import { PersonList as PersonListView } from './PersonListView';
import { DirectoryStatusFilter } from './DirectoryStatusFilter';
import type { DirectoryStatusValue } from './DirectoryStatusFilter';
import { moveWorkersToTrashBulk } from '../src/services/workerImportService';

const getStatus = (person: any): DirectoryStatusValue => {
  const raw = String(person?.aptitudMedica || person?.reconocimientoEstado || '').toLowerCase();
  if (raw.includes('no apto')) return 'no_apto';
  if (raw.includes('limit')) return 'limitaciones';
  if (raw === 'apto' || raw.includes(' apto')) return 'apto';
  return 'pendiente';
};

export const PersonList: React.FC<React.ComponentProps<typeof PersonListView>> = (props) => {
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
    {props.people.length > 0 && <DirectoryStatusFilter value={statusFilters} onChange={setStatusFilters} counts={counts} />}
    <PersonListView {...props} people={visiblePeople} onDeleteMultiple={handleDeleteMultiple} />
  </div>;
};
