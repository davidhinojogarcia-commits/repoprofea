declare const __APP_BUILD__: string;

export const APP_VERSION = '1.18.0';
export const APP_RELEASE_DATE = '01/10/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'Eliminación de trabajadores detectados erróneamente en Inicio y Control de presencia.',
  'Eliminación disponible tanto para supervisor como para encargado.',
  'Envío al supervisor permitido aunque falten firmas, identificado claramente como incompleto.',
  'Conservación del PDF original y de las firmas válidas durante el flujo.',
  'Mejoras en descarga de PDF firmados y firmas transparentes.',
] as const;
