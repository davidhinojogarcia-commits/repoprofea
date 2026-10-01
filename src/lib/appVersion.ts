declare const __APP_BUILD__: string;

export const APP_VERSION = '1.18.4';
export const APP_RELEASE_DATE = '01/10/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'El envío de Inicio/Control acepta posiciones de firma confirmadas manualmente por el supervisor aunque el PDF escaneado no permita recuperar la geometría del nombre.',
  'Al preparar el PDF firmado se conservan las posiciones manuales válidas y se reintenta OCR solo para posiciones realmente pendientes.',
  'Los errores de envío se muestran en la propia pantalla y ya no abren una ventana modal bloqueante.',
  'Revisión de contraste diurno/nocturno en Documentación de encargados, portal móvil y Ajustar firmas.',
  'Avisos, estados, buscadores, tarjetas y botones secundarios reciben variantes oscuras legibles.',
  'Modales y editores de Documentación de encargados pasan a una capa global sobre document.body.',
  'Ajustar firmas permite eliminar directamente trabajadores falsamente detectados, sin confirmación.',
  'Se refuerza la detección para descartar calles, obras, localidades y textos institucionales como si fueran trabajadores.',
  'Se eliminan diálogos nativos del navegador en los flujos de encargado y supervisor afectados.',
  'Acciones de quitar y corregir trabajadores en Inicio/Control sin ventanas de confirmación bloqueantes.',
  'Botón Trabajadores visible en Documentación de encargados para gestionar detecciones erróneas desde supervisor.',
  'Eliminación de trabajadores detectados erróneamente en Inicio y Control de presencia.',
  'Eliminación disponible tanto para supervisor como para encargado.',
  'Envío al supervisor permitido aunque falten firmas, identificado claramente como incompleto.',
  'Conservación del PDF original y de las firmas válidas durante el flujo.',
  'Mejoras en descarga de PDF firmados y firmas transparentes.',
] as const;
