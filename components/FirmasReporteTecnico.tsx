import React, { useState } from 'react';
import { Building2, Eye, FileSignature, Save, ShieldCheck, UserCheck, Briefcase } from 'lucide-react';
import { getStoredReporteTecnicoConfig, saveStoredReporteTecnicoConfig, ReporteTecnicoConfig } from '../src/lib/subcontratasDefaults';

interface Props {
  onToast?: (message: string, type: 'success' | 'error') => void;
}

export const FirmasReporteTecnico: React.FC<Props> = ({ onToast }) => {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ReporteTecnicoConfig>(() => getStoredReporteTecnicoConfig());

  const save = () => {
    if (!config.tecnicoNombre.trim()) {
      onToast?.('El Nombre y Apellidos del Técnico es obligatorio.', 'error');
      return;
    }
    saveStoredReporteTecnicoConfig(config);
    onToast?.('Configuración de firmas del Reporte Técnico guardada correctamente.', 'success');
    setOpen(false);
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
      <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-800/20">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 rounded-xl"><FileSignature className="w-5 h-5" /></div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Firmas del Reporte Técnico PDF</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Configuración de firmas para los informes técnicos de las subcontratas CAE.</p>
          </div>
        </div>
        <button type="button" onClick={() => { setConfig(getStoredReporteTecnicoConfig()); setOpen(true); }} className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold shadow-sm transition-colors">
          <FileSignature className="w-4 h-4" /> Configurar firmas
        </button>
      </div>

      {open && (
        <div className="p-5 border-t border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><FileSignature className="w-5 h-5 text-blue-700" /> Datos predeterminados de firma</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Estos datos se conservan y se utilizan al generar los PDF.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Cerrar</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-blue-950 dark:text-blue-200 uppercase tracking-wider"><UserCheck className="w-4 h-4" /> Técnico de Obra *</label>
              <input value={config.tecnicoNombre} onChange={e => setConfig({ ...config, tecnicoNombre: e.target.value })} placeholder="Ej: David Hinojo García" className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-bold text-slate-900 dark:text-slate-100" />
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Coordinador de Seguridad y Salud (CSS)</label>
              <input value={config.coordinadorNombre} onChange={e => setConfig({ ...config, coordinadorNombre: e.target.value })} placeholder="Ej: David Hinojo García" className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100" />
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"><Building2 className="w-4 h-4 text-amber-600" /> Empresa o Entidad de Coordinación</label>
              <input value={config.empresaCoordinacion} onChange={e => setConfig({ ...config, empresaCoordinacion: e.target.value })} placeholder="Ej: Área de Cooperación - Excma. Diputación Provincial de Cádiz" className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100" />
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"><Briefcase className="w-4 h-4 text-indigo-600" /> Supervisor de Obra</label>
              <input value={config.supervisorNombre} onChange={e => setConfig({ ...config, supervisorNombre: e.target.value })} placeholder="Ej: David Hinojo García" className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100" />
            </div>
          </div>
          <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <div className="flex items-center gap-2 mb-3"><Eye className="w-4 h-4 text-blue-700" /><span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Vista previa</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {[
                ['SUPERVISOR DE OBRA', config.supervisorNombre || 'David Hinojo García', 'Supervisor de Obra'],
                ['RECURSO PREVENTIVO', '[Recurso de cada Obra]', 'Encargado de Obra'],
                ['POR EL TÉCNICO', config.tecnicoNombre || 'David Hinojo García', 'Técnico de Obra'],
                ['COORDINACIÓN SEG. Y SALUD', config.coordinadorNombre || 'David Hinojo García', config.empresaCoordinacion || 'Empresa de Coordinación']
              ].map(([title, name, role]) => (
                <div key={title} className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden">
                  <div className="bg-[#1a365d] text-white text-[9px] font-extrabold px-2 py-1 text-center">{title}</div>
                  <div className="h-10 flex items-center justify-center text-slate-300 dark:text-slate-600 text-[10px] italic">[Espacio para Firma]</div>
                  <div className="p-2 border-t border-slate-100 dark:border-slate-800 text-center"><span className="text-[10px] font-bold text-slate-800 dark:text-slate-200 block truncate">Fdo: {name}</span><span className="text-[8px] text-slate-500 dark:text-slate-400 block truncate">{role}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Cancelar</button>
            <button type="button" onClick={save} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold"><Save className="w-4 h-4" /> Guardar configuración</button>
          </div>
        </div>
      )}
    </div>
  );
};
