declare const __APP_BUILD__: string;

export const APP_VERSION = '1.21.6';
export const APP_RELEASE_DATE = '28/10/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'Rechazo voluntario y Salida de obra en ambos portales: borradores recuperables, doble firma, PDF privado versionado y diligencia de regreso independiente.',
  'Nuevo registro: lectura del carnet QR con cámara móvil vinculada, confirmación de ficha y revisión preventiva antes de contratar.',
  'Actas 3.1: contenido por puntos, guardado automático, borrador sin códigos y firma presencial o remota independiente.',
  'Actas definitivas en el portal y distribución Gmail con reintentos; anexos comprimidos y conservación privada sin duplicar el PDF.',
  'Fotografías de incidencias reducidas antes de adjuntarlas; registro diario descargable con firmas de entrada y salida completas.',
  'Control, inicios y contratos en dos líneas y confirmaciones accesibles en móvil.',
  'Nuevas firmas en azul de bolígrafo y fondo transparente; proporción conservada en los PDF y reintento sin perder el trazo.',
  'Refrescos concurrentes agrupados y recursos PDF liberados; registros saneados en importaciones y Gmail.',
  'Renovación de Gmail desde la revisión de documentos y comprobación real del permiso de Google.',
  'Corrección de formularios SAE escaneados: trabajador separado de DNI/fecha y PDF visible al ajustar firmas aunque falte identificar la persona.',
  'Contratos y Prórrogas en Importar documento: original intacto, revisión del trabajador y zona de firma antes del envío manual.',
  'Firma del trabajador en el portal y devolución del mismo PDF firmado al supervisor, con aislamiento por obra y propietario.',
  'Los documentos con reconocimiento dudoso se conservan como borradores para revisión manual.',
  'Tutor PROFEA: registro de incidencias con formulario, filtros operativos y verificación real de guardado.',
  'Tutor disponible en Vercel, consultas paginadas con datos mínimos y borrados con alcance revalidado.',
  'El solapamiento entre firmas se permite al enviar con confirmación del supervisor, manteniendo el original intacto.',
  'Guardar borrador permite conservar ajustes pendientes o firmas solapadas; el envío sigue comprobando posiciones pendientes, filas y límites de página.',
  'Guardado de posiciones en una sola transacción, con control de cambios simultáneos y verificación del resultado.',
  'Eliminación de trabajadores verificada y mensajes de éxito separados de los errores.',
  'Avisos junto a cada trabajador, navegación al siguiente conflicto y tamaño de firma ajustable para filas estrechas.',
] as const;

