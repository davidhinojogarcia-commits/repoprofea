import { jsPDF } from "jspdf";
import { OFFICIAL_LOGO_BASE64 } from "../../assets/logoData.js";
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUS,
  COMMON_FIELDS,
  REJECTION_FIELDS,
  EXIT_FIELDS,
  declaration,
  documentVariant,
  RECEIPT_TEXT,
  LEGAL_NOTE,
  stamp,
  type WorkforceDocument,
} from "./domain.js";
/** Server-generated from a persisted-version candidate; final bytes stored atomically with signatures. */
export function workforcePdf(
  p: WorkforceDocument,
  returnOnly = false,
): Uint8Array {
  const doc = new jsPDF({ compress: true, unit: "mm", format: "a4" });
  let y = 46;
  doc.setCreationDate(new Date(p.updatedAt));
  doc.setFileId(p.hash.slice(0, 32));
  doc.setProperties({
    title: DOCUMENT_KINDS[p.kind],
    author: p.worksite.employer,
    creator: "GestionPROFEA",
  });
  function header() {
    doc.setTextColor("#00548E");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("DIPUTACIÓN PROVINCIAL DE CÁDIZ", 16, 18);
    doc.setFontSize(9);
    doc.text("GESTIÓN PROFEA · DOCUMENTACIÓN DE OBRA", 16, 25);
    const logo = doc.getImageProperties(OFFICIAL_LOGO_BASE64);
    doc.addImage(
      OFFICIAL_LOGO_BASE64,
      "PNG",
      154,
      10,
      38,
      (38 * logo.height) / logo.width,
    );
    doc.setDrawColor("#00548E");
    doc.line(16, 37, 194, 37);
    y = 46;
  }
  function room(h: number) {
    if (y + h > 270) {
      const font = doc.getFont(),
        size = doc.getFontSize(),
        color = doc.getTextColor();
      doc.addPage();
      header();
      doc.setFont(font.fontName, font.fontStyle);
      doc.setFontSize(size);
      doc.setTextColor(color);
    }
  }
  function text(label: string, value: string) {
    room(13);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor("#00548E");
    doc.text(label, 16, y);
    y += 5;
    doc.setTextColor("#243447");
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(
      String(value || "No consta").replace(
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
        "",
      ),
      176,
    );
    for (const line of lines) {
      room(5);
      doc.text(line, 16, y);
      y += 4.5;
    }
    y += 4;
  }
  header();
  text(
    returnOnly
      ? "DILIGENCIA DE REGRESO"
      : DOCUMENT_KINDS[p.kind].toLocaleUpperCase("es"),
    `${p.id} · Versión ${p.version} · ${returnOnly ? "Actuación vinculada" : DOCUMENT_STATUS[p.status]}${p.kind === "salida_obra" && p.status === "completed" ? " · Regreso pendiente" : ""}`,
  );
  if (!returnOnly) text("Supuesto documentado", documentVariant(p));
  const signed =
    ["completed", "return_recorded", "annulled"].includes(p.status) &&
    !!p.signatures.foreman;
  if (!signed)
    text(
      "BORRADOR / PENDIENTE DE AMBAS FIRMAS",
      "No es un documento finalizado.",
    );
  text("Entidad empleadora", `${p.worksite.employer} · CIF ${p.worksite.cif}`);
  text(
    "Obra y municipio",
    `${p.worksite.code} · ${p.worksite.name}\n${p.worksite.municipality}`,
  );
  text(
    "Persona trabajadora",
    `${p.worker.name} · DNI/NIE ${p.worker.dni} · ${p.worker.category}`,
  );
  text(
    "Contratación",
    `Referencia: ${p.content.contractReference || p.worker.reference}\nPeriodo registrado: ${p.worker.start || "Pendiente"} / ${p.worker.end || "Pendiente"}${p.worker.offer ? " · Oferta SAE: " + p.worker.offer : ""}`,
  );
  if (returnOnly) {
    const r = p.returnEntry;
    if (!r) throw new Error("No consta diligencia de regreso.");
    text(
      "Salida y regreso efectivos",
      `${stamp(r.actualExit)} / ${stamp(r.at)}\nIntervalo real: ${Math.round((Date.parse(r.at) - Date.parse(r.actualExit)) / 60000)} minutos.`,
    );
    text(
      "Registro de comprobación",
      `${r.actor.name} · ${r.actor.id} · ${stamp(r.recordedAt)}\n${r.note || "Sin observaciones"}`,
    );
    text(
      "Alcance",
      "Actuación vinculada al documento firmado de salida, que se conserva íntegro. La previsión inicial no se convierte en un fichaje ni en un tiempo real acreditado.",
    );
  } else {
    const fields = [
      ...COMMON_FIELDS,
      ...(p.kind === "rechazo_voluntario" ? REJECTION_FIELDS : EXIT_FIELDS),
    ];
    for (const f of fields) {
      const v = p.content[f.key];
      if (!v || ["workerNotes", "foremanNotes", "reasonBrief"].includes(f.key))
        continue;
      if (
        p.kind === "salida_obra" &&
        ((f.key === "duration" && p.content.returnMode !== "duration") ||
          (f.key === "returnAt" && p.content.returnMode !== "at"))
      )
        continue;
      text(
        f.label,
        f.type === "instant"
          ? stamp(v)
          : f.options?.find((o) => o[0] === v)?.[1] || v,
      );
    }
    text("Manifestación de la persona trabajadora", declaration(p));
    text(
      "Observaciones del trabajador",
      p.content.workerNotes || "Sin observaciones",
    );
    text(
      "Constancia del encargado",
      `${p.foreman.name} · ${p.foreman.id}\n${RECEIPT_TEXT}`,
    );
    text(
      "Observaciones del encargado",
      p.content.foremanNotes || "Sin observaciones",
    );
    for (const role of ["worker", "foreman"] as const) {
      const s = p.signatures[role];
      room(58);
      text(
        role === "worker"
          ? "Firma voluntaria del trabajador"
          : "Confirmación expresa y firma del encargado",
        s
          ? `${s.actor.name} · ${stamp(s.at)} · v${s.version}\nOperador: ${s.capturedBy.name} · ${s.capturedBy.id}`
          : "Pendiente",
      );
      if (s) {
        const props = doc.getImageProperties(s.image);
        const scale = Math.min(100 / props.width, 25 / props.height);
        doc.addImage(
          s.image,
          "PNG",
          16,
          y,
          props.width * scale,
          props.height * scale,
        );
        y += 30;
      }
    }
  }
  text(
    "Lugar y fecha de documentación",
    `${p.worksite.municipality} · ${stamp(p.updatedAt)} (Europe/Madrid)`,
  );
  text("Alcance y tramitación", LEGAL_NOTE);
  text("Integridad de la versión", p.hash);
  for (let n = 1; n <= doc.getNumberOfPages(); n++) {
    doc.setPage(n);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor("#526174");
    doc.text(
      `${p.id} · v${p.version} · ${signed ? "Uso restringido" : "BORRADOR"}`,
      16,
      282,
    );
    doc.text(`${n}/${doc.getNumberOfPages()}`, 185, 288);
    doc.text("GestionPROFEA · © David Hinojo García", 16, 288);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
