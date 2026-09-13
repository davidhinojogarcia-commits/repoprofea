export interface Person {
  id: number;
  supervisorResponsable: string;
  numOferta: string;
  obra: string;
  categoria: string; 
  quincena: string;
  apellidosNombre: string;
  dni: string;
  fechaNacimiento: string;
  periodoInicio: string;
  periodoFin: string;
  telefono: string;
  calzado: string;
  formacion: string;
  lugarFormacion?: string;
  citaDia: string;
  citaHora: string;
  sitioReconocimiento: string;
  documentacionCompleta: string;
  observaciones?: string;
  fechaRegistro: string;
  documentos?: File[]; 
  sincronizadoEnNube?: boolean;
  necesitaReconocimiento?: string;
  aptitudMedica?: 'Apto' | 'No Apto' | 'Apto con limitaciones' | 'Pendiente' | string;
  limitacionesAptitud?: string;
  reconocimientoEstado?: 'Apto' | 'No Apto' | 'Apto con Limitación' | 'Pendiente' | string;
  reconocimientoFecha?: string;
  reconocimientoValidez?: string;
  reconocimientoLimitaciones?: string;
  reconocimientoObservaciones?: string;
  ownerId?: string;
  ownerDisplayName?: string;
}

const safeText = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

export const getAptitudMedicaInfo = (p: Person): {
  estado: 'Apto' | 'No Apto' | 'Apto con limitaciones' | 'Pendiente';
  limitaciones: string;
  validez: string;
} => {
  const rawEstado = safeText(p.aptitudMedica) || safeText(p.reconocimientoEstado) || 'Pendiente';
  const normalized = rawEstado.toLowerCase();
  let estado: 'Apto' | 'No Apto' | 'Apto con limitaciones' | 'Pendiente' = 'Pendiente';
  if (normalized.includes('limitaci')) estado = 'Apto con limitaciones';
  else if (normalized === 'apto') estado = 'Apto';
  else if (normalized === 'no apto') estado = 'No Apto';
  const limitaciones = safeText(p.limitacionesAptitud) || safeText(p.reconocimientoLimitaciones);
  const validez = safeText(p.reconocimientoValidez) || new Date().getFullYear().toString();
  return { estado, limitaciones, validez };
};

export interface MedicalRecordImportItem {
  dni: string;
  apellidosNombre: string;
  resultado: 'Apto' | 'No Apto' | 'Apto con Limitación' | 'Pendiente' | string;
  limitaciones?: string;
  fechaReconocimiento?: string;
  validez?: string;
  centroMedico?: string;
  observaciones?: string;
  confianza?: 'alta' | 'media' | 'baja';
  dniValido?: boolean;
  fechaValida?: boolean;
  centroValido?: boolean;
  inconsistencias?: string[];
  matchedPersonId?: number;
  matchedPersonName?: string;
  archivoOrigen?: string;
}

export interface StatsData {
  total: number;
  conFormacion: number;
  citasPendientes: number;
  totalObras: number; 
  trabajadoresRepetidos: number;
  formacionesReincorporacion?: number;
  desgloseQuincena: { [key: string]: number };
  desgloseObra: { [key: string]: number }; 
}

export interface DeletedPerson { person: Person; fechaEliminacion: string; }

export interface PdfCustomConfig {
  headerLine1: string;
  headerLine2: string;
  footerText: string;
  customLogo?: string;
  showTimestamp?: boolean;
  showPageNumbers?: boolean;
}

export type SubcontrataDocEstado = 'entregado' | 'pendiente' | 'caducado' | 'incompleto' | 'no_aplica';
export type SubcontrataDocCategoria = 'empresa' | 'trabajadores' | 'maquinaria';
export type SubcontrataEstadoExpediente = 'apto' | 'pendiente' | 'denegado' | 'condicionado';
export type LibroSubcontratacionEstado = 'registrado' | 'no_registrado';
export type SubcontrataTrabajadorEstadoAcceso = 'autorizado' | 'no_autorizado';

export interface SubcontrataTrabajadorCAE {
  id: string;
  nombreApellidos: string;
  dni: string;
  puestoTrabajo: string;
  estadoAcceso: SubcontrataTrabajadorEstadoAcceso;
  motivosNoAutorizado: string[];
  documentosAcreditados: string[];
  archivosOrigen?: string[];
  confianza?: 'alta' | 'media' | 'baja';
  confirmadoPorUsuario?: boolean;
}

