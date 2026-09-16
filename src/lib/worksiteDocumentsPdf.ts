import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Person, getAptitudMedicaInfo } from "../../types";
import {
  applyPdfFooters,
  getStoredPdfConfig,
  renderPdfLogo,
} from "./exportUtils";

export type WorksiteDocumentContext = {
  obra: string;
  municipio?: string;
  empresa: string;
  cif?: string;
  recursoPreventivo: string;
  fecha: string;
  periodoLabel: string;
  accionFormativa?: string;
  duracionFormacion?: string;
  epis?: Record<string, boolean>;
  maquinariaPorTrabajador?: Record<string, string>;
};

const BLUE: [number, number, number] = [0, 84, 142];
const LIGHT: [number, number, number] = [240, 247, 255];
const safe = (v: unknown) => String(v ?? "").trim();
const fmtDate = (value: string) => {
  const m = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : safe(value) || "-";
};
const slug = (value: string) =>
  safe(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const splitName = (value: string) => {
  const text = safe(value);
  if (!text) return { apellidos: "", nombre: "" };
  if (text.includes(",")) {
    const [apellidos, ...rest] = text.split(",");
    return { apellidos: apellidos.trim(), nombre: rest.join(",").trim() };
  }
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 4)
    return {
      apellidos: parts.slice(0, 2).join(" "),
      nombre: parts.slice(2).join(" "),
    };
  if (parts.length === 3)
    return { apellidos: parts.slice(0, 2).join(" "), nombre: parts[2] };
  return { apellidos: text, nombre: "" };
};

const setupDoc = (
  title: string,
  subtitle: string,
  context: WorksiteDocumentContext,
) => {
  const doc = new jsPDF({ orientation: "landscape", format: "a4" });
  const config = getStoredPdfConfig();
  const w = doc.internal.pageSize.getWidth();

  doc.setProperties({
    title,
    author: "Diputación Provincial de Cádiz",
    creator: "Sistema de Gestión PROFEA",
  });
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, w, 19, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...BLUE);
  doc.text(
    (config.headerLine1 || "DIPUTACIÓN PROVINCIAL DE CÁDIZ").toUpperCase(),
    14,
    7.8,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(90, 105, 125);
  doc.text("COOPERACIÓN · GESTIÓN DE FONDOS PROFEA", 14, 13.2);
  renderPdfLogo(doc, w - 68, 4.2, 53, 10.5, true, config.customLogo);
  doc.setDrawColor(218, 226, 233);
  doc.line(14, 17.6, w - 14, 17.6);

  doc.setFillColor(...BLUE);
  doc.rect(0, 19, w, 18, "F");
  doc.setFont("helvetica", "bold");
  let titleFontSize = 11.5;
  doc.setFontSize(titleFontSize);
  const titleText = title.toUpperCase();
  const titleMaxWidth = w - 28;
  while (titleFontSize > 8.2 && doc.getTextWidth(titleText) > titleMaxWidth) {
    titleFontSize -= 0.4;
    doc.setFontSize(titleFontSize);
  }
  doc.setTextColor(255, 255, 255);
  doc.text(titleText, 14, 26.3, { maxWidth: titleMaxWidth });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(225, 239, 249);
  doc.text(subtitle, 14, 31.4, { maxWidth: Math.max(90, w * 0.52) });
  doc.text(`${context.obra} · ${context.periodoLabel}`, w - 14, 31.4, {
    align: "right",
    maxWidth: Math.max(95, w * 0.38),
  });

  return { doc, config, w };
};

const drawWorksiteBlock = (
  doc: jsPDF,
  w: number,
  context: WorksiteDocumentContext,
  y = 42,
) => {
  const blockHeight = 23;
  doc.setFillColor(247, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, w - 28, blockHeight, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...BLUE);
  doc.text("DATOS DE LA EMPRESA / OBRA", 18, y + 5.1);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  doc.setTextColor(30, 41, 59);
  const leftX = 18;
  const rightX = 150;
  doc.text(
    `Municipio: ${context.municipio || "Pendiente de completar"}`,
    leftX,
    y + 10.2,
    { maxWidth: 126 },
  );
  doc.text(`Empresa: ${context.empresa || "-"}`, leftX, y + 14.4, {
    maxWidth: 126,
  });
  doc.text(`CIF: ${context.cif || "-"}`, rightX, y + 10.2, { maxWidth: 128 });
  doc.text(
    `Obra / Centro de trabajo: ${context.obra || "-"}`,
    rightX,
    y + 14.4,
    { maxWidth: 128 },
  );
  doc.text(
    `Encargado (recurso preventivo): ${context.recursoPreventivo || "-"}`,
    leftX,
    y + 18.6,
    { maxWidth: 126 },
  );
  doc.text(`Fecha: ${fmtDate(context.fecha)}`, rightX, y + 18.6, {
    maxWidth: 128,
  });
  return y + blockHeight + 4.5;
};

