declare const __APP_BUILD__: string;

export const APP_VERSION = '1.20.0';
export const APP_RELEASE_DATE = '09/10/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'Documentos de encargados: los originales importados quedan en borrador hasta que el supervisor pulse Enviar al portal de encargados.',
  'Botón Ver trazabilidad retirado de Documentación de encargados.',
  'Revocar firma y volver a firmar permite repetir únicamente la firma seleccionada antes del envío al supervisor.',
  'Retirar del portal para corregir permite revisar trabajadores y posiciones sin perder las firmas que conservan su identidad.',
  'Ajuste automático propuesto dentro de la fila de cada trabajador, con validación de límites, nombres y solapamientos antes de guardar y enviar.',
  'Las firmas mantienen sus proporciones dentro del espacio reservado. El envío requiere todas las firmas obligatorias.',
] as const;
