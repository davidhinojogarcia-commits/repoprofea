import React, { useState, useEffect, useMemo } from 'react';
import { Save, X, User, Briefcase, MapPin, AlertCircle, FileText, Upload, Award, HardHat, CheckCircle2, UserCheck, Pencil, Activity, ShieldAlert } from 'lucide-react';
import { Person } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { formatIban, formatSpanishSocialSecurityNumber, validateIban, validateSpanishSocialSecurityNumber } from '../src/lib/personalDataValidators';

interface EditPersonModalProps {
  person: Person | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedPerson: Person) => void;
  savedObras: string[];
  savedLugares: string[];
  savedSitios: string[];
  savedTelefonos: string[];
  savedCategorias: string[];
  allPeople: Person[];
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const isValidDNI = (dni: string): boolean => {
  const validChars = 'TRWAGMYFPDXBNJZSQVHLCKET';
  const nifRexp = /^[0-9]{8}[TRWAGMYFPDXBNJZSQVHLCKET]$/i;
  const nieRexp = /^[XYZ][0-9]{7}[TRWAGMYFPDXBNJZSQVHLCKET]$/i;
  const str = dni.replace(/[\s-]/g, '').toUpperCase();
  if (!nifRexp.test(str) && !nieRexp.test(str)) return false;
  const nie = str.replace(/^[X]/, '0').replace(/^[Y]/, '1').replace(/^[Z]/, '2');
  const letter = str.substr(-1);
  const charIndex = parseInt(nie.substr(0, 8)) % 23;
  return validChars.charAt(charIndex) === letter;
};

const isValidPhone = (phone: string): boolean => {
  const cleanPhone = phone.replace(/\s/g, '');
  return /^[6789]\d{8}$/.test(cleanPhone);
};

