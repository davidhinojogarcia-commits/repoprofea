import React from 'react';
import { Person, getAptitudMedicaInfo } from '../types';
import { ShareRecordButton } from './ShareRecordButton';
import { 
  Pencil, 
  Trash2, 
  IdCard, 
  History, 
  Calendar, 
  ShieldAlert, 
  AlertTriangle, 
  Activity, 
  CheckCircle,
  FileWarning,
  Clock
} from 'lucide-react';

interface PersonTableProps {
  people: Person[];
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onSelectAllVisible: () => void;
  isAllVisibleSelected: boolean;
  isSomeVisibleSelected: boolean;
  onDelete: (id: number) => void;
  onEdit: (person: Person) => void;
  onGenerateIDCard: (person: Person) => void;
  onExportHistoryPDF: (person: Person) => void;
  onOpenCalendar: (person: Person) => void;
  sameDniWorkersMap: Map<string, Person[]>;
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

export const PersonTable: React.FC<PersonTableProps> = ({
  people,
  selectedIds,
  onToggleSelect,
  onSelectAllVisible,
  isAllVisibleSelected,
  isSomeVisibleSelected,
  onDelete,
  onEdit,
  onGenerateIDCard,
  onExportHistoryPDF,
  onOpenCalendar,
  sameDniWorkersMap
}) => {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <div className="overflow-x-auto">
        <table id="person-table-list" className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[11px]">
              <th className="p-3.5 w-10 text-center">
                <input
                  type="checkbox"
                  id="selectAllTableCheckbox"
                  checked={isAllVisibleSelected}
                  ref={el => {
                    if (el) el.indeterminate = isSomeVisibleSelected;
                  }}
                  onChange={onSelectAllVisible}
                  className="w-4 h-4 rounded border-slate-300 text-[#00548E] focus:ring-[#00548E]/20 cursor-pointer accent-[#00548E]"
                  title="Seleccionar o desmarcar todos"
                />
              </th>
              <th className="p-3.5 whitespace-nowrap min-w-[200px]">Trabajador / DNI</th>
              <th className="p-3.5 whitespace-nowrap min-w-[130px]">Oferta / Cat.</th>
              <th className="p-3.5 whitespace-nowrap min-w-[170px]">Obra / Quincena</th>
              <th className="p-3.5 whitespace-nowrap min-w-[140px] text-center">Período Contrato</th>
              <th className="p-3.5 whitespace-nowrap min-w-[150px]">Cita Médica</th>
              <th className="p-3.5 whitespace-nowrap min-w-[240px] bg-slate-100/70 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border-x border-slate-200 dark:border-slate-800">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span>Aptitud Médica</span>
                    <span className="text-[10px] font-normal tracking-tight text-slate-500 dark:text-slate-400">Lectura rápida</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-semibold tracking-tight normal-case text-slate-600 dark:text-slate-400 pt-0.5 border-t border-slate-200/80 dark:border-slate-700/60">
                    <span className="inline-flex items-center gap-1" title="Verde: Apto"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Apto</span>
                    <span className="inline-flex items-center gap-1" title="Naranja: Apto con limitaciones"><span className="w-2 h-2 rounded-full bg-orange-500" /> Limitaciones</span>
                    <span className="inline-flex items-center gap-1" title="Rojo: No Apto"><span className="w-2 h-2 rounded-full bg-red-600" /> No Apto</span>
                    <span className="inline-flex items-center gap-1" title="Gris: Pendiente"><span className="w-2 h-2 rounded-full bg-slate-400" /> Pendiente</span>
                  </div>
                </div>
              </th>
              <th className="p-3.5 whitespace-nowrap min-w-[110px] text-center">Expediente</th>
              <th className="p-3.5 whitespace-nowrap min-w-[160px] text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {people.map((person, idx) => {
              const isSelected = selectedIds.includes(person.id);
              const cleanDni = person.dni?.trim().toUpperCase().replace(/[\s-]/g, '') || '';
              const sameDniWorkers = cleanDni ? (sameDniWorkersMap.get(cleanDni) || []) : [];
              const isRepeater = sameDniWorkers.length > 1;
              const { estado, limitaciones, validez } = getAptitudMedicaInfo(person);
              const isNoApto = estado === 'No Apto';
              const isAptoConLimitaciones = estado === 'Apto con limitaciones';
              const isApto = estado === 'Apto';
              const isPendiente = estado === 'Pendiente';
              const isDocMissing = person.documentacionCompleta === 'No';
              const isHighRisk = isNoApto && isDocMissing;

              return (
                <tr key={`person_row_${person.id}_${idx}`} id={`person-table-row-${person.id}`} onClick={() => onToggleSelect(person.id)} className={`transition-colors cursor-pointer ${isHighRisk ? isSelected ? 'bg-red-100/70 dark:bg-red-950/70 hover:bg-red-100 dark:hover:bg-red-900/60' : 'bg-red-50/50 dark:bg-red-950/30 hover:bg-red-100/50 dark:hover:bg-red-900/40' : isSelected ? 'bg-blue-50/80 dark:bg-blue-950/50 hover:bg-blue-100/60 dark:hover:bg-blue-900/50' : idx % 2 === 0 ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70' : 'bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/70'}`}>
                  <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(person.id)} className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-[#00548E] focus:ring-[#00548E]/20 dark:focus:ring-blue-500/30 cursor-pointer accent-[#00548E]" />
                  </td>

                  <td className="p-3.5">
                    <div className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-tight">{person.apellidosNombre}</div>
                    <div className="flex items-center gap-2 mt-1 text-slate-500 dark:text-slate-400 text-[11px]">
                      <span className="font-mono font-medium">{person.dni}</span>
                      {person.telefono && <a href={`tel:${person.telefono}`} onClick={(e) => e.stopPropagation()} className="hover:underline text-[#00548E] dark:text-blue-400">{person.telefono}</a>}
                      {isRepeater && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 text-[9px] font-bold">Repetidor ({sameDniWorkers.length})</span>}
                      {person.ownerDisplayName && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 text-[9px] font-bold border border-purple-200 dark:border-purple-800/80" title={`Propietario del registro: ${person.ownerDisplayName}`}>👤 {person.ownerDisplayName}</span>}
                    </div>
                  </td>

                  <td className="p-3.5"><div className="font-semibold text-slate-700 dark:text-slate-200">{person.numOferta || '-'}</div><div className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">{person.categoria || 'Peón'}</div></td>
                  <td className="p-3.5"><div className="font-medium text-slate-800 dark:text-slate-100 leading-tight">{person.obra}</div><div className="text-[11px] text-[#00548E] dark:text-blue-400 font-semibold mt-0.5">{person.quincena}</div></td>
                  <td className="p-3.5 text-center whitespace-nowrap"><div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{formatDate(person.periodoInicio)} al {formatDate(person.periodoFin)}</div></td>
                  <td className="p-3.5">{person.necesitaReconocimiento === 'No' || !person.citaDia ? <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">No requiere</span> : <div><div className="font-medium text-slate-700 dark:text-slate-200 text-[11px]">{formatDate(person.citaDia)} {person.citaHora ? `@ ${person.citaHora}` : ''}</div><div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[160px]" title={person.sitioReconocimiento}>{person.sitioReconocimiento || '-'}</div></div>}</td>

                  <td className={`p-3.5 border-x border-slate-200/80 dark:border-slate-800 border-l-4 transition-colors ${isApto ? 'border-l-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10' : isAptoConLimitaciones ? 'border-l-orange-500 bg-orange-50/20 dark:bg-orange-950/10' : isNoApto ? 'border-l-red-600 bg-red-50/30 dark:bg-red-950/20' : 'border-l-slate-300 dark:border-l-slate-700 bg-slate-50/30 dark:bg-slate-900/40'}`}>
                    <div className="space-y-1.5">
                      {isApto && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/80 shadow-2xs"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-900 shrink-0" /><Activity className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" /><span>Apto ({validez})</span></span>}
                      {isAptoConLimitaciones && <div className="space-y-1"><span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-orange-50 text-orange-900 dark:bg-orange-950/60 dark:text-orange-300 border border-orange-300 dark:border-orange-800/80 shadow-2xs"><span className="w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-orange-200 dark:ring-orange-900 shrink-0" /><ShieldAlert className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 shrink-0" /><span>Apto con limitaciones ({validez})</span></span><div className="p-1.5 bg-orange-50/90 dark:bg-orange-950/40 rounded-lg border border-orange-200 dark:border-orange-800/60 text-[11px] text-orange-950 dark:text-orange-200"><span className="font-bold text-orange-900 dark:text-orange-300">Limitaciones: </span><span>{limitaciones || 'Sin especificar'}</span></div></div>}
                      {isNoApto && <div className="space-y-1"><span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black bg-red-50 text-red-800 dark:bg-red-950/70 dark:text-red-200 border border-red-300 dark:border-red-800/80 shadow-2xs"><span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-red-200 dark:ring-red-900 shrink-0 animate-pulse" /><AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" /><span>No Apto</span></span>{limitaciones && <p className="text-[10.5px] font-semibold text-red-700 dark:text-red-300 italic pl-1.5 border-l-2 border-red-400">{limitaciones}</p>}</div>}
                      {isPendiente && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300 border border-slate-300 dark:border-slate-700 shadow-2xs"><span className="w-2.5 h-2.5 rounded-full bg-slate-400 ring-2 ring-slate-200 dark:ring-slate-700 shrink-0" /><Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" /><span>Pendiente</span></span>}
                    </div>
                  </td>

                  <td className="p-3.5 text-center">{person.documentacionCompleta === 'Sí' ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50"><CheckCircle className="w-3 h-3" /> OK</span> : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50"><FileWarning className="w-3 h-3" /> Pendiente</span>}</td>

                  <td className="p-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <ShareRecordButton resourceType="trabajadores" resourceId={person.id} ownerId={person.ownerId} compact />
                      <button type="button" onClick={() => onGenerateIDCard(person)} className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-[#00548E] dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Ficha completa del trabajador (Carné)"><IdCard className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onExportHistoryPDF(person)} className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-[#00548E] dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Informe histórico de contrataciones"><History className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onOpenCalendar(person)} className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-[#00548E] dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Google Calendar"><Calendar className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onEdit(person)} className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Editar trabajador"><Pencil className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onDelete(person.id)} className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors" title="Eliminar trabajador"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};