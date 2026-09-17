import { ADDITIONAL_WORKSITE_DOCUMENTS } from './worksiteAdditionalDocumentsPdf';
import type { Person } from '../../types';
import type { AdditionalWorksiteContext, WorksiteDocumentAnswers } from './worksiteAdditionalDocumentsPdf';

const value = (answers: WorksiteDocumentAnswers, key: string, fallback = '____________________________') =>
  String(answers[key] || '').trim() || fallback;
const workerName = (worker: Person | null) => worker?.apellidosNombre || '____________________________';
const workerDni = (worker: Person | null) => worker?.dni || '________________';
const workerCategory = (worker: Person | null) => worker?.categoria || '____________________________';
const contractPeriod = (worker: Person | null) => `${worker?.periodoInicio || '________________'} a ${worker?.periodoFin || '________________'}`;

const setDefinition = (
  key: keyof typeof ADDITIONAL_WORKSITE_DOCUMENTS,
  patch: Partial<(typeof ADDITIONAL_WORKSITE_DOCUMENTS)[keyof typeof ADDITIONAL_WORKSITE_DOCUMENTS]>,
) => Object.assign(ADDITIONAL_WORKSITE_DOCUMENTS[key] as any, patch);

setDefinition('baja_voluntaria', {
  legal: 'Marco normativo: artículo 49.1.d) del Real Decreto Legislativo 2/2015, de 23 de octubre, por el que se aprueba el texto refundido de la Ley del Estatuto de los Trabajadores. La dimisión de la persona trabajadora extingue el contrato, debiendo respetarse el preaviso que establezca el convenio colectivo aplicable o, en su defecto, la costumbre del lugar.',
  body: (w: Person | null, c: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => [
    '1. OBJETO DE LA COMUNICACIÓN.— Mediante el presente escrito se formaliza la comunicación de baja voluntaria de la persona trabajadora identificada en el encabezamiento, dejando constancia documental de una decisión personal, libre, expresa e inequívoca de poner fin a la relación laboral por iniciativa propia.',
    `2. IDENTIFICACIÓN DE LA RELACIÓN LABORAL.— D./D.ª ${workerName(w)}, con DNI/NIE ${workerDni(w)}, presta servicios para ${c.empresa}, adscrito/a a la obra ${c.obra}, con categoría profesional ${workerCategory(w)} y periodo contractual ${contractPeriod(w)}.`,
    `3. MANIFESTACIÓN DE VOLUNTAD.— La persona trabajadora manifiesta su voluntad de extinguir voluntariamente su contrato de trabajo, fijando como fecha de efectos de la baja el día ${value(a, 'fechaEfectos')}. Esta comunicación se efectúa al amparo del artículo 49.1.d) del Estatuto de los Trabajadores.`,
    '4. PREAVISO Y EFECTOS.— La fecha efectiva indicada se entenderá sin perjuicio del plazo de preaviso que, en su caso, resulte exigible conforme al convenio colectivo aplicable o a la costumbre del lugar. La empresa realizará las actuaciones administrativas y laborales que procedan como consecuencia de la extinción, incluida la liquidación de las cantidades que legalmente correspondan.',
    '5. ALCANCE DE LA FIRMA.— La firma del presente documento acredita la comunicación de la voluntad de baja y su recepción por la organización. No supone renuncia a derechos indisponibles ni declaración de conformidad con cantidades que deban determinarse posteriormente.',
    `6. OBSERVACIONES ESPECÍFICAS.— ${value(a, 'observaciones', 'No se hacen constar observaciones adicionales.')}`,
  ],
});

setDefinition('ausencia_trabajador', {
  legal: 'Marco normativo general: artículos 20 y 37 del Estatuto de los Trabajadores, junto con el convenio colectivo aplicable y las normas internas de organización. La naturaleza justificada, retribuida o no retribuida de cada ausencia dependerá de su causa concreta y de la acreditación que legal o convencionalmente resulte exigible.',
  body: (w: Person | null, c: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => [
    '1. OBJETO.— El presente documento tiene por finalidad dejar constancia de una ausencia al puesto de trabajo y de la información comunicada por la persona trabajadora, permitiendo su correcta justificación, control horario y tratamiento administrativo.',
    `2. PERSONA Y CENTRO DE TRABAJO.— D./D.ª ${workerName(w)}, DNI/NIE ${workerDni(w)}, categoría ${workerCategory(w)}, se encuentra adscrito/a a la obra ${c.obra}.`,
    `3. PERIODO DE AUSENCIA.— Se hace constar una ausencia comprendida entre ${value(a, 'fechaInicio')} y ${value(a, 'fechaFin')}.`,
    `4. CAUSA COMUNICADA.— La persona trabajadora manifiesta como motivo de la ausencia: ${value(a, 'motivo')}.`,
    `5. ACREDITACIÓN.— A efectos de comprobación y archivo se hace constar la siguiente documentación justificativa aportada: ${value(a, 'justificante', 'No se ha indicado documentación justificativa en el momento de formalizar este parte.')}.`,
    '6. CALIFICACIÓN DE LA AUSENCIA.— La cumplimentación de este documento no determina por sí sola el carácter retribuido, no retribuido, justificado o injustificado de la ausencia. Dicha calificación deberá efectuarse conforme a la causa acreditada, al Estatuto de los Trabajadores, al convenio colectivo y a las demás disposiciones aplicables.',
    '7. EFECTOS DE REGISTRO.— El documento servirá de soporte para la gestión de presencia, jornada, nómina y expediente laboral en la medida en que corresponda, sin sustituir los justificantes oficiales que sean exigibles para cada causa.',
    `8. OBSERVACIONES.— ${value(a, 'observaciones', 'Sin observaciones adicionales.')}`,
  ],
});

setDefinition('permiso_lactancia', {
  legal: 'Marco normativo: artículos 37.4 y 37.7 del Estatuto de los Trabajadores, en su redacción vigente. El derecho para el cuidado del lactante permite una hora de ausencia, divisible en dos fracciones, su sustitución por reducción de jornada en media hora o su acumulación en jornadas completas; la concreción horaria y el periodo de disfrute corresponden a la persona trabajadora dentro de los términos legales y convencionales aplicables.',
  body: (w: Person | null, c: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => [
    '1. OBJETO DE LA SOLICITUD/COMUNICACIÓN.— Por medio del presente escrito se formaliza el ejercicio del derecho para el cuidado del lactante previsto en el artículo 37.4 del Estatuto de los Trabajadores.',
    `2. PERSONA SOLICITANTE.— D./D.ª ${workerName(w)}, DNI/NIE ${workerDni(w)}, categoría ${workerCategory(w)}, adscrito/a a la obra ${c.obra}, comunica su voluntad de ejercer dicho derecho en los términos indicados a continuación.`,
    `3. MODALIDAD DE DISFRUTE.— Se solicita la modalidad: ${value(a, 'modalidad')}. El periodo previsto de disfrute será desde ${value(a, 'fechaInicio')} hasta ${value(a, 'fechaFin')}.`,
    `4. CONCRECIÓN HORARIA.— La distribución u horario propuesto es el siguiente: ${value(a, 'horario')}.`,
    '5. RÉGIMEN JURÍDICO.— El disfrute se realizará conforme a los artículos 37.4 y 37.7 del Estatuto de los Trabajadores, al convenio colectivo que resulte aplicable y, en su caso, a los criterios organizativos legalmente admisibles. La persona trabajadora deberá respetar el preaviso establecido legal o convencionalmente, salvo los supuestos exceptuados por la normativa.',
    '6. EFECTOS.— La firma acredita la presentación de la solicitud/comunicación y su recepción. Cualquier ajuste posterior de fechas u horario deberá quedar igualmente documentado para garantizar la correcta organización del trabajo y el registro de jornada.',
    `7. OBSERVACIONES.— ${value(a, 'observaciones', 'Sin observaciones adicionales.')}`,
  ],
});

setDefinition('parte_asistencia_fremap', {
  legal: 'Marco preventivo: Ley 31/1995, de Prevención de Riesgos Laborales, en particular sus artículos 14, 16, 22 y 23, en relación con la protección de la salud, la actuación ante daños derivados del trabajo y la documentación preventiva. Documento interno de derivación que no sustituye los documentos sanitarios, partes de baja/alta ni las comunicaciones oficiales de accidente que correspondan.',
  body: (w: Person | null, c: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => [
    '1. OBJETO.— El presente parte interno documenta la derivación de una persona trabajadora a la mutua colaboradora FREMAP para valoración o asistencia sanitaria cuando se ha comunicado un hecho, lesión, molestia o sintomatología que pudiera guardar relación con la actividad laboral.',
    `2. PERSONA TRABAJADORA.— D./D.ª ${workerName(w)}, DNI/NIE ${workerDni(w)}, categoría ${workerCategory(w)}, perteneciente a ${c.empresa} y adscrito/a a la obra ${c.obra}.`,
    `3. DATOS DEL HECHO.— El hecho o inicio de síntomas se sitúa en fecha ${value(a, 'fechaHecho')} a las ${value(a, 'horaHecho')}, en ${value(a, 'lugar')}.`,
    `4. DESCRIPCIÓN.— Según la información disponible en el momento de emitir este parte, se hace constar: ${value(a, 'descripcion')}.`,
    `5. DERIVACIÓN.— La asistencia/valoración es comunicada o autorizada por: ${value(a, 'autoriza')}. La remisión se realiza con la finalidad de que el personal sanitario competente valore la situación y determine, en su caso, las actuaciones clínicas o administrativas procedentes.`,
    '6. ALCANCE DEL DOCUMENTO.— Este parte tiene carácter interno y de acompañamiento. No constituye diagnóstico médico, no determina contingencia profesional y no sustituye los documentos que deban emitir FREMAP, el servicio sanitario competente, la Seguridad Social o la empresa mediante los sistemas oficiales establecidos.',
    '7. ACTUACIONES POSTERIORES.— Cuando del hecho se derive un accidente de trabajo o daño para la salud, deberán realizarse las actuaciones preventivas, de investigación, registro y notificación que legalmente correspondan.',
    `8. OBSERVACIONES.— ${value(a, 'observaciones', 'Sin observaciones adicionales.')}`,
  ],
  note: 'Conservar junto al expediente del hecho y adjuntar, cuando proceda, la documentación emitida por FREMAP o por el servicio sanitario competente.',
});

setDefinition('comunicacion_accidente', {
  legal: 'Marco normativo: Ley 31/1995 de Prevención de Riesgos Laborales, especialmente artículos 16 y 23, y Orden TAS/2926/2002, de 19 de noviembre, sobre modelos y transmisión electrónica de la notificación de accidentes de trabajo mediante Delt@. Este parte es un registro interno y no sustituye la notificación oficial que resulte obligatoria.',
  body: (w: Person | null, c: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => [
    '1. OBJETO Y CARÁCTER DEL PARTE.— Se documenta internamente un accidente o incidente comunicado durante la prestación de servicios, con el fin de preservar la información inicial, facilitar la investigación preventiva y permitir la tramitación de las comunicaciones que procedan.',
    `2. PERSONA ACCIDENTADA.— D./D.ª ${workerName(w)}, DNI/NIE ${workerDni(w)}, categoría/puesto ${workerCategory(w)}, adscrito/a a la obra ${c.obra}.`,
    `3. FECHA, HORA Y LUGAR.— El hecho se produjo el día ${value(a, 'fechaAccidente')} a las ${value(a, 'horaAccidente')}, en ${value(a, 'lugar')}.`,
    `4. ACTIVIDAD DESARROLLADA.— En el momento del hecho la persona trabajadora realizaba la siguiente tarea: ${value(a, 'tarea')}.`,
    `5. DESCRIPCIÓN INICIAL DE LOS HECHOS.— ${value(a, 'descripcion')}. Esta descripción tiene carácter inicial y podrá completarse o corregirse durante la investigación del accidente.`,
    `6. LESIONES O ZONAS AFECTADAS.— Se hacen constar, sin valor de diagnóstico médico, las siguientes lesiones aparentes o zonas corporales afectadas: ${value(a, 'lesiones')}.`,
    `7. TESTIGOS.— ${value(a, 'testigos', 'No se han indicado testigos en el momento de cumplimentar el parte.')}`,
    `8. MEDIDAS INMEDIATAS.— Tras el hecho se adoptaron las siguientes actuaciones de protección, auxilio, paralización, señalización o control: ${value(a, 'medidas')}.`,
    `9. COMUNICACIONES REALIZADAS.— El hecho ha sido comunicado a: ${value(a, 'comunicadoA')}. Asistencia sanitaria/mutua: ${value(a, 'asistencia', 'No indicada en este momento')}.`,
    '10. INVESTIGACIÓN Y PREVENCIÓN.— De conformidad con la Ley 31/1995, la existencia de daños para la salud exige revisar, cuando proceda, la evaluación de riesgos y analizar las causas del hecho para adoptar medidas destinadas a evitar su repetición. Este documento constituye información inicial para dicha actuación preventiva.',
    '11. NOTIFICACIÓN OFICIAL.— Cuando legalmente corresponda, la empresa deberá efectuar la notificación del accidente mediante los modelos y procedimientos oficiales, incluido el sistema Delt@ regulado por la Orden TAS/2926/2002. La firma de este parte interno no sustituye esa obligación.',
    `12. OBSERVACIONES ADICIONALES.— ${value(a, 'observaciones', 'Sin observaciones adicionales.')}`,
  ],
});

setDefinition('certificado_trabajando_actualmente', {
  legal: 'Marco jurídico de referencia: Real Decreto Legislativo 2/2015, Estatuto de los Trabajadores, respecto de la relación laboral y sus elementos; normativa de protección de datos aplicable al tratamiento de información personal; y reglas de competencia y validación documental de la Diputación Provincial de Cádiz. Este modelo no atribuye por sí mismo competencia certificante a quien carezca de ella.',
  body: (w: Person | null, c: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => [
    '1. OBJETO.— El presente documento tiene por finalidad acreditar, a partir de los datos laborales y de contratación disponibles en GestionPROFEA y previa comprobación de su vigencia, la prestación actual de servicios de la persona identificada.',
    `2. CERTIFICACIÓN.— D./D.ª ${c.supervisor || '____________________________'}, en calidad de supervisor/a, HACE CONSTAR que D./D.ª ${workerName(w)}, con DNI/NIE ${workerDni(w)}, figura actualmente prestando servicios para ${c.empresa}, adscrito/a a la obra ${c.obra}, con categoría profesional ${workerCategory(w)}.`,
    `3. PERIODO DE PRESTACIÓN.— Según los datos registrados, el periodo contractual consta desde ${w?.periodoInicio || '________________'} hasta ${w?.periodoFin || '________________'}, encontrándose la relación incluida dentro de dicho periodo a la fecha de emisión del presente documento, salvo incidencia administrativa posterior no incorporada todavía al sistema.`,
    '4. ALCANCE.— La presente certificación se limita a los datos que constan en el expediente y no sustituye certificados de vida laboral, cotización, situación de alta en Seguridad Social u otros documentos que deban ser emitidos por el organismo competente.',
    `5. FINALIDAD.— Se expide para: ${value(a, 'destino', 'los efectos que procedan a solicitud de la persona interesada')}.`,
    `6. OBSERVACIONES.— ${value(a, 'observaciones', 'Sin observaciones adicionales.')}`,
    '7. VALIDACIÓN.— Para su utilización oficial deberá constar la firma de la persona u órgano competente conforme a la organización y delegaciones vigentes de la Diputación Provincial de Cádiz.',
  ],
});

setDefinition('certificado_servicios_prestados', {
  legal: 'Marco jurídico de referencia: Real Decreto Legislativo 2/2015, Estatuto de los Trabajadores, respecto de los datos de la relación laboral; normativa de protección de datos; y reglas de competencia y validación documental de la Diputación Provincial de Cádiz. La certificación se limita a los datos comprobados en el expediente y no sustituye documentos que corresponda emitir a otros organismos.',
  body: (w: Person | null, c: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => [
    '1. OBJETO.— El presente certificado tiene por finalidad dejar constancia de servicios laborales ya prestados por una persona trabajadora en el marco de las actuaciones PROFEA, tomando como base los datos de contratación que obran en el expediente.',
    `2. CERTIFICACIÓN.— D./D.ª ${c.supervisor || '____________________________'}, en calidad de supervisor/a, HACE CONSTAR que D./D.ª ${workerName(w)}, con DNI/NIE ${workerDni(w)}, ha prestado servicios para ${c.empresa} en la obra ${c.obra || w?.obra || '____________________________'}, con categoría profesional ${workerCategory(w)}.`,
    `3. PERIODO ACREDITADO.— Los servicios que constan en el registro corresponden al periodo comprendido entre ${w?.periodoInicio || '________________'} y ${w?.periodoFin || '________________'}, sin perjuicio de otros periodos distintos que deban acreditarse mediante certificación separada o acumulada.`,
    '4. ALCANCE DE LOS DATOS.— La certificación acredita exclusivamente la información comprobada en GestionPROFEA y en el expediente laboral disponible. No sustituye la vida laboral de la Tesorería General de la Seguridad Social, certificados de bases de cotización ni cualquier otro documento reservado a otro organismo.',
    `5. FINALIDAD.— Se expide para: ${value(a, 'destino', 'los efectos que procedan a solicitud de la persona interesada')}.`,
    `6. OBSERVACIONES.— ${value(a, 'observaciones', 'Sin observaciones adicionales.')}`,
    '7. VALIDACIÓN.— El documento deberá ser revisado y firmado por la persona u órgano competente para que produzca los efectos administrativos que correspondan.',
  ],
});
