declare const __APP_BUILD__: string;

export const APP_VERSION = '1.22.1';
export const APP_RELEASE_DATE = '10/11/2026';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' && __APP_BUILD__
  ? __APP_BUILD__.slice(0, 7)
  : 'local';

export const APP_RELEASE_NOTES = [
  'Portal de encargados: selector compacto de diez secciones en móvil, sin cinta inferior ni espacio sobrante, manteniendo la barra en tablet y escritorio.',
  'Actas de visitas: tarjetas más compactas para supervisor y encargado, con acciones PDF y lectura ordenadas.',
  'Acciones documentales: botones coherentes en móviles estrechos, foco accesible y respeto al movimiento reducido.',
  'Actas de visitas: colaboración de Dirección Facultativa mediante invitación segura por enlace o QR, verificación por correo y aportaciones revisadas por el supervisor.',
  'Dictado de voz en los puntos y notas de las actas, con control de inicio y parada y alternativa del teclado en navegadores sin reconocimiento directo.',
  'Directorio de trabajadores: filtros institucionales uniformes en iPhone y aviso No aptos solo al seleccionar el filtro médico.',
  'Actas de visitas: interfaz móvil compacta con tarjetas y controles alineados.',
  'Partes y avisos admite obras existentes sin código separado, con identificación por UUID y propietario y rechazo de coincidencias ambiguas.',
  'Actas de visitas y Partes y avisos dentro de Documentación de obra, sin accesos duplicados en el menú general; cinta móvil y biblioteca lateral en tablet y ordenador.',
  'Rechazo voluntario y Salida de obra agrupados en Otros documentos.',
  'Lector QR con cámara de mayor resolución, lectura desde foto y protección frente a duplicados; acceso al escáner encima de las fichas.',
  'Directorio con filtros combinables por año de contratación y estado de formación.',
  'Compilación de funciones corregida: configuración de TypeScript aislada de las simulaciones de prueba y comprobación incremental en cada build.',
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

