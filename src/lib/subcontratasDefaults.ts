import { 
  SubcontrataDocItem, 
  Subcontratista, 
  SubcontrataEstadoExpediente,
  SubcontrataDocEstado,
  WorkerComparisonItem,
  WorkerObraComparisonSummary,
  ReporteTecnicoConfig,
  ObraRecursoPreventivo
} from '../../types';
export type { ReporteTecnicoConfig, ObraRecursoPreventivo };
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { renderPdfLogo, getStoredPdfConfig, formatDate } from './exportUtils';
import { loadSubcontratasPreferences, saveSubcontratasPreferences } from '../services/subcontratasPreferencesService';

export const DEFAULT_SUBCONTRATA_CHECKLIST: SubcontrataDocItem[] = [
  // --- DOCUMENTACIÓN DE LA EMPRESA SUBCONTRATISTA ---
  {
    id: 'rea',
    categoria: 'empresa',
    nombre: 'Inscripción en el REA (Registro de Empresas Acreditadas)',
    descripcion: 'Certificado oficial de inscripción o renovación en vigor. Acredita solvencia y formación preventiva.',
    normativa: 'Ley 32/2006 (art. 4) y Real Decreto 1109/2007',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'libro_subcontratacion',
    categoria: 'empresa',
    nombre: 'Libro de Subcontratación / Diligencia y Aprobación Previa',
    descripcion: 'Habilitación oficial en la obra con comunicación previa de subcontratación y régimen de niveles.',
    normativa: 'Ley 32/2006 (art. 8) y RD 1109/2007',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'adhesion_pss',
    categoria: 'empresa',
    nombre: 'Acta de Adhesión al Plan de Seguridad y Salud (PSS)',
    descripcion: 'Documento formal de adhesión expresa a las medidas del PSS de la obra por parte de la subcontrata.',
    normativa: 'RD 1627/1997 (art. 7) y Ley 31/1995',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'concierto_sprl',
    categoria: 'empresa',
    nombre: 'Concierto con Servicio de Prevención (SPRL) y Memoria',
    descripcion: 'Contrato vigente con Servicio de Prevención Ajeno o acreditación de servicio propio en las 4 especialidades.',
    normativa: 'Ley 31/1995 (art. 30) y RD 39/1997',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'cert_tgss',
    categoria: 'empresa',
    nombre: 'Certificado de estar al corriente con la Seg. Social (TGSS)',
    descripcion: 'Certificado positivo de estar al corriente en el pago de cuotas a la Seguridad Social (validez 3-6 meses).',
    normativa: 'Art. 42 del Estatuto de los Trabajadores',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'cert_aeat',
    categoria: 'empresa',
    nombre: 'Certificado de estar al corriente con Hacienda (AEAT)',
    descripcion: 'Certificado positivo de obligaciones tributarias para contratar e ingresar a obra (vigencia 12 meses).',
    normativa: 'Art. 43.1.f Ley General Tributaria',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'seguro_rc',
    categoria: 'empresa',
    nombre: 'Póliza y último recibo de Seguro de Resp. Civil (RC)',
    descripcion: 'Póliza en vigor con cobertura patronal y daños a terceros en obra, acompañada del justificante de pago.',
    normativa: 'Convenio General del Sector de la Construcción',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'recurso_preventivo',
    categoria: 'empresa',
    nombre: 'Designación formal de Recurso Preventivo en Obra',
    descripcion: 'Nombramiento por la empresa del trabajador que actuará como Recurso Preventivo (curso mín. 60h PRL).',
    normativa: 'Art. 32 bis Ley 31/1995 y DA 4ª Ley 32/2006',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'evaluacion_especifica',
    categoria: 'empresa',
    nombre: 'Planificación Preventiva y Evaluación Específica de Riesgos',
    descripcion: 'Evaluación y protocolo de seguridad para las fases y tareas concretas a desarrollar en esta obra.',
    normativa: 'Art. 16 Ley 31/1995 y RD 39/1997',
    obligatorio: true,
    estado: 'pendiente'
  },

  // --- DOCUMENTACIÓN DE LOS TRABAJADORES ---
  {
    id: 'altas_ss',
    categoria: 'trabajadores',
    nombre: 'Altas en la Seguridad Social de los Operarios (ITA/RLC/IDC)',
    descripcion: 'Acreditación de alta activa de todos los trabajadores de la subcontrata que acceden al centro de trabajo.',
    normativa: 'Art. 24 Ley 31/1995 y RD 171/2004 (CAE)',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'formacion_prl',
    categoria: 'trabajadores',
    nombre: 'Formación en PRL según Convenio de Construcción (TPC)',
    descripcion: 'Certificados oficiales de formación por oficio (20 horas o 6h) y formación de Recurso Preventivo (60h).',
    normativa: 'Convenio General del Sector de la Construcción',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'aptitud_medica',
    categoria: 'trabajadores',
    nombre: 'Certificados de Aptitud Médica Laboral en Vigor',
    descripcion: 'Reconocimiento médico anual con calificación APTO emitido por el SPRL sin caducar.',
    normativa: 'Art. 22 Ley 31/1995 de Prevención de Riesgos',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'entrega_epis',
    categoria: 'trabajadores',
    nombre: 'Justificante de entrega de EPIs firmado por los operarios',
    descripcion: 'Registro firmado de entrega de casco, calzado de seguridad S3, chaleco reflectante y EPIs específicos.',
    normativa: 'Real Decreto 773/1997',
    obligatorio: true,
    estado: 'pendiente'
  },
  {
    id: 'autorizacion_maquinaria',
    categoria: 'trabajadores',
    nombre: 'Autorización y acreditación para manejo de maquinaria',
    descripcion: 'Carné o habilitación expresa para manejo de dumper, carretillas, plataformas elevadoras, grúas, etc.',
    normativa: 'Real Decreto 1215/1997 (Anexo II)',
    obligatorio: false,
    estado: 'pendiente'
  },

  // --- DOCUMENTACIÓN DE MAQUINARIA Y EQUIPOS ---
  {
    id: 'marcado_ce_maquinaria',
    categoria: 'maquinaria',
    nombre: 'Marcado CE / Adecuación al Real Decreto 1215/1997',
    descripcion: 'Declaración CE de conformidad y manual de instrucciones de la maquinaria o equipos que acceden a obra.',
    normativa: 'RD 1215/1997 y Directiva de Máquinas 2006/42/CE',
    obligatorio: false,
    estado: 'no_aplica'
  },
  {
    id: 'seguro_itv_maquinaria',
    categoria: 'maquinaria',
    nombre: 'Seguro en vigor e Inspección Técnica / ITV de Maquinaria',
    descripcion: 'Póliza de seguro obligatoria y revisiones técnicas periódicas al día de los vehículos y equipos.',
    normativa: 'Real Decreto 1215/1997 y Reglamento General de Vehículos',
    obligatorio: false,
    estado: 'no_aplica'
  }
];

// Legacy key name retained only for source compatibility; no browser storage is read or written
export const CHECKLIST_TEMPLATE_STORAGE_KEY = 'profea_subcontratas_checklist_template';
let checklistTemplateCache: SubcontrataDocItem[] = DEFAULT_SUBCONTRATA_CHECKLIST.map(item => ({ ...item }));

// Pre-defined frequent construction documents for quick addition
export const PRESET_FREQUENT_DOCS: Omit<SubcontrataDocItem, 'estado'>[] = [
  {
    id: 'tc1_rlc_mensual',
    categoria: 'trabajadores',
    nombre: 'TC1 / Recibo de Liquidación de Cotizaciones (RLC) y RNT del mes',
    descripcion: 'Justificante mensual de pago de cotizaciones y relación nominal de trabajadores activos en el mes en curso.',
    normativa: 'Art. 42 Estatuto de los Trabajadores y Real Decreto 171/2004',
    obligatorio: true
  },
  {
    id: 'seguro_trc',
    categoria: 'empresa',
    nombre: 'Póliza y recibo de Seguro Todo Riesgo Construcción (TRC)',
    descripcion: 'Póliza con cobertura de obra y daños materiales durante la ejecución de los trabajos.',
    normativa: 'Pliego de Cláusulas Administrativas Particulares de la Obra',
    obligatorio: false
  },
  {
    id: 'declaracion_no_cadena',
    categoria: 'empresa',
    nombre: 'Declaración de cumplimiento del límite de subcontratación en cadena',
    descripcion: 'Acreditación formal de no sobrepasar el tercer nivel de subcontratación ni subcontratación de mano de obra intensiva.',
    normativa: 'Ley 32/2006 (art. 5) reguladora de la subcontratación',
    obligatorio: true
  },
  {
    id: 'trabajos_altura_especial',
    categoria: 'trabajadores',
    nombre: 'Certificado de formación para trabajos en altura / líneas de vida',
    descripcion: 'Acreditación teórico-práctica para montaje de andamios, cubiertas o trabajos con riesgo de caída a distinto nivel.',
    normativa: 'Real Decreto 2177/2004 (seguridad en trabajos temporales en altura)',
    obligatorio: false
  },
  {
    id: 'fichas_datos_seguridad',
    categoria: 'empresa',
    nombre: 'Fichas de Datos de Seguridad de Productos Químicos (FDS)',
    descripcion: 'Fichas técnicas y de seguridad de morteros especiales, resinas, disolventes o productos químicos empleados en obra.',
    normativa: 'Reglamento REACH (CE 1907/2006) y RD 374/2001',
    obligatorio: false
  },
  {
    id: 'plan_gestion_rcd',
    categoria: 'empresa',
    nombre: 'Plan de Gestión de Residuos de Construcción y Demolición (RCD)',
    descripcion: 'Documentación de entrega y gestión autorizada de escombros y residuos generados por la subcontrata.',
    normativa: 'Real Decreto 105/2008 regulador de la producción y gestión de RCD',
    obligatorio: false
  }
];

