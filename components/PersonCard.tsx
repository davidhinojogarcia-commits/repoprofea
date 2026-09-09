import React, { useState } from 'react';
import { Person, getAptitudMedicaInfo } from '../types';
import { 
  Trash2, 
  Calendar, 
  AlertTriangle, 
  CheckCircle, 
  FileWarning, 
  Pencil, 
  IdCard, 
  History, 
  Cloud, 
  CloudOff,
  Activity,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Eye,
  X
} from 'lucide-react';

interface PersonCardProps {
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
  sameDniWorkers: Person[];
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

export const PersonCard: React.FC<PersonCardProps> = React.memo(({
  person,
  isSelected,
  onToggleSelect,
  onDelete,
  onEdit,
  onGenerateIDCard,
  onExportHistoryPDF,
  onOpenCalendar,
  isSyncActive = false,
  onToggleSync,
  sameDniWorkers
}) => {
  const aptInfo = getAptitudMedicaInfo(person);
  const isDocMissing = person.documentacionCompleta === 'No';
  const isNoApto = aptInfo.estado === 'No Apto';
  const isAptoConLimitaciones = aptInfo.estado === 'Apto con limitaciones';
  const isNoAptoDocIncomplete = isNoApto && isDocMissing;
  const isRepeaterWorker = sameDniWorkers.length > 1;

  const [showLimitationsPanel, setShowLimitationsPanel] = useState(false);

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = person.periodoInicio ? new Date(person.periodoInicio) : null;
  const end = person.periodoFin ? new Date(person.periodoFin) : null;

  let contractStatus = '';
  let contractClasses = '';
  let contractDot = '';

  if (start && end) {
    if (today >= start && today <= end) {
      contractStatus = 'Activo';
      contractClasses = 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50';
      contractDot = 'bg-emerald-500 animate-pulse';
    } else if (today > end) {
      contractStatus = 'Finalizado';
      contractClasses = 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
      contractDot = 'bg-slate-400';
    } else if (today < start) {
      contractStatus = 'Próximo';
      contractClasses = 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50';
      contractDot = 'bg-blue-500';
    }
  }

  const tooltipText = `👤 TRABAJADOR
Nombre: ${person.apellidosNombre}
DNI/NIE: ${person.dni}
Nacimiento: ${formatDate(person.fechaNacimiento)}
Teléfono: ${person.telefono}
Talla Calzado: ${person.calzado}

🏗️ CONTRATACIÓN
Obra: ${person.obra}
Categoría: ${person.categoria || 'Peón'}
Quincena: ${person.quincena}
Nº Oferta: ${person.numOferta}
Periodo: ${formatDate(person.periodoInicio)} al ${formatDate(person.periodoFin)}
Supervisor: ${person.supervisorResponsable}

🏥 SEGURIDAD Y SALUD
Formación: ${person.formacion}${person.lugarFormacion ? ` (${person.lugarFormacion})` : ''}
Cita Reconocimiento Médico: ${formatDate(person.citaDia)} a las ${person.citaHora}
Lugar Cita: ${person.sitioReconocimiento}

📄 DOCUMENTACIÓN
Estado: ${person.documentacionCompleta === 'Sí' ? 'Completa' : 'Pendiente'}${person.observaciones ? `\n\n📝 OBSERVACIONES\n${person.observaciones}` : ''}`;

  return (
    <div
      id={`worker-card-${person.id}`}
      className={`group rounded-2xl p-5 border transition-all duration-200 relative overflow-hidden ${
        isNoAptoDocIncomplete
          ? isSelected
            ? 'border-2 border-red-600 ring-4 ring-red-600/30 bg-red-50/80 dark:bg-red-950/50 shadow-lg shadow-red-500/20'
            : 'border-2 border-red-500 dark:border-red-600 bg-red-50/60 dark:bg-red-950/35 ring-2 ring-red-500/25 shadow-md shadow-red-500/10'
          : isNoApto
          ? isSelected
            ? 'border-red-600 ring-2 ring-red-600/50 bg-red-50/50 dark:bg-red-950/30 shadow-red-500/10'
            : 'border-red-500/80 dark:border-red-700/80 bg-red-50/30 dark:bg-red-950/20 ring-1 ring-red-500/20 shadow-red-500/5'
          : isSelected
          ? 'border-[#00548E] ring-2 ring-[#00548E]/15 bg-blue-50/15 dark:bg-blue-950/20 shadow-xs'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-md'
      }`}
      title={tooltipText}
    >
      {/* Status Indicator Bar */}
      <div className={`absolute top-0 left-0 ${
        isNoAptoDocIncomplete ? 'w-3 bg-red-600 animate-pulse' : isNoApto ? 'w-2.5 bg-red-600 animate-pulse' : isDocMissing ? 'w-2 bg-red-500' : 'w-2 bg-[#00548E]'
      } h-full`} />

      <div className="flex flex-row items-start gap-4">
        {/* Selector Checkbox */}
        <div className="flex flex-col items-center pt-1.5 shrink-0 z-10">
          <input
            type="checkbox"
            id={`select-worker-${person.id}`}
            checked={isSelected}
            onChange={() => onToggleSelect(person.id)}
            className="w-5 h-5 rounded-lg border-slate-300 dark:border-slate-700 text-[#00548E] focus:ring-[#00548E]/20 cursor-pointer transition-all hover:scale-110 accent-[#00548E]"
            title="Seleccionar trabajador"
            aria-label={`Seleccionar trabajador ${person.apellidosNombre}`}
          />
          {isNoAptoDocIncomplete && (
            <div className="mt-2.5" title="⚠️ RIESGO: Reconocimiento No Apto con Documentación en 'No'">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 fill-red-100 animate-bounce" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div className="flex-1 w-full min-w-0">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 group-hover:text-[#00548E] dark:group-hover:text-blue-400 transition-colors break-words">
                  {person.apellidosNombre}
                </h3>
                {isNoApto && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-red-600 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-red-500/20 border border-red-700 select-none animate-pulse"
                      title={isNoAptoDocIncomplete ? "RIESGO DE CONTRATACIÓN: Documentación marcada en 'No' por Reconocimiento Médico No Apto" : "Calificación médica: NO APTO"}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-white fill-amber-300 shrink-0" />
                      <span>{isNoAptoDocIncomplete ? "RIESGO: NO APTO (DOC: NO)" : "MÉDICO: NO APTO"}</span>
                    </div>

                    {/* Botón interactivo con Tooltip flotante y panel desplegable para No Apto */}
                    <div className="relative inline-flex items-center group/limHeader">
                      <button
                        type="button"
                        id={`btn-toggle-limitaciones-header-${person.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowLimitationsPanel(prev => !prev);
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-xs active:scale-95 ${
                          showLimitationsPanel
                            ? 'bg-amber-600 text-white border-amber-700 shadow-amber-500/25 ring-2 ring-amber-400/40'
                            : 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300 dark:bg-red-950/60 dark:hover:bg-red-900/70 dark:text-red-300 dark:border-red-800/80'
                        }`}
                        aria-expanded={showLimitationsPanel}
                      >
                        <Eye className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                        <span>{showLimitationsPanel ? 'Ocultar Limitaciones' : 'Ver Limitaciones'}</span>
                        {showLimitationsPanel ? (
                          <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-red-600 dark:text-red-300 shrink-0" />
                        )}
                      </button>

                      {/* Tooltip flotante emergente en hover / focus */}
                      <div className="absolute left-0 top-full mt-2 hidden group-hover/limHeader:flex flex-col z-30 w-72 sm:w-80 p-3.5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 text-xs pointer-events-none transition-all duration-200 animate-in fade-in-0 zoom-in-95">
                        <div className="flex items-center gap-1.5 font-bold text-amber-400 border-b border-slate-800 pb-1.5 mb-1.5">
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="uppercase tracking-wider text-[10.5px]">Limitaciones Físicas Detectadas</span>
                        </div>
                        <div className="space-y-1.5 text-slate-200 text-xs">
                          <p className="font-semibold text-white leading-snug">
                            {person.reconocimientoLimitaciones?.trim() || 'No se han especificado limitaciones detalladas en la base de datos (Calificación: No Apto).'}
                          </p>
                          {person.reconocimientoObservaciones && (
                            <p className="text-slate-400 italic text-[11px] pt-1.5 border-t border-slate-800/80">
                              Obs: {person.reconocimientoObservaciones}
                            </p>
                          )}
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-slate-800 text-[9.5px] text-amber-300/80 flex items-center justify-between">
                          <span>{person.sitioReconocimiento || 'Centro PRL'}</span>
                          <span className="italic font-medium">Clic para desplegar panel</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {isRepeaterWorker && (
                    <span
                      className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-900/50 text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center uppercase tracking-tight"
                      title={`Trabajador contratado en ${sameDniWorkers.length} periodos`}
                    >
                      <History className="w-3 h-3 mr-1 text-purple-500 animate-pulse" /> Repetidor ({sameDniWorkers.length})
                    </span>
                  )}
                  {contractStatus && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center uppercase tracking-tight ${contractClasses}`}>
                      <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${contractDot}`} />
                      {contractStatus}
                    </span>
                  )}
                  {isDocMissing && (
                    <span className="bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50 text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center uppercase tracking-tight">
                      <FileWarning className="w-3 h-3 mr-1" /> Pendiente Doc.
                    </span>
                  )}
                  {person.formacion === 'No' && (
                    <span className="bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-900/50 text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center uppercase tracking-tight">
                      <AlertTriangle className="w-3 h-3 mr-1" /> Sin Formación
                    </span>
                  )}
                  {isSyncActive && onToggleSync && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSync(person.id);
                      }}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center gap-1 cursor-pointer transition-all ${
                        person.sincronizadoEnNube
                          ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/50'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                      }`}
                      title={person.sincronizadoEnNube ? 'Compartido en la nube (Haz clic para hacer privado)' : 'Solo en local (Haz clic para compartir en la nube)'}
                    >
                      {person.sincronizadoEnNube ? (
                        <>
                          <Cloud className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 animate-pulse" />
                          <span>Sincronizado</span>
                        </>
                      ) : (
                        <>
                          <CloudOff className="w-3.5 h-3.5 text-slate-400" />
                          <span>Solo Local</span>
                        </>
                      )}
                    </button>
                  )}
                  {person.documentacionCompleta === 'Sí' && person.formacion === 'Sí' && (
                    <span className="bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center uppercase tracking-tight">
                      <CheckCircle className="w-3 h-3 mr-1 text-emerald-500" /> Todo en regla
                    </span>
                  )}
                  {aptInfo.estado === 'Apto' && (
                    <span 
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50 text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center uppercase tracking-tight"
                      title={`Apto médico registrado. Válido para ${aptInfo.validez}`}
                    >
                      <Activity className="w-3 h-3 mr-1 text-emerald-500" /> Apto Rec. Médico ({aptInfo.validez})
                    </span>
                  )}
                  {aptInfo.estado === 'Apto con limitaciones' && (
                    <span 
                      className="bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60 text-[10px] font-bold px-2 py-0.5 rounded-lg border flex items-center uppercase tracking-tight"
                      title={`Apto con limitaciones: ${aptInfo.limitaciones || 'Restricciones registradas'}`}
                    >
                      <ShieldAlert className="w-3 h-3 mr-1 text-amber-600 dark:text-amber-400" /> Apto c/ Limitaciones
                    </span>
                  )}
                  {aptInfo.estado === 'No Apto' && (
                    <div className="relative inline-flex items-center group/badgeLim">
                      <button 
                        type="button"
                        id={`btn-badge-no-apto-${person.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowLimitationsPanel(prev => !prev);
                        }}
                        className={`text-[10px] font-black px-2.5 py-0.5 rounded-lg border inline-flex items-center uppercase tracking-tight shadow-xs cursor-pointer transition-all active:scale-95 ${
                          showLimitationsPanel
                            ? 'bg-amber-600 text-white border-amber-700'
                            : 'bg-red-600 hover:bg-red-700 text-white border-red-700 dark:bg-red-700 dark:border-red-800 animate-pulse'
                        }`}
                        title="Haz clic para ver / ocultar las limitaciones físicas detectadas"
                        aria-expanded={showLimitationsPanel}
                      >
                        <AlertTriangle className="w-3 h-3 mr-1" /> No Apto Rec. Médico (Doc: No)
                        {showLimitationsPanel ? (
                          <ChevronUp className="w-3 h-3 ml-1 text-white shrink-0" />
                        ) : (
                          <ChevronDown className="w-3 h-3 ml-1 text-red-200 shrink-0" />
                        )}
                      </button>

                      {/* Tooltip flotante al pasar el ratón por el badge */}
                      <div className="absolute left-0 top-full mt-1.5 hidden group-hover/badgeLim:flex flex-col z-30 w-72 sm:w-80 p-3 bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700 text-xs pointer-events-none transition-all duration-200 animate-in fade-in-0 zoom-in-95">
                        <div className="flex items-center gap-1.5 font-bold text-amber-400 border-b border-slate-800 pb-1 mb-1.5 text-[10px] uppercase">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>Limitaciones Físicas Detectadas</span>
                        </div>
                        <p className="text-white text-[11px] font-semibold leading-relaxed">
                          {aptInfo.limitaciones?.trim() || 'No Apto médico. Sin especificación detallada de restricciones físicas.'}
                        </p>
                        {person.reconocimientoObservaciones && (
                          <p className="text-slate-400 italic text-[10px] mt-1 pt-1 border-t border-slate-800">
                            Obs: {person.reconocimientoObservaciones}
                          </p>
                        )}
                        <span className="text-[9px] text-amber-300/70 mt-1.5 pt-1 border-t border-slate-800/80 italic">
                          Clic para fijar panel desplegable
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {isNoAptoDocIncomplete ? (
                <div className="mb-3.5 p-3.5 bg-red-100 dark:bg-red-950/80 border-2 border-red-500 dark:border-red-700 rounded-xl flex flex-col gap-2.5 text-red-950 dark:text-red-100 shadow-sm">
                  <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
                    <div className="flex items-start sm:items-center gap-3">
                      <ShieldAlert className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 animate-bounce mt-0.5 sm:mt-0" />
                      <div className="flex-1 text-xs leading-snug">
                        <div className="font-black text-red-700 dark:text-red-300 uppercase tracking-wide flex items-center gap-1.5">
                          <span>⛔ ADVERTENCIA DE RIESGO: RECONOCIMIENTO NO APTO (DOCUMENTACIÓN EN 'NO')</span>
                        </div>
                        <p className="mt-0.5 font-semibold text-red-900 dark:text-red-200 text-[11.5px]">
                          Este trabajador tiene el campo <strong>Documentación Completa</strong> marcado en <strong>'No'</strong> debido a una calificación médica <strong>'No Apto'</strong>. Verifique y evalúe el riesgo antes de cualquier gestión o contratación.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowLimitationsPanel(prev => !prev);
                      }}
                      className="shrink-0 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 active:scale-95 ml-auto sm:ml-0"
                      title="Ver limitaciones físicas detectadas para este trabajador"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{showLimitationsPanel ? 'Ocultar Limitaciones' : 'Ver Limitaciones Físicas'}</span>
                      {showLimitationsPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              ) : isNoApto ? (
                <div className="mb-3.5 p-3 bg-red-100/95 dark:bg-red-950/70 border-2 border-red-300 dark:border-red-800 rounded-xl flex items-center justify-between gap-2.5 text-red-900 dark:text-red-200 shadow-xs flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
                    <div className="text-xs font-bold leading-tight">
                      <span className="text-red-700 dark:text-red-300 uppercase tracking-wide mr-1.5 font-extrabold">
                        ⛔ RECONOCIMIENTO MÉDICO: NO APTO
                      </span>
                      <span className="font-semibold text-[11px] text-red-800 dark:text-red-300 block sm:inline">
                        (Documentación marcada automáticamente en 'No' para evitar contrataciones erróneas)
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowLimitationsPanel(prev => !prev);
                    }}
                    className="shrink-0 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 active:scale-95 ml-auto sm:ml-0"
                    title="Ver limitaciones físicas detectadas para este trabajador"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{showLimitationsPanel ? 'Ocultar Limitaciones' : 'Ver Limitaciones Físicas'}</span>
                    {showLimitationsPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              ) : null}

              {/* Panel Desplegable de Limitaciones Físicas Detectadas para No Apto */}
              {isNoApto && showLimitationsPanel && (
                <div 
                  id={`panel-limitaciones-${person.id}`}
                  className="mb-4 p-4 bg-gradient-to-br from-amber-50/95 via-red-50/80 to-amber-50/95 dark:from-slate-900 dark:via-red-950/50 dark:to-slate-900 border-2 border-amber-400 dark:border-amber-600 rounded-2xl shadow-md text-xs animate-in fade-in-50 zoom-in-98 duration-200"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-amber-200/80 dark:border-amber-800/60 pb-2.5 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-amber-100 dark:bg-amber-950/80 rounded-xl text-amber-800 dark:text-amber-300 shrink-0 border border-amber-300 dark:border-amber-700/80 shadow-2xs">
                        <ShieldAlert className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-amber-950 dark:text-amber-100 text-sm flex items-center gap-2">
                          <span>Limitaciones Físicas y Restricciones Médicas Detectadas</span>
                          <span className="px-2 py-0.5 bg-red-600 text-white rounded-md text-[10px] font-black uppercase tracking-wider shadow-2xs">
                            No Apto
                          </span>
                        </h4>
                        <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 font-medium mt-0.5">
                          Información de salud laboral disponible directamente en la lista sin tener que abrir la ficha completa.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowLimitationsPanel(false);
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-amber-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Ocultar panel de limitaciones"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="p-3 bg-white/95 dark:bg-slate-950/80 rounded-xl border border-amber-300 dark:border-amber-800/80 shadow-xs">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10.5px] uppercase tracking-wider font-extrabold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span>Limitaciones Físicas / Restricciones en Obra:</span>
                        </span>
                        <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60 px-2 py-0.5 rounded border border-red-200 dark:border-red-900/50">
                          Causa de No Aptitud
                        </span>
                      </div>
                      <p className="font-bold text-sm text-red-950 dark:text-red-100 leading-relaxed pl-1">
                        {person.reconocimientoLimitaciones?.trim() || (
                          <span className="text-slate-500 dark:text-slate-400 font-normal italic">
                            No se han especificado limitaciones físicas detalladas en el campo de observaciones médicas de la ficha. El trabajador figura formalmente calificado como "No Apto".
                          </span>
                        )}
                      </p>
                    </div>

                    {person.reconocimientoObservaciones && (
                      <div className="p-2.5 bg-white/80 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 block mb-0.5">
                          Observaciones Adicionales de Reconocimiento Médico:
                        </span>
                        <p className="italic">{person.reconocimientoObservaciones}</p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600 dark:text-slate-400 border-t border-amber-200/60 dark:border-slate-800">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>Reconocimiento: <strong>{formatDate(person.citaDia) || 'Pendiente'}</strong> {person.citaHora ? `@ ${person.citaHora}` : ''} ({person.sitioReconocimiento || 'Centro PRL no especificado'})</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(person);
                        }}
                        className="text-brand-primary dark:text-blue-400 font-bold hover:underline flex items-center gap-1.5 cursor-pointer ml-auto"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Abrir Ficha Completa</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-4">
                <span className="bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700 text-[10px] font-bold px-2 py-1 rounded-lg border">
                  {person.numOferta}
                </span>
                <span className="bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700 text-[10px] font-bold px-2 py-1 rounded-lg border uppercase">
                  {person.categoria || 'Peón'}
                </span>
                <span className="bg-[#00548E]/5 text-[#00548E] border-[#00548E]/20 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/40 text-[10px] font-bold px-2 py-1 rounded-lg border">
                  {person.quincena}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-xs">
                <div className="space-y-2 min-w-0">
                  <p className="flex justify-between border-b border-slate-200 dark:border-slate-800 pb-1 gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">DNI</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{person.dni}</span>
                  </p>
                  <p className="flex justify-between border-b border-slate-200 dark:border-slate-800 pb-1 gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Teléfono</span>
                    <a href={`tel:${person.telefono}`} className="font-bold text-[#00548E] dark:text-blue-400 hover:underline truncate">{person.telefono}</a>
                  </p>
                  <p className="flex justify-between border-b border-slate-200 dark:border-slate-800 pb-1 gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Obra</span>
                    <span className="font-medium text-slate-700 dark:text-slate-200 truncate text-right">{person.obra}</span>
                  </p>
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-1">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-slate-500 dark:text-slate-400 shrink-0">Aptitud Médica</span>
                      <span className={`font-semibold truncate text-right ${
                        aptInfo.estado === 'Apto' ? 'text-emerald-600 dark:text-emerald-400 font-bold' :
                        aptInfo.estado === 'Apto con limitaciones' ? 'text-amber-600 dark:text-amber-400 font-bold' :
                        aptInfo.estado === 'No Apto' ? 'text-red-600 dark:text-red-400 font-bold' :
                        'text-slate-400 dark:text-slate-500 italic'
                      }`}>
                        {aptInfo.estado === 'Pendiente' 
                          ? 'Pendiente' 
                          : `${aptInfo.estado} (${aptInfo.validez})`}
                      </span>
                    </div>
                    {aptInfo.estado === 'Apto con limitaciones' && (
                      <div className="mt-1 p-1.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded text-[11px] text-amber-900 dark:text-amber-200">
                        <span className="font-bold">Limitaciones: </span>
                        <span>{aptInfo.limitaciones || 'Sin restricciones específicas detalladas'}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 min-w-0">
                  <p className="flex justify-between border-b border-slate-200 dark:border-slate-800 pb-1 gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Contrato</span>
                    <span className="font-medium text-slate-700 dark:text-slate-200 truncate text-right">{formatDate(person.periodoInicio)} - {formatDate(person.periodoFin)}</span>
                  </p>
                  <p className="flex justify-between border-b border-slate-200 dark:border-slate-800 pb-1 gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Rec. Médico</span>
                    <span className="group/cita relative font-medium text-slate-700 dark:text-slate-200 cursor-help truncate text-right">
                      {person.necesitaReconocimiento === 'No' || !person.citaDia ? (
                        <span className="text-slate-400 dark:text-slate-500 italic">No requiere</span>
                      ) : (
                        `${formatDate(person.citaDia)} @ ${person.citaHora}`
                      )}
                      <span className="absolute -top-8 right-0 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover/cita:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xs z-10">
                        {formatDate(person.citaDia)} a las {person.citaHora}
                      </span>
                    </span>
                  </p>
                  <p className="flex justify-between border-b border-slate-200 dark:border-slate-800 pb-1 gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Talla</span>
                    <span className="font-medium text-slate-700 dark:text-slate-200 truncate text-right">
                      {person.calzado === 'No' || person.calzado === 'No necesita' ? (
                        <span className="text-slate-400 dark:text-slate-500 italic">No requiere</span>
                      ) : (
                        person.calzado
                      )}
                    </span>
                  </p>
                  <p className="flex justify-between border-b border-slate-200 dark:border-slate-800 pb-1 gap-2 items-center">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Documentación</span>
                    <span className={`font-semibold truncate text-right flex items-center gap-1 ${
                      person.documentacionCompleta === 'Sí'
                        ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                        : isNoAptoDocIncomplete
                        ? 'text-red-700 dark:text-red-300 font-black bg-red-100 dark:bg-red-950/70 px-2 py-0.5 rounded-lg border border-red-300 dark:border-red-800 shadow-2xs'
                        : isNoApto
                        ? 'text-red-600 dark:text-red-400 font-black'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}>
                      {isNoAptoDocIncomplete && <AlertTriangle className="w-3.5 h-3.5 text-red-600 inline shrink-0 animate-pulse" />}
                      {person.documentacionCompleta === 'Sí' ? 'Completa' : isNoAptoDocIncomplete ? 'No (Por Reconocimiento No Apto)' : isNoApto ? 'Incompleta (No Apto)' : 'Pendiente'}
                    </span>
                  </p>
                </div>
              </div>

              {person.reconocimientoEstado === 'Apto con Limitación' && person.reconocimientoLimitaciones && (
                <div className="mt-3 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 p-3 rounded-xl text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-1.5 font-bold mb-1 text-amber-800 dark:text-amber-300">
                    <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Limitaciones Médicas del Trabajador (Validez {person.reconocimientoValidez || new Date().getFullYear()}):</span>
                  </div>
                  <p className="font-medium pl-5 leading-relaxed">{person.reconocimientoLimitaciones}</p>
                </div>
              )}

              {person.observaciones && (
                <div className="mt-4 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 italic border border-slate-200 dark:border-slate-700/80 break-words">
                  "{person.observaciones}"
                </div>
              )}

              {isRepeaterWorker && (
                <div className="mt-3 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 p-3 rounded-xl text-[11px] text-slate-700 dark:text-slate-300">
                  <div className="font-bold flex items-center gap-1.5 mb-1.5 text-purple-800 dark:text-purple-300">
                    <History className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 animate-pulse" />
                    <span>Historial de contratación ({sameDniWorkers.length} periodos):</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-1 mt-1">
                    {sameDniWorkers.map((w, idx) => (
                      <li key={w.id || idx} className={w.id === person.id ? "text-purple-700 dark:text-purple-300 font-bold" : "text-slate-500 dark:text-slate-400"}>
                        {w.quincena || 'Sin quincena'} - <span className="italic font-semibold">{w.obra}</span> ({formatDate(w.periodoInicio)} al {formatDate(w.periodoFin)}) {w.id === person.id ? " (Contrato Actual)" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex sm:flex-col gap-2 w-full sm:w-auto mt-4 sm:mt-0 shrink-0">
              {isNoAptoDocIncomplete && (
                <div className="w-full text-center sm:text-right mb-0.5" title="Atención: Trabajador No Apto. Verifique antes de cualquier gestión">
                  <span className="inline-flex items-center justify-center gap-1 text-[9px] font-black text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950/80 px-2 py-0.5 rounded-md border border-red-300 dark:border-red-800 uppercase tracking-tight shadow-2xs">
                    <AlertTriangle className="w-2.5 h-2.5 text-red-600 shrink-0" /> Riesgo
                  </span>
                </div>
              )}
              <button
                type="button"
                id={`btn-idcard-${person.id}`}
                onClick={handleSafeGenerateIDCard}
                className={`group/btn relative flex-1 sm:flex-none p-2.5 rounded-xl transition-all border cursor-pointer ${
                  isNoAptoDocIncomplete
                    ? 'bg-red-50/60 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-600 hover:text-white border-red-300 dark:border-red-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 dark:hover:text-white border-slate-200 dark:border-slate-700'
                }`}
                aria-label="Generar Tarjeta"
              >
                <IdCard className="w-4 h-4 mx-auto" />
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xs z-10">
                  {isNoAptoDocIncomplete ? 'Generar Carné (¡Riesgo No Apto!)' : 'Generar Carné PDF'}
                </span>
              </button>
              <button
                type="button"
                id={`btn-history-${person.id}`}
                onClick={() => onExportHistoryPDF(person)}
                className="group/btn relative flex-1 sm:flex-none p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                aria-label="Exportar Historial"
              >
                <History className="w-4 h-4 mx-auto" />
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xs z-10">
                  Exportar Historial PDF
                </span>
              </button>
              <button
                type="button"
                id={`btn-calendar-${person.id}`}
                onClick={handleSafeOpenCalendar}
                className={`group/btn relative flex-1 sm:flex-none p-2.5 rounded-xl transition-all border cursor-pointer ${
                  isNoAptoDocIncomplete
                    ? 'bg-red-50/60 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-600 hover:text-white border-red-300 dark:border-red-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-[#00548E] hover:text-white dark:hover:bg-[#00548E] dark:hover:text-white border-slate-200 dark:border-slate-700'
                }`}
                aria-label="Google Calendar"
              >
                <Calendar className={`w-4 h-4 mx-auto ${isNoAptoDocIncomplete ? 'text-red-600 dark:text-red-400' : 'text-[#00548E] dark:text-blue-400'} group-hover/btn:text-white`} />
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xs z-10">
                  {isNoAptoDocIncomplete ? 'Google Calendar (¡Riesgo No Apto!)' : 'Google Calendar'}
                </span>
              </button>
              <button
                type="button"
                id={`btn-edit-${person.id}`}
                onClick={() => onEdit(person)}
                className="group/btn relative flex-1 sm:flex-none p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-[#00548E] hover:text-white dark:hover:bg-[#00548E] dark:hover:text-white transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                aria-label="Editar"
              >
                <Pencil className="w-4 h-4 mx-auto" />
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xs z-10">
                  Editar
                </span>
              </button>
              <button
                type="button"
                id={`btn-delete-${person.id}`}
                onClick={() => onDelete(person.id)}
                className="group/btn relative flex-1 sm:flex-none p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 dark:hover:text-white transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                aria-label="Eliminar"
              >
                <Trash2 className="w-4 h-4 mx-auto" />
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xs z-10">
                  Eliminar
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

PersonCard.displayName = 'PersonCard';
