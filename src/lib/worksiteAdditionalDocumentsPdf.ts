import { jsPDF } from 'jspdf';
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
  obra: string;
  municipio?: string;
  empresa: string;
  cif: string;
  fecha: string;
  responsable?: string;
};

type Definition = {
  title: string;
  short: string;
  legal: string;
  body: (worker?: Person | null, ctx?: AdditionalWorksiteContext) => string[];
  signatureWorker?: boolean;
  signatureCompany?: boolean;
  note?: string;
};

export const ADDITIONAL_WORKSITE_DOCUMENTS: Record<AdditionalWorksiteDocumentType, Definition> = {
  baja_voluntaria: {
    title: 'BAJA VOLUNTARIA DE LA PERSONA TRABAJADORA',
    short: 'Baja voluntaria',
    legal: 'Referencia: art. 49.1.d) del Real Decreto Legislativo 2/2015, texto refundido de la Ley del Estatuto de los Trabajadores, sin perjuicio del preaviso aplicable por convenio colectivo o costumbre del lugar.',
    body: (w, c) => [
      `La persona trabajadora ${w?.apellidosNombre || '________________________________'}, con DNI/NIE ${w?.dni || '________________'}, comunica de forma libre, expresa e inequívoca su decisión de causar baja voluntaria en la relación laboral que mantiene con ${c?.empresa || '________________________________'}, vinculada a la obra ${c?.obra || '________________________________'}.`,
      `La fecha de efectos que se hace constar es ____/____/________. La presente comunicación se formula a efectos de dejar constancia escrita de la voluntad de dimisión y de su recepción por la empresa.`,
      'La firma de este documento acredita la comunicación de la voluntad de baja; no implica renuncia a derechos salariales, liquidación o cualesquiera otros derechos indisponibles que legalmente correspondan.',
    ],
    signatureWorker: true,
    signatureCompany: true,
  },
  ausencia_trabajador: {
    title: 'COMUNICACIÓN / JUSTIFICACIÓN DE AUSENCIA',
    short: 'Ausencia del trabajador',
    legal: 'Referencia general: arts. 20 y 37 del Estatuto de los Trabajadores y, en su caso, convenio colectivo, instrucciones internas y régimen de permisos aplicable.',
    body: (w, c) => [
      `Se deja constancia de la ausencia de ${w?.apellidosNombre || '________________________________'}, DNI/NIE ${w?.dni || '________________'}, adscrito/a a la obra ${c?.obra || '________________________________'}, durante el día/periodo ____________________________________.`,
      'Motivo comunicado por la persona trabajadora: ____________________________________________________________________________________.',
      'Documentación justificativa aportada, en su caso: _______________________________________________________________________________.',
      'La presente hoja tiene finalidad interna de control y archivo. La consideración de la ausencia como justificada, retribuida o no retribuida dependerá de la normativa y convenio aplicables y de la documentación acreditativa correspondiente.',
    ],
    signatureWorker: true,
    signatureCompany: true,
  },
  permiso_lactancia: {
    title: 'SOLICITUD / COMUNICACIÓN DE PERMISO PARA EL CUIDADO DEL LACTANTE',
    short: 'Permiso de lactancia',
    legal: 'Referencia: art. 37.4 del Estatuto de los Trabajadores (Real Decreto Legislativo 2/2015), en la redacción vigente, y convenio colectivo aplicable.',
    body: (w, c) => [
      `${w?.apellidosNombre || '________________________________'}, con DNI/NIE ${w?.dni || '________________'}, solicita/comunica el ejercicio del derecho para el cuidado del lactante en relación con su puesto en la obra ${c?.obra || '________________________________'}.`,
      'Modalidad solicitada: ☐ una hora de ausencia ☐ dos fracciones ☐ reducción de jornada ☐ acumulación en jornadas completas, cuando proceda.',
      'Fecha prevista de inicio: ____/____/________. Fecha prevista de finalización: ____/____/________. Horario o distribución propuesta: _________________________________________________.',
      'La concreción y disfrute se ajustarán a la normativa vigente, convenio colectivo aplicable y reglas de preaviso y coordinación organizativa que correspondan.',
    ],
    signatureWorker: true,
    signatureCompany: true,
  },
  parte_asistencia_fremap: {
    title: 'PARTE INTERNO DE DERIVACIÓN / ASISTENCIA A FREMAP',
    short: 'Asistencia FREMAP',
    legal: 'Documento interno de acompañamiento. No sustituye los partes médicos ni los modelos oficiales de accidente de trabajo o baja/alta que deban emitir la mutua, servicio sanitario o sistema oficial correspondiente.',
    body: (w, c) => [
      `Se remite a ${w?.apellidosNombre || '________________________________'}, DNI/NIE ${w?.dni || '________________'}, trabajador/a de ${c?.empresa || '________________________________'}, adscrito/a a la obra ${c?.obra || '________________________________'}, para valoración/asistencia por FREMAP.` ,
      'Fecha y hora del hecho o inicio de síntomas: ____/____/________ ______:______.',
      'Descripción breve de lo ocurrido / síntomas: ____________________________________________________________________________________\n____________________________________________________________________________________________________________________________.',
      'Lugar exacto: _______________________________________________________________________________________________________________.',
      'Persona que autoriza/comunica la asistencia: ___________________________________________________________________________________.',
    ],
    signatureWorker: true,
    signatureCompany: true,
    note: 'Adjuntar, cuando proceda, la documentación oficial emitida por FREMAP y tramitar las comunicaciones obligatorias por los canales establecidos.'
  },
  comunicacion_accidente: {
    title: 'PARTE DE COMUNICACIÓN INTERNA DE ACCIDENTE LABORAL',
    short: 'Comunicación interna accidente',
    legal: 'Referencias: Ley 31/1995 de Prevención de Riesgos Laborales, especialmente arts. 16, 23 y 24; y normativa vigente sobre notificación oficial de accidentes de trabajo. Este parte interno no sustituye la notificación oficial cuando resulte obligatoria.',
    body: (w, c) => [
      `Trabajador/a: ${w?.apellidosNombre || '________________________________'} · DNI/NIE: ${w?.dni || '________________'} · Puesto: ${w?.categoria || '________________'} · Obra: ${c?.obra || '________________________________'}.`,
      'Fecha y hora del accidente: ____/____/________ ______:______. Lugar exacto: ________________________________________________________.',
      'Tarea que realizaba: __________________________________________________________________________________________________________.',
      'Descripción de los hechos: ____________________________________________________________________________________________________\n____________________________________________________________________________________________________________________________.',
      'Lesión aparente / zona afectada: _______________________________________________________________________________________________.',
      'Testigos: _____________________________________________________________________________________________________________________.',
      'Medidas inmediatas adoptadas: _________________________________________________________________________________________________\n____________________________________________________________________________________________________________________________.',
      'Comunicación realizada a: ☐ mando/responsable ☐ prevención ☐ mutua ☐ coordinación de seguridad y salud ☐ otros ___________________.',
    ],
    signatureWorker: true,
    signatureCompany: true,
  },
  certificado_trabajando_actualmente: {
    title: 'CERTIFICADO DE PRESTACIÓN DE SERVICIOS ACTUAL',
    short: 'Certificado trabajando actualmente',
    legal: 'Certificación administrativa/laboral emitida a solicitud de la persona interesada, con los datos obrantes en GestionPROFEA. Debe ser validada y firmada por órgano o persona competente antes de su uso oficial.',
    body: (w, c) => [
      `D./D.ª ____________________________________, en calidad de ____________________________________ de ${c?.empresa || 'Diputación Provincial de Cádiz'}, CERTIFICA:`,
      `Que ${w?.apellidosNombre || '________________________________'}, con DNI/NIE ${w?.dni || '________________'}, figura prestando servicios actualmente en la obra ${c?.obra || '________________________________'}, con la categoría/puesto de ${w?.categoria || '________________'}, desde ${w?.periodoInicio || '____/____/________'} y con fecha prevista de finalización ${w?.periodoFin || '____/____/________'}, según los datos disponibles en la aplicación.`,
      'Y para que conste, a petición de la persona interesada y a los efectos oportunos, se expide el presente certificado, sujeto a comprobación y firma por la unidad competente.',
    ],
    signatureCompany: true,
  },
  certificado_servicios_prestados: {
    title: 'CERTIFICADO DE SERVICIOS PRESTADOS',
    short: 'Certificado de haber trabajado',
    legal: 'Certificación emitida a partir de los datos de contratación disponibles. Para efectos administrativos oficiales deberá ser revisada y firmada por el órgano o unidad competente.',
    body: (w, c) => [
      `D./D.ª ____________________________________, en calidad de ____________________________________ de ${c?.empresa || 'Diputación Provincial de Cádiz'}, CERTIFICA:`,
      `Que ${w?.apellidosNombre || '________________________________'}, con DNI/NIE ${w?.dni || '________________'}, ha prestado servicios en la obra ${c?.obra || w?.obra || '________________________________'}, con categoría/puesto ${w?.categoria || '________________'}, durante el periodo comprendido entre ${w?.periodoInicio || '____/____/________'} y ${w?.periodoFin || '____/____/________'}, según los registros disponibles.`,
      'Y para que conste a los efectos oportunos, se expide el presente certificado, que deberá ser comprobado y suscrito por la unidad competente para adquirir validez oficial.',
    ],
    signatureCompany: true,
  },
};

