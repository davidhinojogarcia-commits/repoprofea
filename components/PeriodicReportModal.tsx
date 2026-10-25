import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useState, useMemo } from 'react';
import ModalPortal from './ModalPortal';
import { X, Calendar, Briefcase, Users, GraduationCap, Building2, Download, Search, CheckCircle, FileText, AlertCircle } from 'lucide-react';
import { Person } from '../types';
import { generatePeriodicReportPDF, downloadPDF } from '../src/lib/exportUtils';
import { PrintHeader } from './PrintHeader';
import { useAuthShell } from './AuthGate';

interface PeriodicReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  people: Person[];
}

const MONTHS_SPANISH = [
  { value: 'Todos', label: 'Todos los meses' },
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
];

export const PeriodicReportModal: React.FC<PeriodicReportModalProps> = ({ isOpen, onClose, people }) => {
  const { supervisorName } = useAuthShell();
  const [selectedYear, setSelectedYear] = useState<string>('Todos');
  const [selectedMonth, setSelectedMonth] = useState<string>('Todos');
  const [modalSearchTerm, setModalSearchTerm] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const supervisor = supervisorName;
  const [zona, setZona] = useState<string>('Zona 6');

  // Extract all available years from the dataset
  const availableYears = useMemo(() => {
    const years = people
      .map(p => {
        if (!p.periodoInicio) return '';
        const trimmed = p.periodoInicio.trim();
        return trimmed.substring(0, 4);
      })
      .filter(y => y && y.length === 4);
    
    // De-duplicate & Sort descending
    const uniqueYears = (Array.from(new Set(years)) as string[]).sort((a, b) => b.localeCompare(a));
    return uniqueYears;
  }, [people]);

  // Dynamic filter
  const filteredData = useMemo(() => {
    return people.filter(p => {
      // Year filter
      if (selectedYear !== 'Todos') {
        const pYear = p.periodoInicio ? p.periodoInicio.substring(0, 4) : '';
        if (pYear !== selectedYear) return false;
      }
      
      // Month filter
      if (selectedMonth !== 'Todos') {
        const pMonth = p.periodoInicio ? p.periodoInicio.substring(5, 7) : '';
        if (pMonth !== selectedMonth) return false;
      }

      // Search term filter inside report
      if (modalSearchTerm.trim() !== '') {
        const term = modalSearchTerm.toLowerCase();
        const matchesName = p.apellidosNombre?.toLowerCase().includes(term);
        const matchesDni = p.dni?.toLowerCase().includes(term);
        const matchesObra = p.obra?.toLowerCase().includes(term);
        const matchesCategory = p.categoria?.toLowerCase().includes(term);
        return matchesName || matchesDni || matchesObra || matchesCategory;
      }

      return true;
    });
  }, [people, selectedYear, selectedMonth, modalSearchTerm]);

  // Compute live statistics for selected period
  const reportStats = useMemo(() => {
    const total = filteredData.length;
    const uniqueWorkers = new Set(filteredData.map(p => p.dni?.trim().toUpperCase().replace(/[\s-]/g, ''))).size;
    const uniqueObrasCount = new Set(filteredData.map(p => p.obra?.trim()).filter(Boolean)).size;
    const conFormacion = filteredData.filter(p => p.formacion === 'Sí').length;
    const prlPercentage = total > 0 ? Math.round((conFormacion / total) * 100) : 0;

    // Formaciones de personas que en contrataciones anteriores figuraban sin formación
    const reincorporadosFormadosCount = filteredData.filter(p => {
      if (p.formacion !== 'Sí') return false;
      const cleanDni = p.dni ? p.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
      const cleanName = p.apellidosNombre ? p.apellidosNombre.trim().toLowerCase() : '';
      return people.some(prevP => {
        if (prevP.id === p.id) return false;
        const prevDni = prevP.dni ? prevP.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
        const prevName = prevP.apellidosNombre ? prevP.apellidosNombre.trim().toLowerCase() : '';
        const isMatch = (cleanDni && prevDni === cleanDni) || (cleanName && prevName === cleanName);
        return isMatch && (prevP.formacion === 'No' || prevP.formacion === 'Sin formación' || !prevP.formacion);
      });
    }).length;

    const dniCounts: { [key: string]: number } = {};
    filteredData.forEach(p => {
      const dni = p.dni?.trim().toUpperCase().replace(/[\s-]/g, '');
      if (dni) {
        dniCounts[dni] = (dniCounts[dni] || 0) + 1;
      }
    });
    const repeatedWorkersCount = Object.values(dniCounts).filter(count => count > 1).length;

    // Workplaces breakdown
    const obraDistribution: { [key: string]: number } = {};
    filteredData.forEach(p => {
      if (p.obra) obraDistribution[p.obra] = (obraDistribution[p.obra] || 0) + 1;
    });

    // Categories breakdown
    const categoryDistribution: { [key: string]: number } = {};
    filteredData.forEach(p => {
      if (p.categoria) {
        categoryDistribution[p.categoria] = (categoryDistribution[p.categoria] || 0) + 1;
      }
    });

    return {
      total,
      uniqueWorkers,
      uniqueObrasCount,
      prlPercentage,
      conFormacion,
      reincorporadosFormadosCount,
      repeatedWorkersCount,
      obraDistribution,
      categoryDistribution
    };
  }, [filteredData]);

  const handleExportPDFReport = async () => {
    if (filteredData.length === 0) {
      alert('Sin datos en el período de análisis para exportar.');
      return;
    }
    
    setIsExporting(true);
    try {
      const yearLabel = selectedYear === 'Todos' ? 'Histórico General' : `Año ${selectedYear}`;
      const monthObject = MONTHS_SPANISH.find(m => m.value === selectedMonth);
      const monthLabel = selectedMonth === 'Todos' ? '' : `${monthObject?.label || ''}`;
      const fullPeriodLabel = monthLabel ? `${monthLabel} de ${selectedYear}` : yearLabel;

      const { doc, filename } = await generatePeriodicReportPDF(filteredData, fullPeriodLabel, supervisor, zona);
      downloadPDF(doc, filename);
    } catch (err) {
      reportOperationalError('Error rendering report PDF:', err);
      alert('Ocurrió un error al compilar el informe. Por favor, inténtelo de nuevo.');
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal label="PeriodicReportModal"><div className="fixed inset-0 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-5xl w-full h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
        
        {/* Header Block */}
        <div className="bg-gradient-to-r from-blue-700 via-blue-800 to-indigo-900 text-white p-6 relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
          <button 
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white hover:bg-white/15 p-2 rounded-full transition-colors cursor-pointer z-10"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/10 rounded-2xl border border-white/10">
              <FileText className="w-7 h-7 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold uppercase tracking-tight">Centro de Informes de Contratación</h3>
              <p className="text-xs text-white/80 mt-0.5">Analiza y genera cuadernos oficiales del programa PROFEA por fecha</p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-slate-50 dark:bg-slate-950">
          <PrintHeader 
            title="INFORME PERIÓDICO DE CONTRATACIÓN PROFEA" 
            subtitle="EXCMA. DIPUTACIÓN PROVINCIAL DE CÁDIZ" 
          />
          
          {/* Filtering Controls Panel */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-sm flex flex-col md:flex-row gap-4 items-end justify-between">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full md:w-auto md:flex-1">
              
              {/* Year field */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">
                  1. Selección Anual
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <select
                    value={selectedYear}
                    onChange={(e) => {
                      setSelectedYear(e.target.value);
                      if (e.target.value === 'Todos') setSelectedMonth('Todos');
                    }}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-500 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  >
                    <option value="Todos">Todos los años</option>
                    {availableYears.map(yr => (
                      <option key={yr} value={yr}>Año {yr}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Month field */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">
                  2. Selección Mensual
                </label>
                <div className="relative">
                  <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <select
                    value={selectedMonth}
                    disabled={selectedYear === 'Todos'}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-500 text-xs font-semibold text-slate-800 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {MONTHS_SPANISH.map(mo => (
                      <option key={mo.value} value={mo.value}>{mo.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Live search string inside modal */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">
                  3. Buscar en el Informe
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    value={modalSearchTerm}
                    onChange={(e) => setModalSearchTerm(e.target.value)}
                    placeholder="Filtrar por nombre, obra..."
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-500 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

            </div>

            {/* Quick stats indicator */}
            <div className="shrink-0 text-right hidden lg:block border-l border-slate-100 dark:border-slate-800 pl-6">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Estado del Filtro</span>
              <span className="text-sm font-extrabold text-blue-600 dark:text-blue-400 mt-1 block">
                {filteredData.length} registros hallados
              </span>
            </div>
          </div>

          {/* Configuración de Firma y Zona de la Cabecera */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
            {/* Supervisor field */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">
                Responsable del Informe (Supervisor)
              </label>
              <div className="relative">
                <Users className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <input
                  type="text"
                  value={supervisor}
                  readOnly
                  aria-readonly="true"
                  placeholder="Nombre y apellidos de la cuenta"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-500 text-xs font-semibold text-slate-800 dark:text-slate-200"
                />
              </div>
              <p className="text-[9px] text-slate-450 dark:text-slate-500 italic ml-1">Nombre que se imprimirá en el membrete del documento</p>
            </div>

            {/* Zona field */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">
                Zona Geográfica
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <select
                  value={zona}
                  onChange={(e) => setZona(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-500 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  {Array.from({ length: 15 }, (_, i) => `Zona ${i + 1}`).map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                  <option value="Otra Zona">Otra Zona</option>
                </select>
              </div>
              <p className="text-[9px] text-slate-450 dark:text-slate-500 italic ml-1">Seleccione la zona de la delegación (ej: Zona 6)</p>
            </div>
          </div>

          {/* Conditional Layout for zero data */}
          {filteredData.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center space-y-4">
              <AlertCircle className="w-12 h-12 text-slate-350 dark:text-slate-600" />
              <div>
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-200">No hay contrataciones en este periodo</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  Asegúrese de modificar el filtro (por ejemplo seleccionando un año diferente) o registrar contrataciones que encajen en el periodo seleccionado.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Dynamic Dashboard Metrics Section */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 animate-in fade-in duration-300">
                
                {/* Metric 1 */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-start gap-4">
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Altas Colectivas</span>
                    <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-0.5">{reportStats.total}</h4>
                    <span className="text-[10px] text-slate-500 block">Contrataciones</span>
                  </div>
                </div>

                {/* Metric 2 */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-start gap-4">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Operarios Únicos</span>
                    <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-0.5">{reportStats.uniqueWorkers}</h4>
                    <span className="text-[10px] text-slate-500 block">Por NIF consolidado</span>
                  </div>
                </div>

                {/* Metric 3 */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-start gap-4">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Obras / Sedes</span>
                    <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-0.5">{reportStats.uniqueObrasCount}</h4>
                    <span className="text-[10px] text-slate-500 block">Proyectos cubiertos</span>
                  </div>
                </div>

                {/* Metric 4 */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-start gap-4">
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Capacitación PRL</span>
                    <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-0.5">{reportStats.conFormacion}</h4>
                    <span className="text-[10px] text-slate-500 block">
                      {reportStats.reincorporadosFormadosCount > 0 
                        ? `${reportStats.reincorporadosFormadosCount} formados tras re-incorporación (${reportStats.prlPercentage}%)`
                        : `${reportStats.conFormacion} aptos con curso (${reportStats.prlPercentage}%)`}
                    </span>
                  </div>
                </div>

                {/* Metric 5 */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-start gap-4">
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Trab. Repetidos</span>
                    <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-0.5">{reportStats.repeatedWorkersCount}</h4>
                    <span className="text-[10px] text-slate-500 block">Con más de 1 contrato</span>
                  </div>
                </div>

              </div>

              {/* Dynamic Grouping Visualizers (Side-by-side) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Obra distribution breakdown list */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-600" /> Plantilla Absoluta por Obra / Proyecto
                  </h4>
                  <div className="space-y-4 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.entries(reportStats.obraDistribution)
                      .sort(([, a], [, b]) => (b as number) - (a as number))
                      .map(([work, count]) => {
                        const pct = Math.round(((count as number) / reportStats.total) * 100);
                        return (
                          <div key={work} className="space-y-1.5 focus:outline-none">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-semibold text-slate-700 dark:text-slate-350 truncate w-[75%]" title={work}>
                                {work}
                              </span>
                              <span className="font-black text-blue-600 dark:text-blue-400 shrink-0">
                                {count} <span className="font-normal text-slate-400 text-[10px]">cont. ({pct}%)</span>
                              </span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full rounded-full transition-all duration-500" 
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Categories distribution pills */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-indigo-600" /> Distribución por categoría ocupacional
                  </h4>
                  <div className="flex flex-wrap gap-2.5 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.entries(reportStats.categoryDistribution)
                      .sort(([, a], [, b]) => (b as number) - (a as number))
                      .map(([category, count]) => {
                        return (
                          <div 
                            key={category} 
                            className="bg-slate-100 dark:bg-slate-800 px-3.5 py-2.5 rounded-xl border border-slate-200/50 dark:border-slate-700 flex items-center gap-3 transition-shadow shadow-sm hover:shadow"
                          >
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                              {category}
                            </span>
                            <span className="h-5 px-2 bg-indigo-600 text-white rounded-md text-[10px] font-bold flex items-center justify-center">
                              {count}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>

              </div>

              {/* Detailed registry logs under filtered scenario */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-sm overflow-hidden flex flex-col">
                <div className="p-4 bg-slate-50 dark:bg-slate-850 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    LISTA NOMINAL COMPLETA DE ACTAS EN ESTE PERIODO
                  </span>
                  <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-lg shrink-0">
                    Satisface: {filteredData.length} registros
                  </span>
                </div>

                <div className="overflow-x-auto max-h-[200px] overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 font-bold text-slate-500 whitespace-nowrap">
                        <th className="p-3 pl-4">Trabajador</th>
                        <th className="p-3">DNI</th>
                        <th className="p-3">Obra Escenario</th>
                        <th className="p-3">Categoría</th>
                        <th className="p-3">Inicio de Contrato</th>
                        <th className="p-3">Término de Contrato</th>
                        <th className="p-3 pr-4 text-center">PRL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {filteredData.map((person, i) => (
                        <tr 
                          key={`rep_p_${person.id}_${i}`}
                          className="hover:bg-slate-50 dark:hover:bg-slate-850/40 text-slate-700 dark:text-slate-300 transition-colors"
                        >
                          <td className="p-3 pl-4 font-bold text-slate-900 dark:text-white">{person.apellidosNombre}</td>
                          <td className="p-3 font-mono">{person.dni}</td>
                          <td className="p-3 max-w-[200px] truncate" title={person.obra}>{person.obra}</td>
                          <td className="p-3 text-slate-500">{person.categoria}</td>
                          <td className="p-3 font-semibold">{person.periodoInicio.split('-').reverse().join('/')}</td>
                          <td className="p-3 font-semibold">{person.periodoFin.split('-').reverse().join('/')}</td>
                          <td className="p-3 pr-4 text-center">
                            <span className={`inline-block text-[10px] px-2 py-0.5 font-bold rounded-md ${
                              person.formacion === 'Sí'
                                ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                                : 'bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                            }`}>
                              {person.formacion === 'Sí' ? 'APTO' : 'PENDIENTE'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
          
          <div className="text-[11px] text-slate-400 dark:text-slate-500 text-center sm:text-left">
            <span>Para presentar formalmente, configure el período superior y pulse generar.</span>
          </div>

          <div className="flex gap-3 w-full sm:w-auto shrink-0 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Cerrar Vista
            </button>
            <button
              type="button"
              disabled={filteredData.length === 0 || isExporting}
              onClick={handleExportPDFReport}
              className="flex-1 sm:flex-none px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generando Dossier...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" /> Exportar Informe Formal
                </>
              )}
            </button>
          </div>

        </div>

      </div>
    </div></ModalPortal>
  );
};