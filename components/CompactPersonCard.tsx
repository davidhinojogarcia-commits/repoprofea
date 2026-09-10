import React, { useState } from 'react';
import { Person, getAptitudMedicaInfo } from '../types';
import { 
  Pencil, 
  Trash2, 
  IdCard, 
  History, 
  Calendar, 
  Phone, 
  MapPin, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  ShieldAlert, 
  HelpCircle,
  Briefcase,
  ChevronDown,
  ChevronUp,
  FileText
} from 'lucide-react';

interface CompactPersonCardProps {
  person: Person;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (person: Person) => void;
  onGenerateIDCard: (person: Person) => void;
  onExportHistoryPDF: (person: Person) => void;
  onOpenCalendar: (person: Person) => void;
  isSyncActive?: boolean;
  onToggleSync?: (id: number) => void;
  sameDniWorkers?: Person[];
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

export const CompactPersonCard: React.FC<CompactPersonCardProps> = React.memo(({
  person,
  isSelected,
  onToggleSelect,
  onDelete,
  onEdit,
  onGenerateIDCard,
  onExportHistoryPDF,
  onOpenCalendar,
  sameDniWorkers = []
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const aptInfo = getAptitudMedicaInfo(person);
  const isDocMissing = person.documentacionCompleta === 'No';
  const isNoApto = aptInfo.estado === 'No Apto';
  const isAptoConLimitaciones = aptInfo.estado === 'Apto con limitaciones';
  const isNoAptoDocIncomplete = isNoApto && isDocMissing;
  const isRepeater = sameDniWorkers.length > 1;

  // Contract dates calculation
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = person.periodoInicio ? new Date(person.periodoInicio) : null;
  const end = person.periodoFin ? new Date(person.periodoFin) : null;

  let contractStatus = '';
  let contractBadgeClass = '';
  let contractDotClass = '';

  if (start && end) {
    if (today >= start && today <= end) {
      contractStatus = 'Activo';
      contractBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50';
      contractDotClass = 'bg-emerald-500 animate-pulse';
    } else if (today > end) {
      contractStatus = 'Finalizado';
      contractBadgeClass = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
      contractDotClass = 'bg-slate-400';
    } else if (today < start) {
      contractStatus = 'Próximo';
      contractBadgeClass = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50';
      contractDotClass = 'bg-blue-500';
    }
  }

  const handleSafeGenerateIDCard = () => {
    if (isNoAptoDocIncomplete) {
      if (!window.confirm(`⚠️ RIESGO DETECTADO:\nEl trabajador ${person.apellidosNombre} tiene Reconocimiento Médico "NO APTO" y Documentación en "NO".\n\n¿Está seguro de que desea generar su carné de todos modos?`)) {
        return;
      }
    }
    onGenerateIDCard(person);
  };

  const handleSafeOpenCalendar = () => {
    if (isNoAptoDocIncomplete) {
      if (!window.confirm(`⚠️ RIESGO DETECTADO:\nEl trabajador ${person.apellidosNombre} tiene Reconocimiento Médico "NO APTO" y Documentación en "NO".\n\n¿Está seguro de que desea programar citas en Google Calendar para este trabajador?`)) {
        return;
      }
    }
    onOpenCalendar(person);
  };

  const hasLimitations = Boolean(aptInfo.limitaciones || person.reconocimientoLimitaciones);
  const limitationsText = aptInfo.limitaciones || person.reconocimientoLimitaciones || '';

  return (
    <div
      id={`compact-card-${person.id}`}
      className={`relative flex flex-col rounded-2xl p-4 transition-all duration-200 border overflow-hidden ${
        isNoAptoDocIncomplete
          ? isSelected
            ? 'border-2 border-red-600 ring-2 ring-red-600/30 bg-red-50/80 dark:bg-red-950/50 shadow-md'
            : 'border-2 border-red-500 dark:border-red-600 bg-red-50/50 dark:bg-red-950/30 shadow-xs'
          : isNoApto
          ? isSelected
            ? 'border-red-600 ring-2 ring-red-600/30 bg-red-50/40 dark:bg-red-950/30 shadow-xs'
            : 'border-red-400 dark:border-red-700/80 bg-red-50/25 dark:bg-red-950/20 shadow-2xs'
          : isSelected
          ? 'border-[#00548E] ring-2 ring-[#00548E]/15 bg-blue-50/20 dark:bg-blue-950/30 shadow-xs'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700'
      }`}
    >
      {/* Left colored indicator strip */}
      <div 
        className={`absolute top-0 left-0 bottom-0 ${
          isNoAptoDocIncomplete
            ? 'w-2 bg-red-600 animate-pulse'
            : isNoApto
            ? 'w-2 bg-red-600'
            : isAptoConLimitaciones
            ? 'w-1.5 bg-amber-500'
            : isDocMissing
            ? 'w-1.5 bg-red-400'
            : 'w-1.5 bg-[#00548E]'
        }`} 
      />

      {/* Header Row: Checkbox, Name, DNI and Main Badges */}
      <div className="flex items-start gap-3 pl-1">
        {/* Touch-friendly Checkbox (min 44px hit area) */}
        <label 
          htmlFor={`select-compact-${person.id}`}
          className="flex items-center justify-center -m-2 p-2 cursor-pointer shrink-0 touch-manipulation"
        >
          <input
            type="checkbox"
            id={`select-compact-${person.id}`}
            checked={isSelected}
            onChange={() => onToggleSelect(person.id)}
            className="w-5 h-5 rounded-md border-slate-300 dark:border-slate-700 text-[#00548E] focus:ring-[#00548E]/20 cursor-pointer accent-[#00548E]"
            aria-label={`Seleccionar trabajador ${person.apellidosNombre}`}
          />
        </label>

        {/* Worker Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <h4 
              className="text-sm sm:text-base font-extrabold text-slate-800 dark:text-slate-100 truncate leading-snug"
              title={person.apellidosNombre}
            >
              {person.apellidosNombre}
            </h4>

            {/* Contract Status Pill */}
            {contractStatus && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${contractBadgeClass}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${contractDotClass}`} />
                {contractStatus}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
              {person.dni || 'Sin DNI'}
            </span>

            {isRepeater && (
              <span 
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold border border-purple-200 dark:border-purple-800"
                title={`Trabajador contratado en ${sameDniWorkers.length} periodos`}
              >
                <History className="w-2.5 h-2.5 text-purple-600" />
                Repetidor ({sameDniWorkers.length})
              </span>
            )}

            {person.ownerDisplayName && (
              <span 
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 text-[10px] font-bold border border-purple-200 dark:border-purple-800/80"
                title={`Propietario del registro: ${person.ownerDisplayName}`}
              >
                👤 {person.ownerDisplayName}
              </span>
            )}

            {/* Aptitud Médica Badge */}
            {aptInfo.estado === 'Apto' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                Apto
              </span>
            ) : aptInfo.estado === 'Apto con limitaciones' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                <ShieldAlert className="w-3 h-3 text-amber-600 shrink-0" />
                C/ Limitación
              </span>
            ) : aptInfo.estado === 'No Apto' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md bg-red-600 text-white shadow-xs border border-red-700 animate-pulse">
                <AlertTriangle className="w-3 h-3 text-white shrink-0" />
                No Apto
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                Pendiente
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Critical PRL Limitation Banner (if medical limitations or No Apto) */}
      {(isNoApto || isAptoConLimitaciones || hasLimitations) && (
        <div className={`mt-2.5 p-2 rounded-xl text-xs flex items-start gap-2 border ${
          isNoApto 
            ? 'bg-red-100/80 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200' 
            : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/80 text-amber-900 dark:text-amber-200'
        }`}>
          {isNoApto ? (
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold leading-tight text-[11px] uppercase tracking-wide">
              {isNoApto ? 'No Apto para Puesto' : 'Limitaciones Laborales:'}
            </p>
            <p className="text-[11px] leading-snug mt-0.5 line-clamp-2">
              {limitationsText || (isNoApto ? 'Reconocimiento médico no superado. Restricción de contratación.' : 'Sin detalle')}
            </p>
          </div>
        </div>
      )}

      {/* Compact Info Grid (2 Columns, optimized for dense mobile layout) */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
        {/* Obra */}
        <div className="flex items-center gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate font-semibold text-slate-700 dark:text-slate-200" title={person.obra}>
            {person.obra || 'Sin obra'}
          </span>
        </div>

        {/* Quincena / Periodo */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate font-medium text-slate-600 dark:text-slate-300">
            {person.quincena || 'Q. sin asignar'}
          </span>
        </div>

        {/* Categoría */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate text-slate-700 dark:text-slate-200">
            {person.categoria || 'Peón'}
          </span>
        </div>

        {/* Teléfono (Click to call) */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Phone className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          {person.telefono ? (
            <a 
              href={`tel:${person.telefono.replace(/\s+/g, '')}`}
              className="font-bold text-[#00548E] dark:text-blue-400 hover:underline truncate"
              title="Llamar al trabajador"
            >
              {person.telefono}
            </a>
          ) : (
            <span className="text-slate-400 italic">Sin teléfono</span>
          )}
        </div>
      </div>

      {/* Expandable Extra Details (Fechas de contrato, Cita Médica, Calzado, Documentación) */}
      {isExpanded && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 animate-in fade-in duration-150">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-slate-400 block font-medium">Contrato:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {person.periodoInicio && person.periodoFin 
                  ? `${formatDate(person.periodoInicio)} al ${formatDate(person.periodoFin)}`
                  : 'Sin fechas'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Calzado / Oferta:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Talla {person.calzado || '-'} · Of: {person.numOferta || '-'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
            <div>
              <span className="text-slate-400 block font-medium">Cita Reconocimiento:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {person.citaDia ? `${formatDate(person.citaDia)} ${person.citaHora ? `(${person.citaHora})` : ''}` : 'Sin cita'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Documentación:</span>
              <span className={`font-bold ${isDocMissing ? 'text-red-500' : 'text-emerald-600'}`}>
                {person.documentacionCompleta === 'Sí' ? '✓ Completa' : '✗ Pendiente'}
              </span>
            </div>
          </div>

          {person.observaciones && (
            <div className="pt-1 text-[11px]">
              <span className="text-slate-400 block font-medium">Observaciones:</span>
              <p className="italic text-slate-600 dark:text-slate-300 leading-snug">
                {person.observaciones}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer Toolbar: Expand Button & Action Buttons */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800">
        {/* Toggle Details */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors p-1.5 -ml-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer touch-manipulation"
          title={isExpanded ? 'Mostrar menos datos' : 'Ver más detalles del trabajador'}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Menos</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Más datos</span>
            </>
          )}
        </button>

        {/* Action Icon Buttons with touch-friendly min targets */}
        <div className="flex items-center gap-1">
          {/* Edit */}
          <button
            type="button"
            onClick={() => onEdit(person)}
            className="p-2 rounded-xl text-[#00548E] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all cursor-pointer touch-manipulation active:scale-95"
            title={`Editar datos de ${person.apellidosNombre}`}
            aria-label={`Editar ${person.apellidosNombre}`}
          >
            <Pencil className="w-4 h-4" />
          </button>

          {/* Google Calendar */}
          <button
            type="button"
            onClick={handleSafeOpenCalendar}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-[#00548E] hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer touch-manipulation active:scale-95"
            title="Añadir citas y periodo a Google Calendar"
            aria-label={`Añadir citas de ${person.apellidosNombre} a Google Calendar`}
          >
            <Calendar className="w-4 h-4" />
          </button>

          {/* ID Card */}
          <button
            type="button"
            onClick={handleSafeGenerateIDCard}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all cursor-pointer touch-manipulation active:scale-95"
            title="Generar e imprimir carné identificativo de obra"
            aria-label={`Generar carné de ${person.apellidosNombre}`}
          >
            <IdCard className="w-4 h-4" />
          </button>

          {/* History */}
          <button
            type="button"
            onClick={() => onExportHistoryPDF(person)}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-all cursor-pointer touch-manipulation active:scale-95"
            title="Descargar historial de contratación PROFEA en PDF"
            aria-label={`Descargar historial de ${person.apellidosNombre}`}
          >
            <History className="w-4 h-4" />
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={() => onDelete(person.id)}
            className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all cursor-pointer touch-manipulation active:scale-95"
            title={`Eliminar registro de ${person.apellidosNombre}`}
            aria-label={`Eliminar registro de ${person.apellidosNombre}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

CompactPersonCard.displayName = 'CompactPersonCard';