export const EditPersonModal: React.FC<EditPersonModalProps> = ({
  person,
  isOpen,
  onClose,
  onSave,
  savedObras,
  savedLugares,
  savedSitios,
  savedTelefonos,
  savedCategorias,
  allPeople
}) => {
  const parsedQuincena = useMemo(() => {
    if (!person || !person.quincena) {
      return { qType: '1ª', qMonth: 'Enero', qYear: new Date().getFullYear().toString() };
    }
    const parts = person.quincena.split(' ');
    if (parts.length >= 3) {
      return { qType: parts[0], qMonth: parts[1], qYear: parts[2] };
    }
    return { qType: '1ª', qMonth: 'Enero', qYear: new Date().getFullYear().toString() };
  }, [person]);

  const [formData, setFormData] = useState<Person | null>(() => {
    if (!person) return null;
    const defaultNecesitaRec = person.necesitaReconocimiento || (person.citaDia || person.sitioReconocimiento ? 'Sí' : 'No');
    return {
      ...person,
      categoria: person.categoria || 'Peón',
      necesitaReconocimiento: defaultNecesitaRec
    };
  });
  const [qType, setQType] = useState(() => parsedQuincena.qType);
  const [qMonth, setQMonth] = useState(() => parsedQuincena.qMonth);
  const [qYear, setQYear] = useState(() => parsedQuincena.qYear);
  const [isManualCategory, setIsManualCategory] = useState(() => {
    if (!person) return false;
    const isPredefined = person.categoria === 'Peón' || person.categoria === 'Oficial de 1ª';
    return !isPredefined && !!person.categoria;
  });

  useEffect(() => {
    if (person) {
      const isPredefined = person.categoria === 'Peón' || person.categoria === 'Oficial de 1ª';
      setIsManualCategory(!isPredefined && !!person.categoria);
      const defaultNecesitaRec = person.necesitaReconocimiento || (person.citaDia || person.sitioReconocimiento ? 'Sí' : 'No');
      setFormData({
        ...person,
        categoria: person.categoria || 'Peón',
        necesitaReconocimiento: defaultNecesitaRec
      });
      if (person.quincena) {
        const parts = person.quincena.split(' ');
        if (parts.length >= 3) {
          setQType(parts[0]);
          setQMonth(parts[1]);
          setQYear(parts[2]);
        }
      }
    } else {
      setFormData(null);
    }
  }, [person]);

  useEffect(() => {
    if (formData) {
      setFormData(prev => prev ? ({ ...prev, quincena: `${qType} ${qMonth} ${qYear}` }) : null);
    }
  }, [qType, qMonth, qYear]);

  const cleanObras = useMemo(() => Array.from(new Set((savedObras || []).map(o => o.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedObras]);
  const cleanLugares = useMemo(() => Array.from(new Set((savedLugares || []).map(l => l.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedLugares]);
  const cleanSitios = useMemo(() => Array.from(new Set((savedSitios || []).map(s => s.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedSitios]);
  const cleanTelefonos = useMemo(() => Array.from(new Set((savedTelefonos || []).map(t => t.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedTelefonos]);
  const cleanCategorias = useMemo(() => Array.from(new Set((savedCategorias || []).map(c => c.trim()))).sort((a: string, b: string) => a.localeCompare(b)), [savedCategorias]);

  const isPeriodInvalid = useMemo(() => {
    if (!formData || !formData.periodoInicio || !formData.periodoFin) return false;
    return new Date(formData.periodoFin) < new Date(formData.periodoInicio);
  }, [formData?.periodoInicio, formData?.periodoFin]);

  const isDniRepeated = useMemo(() => {
    if (!formData || !formData.dni) return false;
    const cleanDni = formData.dni.replace(/[\s-]/g, '').toUpperCase();
    return allPeople.some(p => p.id !== person?.id && p.dni.replace(/[\s-]/g, '').toUpperCase() === cleanDni);
  }, [formData?.dni, allPeople, person?.id]);

  if (!isOpen || !formData) return null;

  const handleCategoryTab = (cat: string) => {
    if (cat === 'Otro') {
      setIsManualCategory(true);
      setFormData(prev => prev ? ({ ...prev, categoria: '' }) : null);
    } else {
      setIsManualCategory(false);
      setFormData(prev => prev ? ({ ...prev, categoria: cat }) : null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'telefono') {
      const filteredValue = value.replace(/[^0-9\s]/g, '');
      setFormData(prev => prev ? ({ ...prev, [name]: filteredValue }) : null);
      return;
    }
    if (name === 'numeroSeguridadSocial') {
      setFormData(prev => prev ? ({ ...prev, numeroSeguridadSocial: value.replace(/[^0-9\s\/-]/g, '') }) : null);
      return;
    }
    if (name === 'iban') {
      setFormData(prev => prev ? ({ ...prev, iban: value.toUpperCase().replace(/[^A-Z0-9\s]/g, '') }) : null);
      return;
    }
    if (name === 'reconocimientoEstado' && value === 'No Apto') {
      setFormData(prev => prev ? ({ ...prev, [name]: value, documentacionCompleta: 'No' }) : null);
      return;
    }
    setFormData(prev => prev ? ({ ...prev, [name]: value }) : null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.reconocimientoEstado === 'No Apto') {
      formData.documentacionCompleta = 'No';
    }
    if (formData.dni && !isValidDNI(formData.dni)) {
      alert('⚠️ El DNI/NIE introducido no es válido.');
      return;
    }
    if (formData.numeroSeguridadSocial) {
      const check = validateSpanishSocialSecurityNumber(formData.numeroSeguridadSocial);
      if (!check.valid) { alert(`⚠️ Número de la Seguridad Social no válido. ${check.error || ''}`); return; }
      formData.numeroSeguridadSocial = check.normalized;
      const currentDniForNuss = formData.dni.replace(/[\s-]/g, '').toUpperCase();
      const conflictingNuss = allPeople.some(p =>
        p.id !== formData.id &&
        p.numeroSeguridadSocial &&
        validateSpanishSocialSecurityNumber(p.numeroSeguridadSocial).normalized === check.normalized &&
        p.dni.replace(/[\s-]/g, '').toUpperCase() !== currentDniForNuss
      );
      if (conflictingNuss) { alert('⚠️ Este Número de la Seguridad Social ya está asociado a otro trabajador con un DNI/NIE distinto.'); return; }
    }
    if (formData.iban) {
      const check = validateIban(formData.iban);
      if (!check.valid) { alert(`⚠️ IBAN no válido. ${check.error || ''}`); return; }
      formData.iban = check.normalized;
    }
    // Un DNI repetido representa una nueva contratación del mismo trabajador.
    // No se bloquea el guardado; el historial y contador anual se gestionan por registro.
    if (isPeriodInvalid) {
      alert('⚠️ La fecha de fin del contrato no puede ser anterior a la fecha de inicio.');
      return;
    }
    if (formData.telefono && !isValidPhone(formData.telefono)) {
      alert('⚠️ El número de teléfono no es válido. Debe tener 9 dígitos y empezar por 6, 7, 8 o 9.');
      return;
    }
    if (formData.formacion === 'No' && !formData.lugarFormacion) {
      alert('⚠️ Debe indicar el lugar donde realizará la formación');
      return;
    }

    const finalData = { ...formData };
    if (finalData.necesitaReconocimiento === 'No') {
      finalData.citaDia = '';
      finalData.citaHora = '';
      finalData.sitioReconocimiento = '';
    }

    if (finalData.reconocimientoEstado) {
      if (finalData.reconocimientoEstado === 'Apto con Limitación' || finalData.reconocimientoEstado === 'Apto con limitaciones') {
        finalData.aptitudMedica = 'Apto con limitaciones';
        finalData.reconocimientoEstado = 'Apto con Limitación';
      } else {
        finalData.aptitudMedica = finalData.reconocimientoEstado as any;
      }
    } else {
      finalData.aptitudMedica = 'Pendiente';
    }

    if (finalData.reconocimientoLimitaciones !== undefined) {
      finalData.limitacionesAptitud = finalData.reconocimientoLimitaciones;
    }

    onSave(finalData);
  };

  const isDniInvalid = formData.dni.replace(/[\s-]/g, '').length >= 9 && !isValidDNI(formData.dni);
  const isDniValid = formData.dni.replace(/[\s-]/g, '').length >= 9 && isValidDNI(formData.dni);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col border border-slate-200 dark:border-slate-800">
        <div className="flex justify-between items-center p-6 md:p-8 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white/90 dark:bg-slate-900/95 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#00548E]/5 dark:bg-blue-500/10 rounded-xl">
              <Pencil className="w-5 h-5 text-[#00548E] dark:text-blue-400" />
            </div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tight truncate max-w-[300px] md:max-w-none">
              Editar: {formData.apellidosNombre}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-10">
            <div className="space-y-4">
              <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Supervisor Responsable <span className="text-red-500 ml-1">*</span>
              </label>
              <input type="text" name="supervisorResponsable" value={formData.supervisorResponsable} onChange={handleChange} required className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 focus:ring-4 focus:ring-[#00548E]/5 transition-all text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400" />
            </div>

            <div className="space-y-6">
              <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center"><Briefcase className="w-3 h-3 mr-2" /> Contratación</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Nº Oferta</label><input type="text" name="numOferta" value={formData.numOferta} onChange={handleChange} required className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100" /></div>
                <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Obra</label><input type="text" name="obra" value={formData.obra} onChange={handleChange} required list="obrasListEdit" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100" /><datalist id="obrasListEdit">{cleanObras.map((o, i) => <option key={i} value={o} />)}</datalist></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Categoría</label>
                  <div className="flex flex-col gap-2">
                    <div className="flex p-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl gap-1">
                      {['Peón', 'Oficial de 1ª', 'Otro'].map((cat) => {
                        const isSelected = cat === 'Otro' ? isManualCategory : (!isManualCategory && formData.categoria === cat);
                        return <button key={cat} type="button" onClick={() => handleCategoryTab(cat)} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${isSelected ? 'bg-[#00548E] dark:bg-blue-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200'}`}>{cat}</button>;
                      })}
                    </div>
                    {isManualCategory && <div className="animate-in fade-in slide-in-from-top-2 duration-200"><input type="text" name="categoria" value={formData.categoria} onChange={handleChange} required list="categoriasListEdit" placeholder="Especifique categoría..." className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100" /><datalist id="categoriasListEdit">{cleanCategorias.filter(c => c !== 'Peón' && c !== 'Oficial de 1ª').map((cat, i) => <option key={i} value={cat} />)}</datalist></div>}
                  </div>
                </div>
                <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Quincena</label><div className="flex gap-1.5"><select value={qType} onChange={(e) => setQType(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-[10px] font-bold text-slate-800 dark:text-slate-100"><option value="1ª">1ª</option><option value="2ª">2ª</option><option value="Mes">Mes</option></select><select value={qMonth} onChange={(e) => setQMonth(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-[10px] font-bold text-slate-800 dark:text-slate-100">{MONTHS.map(m => <option key={m} value={m}>{m.substring(0, 3)}</option>)}</select><input type="number" value={qYear} onChange={(e) => setQYear(e.target.value)} className="w-1/3 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-[10px] font-bold text-slate-800 dark:text-slate-100" /></div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Inicio</label><input type="date" name="periodoInicio" value={formData.periodoInicio} onChange={handleChange} required className={`w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:outline-none transition-all text-sm text-slate-800 dark:text-slate-200 ${isPeriodInvalid ? 'border-red-500 focus:border-red-500' : 'border-slate-200 dark:border-slate-700 focus:border-[#00548E] dark:focus:border-blue-500'}`} /></div><div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Fin</label><input type="date" name="periodoFin" value={formData.periodoFin} onChange={handleChange} required className={`w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:outline-none transition-all text-sm text-slate-800 dark:text-slate-200 ${isPeriodInvalid ? 'border-red-500 focus:border-red-500' : 'border-slate-200 dark:border-slate-700 focus:border-[#00548E] dark:focus:border-blue-500'}`} /></div></div>
              {isPeriodInvalid && <div className="flex items-center gap-1.5 text-xs text-red-600 font-semibold mt-1"><AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /><span>La fecha de fin de contrato no puede ser anterior a la fecha de inicio.</span></div>}
            </div>

            <div className="space-y-6">
              <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center"><User className="w-3 h-3 mr-2" /> Trabajador</h3>
              <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Apellidos y Nombre</label><input type="text" name="apellidosNombre" value={formData.apellidosNombre} onChange={handleChange} required className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm font-medium text-slate-800 dark:text-slate-100" /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">DNI/NIE</label>
                  <div className="relative"><input type="text" name="dni" value={formData.dni} onChange={handleChange} required className={`w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:outline-none transition-all text-sm text-slate-800 dark:text-slate-100 ${isDniInvalid ? 'border-red-500 focus:border-red-500' : isDniValid ? 'border-emerald-500 focus:border-emerald-500' : 'border-slate-200 dark:border-slate-700 focus:border-[#00548E] dark:focus:border-blue-500'}`} />{isDniValid && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />}</div>
                  {isDniRepeated && <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-semibold mt-1"><AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /><span>Trabajador repetidor: este DNI/NIE ya tiene contrataciones anteriores. Se guardará como una nueva contratación.</span></div>}
                </div>
                <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Nacimiento</label><input type="date" name="fechaNacimiento" value={formData.fechaNacimiento} onChange={handleChange} required className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100" /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Nº Seguridad Social <span className="text-[10px] font-normal text-slate-400">(opcional)</span></label>
                  <input type="text" name="numeroSeguridadSocial" value={formData.numeroSeguridadSocial || ''} onChange={handleChange} placeholder="11/12345678/90" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm font-mono text-slate-800 dark:text-slate-100" />
                  {formData.numeroSeguridadSocial && (() => { const check = validateSpanishSocialSecurityNumber(formData.numeroSeguridadSocial); return <p className={`text-[11px] font-semibold ${check.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{check.valid ? `✓ Número válido · ${formatSpanishSocialSecurityNumber(check.normalized)}` : `✕ ${check.error}`}</p>; })()}
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">IBAN / Cuenta bancaria <span className="text-[10px] font-normal text-slate-400">(opcional)</span></label>
                  <input type="text" name="iban" value={formData.iban || ''} onChange={handleChange} placeholder="ES00 0000 0000 0000 0000 0000" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm font-mono text-slate-800 dark:text-slate-100" />
                  {formData.iban && (() => { const check = validateIban(formData.iban); return <p className={`text-[11px] font-semibold ${check.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{check.valid ? `✓ IBAN válido · ${formatIban(check.normalized)}` : `✕ ${check.error}`}</p>; })()}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Teléfono</label><input type="tel" name="telefono" value={formData.telefono} onChange={handleChange} required list="telefonosListEdit" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100" /><datalist id="telefonosListEdit">{cleanTelefonos.map((t, i) => <option key={i} value={t} />)}</datalist></div>
                <div className="space-y-1.5"><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">¿Necesita Calzado?</label><select name="necesitaCalzado" value={formData.calzado === 'No' || formData.calzado === 'No necesita' ? 'No' : 'Sí'} onChange={(e) => { if (e.target.value === 'No') setFormData(prev => prev ? ({ ...prev, calzado: 'No' }) : null); else setFormData(prev => prev ? ({ ...prev, calzado: '' }) : null); }} required className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100"><option value="Sí">Sí</option><option value="No">No</option></select></div>{!(formData.calzado === 'No' || formData.calzado === 'No necesita') && <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Talla Calzado</label><input type="text" name="calzado" value={formData.calzado === 'No' ? '' : formData.calzado} onChange={handleChange} required placeholder="Ej: 42" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100" /></div>}</div></div>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center"><Award className="w-3 h-3 mr-2" /> Seguridad y Salud</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">¿Formación?</label><select name="formacion" value={formData.formacion} onChange={handleChange} required className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100"><option value="Sí">Sí</option><option value="No">No</option></select></div>{formData.formacion === 'No' && <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Lugar Formación</label><input type="text" name="lugarFormacion" value={formData.lugarFormacion || ''} onChange={handleChange} required list="lugaresListEdit" className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100" /><datalist id="lugaresListEdit">{cleanLugares.map((l, i) => <option key={i} value={l} />)}</datalist></div>}</div>
              <div className="space-y-4"><div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">¿Necesita reconocimiento médico?</label><select name="necesitaReconocimiento" value={formData.necesitaReconocimiento || 'Sí'} onChange={handleChange} required className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 transition-all text-sm text-slate-800 dark:text-slate-100"><option value="Sí">Sí</option><option value="No">No</option></select></div>
                {formData.necesitaReconocimiento === 'Sí' && <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in slide-in-from-top-2"><div className="flex items-center gap-2 mb-2"><AlertCircle className="w-3 h-3 text-[#00548E] dark:text-blue-400" /><span className="text-[10px] font-bold text-[#00548E] dark:text-blue-400 uppercase tracking-wider">Cita Reconocimiento</span></div><div className="grid grid-cols-2 gap-3"><input type="date" name="citaDia" value={formData.citaDia} onChange={handleChange} required className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100" /><input type="time" name="citaHora" value={formData.citaHora} onChange={handleChange} required className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100" /></div><input type="text" name="sitioReconocimiento" value={formData.sitioReconocimiento} onChange={handleChange} required list="sitiosListEdit" className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100" /><datalist id="sitiosListEdit">{cleanSitios.map((s, i) => <option key={i} value={s} />)}</datalist></div>}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" /><span className="text-[11px] font-bold text-[#00548E] dark:text-blue-400 uppercase tracking-wider">Aptitud Reconocimiento Médico</span></div></div><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="space-y-1"><label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Resultado / Aptitud</label><select name="reconocimientoEstado" value={formData.reconocimientoEstado || 'Pendiente'} onChange={handleChange} className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100 font-medium"><option value="Pendiente">Pendiente</option><option value="Apto">Apto</option><option value="Apto con Limitación">Apto con Limitación</option><option value="No Apto">No Apto</option></select></div><div className="space-y-1"><label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Año Validez</label><input type="text" name="reconocimientoValidez" value={formData.reconocimientoValidez || new Date().getFullYear().toString()} onChange={handleChange} className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100" /></div><div className="space-y-1"><label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Fecha Realización</label><input type="date" name="reconocimientoFecha" value={formData.reconocimientoFecha || ''} onChange={handleChange} className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100" /></div></div>{formData.reconocimientoEstado === 'Apto con Limitación' && <div className="space-y-1.5 p-3 rounded-xl bg-amber-500/10 border border-amber-300 dark:border-amber-700/50"><div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300"><ShieldAlert className="w-4 h-4" /><span>Limitaciones y Restricciones Médicas del Trabajador</span></div><textarea name="reconocimientoLimitaciones" value={formData.reconocimientoLimitaciones || ''} onChange={handleChange} rows={2} className="w-full p-2 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700/50 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100 resize-none font-medium" /></div>}<div className="space-y-1"><label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Observaciones o Anotaciones Médicas</label><input type="text" name="reconocimientoObservaciones" value={formData.reconocimientoObservaciones || ''} onChange={handleChange} className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100" /></div></div>
              </div>
            </div>

            <div className="space-y-4"><h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center"><FileText className="w-3 h-3 mr-2" /> Documentación</h3>{formData.reconocimientoEstado === 'No Apto' && <div className="p-3 bg-red-100/90 dark:bg-red-950/60 border border-red-300 dark:border-red-800 rounded-xl flex items-center gap-2.5 text-xs text-red-900 dark:text-red-200"><ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" /><span><strong>Bloqueo por Reconocimiento No Apto:</strong> la documentación se marca automáticamente en No.</span></div>}<select name="documentacionCompleta" value={formData.documentacionCompleta} onChange={handleChange} required className={`w-full p-3 border rounded-xl focus:outline-none transition-all text-sm font-medium ${formData.documentacionCompleta === 'No' ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900 text-red-600 dark:text-red-400' : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100'}`}><option value="Sí">Sí - Todo entregado</option><option value="No">No - Falta documentación</option></select></div>

            <div className={`space-y-2 p-4 rounded-2xl transition-all duration-300 border ${formData.documentacionCompleta === 'No' ? 'bg-red-500/5 border-red-200 dark:border-red-900/40' : 'bg-transparent border-transparent'}`}><div className="flex items-center justify-between"><label className={`block text-xs font-bold ${formData.documentacionCompleta === 'No' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>{formData.documentacionCompleta === 'No' ? 'Observaciones / Documentos Faltantes' : 'Observaciones Generales'}</label><span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">Opcional</span></div><textarea name="observaciones" value={formData.observaciones || ''} onChange={handleChange} rows={3} className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none transition-all text-sm resize-none text-slate-800 dark:text-slate-100" /><AnimatePresence>{formData.documentacionCompleta === 'No' && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden flex flex-wrap gap-1.5 pt-1.5">{['Falta DNI / NIE','Falta NUSS / S.S.','Falta Certif. Formación','Falta Cuenta Bancaria','Falta Firma Contrato','Pendiente Reconocimiento'].map((tag) => <button key={tag} type="button" onClick={() => { const current = formData.observaciones ? formData.observaciones.trim() : ''; if (!current.includes(tag)) setFormData(prev => prev ? ({ ...prev, observaciones: current + (current ? ', ' : '') + tag }) : null); }} className="px-2 py-1 bg-red-100 dark:bg-red-950/40 hover:bg-red-200 dark:hover:bg-red-900 text-red-700 dark:text-red-300 rounded-lg text-[10px] font-bold transition-all border border-red-200/50 dark:border-red-900/30">+ {tag}</button>)}</motion.div>}</AnimatePresence></div>

            <div className="flex gap-4 pt-6 border-t border-gray-50 dark:border-slate-800"><button type="button" onClick={onClose} className="flex-1 py-4 px-6 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-sm uppercase tracking-widest font-bold">Cancelar</button><button type="submit" className="flex-1 bg-[#00548E] dark:bg-blue-600 text-white font-bold py-4 px-6 rounded-2xl hover:bg-[#003B64] dark:hover:bg-blue-700 shadow-lg shadow-[#00548E]/10 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest"><Save className="w-4 h-4" /> Guardar</button></div>
          </form>
        </div>
      </div>
    </div>
  );
};
