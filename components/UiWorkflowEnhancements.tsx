import React, { useEffect } from 'react';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const dispatchChange = (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

const enhanceNextHiringMonth = () => {
  const now = new Date();
  const nextMonthIndex = (now.getMonth() + 1) % 12;
  const nextYear = now.getFullYear() + (now.getMonth() === 11 ? 1 : 0);
  document.querySelectorAll<HTMLSelectElement>('select').forEach((monthSelect) => {
    if (monthSelect.dataset.profeaNextMonthApplied === '1') return;
    const values = Array.from(monthSelect.options).map((o) => o.value || o.textContent || '');
    if (!MONTHS.every((month) => values.includes(month))) return;
    const parent = monthSelect.parentElement?.parentElement || monthSelect.parentElement;
    if (!parent) return;
    const selects = Array.from(parent.querySelectorAll<HTMLSelectElement>('select'));
    const yearSelect = selects.find((s) => s !== monthSelect && Array.from(s.options).some((o) => /^20\d{2}$/.test(o.value || o.textContent || '')));
    const fortnightSelect = selects.find((s) => s !== monthSelect && Array.from(s.options).some((o) => /^1/.test(o.value || o.textContent || '')) && Array.from(s.options).some((o) => /^2/.test(o.value || o.textContent || '')));
    if (!yearSelect || !fortnightSelect) return;
    monthSelect.dataset.profeaNextMonthApplied = '1';
    const desiredMonth = MONTHS[nextMonthIndex];
    if (monthSelect.value === MONTHS[now.getMonth()] || !monthSelect.value) dispatchChange(monthSelect, desiredMonth);
    const desiredYear = String(nextYear);
    if (yearSelect.value === String(now.getFullYear()) || !yearSelect.value) dispatchChange(yearSelect, desiredYear);
  });
};

const enhanceWorkerSearch = () => {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('h2')).filter((h) => h.textContent?.includes('Otros documentos de obra'));
  headings.forEach((heading) => {
    const modal = heading.closest('.rounded-3xl') || heading.closest('[class*="max-w-5xl"]');
    if (!modal) return;
    const labels = Array.from(modal.querySelectorAll<HTMLLabelElement>('label'));
    const workerLabel = labels.find((label) => normalize(label.textContent || '').startsWith('trabajador'));
    if (!workerLabel || workerLabel.dataset.profeaSearchEnhanced === '1') return;
    const select = workerLabel.querySelector<HTMLSelectElement>('select');
    if (!select) return;
    workerLabel.dataset.profeaSearchEnhanced = '1';
    select.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'mt-1.5 relative';
    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = 'Buscar por DNI, nombre, apellidos, categoría…';
    input.className = 'w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm';
    const results = document.createElement('div');
    results.className = 'hidden absolute z-[150] left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl';
    wrap.append(input, results);
    select.insertAdjacentElement('afterend', wrap);
    const options = () => Array.from(select.options).filter((o) => o.value);
    const selected = () => options().find((o) => o.value === select.value);
    const syncInput = () => { if (document.activeElement !== input) input.value = selected()?.textContent?.trim() || ''; };
    syncInput();
    const render = () => {
      const q = normalize(input.value);
      results.innerHTML = '';
      const matches = options().filter((o) => !q || normalize(o.textContent || '').includes(q)).slice(0, 30);
      if (!q) { results.classList.add('hidden'); return; }
      matches.forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full text-left px-3 py-2.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/30 text-sm';
        button.textContent = option.textContent || '';
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          dispatchChange(select, option.value);
          input.value = option.textContent?.trim() || '';
          results.classList.add('hidden');
        });
        results.appendChild(button);
      });
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'px-3 py-3 text-sm text-slate-500';
        empty.textContent = 'No se han encontrado trabajadores con ese criterio.';
        results.appendChild(empty);
      }
      results.classList.remove('hidden');
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => window.setTimeout(() => { results.classList.add('hidden'); syncInput(); }, 120));
    select.addEventListener('change', syncInput);
  });
};

export const UiWorkflowEnhancements: React.FC = () => {
  useEffect(() => {
    const apply = () => { enhanceNextHiringMonth(); enhanceWorkerSearch(); };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
};
