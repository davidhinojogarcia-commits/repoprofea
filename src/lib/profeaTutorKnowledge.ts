export const PROFEA_TUTOR_VIEW_LABELS = {
  dashboard: 'Resumen',
  sae: 'SAE / Selección',
  directorio: 'Directorio',
  registro: 'Nuevo registro',
  calendario: 'Calendario integrado',
  citas: 'Reconocimientos médicos',
  documentacion_obra: 'Documentación de obra',
  documentacion_encargados: 'Documentación de encargados',
  subcontratas: 'CAE',
  inventario: 'Herramientas y maquinaria',
  configuracion: 'Configuración',
  papelera: 'Papelera',
  estadisticas: 'Estadísticas',
  administracion: 'Administración',
} as const;

export type ProfeaTutorView = keyof typeof PROFEA_TUTOR_VIEW_LABELS;

export const PROFEA_TUTOR_KNOWLEDGE = `
GESTIONPROFEA / PROFEA — GUÍA DE USO PARA SUPERVISORES

REGLAS DEL TUTOR
- Explica únicamente el manejo real de GestionProfea.
- No inventes botones, pantallas ni procedimientos que no estén descritos aquí.
- Si una función no está documentada, indícalo y orienta al usuario hacia el módulo más cercano.
- Prioriza instrucciones cortas, numeradas y concretas.
- No pidas DNI, datos médicos ni otra información personal para explicar cómo usar la aplicación.
- No realices cambios en nombre del usuario: el tutor guía y puede llevar a un módulo, pero no debe modificar registros.
- Si el usuario pregunta "qué hago ahora", usa el CONTEXTO DE PANTALLA ACTUAL.
- Cuando existan dos flujos parecidos, aclara la diferencia.

RESUMEN / MENÚ INICIAL
- La Vista guiada muestra un recorrido simplificado para usuarios con poca experiencia informática.
- La Vista completa muestra todos los módulos.
- Desde el Resumen se accede a SAE, Directorio, Reconocimientos, Documentación de obra, Documentación de encargados, CAE e Inventario.

SAE / SELECCIÓN
- Flujo general: Periodos anuales -> Solicitud -> Informe SAE -> resultado/candidato -> registro del trabajador.
- Al registrar un candidato, se abre Directorio para completar o revisar la ficha.
- Si el trabajador necesita reconocimiento médico pendiente, tras guardar la ficha el flujo continúa en Reconocimientos médicos.
- Si ya tiene reconocimiento vigente, vuelve a SAE.
- La renuncia 2100 se genera desde el flujo SAE correspondiente.
- Los periodos se gestionan por quincenas para mano de obra no cualificada y por mes cuando corresponda a cualificada.

DIRECTORIO
- Contiene las fichas de trabajadores.
- Permite buscar, filtrar por obra/quincena y editar datos.
- Incluye acciones rápidas de informes y comunicaciones.
- Los correos rápidos adjuntan el PDF correspondiente y el cuerpo del correo contiene solo datos generales, no la relación detallada.
- La relación de trabajadores para encargados se comparte por WhatsApp al recurso preventivo; las relaciones administrativa, médica, calzado y formación se envían por correo a los responsables configurados.
- Los destinatarios salen de Configuración.

RECONOCIMIENTOS MÉDICOS
- Gestiona citas, estado y aptitud.
- Puede registrar "Apto", "Apto con limitaciones" y sus limitaciones.
- Las citas pueden prepararse y enviarse desde el módulo.
- Tras el flujo de contratación desde SAE, si el trabajador tiene reconocimiento pendiente, la aplicación puede dirigir al supervisor aquí antes de volver a SAE.

DOCUMENTACIÓN DE OBRA
- Cada obra dispone de su biblioteca documental.
- Documentos principales:
  1. Entrega de EPIs.
  2. Formación e información.
  3. Autorización de maquinaria.
  4. Control horario.
- También existen Otros documentos de obra, como baja voluntaria, ausencia, permiso de lactancia, asistencia FREMAP, comunicación interna de accidente y certificados.
- Los documentos deben generarse con los modelos propios de este módulo.
- Formación e información, EPIs, maquinaria y control horario tienen generadores específicos.
- Los documentos se filtran por obra y periodo cuando corresponde.

DOCUMENTACIÓN DE ENCARGADOS
- Se organiza por Obra -> Mes -> Documentos.
- El supervisor puede revisar, editar y eliminar los documentos.
- El portal del encargado reutiliza los mismos modelos reales de Documentación de obra para EPIs, Formación e información, Maquinaria, Control horario y Otros documentos.
- Inicio / Incorporación y Control de presencia son documentos distintos y se mantienen separados en "Asignados".
- Inicio y Control de presencia se preparan para que los trabajadores firmen desde el móvil del encargado.
- Cuando todas las firmas están recogidas, el encargado pulsa "Finalizar y enviar al supervisor".
- Si el supervisor devuelve un documento para corrección, vuelve a quedar disponible para revisión y nueva firma cuando corresponda.
- El PDF de Inicio utiliza texto oscuro para mejorar la legibilidad.
- El reconocimiento de trabajadores de Inicio/Control usa lectura reforzada cuando la primera identificación falla.

PORTAL DEL ENCARGADO
- Se abre mediante el enlace/QR asignado a la obra.
- La navegación funciona como una cinta horizontal: Asignados, EPIs, Formación, Maquinaria, Control horario, Documentos y Finalizados.
- Asignados: Inicio / Incorporación y Control de presencia preparados por el supervisor. Conservan el texto completo importado y muestran debajo los trabajadores que deben firmar.
- EPIs: permite seleccionar una o varias quincenas, uno o varios meses o combinar ambos; muestra los trabajadores seleccionados y prepara la relación para sus firmas.
- Formación: funciona igual que EPIs y además permite indicar acción formativa/información y duración.
- Maquinaria: permite seleccionar periodos, indicar los equipos autorizados para cada trabajador y recoger las firmas.
- Control horario: sustituye al antiguo botón Jornada. Permite seleccionar quincenas, meses o ambos y muestra los trabajadores del periodo para firmar entrada y salida.
- Documentos: queda reservado para Otros documentos independientes de Documentación de obra.
- Finalizados: reúne Inicio, Control de presencia, EPIs, Formación, Maquinaria, Control horario y Otros documentos ya enviados al supervisor.
- Las firmas se realizan con el dedo en móvil/tablet y se insertan sin fondo blanco para no tapar el documento.

CAE / SUBCONTRATAS
- Gestiona empresas, trabajadores de subcontratas, autorizados/no autorizados y documentación de coordinación.
- Incluye control del Libro de Subcontratación y revisión de documentación.
- La previsualización permite revisar antes de validar.

HERRAMIENTAS Y MAQUINARIA
- Permite consultar inventario, asignaciones, estado y trazabilidad.
- Los informes de situación deben incluir todas las herramientas/maquinaria y un resumen por obra.
- Se puede importar información desde Excel en los flujos disponibles.

CONFIGURACIÓN
- Guarda datos de responsables y destinatarios usados por informes/comunicaciones:
  supervisor, técnico, administrativo/a, empresa de reconocimientos, proveedor de calzado y empresa de formación.
- También permite configurar el horario de jornada usado en informes.
- Los datos configurados aquí alimentan automáticamente acciones rápidas y documentos.

PAPELERA
- Los registros eliminados pueden enviarse a Papelera antes de su borrado definitivo.
- Desde Papelera se pueden restaurar o eliminar definitivamente.

CONSEJOS DE USO
- Si el usuario no encuentra una función, indica primero el módulo y luego la ruta concreta.
- Si está en Vista guiada, usa nombres sencillos y evita explicar opciones avanzadas salvo que las pida.
- Si el usuario pregunta por una tarea concreta, responde con pasos accionables.
`;