const fmt = (value: string) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value || '');
};

const safeFile = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

export function generateAdditionalWorksiteDocument(type: AdditionalWorksiteDocumentType, worker: Person | null, ctx: AdditionalWorksiteContext) {
  const def = ADDITIONAL_WORKSITE_DOCUMENTS[type];
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const left = 18;
  const right = pw - 18;
  const width = right - left;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ · PROFEA', left, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(ctx.empresa || 'Diputación Provincial de Cádiz', left, 21);
  doc.text(`CIF: ${ctx.cif || '—'}`, right, 16, { align: 'right' });
  doc.text(`Fecha: ${fmt(ctx.fecha)}`, right, 21, { align: 'right' });
  doc.setDrawColor(0, 84, 142);
  doc.setLineWidth(0.7);
  doc.line(left, 28, right, 28);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const titleLines = doc.splitTextToSize(def.title, width);
  doc.text(titleLines, pw / 2, 39, { align: 'center' });
  let y = 39 + titleLines.length * 6 + 3;

  doc.setFontSize(8.3);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90);
  const legalLines = doc.splitTextToSize(def.legal, width);
  doc.text(legalLines, left, y);
  y += legalLines.length * 4 + 5;
  doc.setTextColor(0);

  const infoRows: [string, string][] = [
    ['Obra', ctx.obra || '________________________________'],
    ['Municipio', ctx.municipio || '________________________________'],
    ['Trabajador/a', worker?.apellidosNombre || '________________________________'],
    ['DNI/NIE', worker?.dni || '________________'],
    ['Categoría/Puesto', worker?.categoria || '________________'],
    ['Nº oferta', worker?.numOferta || '________________'],
  ];
  doc.setFontSize(8);
  for (let i = 0; i < infoRows.length; i += 2) {
    const a = infoRows[i]; const b = infoRows[i + 1];
    doc.setFont('helvetica', 'bold'); doc.text(`${a[0]}:`, left, y); doc.setFont('helvetica', 'normal'); doc.text(a[1], left + 25, y);
    if (b) { doc.setFont('helvetica', 'bold'); doc.text(`${b[0]}:`, left + width / 2, y); doc.setFont('helvetica', 'normal'); doc.text(b[1], left + width / 2 + 25, y); }
    y += 6;
  }
  y += 3;

  doc.setFontSize(9.5);
  for (const paragraph of def.body(worker, ctx)) {
    const lines = doc.splitTextToSize(paragraph, width);
    doc.text(lines, left, y);
    y += lines.length * 5 + 4;
    if (y > ph - 70) { doc.addPage(); y = 22; }
  }

  if (def.note) {
    doc.setFillColor(245, 247, 250);
    const noteLines = doc.splitTextToSize(def.note, width - 8);
    const boxH = noteLines.length * 4 + 8;
    doc.roundedRect(left, y, width, boxH, 2, 2, 'F');
    doc.setFontSize(8); doc.setTextColor(80); doc.text(noteLines, left + 4, y + 5);
    doc.setTextColor(0); y += boxH + 7;
  }

  y = Math.max(y + 5, ph - 58);
  if (def.signatureWorker && def.signatureCompany) {
    doc.setDrawColor(150);
    doc.line(left, y + 24, left + 70, y + 24);
    doc.line(right - 70, y + 24, right, y + 24);
    doc.setFontSize(8); doc.text('Firma de la persona trabajadora', left, y + 29); doc.text('Firma / sello de la empresa', right, y + 29, { align: 'right' });
  } else if (def.signatureWorker) {
    doc.setDrawColor(150); doc.line(left, y + 24, left + 80, y + 24); doc.setFontSize(8); doc.text('Firma de la persona trabajadora', left, y + 29);
  } else if (def.signatureCompany) {
    doc.setDrawColor(150); doc.line(right - 80, y + 24, right, y + 24); doc.setFontSize(8); doc.text('Firma / sello de la unidad competente', right, y + 29, { align: 'right' });
  }

  doc.setDrawColor(220); doc.line(left, ph - 17, right, ph - 17); doc.setFontSize(6.8); doc.setTextColor(100); doc.text('Documento generado por GestionPROFEA. Revisar y validar antes de su uso oficial.', left, ph - 12); doc.text('Página 1', right, ph - 12, { align: 'right' });

  const suffix = worker ? `_${safeFile(worker.apellidosNombre || worker.dni || String(worker.id))}` : '_PLANTILLA';
  return { doc, filename: `${safeFile(def.short)}${suffix}.pdf` };
}
