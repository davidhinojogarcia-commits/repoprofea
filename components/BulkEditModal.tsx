import React, { useState, useEffect, useMemo } from 'react';
import { Save, X, Briefcase, MapPin, AlertCircle, FileText, Award, HardHat, CheckCircle2, Pencil, Users } from 'lucide-react';
import { Person } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthShell } from './AuthGate';

interface BulkEditModalProps {
  selectedPeople: Person[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<Person>, selectedIds: number[]) => void;
  savedObras: string[];
  savedLugares: string[];
  savedSitios: string[];
  savedTelefonos: string[];
  savedCategorias: string[];
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export const BulkEditModal: React.FC<BulkEditModalProps> = ({ 
  selectedPeople, 
  isOpen, 
  onClose, 
  onSave,
  savedObras,
  savedLugares,
  savedSitios,
  savedTelefonos,
  savedCategorias
}) => {
  const { supervisorName } = useAuthShell();
  // We keep track of which fields the user actually wants to update.
  const [fieldsToUpdate, setFieldsToUpdate] = useState<{ [key: string]: boolean }>({
    supervisorResponsable: true,
    numOferta: false,
    obra: false,
    categoria: false,
    quincena: false,
    periodoContrato: false,
    calzado: false,
    formacion: false,
    reconocimientoMedico: false,
    aptitudMedica: false,
    documentacionCompleta: false,
    observaciones: false,
  });

  // State values for each potential field
  const [numOferta, setNumOferta] = useState('');
  const [obra, setObra] = useState('');
  const [categoria, setCategoria] = useState('Peón');
  const [isManualCategory, setIsManualCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState('');

  // Aptitud Medica
  const [aptitudMedica, setAptitudMedica] = useState<'Apto' | 'No Apto' | 'Apto con limitaciones' | 'Pendiente'>('Apto');
  const [limitacionesAptitud, setLimitacionesAptitud] = useState('');
  const [validezAptitud, setValidezAptitud] = useState(() => new Date().getFullYear().toString());

  // Quincena splits
  const [qType, setQType] = useState('1ª');
  const [qMonth, setQMonth] = useState('Enero');
  const [qYear, setQYear] = useState(() => new Date().getFullYear().toString());

  // Periodo Contrato
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFin, setPeriodoFin] = useState('');

  // Calzado
  const [calzadoNecesita, setCalzadoNecesita] = useState('Sí');
  const [calzadoTalla, setCalzadoTalla] = useState('');

  // Formacion
  const [formacion, setFormacion] = useState<'Sí' | 'No'>('Sí');
  const [lugarFormacion, setLugarFormacion] = useState('');

  // Reconocimiento Medico
  const [necesitaReconocimiento, setNecesitaReconocimiento] = useState('Sí');
  const [citaDia, setCitaDia] = useState('');
  const [citaHora, setCitaHora] = useState('');
  const [sitioReconocimiento, setSitioReconocimiento] = useState('');

  // Documentacion Completa
  const [documentacionCompleta, setDocumentacionCompleta] = useState<'Sí' | 'No'>('Sí');
  const [observaciones, setObservaciones] = useState('');

  // Auto-fill states with common values of selectedPeople if they are all the same
  useEffect(() => {
    if (selectedPeople.length > 0 && isOpen) {
      const getCommonValue = <K extends keyof Person>(key: K): Person[K] | '' => {
        const firstVal = selectedPeople[0][key];
        const allSame = selectedPeople.every(p => p[key] === firstVal);
        return allSame ? firstVal : '';
      };

      setNumOferta((getCommonValue('numOferta') as string) || '');
      setObra((getCommonValue('obra') as string) || '');
      
      const commonCat = (getCommonValue('categoria') as string) || '';
      if (commonCat === 'Peón' || commonCat === 'Oficial de 1ª') {
        setCategoria(commonCat);
        setIsManualCategory(false);
      } else if (commonCat) {
        setCategoria('Otro');
        setCustomCategory(commonCat);
        setIsManualCategory(true);
      } else {
        setCategoria('Peón');
        setIsManualCategory(false);
      }

      const commonQuincena = (getCommonValue('quincena') as string) || '';
      if (commonQuincena) {
        const parts = commonQuincena.split(' ');
        if (parts.length >= 3) {
          setQType(parts[0]);
          setQMonth(parts[1]);
          setQYear(parts[2]);
        }
      }

      setPeriodoInicio((getCommonValue('periodoInicio') as string) || '');
      setPeriodoFin((getCommonValue('periodoFin') as string) || '');

      const commonCalzado = (getCommonValue('calzado') as string) || '';
      if (commonCalzado === 'No' || commonCalzado === 'No necesita') {
        setCalzadoNecesita('No');
        setCalzadoTalla('');
      } else if (commonCalzado) {
        setCalzadoNecesita('Sí');
        setCalzadoTalla(commonCalzado);
      } else {
        setCalzadoNecesita('Sí');
        setCalzadoTalla('');
      }

      setFormacion((getCommonValue('formacion') as 'Sí' | 'No') || 'Sí');
      setLugarFormacion((getCommonValue('lugarFormacion') as string) || '');

      setNecesitaReconocimiento((getCommonValue('necesitaReconocimiento') as string) || (selectedPeople[0].citaDia || selectedPeople[0].sitioReconocimiento ? 'Sí' : 'No'));
      setCitaDia((getCommonValue('citaDia') as string) || '');
      setCitaHora((getCommonValue('citaHora') as string) || '');
      setSitioReconocimiento((getCommonValue('sitioReconocimiento') as string) || '');

      setDocumentacionCompleta((getCommonValue('documentacionCompleta') as 'Sí' | 'No') || 'Sí');
      setObservaciones((getCommonValue('observaciones') as string) || '');

      // Reset checked states
      setFieldsToUpdate({
        supervisorResponsable: true,
        numOferta: false,
        obra: false,
        categoria: false,
        quincena: false,
        periodoContrato: false,
        calzado: false,
        formacion: false,
        reconocimientoMedico: false,
        documentacionCompleta: false,
        observaciones: false,
      });
    }
  }, [selectedPeople, isOpen, supervisorName]);

  const cleanObras = useMemo(() => Array.from(new Set((savedObras || []).map(o => o.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedObras]);
  const cleanLugares = useMemo(() => Array.from(new Set((savedLugares || []).map(l => l.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedLugares]);
  const cleanSitios = useMemo(() => Array.from(new Set((savedSitios || []).map(s => s.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedSitios]);
  const cleanCategorias = useMemo(() => Array.from(new Set((savedCategorias || []).map(c => c.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedCategorias]);

  const isPeriodInvalid = useMemo(() => {
    if (!fieldsToUpdate.periodoContrato || !periodoInicio || !periodoFin) return false;
    return new Date(periodoFin) < new Date(periodoInicio);
  }, [fieldsToUpdate.periodoContrato, periodoInicio, periodoFin]);

  if (!isOpen) return null;

  const handleToggleField = (fieldName: string) => {
    setFieldsToUpdate(prev => ({ ...prev, [fieldName]: !prev[fieldName] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Check if at least one field is selected to be updated
    const selectedFieldsCount = Object.values(fieldsToUpdate).filter(Boolean).length;
    if (selectedFieldsCount === 0) {
      alert('⚠️ Debe seleccionar al menos un campo para actualizar masivamente.');
      return;
    }

    if (isPeriodInvalid) {
      alert('⚠️ La fecha de fin del contrato no puede ser anterior a la fecha de inicio.');
      return;
    }

    if (fieldsToUpdate.formacion && formacion === 'No' && !lugarFormacion) {
      alert('⚠️ Debe indicar el lugar donde realizará la formación');
      return;
    }

    // Prepare updates payload
    const updates: Partial<Person> = {};

    updates.supervisorResponsable = supervisorName;
    if (fieldsToUpdate.numOferta) {
      updates.numOferta = numOferta;
    }
    if (fieldsToUpdate.obra) {
      updates.obra = obra;
    }
    if (fieldsToUpdate.categoria) {
      updates.categoria = isManualCategory ? customCategory : categoria;
    }
    if (fieldsToUpdate.quincena) {
      updates.quincena = `${qType} ${qMonth} ${qYear}`;
    }
    if (fieldsToUpdate.periodoContrato) {
      updates.periodoInicio = periodoInicio;
      updates.periodoFin = periodoFin;
    }
    if (fieldsToUpdate.calzado) {
      updates.calzado = calzadoNecesita === 'No' ? 'No' : calzadoTalla;
    }
    if (fieldsToUpdate.formacion) {
      updates.formacion = formacion;
      updates.lugarFormacion = formacion === 'No' ? lugarFormacion : '';
    }
    if (fieldsToUpdate.reconocimientoMedico) {
      updates.necesitaReconocimiento = necesitaReconocimiento;
      if (necesitaReconocimiento === 'Sí') {
        updates.citaDia = citaDia;
        updates.citaHora = citaHora;
        updates.sitioReconocimiento = sitioReconocimiento;
      } else {
        updates.citaDia = '';
        updates.citaHora = '';
        updates.sitioReconocimiento = '';
      }
    }
    if (fieldsToUpdate.aptitudMedica) {
      updates.aptitudMedica = aptitudMedica;
      if (aptitudMedica === 'Apto con limitaciones') {
        updates.reconocimientoEstado = 'Apto con Limitación';
        updates.limitacionesAptitud = limitacionesAptitud;
        updates.reconocimientoLimitaciones = limitacionesAptitud;
      } else {
        updates.reconocimientoEstado = aptitudMedica as any;
        if (aptitudMedica !== 'Apto con limitaciones') {
          updates.limitacionesAptitud = '';
          updates.reconocimientoLimitaciones = '';
        }
      }
      if (validezAptitud) {
        updates.reconocimientoValidez = validezAptitud;
      }
    }
    if (fieldsToUpdate.documentacionCompleta) {
      updates.documentacionCompleta = documentacionCompleta;
    }
    if (fieldsToUpdate.observaciones) {
      updates.observaciones = observaciones;
    }

    const selectedIds = selectedPeople.map(p => p.id);
    onSave(updates, selectedIds);
  };

  const selectedFieldsCount = Object.values(fieldsToUpdate).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col border border-slate-200 dark:border-slate-800">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 md:p-8 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white/90 dark:bg-slate-900/95 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#00548E]/5 dark:bg-blue-500/10 rounded-xl">
              <Users className="w-5 h-5 text-[#00548E] dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tight">
                Edición Masiva de Trabajadores
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                {selectedPeople.length} trabajadores seleccionados. Activa la casilla de los campos que deseas modificar.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-8">
            
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wide">¡Atención!</h4>
                <p className="text-xs text-amber-700/80 dark:text-amber-500/80 mt-1 font-medium leading-relaxed">
                  Solo se sobrescribirán los campos que tengan activada la casilla de verificación (check izquierdo). Los campos desmarcados permanecerán intactos para cada trabajador.
                </p>
              </div>
            </div>

            {/* Field Options */}
            <div className="space-y-6">
              
              {/* 1. Supervisor */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.supervisorResponsable ? 'border-[#00548E] bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <div className="flex items-start gap-4">
                  <input 
                    type="checkbox"
                    id="chk_supervisor"
                    checked
                    disabled
                    aria-label="Supervisor asignado por la cuenta"
                    className="w-5 h-5 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-not-allowed"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <label htmlFor="chk_supervisor" className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                      Supervisor Responsable
                    </label>
                    {fieldsToUpdate.supervisorResponsable && (
                      <input
                        type="text"
                        value={supervisorName}
                        readOnly
                        aria-readonly="true"
                        required
                        placeholder="Nombre y apellidos de la cuenta"
                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] text-sm text-slate-800 dark:text-slate-100"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* 2. Contratación */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.obra || fieldsToUpdate.numOferta || fieldsToUpdate.categoria || fieldsToUpdate.quincena || fieldsToUpdate.periodoContrato ? 'border-brand-primary/40 bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <h3 className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4 flex items-center">
                  <Briefcase className="w-3.5 h-3.5 mr-2" /> Datos de Contratación
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Obra */}
                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox"
                      id="chk_obra"
                      checked={fieldsToUpdate.obra}
                      onChange={() => handleToggleField('obra')}
                      className="w-4 h-4 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                    />
                    <div className="flex-1 space-y-1.5">
                      <label htmlFor="chk_obra" className="text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                        Obra / Destino
                      </label>
                      {fieldsToUpdate.obra && (
                        <>
                          <input type="text" value={obra} onChange={(e) => setObra(e.target.value)} required={fieldsToUpdate.obra} list="bulkObrasList" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100" />
                          <datalist id="bulkObrasList">{cleanObras.map((o, i) => <option key={i} value={o} />)}</datalist>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Num Oferta */}
                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox"
                      id="chk_numOferta"
                      checked={fieldsToUpdate.numOferta}
                      onChange={() => handleToggleField('numOferta')}
                      className="w-4 h-4 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                    />
                    <div className="flex-1 space-y-1.5">
                      <label htmlFor="chk_numOferta" className="text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                        Número de Oferta
                      </label>
                      {fieldsToUpdate.numOferta && (
                        <input type="text" value={numOferta} onChange={(e) => setNumOferta(e.target.value)} required={fieldsToUpdate.numOferta} placeholder="Nº de oferta de empleo..." className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100" />
                      )}
                    </div>
                  </div>

                  {/* Categoria */}
                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox"
                      id="chk_categoria"
                      checked={fieldsToUpdate.categoria}
                      onChange={() => handleToggleField('categoria')}
                      className="w-4 h-4 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                    />
                    <div className="flex-1 space-y-1.5">
                      <label htmlFor="chk_categoria" className="text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                        Categoría Profesional
                      </label>
                      {fieldsToUpdate.categoria && (
                        <div className="flex flex-col gap-2">
                          <div className="flex p-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl gap-1">
                            {['Peón', 'Oficial de 1ª', 'Otro'].map((cat) => {
                              const isSelected = cat === 'Otro' ? isManualCategory : (!isManualCategory && categoria === cat);
                              return (
                                <button
                                  key={cat}
                                  type="button"
                                  onClick={() => {
                                    if (cat === 'Otro') {
                                      setIsManualCategory(true);
                                    } else {
                                      setIsManualCategory(false);
                                      setCategoria(cat);
                                    }
                                  }}
                                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                                    isSelected 
                                      ? 'bg-[#00548E] text-white shadow-sm' 
                                      : 'text-slate-500 hover:text-gray-600'
                                  }`}
                                >
                                  {cat}
                                </button>
                              );
                            })}
                          </div>
                          {isManualCategory && (
                            <input 
                              type="text" 
                              value={customCategory} 
                              onChange={(e) => setCustomCategory(e.target.value)} 
                              required={fieldsToUpdate.categoria && isManualCategory} 
                              list="bulkCategoriasList" 
                              placeholder="Especifique categoría..."
                              className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100" 
                            />
                          )}
                          <datalist id="bulkCategoriasList">
                            {cleanCategorias.filter(c => c !== 'Peón' && c !== 'Oficial de 1ª').map((cat, i) => <option key={i} value={cat} />)}
                          </datalist>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quincena */}
                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox"
                      id="chk_quincena"
                      checked={fieldsToUpdate.quincena}
                      onChange={() => handleToggleField('quincena')}
                      className="w-4 h-4 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                    />
                    <div className="flex-1 space-y-1.5">
                      <label htmlFor="chk_quincena" className="text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                        Quincena Asignada
                      </label>
                      {fieldsToUpdate.quincena && (
                        <div className="flex gap-1.5">
                          <select value={qType} onChange={(e) => setQType(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-bold text-slate-800 dark:text-slate-100">
                            <option value="1ª">1ª</option>
                            <option value="2ª">2ª</option>
                            <option value="Mes">Mes</option>
                          </select>
                          <select value={qMonth} onChange={(e) => setQMonth(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-bold text-slate-800 dark:text-slate-100">
                            {MONTHS.map(m => <option key={m} value={m}>{m.substring(0, 3)}</option>)}
                          </select>
                          <input type="number" value={qYear} onChange={(e) => setQYear(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-bold text-slate-800 dark:text-slate-100" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Periodo Contrato */}
                  <div className="flex items-start gap-3 md:col-span-2">
                    <input 
                      type="checkbox"
                      id="chk_periodo"
                      checked={fieldsToUpdate.periodoContrato}
                      onChange={() => handleToggleField('periodoContrato')}
                      className="w-4 h-4 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                    />
                    <div className="flex-1 space-y-1.5">
                      <label htmlFor="chk_periodo" className="text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                        Periodo de Contratación (Fechas de Inicio y Fin)
                      </label>
                      {fieldsToUpdate.periodoContrato && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Fecha de Inicio</span>
                            <input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} required={fieldsToUpdate.periodoContrato} className={`w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl text-sm text-slate-800 dark:text-slate-100 ${isPeriodInvalid ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'}`} />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Fecha de Fin</span>
                            <input type="date" value={periodoFin} onChange={(e) => setPeriodoFin(e.target.value)} required={fieldsToUpdate.periodoContrato} className={`w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl text-sm text-slate-800 dark:text-slate-100 ${isPeriodInvalid ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'}`} />
                          </div>
                        </div>
                      )}
                      {isPeriodInvalid && (
                        <p className="text-xs text-red-500 font-bold mt-1">La fecha de fin no puede ser anterior a la de inicio.</p>
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* 3. Talla de calzado */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.calzado ? 'border-brand-primary/45 bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <div className="flex items-start gap-4">
                  <input 
                    type="checkbox"
                    id="chk_calzado"
                    checked={fieldsToUpdate.calzado}
                    onChange={() => handleToggleField('calzado')}
                    className="w-5 h-5 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                  />
                  <div className="flex-1 space-y-2">
                    <label htmlFor="chk_calzado" className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                      Calzado de Seguridad (Talla)
                    </label>
                    {fieldsToUpdate.calzado && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <select 
                          value={calzadoNecesita} 
                          onChange={(e) => setCalzadoNecesita(e.target.value)}
                          className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100"
                        >
                          <option value="Sí">Sí necesita calzado</option>
                          <option value="No">No necesita calzado</option>
                        </select>
                        {calzadoNecesita === 'Sí' && (
                          <input 
                            type="text" 
                            value={calzadoTalla} 
                            onChange={(e) => setCalzadoTalla(e.target.value)}
                            required={fieldsToUpdate.calzado && calzadoNecesita === 'Sí'}
                            placeholder="Ej: 42, 43..."
                            className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. Formación */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.formacion ? 'border-[#00548E] bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <div className="flex items-start gap-4">
                  <input 
                    type="checkbox"
                    id="chk_formacion"
                    checked={fieldsToUpdate.formacion}
                    onChange={() => handleToggleField('formacion')}
                    className="w-5 h-5 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                  />
                  <div className="flex-1 space-y-2">
                    <label htmlFor="chk_formacion" className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                      <Award className="w-3.5 h-3.5 inline mr-1 text-[#00548E]" /> Formación PRL de 20 horas
                    </label>
                    {fieldsToUpdate.formacion && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <select 
                          value={formacion} 
                          onChange={(e) => setFormacion(e.target.value as 'Sí' | 'No')}
                          className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100"
                        >
                          <option value="Sí">Sí, dispone de formación</option>
                          <option value="No">No, requiere curso / formación</option>
                        </select>
                        {formacion === 'No' && (
                          <input 
                            type="text" 
                            value={lugarFormacion} 
                            onChange={(e) => setLugarFormacion(e.target.value)}
                            required={fieldsToUpdate.formacion && formacion === 'No'}
                            list="bulkLugaresList"
                            placeholder="Lugar de citación para el curso..."
                            className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100"
                          />
                        )}
                        <datalist id="bulkLugaresList">{cleanLugares.map((l, i) => <option key={i} value={l} />)}</datalist>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 5. Reconocimiento Médico */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.reconocimientoMedico ? 'border-[#00548E] bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <div className="flex items-start gap-4">
                  <input 
                    type="checkbox"
                    id="chk_rrmm"
                    checked={fieldsToUpdate.reconocimientoMedico}
                    onChange={() => handleToggleField('reconocimientoMedico')}
                    className="w-5 h-5 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                  />
                  <div className="flex-1 space-y-3">
                    <label htmlFor="chk_rrmm" className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                      Reconocimiento Médico de Vigilancia de la Salud
                    </label>
                    {fieldsToUpdate.reconocimientoMedico && (
                      <div className="space-y-4">
                        <select 
                          value={necesitaReconocimiento} 
                          onChange={(e) => setNecesitaReconocimiento(e.target.value)}
                          className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100"
                        >
                          <option value="Sí">Sí necesita reconocimiento médico</option>
                          <option value="No">No necesita reconocimiento médico</option>
                        </select>
                        
                        {necesitaReconocimiento === 'Sí' && (
                          <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <span className="text-[10px] font-bold text-slate-400">Día de la Cita</span>
                                <input type="date" value={citaDia} onChange={(e) => setCitaDia(e.target.value)} required={fieldsToUpdate.reconocimientoMedico && necesitaReconocimiento === 'Sí'} className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100" />
                              </div>
                              <div className="space-y-1">
                                <span className="text-[10px] font-bold text-slate-400">Hora de la Cita</span>
                                <input type="time" value={citaHora} onChange={(e) => setCitaHora(e.target.value)} required={fieldsToUpdate.reconocimientoMedico && necesitaReconocimiento === 'Sí'} className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100" />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-400">Centro o Dirección de Reconocimiento</span>
                              <input type="text" value={sitioReconocimiento} onChange={(e) => setSitioReconocimiento(e.target.value)} required={fieldsToUpdate.reconocimientoMedico && necesitaReconocimiento === 'Sí'} list="bulkSitiosList" placeholder="Ej: Clínica de Reconocimientos..." className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100" />
                              <datalist id="bulkSitiosList">{cleanSitios.map((s, i) => <option key={i} value={s} />)}</datalist>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 5.1 Aptitud Médica */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.aptitudMedica ? 'border-[#00548E] bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <div className="flex items-start gap-4">
                  <input 
                    type="checkbox"
                    id="chk_aptitud"
                    checked={fieldsToUpdate.aptitudMedica}
                    onChange={() => handleToggleField('aptitudMedica')}
                    className="w-5 h-5 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                  />
                  <div className="flex-1 space-y-3">
                    <label htmlFor="chk_aptitud" className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                      Aptitud Médica (Resultado de Vigilancia)
                    </label>
                    {fieldsToUpdate.aptitudMedica && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 mb-1">Estado de Aptitud</label>
                            <select 
                              value={aptitudMedica} 
                              onChange={(e) => setAptitudMedica(e.target.value as any)}
                              className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 font-semibold"
                            >
                              <option value="Apto">Apto</option>
                              <option value="Apto con limitaciones">Apto con limitaciones</option>
                              <option value="No Apto">No Apto</option>
                              <option value="Pendiente">Pendiente</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 mb-1">Año de Validez</label>
                            <input 
                              type="text" 
                              value={validezAptitud} 
                              onChange={(e) => setValidezAptitud(e.target.value)}
                              placeholder={new Date().getFullYear().toString()}
                              className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100"
                            />
                          </div>
                        </div>

                        {aptitudMedica === 'Apto con limitaciones' && (
                          <div className="space-y-1 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-xl">
                            <label className="block text-xs font-bold text-amber-800 dark:text-amber-300">
                              Descripción de Limitaciones Médicas
                            </label>
                            <textarea 
                              value={limitacionesAptitud} 
                              onChange={(e) => setLimitacionesAptitud(e.target.value)}
                              placeholder="Indique las limitaciones médicas asignadas (ej: Sin cargas >15kg, no trabajar en altura...)"
                              rows={2}
                              className="w-full p-2 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg text-xs text-slate-800 dark:text-slate-100"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 6. Documentación */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.documentacionCompleta ? 'border-[#00548E] bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <div className="flex items-start gap-4">
                  <input 
                    type="checkbox"
                    id="chk_docs"
                    checked={fieldsToUpdate.documentacionCompleta}
                    onChange={() => handleToggleField('documentacionCompleta')}
                    className="w-5 h-5 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                  />
                  <div className="flex-1 space-y-2">
                    <label htmlFor="chk_docs" className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                      Estado de Documentación / Expediente
                    </label>
                    {fieldsToUpdate.documentacionCompleta && (
                      <select 
                        value={documentacionCompleta} 
                        onChange={(e) => setDocumentacionCompleta(e.target.value as 'Sí' | 'No')}
                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100"
                      >
                        <option value="Sí">Sí - Todo entregado (Expediente completo)</option>
                        <option value="No">No - Falta documentación (Pendiente)</option>
                      </select>
                    )}
                  </div>
                </div>
              </div>

              {/* 7. Observaciones */}
              <div className={`p-5 rounded-2xl border transition-all ${fieldsToUpdate.observaciones ? 'border-[#00548E] bg-blue-50/5 dark:bg-blue-950/5' : 'border-slate-100 dark:border-slate-800'}`}>
                <div className="flex items-start gap-4">
                  <input 
                    type="checkbox"
                    id="chk_obs"
                    checked={fieldsToUpdate.observaciones}
                    onChange={() => handleToggleField('observaciones')}
                    className="w-5 h-5 mt-1 rounded border-slate-300 text-brand-primary accent-[#00548E] cursor-pointer"
                  />
                  <div className="flex-1 space-y-2">
                    <label htmlFor="chk_obs" className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                      Observaciones / Notas Adicionales
                    </label>
                    {fieldsToUpdate.observaciones && (
                      <textarea 
                        value={observaciones} 
                        onChange={(e) => setObservaciones(e.target.value)}
                        placeholder="Añada cualquier detalle o nota relevante en común..."
                        rows={3} 
                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm resize-none text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#00548E]" 
                      />
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Footer Buttons */}
            <div className="flex gap-4 pt-6 border-t border-gray-50 dark:border-slate-800">
              <button 
                type="button" 
                onClick={onClose} 
                className="flex-1 py-4 px-6 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-sm uppercase tracking-widest font-bold"
              >
                Cancelar
              </button>
              <button 
                type="submit" 
                disabled={selectedFieldsCount === 0}
                className={`flex-1 font-bold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest ${
                  selectedFieldsCount === 0 
                    ? 'bg-slate-100 dark:bg-slate-850 text-slate-400 border border-slate-200 dark:border-slate-800 cursor-not-allowed'
                    : 'bg-[#00548E] dark:bg-blue-600 text-white hover:bg-[#003B64] dark:hover:bg-blue-700 shadow-lg shadow-[#00548E]/10'
                }`}
              >
                <Save className="w-4 h-4" /> Actualizar {selectedPeople.length} Registros ({selectedFieldsCount} campos)
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
