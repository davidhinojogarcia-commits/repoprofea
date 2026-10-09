declare const __APP_BUILD__: string;

export const APP_VERSION = '1.20.1';
export const APP_RELEASE_DATE = '09/10/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'Guardar borrador permite conservar ajustes pendientes o firmas solapadas; el envío al portal sigue exigiendo posiciones válidas.',
  'Guardado de posiciones en una sola transacción, con control de cambios simultáneos y verificación del resultado.',
  'Eliminación de trabajadores verificada y mensajes de éxito separados de los errores.',
  'Avisos junto a cada trabajador, navegación al siguiente conflicto y tamaño de firma ajustable para filas estrechas.',
] as const;
