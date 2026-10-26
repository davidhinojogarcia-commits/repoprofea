import { jsPDF } from "jspdf";
import { OFFICIAL_LOGO_BASE64 } from "../../assets/logoData.js";
import {
  PART_REASONS,
  PART_STATUS,
  type PartRecord,
  type PartSignature,
} from "./domain.js";
export async function generatePartPdf(
  p: PartRecord,
  assets: Array<{ id: string; base64: string; mime: string }>,
  antecedents: PartRecord[] = [],
): Promise<Uint8Array> {
  const doc = new jsPDF({ compress: true, unit: "mm", format: "a4" });
  doc.setCreationDate(new Date(p.updatedAt));
  doc.setFileId((p.contentHash || p.id.replace(/-/g, "")).slice(0, 32));
  let y = 45;
  const stamp = (date: string) =>
    new Date(date).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  function header() {
    doc.setTextColor("#00548E");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("DIPUTACIÓN PROVINCIAL DE CÁDIZ", 16, 18);
    doc.setFontSize(9);
    doc.text("GESTIÓN PROFEA", 16, 25);
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
    y = 45;
  }
  function room(height: number) {
    if (y + height > 271) {
      doc.addPage();
      header();
    }
  }
  function text(label: string, value: string) {
    const lines = doc.splitTextToSize(
      String(value || "No consta").replace(
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
        "",
      ),
      176,
    );
    room(12);
    doc.setFontSize(9);
    doc.setTextColor("#00548E");
    doc.setFont("helvetica", "bold");
    doc.text(label, 16, y);
    y += 5;
    doc.setTextColor("#243447");
    doc.setFont("helvetica", "normal");
    for (const line of lines) {
      room(5);
      doc.text(line, 16, y);
      y += 4.5;
    }
    y += 4;
  }
  async function signature(title: string, s?: PartSignature) {
    room(55);
    text(
      title,
      s
        ? `${s.actor.name} · ${stamp(s.at)} · Versión ${s.version}`
        : "No corresponde / pendiente",
    );
    if (!s) return;
    const file = assets.find((a) => a.id === s.asset.id);
    if (!file || file.mime !== "image/png")
      throw new Error("Falta una firma de la versión del documento.");
    const props = doc.getImageProperties(
      "data:image/png;base64," + file.base64,
    );
    const scale = Math.min(95 / props.width, 28 / props.height);
    room(32);
    doc.addImage(
      "data:image/png;base64," + file.base64,
      "PNG",
      16,
      y,
      props.width * scale,
      props.height * scale,
    );
    y += 32;
    text(
      "Actuación y evidencia",
      `${s.purpose} · ${s.actor.method} · ${s.actor.id}${s.capturedBy ? " · Recogida por " + s.capturedBy.name : ""}`,
    );
  }
  header();
  text(
    "Documento",
    p.elevation
      ? "PROPUESTA DE ELEVACIÓN PARA VALORACIÓN"
      : p.kind === "service"
        ? "AVISO INTERNO DE SERVICIO — PROFEA"
        : "PARTE DE INCIDENCIA LABORAL — PROFEA",
  );
  text(
    "Fecha de emisión y actuación",
    `${stamp(p.createdAt)} · ${stamp(p.updatedAt)}`,
  );
  text(
    "Identificación",
    `${p.number} · v${p.version} · revisión ${p.revision} · ${PART_STATUS[p.status]}`,
  );
  if (["draft", "returned", "submitted", "review"].includes(p.status))
    text(
      "BORRADOR — NO COMUNICABLE",
      "Pendiente de firma o revisión. Esta copia no acredita autorización ni entrega.",
    );
  text(
    "Naturaleza",
    "Comunicación de servicio o hechos para revisión. No constituye sanción disciplinaria. La recepción no supone conformidad con los hechos.",
  );
  text(
    "Obra",
    `${p.worksite.code} · ${p.worksite.name} · ${p.worksite.municipality}`,
  );
  text(
    "Trabajador",
    `${p.worker.name} · ID ${p.workerId} · ${p.worker.category} · ${p.worker.periodStart} a ${p.worker.periodEnd}`,
  );
  text("Encargado declarante", p.foremanName);
  text(
    "Motivo",
    PART_REASONS.find(([id]) => id === p.content.reason)?.[1] ||
      p.content.reason,
  );
  text(
    "Fecha y lugar del hecho",
    `${stamp(p.content.occurredAt)} · ${p.content.place}`,
  );
  text("Hechos observados", p.content.facts);
  text("Instrucción comunicada", p.content.instruction);
  text("Respuesta recogida", p.content.response);
  text("Testigos declarados", p.content.witnesses);
  for (const a of p.content.attachments)
    text("Anexo", `${a.name} · ${a.mime} · SHA-256 ${a.sha256}`);
  await signature("Declaración del encargado", p.foremanSignature);
  if (p.kind === "incident" || p.supervisorSignature) {
    text(
      "Revisión del supervisor",
      "Revisado y autorizada su comunicación al trabajador. No implica haber presenciado los hechos ni potestad sancionadora.",
    );
    await signature("Firma de revisión", p.supervisorSignature);
  }
  if (p.receipt) {
    text(
      "Constancia de comunicación",
      `${p.receipt.mode} · ${stamp(p.receipt.at)} · Recogida por ${p.receipt.actor.name}`,
    );
    text(
      "Observaciones del trabajador / incidencia de entrega",
      p.receipt.note,
    );
    text("Testigos de entrega declarados", p.receipt.witnesses);
    text("Otro medio registrado", p.receipt.otherChannel);
    if (!p.receipt.signature)
      text(
        "Recepción no acreditada",
        "La negativa o el intento fallido no demuestran la veracidad de los hechos ni la entrega efectiva.",
      );
    await signature(
      "Acuse de recibo del trabajador — no conformidad",
      p.receipt.signature,
    );
  }
  if (p.receiptReview) {
    text("Revisión de disconformidad", p.receiptReview.reason);
    await signature(
      "Firma de revisión de las observaciones",
      p.receiptReview.signature,
    );
  }
  if (p.decision)
    text(
      "Decisión motivada",
      `${p.decision.action} · ${p.decision.reason} · ${p.decision.actor.name} · ${stamp(p.decision.at)}`,
    );
  if (p.elevation) {
    text(
      "Propuesta para valoración",
      `${p.elevation.authority} · ${p.elevation.reason}`,
    );
    for (const id of p.elevation.recordIds) {
      const r =
        id === p.id
          ? p
          : (p.elevation.references || []).find((a) => a.id === id) ||
            antecedents.find((a) => a.id === id);
      text(
        "Antecedente incluido",
        r
          ? `${r.number} · ${stamp(r.content.occurredAt)} · ${r.work}\n${r.content.facts}`
          : `ID ${id} · Consulte la versión histórica incorporada. No se presume vigente ni comparable.`,
      );
    }
    await signature("Revisión y propuesta de elevación", p.elevation.signature);
    text(
      "Remisión",
      p.elevation.remittedAt
        ? `${stamp(p.elevation.remittedAt)} · ${p.elevation.channel}`
        : "Propuesta preparada. Remisión todavía no acreditada.",
    );
  }
  text("Integridad de la versión", p.contentHash);
  text(
    "Evidencia de identidad",
    "Firma táctil vinculada a una actuación y acceso registrados. No se declara firma cualificada. El acceso del encargado es un enlace de obra.",
  );
  for (let n = 1; n <= doc.getNumberOfPages(); n++) {
    doc.setPage(n);
    doc.setFontSize(7);
    doc.setTextColor("#526174");
    doc.text(
      "GestionProfea · © David Hinojo García · Uso restringido",
      16,
      285,
    );
    doc.text(`${n}/${doc.getNumberOfPages()}`, 185, 285);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