const drawResponsibleSignatureBand = (
  doc: jsPDF,
  context: WorksiteDocumentContext,
) => {
  const pageHeight = doc.internal.pageSize.getHeight();
  const y = pageHeight - 35;
  doc.setFillColor(255, 255, 255);
  doc.rect(10, y - 2, 277, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.1);
  doc.setTextColor(...BLUE);
  doc.text("Firma del encargado / responsable de la obra", 14, y + 1);
  doc.setDrawColor(170, 190, 210);
  doc.rect(14, y + 3, 82, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(30, 41, 59);
  doc.text(`Nombre: ${context.recursoPreventivo || ""}`, 102, y + 8);
  doc.text(`Fecha: ${fmtDate(context.fecha)}`, 102, y + 14);
};

const finish = (
  doc: jsPDF,
  config: ReturnType<typeof getStoredPdfConfig>,
  filename: string,
) => {
  applyPdfFooters(doc, {
    ...config,
    footerText:
      "Diputación de Cádiz · Documento interno de prevención de riesgos laborales",
  });
  return { doc, filename };
};

export const generateEpiDeliveryPdf = (
  workers: Person[],
  context: WorksiteDocumentContext,
) => {
  const { doc, config, w } = setupDoc(
    "Relación de entrega de EPIs a trabajadores",
    "Modelo de registro conforme a la Ley 31/1995 y al Real Decreto 773/1997",
    context,
  );
  let y = drawWorksiteBlock(doc, w, context);

  doc.setFillColor(...LIGHT);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, w - 28, 24, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...BLUE);
  doc.text("DECLARACIÓN E INFORMACIÓN AL TRABAJADOR", 18, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.7);
  doc.setTextColor(30, 41, 59);
  const declaration =
    "Se realiza entrega a los trabajadores relacionados de los equipos de protección individual indicados. El trabajador reconoce haber recibido información sobre los trabajos y zonas donde debe utilizarlos, así como las instrucciones de uso y mantenimiento adecuados.";
  doc.text(doc.splitTextToSize(declaration, w - 36), 18, y + 10);
  doc.setFont("helvetica", "bold");
  doc.text("El trabajador acepta el compromiso de:", 18, y + 16);
  doc.setFont("helvetica", "normal");
  doc.text(
    "1. Utilizar los EPIs durante la jornada laboral en las áreas donde resulte obligatorio, cuidando su estado y conservación.",
    18,
    y + 19.5,
  );
  doc.text(
    "2. Consultar cualquier duda sobre su utilización.  3. Comunicar de inmediato cualquier defecto o pérdida de eficacia.  4. Devolver el EPI cuando se le indique.",
    18,
    y + 22.5,
  );
  y += 29;

  const epi = context.epis || {};
  const mark = (key: string, extra = "") =>
    epi[key] === false ? "" : `✓${extra ? ` ${extra}` : ""}`;
  const body = workers.map((p, index) => {
    const name = splitName(p.apellidosNombre);
    return [
      String(index + 1),
      name.apellidos,
      name.nombre,
      safe(p.dni),
      mark("casco"),
      mark("chaleco"),
      mark("orejeras"),
      mark("gafas"),
      mark("guantes"),
      mark("mascarillas"),
      mark("calzado", safe(p.calzado)),
      "",
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Nº",
        "Apellidos",
        "Nombre",
        "D.N.I.",
        "Casco\nCASCOS JAR · MODELO 2\nCE-EN 397",
        "Chaleco\nEN ISO 13688:2013\nEN ISO 20471:2013+A1:2016",
        "Orejeras\nEN 352-1 CE",
        "Gafas\nEN 166:2001",
        "Guantes\nEN ISO 21420 · EN 388",
        "Mascarillas\nUNE-EN 149:2001+A1:2009",
        "Calzado\nEN ISO 20345",
        "Firma del trabajador",
      ],
    ],
    body,
    margin: { left: 14, right: 14, bottom: 43 },
    tableWidth: w - 28,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 6.1,
      cellPadding: 1.5,
      valign: "middle",
      textColor: [30, 41, 59],
      lineColor: [180, 197, 214],
      lineWidth: 0.18,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [229, 239, 248],
      textColor: [15, 42, 75],
      fontStyle: "bold",
      fontSize: 5.7,
      halign: "center",
      valign: "middle",
    },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 31 },
      2: { cellWidth: 24 },
      3: { cellWidth: 19 },
      4: { cellWidth: 18, halign: "center" },
      5: { cellWidth: 22, halign: "center" },
      6: { cellWidth: 18, halign: "center" },
      7: { cellWidth: 18, halign: "center" },
      8: { cellWidth: 19, halign: "center" },
      9: { cellWidth: 22, halign: "center" },
      10: { cellWidth: 20, halign: "center" },
      11: { cellWidth: 31 },
    },
    didDrawPage: () => drawResponsibleSignatureBand(doc, context),
  });

  return finish(
    doc,
    config,
    `ENTREGA_EPIS_${slug(context.obra)}_${slug(context.periodoLabel)}.pdf`,
  );
};

