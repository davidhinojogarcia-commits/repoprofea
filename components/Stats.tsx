import React, { useState, useMemo } from 'react';
import { 
  Users, GraduationCap, CalendarClock, Briefcase, Building2, BarChart3, Filter, 
  Calendar, History, MapPin, FileText, TrendingUp, LineChart as LineChartIcon,
  BarChart2, AreaChart as AreaChartIcon, Sparkles, Layers, List, CalendarDays,
  Clock, RotateCcw, Check
} from 'lucide-react';
import { 
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, 
  XAxis, YAxis, Tooltip, CartesianGrid 
} from 'recharts';
import { StatsData } from '../types';
import { MultiSearchableDropdown } from './MultiSearchableDropdown';
import { PageHeader } from './ui/PageHeader';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '../constants';

interface StatsProps {
  stats: StatsData;
  filterMode: 'origen' | 'fechas' | 'mes_actual' | 'ano_actual' | string;
  setFilterMode: (mode: 'origen' | 'fechas' | 'mes_actual' | 'ano_actual') => void;
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  obraFilter: string[];
  setObraFilter: (obras: string[]) => void;
  savedObras: string[];
  onOpenReportModal?: () => void;
  onExportObraSummary?: () => void;
  onExportStatsSummaryPDF?: () => void;
}

// Custom Tooltip for Main Recharts Trend Chart
const CustomTrendTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white p-3.5 rounded-2xl shadow-xl border border-slate-700/80 text-xs space-y-1.5 backdrop-blur-md z-50 min-w-[160px]">
        <div className="flex items-center justify-between border-b border-slate-700/80 pb-1.5 mb-1">
          <span className="font-bold text-slate-100 text-xs">{data.name}</span>
          <span className="text-[10px] bg-blue-500/20 text-blue-300 font-semibold px-2 py-0.5 rounded-full border border-blue-500/30">
            {data.porcentaje}% del total
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-300">
          <span>Trabajadores:</span>
          <span className="font-extrabold text-blue-400 text-sm">{data.registros}</span>
        </div>
      </div>
    );
  }
  return null;
};

// Custom Tooltip for Obra Recharts Chart
const CustomObraTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs space-y-1 backdrop-blur-md">
        <p className="font-bold text-slate-100 border-b border-slate-700 pb-1 mb-1">{data.fullName}</p>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-300">Asignados:</span>
          <span className="font-bold text-amber-400">{data.count} pers.</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-300">Cuota:</span>
          <span className="font-medium text-emerald-400">{data.porcentaje}%</span>
        </div>
      </div>
    );
  }
  return null;
};

