import React from 'react';
import type { InventoryItem, InventoryParkShare } from '../src/services/inventoryService';
import { inventoryUsage } from '../src/lib/inventoryUsage';

export const InventoryUsageBadge: React.FC<{ item: Pick<InventoryItem, 'estado' | 'responsableActual'>; shares: InventoryParkShare[] }> = ({ item, shares }) => {
  const usage = inventoryUsage(item, shares);
  if (!usage.inUse) return <span className="text-xs text-slate-500 dark:text-slate-400">Sin usuario asignado</span>;
  return <span className="inline-flex items-start gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
    <span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: usage.color }} />
    <span className="min-w-0 break-words"><span className="block">En uso</span><span className="block font-semibold">{usage.responsibleName}</span></span>
  </span>;
};
