declare const __APP_BUILD__: string;

export const APP_VERSION = '1.13.0';
export const APP_RELEASE_DATE = '28/09/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'Integración de Gmail mediante autorización segura de Google para preparar y enviar documentación.',
  'Nuevo portal móvil del encargado con acceso limitado a la documentación de su obra.',
  'Código QR grande y adaptado al móvil para facilitar el acceso del encargado.',
  'Botón para copiar el enlace de acceso y compartirlo por cualquier medio.',
  'Desautorización inmediata del código QR y del enlace desde la configuración.',
  'Mejoras en la preparación, seguimiento y control supervisor de la documentación de encargados.',
  'Mensajes de error visibles cuando no se puede generar, copiar o anular un acceso.',
] as const;