export const Stats: React.FC<StatsProps> = ({ 
  stats, 
  filterMode, 
  setFilterMode, 
  startDate, 
  setStartDate, 
  endDate, 
  setEndDate, 
  obraFilter,
  setObraFilter,
  savedObras,
  onOpenReportModal,
  onExportObraSummary,
  onExportStatsSummaryPDF
}) => {
  const [chartType, setChartType] = useState<'area' | 'bar' | 'line'>('area');
  const [quincenaViewMode, setQuincenaViewMode] = useState<'chart' | 'list'>('chart');

  const currentMonthLabel = useMemo(() => {
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    const now = new Date();
    return `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  }, []);

  const currentYearLabel = useMemo(() => {
    return `${new Date().getFullYear()}`;
  }, []);

  const handlePreset30Days = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
    setFilterMode('fechas');
  };

  const handlePreset90Days = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 90);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
    setFilterMode('fechas');
  };

  // Prepare ordered data for quincenas chart
  const quincenaChartData = useMemo(() => {
    if (!stats.desgloseQuincena) return [];
    const entries = Object.entries(stats.desgloseQuincena) as [string, number][];
    
    entries.sort(([a], [b]) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    return entries.map(([quincena, count]) => {
      let shortLabel = quincena;
      if (quincena.includes('Quincena')) {
        shortLabel = quincena.replace(/Quincena/i, 'Q.').replace(/\s+/g, '');
      }
      const cnt = Number(count) || 0;
      return {
        name: quincena,
        shortName: shortLabel,
        registros: cnt,
        porcentaje: stats.total > 0 ? Math.round((cnt / stats.total) * 100) : 0
      };
    });
  }, [stats.desgloseQuincena, stats.total]);

  // Prepare top obras chart data
  const obraChartData = useMemo(() => {
    if (!stats.desgloseObra) return [];
    const entries = Object.entries(stats.desgloseObra) as [string, number][];
    return entries
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, 7)
      .map(([obra, count]) => {
        const cnt = Number(count) || 0;
        return {
          name: obra.length > 14 ? obra.substring(0, 13) + '…' : obra,
          fullName: obra,
          count: cnt,
          porcentaje: stats.total > 0 ? Math.round((cnt / stats.total) * 100) : 0
        };
      });
  }, [stats.desgloseObra, stats.total]);

  const peakQuincena = useMemo(() => {
    if (quincenaChartData.length === 0) return null;
    return quincenaChartData.reduce((max, current) => current.registros > max.registros ? current : max, quincenaChartData[0]);
  }, [quincenaChartData]);

  const averageQuincena = useMemo(() => {
    if (quincenaChartData.length === 0) return 0;
    const sum = quincenaChartData.reduce((acc, curr) => acc + curr.registros, 0);
    return Math.round((sum / quincenaChartData.length) * 10) / 10;
  }, [quincenaChartData]);

  return (
    <div className="space-y-6 mb-8">
      <PageHeader
        eyebrow="Gestión PROFEA"
        title="Centro de Control"
        description="Situación operativa de contrataciones, formación, reconocimientos y distribución por obra."
        icon={<BarChart3 className="h-5 w-5" />}
      />

      {/* Controles de Filtro */}
      <div className="ui-surface p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-2xl">
              <Filter className="w-5 h-5 text-brand-primary dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">Filtros y acciones</h2>
              <p className="text-slate-400 dark:text-slate-500 text-xs">Acota la información y genera los informes institucionales desde una única zona.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            {/* Botón de Exportar Resumen Estadístico PDF */}
            {onExportStatsSummaryPDF && (
              <button
                type="button"
                onClick={onExportStatsSummaryPDF}
                className={`${BUTTON_SECONDARY} w-full sm:w-auto text-xs uppercase tracking-wider`}
                title="Exportar documento PDF formateado con el resumen de estadísticas actual para entrega administrativa"
              >
                <FileText className="w-4 h-4" /> Resumen estadístico formaciones
              </button>
            )}

            {/* Botón de Informe Periódico */}
            {onOpenReportModal && (
              <button
                type="button"
                onClick={onOpenReportModal}
                className={`${BUTTON_PRIMARY} w-full sm:w-auto text-xs uppercase tracking-wider`}
              >
                <FileText className="w-4 h-4" /> Análisis mano de obra
              </button>
            )}

            {/* Botón de Relación nominal de trabajadores por obra */}
            {onExportObraSummary && (
              <button
                type="button"
                onClick={onExportObraSummary}
                className={`${BUTTON_SECONDARY} w-full sm:w-auto text-xs uppercase tracking-wider`}
                title="Exportar dossier a pie de obra del personal asignado"
              >
                <Building2 className="w-4 h-4" /> Exportar Resumen de Obra
              </button>
            )}

            {/* Filtro por Obra */}
            <div className="w-full sm:w-auto min-w-[200px] border border-slate-200 dark:border-slate-700/80 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <MultiSearchableDropdown
                options={savedObras}
                selectedValues={obraFilter}
                onChange={setObraFilter}
                placeholder="Obra: Todas"
                allLabel="Todas las obras"
                icon={<MapPin className="w-4 h-4" />}
                className="!w-full"
                buttonClassName="!bg-transparent !border-none hover:!bg-slate-100 dark:hover:!bg-slate-700/40 !shadow-none !h-full !py-2 !text-slate-700 dark:!text-slate-200"
              />
            </div>

            {/* Selector de Modo con Filtros Rápidos */}
            <div className="flex flex-wrap items-center p-1 bg-slate-100 dark:bg-slate-800/90 rounded-2xl border border-slate-200 dark:border-slate-700/80 gap-1">
              <button
                type="button"
                onClick={() => setFilterMode('origen')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  filterMode === 'origen' 
                    ? 'bg-white dark:bg-slate-700 text-brand-primary dark:text-blue-400 shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
                title="Mostrar todo el historial de contrataciones"
              >
                <History className="w-3.5 h-3.5" />
                Histórico
              </button>

              <button
                type="button"
                onClick={() => setFilterMode('mes_actual')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  filterMode === 'mes_actual' 
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm border border-blue-500/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
                title={`Filtrar por el mes actual (${currentMonthLabel})`}
              >
                <CalendarDays className="w-3.5 h-3.5 text-blue-500" />
                Mes Actual
              </button>

              <button
                type="button"
                onClick={() => setFilterMode('ano_actual')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  filterMode === 'ano_actual' 
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm border border-emerald-500/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
                title={`Filtrar por el año en curso (${currentYearLabel})`}
              >
                <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                Año en Curso
              </button>

              <button
                type="button"
                onClick={() => setFilterMode('fechas')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  filterMode === 'fechas' 
                    ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/20' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
                title="Especificar un rango de fechas personalizado"
              >
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                Personalizado
              </button>
            </div>
          </div>
        </div>

        {/* Indicador o Inputs de Filtro de Fecha */}
        {filterMode === 'mes_actual' && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/40 p-3 rounded-xl border border-blue-200/60 dark:border-blue-800/40 animate-in fade-in duration-300">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
              <span>Filtro activo: <strong>Mes Actual ({currentMonthLabel})</strong></span>
            </div>
            <span className="text-[11px] font-semibold bg-blue-200/50 dark:bg-blue-900/60 px-2.5 py-0.5 rounded-lg">
              {stats.total} {stats.total === 1 ? 'registro' : 'registros'}
            </span>
          </div>
        )}

        {filterMode === 'ano_actual' && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/40 p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 animate-in fade-in duration-300">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Filtro activo: <strong>Año en Curso ({currentYearLabel})</strong></span>
            </div>
            <span className="text-[11px] font-semibold bg-emerald-200/50 dark:bg-emerald-900/60 px-2.5 py-0.5 rounded-lg">
              {stats.total} {stats.total === 1 ? 'registro' : 'registros'}
            </span>
          </div>
        )}

        {filterMode === 'fechas' && (
          <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                Rango de Fechas Personalizado:
              </span>

              {/* Atajos de Rango Rápido */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreset30Days}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                >
                  Últimos 30 días
                </button>
                <button
                  type="button"
                  onClick={handlePreset90Days}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                >
                  Últimos 90 días
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Fecha Inicio</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="ui-field px-3 py-2 text-xs font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Fecha Fin</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="ui-field px-3 py-2 text-xs font-medium"
                />
              </div>
              {(startDate || endDate) && (
                <button 
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-red-600 hover:text-red-700 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 rounded-xl transition-colors cursor-pointer font-semibold"
                  title="Limpiar fechas"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Limpiar Rango
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Resumen Principal con Sparklines de RechArts */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* Card 1: Contratación Total con Sparkline */}
        <div className="ui-surface p-5 hover:shadow-md transition-all duration-200 flex flex-col justify-between relative overflow-hidden group">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-blue-50 dark:bg-blue-950/60 rounded-xl text-blue-600 dark:text-blue-400">
                <Users className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-right">Contratación</span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">{stats.total}</h4>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-3">Registros totales</p>
          </div>

          {/* Recharts Mini Sparkline */}
          {quincenaChartData.length > 0 && (
            <div className="h-10 w-full mt-1 pt-1 border-t border-slate-100 dark:border-slate-800/80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={quincenaChartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                  <defs>
                    <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <Area 
                    type="monotone" 
                    dataKey="registros" 
                    stroke="#2563eb" 
                    strokeWidth={2} 
                    fillOpacity={1} 
                    fill="url(#sparklineGrad)" 
                    isAnimationActive={true}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Card 2: Formación */}
        <div className="ui-surface p-5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl text-emerald-600 dark:text-emerald-400">
                <GraduationCap className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-right">Formación</span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">{stats.conFormacion}</h4>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-3">
              {stats.formacionesReincorporacion && stats.formacionesReincorporacion > 0
                ? `${stats.formacionesReincorporacion} tras reincorporarse` 
                : 'Personas formadas'}
            </p>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-emerald-500 h-full rounded-full transition-all duration-700" 
              style={{ width: `${stats.total > 0 ? (stats.conFormacion / stats.total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Card 3: Obras Activas */}
        <div className="ui-surface p-5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-purple-50 dark:bg-purple-950/60 rounded-xl text-purple-600 dark:text-purple-400">
                <Building2 className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-right">Obras</span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">{stats.totalObras}</h4>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-3">Proyectos activos</p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-2.5 py-1 rounded-lg border border-purple-100 dark:border-purple-900/40">
            <MapPin className="w-3 h-3" /> {savedObras.length} obras registradas
          </div>
        </div>

        {/* Card 4: Citas Próximas */}
        <div className="ui-surface p-5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-amber-50 dark:bg-amber-950/60 rounded-xl text-amber-600 dark:text-amber-400">
                <CalendarClock className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-right">Citas</span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">{stats.citasPendientes}</h4>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-3">Reconocimientos médicos</p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-100 dark:border-amber-900/40">
            <Calendar className="w-3 h-3" /> Citas pendientes
          </div>
        </div>

        {/* Card 5: Trabajadores Repetidos */}
        <div className="ui-surface p-5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-rose-50 dark:bg-rose-950/60 rounded-xl text-rose-600 dark:text-rose-400">
                <Users className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-right">Repetidos</span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">{stats.trabajadoresRepetidos}</h4>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-3">Re-contrataciones</p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 rounded-lg border border-rose-100 dark:border-rose-900/40">
            <History className="w-3 h-3" /> Fidelización plantilla
          </div>
        </div>
      </div>

      {/* Gráfico de Evolución Tendencial por Quincena (RECHARTS) */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800/80 transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-50 dark:bg-blue-950/80 rounded-xl text-blue-600 dark:text-blue-400">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tight">
                  Evolución de Registros por Quincena
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Tendencia de contrataciones en el periodo seleccionado
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick summary metrics */}
            {peakQuincena && (
              <div className="hidden lg:flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-semibold px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-800/60">
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                <span>Pico: <strong className="font-extrabold">{peakQuincena.shortName}</strong> ({peakQuincena.registros} reg)</span>
              </div>
            )}
            {quincenaChartData.length > 0 && (
              <div className="hidden md:flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <span>Media: <strong className="font-extrabold">{averageQuincena}</strong> / quincena</span>
              </div>
            )}

            {/* Selector de Tipo de Gráfico */}
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setChartType('area')}
                title="Vista Área"
                className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  chartType === 'area'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <AreaChartIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setChartType('bar')}
                title="Vista Barras"
                className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  chartType === 'bar'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <BarChart2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setChartType('line')}
                title="Vista Líneas"
                className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  chartType === 'line'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <LineChartIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Recharts Main Graph Container */}
        {quincenaChartData.length > 0 ? (
          <div className="w-full h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'area' ? (
                <AreaChart data={quincenaChartData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mainQuincenaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00548E" stopOpacity={0.65} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis 
                    dataKey="shortName" 
                    tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} 
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fill: '#64748b', fontSize: 11 }} 
                    axisLine={false} 
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTrendTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="registros" 
                    name="Trabajadores" 
                    stroke="#00548E" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#mainQuincenaGrad)"
                    activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2, fill: '#00548E' }}
                  />
                </AreaChart>
              ) : chartType === 'bar' ? (
                <BarChart data={quincenaChartData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis 
                    dataKey="shortName" 
                    tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} 
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fill: '#64748b', fontSize: 11 }} 
                    axisLine={false} 
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTrendTooltip />} />
                  <Bar 
                    dataKey="registros" 
                    name="Trabajadores" 
                    fill="#00548E" 
                    radius={[8, 8, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              ) : (
                <LineChart data={quincenaChartData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis 
                    dataKey="shortName" 
                    tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} 
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fill: '#64748b', fontSize: 11 }} 
                    axisLine={false} 
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTrendTooltip />} />
                  <Line 
                    type="monotone" 
                    dataKey="registros" 
                    name="Trabajadores" 
                    stroke="#00548E" 
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#00548E', strokeWidth: 2, stroke: '#ffffff' }}
                    activeDot={{ r: 7, stroke: '#ffffff', strokeWidth: 2, fill: '#00548E' }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-sm italic bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            No hay suficientes datos de quincena para mostrar el gráfico de tendencia
          </div>
        )}
      </div>

      {/* Desglose de Quincenas y Obras */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Desglose por Quincena - Hitos */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col h-full">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-slate-800 dark:text-slate-100 text-sm font-bold flex items-center uppercase tracking-wider">
              <Briefcase className="w-4 h-4 mr-2 text-brand-primary dark:text-blue-400" /> Hitos por Quincena
            </h3>

            {/* View Mode Toggle for Quincenas */}
            <div className="flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setQuincenaViewMode('chart')}
                className={`p-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                  quincenaViewMode === 'chart' 
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs' 
                    : 'text-slate-400 hover:text-slate-700'
                }`}
                title="Gráfica"
              >
                <BarChart2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setQuincenaViewMode('list')}
                className={`p-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                  quincenaViewMode === 'list' 
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs' 
                    : 'text-slate-400 hover:text-slate-700'
                }`}
                title="Lista"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1">
            {quincenaChartData.length > 0 ? (
              quincenaViewMode === 'chart' ? (
                <div className="w-full h-56 pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={quincenaChartData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#94a3b8" strokeOpacity={0.15} />
                      <XAxis dataKey="shortName" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<CustomTrendTooltip />} />
                      <Bar dataKey="registros" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                  {quincenaChartData.map((item) => (
                    <div key={item.name} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                      <span className="text-slate-700 dark:text-slate-300 font-medium text-sm">{item.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500 dark:text-slate-400 text-[10px] font-bold">
                          {item.porcentaje}%
                        </span>
                        <span className="bg-white dark:bg-slate-900 text-brand-primary dark:text-blue-400 text-xs font-bold px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs">
                          {item.registros}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-sm italic text-center py-8">No hay datos disponibles</p>
            )}
          </div>
        </div>

        {/* Desglose por Obra con barras de progreso y Recharts */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col h-full">
          <h3 className="text-slate-800 dark:text-slate-100 text-sm font-bold mb-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center uppercase tracking-wider">
            <BarChart3 className="w-4 h-4 mr-2 text-brand-primary dark:text-blue-400" /> Contratación por Obra
          </h3>
          <div className="space-y-4 flex-1 overflow-y-auto max-h-[260px] pr-2 custom-scrollbar">
            {obraChartData.length > 0 ? (
              obraChartData.map((item) => (
                <div key={item.fullName} className="space-y-1.5">
                  <div className="flex justify-between items-end">
                    <span className="text-slate-700 dark:text-slate-300 font-medium text-xs truncate max-w-[70%]" title={item.fullName}>
                      {item.fullName}
                    </span>
                    <span className="text-brand-primary dark:text-blue-400 font-bold text-xs">
                      {item.count} <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">pers. ({item.porcentaje}%)</span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-brand-primary dark:bg-blue-500 h-full rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${item.porcentaje}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-sm italic text-center py-8">No hay datos de obras</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
