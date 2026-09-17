import React, { useEffect } from 'react';
import type { Person } from '../types';
import { getDocuments } from '../src/services/databaseService';
import { prepareAdministrativeRelationExcel, prepareAdministrativeRelationPDF } from '../src/lib/administrativeRelationExport';

const workerIdFromNode = (node: Element | null): number | null => {
  if (!node) return null;
  const raw = node.id.replace(/^person-table-row-/, '').replace(/^compact-card-/, '');
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
};

const getCurrentExportIds = () => {
  const root = document.getElementById('directorio-section');
  if (!root) return [] as number[];

  const selected = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
    .map(input => input.closest('[id^="person-table-row-"], [id^="compact-card-"]'))
    .map(workerIdFromNode)
    .filter((id): id is number => id !== null);
  if (selected.length) return Array.from(new Set(selected));

  const visible = Array.from(root.querySelectorAll<HTMLElement>('[id^="person-table-row-"], [id^="compact-card-"]'))
    .filter(node => node.offsetParent !== null)
    .map(workerIdFromNode)
    .filter((id): id is number => id !== null);
  return Array.from(new Set(visible));
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const DirectoryAdministrativeExportBridge: React.FC = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      #directorio-section .directorio-export-row{display:grid!important;grid-template-columns:minmax(210px,210px) 112px 112px!important;align-items:center!important;gap:8px!important;width:450px!important;max-width:100%!important}
      #directorio-section .directorio-export-row>span{width:210px!important;margin-right:0!important;text-align:right!important;justify-content:flex-end!important;white-space:normal!important;line-height:1.15!important}
      #directorio-section .directorio-export-row>button{width:112px!important;min-width:112px!important;height:36px!important;padding-top:6px!important;padding-bottom:6px!important}
      @media(max-width:640px){#directorio-section .directorio-export-row{grid-template-columns:minmax(130px,1fr) 96px 96px!important;width:100%!important}#directorio-section .directorio-export-row>span{width:auto!important;font-size:9px!important;text-align:left!important;justify-content:flex-start!important}#directorio-section .directorio-export-row>button{width:96px!important;min-width:96px!important}}
    `;
    document.head.appendChild(style);

    const exportData = async (format: 'pdf' | 'excel') => {
      try {
        const all = await getDocuments<Person>('trabajadores', { limitCount: 5000 });
        const ids = getCurrentExportIds();
        const data = ids.length ? ids.map(id => all.find(p => Number(p.id) === id)).filter(Boolean) as Person[] : all;
        if (!data.length) return window.alert('No hay trabajadores filtrados para exportar.');
        if (format === 'pdf') {
          const { doc, filename } = prepareAdministrativeRelationPDF(data);
          downloadBlob(doc.output('blob'), filename);
        } else {
          const { buffer, filename } = await prepareAdministrativeRelationExcel(data);
          downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
        }
      } catch (e: any) {
        window.alert(e?.message || 'No se pudo generar la relación administrativa.');
      }
    };

    const ensureRow = () => {
      const group = document.querySelector<HTMLElement>('#directorio-section .directorio-export-groups .flex.flex-col.gap-2');
      if (!group || group.querySelector('[data-admin-relation-row="1"]')) return;
      const row = document.createElement('div');
      row.dataset.adminRelationRow = '1';
      row.className = 'directorio-export-row flex items-center justify-end gap-2';
      row.innerHTML = `
        <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center mr-2">Relación administrativa de trabajadores:</span>
        <button type="button" data-admin-export="pdf" class="w-[112px] flex-none flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">▣&nbsp; PDF</button>
        <button type="button" data-admin-export="excel" class="w-[112px] flex-none flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">⇩&nbsp; Excel</button>`;
      row.querySelector('[data-admin-export="pdf"]')?.addEventListener('click', () => void exportData('pdf'));
      row.querySelector('[data-admin-export="excel"]')?.addEventListener('click', () => void exportData('excel'));
      group.prepend(row);
    };

    ensureRow();
    const observer = new MutationObserver(ensureRow);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); style.remove(); };
  }, []);
  return null;
};
