import React, { useState, useMemo } from 'react';
import ModalPortal from './ModalPortal';
import { 
  SlidersHorizontal, X, Plus, Trash2, Edit3, Save, RotateCcw, 
  Search, ArrowUp, ArrowDown, Briefcase, Users, Truck, 
  Check, AlertTriangle, ShieldAlert, Sparkles, CheckCircle2,
  FileText, CornerDownRight, Layers
} from 'lucide-react';
import { SubcontrataDocItem, SubcontrataDocCategoria } from '../types';
import { 
  DEFAULT_SUBCONTRATA_CHECKLIST, 
  PRESET_FREQUENT_DOCS 
} from '../src/lib/subcontratasDefaults';

interface ChecklistConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTemplate: SubcontrataDocItem[];
  activeSubcontrataName?: string;
  totalSubcontratasCount?: number;
  onSaveTemplate: (
    newTemplate: SubcontrataDocItem[],
    applyToActive: boolean,
    applyToAll: boolean
  ) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export const ChecklistConfigModal: React.FC<ChecklistConfigModalProps> = ({
  isOpen,
  onClose,
  currentTemplate,
  activeSubcontrataName,
  totalSubcontratasCount = 1,
  onSaveTemplate,
  onToast
}) => {
  // Local editable template list
  const [items, setItems] = useState<SubcontrataDocItem[]>(() => {
    return currentTemplate && currentTemplate.length > 0
      ? currentTemplate.map(i => ({ ...i }))
      : DEFAULT_SUBCONTRATA_CHECKLIST.map(i => ({ ...i }));
  });

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'todos' | SubcontrataDocCategoria>('todos');
  const [obligationFilter, setObligationFilter] = useState<'todos' | 'obligatorios' | 'opcionales'>('todos');

  // Application target scopes
  const [applyToActive, setApplyToActive] = useState(true);
  const [applyToAll, setApplyToAll] = useState(false);

  // Form mode: 'none' | 'new' | 'edit'
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [formState, setFormState] = useState<{
    id: string;
    nombre: string;
    categoria: SubcontrataDocCategoria;
    obligatorio: boolean;
    normativa: string;
    descripcion: string;
  }>({
    id: '',
    nombre: '',
    categoria: 'empresa',
    obligatorio: true,
    normativa: '',
    descripcion: ''
  });

  // Open creation form
  const handleStartCreate = () => {
    setEditingItemId('__new__');
    setFormState({
      id: 'doc_' + Date.now(),
      nombre: '',
      categoria: 'empresa',
      obligatorio: true,
      normativa: '',
      descripcion: ''
    });
  };

  // Open edit form for existing item
  const handleStartEdit = (item: SubcontrataDocItem) => {
    setEditingItemId(item.id);
    setFormState({
      id: item.id,
      nombre: item.nombre,
      categoria: item.categoria,
      obligatorio: item.obligatorio,
      normativa: item.normativa,
      descripcion: item.descripcion
    });
  };

  const handleCancelForm = () => {
    setEditingItemId(null);
  };

  // Save new or edited item
  const handleSaveFormItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.nombre.trim()) {
      onToast('El nombre del documento es obligatorio.', 'error');
      return;
    }

    if (editingItemId === '__new__') {
      // Check duplicate ID
      const newId = formState.nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 30) || 'doc_' + Date.now();

      const newItem: SubcontrataDocItem = {
        id: items.some(i => i.id === newId) ? `${newId}_${Date.now().toString().slice(-4)}` : newId,
        nombre: formState.nombre.trim(),
        categoria: formState.categoria,
        obligatorio: formState.obligatorio,
        normativa: formState.normativa.trim() || 'Convenio / Normativa PRL aplicable',
        descripcion: formState.descripcion.trim() || 'Documento exigido para la acreditación CAE de la empresa.',
        estado: formState.categoria === 'maquinaria' && !formState.obligatorio ? 'no_aplica' : 'pendiente'
      };

      setItems(prev => [...prev, newItem]);
      onToast(`Documento "${newItem.nombre}" añadido al checklist.`, 'success');
    } else {
      setItems(prev => prev.map(item => {
        if (item.id !== editingItemId) return item;
        return {
          ...item,
          nombre: formState.nombre.trim(),
          categoria: formState.categoria,
          obligatorio: formState.obligatorio,
          normativa: formState.normativa.trim(),
          descripcion: formState.descripcion.trim()
        };
      }));
      onToast(`Documento "${formState.nombre}" actualizado.`, 'success');
    }

    setEditingItemId(null);
  };

  // Quick toggle mandatory status
  const handleToggleObligatorio = (id: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const nextObligatorio = !item.obligatorio;
      return {
        ...item,
        obligatorio: nextObligatorio
      };
    }));
  };

  // Quick add from frequent presets
  const handleAddPresetDoc = (preset: typeof PRESET_FREQUENT_DOCS[0]) => {
    if (items.some(i => i.id === preset.id || i.nombre.toLowerCase() === preset.nombre.toLowerCase())) {
      onToast(`El documento "${preset.nombre}" ya está en el checklist.`, 'error');
      return;
    }

    const newItem: SubcontrataDocItem = {
      ...preset,
      estado: preset.categoria === 'maquinaria' && !preset.obligatorio ? 'no_aplica' : 'pendiente'
    };

    setItems(prev => [...prev, newItem]);
    onToast(`"${preset.nombre}" añadido al checklist.`, 'success');
  };

  // Delete item
  const handleDeleteItem = (id: string, name: string) => {
    if (items.length <= 1) {
      onToast('Debe haber al menos un documento en el checklist legal.', 'error');
      return;
    }
    setItems(prev => prev.filter(i => i.id !== id));
    onToast(`Documento "${name}" eliminado del checklist.`, 'success');
    if (editingItemId === id) {
      setEditingItemId(null);
    }
  };

  // Move item up
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setItems(prev => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // Move item down
  const handleMoveDown = (index: number) => {
    if (index === items.length - 1) return;
    setItems(prev => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // Reset to default
  const handleResetDefaults = () => {
    if (window.confirm('¿Está seguro de que desea restablecer los documentos por defecto según la Ley 32/2006 y RD 1627/97? Se restaurarán los 16 requisitos originales.')) {
      setItems(DEFAULT_SUBCONTRATA_CHECKLIST.map(i => ({ ...i })));
      setEditingItemId(null);
      onToast('Checklist restablecido a los requisitos legales por defecto.', 'success');
    }
  };

  // Save changes
  const handleSaveAll = () => {
    if (items.length === 0) {
      onToast('El checklist no puede quedar vacío.', 'error');
      return;
    }
    const mandatoryCount = items.filter(i => i.obligatorio).length;
    if (mandatoryCount === 0) {
      onToast('Debe marcar al menos un documento como obligatorio.', 'error');
      return;
    }

    onSaveTemplate(items, applyToActive, applyToAll);
    onClose();
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (categoryFilter !== 'todos' && item.categoria !== categoryFilter) return false;
      if (obligationFilter === 'obligatorios' && !item.obligatorio) return false;
      if (obligationFilter === 'opcionales' && item.obligatorio) return false;
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = item.nombre.toLowerCase().includes(query);
        const matchesNorm = item.normativa.toLowerCase().includes(query);
        const matchesDesc = item.descripcion.toLowerCase().includes(query);
        if (!matchesName && !matchesNorm && !matchesDesc) return false;
      }
      return true;
    });
  }, [items, categoryFilter, obligationFilter, searchTerm]);

  // Statistics
  const totalCount = items.length;
  const mandatoryCount = items.filter(i => i.obligatorio).length;
  const optionalCount = totalCount - mandatoryCount;
  const empresaCount = items.filter(i => i.categoria === 'empresa').length;
  const personalCount = items.filter(i => i.categoria === 'trabajadores').length;
  const maquinariaCount = items.filter(i => i.categoria === 'maquinaria').length;

  if (!isOpen) return null;

  return (
    <ModalPortal label="ChecklistConfigModal"><div 
      id="modal-checklist-config"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-4xl w-full my-6 flex flex-col max-h-[92vh] overflow-hidden border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-xs border border-white/20">
              <SlidersHorizontal className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">
                  Configuración del Checklist Legal de Subcontratas
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-amber-400 text-slate-950 rounded-full">
                  CAE PROFEA
                </span>
              </div>
              <p className="text-xs text-blue-100/90 mt-0.5">
                Defina qué documentos son obligatorios para autorizar el acceso al centro de trabajo (Seguro RC, TC1, Certificados de estar al corriente, etc.).
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Counter Summary Pills */}
        <div className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-400">Requisitos Configurados:</span>
            <span className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-800 dark:text-slate-200 shadow-2xs">
              Total: {totalCount}
            </span>
            <span className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg font-black text-rose-700 dark:text-rose-300 shadow-2xs flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              {mandatoryCount} Obligatorios
            </span>
            <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-600 dark:text-slate-400">
              {optionalCount} Opcionales / Según tarea
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetDefaults}
              type="button"
              className="px-2.5 py-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
              title="Restaurar a los 16 documentos por defecto de la Ley 32/2006 y RD 1627/97"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restablecer Defectos</span>
            </button>
            <button
              onClick={handleStartCreate}
              type="button"
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-bold text-xs shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Añadir Documento</span>
            </button>
          </div>
        </div>

        {/* Quick Add Presets (e.g. TC1, TRC, Declaración no subcontratación en cadena) */}
        <div className="bg-blue-50/60 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900 px-5 py-2.5 text-xs flex flex-wrap items-center gap-2 shrink-0">
          <span className="font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            Añadir Frecuentes con 1 Clic:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESET_FREQUENT_DOCS.map(preset => {
              const alreadyExists = items.some(i => i.id === preset.id || i.nombre.toLowerCase() === preset.nombre.toLowerCase());
              return (
                <button
                  key={preset.id}
                  onClick={() => handleAddPresetDoc(preset)}
                  disabled={alreadyExists}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1 cursor-pointer ${
                    alreadyExists
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                      : 'bg-white dark:bg-slate-900 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100/70 dark:hover:bg-blue-900/40 hover:border-blue-300 dark:hover:border-blue-700'
                  }`}
                  title={alreadyExists ? 'Este documento ya está incluido' : `Añadir "${preset.nombre}"`}
                >
                  {alreadyExists ? <Check className="w-3 h-3 text-slate-400" /> : <Plus className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                  <span>{preset.nombre.split('/')[0].slice(0, 26)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Drawer / Accordion for creating or editing a single item */}
        {editingItemId && (
          <div className="bg-amber-50/80 dark:bg-amber-950/30 border-b-2 border-amber-300 dark:border-amber-700 p-5 shrink-0 animate-fadeIn">
            <form onSubmit={handleSaveFormItem} className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-amber-950 dark:text-amber-200 flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  <span>
                    {editingItemId === '__new__' ? 'Definir Nuevo Requisito Documental' : `Editando: ${formState.nombre}`}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="text-amber-800 dark:text-amber-300 hover:text-amber-950 dark:hover:text-amber-100 text-xs font-semibold"
                >
                  Cancelar
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
                <div className="sm:col-span-6">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Nombre Oficial del Documento <span className="text-rose-600 dark:text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: TC1 / Recibo RLC de Liquidación mensual"
                    value={formState.nombre}
                    onChange={e => setFormState(prev => ({ ...prev, nombre: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden font-medium"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Categoría CAE
                  </label>
                  <select
                    value={formState.categoria}
                    onChange={e => setFormState(prev => ({ ...prev, categoria: e.target.value as SubcontrataDocCategoria }))}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  >
                    <option value="empresa">1. Empresa Subcontratista</option>
                    <option value="trabajadores">2. Personal / Trabajadores</option>
                    <option value="maquinaria">3. Maquinaria y Equipos</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    ¿Es Obligatorio por Ley?
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setFormState(prev => ({ ...prev, obligatorio: !prev.obligatorio }))}
                      className={`w-full py-2 px-3 rounded-lg font-bold text-xs border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        formState.obligatorio
                          ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {formState.obligatorio ? (
                        <>
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>OBLIGATORIO</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5 text-slate-500" />
                          <span>OPCIONAL / SI APLICA</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="sm:col-span-6">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Normativa Legal de Referencia
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Art. 42 Estatuto de los Trabajadores / Ley 32/2006"
                    value={formState.normativa}
                    onChange={e => setFormState(prev => ({ ...prev, normativa: e.target.value }))}
                    className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div className="sm:col-span-6">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Criterios de Aceptación / Plazos de Caducidad
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Validez máxima de 3 meses, vigencia bancaria, sello..."
                    value={formState.descripcion}
                    onChange={e => setFormState(prev => ({ ...prev, descripcion: e.target.value }))}
                    className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editingItemId === '__new__' ? 'Guardar e Incorporar al Checklist' : 'Actualizar Documento'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Search & Filtering Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mr-1">Filtrar:</span>
            <button
              type="button"
              onClick={() => setCategoryFilter('todos')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                categoryFilter === 'todos' 
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Todos ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('empresa')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                categoryFilter === 'empresa' 
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Briefcase className="w-3 h-3" />
              Empresa ({empresaCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('trabajadores')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                categoryFilter === 'trabajadores' 
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Users className="w-3 h-3" />
              Personal ({personalCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('maquinaria')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                categoryFilter === 'maquinaria' 
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Truck className="w-3 h-3" />
              Maquinaria ({maquinariaCount})
            </button>

            <span className="text-slate-300 dark:text-slate-700 mx-1">|</span>

            <button
              type="button"
              onClick={() => setObligationFilter(obligationFilter === 'obligatorios' ? 'todos' : 'obligatorios')}
              className={`px-2 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                obligationFilter === 'obligatorios'
                  ? 'bg-rose-700 text-white'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              Solo Obligatorios ({mandatoryCount})
            </button>
          </div>

          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por nombre o normativa..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Checklist Document Items List */}
        <div className="p-5 overflow-y-auto space-y-2.5 flex-1 bg-slate-50/50 dark:bg-slate-950/50">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
              <FileText className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No se encontraron documentos con este filtro</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Pruebe a cambiar el término de búsqueda o seleccione "Todos".
              </p>
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const actualIndex = items.findIndex(i => i.id === item.id);
              const isEditing = editingItemId === item.id;

              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isEditing
                      ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/40 ring-2 ring-amber-300 dark:ring-amber-700'
                      : item.obligatorio
                      ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'
                      : 'bg-slate-50/80 dark:bg-slate-850 border-slate-200 dark:border-slate-800 opacity-90'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-mono font-bold text-slate-400 dark:text-slate-500">
                          #{actualIndex + 1}
                        </span>

                        {/* Category Badge */}
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider flex items-center gap-1 ${
                          item.categoria === 'empresa'
                            ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300'
                            : item.categoria === 'trabajadores'
                            ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-300'
                        }`}>
                          {item.categoria === 'empresa' ? <Briefcase className="w-3 h-3" /> :
                           item.categoria === 'trabajadores' ? <Users className="w-3 h-3" /> :
                           <Truck className="w-3 h-3" />}
                          {item.categoria}
                        </span>

                        {/* Interactive Obligatorio Switch */}
                        <button
                          type="button"
                          onClick={() => handleToggleObligatorio(item.id)}
                          className={`px-2 py-0.5 text-[10px] font-black rounded-md tracking-wider flex items-center gap-1 cursor-pointer transition-colors shadow-2xs ${
                            item.obligatorio
                              ? 'bg-rose-600 hover:bg-rose-700 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700'
                          }`}
                          title="Haga clic para alternar entre OBLIGATORIO y OPCIONAL"
                        >
                          {item.obligatorio ? (
                            <>
                              <ShieldAlert className="w-3 h-3" />
                              <span>OBLIGATORIO</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                              <span>OPCIONAL</span>
                            </>
                          )}
                        </button>

                        <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          {item.nombre}
                        </h4>
                      </div>

                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                        {item.descripcion}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                        ⚖️ {item.normativa}
                      </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                      {/* Move Up / Down */}
                      <button
                        type="button"
                        onClick={() => handleMoveUp(actualIndex)}
                        disabled={actualIndex === 0}
                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="Subir posición"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(actualIndex)}
                        disabled={actualIndex === items.length - 1}
                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="Bajar posición"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                      {/* Edit */}
                      <button
                        type="button"
                        onClick={() => handleStartEdit(item)}
                        className="px-2 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-md border border-blue-200 dark:border-blue-800 transition-colors flex items-center gap-1 cursor-pointer"
                        title="Editar nombre, normativa o descripción"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Editar</span>
                      </button>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id, item.nombre)}
                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded transition-colors"
                        title="Eliminar este requisito del checklist"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer & Propagation Options */}
        <div className="p-5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1.5">
              <span className="font-bold text-slate-700 dark:text-slate-300 block">
                Alcance de Aplicación de los Cambios:
              </span>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 dark:border-slate-700"
                  />
                  <span>
                    Guardar como <strong>plantilla predeterminada</strong> para nuevas subcontratas.
                  </span>
                </label>

                {activeSubcontrataName && (
                  <label className="flex items-center gap-2 cursor-pointer text-slate-800 dark:text-slate-200 font-semibold">
                    <input
                      type="checkbox"
                      checked={applyToActive}
                      onChange={e => setApplyToActive(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 dark:border-slate-700 focus:ring-blue-500 cursor-pointer"
                    />
                    <span>
                      Aplicar a la subcontrata activa (<strong>{activeSubcontrataName}</strong>)
                    </span>
                  </label>
                )}

                <label className="flex items-center gap-2 cursor-pointer text-indigo-900 dark:text-indigo-300 font-bold">
                  <input
                    type="checkbox"
                    checked={applyToAll}
                    onChange={e => setApplyToAll(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 dark:border-slate-700 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>
                    Sincronizar todas las subcontratas registradas ({totalSubcontratasCount})
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 shrink-0 pt-2 sm:pt-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-xl border border-slate-300 dark:border-slate-700 transition-colors text-xs cursor-pointer shadow-2xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveAll}
                className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl shadow-xs transition-colors text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>Guardar Configuración del Checklist</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div></ModalPortal>
  );
};