export const generateTrainingInformationPdf = (
  workers: Person[],
  context: WorksiteDocumentContext,
) => {
  const { doc, config, w } = setupDoc(
    "Relación de formación e información a trabajadores",
    "Modelo de registro conforme a la Ley 31/1995, artículos 18 y 19",
    context,
  );
  const y = drawWorksiteBlock(doc, w, context);
  const action =
    safe(context.accionFormativa) ||
    "Información y formación preventiva del puesto de trabajo y de la obra";
  const duration = safe(context.duracionFormacion) || "-";
  autoTable(doc, {
    startY: y,
    head: [
      [
        "Nº",
        "Nombre y apellidos",
        "DNI/NIE",
        "Puesto de trabajo",
        "Acción formativa / información recibida",
        "Fecha",
        "Duración",
        "Firma trabajador",
      ],
    ],
    body: workers.map((p, i) => [
      String(i + 1),
      safe(p.apellidosNombre),
      safe(p.dni),
      safe(p.categoria),
      action,
      fmtDate(context.fecha),
      duration,
      "",
    ]),
    margin: { left: 14, right: 14, bottom: 43 },
    tableWidth: w - 28,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 7.1,
      cellPadding: 2,
      valign: "middle",
      textColor: [30, 41, 59],
      lineColor: [185, 201, 216],
      lineWidth: 0.18,
    },
    headStyles: {
      fillColor: [229, 239, 248],
      textColor: [15, 42, 75],
      fontStyle: "bold",
      halign: "center",
    },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: 48 },
      2: { cellWidth: 24 },
      3: { cellWidth: 38 },
      4: { cellWidth: 70 },
      5: { cellWidth: 24 },
      6: { cellWidth: 20 },
      7: { cellWidth: 30 },
    },
    didDrawPage: () => drawResponsibleSignatureBand(doc, context),
  });

  const endY = (doc as any).lastAutoTable?.finalY || y + 60;
  const pageHeight = doc.internal.pageSize.getHeight();
  let by = endY + 5;
  if (by + 27 > pageHeight - 39) {
    doc.addPage("a4", "landscape");
    by = drawWorksiteBlock(doc, w, context, 42);
  }
  doc.setFillColor(...LIGHT);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, by, w - 28, 24, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.setTextColor(...BLUE);
  doc.text("CONTENIDO ORIENTATIVO", 18, by + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.7);
  doc.setTextColor(30, 41, 59);
  doc.text(
    "1. Riesgos del puesto y de la actividad.   2. Medidas preventivas y de control.   3. Normas de trabajo seguro.",
    18,
    by + 10.5,
  );
  doc.text(
    "4. Uso correcto de EPIs.   5. Actuación en emergencias y primeros auxilios básicos.",
    18,
    by + 15,
  );
  doc.setFont("helvetica", "bold");
  doc.text("Declaración general:", 18, by + 20);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Los trabajadores relacionados declaran haber recibido la formación e información indicadas y comprender su contenido.",
    48,
    by + 20,
  );
  drawResponsibleSignatureBand(doc, context);

  return finish(
    doc,
    config,
    `FORMACION_INFORMACION_${slug(context.obra)}_${slug(context.periodoLabel)}.pdf`,
  );
};

