import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useEffect } from 'react';
import { getDocuments, updateDocument } from '../src/services/databaseService';
import type { Person } from '../types';

const normalizeDni = (value: string) => String(value || '').replace(/[\s-]/g, '').toUpperCase();

/**
 * Complementa el formulario de alta sin duplicar la fuente de verdad.
 * Cuando la formación PRL 20h está marcada como "No", añade fecha y hora
 * de impartición junto al lugar ya existente y persiste esos datos en la
 * propia ficha del trabajador recién creado.
 */
export const PrlTrainingScheduleBridge: React.FC = () => {
  useEffect(() => {
    let draftDate = '';
    let draftTime = '';
    let observer: MutationObserver | null = null;

    const findRegistrationForm = (): HTMLFormElement | null => {
      const forms = Array.from(document.querySelectorAll('form')) as HTMLFormElement[];
      return forms.find(form => form.querySelector('[name="formacion"]') && form.querySelector('[name="dni"]')) || null;
    };

    const ensureFields = () => {
      const form = findRegistrationForm();
      if (!form) return;
      const formation = form.querySelector('[name="formacion"]') as HTMLSelectElement | HTMLInputElement | null;
      const place = form.querySelector('[name="lugarFormacion"]') as HTMLInputElement | null;
      const existing = form.querySelector('[data-profea-prl-schedule="1"]') as HTMLElement | null;
      const needsCourse = String(formation?.value || '').trim().toLowerCase() === 'no';

      if (!needsCourse || !place) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;

      const wrapper = document.createElement('div');
      wrapper.dataset.profeaPrlSchedule = '1';
      wrapper.className = 'grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3';
      wrapper.innerHTML = `
        <div class="space-y-1.5">
          <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400">Día formación PRL 20h *</label>
          <input data-profea-prl-date="1" type="date" required class="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400">Hora formación PRL 20h *</label>
          <input data-profea-prl-time="1" type="time" required class="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100" />
        </div>`;
      const dateInput = wrapper.querySelector('[data-profea-prl-date="1"]') as HTMLInputElement;
      const timeInput = wrapper.querySelector('[data-profea-prl-time="1"]') as HTMLInputElement;
      dateInput.value = draftDate;
      timeInput.value = draftTime;
      dateInput.addEventListener('input', () => { draftDate = dateInput.value; });
      timeInput.addEventListener('input', () => { draftTime = timeInput.value; });
      place.parentElement?.insertAdjacentElement('afterend', wrapper);
    };

    const persistAfterRegistration = async (dni: string, obra: string, numOferta: string, date: string, time: string) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, attempt === 0 ? 450 : 700));
        try {
          const workers = await getDocuments<Person>('trabajadores', { limitCount: 5000 });
          const exact = workers.find(worker =>
            normalizeDni(worker.dni) === dni &&
            (!obra || String(worker.obra || '').trim() === obra) &&
            (!numOferta || String(worker.numOferta || '').trim() === numOferta)
          ) || workers.find(worker => normalizeDni(worker.dni) === dni);
          if (!exact) continue;
          await updateDocument('trabajadores', exact.id, {
            fechaFormacionPrl: date,
            horaFormacionPrl: time,
          } as any);
          window.dispatchEvent(new CustomEvent('profea:prl-training-schedule-saved', { detail: { workerId: exact.id } }));
          return;
        } catch (error) {
          if (attempt === 11) reportOperationalError('[prl-training-schedule] No se pudo guardar la convocatoria PRL:', error);
        }
      }
    };

    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      if (target?.name === 'formacion') {
        if (String(target.value).trim().toLowerCase() !== 'no') {
          draftDate = '';
          draftTime = '';
        }
        queueMicrotask(ensureFields);
      }
    };

    const onSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || !form.querySelector('[name="formacion"]') || !form.querySelector('[name="dni"]')) return;
      const formation = form.querySelector('[name="formacion"]') as HTMLSelectElement | null;
      if (String(formation?.value || '').trim().toLowerCase() !== 'no') return;

      const place = String((form.querySelector('[name="lugarFormacion"]') as HTMLInputElement | null)?.value || '').trim();
      const date = String((form.querySelector('[data-profea-prl-date="1"]') as HTMLInputElement | null)?.value || draftDate).trim();
      const time = String((form.querySelector('[data-profea-prl-time="1"]') as HTMLInputElement | null)?.value || draftTime).trim();
      if (!place || !date || !time) {
        event.preventDefault();
        event.stopPropagation();
        (event as any).stopImmediatePropagation?.();
        window.alert('⚠️ Si el trabajador no tiene la formación PRL 20h, debes indicar día, hora y lugar de impartición.');
        return;
      }

      const dni = normalizeDni((form.querySelector('[name="dni"]') as HTMLInputElement | null)?.value || '');
      const obra = String((form.querySelector('[name="obra"]') as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
      const numOferta = String((form.querySelector('[name="numOferta"]') as HTMLInputElement | null)?.value || '').trim();
      if (dni) void persistAfterRegistration(dni, obra, numOferta, date, time);
    };

    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);
    observer = new MutationObserver(ensureFields);
    observer.observe(document.body, { childList: true, subtree: true });
    ensureFields();

    return () => {
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, true);
      observer?.disconnect();
    };
  }, []);

  return null;
};