export const PROFEA_TUTOR_QUICK_QUESTIONS = [
  '¿Cómo empiezo una contratación en SAE?',
  '¿Cómo envío una cita de reconocimiento médico?',
  '¿Cómo genero un documento de obra?',
  '¿Cómo reviso la documentación de encargados?',
] as const;

const normalize = (value: string) =>
  String(value || '')
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const LOCAL_TUTOR_ANSWERS: Array<{ words: string[]; answer: string; view?: ProfeaTutorView }> = [
  {
    words: ['sae','contratacion','contratar','seleccion'],
    answer: 'Para iniciar una contratación: 1) entra en SAE / Selección; 2) comprueba el periodo anual; 3) abre o importa la solicitud; 4) revisa el informe SAE; 5) selecciona el resultado del candidato; 6) pulsa Registrar para completar su ficha en Directorio. Si necesita reconocimiento médico, el flujo continuará después en Reconocimientos.',
    view: 'sae',
  },
  {
    words: ['reconocimiento','medico','cita','aptitud'],
    answer: 'Entra en Reconocimientos médicos. Allí puedes preparar la cita, revisar el estado y registrar la aptitud. Si vienes desde SAE, guarda primero la ficha del trabajador en Directorio y la aplicación te llevará al reconocimiento cuando esté pendiente.',
    view: 'citas',
  },
  {
    words: ['documentacion','obra','epis','formacion','maquinaria','control horario'],
    answer: 'En Documentación de obra selecciona la obra y el periodo. Después elige el documento: EPIs, Formación e información, Autorización de maquinaria, Control horario u Otro documento. Completa sus datos y usa el botón de generar PDF del propio modelo.',
    view: 'documentacion_obra',
  },
  {
    words: ['encargado','inicio','presencia','firmas','portal'],
    answer: 'En Documentación de encargados puedes revisar lo recibido por obra y mes. Inicio / Incorporación y Control de presencia aparecen como documentos asignados al encargado para que cada trabajador firme desde el móvil. Cuando están todas las firmas, el encargado finaliza y lo envía al supervisor.',
    view: 'documentacion_encargados',
  },
  {
    words: ['directorio','trabajador','ficha','editar'],
    answer: 'En Directorio busca al trabajador por nombre, DNI, obra o quincena. Abre su ficha con Editar, modifica los datos necesarios y guarda. Desde Directorio también tienes los informes y acciones rápidas.',
    view: 'directorio',
  },
  {
    words: ['cae','subcontrata','subcontratas'],
    answer: 'En CAE puedes revisar empresas, trabajadores de subcontratas, documentación, autorizados/no autorizados y el estado del Libro de Subcontratación.',
    view: 'subcontratas',
  },
];

export function getLocalTutorFallback(question: string, currentView?: string) {
  const q = normalize(question);
  let best: typeof LOCAL_TUTOR_ANSWERS[number] | undefined;
  let score = 0;
  for (const item of LOCAL_TUTOR_ANSWERS) {
    const next = item.words.reduce((sum, word) => sum + (q.includes(normalize(word)) ? 1 : 0), 0);
    if (next > score) {
      score = next;
      best = item;
    }
  }
  if (best && score > 0) return best;
  const label = PROFEA_TUTOR_VIEW_LABELS[currentView as ProfeaTutorView];
  return {
    answer: label
      ? `Estás en ${label}. Dime qué tarea quieres hacer aquí y te indico los pasos exactos. También puedes preguntarme por SAE, Directorio, reconocimientos médicos, documentación, CAE o maquinaria.`
      : 'Dime qué tarea quieres realizar en GestionProfea y te indicaré el módulo y los pasos exactos.',
    view: currentView as ProfeaTutorView | undefined,
  };
}