export const generateMachineryAuthorizationPdf = (
  workers: Person[],
  context: WorksiteDocumentContext,
) => {
  const { doc, config, w } = setupDoc(
    "Relación de trabajadores autorizados para uso de maquinaria / equipo de trabajo",
    "Modelo de registro conforme a la Ley 31/1995 y al Real Decreto 1215/1997",
    context,
  );
  const y = drawWorksiteBlock(doc, w, context);
  autoTable(doc, {
    startY: y,
    head: [
      [
        "Nº",
        "Nombre y apellidos",
        "DNI/NIE",
        "Puesto de trabajo",
        "Maquinaria / equipos autorizados\n(indicar todos los equipos que procedan)",
        "Formación específica",
        "Aptitud médica compatible",
        "Fecha autorización",
        "Vigencia / revisión",
        "Firma trabajador",
      ],
    ],
    body: workers.map((p, i) => {
      const apt = getAptitudMedicaInfo(p);
      const machinery = context.maquinariaPorTrabajador?.[String(p.id)] || "";
      const compatible =
        apt.estado === "Apto" || apt.estado === "Apto con limitaciones"
          ? apt.estado
          : apt.estado;
      return [
        String(i + 1),
        safe(p.apellidosNombre),
        safe(p.dni),
        safe(p.categoria),
        machinery,
        safe(p.formacion) === "Sí" ? "Sí" : "Pendiente",
        compatible,
        fmtDate(context.fecha),
        safe(p.periodoFin) ? fmtDate(p.periodoFin) : "-",
        "",
      ];
    }),
    margin: { left: 14, right: 14, bottom: 43 },
    tableWidth: w - 28,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 6.6,
      cellPadding: 1.7,
      valign: "middle",
      textColor: [30, 41, 59],
      lineColor: [185, 201, 216],
      lineWidth: 0.18,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [229, 239, 248],
      textColor: [15, 42, 75],
      fontStyle: "bold",
      fontSize: 6,
      halign: "center",
    },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 35 },
      2: { cellWidth: 20 },
      3: { cellWidth: 28 },
      4: { cellWidth: 50 },
      5: { cellWidth: 22 },
      6: { cellWidth: 25 },
      7: { cellWidth: 22 },
      8: { cellWidth: 23 },
      9: { cellWidth: 27 },
    },
    didDrawPage: () => drawResponsibleSignatureBand(doc, context),
  });

  const endY = (doc as any).lastAutoTable?.finalY || y + 60;
  const pageHeight = doc.internal.pageSize.getHeight();
  let by = endY + 5;
  if (by + 25 > pageHeight - 39) {
    doc.addPage("a4", "landscape");
    by = drawWorksiteBlock(doc, w, context, 42);
  }
  doc.setFillColor(...LIGHT);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, by, w - 28, 22, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.3);
  doc.setTextColor(...BLUE);
  doc.text("CONDICIONES GENERALES", 18, by + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  doc.setTextColor(30, 41, 59);
  doc.text(
    "1. La autorización se limita a trabajadores con formación/capacitación adecuada para los equipos indicados.",
    18,
    by + 10,
  );
  doc.text(
    "2. El uso se realizará según las instrucciones del fabricante y de la empresa, respetando las medidas preventivas y dispositivos de seguridad.",
    18,
    by + 14,
  );
  doc.text(
    "3. El trabajador comunicará cualquier avería, anomalía o situación de riesgo y utilizará los EPIs requeridos.",
    18,
    by + 18,
  );
  drawResponsibleSignatureBand(doc, context);

  return finish(
    doc,
    config,
    `AUTORIZACION_MAQUINARIA_${slug(context.obra)}_${slug(context.periodoLabel)}.pdf`,
  );
};