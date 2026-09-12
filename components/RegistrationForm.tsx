
import React, { useState, useEffect, useMemo } from 'react';
import { PlusCircle, FileText, User, Calendar, Briefcase, Phone, Ruler, Award, MapPin, AlertCircle, Upload, ArrowRight, CheckCircle2, HardHat, UserCheck, History, X } from 'lucide-react';
import { Person } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface RegistrationFormProps {
  onRegister: (person: Omit<Person, 'id' | 'fechaRegistro'>) => void;
  savedObras: string[];
  savedLugares: string[];
  savedSitios: string[];
  savedTelefonos: string[];
  savedCategorias: string[];
  people: Person[];
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKET';

export interface DniAnalysis {
  status: 'empty' | 'valid' | 'invalid_letter' | 'incomplete_letter' | 'invalid_format';
  expectedLetter: string | null;
  typedLetter: string | null;
  numberPart: string | null;
  docType: 'DNI' | 'NIE' | 'DESCONOCIDO';
}

export const analyzeDNI = (dni: string): DniAnalysis => {
  const clean = (dni || '').replace(/[\s-]/g, '').toUpperCase();
  if (!clean) {
    return { status: 'empty', expectedLetter: null, typedLetter: null, numberPart: null, docType: 'DESCONOCIDO' };
  }

  // NIE format: X/Y/Z + 7 numbers + letter
  const nieFullMatch = clean.match(/^([XYZ])(\d{7})([A-Z])?$/);
  // DNI format: 8 numbers + letter
  const nifFullMatch = clean.match(/^(\d{8})([A-Z])?$/);

  if (nifFullMatch) {
    const numbers = nifFullMatch[1];
    const letter = nifFullMatch[2] || null;
    const num = parseInt(numbers, 10);
    const expected = DNI_LETTERS.charAt(num % 23);

    if (!letter) {
      return { status: 'incomplete_letter', expectedLetter: expected, typedLetter: null, numberPart: numbers, docType: 'DNI' };
    }
    if (letter === expected) {
      return { status: 'valid', expectedLetter: expected, typedLetter: letter, numberPart: numbers, docType: 'DNI' };
    }
    return { status: 'invalid_letter', expectedLetter: expected, typedLetter: letter, numberPart: numbers, docType: 'DNI' };
  }

  if (nieFullMatch) {
    const prefixLetter = nieFullMatch[1];
    const numbers = nieFullMatch[2];
    const letter = nieFullMatch[3] || null;
    const prefixNum = prefixLetter === 'X' ? '0' : prefixLetter === 'Y' ? '1' : '2';
    const num = parseInt(prefixNum + numbers, 10);
    const expected = DNI_LETTERS.charAt(num % 23);

    if (!letter) {
      return { status: 'incomplete_letter', expectedLetter: expected, typedLetter: null, numberPart: `${prefixLetter}${numbers}`, docType: 'NIE' };
    }
    if (letter === expected) {
      return { status: 'valid', expectedLetter: expected, typedLetter: letter, numberPart: `${prefixLetter}${numbers}`, docType: 'NIE' };
    }
    return { status: 'invalid_letter', expectedLetter: expected, typedLetter: letter, numberPart: `${prefixLetter}${numbers}`, docType: 'NIE' };
  }

  return { status: 'invalid_format', expectedLetter: null, typedLetter: null, numberPart: null, docType: 'DESCONOCIDO' };
};

const isValidDNI = (dni: string): boolean => {
  return analyzeDNI(dni).status === 'valid';
};

const isValidPhone = (phone: string): boolean => {
  const cleanPhone = phone.replace(/\s/g, '');
  return /^[6789]\d{8}$/.test(cleanPhone);
};

export const RegistrationForm: React.FC<RegistrationFormProps> = ({ 
  onRegister, 
  savedObras, 
  savedLugares, 
  savedSitios,
  savedTelefonos,
  savedCategorias,
  people = []
}) => {
  const today = new Date();
  const defaultQType = today.getDate() <= 15 ? '1ª' : '2ª';
  const defaultQMonth = MONTHS[today.getMonth()];
  const defaultQYear = today.getFullYear().toString();

  const [formData, setFormData] = useState({
    supervisorResponsable: '',
    numOferta: '',
    obra: '',
    categoria: 'Peón',
    quincena: `${defaultQType} ${defaultQMonth} ${defaultQYear}`,
    periodoInicio: '',
    periodoFin: '',
    apellidosNombre: '',
    dni: '',
    fechaNacimiento: '',
    telefono: '',
    calzado: '',
    formacion: '',
    lugarFormacion: '',
    citaDia: '',
    citaHora: '',
    sitioReconocimiento: '',
    documentacionCompleta: '',
    observaciones: '',
    necesitaReconocimiento: 'Sí'
  });

  const [qType, setQType] = useState(defaultQType);
  const [qMonth, setQMonth] = useState(defaultQMonth);
  const [qYear, setQYear] = useState(defaultQYear);

  const [isManualCategory, setIsManualCategory] = useState(false);

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [matchedWorkerName, setMatchedWorkerName] = useState('');
  const [workerHistory, setWorkerHistory] = useState<Person[]>([]);
  const [isSameAnnualityActive, setIsSameAnnualityActive] = useState(false);
  const [isAutoFormedOnReturn, setIsAutoFormedOnReturn] = useState(false);

  const getContractYear = (p: Person): string => {
    if (p.periodoInicio) {
      const parts = p.periodoInicio.split('-');
      if (parts[0]) return parts[0];
    }
    if (p.quincena) {
      const parts = p.quincena.trim().split(/\s+/);
      const lastPart = parts[parts.length - 1];
      if (lastPart && /^\d{4}$/.test(lastPart)) return lastPart;
    }
    return '';
  };

  useEffect(() => {
    setFormData(prev => ({ ...prev, quincena: `${qType} ${qMonth} ${qYear}` }));
  }, [qType, qMonth, qYear]);

  useEffect(() => {
    const cleanDni = formData.dni.replace(/[\s-]/g, '').toUpperCase();
    if (cleanDni && people && people.length > 0) {
      const matchedContracts = people.filter(
        p => p.dni.replace(/[\s-]/g, '').toUpperCase() === cleanDni
      );
      if (matchedContracts.length > 0) {
        const hasSameAnnuality = matchedContracts.some(p => getContractYear(p) === qYear);
        setIsSameAnnualityActive(hasSameAnnuality);
        
        if (hasSameAnnuality) {
          setFormData(prev => ({
            ...prev,
            necesitaReconocimiento: 'No',
            calzado: 'No',
            citaDia: '',
            citaHora: '',
            sitioReconocimiento: ''
          }));
        }
      } else {
        setIsSameAnnualityActive(false);
      }
    } else {
      setIsSameAnnualityActive(false);
    }
  }, [formData.dni, qYear, people]);

  const handleCategoryTab = (cat: string) => {
    if (cat === 'Otro') {
      setIsManualCategory(true);
      setFormData(prev => ({ ...prev, categoria: '' }));
    } else {
      setIsManualCategory(false);
      setFormData(prev => ({ ...prev, categoria: cat }));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    // Validación en tiempo real para teléfono (solo números y espacios)
    if (name === 'telefono') {
      const filteredValue = value.replace(/[^0-9\s]/g, '');
      setFormData(prev => ({ ...prev, [name]: filteredValue }));
      return;
    }

    if (name === 'dni') {
      const cleanNewDni = value.replace(/[\s-]/g, '').toUpperCase();
      if (cleanNewDni) {
        const matchedContracts = (people || []).filter(
          p => p.dni.replace(/[\s-]/g, '').toUpperCase() === cleanNewDni
        );
        if (matchedContracts.length > 0) {
          const matchedPerson = matchedContracts[0];
          
          if (matchedPerson.categoria) {
            if (['Peón', 'Oficial de 1ª'].includes(matchedPerson.categoria)) {
              setIsManualCategory(false);
            } else {
              setIsManualCategory(true);
            }
          }
          
          const hasSameAnnuality = matchedContracts.some(p => getContractYear(p) === qYear);
          setIsSameAnnualityActive(hasSameAnnuality);

          // Si el trabajador ya fue registrado previamente sin formación ('No' o 'Sin formación'),
          // al volver a salir se registra automáticamente como YA FORMADO ('Sí').
          const hadNoFormacionInHistory = matchedContracts.some(
            p => p.formacion === 'No' || p.formacion === 'Sin formación' || !p.formacion
          );
          setIsAutoFormedOnReturn(hadNoFormacionInHistory);

          setFormData(prev => ({
            ...prev,
            dni: value,
            supervisorResponsable: matchedPerson.supervisorResponsable || prev.supervisorResponsable,
            // Keep contract specific details for the new contract
            numOferta: prev.numOferta,
            obra: prev.obra,
            quincena: prev.quincena,
            periodoInicio: prev.periodoInicio,
            periodoFin: prev.periodoFin,
            // Autocomplete personal info
            apellidosNombre: matchedPerson.apellidosNombre || prev.apellidosNombre,
            fechaNacimiento: matchedPerson.fechaNacimiento || prev.fechaNacimiento,
            telefono: matchedPerson.telefono || prev.telefono,
            categoria: matchedPerson.categoria || prev.categoria,
            formacion: hadNoFormacionInHistory ? 'Sí' : (matchedPerson.formacion || prev.formacion || 'Sí'),
            lugarFormacion: hadNoFormacionInHistory ? '' : (matchedPerson.lugarFormacion || prev.lugarFormacion),
            documentacionCompleta: matchedPerson.documentacionCompleta || prev.documentacionCompleta,
            observaciones: prev.observaciones,
            // Automatically select 'No' for medical checkup and footwear for repeated worker in same annuality
            necesitaReconocimiento: hasSameAnnuality ? 'No' : 'Sí',
            calzado: hasSameAnnuality ? 'No' : (matchedPerson.calzado && matchedPerson.calzado !== 'No' && matchedPerson.calzado !== 'No necesita' ? matchedPerson.calzado : ''),
            citaDia: '',
            citaHora: '',
            sitioReconocimiento: ''
          }));

          setMatchedWorkerName(matchedPerson.apellidosNombre);
          setWorkerHistory(matchedContracts);
          setShowHistoryModal(true);
          return;
        }
      }
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.dni || !formData.dni.trim()) {
      alert('⚠️ Por favor, introduzca el DNI/NIE del trabajador.');
      const inputEl = document.getElementById('dni-input');
      if (inputEl) inputEl.focus();
      return;
    }

    const dniCheck = analyzeDNI(formData.dni);
    if (dniCheck.status !== 'valid') {
      let msg = '⚠️ El DNI/NIE introducido no es válido.';
      if (dniCheck.status === 'invalid_letter') {
        msg = `⚠️ Letra de control del DNI/NIE incorrecta. Has introducido "${dniCheck.typedLetter}", pero para el número ${dniCheck.numberPart} corresponde la letra "${dniCheck.expectedLetter}".`;
      } else if (dniCheck.status === 'incomplete_letter') {
        msg = `⚠️ Falta la letra de control del DNI/NIE. Corresponde la letra "${dniCheck.expectedLetter}" (${dniCheck.numberPart}${dniCheck.expectedLetter}).`;
      } else if (dniCheck.status === 'invalid_format') {
        msg = '⚠️ Formato de DNI/NIE no válido. Debe tener 8 dígitos + letra (ej: 12345678Z) o X/Y/Z + 7 dígitos + letra (ej: X1234567L).';
      }
      alert(msg);
      const inputEl = document.getElementById('dni-input');
      if (inputEl) inputEl.focus();
      return;
    }
    if (isPeriodInvalid) {
      alert('⚠️ La fecha de fin del contrato no puede ser anterior a la fecha de inicio.');
      return;
    }
    if (formData.telefono && !isValidPhone(formData.telefono)) {
      alert('⚠️ El número de teléfono no es válido. Debe tener 9 dígitos y empezar por 6, 7, 8 o 9.');
      return;
    }
    if (!formData.categoria) {
      alert('⚠️ Debe indicar la categoría del trabajador');
      return;
    }
    if (formData.formacion === 'No' && !formData.lugarFormacion) {
      alert('⚠️ Debe indicar el lugar donde realizará la formación');
      return;
    }
    
    // Clean up fields if medical checkup is not needed
    const finalData = { ...formData };
    if (finalData.necesitaReconocimiento === 'No') {
      finalData.citaDia = '';
      finalData.citaHora = '';
      finalData.sitioReconocimiento = '';
    }

    onRegister(finalData);
    setFormData(prev => ({
      ...prev,
      apellidosNombre: '',
      dni: '',
      fechaNacimiento: '',
      telefono: '',
      calzado: '',
      formacion: '',
      lugarFormacion: '',
      documentacionCompleta: '', 
      observaciones: '',
      necesitaReconocimiento: 'Sí',
      citaDia: '',
      citaHora: '',
      sitioReconocimiento: ''
    }));
    const formTop = document.getElementById('form-container');
    if (formTop) formTop.scrollIntoView({ behavior: 'smooth' });
  };

  const dniAnalysis = useMemo(() => {
    return analyzeDNI(formData.dni);
  }, [formData.dni]);

  const isDniInvalid = dniAnalysis.status === 'invalid_letter' || (dniAnalysis.status === 'invalid_format' && formData.dni.replace(/[\s-]/g, '').length >= 8);
  const isDniValid = dniAnalysis.status === 'valid';
  const isDniDuplicated = useMemo(() => {
    const currentDni = formData.dni.replace(/[\s-]/g, '').toUpperCase();
    if (!currentDni) return false;
    return (people || []).some(p => p.dni.replace(/[\s-]/g, '').toUpperCase() === currentDni);
  }, [formData.dni, people]);

  const isPeriodInvalid = useMemo(() => {
    if (!formData.periodoInicio || !formData.periodoFin) return false;
    return new Date(formData.periodoFin) < new Date(formData.periodoInicio);
  }, [formData.periodoInicio, formData.periodoFin]);

  // Memorizar y limpiar listas para los datalists
  // Added explicit string typing to sort arguments to resolve localeCompare on unknown error
  const cleanObras = useMemo(() => Array.from(new Set((savedObras || []).map(o => o.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedObras]);
  const cleanLugares = useMemo(() => Array.from(new Set((savedLugares || []).map(l => l.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedLugares]);
  const cleanSitios = useMemo(() => Array.from(new Set((savedSitios || []).map(s => s.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedSitios]);
  const cleanTelefonos = useMemo(() => Array.from(new Set((savedTelefonos || []).map(t => t.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedTelefonos]);
  const cleanCategorias = useMemo(() => Array.from(new Set((savedCategorias || []).map(c => c.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedCategorias]);

  return (
    <div id="form-container" className="ui-surface p-5 sm:p-6 md:p-8 text-slate-800 dark:text-slate-100 h-fit">
      <div className="flex items-start gap-3 mb-7 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="p-2.5 bg-[var(--ui-gradient-brand)] rounded-xl text-white shadow-sm">
          <UserCheck className="w-5 h-5" />
        </div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--ui-brand-700)]">Operativa</div>
          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">Nueva contratación</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Alta de trabajador y datos necesarios para su incorporación PROFEA.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        
        {/* Sección Supervisor */}
        <div className="space-y-4">
          <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Supervisor Responsable <span className="text-red-500 ml-1">*</span>
          </label>
          <input
            type="text"
            name="supervisorResponsable"
            value={formData.supervisorResponsable}
            onChange={handleChange}
            required
            placeholder="Nombre completo del supervisor"
            className="w-full p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/5 transition-all text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400"
          />
        </div>

        {/* Sección Datos de Contratación */}
        <div className="space-y-6">
          <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center">
            <Briefcase className="w-3 h-3 mr-2 text-brand-primary dark:text-blue-400" /> Contratación
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Nº Oferta</label>
              <input type="text" name="numOferta" value={formData.numOferta} onChange={handleChange} required placeholder="OF-2026-XXX" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400" />
            </div>
             <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Obra</label>
              <input type="text" name="obra" value={formData.obra} onChange={handleChange} required list="obrasList" placeholder="Nombre de la obra" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400" />
              <datalist id="obrasList">{cleanObras.map((o, i) => <option key={i} value={o} />)}</datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="space-y-1.5">
               <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Categoría</label>
               <div className="flex flex-col gap-2">
                 <div className="flex p-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl gap-1">
                   {['Peón', 'Oficial de 1ª', 'Otro'].map((cat) => {
                     const isSelected = cat === 'Otro' ? isManualCategory : (!isManualCategory && formData.categoria === cat);
                     return (
                       <button
                         key={cat}
                         type="button"
                         onClick={() => handleCategoryTab(cat)}
                         className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                           isSelected 
                             ? 'bg-brand-primary text-white shadow-sm' 
                             : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                         }`}
                       >
                         {cat}
                       </button>
                     );
                   })}
                 </div>
                 
                 {isManualCategory && (
                   <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                     <input 
                       type="text" 
                       name="categoria" 
                       value={formData.categoria} 
                       onChange={handleChange} 
                       required 
                       list="categoriasList" 
                       placeholder="Especifique categoría..." 
                       className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400" 
                     />
                     <datalist id="categoriasList">
                       {cleanCategorias.filter(c => c !== 'Peón' && c !== 'Oficial de 1ª').map((cat, i) => <option key={i} value={cat} />)}
                     </datalist>
                   </div>
                 )}
               </div>
             </div>
             <div className="space-y-1.5">
               <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Quincena</label>
               <div className="flex gap-1.5">
                  <select value={qType} onChange={(e) => setQType(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-[10px] font-bold text-slate-800 dark:text-slate-100">
                    <option value="1ª" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">1ª</option>
                    <option value="2ª" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">2ª</option>
                    <option value="Mes" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Mes</option>
                  </select>
                  <select value={qMonth} onChange={(e) => setQMonth(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-[10px] font-bold text-slate-800 dark:text-slate-100">
                    {MONTHS.map(m => <option key={m} value={m} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">{m.substring(0, 3)}</option>)}
                  </select>
                  <input type="number" value={qYear} onChange={(e) => setQYear(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-[10px] font-bold text-slate-800 dark:text-slate-100" />
               </div>
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="space-y-1.5">
               <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Inicio</label>
               <input type="date" name="periodoInicio" value={formData.periodoInicio} onChange={handleChange} required className={`w-full p-2.5 rounded-xl focus:outline-none transition-all text-sm text-slate-800 dark:text-slate-200 ${isPeriodInvalid ? 'bg-red-50 dark:bg-red-950/20 border-2 border-red-500 dark:border-red-500 focus:border-red-500 text-red-900 dark:text-red-100' : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-brand-primary'}`} />
             </div>
             <div className="space-y-1.5">
               <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Fin</label>
               <input type="date" name="periodoFin" value={formData.periodoFin} onChange={handleChange} required className={`w-full p-2.5 rounded-xl focus:outline-none transition-all text-sm text-slate-800 dark:text-slate-200 ${isPeriodInvalid ? 'bg-red-50 dark:bg-red-950/20 border-2 border-red-500 dark:border-red-500 focus:border-red-500 text-red-900 dark:text-red-100' : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-brand-primary'}`} />
             </div>
          </div>
          {isPeriodInvalid && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-700 dark:text-red-400 font-semibold mt-1 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <span>La fecha de fin de contrato no puede ser anterior a la fecha de inicio.</span>
            </div>
          )}
        </div>

        {/* Datos del Trabajador */}
        <div className="space-y-6">
          <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center">
            <User className="w-3 h-3 mr-2 text-brand-primary dark:text-blue-400" /> Trabajador
          </h3>
          
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Apellidos y Nombre</label>
            <input type="text" name="apellidosNombre" value={formData.apellidosNombre} onChange={handleChange} required placeholder="García López, Juan" className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
                DNI / NIE <span className="text-red-500 ml-0.5">*</span>
              </label>
              <div className="relative">
                <input 
                  id="dni-input"
                  type="text" 
                  name="dni" 
                  value={formData.dni} 
                  onChange={handleChange} 
                  required 
                  placeholder="12345678A o X1234567L" 
                  className={`w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:outline-none transition-all text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 ${
                    dniAnalysis.status === 'valid' 
                      ? 'border-emerald-500 focus:border-emerald-500 ring-2 ring-emerald-500/15 bg-emerald-50/10 dark:bg-emerald-950/10' 
                      : isDniInvalid 
                      ? 'border-red-500 focus:border-red-500 ring-2 ring-red-500/15 bg-red-50/10 dark:bg-red-950/10' 
                      : dniAnalysis.status === 'incomplete_letter'
                      ? 'border-amber-400 focus:border-amber-400 ring-2 ring-amber-400/15 bg-amber-50/10 dark:bg-amber-950/10'
                      : 'border-slate-200 dark:border-slate-700 focus:border-brand-primary'
                  }`} 
                />
                
                {/* Status Indicator Icon */}
                {dniAnalysis.status === 'valid' && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500 animate-in zoom-in-50 duration-200" />
                )}
                {isDniInvalid && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500 animate-in zoom-in-50 duration-200" />
                )}
                {dniAnalysis.status === 'incomplete_letter' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-extrabold text-amber-700 bg-amber-100 dark:bg-amber-950/80 dark:text-amber-300 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700">
                    Falta: {dniAnalysis.expectedLetter}
                  </span>
                )}
              </div>

              {/* Real-time Validation Visual Alerts */}
              {dniAnalysis.status === 'valid' && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1 animate-in fade-in duration-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>{dniAnalysis.docType} Válido (Letra de control <strong>"{dniAnalysis.expectedLetter}"</strong> correcta)</span>
                </div>
              )}

              {dniAnalysis.status === 'incomplete_letter' && (
                <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/50 font-medium mt-1 animate-in fade-in duration-200">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Falta la letra de control.</span> Para <strong>{dniAnalysis.numberPart}</strong> corresponde la letra <strong className="underline font-black text-amber-900 dark:text-amber-100">{dniAnalysis.expectedLetter}</strong> (Ejemplo: <em>{dniAnalysis.numberPart}{dniAnalysis.expectedLetter}</em>).
                  </div>
                </div>
              )}

              {dniAnalysis.status === 'invalid_letter' && (
                <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-xl border border-red-200 dark:border-red-900/50 font-medium mt-1 animate-in fade-in duration-200">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Letra de control incorrecta.</span> Has introducido <strong>"{dniAnalysis.typedLetter}"</strong>, pero para el número <strong>{dniAnalysis.numberPart}</strong> corresponde la letra <strong className="underline font-black text-red-900 dark:text-red-100">{dniAnalysis.expectedLetter}</strong>.
                  </div>
                </div>
              )}

              {dniAnalysis.status === 'invalid_format' && formData.dni.replace(/[\s-]/g, '').length >= 8 && (
                <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-xl border border-red-200 dark:border-red-900/50 font-medium mt-1 animate-in fade-in duration-200">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Formato no válido.</span> Debe ser 8 dígitos + letra (DNI, ej: <em>12345678Z</em>) o X/Y/Z + 7 dígitos + letra (NIE, ej: <em>X1234567L</em>).
                  </div>
                </div>
              )}

              {/* Duplicate Warning & Autocomplete details */}
              {isDniDuplicated && (
                <div className="space-y-1.5 mt-2">
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/40 animate-in fade-in duration-200">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Este DNI ya está registrado en el sistema.</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-in fade-in duration-200 ml-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>Se han autocompletado los datos del trabajador (puedes editarlos libremente).</span>
                  </div>
                  {isSameAnnualityActive && (
                    <div className="flex items-start gap-2 p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 rounded-xl text-xs text-purple-700 dark:text-purple-300 font-semibold mt-2 animate-in fade-in duration-200">
                      <AlertCircle className="w-4 h-4 text-purple-500 shrink-0 mt-0.5 animate-pulse" />
                      <div>
                        <span className="font-bold uppercase tracking-wider block text-purple-800 dark:text-purple-200 text-[10px]">⚠️ REPETIDO EN LA MISMA ANUALIDAD ({qYear})</span>
                        <p className="font-normal text-[11px] mt-0.5">Este trabajador ya ha sido contratado este año. Por normativa, <span className="font-bold underline">NO necesita botas ni reconocimiento médico</span> (se han configurado automáticamente a "No").</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Nacimiento</label>
              <input type="date" name="fechaNacimiento" value={formData.fechaNacimiento} onChange={handleChange} required className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Teléfono</label>
              <input type="tel" name="telefono" value={formData.telefono} onChange={handleChange} required list="telefonosList" placeholder="600 000 000" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400" />
              <datalist id="telefonosList">{cleanTelefonos.map((t, i) => <option key={i} value={t} />)}</datalist>
            </div>
            
            <div className="space-y-1.5 col-span-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">¿Necesita Calzado?</label>
                  <select 
                    name="necesitaCalzado" 
                    value={formData.calzado === 'No' || formData.calzado === 'No necesita' ? 'No' : 'Sí'} 
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'No') {
                        setFormData(prev => ({ ...prev, calzado: 'No' }));
                      } else {
                        setFormData(prev => ({ ...prev, calzado: '' }));
                      }
                    }} 
                    required 
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100"
                  >
                    <option value="Sí" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Sí</option>
                    <option value="No" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">No</option>
                  </select>
                </div>
                
                {!(formData.calzado === 'No' || formData.calzado === 'No necesita') && (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Talla Calzado</label>
                    <input 
                      type="text" 
                      name="calzado" 
                      value={formData.calzado === 'No' ? '' : formData.calzado} 
                      onChange={handleChange} 
                      required={!(formData.calzado === 'No' || formData.calzado === 'No necesita')} 
                      placeholder="Ej: 42" 
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400" 
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Formación y Reconocimiento */}
        <div className="space-y-6">
          <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center">
            <Award className="w-3 h-3 mr-2 text-brand-primary dark:text-blue-400" /> Seguridad y Salud
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">¿Formación?</label>
              <select name="formacion" value={formData.formacion} onChange={handleChange} required className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100">
                <option value="" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Seleccione...</option>
                <option value="Sí" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Sí</option>
                <option value="No" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">No</option>
              </select>
            </div>
            {formData.formacion === 'No' && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Lugar Formación</label>
                <input type="text" name="lugarFormacion" value={formData.lugarFormacion} onChange={handleChange} required list="lugaresList" placeholder="Centro de formación" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400" />
                <datalist id="lugaresList">{cleanLugares.map((l, i) => <option key={i} value={l} />)}</datalist>
              </div>
            )}
          </div>

          {isAutoFormedOnReturn && (
            <div className="flex items-start gap-2.5 p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 font-medium animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-emerald-900 dark:text-emerald-200 uppercase tracking-wider block text-[10px]">✨ Formación Actualizada Automáticamente</span>
                <p className="mt-0.5 text-[11px]">Trabajador registrado previamente sin formación: al re-incorporarse se registra automáticamente como <strong>YA FORMADO (Sí)</strong>.</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">¿Necesita reconocimiento médico?</label>
              <select 
                name="necesitaReconocimiento" 
                value={formData.necesitaReconocimiento} 
                onChange={handleChange} 
                required 
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary transition-all text-sm text-slate-800 dark:text-slate-100"
              >
                <option value="Sí" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Sí</option>
                <option value="No" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">No</option>
              </select>
            </div>

            {formData.necesitaReconocimiento === 'Sí' && (
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-3 h-3 text-brand-primary dark:text-blue-400" />
                  <span className="text-[10px] font-bold text-brand-primary dark:text-blue-400 uppercase tracking-wider">Cita Reconocimiento</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="date" name="citaDia" value={formData.citaDia} onChange={handleChange} required={formData.necesitaReconocimiento === 'Sí'} className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100" />
                  <input type="time" name="citaHora" value={formData.citaHora} onChange={handleChange} required={formData.necesitaReconocimiento === 'Sí'} className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100" />
                </div>
                <input type="text" name="sitioReconocimiento" value={formData.sitioReconocimiento} onChange={handleChange} required={formData.necesitaReconocimiento === 'Sí'} list="sitiosList" placeholder="Centro médico" className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400" />
                <datalist id="sitiosList">{cleanSitios.map((s, i) => <option key={i} value={s} />)}</datalist>
              </div>
            )}
          </div>
        </div>

        {/* Documentación */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center">
            <FileText className="w-3 h-3 mr-2 text-brand-primary dark:text-blue-400" /> Documentación
          </h3>
          <select name="documentacionCompleta" value={formData.documentacionCompleta} onChange={handleChange} required className={`w-full p-3 border rounded-xl focus:outline-none transition-all text-sm font-medium ${formData.documentacionCompleta === 'No' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400' : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100'}`}>
            <option value="" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">¿Documentación completa?</option>
            <option value="Sí" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Sí - Todo entregado</option>
            <option value="No" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">No - Falta documentación</option>
          </select>

          {/* Observaciones siempre visibles al final, adaptando su estilo */}
          <div className={`space-y-2 p-4 rounded-2xl transition-all duration-300 border ${formData.documentacionCompleta === 'No' ? 'bg-red-500/5 border-red-200 dark:border-red-900/40' : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}>
            <div className="flex items-center justify-between">
              <label className={`block text-xs font-bold ${formData.documentacionCompleta === 'No' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {formData.documentacionCompleta === 'No' ? 'Observaciones / Documentos Faltantes' : 'Observaciones Generales'}
              </label>
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                Opcional
              </span>
            </div>
            <textarea
              name="observaciones"
              value={formData.observaciones}
              onChange={handleChange}
              placeholder={formData.documentacionCompleta === 'No' ? 'Ej: Falta DNI en vigor, pendiente certificado de formación...' : 'Añada cualquier detalle relevante...'}
              rows={3}
              className={`w-full p-3 bg-white dark:bg-slate-900 border rounded-xl focus:outline-none transition-all text-sm resize-none custom-scrollbar text-slate-800 dark:text-slate-100 ${formData.documentacionCompleta === 'No' ? 'border-red-200 dark:border-red-900/40 focus:ring-1 focus:ring-red-500/50' : 'border-slate-200 dark:border-slate-700 focus:border-brand-primary'}`}
            />
            
            <AnimatePresence>
              {formData.documentacionCompleta === 'No' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden flex flex-wrap gap-1.5 pt-1.5"
                >
                  {[
                    'Falta DNI / NIE',
                    'Falta NUSS / S.S.',
                    'Falta Certif. Formación',
                    'Falta Cuenta Bancaria',
                    'Falta Firma Contrato',
                    'Pendiente Reconocimiento'
                  ].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const current = formData.observaciones ? formData.observaciones.trim() : '';
                        if (!current.includes(tag)) {
                          const separator = current ? ', ' : '';
                          setFormData(prev => ({
                            ...prev,
                            observaciones: current + separator + tag
                          }));
                        }
                      }}
                      className="px-2 py-1 bg-red-100 dark:bg-red-950/40 hover:bg-red-200 dark:hover:bg-red-900 text-red-700 dark:text-red-300 rounded-lg text-[10px] font-bold transition-all border border-red-200/50 dark:border-red-900/30 active:scale-95 cursor-pointer"
                    >
                      + {tag}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <button 
          type="submit" 
          disabled={isPeriodInvalid}
          className={`w-full font-bold py-4 px-6 rounded-2xl transition-all duration-300 flex items-center justify-center gap-2 text-sm uppercase tracking-widest ${
            isPeriodInvalid 
              ? 'bg-red-50 dark:bg-red-950/20 text-red-400 dark:text-red-600 border border-red-200 dark:border-red-900/50 cursor-not-allowed opacity-70' 
              : 'bg-brand-primary text-white hover:bg-brand-secondary hover:shadow-lg hover:shadow-brand-primary/20'
          }`}
        >
          {isPeriodInvalid ? '⚠️ Corregir Fechas De Contrato' : 'Registrar Persona'} <ArrowRight className="w-4 h-4" />
        </button>

      </form>

      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header banner */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-800 p-6 text-white relative">
              <button 
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="absolute top-4 right-4 text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white/15 rounded-2xl">
                  <History className="w-6 h-6 text-white animate-pulse" />
                </div>
                <div>
                  <h4 className="text-base font-bold uppercase tracking-wide">¡Contratación Anterior Detectada!</h4>
                  <p className="text-xs text-white/85 w-fit">El trabajador ya cuenta con historial en el sistema</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Worker info card */}
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 flex items-start gap-3.5">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl mt-0.5">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h5 className="font-bold text-slate-950 dark:text-white text-sm">{matchedWorkerName}</h5>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300">
                      NIF/DNI: {formData.dni}
                    </span>
                  </div>
                </div>
              </div>

              {/* Contracting history timeline */}
              <div className="space-y-3">
                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  CONTRATOS ANTERIORES REGISTRADOS ({workerHistory.length})
                </div>
                
                <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2.5 custom-scrollbar">
                  {workerHistory.map((contract, i) => (
                    <div 
                      key={`reg_hist_${contract.id || ''}_${i}`}
                      className="group p-3 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-100 dark:border-slate-800/60 rounded-2xl flex items-start gap-3 transition-colors shadow-sm"
                    >
                      <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg mt-0.5 shrink-0">
                        <Briefcase className="w-3.5 h-3.5" />
                      </div>
                      <div className="space-y-1.5 w-full minimal-grid">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 line-clamp-1">{contract.obra}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded shrink-0">
                            {contract.quincena}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">{contract.categoria}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[9px]">
                            <Calendar className="w-3 h-3 text-slate-400 mr-0.5" />
                            <span>
                              {contract.periodoInicio ? contract.periodoInicio.split('-').reverse().join('/') : '-'} 
                              {' '}al{' '} 
                              {contract.periodoFin ? contract.periodoFin.split('-').reverse().join('/') : '-'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notice text */}
              {isSameAnnualityActive ? (
                <div className="p-4 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 rounded-2xl text-[11px] text-purple-700 dark:text-purple-300 flex items-start gap-3 leading-relaxed shadow-sm">
                  <AlertCircle className="w-5 h-5 text-purple-500 shrink-0 mt-0.5 animate-bounce" />
                  <div>
                    <span className="font-bold text-xs block mb-1 text-purple-800 dark:text-purple-200">⚠️ REPETIDO EN LA MISMA ANUALIDAD ({qYear})</span>
                    Este trabajador ya cuenta con un contrato registrado en la misma anualidad (<span className="font-bold">{qYear}</span>). Por normativa, <span className="font-bold underline">NO necesita botas nuevas ni reconocimiento médico</span>. Se han configurado estas opciones automáticamente a "No".
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-2.5 leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    Los datos del trabajador se han <strong>autocompletado</strong> para agilizar el registro. Puedes alterarlos o corregirlos manualmente a continuación.
                  </span>
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="w-full sm:w-auto bg-brand-primary hover:bg-brand-secondary text-white font-semibold text-xs uppercase tracking-wider py-3 px-5 rounded-xl transition-all shadow-md shadow-brand-primary/10 flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" /> Entendido, Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
