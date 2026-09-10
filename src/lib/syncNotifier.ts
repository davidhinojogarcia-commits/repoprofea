export interface DatabaseSyncOptions {
  detail?: string;
  successMessage?: string;
  errorMessage?: string;
  silent?: boolean;
}

/**
 * Emits a database sync notice to trigger the visual green/red feedback window
 */
export function notifyDatabaseSync(payload: {
  status: 'syncing' | 'success' | 'error';
  title?: string;
  message?: string;
  detail?: string;
  retryAction?: () => void | Promise<void>;
}) {
  // Never broadcast 'syncing' to UI to prevent annoying recurring loading windows
  if (payload.status === 'syncing') {
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('profea_db_sync_notice', { detail: payload }));
  }
}

/**
 * Wraps any database sync promise, automatically showing:
 * - GREEN alert window if succeeded (unless silent)
 * - RED alert window with "Reintentar" if failed
 */
export async function executeDatabaseSync<T>(
  actionName: string,
  operation: () => Promise<T>,
  options?: DatabaseSyncOptions
): Promise<T> {
  try {
    const result = await operation();
    if (!options?.silent) {
      notifyDatabaseSync({
        status: 'success',
        title: 'Operación guardada correctamente en la Base de Datos',
        message: options?.successMessage || 'Los cambios se han guardado y sincronizado correctamente con la base de datos.',
        detail: options?.detail || `${actionName} guardado con éxito.`
      });
    }
    return result;
  } catch (error: any) {
    console.error(`Error syncing ${actionName} to database:`, error);
    notifyDatabaseSync({
      status: 'error',
      title: 'Error: No se ha podido guardar en la Base de Datos',
      message: options?.errorMessage || 'No se han podido subir los cambios a la base de datos en la nube. Los cambios se mantienen guardados localmente.',
      detail: error?.message || 'Error de conexión con la base de datos',
      retryAction: () => {
        executeDatabaseSync(actionName, operation, options).catch(console.error);
      }
    });
    throw error;
  }
}
