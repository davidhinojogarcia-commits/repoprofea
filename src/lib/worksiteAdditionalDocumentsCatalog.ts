import type { Person } from '../../types';

export type AdditionalWorksiteDocumentType =
  | 'baja_voluntaria'
  | 'ausencia_trabajador'
  | 'permiso_lactancia'
  | 'parte_asistencia_fremap'
  | 'comunicacion_accidente'
  | 'certificado_trabajando_actualmente'
  | 'certificado_servicios_prestados';

export type AdditionalWorksiteContext = {
  obra: string; municipio?: string; empresa: string; cif: string; fecha: string;
  responsable?: string; supervisor?: string;
};
export type WorksiteDocumentSignatures = { worker?: string; foreman?: string; supervisor?: string };
export type WorksiteDocumentAnswers = Record<string, string>;
export type WorksiteDocumentField = { key: string; label: string; type?: 'text'|'date'|'time'|'textarea'|'select'; required?: boolean; options?: string[]; placeholder?: string };

type Definition = {
  title: string; short: string; legal: string; fields: WorksiteDocumentField[];
  body: (worker: Person | null, ctx: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => string[];
  signatureWorker?: boolean; signatureCompany?: boolean; note?: string;
};

const val=(a:WorksiteDocumentAnswers,k:string,fallback='____________________________')=>String(a[k]||'').trim()||fallback;
export const ADDITIONAL_WORKSITE_DOCUMENTS: Record<AdditionalWorksiteDocumentType, Definition> = {
  baja_voluntaria:{title:'BAJA VOLUNTARIA DE LA PERSONA TRABAJADORA',short:'Baja voluntaria',legal:'Referencia: art. 49.1.d) del Real Decreto Legislativo 2/2015, texto refundido de la Ley del Estatuto de los Trabajadores, sin perjuicio del preaviso aplicable por convenio colectivo o costumbre del lugar.',fields:[{key:'fechaEfectos',label:'Fecha de efectos de la baja',type:'date',required:true},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `La persona trabajadora ${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, comunica de forma libre, expresa e inequívoca su decisión de causar baja voluntaria en la relación laboral que mantiene con ${c.empresa}, vinculada a la obra ${c.obra}.`,
    `La fecha de efectos comunicada es ${val(a,'fechaEfectos')}. ${a.observaciones?`Observaciones: ${a.observaciones}`:''}`,
    'La firma acredita la comunicación de la voluntad de baja y su recepción, sin implicar renuncia a derechos indisponibles que legalmente correspondan.'
  ],signatureWorker:true,signatureCompany:true},
  ausencia_trabajador:{title:'COMUNICACIÓN / JUSTIFICACIÓN DE AUSENCIA',short:'Ausencia del trabajador',legal:'Referencia general: arts. 20 y 37 del Estatuto de los Trabajadores y, en su caso, convenio colectivo, instrucciones internas y régimen de permisos aplicable.',fields:[{key:'fechaInicio',label:'Inicio de la ausencia',type:'date',required:true},{key:'fechaFin',label:'Fin de la ausencia',type:'date',required:true},{key:'motivo',label:'Motivo comunicado',type:'textarea',required:true},{key:'justificante',label:'Documentación justificativa aportada',type:'textarea'},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `Se deja constancia de la ausencia de ${w?.apellidosNombre||'________________'}, DNI/NIE ${w?.dni||'________________'}, adscrito/a a la obra ${c.obra}, desde ${val(a,'fechaInicio')} hasta ${val(a,'fechaFin')}.`,
    `Motivo comunicado: ${val(a,'motivo')}.`, `Documentación justificativa: ${val(a,'justificante','No indicada')}.`,
    `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`,
    'La consideración de la ausencia como justificada, retribuida o no retribuida dependerá de la normativa, convenio y documentación acreditativa aplicables.'
  ],signatureWorker:true,signatureCompany:true},
  permiso_lactancia:{title:'SOLICITUD / COMUNICACIÓN DE PERMISO PARA EL CUIDADO DEL LACTANTE',short:'Permiso de lactancia',legal:'Referencia: art. 37.4 del Estatuto de los Trabajadores (Real Decreto Legislativo 2/2015), en la redacción vigente, y convenio colectivo aplicable.',fields:[{key:'modalidad',label:'Modalidad solicitada',type:'select',required:true,options:['Una hora de ausencia','Dos fracciones','Reducción de jornada','Acumulación en jornadas completas']},{key:'fechaInicio',label:'Fecha prevista de inicio',type:'date',required:true},{key:'fechaFin',label:'Fecha prevista de finalización',type:'date',required:true},{key:'horario',label:'Horario o distribución propuesta',type:'textarea',required:true},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, solicita/comunica el ejercicio del derecho para el cuidado del lactante en relación con su puesto en la obra ${c.obra}.`,
    `Modalidad: ${val(a,'modalidad')}. Periodo previsto: ${val(a,'fechaInicio')} a ${val(a,'fechaFin')}.`,
    `Horario o distribución propuesta: ${val(a,'horario')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`,
    'La concreción y disfrute se ajustarán a la normativa vigente, convenio colectivo aplicable y reglas de preaviso y coordinación organizativa que correspondan.'
  ],signatureWorker:true,signatureCompany:true},
  parte_asistencia_fremap:{title:'PARTE INTERNO DE DERIVACIÓN / ASISTENCIA A FREMAP',short:'Asistencia FREMAP',legal:'Documento interno de acompañamiento. No sustituye los partes médicos ni los modelos oficiales de accidente de trabajo o baja/alta que deban emitir la mutua, servicio sanitario o sistema oficial correspondiente.',fields:[{key:'fechaHecho',label:'Fecha del hecho / inicio de síntomas',type:'date',required:true},{key:'horaHecho',label:'Hora',type:'time',required:true},{key:'descripcion',label:'Descripción de lo ocurrido / síntomas',type:'textarea',required:true},{key:'lugar',label:'Lugar exacto',required:true},{key:'autoriza',label:'Persona que autoriza/comunica la asistencia',required:true},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `Se remite a ${w?.apellidosNombre||'________________'}, DNI/NIE ${w?.dni||'________________'}, trabajador/a de ${c.empresa}, adscrito/a a la obra ${c.obra}, para valoración/asistencia por FREMAP.`,
    `Fecha y hora: ${val(a,'fechaHecho')} ${val(a,'horaHecho')}. Lugar: ${val(a,'lugar')}.`,
    `Descripción / síntomas: ${val(a,'descripcion')}.`, `Autoriza/comunica: ${val(a,'autoriza')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureWorker:true,signatureCompany:true,note:'Adjuntar, cuando proceda, la documentación oficial emitida por FREMAP y tramitar las comunicaciones obligatorias por los canales establecidos.'},
  comunicacion_accidente:{title:'PARTE DE COMUNICACIÓN INTERNA DE ACCIDENTE LABORAL',short:'Comunicación interna accidente',legal:'Referencias: Ley 31/1995 de Prevención de Riesgos Laborales, especialmente arts. 16, 23 y 24, y normativa vigente sobre notificación oficial de accidentes de trabajo. Este parte interno no sustituye la notificación oficial cuando resulte obligatoria.',fields:[{key:'fechaAccidente',label:'Fecha del accidente',type:'date',required:true},{key:'horaAccidente',label:'Hora del accidente',type:'time',required:true},{key:'lugar',label:'Lugar exacto',required:true},{key:'tarea',label:'Tarea que realizaba',type:'textarea',required:true},{key:'descripcion',label:'Descripción de los hechos',type:'textarea',required:true},{key:'lesiones',label:'Lesiones aparentes / zona afectada',type:'textarea',required:true},{key:'testigos',label:'Testigos',type:'textarea'},{key:'medidas',label:'Medidas inmediatas adoptadas',type:'textarea',required:true},{key:'comunicadoA',label:'Comunicación realizada a',type:'textarea',required:true},{key:'asistencia',label:'Asistencia sanitaria / mutua',type:'textarea'},{key:'observaciones',label:'Observaciones adicionales',type:'textarea'}],body:(w,c,a)=>[
    `Trabajador/a: ${w?.apellidosNombre||'________________'} · DNI/NIE: ${w?.dni||'________________'} · Puesto: ${w?.categoria||'________________'} · Obra: ${c.obra}.`,
    `Fecha y hora del accidente: ${val(a,'fechaAccidente')} ${val(a,'horaAccidente')}. Lugar exacto: ${val(a,'lugar')}.`,
    `Tarea que realizaba: ${val(a,'tarea')}.`, `Descripción de los hechos: ${val(a,'descripcion')}.`,
    `Lesiones aparentes / zona afectada: ${val(a,'lesiones')}.`, `Testigos: ${val(a,'testigos','No indicados')}.`,
    `Medidas inmediatas adoptadas: ${val(a,'medidas')}.`, `Comunicación realizada a: ${val(a,'comunicadoA')}.`,
    `Asistencia sanitaria / mutua: ${val(a,'asistencia','No indicada')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureWorker:true,signatureCompany:true},
  certificado_trabajando_actualmente:{title:'CERTIFICADO DE PRESTACIÓN DE SERVICIOS ACTUAL',short:'Certificado trabajando actualmente',legal:'Certificación administrativa/laboral emitida a solicitud de la persona interesada, con los datos obrantes en GestionPROFEA. Debe ser validada y firmada por órgano o persona competente antes de su uso oficial.',fields:[{key:'destino',label:'Destino / finalidad del certificado',type:'textarea'},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `D./D.ª ${c.supervisor||'________________'}, en calidad de supervisor/a de ${c.empresa}, CERTIFICA:`,
    `Que ${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, figura prestando servicios actualmente en la obra ${c.obra}, con la categoría/puesto de ${w?.categoria||'________________'}, desde ${w?.periodoInicio||'________________'} y con fecha prevista de finalización ${w?.periodoFin||'________________'}, según los datos disponibles en la aplicación.`,
    `Finalidad/destino: ${val(a,'destino','A los efectos oportunos')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureCompany:true},
  certificado_servicios_prestados:{title:'CERTIFICADO DE SERVICIOS PRESTADOS',short:'Certificado de haber trabajado',legal:'Certificación emitida a partir de los datos de contratación disponibles. Para efectos administrativos oficiales deberá ser revisada y firmada por el órgano o unidad competente.',fields:[{key:'destino',label:'Destino / finalidad del certificado',type:'textarea'},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `D./D.ª ${c.supervisor||'________________'}, en calidad de supervisor/a de ${c.empresa}, CERTIFICA:`,
    `Que ${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, ha prestado servicios en la obra ${c.obra||w?.obra||'________________'}, con categoría/puesto ${w?.categoria||'________________'}, durante el periodo comprendido entre ${w?.periodoInicio||'________________'} y ${w?.periodoFin||'________________'}, según los registros disponibles.`,
    `Finalidad/destino: ${val(a,'destino','A los efectos oportunos')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureCompany:true}
};