export interface SubcontrataDocItem {
  id: string;
  categoria: SubcontrataDocCategoria;
  nombre: string;
  descripcion: string;
  normativa: string;
  obligatorio: boolean;
  estado: SubcontrataDocEstado;
  fechaEntrega?: string;
  fechaCaducidad?: string;
  observaciones?: string;
  documentoNombre?: string;
  detectadoPorIA?: boolean;
  validezIA?: string;
  esLegible?: boolean;
  solicitarReintento?: boolean;
  diasValidez?: number;
  mesesValidez?: number;
}

export interface Subcontratista {
  id: string;
  nombreEmpresa: string;
  cif: string;
  obra: string;
  municipio?: string;
  personaContacto: string;
  telefono: string;
  email: string;
  actividadGremio: string;
  fechaInicioPrevista?: string;
  supervisorResponsable?: string;
  recursoPreventivo?: string;
  numeroTrabajadoresPrevistos?: number;
  estadoExpediente: SubcontrataEstadoExpediente;
  checklist: SubcontrataDocItem[];
  fechaRegistro: string;
  fechaActualizacion: string;
  notas?: string;
  libroSubcontratacionEstado?: LibroSubcontratacionEstado;
  trabajadoresCae?: SubcontrataTrabajadorCAE[];
}

export interface SubcontrataDocAnalysisResult {
  docId: string;
  nombreDetectado?: string;
  estado: SubcontrataDocEstado;
  fechaEmision?: string;
  fechaCaducidad?: string;
  estaCaducado?: boolean;
  diasCaducado?: number;
  diasRestantes?: number;
  esProximaCaducidad?: boolean;
  motivoCaducidad?: string;
  empresaDetectada?: string;
  cifDetectado?: string;
  observaciones?: string;
  archivoOrigen?: string;
  confianza?: 'alta' | 'media' | 'baja';
  esLegible?: boolean;
  motivoIlegible?: string;
  solicitarReintento?: boolean;
}

export interface WorkerComparisonItem {
  nombreDetectado: string;
  dniDetectado?: string;
  archivoOrigen?: string;
  coincideConObra: boolean;
  trabajadorObraId?: number;
  nombreEnObra?: string;
  dniEnObra?: string;
  categoriaEnObra?: string;
  estadoCotejo: 'coincidente' | 'no_registrado' | 'diferencia_dni' | 'empresa_principal_prohibido';
  detalles?: string;
  esTrabajadorEmpresaPrincipal?: boolean;
  prohibidoEnSubcontrata?: boolean;
}

export interface WorkerObraComparisonSummary {
  totalTrabajadoresObra: number;
  totalDetectadosEnDocs: number;
  coincidentes: WorkerComparisonItem[];
  noRegistradosEnObra: WorkerComparisonItem[];
  trabajadoresEmpresaPrincipalDetectados?: WorkerComparisonItem[];
  pendientesDeAcreditar: { id: number; apellidosNombre: string; dni: string; categoria: string; }[];
  porcentajeAcreditacion: number;
}

export interface DocumentoIlegibleAlerta {
  archivo: string;
  motivo: string;
  docRelacionado?: string;
  confianza: 'alta' | 'media' | 'baja';
}

export interface ObraRecursoPreventivo { obra: string; recursoPreventivoNombre: string; recursoPreventivoCategoria: string; }

export interface ReporteTecnicoConfig {
  tecnicoNombre: string;
  coordinadorNombre: string;
  empresaCoordinacion: string;
  supervisorNombre?: string;
}

export interface SubcontrataAnalysisResponse {
  success: boolean;
  documentosAnalizados: SubcontrataDocAnalysisResult[];
  resumenDiagnostico: string;
  veredictoAcceso: 'APTO' | 'DENEGADO' | 'CONDICIONADO';
  relacionFaltantes: string[];
  textoRequerimiento: string;
  comparativaTrabajadores?: WorkerObraComparisonSummary;
  trabajadoresEmpresaPrincipalDetectados?: WorkerComparisonItem[];
  trabajadoresDetectados?: SubcontrataTrabajadorCAE[];
  alertasCaducidad?: string[];
  documentosIlegibles?: DocumentoIlegibleAlerta[];
  error?: string;
}

export type UserRole = 'admin' | 'user';

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  password?: string;
  displayName: string;
  role: UserRole;
  departamento?: string;
  createdAt: string;
  lastLoginAt?: string;
  avatarUrl?: string;
  workersCount?: number;
}