/**
 * Retrieves the stored customized checklist template, or falls back to DEFAULT_SUBCONTRATA_CHECKLIST
 */
export const getStoredChecklistTemplate = (): SubcontrataDocItem[] =>
  checklistTemplateCache.map(item => ({ ...item }));

/**
 * Saves a new customized checklist template to Supabase
 */
export const saveStoredChecklistTemplate = (template: SubcontrataDocItem[]): void => {
  checklistTemplateCache = template.map(item => ({ ...item, estado: item.estado || 'pendiente' }));
  void saveSubcontratasPreferences({ checklistTemplate: checklistTemplateCache }).catch(error =>
    console.warn('Error guardando plantilla de subcontratas en Supabase:', error)
  );
};

/**
 * Resets the stored template to the standard legal defaults
 */
export const resetStoredChecklistTemplate = (): SubcontrataDocItem[] => {
  checklistTemplateCache = DEFAULT_SUBCONTRATA_CHECKLIST.map(item => ({ ...item }));
  void saveSubcontratasPreferences({ checklistTemplate: checklistTemplateCache }).catch(error =>
    console.warn('Error restableciendo plantilla de subcontratas en Supabase:', error)
  );
  return checklistTemplateCache.map(item => ({ ...item }));
};

// ==========================================
// CONFIGURACIÓN DE FIRMAS Y REPORTES TÉCNICOS (CAE)
// ==========================================
export const REPORTE_TECNICO_CONFIG_STORAGE_KEY = 'profea_reporte_tecnico_config';
export const OBRAS_RECURSOS_PREVENTIVOS_STORAGE_KEY = 'profea_obras_recursos_preventivos';

export const DEFAULT_REPORTE_TECNICO_CONFIG: ReporteTecnicoConfig = {
  tecnicoNombre: 'David Hinojo García',
  coordinadorNombre: 'David Hinojo García',
  empresaCoordinacion: 'Área de Cooperación - Excma. Diputación Provincial de Cádiz',
  supervisorNombre: 'David Hinojo García'
};

let reporteTecnicoConfigCache: ReporteTecnicoConfig = { ...DEFAULT_REPORTE_TECNICO_CONFIG };
let obrasRecursosPreventivosCache: Record<string, ObraRecursoPreventivo> = {};
let subcontratasPreferencesHydrated = false;

export const hydrateStoredSubcontratasPreferences = async (): Promise<void> => {
  if (subcontratasPreferencesHydrated) return;
  const remote = await loadSubcontratasPreferences();
  let effective = remote;

  if (Array.isArray(effective.checklistTemplate) && effective.checklistTemplate.length) {
    checklistTemplateCache = effective.checklistTemplate.map((item: any) => ({ ...item, estado: item.estado || 'pendiente' }));
  }
  reporteTecnicoConfigCache = {
    ...DEFAULT_REPORTE_TECNICO_CONFIG,
    ...(effective.reporteTecnicoConfig || {}),
  };
  obrasRecursosPreventivosCache = effective.obrasRecursosPreventivos && typeof effective.obrasRecursosPreventivos === 'object'
    ? { ...effective.obrasRecursosPreventivos }
    : {};

  subcontratasPreferencesHydrated = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('profea_reporte_tecnico_config_changed', { detail: reporteTecnicoConfigCache }));
    window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: obrasRecursosPreventivosCache }));
  }
};

/**
 * Retrieves the global technician and coordinator signature configuration
 */
export const getStoredReporteTecnicoConfig = (): ReporteTecnicoConfig => ({ ...reporteTecnicoConfigCache });

/**
 * Saves the global technician and coordinator signature configuration
 */
export const saveStoredReporteTecnicoConfig = (config: Partial<ReporteTecnicoConfig>): ReporteTecnicoConfig => {
  reporteTecnicoConfigCache = { ...reporteTecnicoConfigCache, ...config };
  void saveSubcontratasPreferences({ reporteTecnicoConfig: reporteTecnicoConfigCache }).catch(error =>
    console.warn('Error guardando configuración de informe en Supabase:', error)
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('profea_reporte_tecnico_config_changed', { detail: reporteTecnicoConfigCache }));
  }
  return { ...reporteTecnicoConfigCache };
};

/**
 * Retrieves the mapping of obra names to assigned Recurso Preventivo and Category
 */
export const getStoredObrasRecursosPreventivos = (): Record<string, ObraRecursoPreventivo> => ({ ...obrasRecursosPreventivosCache });

/**
 * Saves or updates the assigned Recurso Preventivo for a specific obra
 */
