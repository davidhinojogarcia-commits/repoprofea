import React, { useMemo, useState } from 'react';
import { FileText, Download, X } from 'lucide-react';
import { Person, getAptitudMedicaInfo } from '../types';
import { generateMedicalSpecialAttentionPdf, SpecialAttentionColumns } from '../src/lib/medicalSpecialAttentionPdf';
import { downloadPDF } from '../src/lib/exportUtils';

interface Props {
  isOpen: boolean;
  people: Person[];
  onClose: () => void;
}

type StatusFilter = 'aptos' | 'apto' | 'limitados';
const safe = (value: unknown) => String(value ?? '').trim();

const personMonth = (p: Person) => {
  const source = safe(p.reconocimientoFecha) || safe(p.periodoInicio) || safe(p.fechaRegistro);
  const match = source.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
};

const monthLabel = (value: string) => {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
};

const statusLabel = (estado: StatusFilter) => estado === 'limitados'
  ? 'Aptos con limitaciones'
  : estado === 'apto'
    ? 'Solo aptos'
    : 'Aptos + aptos con limitaciones';

export const MedicalSpecialAttentionReportModal: React.FC<Props> = ({ isOpen, people, onClose }) => {
  const [obra, setObra] = useState('');
  const [mes, setMes] = useState('');
  const [quincena, setQuincena] = useState('');
  const [estado, setEstado] = useState<StatusFilter>('limitados');
  const [isExporting, setIsExporting] = useState(false);
  const [columns, setColumns] = useState<SpecialAttentionColumns>({ dni: true, obra: true, quincena: true, fecha: true, estado: true, limitaciones: true });

  const obras = useMemo<string[]>(() => Array.from(new Set<string>(people.map(p => safe(p.obra)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')), [people]);
  const meses = useMemo<string[]>(() => Array.from(new Set<string>(people.map(personMonth).filter(Boolean))).sort().reverse(), [people]);
  const quincenas = useMemo<string[]>(() => Array.from(new Set<string>(people.map(p => safe(p.quincena)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')), [people]);

  const rows = useMemo(() => people.filter(p => {
    const info = getAptitudMedicaInfo(p);
    if (obra && safe(p.obra) !== obra) return false;
    if (mes && personMonth(p) !== mes) return false;
    if (quincena && safe(p.quincena) !== quincena) return false;
    if (estado === 'apto' && info.estado !== 'Apto') return false;
    if (estado === 'limitados' && info.estado !== 'Apto con limitaciones') return false;
    if (estado === 'aptos' && !['Apto', 'Apto con limitaciones'].includes(info.estado)) return false;
    return true;
  }).sort((a, b) => `${a.obra} ${a.apellidosNombre}`.localeCompare(`${b.obra} ${b.apellidosNombre}`, 'es')), [people, obra, mes, quincena, estado]);

  if (!isOpen) return null;

  const toggle = (key: keyof SpecialAttentionColumns) => setColumns(prev => ({ ...prev, [key]: !prev[key] }));

  const generatePdf = async () => {
    if (!rows.length) {
      alert('No hay trabajadores que coincidan con los filtros seleccionados.');
      return;
    }
    setIsExporting(true);
    try {
      const { doc, filename } = generateMedicalSpecialAttentionPdf(rows, {
        obra,
        mes,
        mesLabel: mes ? monthLabel(mes) : '',
        quincena,
        estadoLabel: statusLabel(estado),
      }, columns);
      downloadPDF(doc, filename);
    } catch (err) {
      console.error('Error rendering special attention PDF:', err);
      alert('Ocurrió un error al compilar el informe. Por favor, inténtelo de nuevo.');
    } finally {
      setIsExporting(false);
    }
  };

  return <div className="fixed inset-0 z-[120] bg-slate-950/60 p-3 sm:p-6 flex items-center justify-center" role="dialog" aria-modal="true">
    <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><FileText className="w-5 h-5 text-amber-600"/><h2 className="font-black text-lg">Informe de trabajadores con especial atención</h2></div>
          <p className="text-xs text-slate-500 mt-1">Genera un PDF institucional con los trabajadores seleccionados, sus limitaciones y los filtros aplicados.</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Cerrar"><X className="w-5 h-5"/></button>
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs font-bold">Obra<select className="ui-input mt-1 w-full" value={obra} onChange={e=>setObra(e.target.value)}><option value="">Todas</option>{obras.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
          <label className="text-xs font-bold">Mes<select className="ui-input mt-1 w-full" value={mes} onChange={e=>setMes(e.target.value)}><option value="">Todos</option>{meses.map(v=><option key={v} value={v}>{monthLabel(v)}</option>)}</select></label>
          <label className="text-xs font-bold">Quincena<select className="ui-input mt-1 w-full" value={quincena} onChange={e=>setQuincena(e.target.value)}><option value="">Todas</option>{quincenas.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
          <label className="text-xs font-bold">Aptitud<select className="ui-input mt-1 w-full" value={estado} onChange={e=>setEstado(e.target.value as StatusFilter)}><option value="limitados">Aptos con limitaciones</option><option value="apto">Solo aptos</option><option value="aptos">Aptos + con limitaciones</option></select></label>
        </div>

        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">Columnas del PDF</div>
          <div className="flex flex-wrap gap-2">{([['dni','DNI/NIE'],['obra','Obra'],['quincena','Quincena'],['fecha','Fecha'],['estado','Aptitud'],['limitaciones','Limitaciones']] as [keyof SpecialAttentionColumns,string][]).map(([key,label])=><label key={key} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={columns[key]} onChange={()=>toggle(key)}/>{label}</label>)}</div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950/40 text-sm font-bold">Vista previa · {rows.length} trabajador(es)</div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[340px] overflow-y-auto">{rows.length ? rows.map(p=>{const info=getAptitudMedicaInfo(p);return <div key={p.id} className="p-3 text-sm"><div className="font-bold">{p.apellidosNombre} <span className="font-normal text-slate-500">· {p.dni || 'Sin DNI'}</span></div><div className="text-xs text-slate-500 mt-1">{p.obra || 'Sin obra'}{p.quincena?` · ${p.quincena}`:''} · {info.estado}</div>{info.estado==='Apto con limitaciones'&&<div className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">Limitaciones: {info.limitaciones || 'Pendiente de detalle'}</div>}</div>}) : <div className="p-6 text-center text-sm text-slate-500">No hay trabajadores que coincidan con los filtros.</div>}</div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border font-bold text-sm">Cerrar</button>
          <button disabled={isExporting || !rows.length} onClick={()=>void generatePdf()} className="px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"><Download className="w-4 h-4"/>{isExporting ? 'Generando…' : 'Generar PDF'}</button>
        </div>
      </div>
    </div>
  </div>;
};
