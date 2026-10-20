import React from 'react';
import type { InventoryItem, InventoryParkShare } from '../src/services/inventoryService';
import { inventoryUsage,inventoryResponsibility,inventorySupervisorColor } from '../src/lib/inventoryUsage';

export const InventoryUsageBadge: React.FC<{ item: Pick<InventoryItem, 'estado' | 'responsableActual'|'supervisorResponsableId'|'supervisorResponsableNombre'>; shares: InventoryParkShare[] }> = ({ item, shares }) => {
  const usage = inventoryUsage(item, shares);
  const supervisor=inventoryResponsibility(item,shares);
  if(item.supervisorResponsableId&&supervisor)return <span className="inline-flex items-start gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs"><span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{backgroundColor:inventorySupervisorColor(supervisor.userId,shares)}}/><span className="min-w-0 break-words"><span className="block font-bold">{supervisor.displayName}</span><span className="block">Supervisor del último movimiento</span>{usage.inUse&&<span className="block">En uso: {usage.responsibleName}</span>}</span></span>;
  if (!usage.inUse) return <span className="text-xs text-slate-500 dark:text-slate-400">Sin usuario asignado</span>;
  return <span className="inline-flex items-start gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
    <span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: usage.color }} />
    <span className="min-w-0 break-words"><span className="block">En uso</span><span className="block font-semibold">{usage.responsibleName}</span></span>
  </span>;
};
