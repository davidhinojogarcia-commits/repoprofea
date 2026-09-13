import React, { useMemo, useState } from 'react';
import { FileText, Printer, X } from 'lucide-react';
import { Person, getAptitudMedicaInfo } from '../types';

interface Props {
  isOpen: boolean;
  people: Person[];
  onClose: () => void;
}

type StatusFilter = 'aptos' | 'apto' | 'limitados';

type Columns = {
  dni: boolean;
  obra: boolean;
  quincena: boolean;
  fecha: boolean;
  estado: boolean;
  limitaciones: boolean;
};

const safe = (value: unknown) => String(value ?? '').trim();
const esc = (value: unknown) => safe(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

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

export const MedicalSpecialAttentionReportModal: React.FC<Props> = ({ isOpen, people, onClose }) => {
  const [obra, setObra] = useState('');
  const [mes, setMes] = useState('');
  const [quincena, setQuincena] = useState('');
  const [estado, setEstado] = useState<StatusFilter>('limitados');
  const [columns, setColumns] = useState<Columns>({ dni: true, obra: true, quincena: true, fecha: true, estado: true, limitaciones: true });

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

  const toggle = (key: keyof Columns) => setColumns(prev => ({ ...prev, [key]: !prev[key] }));

  const printReport = () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
    if (!popup) return;
    const title = estado === 'limitados' ? 'Trabajadores con especial atención · Aptos con limitaciones' : estado === 'apto' ? 'Trabajadores aptos' : 'Trabajadores aptos y aptos con limitaciones';
    const filterText = [obra && `Obra: ${obra}`, mes && `Mes: ${monthLabel(mes)}`, quincena && `Quincena: ${quincena}`].filter(Boolean).join(' · ') || 'Sin filtros adicionales';
    const headers = [
      '<th>Trabajador</th>',
      columns.dni && '<th>DNI/NIE</th>',
      columns.obra && '<th>Obra</th>',
      columns.quincena && '<th>Quincena</th>',
      columns.fecha && '<th>Reconocimiento</th>',
      columns.estado && '<th>Aptitud</th>',
      columns.limitaciones && '<th>Limitaciones</th>',
    ].filter(Boolean).join('');
    const body = rows.map(p => {
      const info = getAptitudMedicaInfo(p);
      return `<tr><td><strong>${esc(p.apellidosNombre)}</strong></td>${columns.dni ? `<td>${esc(p.dni)}</td>` : ''}${columns.obra ? `<td>${esc(p.obra)}</td>` : ''}${columns.quincena ? `<td>${esc(p.quincena)}</td>` : ''}${columns.fecha ? `<td>${esc(p.reconocimientoFecha || '')}</td>` : ''}${columns.estado ? `<td>${esc(info.estado)}</td>` : ''}${columns.limitaciones ? `<td>${esc(info.limitaciones || (info.estado === 'Apto con limitaciones' ? 'Limitación pendiente de detalle' : '—'))}</td>` : ''}</tr>`;
    }).join('');
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#111827;font-size:10pt}h1{font-size:18pt;margin:0 0 4px}.meta{color:#475569;margin-bottom:14px}.warning{padding:8px 10px;border:1px solid #f59e0b;background:#fffbeb;margin-bottom:12px;font-size:9pt}table{width:100%;border-collapse:collapse}th,td{border:1px solid #94a3b8;padding:6px 7px;vertical-align:top;text-align:left}th{background:#e2e8f0;font-size:8pt;text-transform:uppercase}tr{break-inside:avoid}.footer{margin-top:12px;font-size:8pt;color:#64748b}</style></head><body><h1>${esc(title)}</h1><div class="meta">${esc(filterText)} · ${rows.length} trabajador(es)</div>${estado !== 'apto' ? '<div class="warning"><strong>Especial atención:</strong> revisar y respetar las limitaciones indicadas antes de asignar tareas.</div>' : ''}<table><thead><tr>${headers}</tr></thead><tbody>${body || '<tr><td colspan="7">No hay trabajadores para los filtros seleccionados.</td></tr>'}</tbody></table><div class="footer">Informe generado desde Gestión PROFEA · ${esc(new Date().toLocaleString('es-ES'))}</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  };

  return <div className="fixed inset-0 z-[120] bg-slate-950/60 p-3 sm:p-6 flex items-center justify-center" role="dialog" aria-modal="true">
    <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex items-center justify-between gap-3">
        <div><div className="flex items-center gap-2"><FileText className="w-5 h-5 text-amber-600"/><h2 className="font-black text-lg">Informe de trabajadores con especial atención</h2></div><p className="text-xs text-slate-500 mt-1">Filtra y configura qué información quieres imprimir.</p></div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Cerrar"><X className="w-5 h-5"/></button>
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs font-bold">Obra<select className="ui-input mt-1 w-full" value={obra} onChange={e=>setObra(e.target.value)}><option value="">Todas</option>{obras.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
          <label className="text-xs font-bold">Mes<select className="ui-input mt-1 w-full" value={mes} onChange={e=>setMes(e.target.value)}><option value="">Todos</option>{meses.map(v=><option key={v} value={v}>{monthLabel(v)}</option>)}</select></label>
          <label className="text-xs font-bold">Quincena<select className="ui-input mt-1 w-full" value={quincena} onChange={e=>setQuincena(e.target.value)}><option value="">Todas</option>{quincenas.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
          <label className="text-xs font-bold">Aptitud<select className="ui-input mt-1 w-full" value={estado} onChange={e=>setEstado(e.target.value as StatusFilter)}><option value="limitados">Aptos con limitaciones</option><option value="apto">Solo aptos</option><option value="aptos">Aptos + con limitaciones</option></select></label>
        </div>

        <div><div className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">Columnas de impresión</div><div className="flex flex-wrap gap-2">{([['dni','DNI/NIE'],['obra','Obra'],['quincena','Quincena'],['fecha','Fecha'],['estado','Aptitud'],['limitaciones','Limitaciones']] as [keyof Columns,string][]).map(([key,label])=><label key={key} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={columns[key]} onChange={()=>toggle(key)}/>{label}</label>)}</div></div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950/40 text-sm font-bold">Vista previa · {rows.length} trabajador(es)</div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[340px] overflow-y-auto">{rows.length ? rows.map(p=>{const info=getAptitudMedicaInfo(p);return <div key={p.id} className="p-3 text-sm"><div className="font-bold">{p.apellidosNombre} <span className="font-normal text-slate-500">· {p.dni || 'Sin DNI'}</span></div><div className="text-xs text-slate-500 mt-1">{p.obra || 'Sin obra'}{p.quincena?` · ${p.quincena}`:''} · {info.estado}</div>{info.estado==='Apto con limitaciones'&&<div className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">Limitaciones: {info.limitaciones || 'Pendiente de detalle'}</div>}</div>}) : <div className="p-6 text-center text-sm text-slate-500">No hay trabajadores que coincidan con los filtros.</div>}</div>
        </div>

        <div className="flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border font-bold text-sm">Cerrar</button><button onClick={printReport} className="px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm inline-flex items-center gap-2"><Printer className="w-4 h-4"/>Imprimir / Guardar PDF</button></div>
      </div>
    </div>
  </div>;
};
