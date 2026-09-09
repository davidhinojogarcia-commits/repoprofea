import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

// Users table authenticated via Firebase Auth
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').default('user'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Obras catalog and assigned preventive resource
export const obras = pgTable('obras', {
  id: serial('id').primaryKey(),
  nombre: text('nombre').notNull().unique(),
  recursoPreventivoNombre: text('recurso_preventivo_nombre'),
  recursoPreventivoCategoria: text('recurso_preventivo_categoria').default('Encargado de Obra'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Workers / Personal PROFEA registered in works
export const workers = pgTable('workers', {
  id: serial('id').primaryKey(),
  supervisorResponsable: text('supervisor_responsable'),
  numOferta: text('num_oferta'),
  obra: text('obra').notNull(),
  categoria: text('categoria'),
  quincena: text('quincena'),
  apellidosNombre: text('apellidos_nombre').notNull(),
  dni: text('dni').notNull(),
  fechaNacimiento: text('fecha_nacimiento'),
  periodoInicio: text('periodo_inicio'),
  periodoFin: text('periodo_fin'),
  telefono: text('telefono'),
  calzado: text('calzado'),
  formacion: text('formacion').default('No'),
  lugarFormacion: text('lugar_formacion'),
  citaDia: text('cita_dia'),
  citaHora: text('cita_hora'),
  sitioReconocimiento: text('sitio_reconocimiento'),
  documentacionCompleta: text('documentacion_completa').default('No'),
  observaciones: text('observaciones'),
  fechaRegistro: text('fecha_registro'),
  necesitaReconocimiento: text('necesita_reconocimiento'),
  aptitudMedica: text('aptitud_medica'),
  limitacionesAptitud: text('limitaciones_aptitud'),
  reconocimientoEstado: text('reconocimiento_estado'),
  reconocimientoFecha: text('reconocimiento_fecha'),
  reconocimientoValidez: text('reconocimiento_validez'),
  reconocimientoLimitaciones: text('reconocimiento_limitaciones'),
  reconocimientoObservaciones: text('reconocimiento_observaciones'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Subcontractors (CAE)
export const subcontratistas = pgTable('subcontratistas', {
  id: text('id').primaryKey(),
  nombreEmpresa: text('nombre_empresa').notNull(),
  cif: text('cif').notNull(),
  obra: text('obra').notNull(),
  municipio: text('municipio'),
  personaContacto: text('persona_contacto'),
  telefono: text('telefono'),
  email: text('email'),
  actividadGremio: text('actividad_gremio'),
  fechaInicioPrevista: text('fecha_inicio_prevista'),
  supervisorResponsable: text('supervisor_responsable'),
  recursoPreventivo: text('recurso_preventivo'),
  numeroTrabajadoresPrevistos: integer('numero_trabajadores_previstos'),
  estadoExpediente: text('estado_expediente').notNull().default('pendiente'),
  checklist: text('checklist').notNull(), // JSON stringified SubcontrataDocItem[]
  fechaRegistro: text('fecha_registro'),
  fechaActualizacion: text('fecha_actualizacion'),
  notas: text('notas'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// System / Report configurations
export const appConfig = pgTable('app_config', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(), // JSON serialized settings
  updatedAt: timestamp('updated_at').defaultNow(),
});
