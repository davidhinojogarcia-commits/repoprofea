import React, { useEffect, useMemo, useState } from 'react';
import { Save, UserCheck, Building2, Phone, Mail, BadgeCheck } from 'lucide-react';
import {
  DEFAULT_ADMINISTRATIVE_SETTINGS,
  DEFAULT_PROVIDER_CONTACT_SETTINGS,
  loadAppBusinessSettings,
  saveAppBusinessSettings,
  type AdministrativeSettings,
  type ProviderContactSettings,
} from '../src/services/appSettingsService';

type ContactKind = 'administrative' | 'medicalCompany' | 'footwearProvider' | 'trainingCompany';

interface Props {
  kind: ContactKind;
  onToast?: React.Dispatch<React.SetStateAction<{ message: string; type: 'success' | 'error' } | null>>;
}

const META: Record<ContactKind, { title: string; description: string; company: boolean }> = {
  administrative: {
    title: 'Administrativo/a',
    description: 'Destinatario de la relación administrativa de trabajadores.',
    company: false,
  },
  medicalCompany: {
    title: 'Empresa de reconocimientos médicos',
    description: 'Destinatario de la relación de citas de reconocimientos médicos.',
    company: true,
  },
  footwearProvider: {
    title: 'Proveedor de calzado',
    description: 'Destinatario del resumen de calzado.',
    company: true,
  },
  trainingCompany: {
    title: 'Empresa de formación',
    description: 'Destinatario de la relación de formación PRL.',
    company: true,
  },
};

export const CommunicationContactSettings: React.FC<Props> = ({ kind, onToast }) => {
  const meta = META[kind];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [admin, setAdmin] = useState<AdministrativeSettings>(DEFAULT_ADMINISTRATIVE_SETTINGS);
  const [provider, setProvider] = useState<ProviderContactSettings>(DEFAULT_PROVIDER_CONTACT_SETTINGS);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadAppBusinessSettings()
      .then(settings => {
        if (!active) return;
        if (kind === 'administrative') setAdmin({ ...DEFAULT_ADMINISTRATIVE_SETTINGS, ...(settings.administrative || {}) });
        else setProvider({ ...DEFAULT_PROVIDER_CONTACT_SETTINGS, ...((settings as any)[kind] || {}) });
      })
      .catch(error => {
        console.error('[communication-contact-settings]', error);
        onToast?.({ message: 'No se pudo cargar esta configuración.', type: 'error' });
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [kind, onToast]);

  const emailValid = useMemo(() => {
    const email = kind === 'administrative' ? admin.email : provider.email;
    return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, [kind, admin.email, provider.email]);

  const save = async () => {
    if (!emailValid) {
      onToast?.({ message: 'Revise el correo electrónico: no tiene un formato válido.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      if (kind === 'administrative') await saveAppBusinessSettings({ administrative: admin });
      else await saveAppBusinessSettings({ [kind]: provider } as any);
      window.dispatchEvent(new CustomEvent('profea:communication-settings-updated', { detail: { kind } }));
      onToast?.({ message: `${meta.title} guardado correctamente.`, type: 'success' });
    } catch (error: any) {
      console.error('[communication-contact-settings]', error);
      onToast?.({ message: error?.message || 'No se pudo guardar la configuración.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#00548E]/25';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          {meta.company ? <Building2 className="w-6 h-6 text-[#00548E] dark:text-blue-400" /> : <UserCheck className="w-6 h-6 text-[#00548E] dark:text-blue-400" />}
          {meta.title}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{meta.description}</p>
      </div>

      <div className="p-6 space-y-5">
        {loading ? (
          <div className="text-sm text-slate-500">Cargando configuración…</div>
        ) : kind === 'administrative' ? (
          <>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              Nombre y apellidos
              <input className={inputClass + ' mt-1.5'} value={admin.nombreApellidos} onChange={e => setAdmin(v => ({ ...v, nombreApellidos: e.target.value }))} />
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                Teléfono de contacto
                <div className="relative mt-1.5"><Phone className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input className={inputClass + ' pl-9'} value={admin.telefono} onChange={e => setAdmin(v => ({ ...v, telefono: e.target.value }))} /></div>
              </label>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                Correo electrónico
                <div className="relative mt-1.5"><Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input type="email" className={inputClass + ' pl-9'} value={admin.email} onChange={e => setAdmin(v => ({ ...v, email: e.target.value }))} /></div>
              </label>
            </div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              Nº de trabajador / empleado
              <div className="relative mt-1.5"><BadgeCheck className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input className={inputClass + ' pl-9'} value={admin.numeroTrabajador} onChange={e => setAdmin(v => ({ ...v, numeroTrabajador: e.target.value }))} /></div>
            </label>
          </>
        ) : (
          <>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              Empresa / proveedor
              <input className={inputClass + ' mt-1.5'} value={provider.empresa} onChange={e => setProvider(v => ({ ...v, empresa: e.target.value }))} />
            </label>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              Nombre y apellidos del contacto responsable
              <input className={inputClass + ' mt-1.5'} value={provider.nombreApellidos} onChange={e => setProvider(v => ({ ...v, nombreApellidos: e.target.value }))} />
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                Teléfono de contacto
                <div className="relative mt-1.5"><Phone className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input className={inputClass + ' pl-9'} value={provider.telefono} onChange={e => setProvider(v => ({ ...v, telefono: e.target.value }))} /></div>
              </label>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                Correo electrónico
                <div className="relative mt-1.5"><Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input type="email" className={inputClass + ' pl-9'} value={provider.email} onChange={e => setProvider(v => ({ ...v, email: e.target.value }))} /></div>
              </label>
            </div>
          </>
        )}

        {!emailValid && <div className="text-xs font-semibold text-red-600 dark:text-red-400">El correo electrónico no tiene un formato válido.</div>}

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white px-5 py-3 text-sm font-black disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};
