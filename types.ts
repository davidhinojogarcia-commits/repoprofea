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
  formacion: string; // 'Sí' | 'No'
  lugarFormacion?: string;
  citaDia: string;
  citaHora: string;
  sitioReconocimiento: string;
  documentacionCompleta: string; // 'Sí' | 'No'
  observaciones?: string;
  fechaRegistro: string;
  documentos?: File[]; 
  sincronizadoEnNube?: boolean;
  necesitaReconocimiento?: string; // 'Sí' | 'No'
  // Reconocimiento Médico y Aptitud
  aptitudMedica?: 'Apto' | 'No Apto' | 'Apto con limitaciones' | 'Pendiente' | string;
  limitacionesAptitud?: string;
  reconocimientoEstado?: 'Apto' | 'No Apto' | 'Apto con Limitación' | 'Pendiente' | string;
  reconocimientoFecha?: string;
  reconocimientoValidez?: string;
  reconocimientoLimitaciones?: string;
  reconocimientoObservaciones?: string;
}

export const getAptitudMedicaInfo = (p: Person): {
  estado: 'Apto' | 'No Apto' | 'Apto con limitaciones' | 'Pendiente';
  limitaciones: string;
  validez: string;
} => {
  const rawEstado = (p.aptitudMedica || p.reconocimientoEstado || 'Pendiente').trim();
  let estado: 'Apto' | 'No Apto' | 'Apto con limitaciones' | 'Pendiente' = 'Pendiente';
  
  if (rawEstado.toLowerCase().includes('limitaci')) {
    estado = 'Apto con limitaciones';
  } else if (rawEstado.toLowerCase() === 'apto') {
    estado = 'Apto';
  } else if (rawEstado.toLowerCase() === 'no apto') {
    estado = 'No Apto';
  } else {
    estado = 'Pendiente';
  }

  const limitaciones = (p.limitacionesAptitud || p.reconocimientoLimitaciones || '').trim();
  const validez = p.reconocimientoValidez || new Date().getFullYear().toString();

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

export interface DeletedPerson {
  person: Person;
  fechaEliminacion: string; // ISO string representing when it was deleted
}

export interface PdfCustomConfig {
  headerLine1: string;
  headerLine2: string;
  footerText: string;
  customLogo?: string;
  showTimestamp?: boolean;
  showPageNumbers?: boolean;
}

// Subcontratas de Obra y CAE (Coordinación de Actividades Empresariales)
export type SubcontrataDocEstado = 'entregado' | 'pendiente' | 'caducado' | 'incompleto' | 'no_aplica';
export type SubcontrataDocCategoria = 'empresa' | 'trabajadores' | 'maquinaria';
export type SubcontrataEstadoExpediente = 'apto' | 'pendiente' | 'denegado' | 'condicionado';

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
  pendientesDeAcreditar: {
    id: number;
    apellidosNombre: string;
    dni: string;
    categoria: string;
  }[];
  porcentajeAcreditacion: number;
}

export interface DocumentoIlegibleAlerta {
  archivo: string;
  motivo: string;
  docRelacionado?: string;
  confianza: 'alta' | 'media' | 'baja';
}

export interface ObraRecursoPreventivo {
  obra: string;
  recursoPreventivoNombre: string;
  recursoPreventivoCategoria: string; // Habitualmente "Encargado de Obra"
}

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
  alertasCaducidad?: string[];
  documentosIlegibles?: DocumentoIlegibleAlerta[];
  error?: string;
}
