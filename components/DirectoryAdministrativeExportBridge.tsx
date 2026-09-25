import React, { useEffect, useRef } from 'react';
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
  const exportScopeIdsRef = useRef<number[] | null>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      #directorio-section .directorio-export-row{display:grid!important;grid-template-columns:minmax(210px,210px) 112px 112px!important;align-items:center!important;gap:8px!important;width:450px!important;max-width:100%!important}
      #directorio-section .directorio-export-row>span{width:210px!important;margin-right:0!important;text-align:right!important;justify-content:flex-end!important;white-space:normal!important;line-height:1.15!important}
      #directorio-section .directorio-export-row>button{width:112px!important;min-width:112px!important;height:36px!important;padding-top:6px!important;padding-bottom:6px!important}
      @media(max-width:640px){#directorio-section .directorio-export-row{grid-template-columns:minmax(130px,1fr) 96px 96px!important;width:100%!important}#directorio-section .directorio-export-row>span{width:auto!important;font-size:9px!important;text-align:left!important;justify-content:flex-start!important}#directorio-section .directorio-export-row>button{width:96px!important;min-width:96px!important}}
    `;
    document.head.appendChild(style);

    const handleExportScope = (event: Event) => {
      const detail = (event as CustomEvent<{ ids?: unknown }>).detail;
      const ids = Array.isArray(detail?.ids)
        ? detail.ids.map(Number).filter(Number.isFinite)
        : [];
      exportScopeIdsRef.current = Array.from(new Set(ids));
    };
    window.addEventListener('profea:directory-export-scope', handleExportScope as EventListener);

    const exportData = async (format: 'pdf' | 'excel') => {
      try {
        const all = await getDocuments<Person>('trabajadores', { limitCount: 5000 });
        const liveScope = (window as any).__profeaDirectoryExportScope as { ids?: unknown[] } | undefined;
        const liveIds = Array.isArray(liveScope?.ids)
          ? liveScope!.ids!.map(Number).filter(Number.isFinite)
          : null;
        const scopedIds = liveIds !== null ? Array.from(new Set(liveIds)) : exportScopeIdsRef.current;
        const ids = scopedIds !== null ? scopedIds : getCurrentExportIds();
        const byId = new Map(all.map(person => [Number(person.id), person]));
        const data = ids
          .map(id => byId.get(Number(id)))
          .filter(Boolean) as Person[];
        if (!data.length) return window.alert('No hay trabajadores dentro de los filtros actuales para exportar.');
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
        // El rótulo genérico "RELACIÓN DE TRABAJADORES" no representa una
        // exportación concreta y duplicaba visualmente el bloque de informes.
        root.querySelectorAll<HTMLElement>('span,div,label,p,h1,h2,h3,h4,h5,h6').forEach(node => {
          const directText = Array.from(node.childNodes)
            .filter(child => child.nodeType === Node.TEXT_NODE)
            .map(child => child.textContent || '')
            .join(' ');
          const normalizedDirectText = normalizeLabel(directText);
          const normalizedFullText = normalizeLabel(node.textContent || '');
          const isGenericWorkerLabel =
            normalizedDirectText === 'RELACION DE TRABAJADORES' ||
            (
              normalizedFullText === 'RELACION DE TRABAJADORES' &&
              !node.querySelector('button,a,input,select,textarea')
            );
          if (isGenericWorkerLabel) node.remove();
        });
      }

      const group = document.querySelector<HTMLElement>('#directorio-section .directorio-export-groups .flex.flex-col.gap-2');
      if (!group || group.querySelector('[data-admin-relation-row="1"]')) return;
      const row = document.createElement('div');
      row.dataset.adminRelationRow = '1';
      row.className = 'directorio-export-row flex items-center justify-end gap-2';
      row.innerHTML = `
        <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center mr-2">Relación administrativa de trabajadores:</span>
        <button type="button" data-admin-export="pdf" class="w-[112px] flex-none flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border"><svg viewBox="0 0 24 24" width="12" height="12" class="mr-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" x2="8" y1="13" y2="13"></line><line x1="16" x2="8" y1="17" y2="17"></line><line x1="10" x2="8" y1="9" y2="9"></line></svg>PDF</button>
        <button type="button" data-admin-export="excel" class="w-[112px] flex-none flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border"><svg viewBox="0 0 24 24" width="12" height="12" class="mr-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Excel</button>`;
      row.querySelector('[data-admin-export="pdf"]')?.addEventListener('click', () => void exportData('pdf'));
      row.querySelector('[data-admin-export="excel"]')?.addEventListener('click', () => void exportData('excel'));
      const encargadosRow = group.querySelector('[data-encargados-relation-row="1"]');
      if (encargadosRow) encargadosRow.after(row);
      else group.prepend(row);
    };

    ensureRowsAndLabels();
    const observer = new MutationObserver(ensureRowsAndLabels);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('profea:directory-export-scope', handleExportScope as EventListener);
      style.remove();
    };
  }, []);
  return null;
};
