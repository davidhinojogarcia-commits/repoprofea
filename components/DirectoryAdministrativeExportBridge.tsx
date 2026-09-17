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

const normalizeLabel = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/:$/, '')
  .trim()
  .toUpperCase();

export const DirectoryAdministrativeExportBridge: React.FC = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      #directorio-section .directorio-export-row{display:grid!important;grid-template-columns:minmax(250px,250px) 112px 112px!important;align-items:center!important;gap:8px!important;width:490px!important;max-width:100%!important}
      #directorio-section .directorio-export-row>span{width:250px!important;margin:0!important;text-align:right!important;justify-content:flex-end!important;white-space:normal!important;line-height:1.15!important}
      #directorio-section .directorio-export-row>button{width:112px!important;min-width:112px!important;height:40px!important;padding:0 14px!important;border-radius:10px!important;font-size:11px!important;line-height:1!important;font-weight:700!important;text-transform:uppercase!important;letter-spacing:.015em!important;box-shadow:0 1px 2px rgba(15,23,42,.08)!important}
      #directorio-section .directorio-export-row>button:nth-of-type(1){background:rgb(239 246 255)!important;color:rgb(3 105 161)!important;border:1px solid rgb(186 230 253)!important}
      #directorio-section .directorio-export-row>button:nth-of-type(2){background:rgb(236 253 245)!important;color:rgb(4 120 87)!important;border:1px solid rgb(167 243 208)!important}
      #directorio-section .directorio-export-groups{border-top:0!important;padding-top:0!important;margin-top:0!important}
      @media(max-width:640px){#directorio-section .directorio-export-row{grid-template-columns:minmax(130px,1fr) 96px 96px!important;width:100%!important}#directorio-section .directorio-export-row>span{width:auto!important;font-size:9px!important;text-align:left!important;justify-content:flex-start!important}#directorio-section .directorio-export-row>button{width:96px!important;min-width:96px!important;height:40px!important;padding:0 8px!important}}
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

    const ensureRowsAndLabels = () => {
      const root = document.getElementById('directorio-section');
      if (root) {
        root.querySelectorAll<HTMLElement>('span,div,label').forEach(node => {
          const label = normalizeLabel(node.textContent || '');
          if (label === 'RELACION DE TRABAJADORES' || label === 'RELACION DE TRABAJADORES OBRA') {
            node.textContent = 'RELACIÓN DE TRABAJADORES PARA ENCARGADOS:';
          }
        });
      }

      const group = document.querySelector<HTMLElement>('#directorio-section .directorio-export-groups .flex.flex-col.gap-2');
      if (!group || group.querySelector('[data-admin-relation-row="1"]')) return;
      const row = document.createElement('div');
      row.dataset.adminRelationRow = '1';
      row.className = 'directorio-export-row flex items-center justify-end gap-2';
      row.innerHTML = `
        <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center">Relación administrativa de trabajadores:</span>
        <button type="button" data-admin-export="pdf" class="flex-none flex items-center justify-center transition-colors shadow-sm uppercase border">▣&nbsp; PDF</button>
        <button type="button" data-admin-export="excel" class="flex-none flex items-center justify-center transition-colors shadow-sm uppercase border">⇩&nbsp; Excel</button>`;
      row.querySelector('[data-admin-export="pdf"]')?.addEventListener('click', () => void exportData('pdf'));
      row.querySelector('[data-admin-export="excel"]')?.addEventListener('click', () => void exportData('excel'));
      group.prepend(row);
    };

    ensureRowsAndLabels();
    const observer = new MutationObserver(ensureRowsAndLabels);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); style.remove(); };
  }, []);
  return null;
};
