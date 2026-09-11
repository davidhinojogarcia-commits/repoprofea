import React from 'react';
import { PersonList as PersonListView } from './PersonListView';
import { moveWorkersToTrashBulk } from '../src/services/workerImportService';

export const PersonList: React.FC<React.ComponentProps<typeof PersonListView>> = (props) => {
  const handleDeleteMultiple = async (ids: number[]) => {
    if (!ids?.length) return;
    if (!window.confirm(`¿Está seguro de que desea enviar ${ids.length} registros a la Papelera? Se almacenarán allí durante 30 días.`)) return;

    try {
      await moveWorkersToTrashBulk(ids);
      props.onToast?.(`${ids.length} registros enviados a la Papelera correctamente`, 'success');
    } catch (error) {
      console.error('Error en baja múltiple de Supabase:', error);
      props.onToast?.('No se pudieron enviar todos los registros a la Papelera.', 'error');
    }
  };

  // Deshacer/Rehacer se muestran únicamente en la cabecera fija de la aplicación.
  // Se excluyen aquí para evitar duplicarlos dentro de la vista de Registros.
  const {
    onUndo: _onUndo,
    onRedo: _onRedo,
    canUndo: _canUndo,
    canRedo: _canRedo,
    ...listProps
  } = props;

  return <PersonListView {...listProps} onDeleteMultiple={handleDeleteMultiple} />;
};
