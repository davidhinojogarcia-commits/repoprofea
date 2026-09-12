import React, { useState } from 'react';
import { DeletedPerson } from '../types';
import { Trash2, RotateCcw, Search, AlertTriangle, Calendar, User, MapPin, HardHat, Info, ShieldAlert } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import { PageHeader } from './ui/PageHeader';

interface PapeleraProps {
  deletedPeople: DeletedPerson[];
  onRestore: (id: number) => void;
  onPermanentDelete: (id: number) => void;
  onEmptyTrash: () => void;
}

export const Papelera: React.FC<PapeleraProps> = ({
  deletedPeople,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);

  const emptyTrashFast = async () => {
    if (emptyingTrash) return;
    setEmptyingTrash(true);
    try {
      await supabase.rpc('empty_trash_bulk');
      setConfirmEmptyOpen(false);
      // La suscripción del padre relee Supabase cada pocos segundos y actualizará la lista.
    } catch (error) {
      console.error('Error vaciando la papelera en bloque:', error);
      // Compatibilidad/fallback: si el RPC no estuviera disponible en un despliegue antiguo,
      // mantenemos el comportamiento previo en vez de dejar la acción inservible.
      try {
        await Promise.resolve(onEmptyTrash());
        setConfirmEmptyOpen(false);
      } catch (fallbackError) {
        console.error('Error vaciando la papelera con el método de compatibilidad:', fallbackError);
        window.alert('No se pudo vaciar la papelera. Inténtalo de nuevo.');
      }
    } finally {
      setEmptyingTrash(false);
    }
  };

  // Helper to calculate days remaining
  const getDaysRemaining = (fechaEliminacion: string) => {
    const deletionDate = new Date(fechaEliminacion);
    const currentDate = new Date();
    const diffTime = currentDate.getTime() - deletionDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const daysLeft = 30 - diffDays;
    return daysLeft > 0 ? daysLeft : 0;
  };

  // Format date helper
  const formatDateString = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Filter deleted people
  const filteredPeople = deletedPeople.filter(dp => {
    const term = searchTerm.toLowerCase();
    const person = dp.person;
    return (
      person.apellidosNombre.toLowerCase().includes(term) ||
      person.dni.toLowerCase().includes(term) ||
      person.obra.toLowerCase().includes(term) ||
      (person.categoria && person.categoria.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-6" id="papelera-view">
      <PageHeader
        eyebrow="Sistema"
        title="Papelera"
        description="Los registros eliminados permanecen disponibles para restauración durante 30 días antes de su eliminación definitiva."
        icon={<Trash2 className="w-5 h-5" />}
        actions={deletedPeople.length > 0 ? (
          <button
            onClick={() => setConfirmEmptyOpen(true)}
            disabled={emptyingTrash}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
            title="Vaciar papelera permanentemente"
          >
            <Trash2 className="w-4 h-4" />
            {emptyingTrash ? 'Vaciando…' : 'Vaciar Papelera'}
          </button>
        ) : undefined}
      />

      {/* Control Bar: Search and Stats */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search className="h-4.5 w-4.5 text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Buscar en la papelera por nombre, DNI, obra..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="ui-field pl-10 pr-4 py-2.5 text-sm"
          />
        </div>
        
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
          Registros en papelera: <span className="text-slate-800 dark:text-slate-200 font-bold">{deletedPeople.length}</span>
          {searchTerm && (
            <> | Coincidentes: <span className="text-brand-primary dark:text-blue-400 font-bold">{filteredPeople.length}</span></>
          )}
        </div>
      </div>

      {/* Items Section */}
      {filteredPeople.length === 0 ? (
        <div className="ui-surface p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
            {deletedPeople.length === 0 ? 'La papelera está vacía' : 'No se encontraron resultados'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
            {deletedPeople.length === 0
              ? 'Todos tus registros activos están seguros en el directorio general.'
              : 'Prueba a cambiar el término de búsqueda para localizar el registro eliminado.'}
          </p>
        </div>
      ) : (
        <div className="ui-surface overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Trabajador</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Obra / Categoría</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fecha Eliminación</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Permanencia</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredPeople.map((dp, idx) => {
                  const daysLeft = getDaysRemaining(dp.fechaEliminacion);
                  const isWarning = daysLeft <= 7;
                  
                  return (
                    <tr key={`del_${dp.person.id}_${idx}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                      <td className="px-6 py-4.5">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
                            <User className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-800 dark:text-slate-100">{dp.person.apellidosNombre}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{dp.person.dni}</div>
                          </div>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            <span>{dp.person.obra}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <HardHat className="w-3.5 h-3.5 text-slate-400" />
                            <span>{dp.person.categoria}</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4.5">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatDateString(dp.fechaEliminacion)}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4.5">
                        <div>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${
                            isWarning 
                              ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50' 
                              : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40'
                          }`}>
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Quedan {daysLeft} {daysLeft === 1 ? 'día' : 'días'}</span>
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => onRestore(dp.person.id)}
                            className="p-2 text-slate-600 hover:text-green-600 hover:bg-green-50 dark:text-slate-400 dark:hover:text-green-400 dark:hover:bg-green-950/20 rounded-xl transition-all border border-transparent hover:border-green-200/50 dark:hover:border-green-900/30 cursor-pointer"
                            title="Restaurar este registro al directorio general"
                          >
                            <RotateCcw className="w-4.5 h-4.5" />
                          </button>
                          <button
                            onClick={() => onPermanentDelete(dp.person.id)}
                            className="p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-950/20 rounded-xl transition-all border border-transparent hover:border-red-200/50 dark:hover:border-red-900/30 cursor-pointer"
                            title="Eliminar permanentemente de forma definitiva"
                          >
                            <Trash2 className="w-4.5 h-4.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Layout */}
          <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800/60">
            {filteredPeople.map((dp, idx) => {
              const daysLeft = getDaysRemaining(dp.fechaEliminacion);
              const isWarning = daysLeft <= 7;
              
              return (
                <div key={`del_mob_${dp.person.id}_${idx}`} className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
                        <User className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 dark:text-slate-100">{dp.person.apellidosNombre}</h4>
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{dp.person.dni}</span>
                      </div>
                    </div>
                    
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                      isWarning 
                        ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50' 
                        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40'
                    }`}>
                      <span>{daysLeft} d</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200/40 dark:border-slate-700/30">
                    <div className="space-y-0.5">
                      <span className="text-slate-400 dark:text-slate-500 font-medium">Obra</span>
                      <div className="text-slate-700 dark:text-slate-300 font-semibold truncate">{dp.person.obra}</div>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-slate-400 dark:text-slate-500 font-medium">Categoría</span>
                      <div className="text-slate-700 dark:text-slate-300 font-semibold truncate">{dp.person.categoria}</div>
                    </div>
                    <div className="space-y-0.5 col-span-2 mt-1.5 border-t border-slate-200/50 dark:border-slate-700/50 pt-1.5">
                      <span className="text-slate-400 dark:text-slate-500 font-medium">Fecha Eliminación</span>
                      <div className="text-slate-700 dark:text-slate-300 font-semibold">{formatDateString(dp.fechaEliminacion)}</div>
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-1">
                    <button
                      onClick={() => onRestore(dp.person.id)}
                      className="flex-1 py-2 bg-slate-100 hover:bg-green-50 dark:bg-slate-800 dark:hover:bg-green-950/30 hover:text-green-600 dark:hover:text-green-400 border border-slate-200 dark:border-slate-700 hover:border-green-200/50 dark:hover:border-green-900/30 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Restaurar
                    </button>
                    <button
                      onClick={() => onPermanentDelete(dp.person.id)}
                      className="flex-1 py-2 bg-slate-100 hover:bg-red-50 dark:bg-slate-800 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400 border border-slate-200 dark:border-slate-700 hover:border-red-200/50 dark:hover:border-red-900/30 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      Borrar Definitivo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation Modal for Empty Trash */}
      {confirmEmptyOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-xl animate-in fade-in zoom-in duration-200">
            <div className="flex gap-4 items-start">
              <div className="p-3 bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-2xl shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">¿Vaciar papelera permanentemente?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                  Esta acción eliminará de forma irreversible <strong>todos los {deletedPeople.length} registros</strong> de la papelera de reciclaje. No será posible recuperarlos en el futuro.
                </p>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={() => setConfirmEmptyOpen(false)}
                disabled={emptyingTrash}
                className="px-4 py-2 text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void emptyTrashFast()}
                disabled={emptyingTrash}
                className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-xl text-xs font-bold transition-colors shadow-lg shadow-red-500/10 cursor-pointer"
              >
                {emptyingTrash ? 'Vaciando…' : 'Sí, vaciar permanentemente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};