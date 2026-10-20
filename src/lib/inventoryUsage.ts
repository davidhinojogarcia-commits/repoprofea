import type { InventoryItem, InventoryParkShare } from '../services/inventoryService';

const COLORS = ['#2563EB', '#D97706', '#7C3AED', '#059669', '#0891B2', '#E11D48'];
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

export const inventoryIsInUse = (state?: string | null) => ['asignada a obra', 'en traslado', 'en uso'].includes(normalize(state || ''));

export function inventorySupervisors(shares: InventoryParkShare[]) {
  return shares.filter(share => share.status === 'accepted' && share.userId)
    .slice().sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.userId!.localeCompare(b.userId!));
}

export function inventorySupervisorColor(userId: string | null | undefined, shares: InventoryParkShare[]) {
  const index = inventorySupervisors(shares).findIndex(share => share.userId === userId);
  return index < 0 ? '#64748B' : COLORS[index % COLORS.length];
}

export function inventorySupervisorLabel(share: InventoryParkShare, shares: InventoryParkShare[]) {
  if (share.status === 'pending') return 'Invitación pendiente';
  const index = inventorySupervisors(shares).findIndex(candidate => candidate.userId === share.userId);
  return index < 0 ? 'Supervisor' : `Supervisor ${index + 1}`;
}

export function inventoryUsage(item: Pick<InventoryItem, 'estado' | 'responsableActual'>, shares: InventoryParkShare[]) {
  const inUse = inventoryIsInUse(item.estado);
  const responsible = inUse ? inventorySupervisors(shares).find(share => share.userId === item.responsableActual) || null : null;
  return {
    inUse,
    responsible,
    responsibleName: responsible?.displayName || (inUse ? 'Responsable pendiente de confirmar' : 'Sin usuario asignado'),
    color: inventorySupervisorColor(responsible?.userId, shares),
    label: inUse ? 'En uso' : item.estado,
  };
}

export function inventoryResponsibility(item: Pick<InventoryItem,'estado'|'responsableActual'|'supervisorResponsableId'|'supervisorResponsableNombre'>, shares:InventoryParkShare[]) {
  if(item.supervisorResponsableId){
    const member=inventorySupervisors(shares).find(share=>share.userId===item.supervisorResponsableId);
    return {userId:item.supervisorResponsableId,displayName:member?.displayName||item.supervisorResponsableNombre||'Supervisor registrado en el movimiento'};
  }
  return inventoryUsage(item,shares).responsible;
}

export function filterInventoryItems(items: InventoryItem[], shares: InventoryParkShare[], filters: { search: string; category: string; status: string; supervisorId: string }) {
  const search = normalize(filters.search);
  return items.filter(item => {
    const usage = inventoryUsage(item, shares);
    const responsible=inventoryResponsibility(item,shares);
    const text = normalize([item.codigo, item.nombre, item.categoria, item.marca, item.modelo, item.numeroSerie, item.matricula, item.ubicacionActual, item.estado, usage.label, usage.responsibleName,responsible?.displayName].filter(Boolean).join(' '));
    return (!search || text.includes(search)) && (!filters.category || item.categoria === filters.category)
      && (!filters.status || (filters.status === '__IN_USE__' ? usage.inUse : item.estado === filters.status))
      && (!filters.supervisorId || (filters.supervisorId === '__UNASSIGNED__' ? usage.inUse&&!responsible : responsible?.userId === filters.supervisorId));
  });
}
