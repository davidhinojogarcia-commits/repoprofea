declare const __APP_BUILD__: string;

export const APP_VERSION = '1.11.0';
export const APP_RELEASE_DATE = '25/09/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'Importación inteligente de herramientas y maquinaria desde Excel.',
  'Detección de cuentas bancarias y números de Seguridad Social repetidos.',
  'Mejora del flujo SAE → Directorio → Reconocimientos → SAE.',
  'Mejoras de PDFs y exportaciones de reconocimientos médicos.',
  'Refuerzo de legibilidad y contraste en modo diurno y nocturno.',
  'Renovación visual global de la interfaz y Menú inicial en Vista guiada.',
  'Configuración central del supervisor y corrección de la citación médica.',
  'Configuración central del técnico responsable y autocompletado en informes.',
  'Ficha maestra de trabajadores y recuperación automática de datos personales en nuevas contrataciones.',
] as const;