export const saveStoredObraRecursoPreventivo = (
  obra: string,
  recursoPreventivoNombre: string,
  recursoPreventivoCategoria: string = 'Encargado de Obra'
): void => {
  if (!obra || !obra.trim()) return;
  obrasRecursosPreventivosCache = {
    ...obrasRecursosPreventivosCache,
    [obra.trim()]: {
      obra: obra.trim(),
      recursoPreventivoNombre: recursoPreventivoNombre.trim(),
      recursoPreventivoCategoria: recursoPreventivoCategoria.trim() || 'Encargado de Obra'
    }
  };
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: obrasRecursosPreventivosCache }).catch(error =>
    console.warn('Error guardando recurso preventivo en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: obrasRecursosPreventivosCache }));
};

/**
 * Deletes the assigned Recurso Preventivo for an obra
 */
export const deleteStoredObraRecursoPreventivo = (obra: string): void => {
  if (!(obra in obrasRecursosPreventivosCache)) return;
  const next = { ...obrasRecursosPreventivosCache };
  delete next[obra];
  obrasRecursosPreventivosCache = next;
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: next }).catch(error =>
    console.warn('Error eliminando recurso preventivo en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: next }));
};

/**
 * Updates the obra key in the stored recursos preventivos dictionary when an obra is renamed
 */
export const replaceStoredObrasRecursosPreventivos = (value: Record<string, ObraRecursoPreventivo>): void => {
  obrasRecursosPreventivosCache = value && typeof value === 'object' ? { ...value } : {};
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: obrasRecursosPreventivosCache }).catch(error =>
    console.warn('Error reemplazando recursos preventivos en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: obrasRecursosPreventivosCache }));
};

export const updateStoredObraNameInRecursos = (oldName: string, newName: string): void => {
  if (!obrasRecursosPreventivosCache[oldName] || !newName.trim()) return;
  const next = { ...obrasRecursosPreventivosCache, [newName.trim()]: obrasRecursosPreventivosCache[oldName] };
  delete next[oldName];
  obrasRecursosPreventivosCache = next;
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: next }).catch(error =>
    console.warn('Error renombrando recurso preventivo en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: next }));
};

/**
 * Synchronizes an existing subcontrata checklist against an updated template.
 * Preserves existing status (entregado, caducado, etc.), delivery dates,
 * expiration dates, observations, and AI flags, while updating names,
 * categories, obligations, and adding newly added template items.
 */
export const syncSubcontrataChecklistWithTemplate = (
  currentChecklist: SubcontrataDocItem[],
  template: SubcontrataDocItem[]
): SubcontrataDocItem[] => {
  const currentMap = new Map<string, SubcontrataDocItem>();
  currentChecklist.forEach(item => {
    currentMap.set(item.id, item);
  });

  return template.map(templateItem => {
    const existing = currentMap.get(templateItem.id);
    if (existing) {
      return {
        ...existing,
        nombre: templateItem.nombre,
        categoria: templateItem.categoria,
        descripcion: templateItem.descripcion,
        normativa: templateItem.normativa,
        obligatorio: templateItem.obligatorio
      };
    }

    // New item added from template
    return {
      ...templateItem,
      estado: templateItem.categoria === 'maquinaria' && !templateItem.obligatorio ? 'no_aplica' : 'pendiente'
    };
  });
};

export const createNewSubcontratista = (
  obra: string,
  supervisorResponsable?: string,
  data?: Partial<Subcontratista>
): Subcontratista => {
  const now = new Date().toISOString();
  return {
    id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    nombreEmpresa: data?.nombreEmpresa || '',
    cif: data?.cif ? data.cif.trim().toUpperCase() : '',
    obra: obra || '',
    municipio: data?.municipio || '',
    personaContacto: data?.personaContacto || '',
    telefono: data?.telefono || '',
    email: data?.email || '',
    actividadGremio: data?.actividadGremio || 'Instalaciones y Albañilería',
    fechaInicioPrevista: data?.fechaInicioPrevista || '',
    supervisorResponsable: supervisorResponsable || data?.supervisorResponsable || '',
    recursoPreventivo: data?.recursoPreventivo || '',
    numeroTrabajadoresPrevistos: data?.numeroTrabajadoresPrevistos || 1,
    estadoExpediente: 'pendiente',
    checklist: data?.checklist ? data.checklist.map(item => ({ ...item })) : DEFAULT_SUBCONTRATA_CHECKLIST.map(item => ({ ...item })),
    fechaRegistro: now,
    fechaActualizacion: now,
    notas: data?.notas || ''
  };
};

export const getSubcontrataCompliance = (sub: Subcontratista) => {
  const activeItems = sub.checklist.filter(i => i.estado !== 'no_aplica');
  const mandatoryItems = sub.checklist.filter(i => i.obligatorio && i.estado !== 'no_aplica');
  
  const entregados = activeItems.filter(i => i.estado === 'entregado').length;
  const pendientes = activeItems.filter(i => i.estado === 'pendiente').length;
  const caducados = activeItems.filter(i => i.estado === 'caducado' || i.estado === 'incompleto').length;
  
  const mandatoryMissing = mandatoryItems.filter(i => i.estado === 'pendiente' || i.estado === 'caducado' || i.estado === 'incompleto');
  
  const total = activeItems.length;
  const porcentaje = total > 0 ? Math.round((entregados / total) * 100) : 0;
  
  let estadoSugerido: SubcontrataEstadoExpediente = 'pendiente';
  if (mandatoryMissing.length === 0 && caducados === 0 && entregados > 0) {
    estadoSugerido = 'apto';
  } else if (mandatoryMissing.length > 3) {
    estadoSugerido = 'denegado';
  } else if (mandatoryMissing.length > 0 || caducados > 0) {
    estadoSugerido = 'condicionado';
  }

  return {
    total,
    entregados,
    pendientes,
    caducados,
    porcentaje,
    mandatoryMissingCount: mandatoryMissing.length,
    estadoSugerido
  };
};

export const generateRequerimientoText = (
  sub: Subcontratista,
  obraNombre: string,
  supervisorNombre: string
): string => {
  const compliance = getSubcontrataCompliance(sub);
  const faltantes = sub.checklist.filter(i => i.estado === 'pendiente');
  const caducadosOIncompletos = sub.checklist.filter(i => i.estado === 'caducado' || i.estado === 'incompleto');
  
  const fechaHoy = new Date().toLocaleDateString('es-ES', { 
    day: '2-digit', 
    month: 'long', 
    year: 'numeric' 
  });

  let texto = `REQUERIMIENTO DE DOCUMENTACIÓN PREVIA AL ACCESO A OBRA\n`;
  texto += `DIPUTACIÓN PROVINCIAL DE CÁDIZ - COORDINACIÓN DE SEGURIDAD Y SALUD / PROFEA\n`;
  texto += `Fecha: ${fechaHoy}\n\n`;
  texto += `A/A: ${sub.nombreEmpresa || 'Empresa Subcontratista'} (CIF: ${sub.cif || 'No especificado'})\n`;
  if (sub.personaContacto) texto += `Atención: ${sub.personaContacto}\n`;
  texto += `Obra de destino: ${obraNombre || sub.obra || 'Obra no especificada'}\n`;
  if (supervisorNombre) texto += `Supervisor / Responsable de Obra: ${supervisorNombre}\n`;
  if (sub.fechaInicioPrevista) texto += `Fecha prevista de inicio de trabajos: ${formatDate(sub.fechaInicioPrevista)}\n`;
  texto += `Actividad / Gremio: ${sub.actividadGremio || 'Subcontratista'}\n\n`;

  texto += `Estimados señores:\n\n`;
  texto += `En aplicación de lo estipulado en la Ley 32/2006 reguladora de la subcontratación en el Sector de la Construcción, el Real Decreto 1109/2007, y el Real Decreto 171/2004 en materia de Coordinación de Actividades Empresariales (CAE), les comunicamos que se ha procedido a la revisión del expediente documental de su empresa previo a la autorización de entrada de sus operarios y equipos a la obra.\n\n`;

  if (faltantes.length > 0) {
    texto += `🔴 DOCUMENTACIÓN PENDIENTE DE ENTREGA:\n`;
    faltantes.forEach((item, idx) => {
      texto += `  ${idx + 1}. ${item.nombre} [${item.normativa}]\n`;
      if (item.descripcion) texto += `     - Requisito: ${item.descripcion}\n`;
    });
    texto += `\n`;
  }

  if (caducadosOIncompletos.length > 0) {
    texto += `⚠️ DOCUMENTACIÓN CADUCADA O INCOMPLETA QUE REQUIERE SUBSANACIÓN:\n`;
    caducadosOIncompletos.forEach((item, idx) => {
      const motivo = item.estado === 'caducado' ? 'CADUCADO / VENCIDO' : 'INCOMPLETO / DEFICIENTE';
      texto += `  ${idx + 1}. ${item.nombre} (${motivo})\n`;
      if (item.fechaCaducidad) texto += `     - Fecha de vencimiento registrada: ${formatDate(item.fechaCaducidad)}\n`;
      if (item.observaciones) texto += `     - Observación técnica: ${item.observaciones}\n`;
    });
    texto += `\n`;
  }

  if (faltantes.length === 0 && caducadosOIncompletos.length === 0) {
    texto += `✅ Toda la documentación obligatoria se encuentra actualmente entregada y en regla. Su empresa está AUTORIZADA para el acceso y ejecución de los trabajos en la fecha estipulada.\n\n`;
  } else {
    texto += `⚠️ IMPORTANTE:\n`;
    texto += `De conformidad con la normativa de Prevención de Riesgos Laborales, NINGÚN TRABAJADOR O EQUIPO DE SU EMPRESA PODRÁ INICIAR LABORES en el centro de trabajo sin que la totalidad de los documentos señalados hayan sido aportados, validados y conformados de forma previa.\n\n`;
    texto += `Rogamos remitan la documentación subsanada a la mayor brevedad posible para formalizar la autorización de acceso.\n\n`;
  }

  texto += `Atentamente,\n`;
  texto += `${supervisorNombre || 'Supervisor / Técnico de Seguridad'}\n`;
  texto += `Excma. Diputación Provincial de Cádiz - Área de Cooperación PROFEA`;

  return texto;
};

export const generateSubcontrataReportPDF = async (
  sub: Subcontratista,
  supervisorResponsable?: string,
  customLogo?: string,
  options?: {
    tecnicoNombre?: string;
    coordinadorNombre?: string;
    empresaCoordinacion?: string;
    recursoPreventivoObra?: string;
    recursoPreventivoCategoria?: string;
  }
): Promise<void> => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const defaultCfg = getStoredReporteTecnicoConfig();
  const obrasRecursos = getStoredObrasRecursosPreventivos();
  const obraRecurso = sub.obra ? obrasRecursos[sub.obra] : undefined;

  const effectiveTecnico = options?.tecnicoNombre?.trim() || defaultCfg.tecnicoNombre || 'David Hinojo García';
  const effectiveCoordinador = options?.coordinadorNombre?.trim() || defaultCfg.coordinadorNombre || 'David Hinojo García';
  const effectiveEmpresa = options?.empresaCoordinacion?.trim() || defaultCfg.empresaCoordinacion || 'Área de Cooperación - Excma. Diputación Provincial de Cádiz';
  const effectiveRecursoNombre = options?.recursoPreventivoObra?.trim() || sub.recursoPreventivo?.trim() || obraRecurso?.recursoPreventivoNombre || '';
  const effectiveRecursoCategoria = options?.recursoPreventivoCategoria?.trim() || obraRecurso?.recursoPreventivoCategoria || 'Encargado de Obra';

  const config = getStoredPdfConfig();
  const compliance = getSubcontrataCompliance(sub);
  const supNombre = supervisorResponsable || sub.supervisorResponsable || defaultCfg.supervisorNombre || 'Supervisor Responsable';

  // Margins
  const marginLeft = 14;
  const marginRight = 14;
  const pageWidth = 210;
  const contentWidth = pageWidth - marginLeft - marginRight;

  // Header Logo & Institutional Title
  renderPdfLogo(doc, marginLeft, 10, 48, 12, false, customLogo);

  // Institutional text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 84, 142); // Dipu Blue #00548E
  doc.text(config.headerLine1 || 'EXCMA. DIPUTACIÓN PROVINCIAL DE CÁDIZ', pageWidth - marginRight, 12, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(config.headerLine2 || 'ÁREA DE COOPERACIÓN | GESTIÓN PROFEA', pageWidth - marginRight, 16, { align: 'right' });
  doc.text('COORDINACIÓN DE SEGURIDAD Y SALUD (CAE - LEY 32/2006)', pageWidth - marginRight, 20, { align: 'right' });

  // Blue divider bar
  doc.setDrawColor(0, 84, 142);
  doc.setLineWidth(0.8);
  doc.line(marginLeft, 24, pageWidth - marginRight, 24);

  // Document Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('INFORME DE CONTROL DOCUMENTAL DE SUBCONTRATA DE OBRA', marginLeft, 31);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const fechaHoyStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  doc.text(`Fecha de emisión: ${fechaHoyStr} ${horaStr} | Expediente Ref: ${sub.id.toUpperCase()}`, marginLeft, 36);

  // Status Banner Box (Apto / Condicionado / Denegado)
  let bannerBg = [239, 246, 255]; // Blue light
  let bannerBorder = [147, 197, 253];
  let bannerText = [30, 64, 175];
  let bannerTitle = 'ESTADO DEL ACCESO: PENDIENTE DE REVISIÓN';
  let bannerSub = 'La documentación obligatoria está en fase de aportación o revisión por el supervisor técnico.';

  if (sub.estadoExpediente === 'apto') {
    bannerBg = [236, 253, 245]; // Emerald
    bannerBorder = [16, 185, 129];
    bannerText = [6, 95, 70];
    bannerTitle = 'ESTADO DEL ACCESO: AUTORIZADO (APTO)';
    bannerSub = 'Toda la documentación legal requerida ha sido verificada y se encuentra conforme en vigor.';
  } else if (sub.estadoExpediente === 'denegado') {
    bannerBg = [254, 242, 242]; // Red
    bannerBorder = [239, 68, 68];
    bannerText = [153, 27, 27];
    bannerTitle = 'ESTADO DEL ACCESO: DENEGADO / NO AUTORIZADO';
    bannerSub = 'Faltan documentos preceptivos de seguridad o se detectan no conformidades que impiden el acceso a obra.';
  } else if (sub.estadoExpediente === 'condicionado') {
    bannerBg = [255, 251, 235]; // Amber
    bannerBorder = [245, 158, 11];
    bannerText = [146, 64, 14];
    bannerTitle = 'ESTADO DEL ACCESO: AUTORIZADO CONDICIONADO';
    bannerSub = 'Acceso temporal bajo compromiso de subsanación inmediata de las incidencias menores señaladas.';
  }

  doc.setFillColor(bannerBg[0], bannerBg[1], bannerBg[2]);
  doc.setDrawColor(bannerBorder[0], bannerBorder[1], bannerBorder[2]);
  doc.setLineWidth(0.6);
  doc.roundedRect(marginLeft, 40, contentWidth, 14, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(bannerText[0], bannerText[1], bannerText[2]);
  doc.text(bannerTitle, marginLeft + 4, 46);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(bannerSub, marginLeft + 4, 50.5);

  // Metadata Grid (2 Cards: Obra & Empresa)
  const metaY = 57;
  const colW = (contentWidth - 4) / 2;

  // Box 1: Datos de la Obra y Supervisor
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(marginLeft, metaY, colW, 28, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 84, 142);
  doc.text('DATOS DE LA OBRA', marginLeft + 3, metaY + 5);

  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Obra de destino:', marginLeft + 3, metaY + 10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(sub.obra || 'Sin asignar', marginLeft + 27, metaY + 10, { maxWidth: colW - 30 });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Municipio:', marginLeft + 3, metaY + 15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(sub.municipio || 'Provincia de Cádiz', marginLeft + 27, metaY + 15);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Supervisor:', marginLeft + 3, metaY + 20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(supNombre, marginLeft + 27, metaY + 20, { maxWidth: colW - 30 });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Inicio previsto:', marginLeft + 3, metaY + 25);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(sub.fechaInicioPrevista ? formatDate(sub.fechaInicioPrevista) : 'A determinar', marginLeft + 27, metaY + 25);

  // Box 2: Datos de la Subcontrata
  const col2X = marginLeft + colW + 4;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(col2X, metaY, colW, 28, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 84, 142);
  doc.text('DATOS DE LA EMPRESA SUBCONTRATISTA', col2X + 3, metaY + 5);

  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Razón Social:', col2X + 3, metaY + 10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(sub.nombreEmpresa || 'No especificada', col2X + 25, metaY + 10, { maxWidth: colW - 28 });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('CIF / NIF:', col2X + 3, metaY + 15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(sub.cif || 'Sin CIF', col2X + 25, metaY + 15);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Gremio/Actividad:', col2X + 3, metaY + 20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(sub.actividadGremio || 'Construcción', col2X + 25, metaY + 20, { maxWidth: colW - 28 });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Contacto / Tel:', col2X + 3, metaY + 25);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const contactLine = `${sub.personaContacto ? sub.personaContacto + ' · ' : ''}${sub.telefono || sub.email || '-'}`;
  doc.text(contactLine, col2X + 25, metaY + 25, { maxWidth: colW - 28 });

  // Compliance Summary Bar
  const statsY = metaY + 31;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(marginLeft, statsY, contentWidth, 7, 1.5, 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Cumplimiento Documental: ${compliance.porcentaje}%`, marginLeft + 3, statsY + 4.8);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Entregados y Conformes: ${compliance.entregados}  |  Pendientes: ${compliance.pendientes}  |  Caducados/Incidencias: ${compliance.caducados}  |  Total Evaluados: ${compliance.total}`,
    marginLeft + 52,
    statsY + 4.8
  );

  // Table with Checklist
  const tableData = sub.checklist.map((item, index) => {
    let estadoLabel = 'Pendiente';
    if (item.estado === 'entregado') estadoLabel = 'ENTREGADO (OK)';
    else if (item.estado === 'caducado') estadoLabel = 'CADUCADO';
    else if (item.estado === 'incompleto') estadoLabel = 'INCOMPLETO';
    else if (item.estado === 'no_aplica') estadoLabel = 'NO APLICA';

    const categoriaShort = item.categoria === 'empresa' ? 'Empresa' : item.categoria === 'trabajadores' ? 'Plantilla' : 'Maquinaria';
    
    let notasStr = item.observaciones || '';
    if (item.fechaCaducidad) {
      notasStr = (notasStr ? notasStr + ' | ' : '') + `Caduca: ${formatDate(item.fechaCaducidad)}`;
    }
    if (item.detectadoPorIA) {
      notasStr = (notasStr ? notasStr + ' | ' : '') + '✓ Verificado con IA';
    }

    return [
      (index + 1).toString(),
      categoriaShort,
      item.nombre,
      item.normativa,
      item.obligatorio ? 'Sí' : 'No',
      estadoLabel,
      notasStr || '-'
    ];
  });

  autoTable(doc, {
    startY: statsY + 10,
    head: [['Nº', 'Área', 'Documento Legal Requerido', 'Normativa', 'Oblig.', 'Estado', 'Vigencia / Observaciones']],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 6.8,
      cellPadding: 1.6,
      textColor: [30, 41, 59],
      valign: 'middle',
      lineWidth: 0.1,
      lineColor: [226, 232, 240]
    },
    headStyles: {
      fillColor: [0, 84, 142],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7
    },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      1: { cellWidth: 15, halign: 'center' },
      2: { cellWidth: 56 },
      3: { cellWidth: 28 },
      4: { cellWidth: 11, halign: 'center' },
      5: { cellWidth: 25, halign: 'center', fontStyle: 'bold' },
      6: { cellWidth: 40 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const val = String(data.cell.raw);
        if (val.includes('ENTREGADO')) {
          data.cell.styles.textColor = [5, 150, 105]; // Green
        } else if (val.includes('CADUCADO') || val.includes('INCOMPLETO')) {
          data.cell.styles.textColor = [220, 38, 38]; // Red
        } else if (val.includes('Pendiente')) {
          data.cell.styles.textColor = [217, 119, 6]; // Amber
        } else {
          data.cell.styles.textColor = [100, 116, 139]; // Gray
        }
      }
    }
  });

  // Footer & Signatures Block
  const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 6 : 240;
  
  if (finalY < 255) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Documento emitido conforme a la Ley 32/2006 reguladora de la subcontratación en el sector de la construcción y RD 1627/1997.',
      marginLeft,
      finalY + 2
    );

    // Signature boxes
    const sigY = finalY + 7;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.4);
    
    if (effectiveRecursoNombre) {
      const boxW = 43.5;
      const gap = 2.6;

      // Box 1: Supervisor de obra
      doc.roundedRect(marginLeft, sigY, boxW, 21, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(15, 23, 42);
      doc.text('Supervisor de obra:', marginLeft + 2, sigY + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Fdo: ${supNombre}`, marginLeft + 2, sigY + 17, { maxWidth: boxW - 4 });

      // Box 2: Recurso Preventivo (Encargado de Obra)
      const sig2X = marginLeft + boxW + gap;
      doc.roundedRect(sig2X, sigY, boxW, 21, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(15, 23, 42);
      doc.text('Recurso Preventivo:', sig2X + 2, sigY + 4);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(5.3);
      doc.setTextColor(0, 84, 142);
      doc.text(`Cargo: ${effectiveRecursoCategoria}`, sig2X + 2, sigY + 7.5, { maxWidth: boxW - 4 });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Fdo: ${effectiveRecursoNombre}`, sig2X + 2, sigY + 17, { maxWidth: boxW - 4 });

      // Box 3: Técnico de Obra
      const sig3X = sig2X + boxW + gap;
      doc.roundedRect(sig3X, sigY, boxW, 21, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(15, 23, 42);
      doc.text('Por el Técnico de Obra:', sig3X + 2, sigY + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Fdo: ${effectiveTecnico}`, sig3X + 2, sigY + 17, { maxWidth: boxW - 4 });

      // Box 4: Coordinación CSS con Empresa
      const sig4X = sig3X + boxW + gap;
      doc.roundedRect(sig4X, sigY, boxW, 21, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(15, 23, 42);
      doc.text('Coordinación CSS:', sig4X + 2, sigY + 4);
      if (effectiveEmpresa) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.2);
        doc.setTextColor(0, 84, 142);
        doc.text(`Empresa: ${effectiveEmpresa}`, sig4X + 2, sigY + 7.5, { maxWidth: boxW - 4 });
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Fdo: ${effectiveCoordinador}`, sig4X + 2, sigY + 17, { maxWidth: boxW - 4 });
    } else {
      // Box 1: Supervisor de obra
      doc.roundedRect(marginLeft, sigY, 58, 20, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(15, 23, 42);
      doc.text('Por el Supervisor de obra:', marginLeft + 2.5, sigY + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(71, 85, 105);
      doc.text(`Fdo: ${supNombre}`, marginLeft + 2.5, sigY + 16, { maxWidth: 53 });

      // Box 2: Técnico de Obra
      const sig2X = marginLeft + 62;
      doc.roundedRect(sig2X, sigY, 58, 20, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(15, 23, 42);
      doc.text('Por el Técnico de Obra:', sig2X + 2.5, sigY + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(71, 85, 105);
      doc.text(`Fdo: ${effectiveTecnico}`, sig2X + 2.5, sigY + 16, { maxWidth: 53 });

      // Box 3: Coordinación de Seguridad y Salud / Subcontratista
      const sig3X = sig2X + 62;
      doc.roundedRect(sig3X, sigY, 58, 20, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(15, 23, 42);
      if (effectiveCoordinador) {
        doc.text('Vº Bº Coordinación CSS:', sig3X + 2.5, sigY + 4);
        if (effectiveEmpresa) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(5.6);
          doc.setTextColor(0, 84, 142);
          doc.text(`Empresa: ${effectiveEmpresa}`, sig3X + 2.5, sigY + 8, { maxWidth: 53 });
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        doc.setTextColor(71, 85, 105);
        doc.text(`Fdo: ${effectiveCoordinador}`, sig3X + 2.5, sigY + 16, { maxWidth: 53 });
      } else {
        doc.text('Recibí y Conformidad:', sig3X + 2.5, sigY + 4);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        doc.setTextColor(71, 85, 105);
        doc.text(`Fdo: Rep. ${sub.nombreEmpresa || 'Subcontrata'}`, sig3X + 2.5, sigY + 16, { maxWidth: 53 });
      }
    }
  }

  // Page Numbers
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Página ${p} de ${totalPages} - Área de Cooperación PROFEA | Diputación Provincial de Cádiz`,
      pageWidth / 2,
      290,
      { align: 'center' }
    );
  }

  const cleanName = (sub.nombreEmpresa || 'subcontrata').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  doc.save(`informe_subcontrata_${cleanName}_${new Date().toISOString().slice(0, 10)}.pdf`);
};

export interface DocumentExpirationResult {
  estaCaducado: boolean;
  diasCaducado: number;
  diasRestantes: number;
  esProximaCaducidad: boolean;
  fechaCaducidadCalculada: string;
  motivoVencimiento: string;
  estadoSugerido: SubcontrataDocEstado;
}

/**
 * Strict legal evaluation of document expiration dates according to Spanish PRL/CAE legislation:
 * - TGSS: max 3 months (Art. 42 Estatuto de los Trabajadores)
 * - AEAT: max 12 months (Art. 43.1.f Ley General Tributaria)
 * - REA: max 3 years (Ley 32/2006 y RD 1109/2007)
 * - Aptitud Médica: max 12 months (anual)
 * - Seguro RC: hasta fecha de fin de vigencia / recibo anual
 */
/**
 * Robust helper to parse Spanish (DD/MM/YYYY, DD-MM-YYYY, textual) or ISO dates.
 */
export function parseSpanishOrIsoDate(dateRaw?: string): { date: Date | null; iso: string; isValid: boolean } {
  if (!dateRaw || typeof dateRaw !== 'string') {
    return { date: null, iso: '', isValid: false };
  }
  const s = dateRaw.trim();
  if (!s || /^(n[\/\\]a|no aplica|permanente|indefinid[oa]|duraci[oó]n|en vigor|vigente|-)$/i.test(s)) {
    return { date: null, iso: '', isValid: false };
  }

  // 1. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = s.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
      const padM = String(month).padStart(2, '0');
      const padD = String(day).padStart(2, '0');
      const iso = `${year}-${padM}-${padD}`;
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return { date: d, iso, isValid: true };
      }
    }
  }

  // 2. YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = s.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
      const padM = String(month).padStart(2, '0');
      const padD = String(day).padStart(2, '0');
      const iso = `${year}-${padM}-${padD}`;
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return { date: d, iso, isValid: true };
      }
    }
  }

  // 3. Spanish text date e.g. "15 de mayo de 2026"
  const spanishMonths: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };
  const textMatch = s.match(/(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\s+(?:de\s+)?(\d{4})/i);
  if (textMatch) {
    const day = parseInt(textMatch[1], 10);
    const mName = textMatch[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const month = spanishMonths[mName];
    const year = parseInt(textMatch[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
      const padM = String(month).padStart(2, '0');
      const padD = String(day).padStart(2, '0');
      const iso = `${year}-${padM}-${padD}`;
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return { date: d, iso, isValid: true };
      }
    }
  }

  // 4. Standard Date fallback
  const dFallback = new Date(s);
  if (!isNaN(dFallback.getTime()) && dFallback.getFullYear() >= 1990 && dFallback.getFullYear() <= 2099) {
    const iso = dFallback.toISOString().slice(0, 10);
    return { date: dFallback, iso, isValid: true };
  }

  return { date: null, iso: '', isValid: false };
}

/**
 * Strict evaluation of CAE document expiration according to Spanish PRL and public procurement regulations:
 * - TGSS: max 3 months (Art. 42 Estatuto de los Trabajadores)
 * - AEAT: max 12 months (Art. 43.1.f Ley General Tributaria)
 * - REA: max 3 years (Ley 32/2006 y RD 1109/2007)
 * - Aptitud Médica: max 12 months (anual)
 * - Seguro RC: 12 months (recibo anual)
 * - Non-expiring documents (Formación PRL, PSS, EPIs, Marcado CE, Contratos) do NOT expire annually.
 */
export function evaluateStrictExpiration(
  docId: string,
  fechaEmision?: string,
  fechaCaducidad?: string,
  referenceDate: Date = new Date()
): DocumentExpirationResult {
  const parsedCaducidad = parseSpanishOrIsoDate(fechaCaducidad);
  const parsedEmision = parseSpanishOrIsoDate(fechaEmision);

  let expDate: Date | null = null;
  let esCaducablePorLey = false;
  let expIso = '';

  // 1. Explicit expiration date takes highest precedence
  if (parsedCaducidad.isValid && parsedCaducidad.date) {
    expDate = parsedCaducidad.date;
    expIso = parsedCaducidad.iso;
    esCaducablePorLey = true;
  }

  // 2. Derive expiration from emission date ONLY for legal periodic renewal documents
  if (!expDate && parsedEmision.isValid && parsedEmision.date) {
    const em = parsedEmision.date;
    switch (docId) {
      case 'cert_tgss':
        // 3 months (Art. 42 ET)
        expDate = new Date(em);
        expDate.setMonth(expDate.getMonth() + 3);
        esCaducablePorLey = true;
        break;
      case 'cert_aeat':
        // 12 months (Art. 43.1.f LGT)
        expDate = new Date(em);
        expDate.setMonth(expDate.getMonth() + 12);
        esCaducablePorLey = true;
        break;
      case 'rea':
        // 3 years (Ley 32/2006)
        expDate = new Date(em);
        expDate.setFullYear(expDate.getFullYear() + 3);
        esCaducablePorLey = true;
        break;
      case 'aptitud_medica':
        // 1 year
        expDate = new Date(em);
        expDate.setFullYear(expDate.getFullYear() + 1);
        esCaducablePorLey = true;
        break;
      case 'seguro_rc':
      case 'seguro_itv_maquinaria':
        // 1 year (recibo anual)
        expDate = new Date(em);
        expDate.setFullYear(expDate.getFullYear() + 1);
        esCaducablePorLey = true;
        break;
      default:
        // Documentos permanentes o por obra (Formación PRL, PSS, EPIs, Contratos, etc.)
        // No caducan periódicamente
        expDate = null;
        esCaducablePorLey = false;
        break;
    }
    if (expDate) {
      expIso = expDate.toISOString().slice(0, 10);
    }
  }

  if (!expDate || !esCaducablePorLey) {
    return {
      estaCaducado: false,
      diasCaducado: 0,
      diasRestantes: 9999,
      esProximaCaducidad: false,
      fechaCaducidadCalculada: parsedCaducidad.iso || '',
      motivoVencimiento: 'Documento en vigor y conforme a normativa',
      estadoSugerido: 'entregado'
    };
  }

  const refStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const expStart = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());
  const diffTime = expStart.getTime() - refStart.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const expFormatted = expIso || expDate.toISOString().slice(0, 10);

  if (diffDays < 0) {
    const diasVencido = Math.abs(diffDays);
    return {
      estaCaducado: true,
      diasCaducado: diasVencido,
      diasRestantes: 0,
      esProximaCaducidad: false,
      fechaCaducidadCalculada: expFormatted,
      motivoVencimiento: `Documento caducado hace ${diasVencido} días (venció el ${expFormatted}). Requiere renovación inmediata según normativa.`,
      estadoSugerido: 'caducado'
    };
  }

  if (diffDays <= 30) {
    return {
      estaCaducado: false,
      diasCaducado: 0,
      diasRestantes: diffDays,
      esProximaCaducidad: true,
      fechaCaducidadCalculada: expFormatted,
      motivoVencimiento: `Válido pero con caducidad próxima: vence en ${diffDays} días (${expFormatted}). Se recomienda solicitar renovación anticipada.`,
      estadoSugerido: 'entregado'
    };
  }

  return {
    estaCaducado: false,
    diasCaducado: 0,
    diasRestantes: diffDays,
    esProximaCaducidad: false,
    fechaCaducidadCalculada: expFormatted,
    motivoVencimiento: `En vigor y con validez suficiente hasta el ${expFormatted} (${diffDays} días restantes).`,
    estadoSugerido: 'entregado'
  };
}

/**
 * Robust cross-comparison of worker names and DNIs detected in documents against the official list of workers assigned to the active obra.
 */
export function compareWorkersAgainstObra(
  detectedWorkers: { nombre: string; dni?: string; archivoOrigen?: string }[],
  obraWorkers: { id: number; apellidosNombre: string; dni: string; categoria?: string }[]
): WorkerObraComparisonSummary {
  const normalize = (str: string) => {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 1);
  };

  const cleanDni = (dni: string) => (dni || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

  const coincidentes: WorkerComparisonItem[] = [];
  const noRegistradosEnObra: WorkerComparisonItem[] = [];
  const matchedObraWorkerIds = new Set<number>();

  detectedWorkers.forEach(det => {
    const detWords = normalize(det.nombre);
    const detDniClean = cleanDni(det.dni || '');

    // Try finding exact DNI match first
    let matchedWorker = obraWorkers.find(w => {
      if (detDniClean && cleanDni(w.dni) === detDniClean) return true;
      return false;
    });

    // If no DNI match, fuzzy compare name tokens
    if (!matchedWorker && detWords.length >= 2) {
      matchedWorker = obraWorkers.find(w => {
        const obraWords = normalize(w.apellidosNombre);
        if (obraWords.length === 0) return false;
        const common = detWords.filter(dw => obraWords.includes(dw));
        return common.length >= 2 || (common.length >= 1 && detWords.length === 1 && obraWords.length === 1);
      });
    }

    if (matchedWorker) {
      matchedObraWorkerIds.add(matchedWorker.id);
      coincidentes.push({
        nombreDetectado: det.nombre,
        dniDetectado: det.dni || matchedWorker.dni,
        archivoOrigen: det.archivoOrigen,
        coincideConObra: true,
        trabajadorObraId: matchedWorker.id,
        nombreEnObra: matchedWorker.apellidosNombre,
        dniEnObra: matchedWorker.dni,
        categoriaEnObra: matchedWorker.categoria,
        estadoCotejo: 'coincidente',
        detalles: `Trabajador verificado en el censo de la obra: ${matchedWorker.apellidosNombre} (${matchedWorker.dni}).`
      });
    } else {
      noRegistradosEnObra.push({
        nombreDetectado: det.nombre,
        dniDetectado: det.dni,
        archivoOrigen: det.archivoOrigen,
        coincideConObra: false,
        estadoCotejo: 'no_registrado',
        detalles: `¡ALERTA DE SEGURIDAD!: No figura adscrito a la lista de la obra. Riesgo de personal no autorizado.`
      });
    }
  });

  const pendientesDeAcreditar = obraWorkers
    .filter(w => !matchedObraWorkerIds.has(w.id))
    .map(w => ({
      id: w.id,
      apellidosNombre: w.apellidosNombre,
      dni: w.dni,
      categoria: w.categoria || 'Operario'
    }));

  const totalTrabajadoresObra = obraWorkers.length;
  const porcentajeAcreditacion = totalTrabajadoresObra > 0
    ? Math.round((matchedObraWorkerIds.size / totalTrabajadoresObra) * 100)
    : 100;

  return {
    totalTrabajadoresObra,
    totalDetectadosEnDocs: detectedWorkers.length,
    coincidentes,
    noRegistradosEnObra,
    pendientesDeAcreditar,
    porcentajeAcreditacion
  };
}

export interface ObraConsolidatedReportOptions {
  tecnicoNombre?: string;
  coordinadorNombre?: string;
  empresaCoordinacion?: string;
  recursoPreventivoObra?: string;
  recursoPreventivoCategoria?: string;
}

/**
 * Generate official consolidated PDF report for an entire Obra with all its subcontractors,
 * following the official Diputación de Cádiz corporate layout, showing compliance rates,
 * supervisor, obra metadata, and detailed breakdown of delivered and missing checklist documents.
 */
export const generateObraConsolidatedReportPDF = async (
  obraNombre: string,
  subcontratasInObra: Subcontratista[],
  supervisorNombre?: string,
  options?: ObraConsolidatedReportOptions
) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const defaultCfg = getStoredReporteTecnicoConfig();
  const obrasRecursos = getStoredObrasRecursosPreventivos();
  const obraRecurso: Partial<ObraRecursoPreventivo> = obrasRecursos[obraNombre] || {};

  const effectiveOptions: ObraConsolidatedReportOptions = {
    tecnicoNombre: options?.tecnicoNombre?.trim() || defaultCfg.tecnicoNombre || 'David Hinojo García',
    coordinadorNombre: options?.coordinadorNombre?.trim() || defaultCfg.coordinadorNombre || 'David Hinojo García',
    empresaCoordinacion: options?.empresaCoordinacion?.trim() || defaultCfg.empresaCoordinacion || 'Área de Cooperación - Excma. Diputación Provincial de Cádiz',
    recursoPreventivoObra: options?.recursoPreventivoObra?.trim() || obraRecurso.recursoPreventivoNombre || '',
    recursoPreventivoCategoria: options?.recursoPreventivoCategoria?.trim() || obraRecurso.recursoPreventivoCategoria || 'Encargado de Obra'
  };

  const config = getStoredPdfConfig();
  const pageWidth = 210;
  const pageHeight = 297;
  const marginLeft = 14;
  const marginRight = 14;
  const contentWidth = pageWidth - marginLeft - marginRight;

  // Calculate global compliance for this Obra
  let totalDocs = 0;
  let entregadosDocs = 0;
  let faltantesDocs = 0;
  let caducadosDocs = 0;
  let aptasCount = 0;
  let condicionadasCount = 0;
  let denegadasCount = 0;

  subcontratasInObra.forEach(sub => {
    if (sub.estadoExpediente === 'apto') aptasCount++;
    else if (sub.estadoExpediente === 'condicionado') condicionadasCount++;
    else if (sub.estadoExpediente === 'denegado') denegadasCount++;

    sub.checklist.forEach(item => {
      if (item.estado !== 'no_aplica') {
        totalDocs++;
        if (item.estado === 'entregado') {
          entregadosDocs++;
        } else if (item.estado === 'caducado') {
          caducadosDocs++;
          faltantesDocs++;
        } else {
          faltantesDocs++;
        }
      }
    });
  });

  const obraPorcentaje = totalDocs > 0 ? Math.round((entregadosDocs / totalDocs) * 100) : 0;
  const supNombre = supervisorNombre || (subcontratasInObra[0]?.supervisorResponsable) || 'Dirección Facultativa / Supervisión Técnica';

  // --- OFFICIAL HEADER ---
  // Official Logo of Diputación de Cádiz
  renderPdfLogo(doc, marginLeft, 10, 48, 12, false);

  // Institution Headings
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 84, 142); // Corporate Navy Blue #00548E
  doc.text(config.headerLine1 || 'EXCMA. DIPUTACIÓN PROVINCIAL DE CÁDIZ', marginLeft + 54, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(71, 85, 105);
  doc.text(config.headerLine2 || 'ÁREA DE COOPERACIÓN | GESTIÓN PROFEA', marginLeft + 54, 18);
  doc.text('CONTROL Y GESTIÓN REGLAMENTARIA DE SUBCONTRATAS EN OBRA PÚBLICA', marginLeft + 54, 21.8);

  // Date and Time on the right
  const now = new Date();
  const fechaEmisionStr = `${now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Fecha de emisión: ${fechaEmisionStr}`, pageWidth - marginRight, 14, { align: 'right' });
  doc.text('Expediente: PROFEA-CAE-OBRA', pageWidth - marginRight, 18, { align: 'right' });

  // Blue Accent Bar
  doc.setFillColor(0, 84, 142);
  doc.rect(marginLeft, 25, contentWidth, 1.2, 'F');

  // Title Banner
  const bannerY = 28.5;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(marginLeft, bannerY, contentWidth, 15, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 84, 142);
  doc.text('INFORME CONSOLIDADO DE CUMPLIMIENTO DEL CHECKLIST LEGAL Y CAE', marginLeft + 4, bannerY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    'Auditoría y control documental de subcontratas y requisitos preventivos obligatorios (Ley 32/2006, RD 1627/1997 y RD 171/2004)',
    marginLeft + 4,
    bannerY + 11.5
  );

  // Metadata Card (Obra details & global compliance metrics)
  const metaY = 46.5;
  const metaCardHeight = (options?.recursoPreventivoObra || options?.tecnicoNombre || options?.coordinadorNombre) ? 38 : 32;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(marginLeft, metaY, contentWidth, metaCardHeight, 2, 2, 'FD');

  // Left Column: Obra & Supervisor
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 84, 142);
  doc.text('DATOS DE LA OBRA Y EQUIPO TÉCNICO', marginLeft + 4, metaY + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Obra PFEA:', marginLeft + 4, metaY + 11.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(obraNombre || 'Obra municipal', marginLeft + 24, metaY + 11.5, { maxWidth: 75 });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Supervisor / DT:', marginLeft + 4, metaY + 16.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(supNombre, marginLeft + 24, metaY + 16.5, { maxWidth: 75 });

  if (effectiveOptions.recursoPreventivoObra) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Rec. Preventivo:', marginLeft + 4, metaY + 21.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${effectiveOptions.recursoPreventivoObra} (${effectiveOptions.recursoPreventivoCategoria || 'Encargado de Obra'})`, marginLeft + 24, metaY + 21.5, { maxWidth: 75 });
  }

  const subcontratasRowY = effectiveOptions.recursoPreventivoObra ? metaY + 26.5 : metaY + 22;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Subcontratistas:', marginLeft + 4, subcontratasRowY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`${subcontratasInObra.length} empresas registradas`, marginLeft + 24, subcontratasRowY);

  if (effectiveOptions.tecnicoNombre || effectiveOptions.coordinadorNombre) {
    const extraY = subcontratasRowY + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    const tecStr = effectiveOptions.tecnicoNombre ? `Técnico: ${effectiveOptions.tecnicoNombre}` : '';
    const coordStr = effectiveOptions.coordinadorNombre ? `CSS: ${effectiveOptions.coordinadorNombre}${effectiveOptions.empresaCoordinacion ? ` (${effectiveOptions.empresaCoordinacion})` : ''}` : '';
    doc.text([tecStr, coordStr].filter(Boolean).join(' | '), marginLeft + 4, extraY, { maxWidth: 95 });
  }

  // Right Column: Compliance Stats Box
  const rightColX = marginLeft + 104;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 84, 142);
  doc.text('ESTADO CONSOLIDADO DE CUMPLIMIENTO LEGAL', rightColX, metaY + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Nivel de cumplimiento:', rightColX, metaY + 11.5);

  // Score Badge
  let badgeColor: [number, number, number] = [220, 38, 38]; // Red
  if (obraPorcentaje === 100 && subcontratasInObra.length > 0) badgeColor = [5, 150, 105]; // Green
  else if (obraPorcentaje >= 60) badgeColor = [2, 132, 199]; // Blue
  else if (obraPorcentaje >= 30) badgeColor = [217, 119, 6]; // Amber

  doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2]);
  doc.roundedRect(rightColX + 34, metaY + 8.5, 20, 5, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`${obraPorcentaje}%`, rightColX + 44, metaY + 12.2, { align: 'center' });

  // Documents Breakdown
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(71, 85, 105);
  doc.text('Documentación aportada:', rightColX, metaY + 17.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(5, 150, 105);
  doc.text(`${entregadosDocs} entregados`, rightColX + 35, metaY + 17.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(' | ', rightColX + 54, metaY + 17.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(220, 38, 38);
  doc.text(`${faltantesDocs} faltantes`, rightColX + 57, metaY + 17.5);

  // Subcontractors authorization status breakdown
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Acceso a obra:', rightColX, metaY + 23.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(
    `${aptasCount} Aptas  ·  ${condicionadasCount} Condicionadas  ·  ${denegadasCount} Denegadas`,
    rightColX + 24,
    metaY + 23.5
  );

  // --- TABLE 1: Resumen de Subcontratistas en la Obra ---
  const table1Data = subcontratasInObra.map((sub, index) => {
    const comp = getSubcontrataCompliance(sub);
    let estadoLabel = 'CONDICIONADO';
    if (sub.estadoExpediente === 'apto') estadoLabel = 'APTO (AUTORIZADO)';
    else if (sub.estadoExpediente === 'denegado') estadoLabel = 'DENEGADO (BLOQUEADO)';

    return [
      (index + 1).toString(),
      `${sub.nombreEmpresa}\nCIF: ${sub.cif || '-'}`,
      sub.actividadGremio || 'Construcción',
      sub.supervisorResponsable || supNombre,
      `${comp.porcentaje}%`,
      `${comp.entregados} / ${comp.total}`,
      `${comp.pendientes + comp.caducados}`,
      estadoLabel
    ];
  });

  autoTable(doc, {
    startY: metaY + 35,
    head: [['Nº', 'Subcontratista y CIF', 'Actividad / Gremio', 'Supervisor', 'Cumpl.', 'Entregados', 'Faltantes', 'Estado Acceso']],
    body: table1Data.length > 0 ? table1Data : [['-', 'No hay subcontratistas dadas de alta en esta obra.', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    styles: {
      fontSize: 6.8,
      cellPadding: 1.8,
      textColor: [30, 41, 59],
      valign: 'middle',
      lineWidth: 0.1,
      lineColor: [226, 232, 240]
    },
    headStyles: {
      fillColor: [0, 84, 142],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7
    },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      1: { cellWidth: 46 },
      2: { cellWidth: 32 },
      3: { cellWidth: 28 },
      4: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
      5: { cellWidth: 17, halign: 'center' },
      6: { cellWidth: 14, halign: 'center' },
      7: { cellWidth: 24, halign: 'center', fontStyle: 'bold' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        const val = String(data.cell.raw);
        if (val.includes('APTO')) {
          data.cell.styles.textColor = [5, 150, 105];
        } else if (val.includes('DENEGADO')) {
          data.cell.styles.textColor = [220, 38, 38];
        } else if (val.includes('CONDICIONADO')) {
          data.cell.styles.textColor = [217, 119, 6];
        }
      }
      if (data.section === 'body' && data.column.index === 6) {
        const val = parseInt(String(data.cell.raw), 10);
        if (val > 0) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });

  // --- TABLE 2: Desglose Pormenorizado de Documentos Entregados y Faltantes ---
  const startTable2Y = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 6 : 140;

  // Header for Table 2
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 84, 142);
  doc.text('DESGLOSE DETALLADO DE DOCUMENTOS DEL CHECKLIST LEGAL POR SUBCONTRATA', marginLeft, startTable2Y);

  const table2Data: string[][] = [];

  subcontratasInObra.forEach((sub) => {
    sub.checklist.forEach((item) => {
      let estadoLabel = 'PENDIENTE (FALTA)';
      if (item.estado === 'entregado') estadoLabel = 'ENTREGADO (OK)';
      else if (item.estado === 'caducado') estadoLabel = 'CADUCADO';
      else if (item.estado === 'incompleto') estadoLabel = 'INCOMPLETO / REINTENTO';
      else if (item.estado === 'no_aplica') estadoLabel = 'NO APLICA';

      const categoriaShort = item.categoria === 'empresa' ? 'Empresa' : item.categoria === 'trabajadores' ? 'Personal' : 'Maquinaria';

      let vigenciaObs = item.observaciones || '';
      if (item.fechaCaducidad) {
        vigenciaObs = (vigenciaObs ? vigenciaObs + ' · ' : '') + `Caduca: ${formatDate(item.fechaCaducidad)}`;
      }
      if (item.solicitarReintento) {
        vigenciaObs = (vigenciaObs ? vigenciaObs + ' · ' : '') + '⚠️ Documento no legible, solicitar reintento.';
      } else if (item.detectadoPorIA) {
        vigenciaObs = (vigenciaObs ? vigenciaObs + ' · ' : '') + '✓ Verificado IA';
      }

      table2Data.push([
        sub.nombreEmpresa,
        item.nombre,
        categoriaShort,
        item.obligatorio ? 'Obligatorio' : 'Opcional',
        estadoLabel,
        vigenciaObs || '-'
      ]);
    });
  });

  autoTable(doc, {
    startY: startTable2Y + 2.5,
    head: [['Subcontrata', 'Documento Legal Requerido', 'Área', 'Régimen', 'Estado Validación', 'Vigencia / Observaciones']],
    body: table2Data.length > 0 ? table2Data : [['-', 'No hay documentos para desglosar.', '-', '-', '-', '-']],
    theme: 'grid',
    styles: {
      fontSize: 6.5,
      cellPadding: 1.5,
      textColor: [30, 41, 59],
      valign: 'middle',
      lineWidth: 0.1,
      lineColor: [226, 232, 240]
    },
    headStyles: {
      fillColor: [0, 84, 142],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.8
    },
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold' },
      1: { cellWidth: 54 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 26, halign: 'center', fontStyle: 'bold' },
      5: { cellWidth: 39 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const val = String(data.cell.raw);
        if (val.includes('ENTREGADO')) {
          data.cell.styles.textColor = [5, 150, 105]; // Green
        } else if (val.includes('CADUCADO') || val.includes('INCOMPLETO') || val.includes('PENDIENTE')) {
          data.cell.styles.textColor = [220, 38, 38]; // Red
        } else {
          data.cell.styles.textColor = [100, 116, 139]; // Gray
        }
      }
    }
  });

  // Footer & Signatures Block on last page
  const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 6 : 240;

  // Add signatures if space allows, else add page
  let sigDoc = doc;
  let sigY = finalY;
  if (finalY > 248) {
    doc.addPage();
    sigY = 20;
  }

  sigDoc.setFont('helvetica', 'normal');
  sigDoc.setFontSize(6.8);
  sigDoc.setTextColor(100, 116, 139);
  sigDoc.text(
    'Informe técnico consolidado emitido de conformidad con la Ley 32/2006, el RD 1627/1997 y el Plan PROFEA.',
    marginLeft,
    sigY + 2
  );

  const sigBoxY = sigY + 6;
  sigDoc.setDrawColor(203, 213, 225);
  sigDoc.setLineWidth(0.4);

  if (effectiveOptions.recursoPreventivoObra) {
    const boxW = 43.5;
    const gap = 2.6;

    // Box 1: Supervisor de obra
    sigDoc.roundedRect(marginLeft, sigBoxY, boxW, 22, 1.5, 1.5, 'S');
    sigDoc.setFont('helvetica', 'bold');
    sigDoc.setFontSize(6.5);
    sigDoc.setTextColor(15, 23, 42);
    sigDoc.text('Supervisor de obra:', marginLeft + 2, sigBoxY + 4);
    sigDoc.setFont('helvetica', 'normal');
    sigDoc.setFontSize(5.8);
    sigDoc.setTextColor(71, 85, 105);
    sigDoc.text(`Fdo: ${supNombre}`, marginLeft + 2, sigBoxY + 18, { maxWidth: boxW - 4 });

    // Box 2: Recurso Preventivo de Obra (con Categoría/Cargo)
    const sig2X = marginLeft + boxW + gap;
    sigDoc.roundedRect(sig2X, sigBoxY, boxW, 22, 1.5, 1.5, 'S');
    sigDoc.setFont('helvetica', 'bold');
    sigDoc.setFontSize(6.5);
    sigDoc.setTextColor(15, 23, 42);
    sigDoc.text('Recurso Preventivo:', sig2X + 2, sigBoxY + 4);
    sigDoc.setFont('helvetica', 'italic');
    sigDoc.setFontSize(5.3);
    sigDoc.setTextColor(0, 84, 142);
    sigDoc.text(`Cargo: ${effectiveOptions.recursoPreventivoCategoria || 'Encargado de Obra'}`, sig2X + 2, sigBoxY + 8, { maxWidth: boxW - 4 });
    sigDoc.setFont('helvetica', 'normal');
    sigDoc.setFontSize(5.8);
    sigDoc.setTextColor(71, 85, 105);
    sigDoc.text(`Fdo: ${effectiveOptions.recursoPreventivoObra}`, sig2X + 2, sigBoxY + 18, { maxWidth: boxW - 4 });

    // Box 3: Por el Técnico de Obra
    const sig3X = sig2X + boxW + gap;
    sigDoc.roundedRect(sig3X, sigBoxY, boxW, 22, 1.5, 1.5, 'S');
    sigDoc.setFont('helvetica', 'bold');
    sigDoc.setFontSize(6.5);
    sigDoc.setTextColor(15, 23, 42);
    sigDoc.text('Por el Técnico de Obra:', sig3X + 2, sigBoxY + 4);
    sigDoc.setFont('helvetica', 'normal');
    sigDoc.setFontSize(5.8);
    sigDoc.setTextColor(71, 85, 105);
    const tecnicoTxt = effectiveOptions.tecnicoNombre ? `Fdo: ${effectiveOptions.tecnicoNombre}` : 'Fdo: Técnico de Ejecución';
    sigDoc.text(tecnicoTxt, sig3X + 2, sigBoxY + 18, { maxWidth: boxW - 4 });

    // Box 4: Coordinador de Seguridad y Salud (CSS) con Empresa de Coordinación
    const sig4X = sig3X + boxW + gap;
    sigDoc.roundedRect(sig4X, sigBoxY, boxW, 22, 1.5, 1.5, 'S');
    sigDoc.setFont('helvetica', 'bold');
    sigDoc.setFontSize(6.5);
    sigDoc.setTextColor(15, 23, 42);
    sigDoc.text('Coordinación CSS:', sig4X + 2, sigBoxY + 4);
    if (effectiveOptions.empresaCoordinacion) {
      sigDoc.setFont('helvetica', 'bold');
      sigDoc.setFontSize(5.2);
      sigDoc.setTextColor(0, 84, 142);
      sigDoc.text(`Empresa: ${effectiveOptions.empresaCoordinacion}`, sig4X + 2, sigBoxY + 8, { maxWidth: boxW - 4 });
    }
    sigDoc.setFont('helvetica', 'normal');
    sigDoc.setFontSize(5.8);
    sigDoc.setTextColor(71, 85, 105);
    const coordTxt = effectiveOptions.coordinadorNombre ? `Fdo: ${effectiveOptions.coordinadorNombre}` : 'Fdo: Coordinador CSS';
    sigDoc.text(coordTxt, sig4X + 2, sigBoxY + 18, { maxWidth: boxW - 4 });
  } else {
    // 3 Boxes fallback
    // Box 1: Supervisor de obra
    sigDoc.roundedRect(marginLeft, sigBoxY, 58, 22, 1.5, 1.5, 'S');
    sigDoc.setFont('helvetica', 'bold');
    sigDoc.setFontSize(6.8);
    sigDoc.setTextColor(15, 23, 42);
    sigDoc.text('Por el Supervisor de obra:', marginLeft + 2.5, sigBoxY + 4);
    sigDoc.setFont('helvetica', 'normal');
    sigDoc.setFontSize(6.2);
    sigDoc.setTextColor(71, 85, 105);
    sigDoc.text(`Fdo: ${supNombre}`, marginLeft + 2.5, sigBoxY + 18, { maxWidth: 53 });

    // Box 2: Técnico de Obra
    const sig2X = marginLeft + 62;
    sigDoc.roundedRect(sig2X, sigBoxY, 58, 22, 1.5, 1.5, 'S');
    sigDoc.setFont('helvetica', 'bold');
    sigDoc.setFontSize(6.8);
    sigDoc.setTextColor(15, 23, 42);
    sigDoc.text('Por el Técnico de Obra:', sig2X + 2.5, sigBoxY + 4);
    sigDoc.setFont('helvetica', 'normal');
    sigDoc.setFontSize(6.2);
    sigDoc.setTextColor(71, 85, 105);
    const tecnicoTxt = effectiveOptions.tecnicoNombre ? `Fdo: ${effectiveOptions.tecnicoNombre}` : 'Fdo: Técnico de Ejecución';
    sigDoc.text(tecnicoTxt, sig2X + 2.5, sigBoxY + 18, { maxWidth: 53 });

    // Box 3: Coordinador de Seguridad y Salud (CSS) junto al Nombre de la Empresa de Coordinación
    const sig3X = sig2X + 62;
    sigDoc.roundedRect(sig3X, sigBoxY, 58, 22, 1.5, 1.5, 'S');
    sigDoc.setFont('helvetica', 'bold');
    sigDoc.setFontSize(6.8);
    sigDoc.setTextColor(15, 23, 42);
    sigDoc.text('Coordinación de Seguridad y Salud:', sig3X + 2.5, sigBoxY + 4);

    if (effectiveOptions.empresaCoordinacion) {
      sigDoc.setFont('helvetica', 'bold');
      sigDoc.setFontSize(5.6);
      sigDoc.setTextColor(0, 84, 142);
      sigDoc.text(`Empresa: ${effectiveOptions.empresaCoordinacion}`, sig3X + 2.5, sigBoxY + 8.5, { maxWidth: 53 });
    }

    sigDoc.setFont('helvetica', 'normal');
    sigDoc.setFontSize(6.2);
    sigDoc.setTextColor(71, 85, 105);
    const coordTxt = effectiveOptions.coordinadorNombre ? `Fdo: ${effectiveOptions.coordinadorNombre}` : 'Fdo: Coordinador CSS (Área de Cooperación)';
    sigDoc.text(coordTxt, sig3X + 2.5, sigBoxY + 18, { maxWidth: 53 });
  }

  // Global Page Numbers & Official Footer
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Página ${p} de ${totalPages} - Informe Consolidado PROFEA | Excma. Diputación Provincial de Cádiz`,
      pageWidth / 2,
      290,
      { align: 'center' }
    );
  }

  const cleanObra = (obraNombre || 'obra').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  doc.save(`informe_consolidado_obra_${cleanObra}_${now.toISOString().slice(0, 10)}.pdf`);
};
