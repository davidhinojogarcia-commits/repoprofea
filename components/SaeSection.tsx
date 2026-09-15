import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  Link2,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import {
  parseSaeNeedFile,
  parseSaeReportFile,
  fileToDataUrl,
  titleCaseSpanish,
} from "../src/lib/saeDocumentParser";
import {
  createDocument,
  deleteDocument,
} from "../src/services/databaseService";
import {
  SAE_RESULT_CODES,
  SaeCandidate,
  SaeNeed,
  SaeReport,
  createSaeNeed,
  createSaeReport,
  deleteSaeNeed,
  deleteSaeReport,
  listSaeCandidates,
  listSaeNeeds,
  listSaeReports,
  monthNumber,
  updateSaeCandidate,
  updateSaeNeed,
} from "../src/services/saeService";
import { loadAppBusinessSettings } from "../src/services/appSettingsService";

interface SaeSectionProps {
  people: any[];
  onToast: (message: string, type: "success" | "error") => void;
}
type NeedForm = {
  obra: string;
  codigoObra: string;
  mes: string;
  ano: string;
  categorias: { categoria: string; cantidad: number }[];
  notas: string;
};
const emptyNeed: NeedForm = {
  obra: "",
  codigoObra: "",
  mes: "",
  ano: String(new Date().getFullYear()),
  categorias: [{ categoria: "", cantidad: 1 }],
  notas: "",
};
const norm = (v: string) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const workIdentity = (value: string) => {
  const raw = norm(value).replace(/[._\-/:]+/g, " ");
  const code = raw.match(/\b(\d{5})\b/)?.[1] || "";
  const compact = raw.replace(/\s+/g, "");
  const type = compact.includes("gr")
    ? "GR"
    : compact.includes("ee")
      ? "EE"
      : "";
  return code && type ? `${code} ${type}` : "";
};
const normalizeSaeCategory = (value: string) => {
  const n = norm(value);
  if (/\bpeon(?:es)?\b/.test(n)) return "Peón";
  return String(value || "").trim();
};
const dataUrlToBytes = (dataUrl: string) => {
  const raw = atob(dataUrl.split(",")[1] || "");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
};
const bytesToBlob = (bytes: Uint8Array) =>
  new Blob(
    [
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ],
    { type: "application/pdf" },
  );
const loadPdfLib = async () =>
  (await import(
    /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"
  )) as any;

export const SaeSection: React.FC<SaeSectionProps> = ({ people, onToast }) => {
  const [needs, setNeeds] = useState<SaeNeed[]>([]);
  const [selectedNeedId, setSelectedNeedId] = useState("");
  const [reports, setReports] = useState<SaeReport[]>([]);
  const [candidates, setCandidates] = useState<SaeCandidate[]>([]);
  const [needForm, setNeedForm] = useState<NeedForm>(emptyNeed);
  const [pendingImportedNeeds, setPendingImportedNeeds] = useState<NeedForm[]>(
    [],
  );
  const [showNeedForm, setShowNeedForm] = useState(false);
  const [editingNeedId, setEditingNeedId] = useState<string | null>(null);
  const [needSort, setNeedSort] = useState<"recientes" | "obra" | "mes">(
    "recientes",
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [returnedReportIds, setReturnedReportIds] = useState<string[]>([]);
  const [previewReport, setPreviewReport] = useState<SaeReport | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewOffsetX, setPreviewOffsetX] = useState(0);
  const [previewOffsetY, setPreviewOffsetY] = useState(0);
  const selectedNeed = needs.find((n) => n.id === selectedNeedId) || null;

  const sortedNeeds = useMemo(
    () =>
      [...needs].sort((a, b) => {
        if (needSort === "obra")
          return (
            a.obra.localeCompare(b.obra, "es", { sensitivity: "base" }) ||
            (b.ano || 0) - (a.ano || 0) ||
            (monthNumber(b.mes) || 0) - (monthNumber(a.mes) || 0)
          );
        if (needSort === "mes")
          return (
            (b.ano || 0) - (a.ano || 0) ||
            (monthNumber(b.mes) || 0) - (monthNumber(a.mes) || 0) ||
            a.obra.localeCompare(b.obra, "es")
          );
        return String(b.createdAt || "").localeCompare(
          String(a.createdAt || ""),
        );
      }),
    [needs, needSort],
  );

  const refresh = async (needId = selectedNeedId) => {
    const next = await listSaeNeeds();
    setNeeds(next);
    const resolved =
      needId && next.some((n) => n.id === needId) ? needId : next[0]?.id || "";
    setSelectedNeedId(resolved);
    if (!resolved) {
      setReports([]);
      setCandidates([]);
      return;
    }
    const [r, c] = await Promise.all([
      listSaeReports(resolved),
      listSaeCandidates(resolved),
    ]);
    setReports(r);
    setCandidates(c);
  };
  useEffect(() => {
    void refresh().catch((e) =>
      onToast(e.message || "No se pudo cargar SAE.", "error"),
    );
  }, []);
  useEffect(() => {
    if (!selectedNeedId) return;
    void Promise.all([
      listSaeReports(selectedNeedId),
      listSaeCandidates(selectedNeedId),
    ])
      .then(([r, c]) => {
        setReports(r);
        setCandidates(c);
      })
      .catch((e) =>
        onToast(e.message || "No se pudo cargar la necesidad SAE.", "error"),
      );
  }, [selectedNeedId]);
  useEffect(() => {
    setReturnedReportIds([]);
  }, [selectedNeedId]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const stats = useMemo(
    () => ({
      candidates: candidates.length,
      selected: candidates.filter((c) =>
        [
          "Preseleccionado",
          "1ª Quincena",
          "2ª Quincena",
          "Contratado",
        ].includes(c.estado),
      ).length,
      contracted: candidates.filter((c) => c.estado === "Contratado").length,
      pending: candidates.filter((c) => !c.resultCode).length,
    }),
    [candidates],
  );
  const categoryStats = useMemo(
    () =>
      (selectedNeed?.categorias || []).map((req) => {
        const pool = candidates.filter(
          (c) =>
            norm(c.categoria).includes(norm(req.categoria)) ||
            norm(req.categoria).includes(norm(c.categoria)),
        );
        return {
          ...req,
          pool: pool.length,
          assigned: pool.filter((c) => c.quincena || c.estado === "Contratado")
            .length,
        };
      }),
    [selectedNeed, candidates],
  );
  const stepLabels = [
    "Necesidad",
    "Informes SAE",
    "Candidatos",
    "Distribución",
    "Registros",
    "Contratación",
    "Devolución",
  ];
  const completedSteps = useMemo(() => {
    const candidatesReviewed =
      candidates.length > 0 &&
      candidates.every(
        (c) =>
          Boolean(String(c.nombre || "").trim()) &&
          Boolean(String(c.apellidos || "").trim()) &&
          Boolean(String(c.categoria || "").trim()),
      );
    const distributionComplete =
      candidates.length > 0 &&
      candidates.every(
        (c) =>
          Boolean(c.quincena) ||
          Boolean(c.resultCode && c.resultCode !== "2001"),
      );
    const intendedForHiring = candidates.filter(
      (c) =>
        Boolean(c.quincena) ||
        c.estado === "Contratado" ||
        c.resultCode === "2001",
    );
    const recordsComplete =
      candidates.length > 0 &&
      (intendedForHiring.length > 0
        ? intendedForHiring.every((c) => Boolean(c.linkedWorkerId))
        : candidates.every((c) => Boolean(c.resultCode)));
    const contractingComplete =
      candidates.length > 0 &&
      candidates.every((c) => Boolean(c.resultCode)) &&
      candidates
        .filter((c) => c.resultCode === "2001")
        .every((c) => Boolean(c.linkedWorkerId));
    const returnComplete =
      reports.length > 0 &&
      reports.every((r) => returnedReportIds.includes(r.id));
    return [
      Boolean(selectedNeed),
      reports.length > 0,
      candidatesReviewed,
      distributionComplete,
      recordsComplete,
      contractingComplete,
      returnComplete,
    ];
  }, [selectedNeed, reports, candidates, returnedReportIds]);
  const activeStep = useMemo(() => {
    const firstPending = completedSteps.findIndex((done) => !done);
    return firstPending === -1 ? 7 : firstPending + 1;
  }, [completedSteps]);

  const patchCandidate = async (
    candidate: SaeCandidate,
    patch: Partial<SaeCandidate>,
  ) => {
    const optimistic = { ...candidate, ...patch };
    setCandidates((p) =>
      p.map((c) => (c.id === candidate.id ? optimistic : c)),
    );
    try {
      await updateSaeCandidate(candidate.id, patch);
    } catch (e: any) {
      setCandidates((p) =>
        p.map((c) => (c.id === candidate.id ? candidate : c)),
      );
      onToast(e.message || "No se pudo actualizar el candidato.", "error");
    }
  };
  const startNewNeed = () => {
    setEditingNeedId(null);
    setNeedForm(emptyNeed);
    setPendingImportedNeeds([]);
    setShowNeedForm(true);
  };
  const startEditNeed = (n: SaeNeed) => {
    setEditingNeedId(n.id);
    setNeedForm({
      obra: n.obra,
      codigoObra: n.codigoObra,
      mes: n.mes,
      ano: String(n.ano || new Date().getFullYear()),
      categorias: n.categorias.map((c) => ({
        categoria: c.categoria,
        cantidad: c.cantidad,
      })),
      notas: n.notas || "",
    });
    setPendingImportedNeeds([]);
    setShowNeedForm(true);
  };

  const handleNeedFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setProgress("Analizando necesidad de contratación…");
    try {
      const parsed = await parseSaeNeedFile(file, setProgress);
      const units = parsed.detectedNeeds?.length
        ? parsed.detectedNeeds
        : [parsed];
      const forms: NeedForm[] = units.map((item) => ({
        obra: item.obra,
        codigoObra: item.codigoObra,
        mes: item.mes,
        ano: item.ano ? String(item.ano) : String(new Date().getFullYear()),
        categorias: item.categorias.length
          ? item.categorias
          : [{ categoria: "", cantidad: 1 }],
        notas: item.notas || "",
      }));
      setEditingNeedId(null);
      setNeedForm(forms[0]);
      setPendingImportedNeeds(forms.slice(1));
      setShowNeedForm(true);
      onToast(
        forms.length > 1
          ? `${forms.length} necesidades detectadas. Revise cada una.`
          : "Necesidad analizada. Revise los datos antes de confirmar.",
        "success",
      );
    } catch (e: any) {
      onToast(e.message || "No se pudo analizar el documento.", "error");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const saveNeed = async () => {
    if (!needForm.obra.trim() || !needForm.mes.trim())
      return onToast("Indique obra y mes.", "error");
    const cats = needForm.categorias.filter(
      (c) =>
        c.categoria.trim() &&
        (c.cantidad > 0 || /PENDIENTE/i.test(c.categoria)),
    );
    if (!cats.length)
      return onToast("Añada al menos una categoría y cantidad.", "error");
    setBusy(true);
    try {
      const input = {
        obra: needForm.obra.trim(),
        codigoObra: needForm.codigoObra.trim(),
        mes: needForm.mes.trim(),
        ano: Number(needForm.ano) || null,
        estado: selectedNeed?.estado || "pendiente_candidatos_sae",
        categorias: cats.map((c, i) => ({ id: `draft_${i}`, ...c })),
        notas: needForm.notas.trim(),
      };
      if (editingNeedId) {
        await updateSaeNeed(editingNeedId, input);
        await refresh(editingNeedId);
        setEditingNeedId(null);
        setShowNeedForm(false);
        setNeedForm(emptyNeed);
        onToast("Necesidad SAE actualizada.", "success");
        return;
      }
      const created = await createSaeNeed(input);
      setSelectedNeedId(created.id);
      await refresh(created.id);
      if (pendingImportedNeeds.length) {
        const [next, ...rest] = pendingImportedNeeds;
        setNeedForm(next);
        setPendingImportedNeeds(rest);
        setShowNeedForm(true);
        onToast(
          `Necesidad guardada. Quedan ${rest.length + 1} por revisar.`,
          "success",
        );
      } else {
        setShowNeedForm(false);
        setNeedForm(emptyNeed);
        onToast("Necesidad SAE creada correctamente.", "success");
      }
    } catch (e: any) {
      onToast(e.message || "No se pudo guardar la necesidad.", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeNeed = async (n: SaeNeed) => {
    const count = candidates.filter(
      (c) => c.needId === n.id && c.linkedWorkerId,
    ).length;
    if (count) {
      onToast(
        `No se puede eliminar mientras existan ${count} contratación(es) SAE vinculadas. Reviértalas primero.`,
        "error",
      );
      return;
    }
    if (
      !window.confirm(
        `¿Eliminar la necesidad de ${n.obra} (${n.mes} ${n.ano || ""}) y sus informes/candidatos asociados?`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteSaeNeed(n.id);
      await refresh("");
      setShowNeedForm(false);
      setEditingNeedId(null);
      onToast("Necesidad SAE eliminada.", "success");
    } catch (e: any) {
      onToast(e.message || "No se pudo eliminar la necesidad.", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeReport = async (report: SaeReport) => {
    const linked = candidates.filter(
      (candidate) =>
        candidate.reportId === report.id && candidate.linkedWorkerId,
    );
    if (linked.length) {
      onToast(
        `No se puede eliminar: ${linked.length} candidato(s) de este informe ya generaron una contratación. Reviértalas primero.`,
        "error",
      );
      return;
    }
    if (
      !window.confirm(
        `¿Eliminar exclusivamente el informe “${report.fileName}” y sus candidatos importados? La necesidad de contratación se conservará.`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteSaeReport(report);
      await refresh(selectedNeedId);
      onToast(
        "Informe SAE eliminado. La necesidad de contratación se conserva.",
        "success",
      );
    } catch (error: any) {
      onToast(error.message || "No se pudo eliminar el informe SAE.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleReportFile = async (file?: File) => {
    if (!file || !selectedNeed) return;
    setBusy(true);
    setProgress("Leyendo informe SAE…");
    try {
      const parsed = await parseSaeReportFile(file, setProgress);
      if (!parsed.candidates.length)
        throw new Error("No se han reconocido candidatos.");
      const workKey = (v: string) => {
        const s = norm(v).replace(/[.\s_\-/:]+/g, "");
        const code = s.match(/(\d{5})/)?.[1] || "";
        const type = s.includes("gr") ? "gr" : s.includes("ee") ? "ee" : "";
        return code && type ? `${code}${type}` : s;
      };
      if (
        workKey(selectedNeed.codigoObra) &&
        workKey(parsed.codigoObra) &&
        workKey(selectedNeed.codigoObra) !== workKey(parsed.codigoObra)
      )
        throw new Error(
          `El informe corresponde a la obra ${parsed.codigoObra}, pero está seleccionada ${selectedNeed.codigoObra}.`,
        );
      if (
        selectedNeed.mes &&
        parsed.mes &&
        norm(selectedNeed.mes) !== norm(parsed.mes)
      )
        throw new Error(
          `El informe corresponde a ${parsed.mes}, pero la necesidad es de ${selectedNeed.mes}.`,
        );
      const fileBase64 = await fileToDataUrl(file);
      await createSaeReport(
        selectedNeed.id,
        {
          fileName: file.name,
          fileBase64,
          extractedText: parsed.sourceText,
          extractionSource: parsed.source,
          offerNumber: parsed.offerNumber,
          obra: parsed.obra || selectedNeed.obra,
          codigoObra: parsed.codigoObra || selectedNeed.codigoObra,
          mes: parsed.mes || selectedNeed.mes,
          quincena: parsed.quincena,
          categoria: parsed.categoria,
        },
        parsed.candidates.map((c) => ({
          orderNumber: c.orderNumber,
          fullNameOriginal: c.fullNameOriginal,
          normalizedName: c.normalizedName,
          apellidos: c.apellidos,
          nombre: c.nombre,
          categoria: parsed.categoria,
          obra: parsed.obra || selectedNeed.obra,
          codigoObra: parsed.codigoObra || selectedNeed.codigoObra,
          offerNumber: parsed.offerNumber,
          mes: parsed.mes || selectedNeed.mes,
          quincena: "",
          estado: "Sin asignar",
          resultCode: "",
          linkedWorkerId: null,
          pageNumber: c.pageNumber,
          overlayX: c.overlayX,
          overlayY: c.overlayY,
          confidence: c.confidence,
        })),
      );
      await refresh(selectedNeed.id);
      onToast(
        `${parsed.candidates.length} candidatos SAE reconocidos.`,
        "success",
      );
    } catch (e: any) {
      onToast(e.message || "No se pudo analizar el informe SAE.", "error");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const registerWorker = async (candidate: SaeCandidate) => {
    if (!candidate.quincena)
      return onToast("Asigne primero una quincena.", "error");
    const previous = people.find(
      (p) => norm(p.apellidosNombre) === norm(candidate.normalizedName),
    );
    const workerId = Date.now() + Math.floor(Math.random() * 900000);
    try {
      const settings = await loadAppBusinessSettings();
      const detectedIdentity = workIdentity(
        selectedNeed?.codigoObra ||
          candidate.codigoObra ||
          candidate.obra ||
          selectedNeed?.obra ||
          "",
      );
      const configuredMatch = (settings.savedObras || []).find(
        (obra) => workIdentity(obra) === detectedIdentity,
      );
      const canonicalWork =
        workIdentity(configuredMatch || "") || detectedIdentity;
      if (!canonicalWork) {
        throw new Error(
          "No se ha podido asociar el candidato a una obra configurada con código y tipo (por ejemplo 11002 GR). Revise Configuración → Obras.",
        );
      }
      const sourceCategory =
        candidate.categoria || selectedNeed?.categorias?.[0]?.categoria || "";
      const canonicalCategory = normalizeSaeCategory(sourceCategory);
      const worker = {
        id: workerId,
        fechaRegistro: new Date().toISOString(),
        supervisorResponsable: previous?.supervisorResponsable || "",
        numOferta: candidate.offerNumber,
        obra: canonicalWork,
        categoria: canonicalCategory,
        quincena: candidate.quincena,
        apellidosNombre: candidate.normalizedName,
        dni: previous?.dni || "",
        fechaNacimiento: previous?.fechaNacimiento || "",
        periodoInicio: "",
        periodoFin: "",
        telefono: previous?.telefono || "",
        calzado: previous?.calzado || "",
        formacion: previous?.formacion || "No",
        lugarFormacion: previous?.lugarFormacion || "",
        citaDia: "",
        citaHora: "",
        sitioReconocimiento: "",
        documentacionCompleta: "No",
        observaciones: `Contratación SAE · Oferta ${candidate.offerNumber} · Orden ${candidate.orderNumber}. Obra normalizada: ${canonicalWork}.`,
        necesitaReconocimiento: previous?.necesitaReconocimiento || "No",
        sincronizadoEnNube: true,
      };
      await createDocument("trabajadores", workerId, worker as any);
      await patchCandidate(candidate, {
        estado: "Contratado",
        resultCode: "2001",
        linkedWorkerId: workerId,
      });
      onToast(
        `Trabajador registrado en ${canonicalWork}${canonicalCategory ? ` como ${canonicalCategory}` : ""} y contratación SAE confirmada (2001).`,
        "success",
      );
    } catch (e: any) {
      onToast(e.message || "No se pudo registrar al trabajador.", "error");
    }
  };
  const revertWorker = async (candidate: SaeCandidate) => {
    const workerId = candidate.linkedWorkerId;
    if (!workerId) {
      onToast(
        "Este candidato no tiene un trabajador SAE vinculado para revertir.",
        "error",
      );
      return;
    }
    if (
      !window.confirm(
        `¿Revertir la contratación de ${candidate.normalizedName}? Se eliminará únicamente el registro de trabajador creado por esta contratación SAE y el candidato volverá a su quincena.`,
      )
    )
      return;

    const nextEstado = candidate.quincena || "Sin asignar";
    const revertedPatch = {
      estado: nextEstado,
      resultCode: "",
      linkedWorkerId: null,
    };
    const originalPatch = {
      estado: "Contratado",
      resultCode: candidate.resultCode || "2001",
      linkedWorkerId: workerId,
    };

    try {
      await updateSaeCandidate(candidate.id, revertedPatch);
    } catch (e: any) {
      onToast(
        e.message ||
          "No se pudo actualizar el candidato SAE. No se ha eliminado ningún trabajador.",
        "error",
      );
      return;
    }

    try {
      await deleteDocument("trabajadores", workerId);
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidate.id ? { ...c, ...revertedPatch } : c,
        ),
      );
      const fresh = await listSaeCandidates(candidate.needId);
      setCandidates(fresh);
      onToast(
        "Contratación revertida correctamente. El candidato vuelve a estar editable.",
        "success",
      );
    } catch (e: any) {
      try {
        await updateSaeCandidate(candidate.id, originalPatch);
      } catch (rollbackError) {
        console.error(
          "No se pudo restaurar el candidato tras fallar la reversión SAE:",
          rollbackError,
        );
      }
      try {
        const fresh = await listSaeCandidates(candidate.needId);
        setCandidates(fresh);
      } catch {}
      onToast(
        e.message ||
          "No se pudo eliminar el trabajador vinculado. La contratación se ha mantenido.",
        "error",
      );
    }
  };

  const buildReturnPdfBytes = async (
    report: SaeReport,
    offsetX = 0,
    offsetY = 0,
    requireComplete = true,
  ): Promise<Uint8Array> => {
    const rows = candidates.filter((c) => c.reportId === report.id);
    if (!rows.length)
      throw new Error("No hay candidatos asociados al informe.");
    if (requireComplete) {
      const p = rows.filter((c) => !c.resultCode);
      if (p.length)
        throw new Error(`Quedan ${p.length} candidatos sin código SAE.`);
    }
    if (!report.fileBase64.startsWith("data:application/pdf"))
      throw new Error("La devolución sobre original requiere PDF.");
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const pdf = await PDFDocument.load(dataUrlToBytes(report.fileBase64));
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pages = pdf.getPages();
    for (const c of rows) {
      const page = pages[Math.max(0, c.pageNumber - 1)];
      if (!page) continue;
      const code = String(c.resultCode || "").trim();
      if (!code) continue;
      page.drawText(code, {
        x: ((c.overlayX + offsetX) * 72) / 25.4,
        y: page.getHeight() - ((c.overlayY + offsetY) * 72) / 25.4 - 8,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
    }
    return await pdf.save();
  };
  const generateReturnPdf = async (report: SaeReport) => {
    setBusy(true);
    setProgress("Generando devolución SAE…");
    try {
      const bytes = await buildReturnPdfBytes(report);
      const url = URL.createObjectURL(bytesToBlob(bytes));
      const a = document.createElement("a");
      a.href = url;
      a.download = `SAE_CUMPLIMENTADO_${report.offerNumber || report.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReturnedReportIds((prev) =>
        prev.includes(report.id) ? prev : [...prev, report.id],
      );
      onToast("Documento SAE generado sobre el original.", "success");
    } catch (e: any) {
      onToast(e.message || "No se pudo generar el documento.", "error");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const refreshPreview = async (report: SaeReport, x: number, y: number) => {
    const bytes = await buildReturnPdfBytes(report, x, y, false);
    const url = URL.createObjectURL(bytesToBlob(bytes));
    setPreviewUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return url;
    });
  };
  const openPreview = async (report: SaeReport) => {
    setPreviewReport(report);
    setPreviewOffsetX(0);
    setPreviewOffsetY(0);
    try {
      await refreshPreview(report, 0, 0);
    } catch (e: any) {
      setPreviewReport(null);
      onToast(e.message || "No se pudo abrir la vista previa.", "error");
    }
  };
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setPreviewReport(null);
    setPreviewOffsetX(0);
    setPreviewOffsetY(0);
  };
  const applyPreviewOffset = async () => {
    if (!previewReport) return;
    const rows = candidates.filter((c) => c.reportId === previewReport.id);
    try {
      await Promise.all(
        rows.map((c) =>
          updateSaeCandidate(c.id, {
            overlayX: c.overlayX + previewOffsetX,
            overlayY: c.overlayY + previewOffsetY,
          }),
        ),
      );
      setCandidates((p) =>
        p.map((c) =>
          c.reportId === previewReport.id
            ? {
                ...c,
                overlayX: c.overlayX + previewOffsetX,
                overlayY: c.overlayY + previewOffsetY,
              }
            : c,
        ),
      );
      setPreviewOffsetX(0);
      setPreviewOffsetY(0);
      await refreshPreview(previewReport, 0, 0);
      onToast("Posición guardada.", "success");
    } catch (e: any) {
      onToast(e.message || "No se pudo guardar el ajuste.", "error");
    }
  };

  return (
    <div className="space-y-6 min-w-0">
      <div className="ui-surface p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#00548E] dark:text-blue-400 mb-1">
              <BriefcaseBusiness className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-[0.16em]">
                Servicio Andaluz de Empleo
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black">Gestión SAE</h1>
            <p className="text-sm text-slate-500 mt-1">
              Necesidad → informes → candidatos → quincenas → registros →
              contratación → devolución SAE.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold text-sm cursor-pointer">
              <FileText className="w-4 h-4" />
              Importar necesidad
              <input
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                disabled={busy}
                onChange={(e) => {
                  void handleNeedFile(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              onClick={startNewNeed}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm"
            >
              <Plus className="w-4 h-4" />
              Nueva necesidad
            </button>
          </div>
        </div>
        <div
          className="mt-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2"
          aria-label="Progreso SAE"
        >
          {stepLabels.map((label, index) => {
            const step = index + 1;
            const done = completedSteps[index];
            const current = !done && activeStep === step;
            return (
              <div
                key={label}
                aria-current={current ? "step" : undefined}
                className={`rounded-xl px-2 py-2.5 text-[11px] sm:text-xs font-bold border flex items-center justify-center gap-1.5 text-center transition-colors ${done ? "bg-emerald-600 text-white border-emerald-600 shadow-sm" : current ? "bg-[#00548E] text-white border-[#00548E] shadow-sm" : "bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800"}`}
              >
                {done ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <span
                    className={`w-5 h-5 shrink-0 rounded-full grid place-items-center text-[10px] border ${current ? "border-white/70" : "border-slate-300 dark:border-slate-700"}`}
                  >
                    {step}
                  </span>
                )}
                <span>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Verde: completado · Azul: fase actual · Gris: pendiente
        </div>
      </div>
      {busy && (
        <div className="ui-surface p-4 flex items-center gap-3 text-sm font-semibold">
          <Loader2 className="w-4 h-4 animate-spin" />
          {progress || "Procesando…"}
        </div>
      )}
      {showNeedForm && (
        <div className="ui-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-lg">
              {editingNeedId
                ? "Editar necesidad"
                : "Revisión de necesidad de contratación"}
            </h2>
            {editingNeedId && (
              <span className="text-xs font-bold text-amber-600">
                Modo edición
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              value={needForm.obra}
              onChange={(e) =>
                setNeedForm((f) => ({ ...f, obra: e.target.value }))
              }
              placeholder="Obra"
              className="ui-input"
            />
            <input
              value={needForm.codigoObra}
              onChange={(e) =>
                setNeedForm((f) => ({ ...f, codigoObra: e.target.value }))
              }
              placeholder="Código obra"
              className="ui-input"
            />
            <input
              value={needForm.mes}
              onChange={(e) =>
                setNeedForm((f) => ({ ...f, mes: e.target.value }))
              }
              placeholder="Mes"
              className="ui-input"
            />
            <input
              value={needForm.ano}
              onChange={(e) =>
                setNeedForm((f) => ({ ...f, ano: e.target.value }))
              }
              placeholder="Año"
              className="ui-input"
            />
          </div>
          <div className="space-y-2">
            {needForm.categorias.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_42px] gap-2">
                <input
                  value={c.categoria}
                  onChange={(e) =>
                    setNeedForm((f) => ({
                      ...f,
                      categorias: f.categorias.map((x, j) =>
                        j === i ? { ...x, categoria: e.target.value } : x,
                      ),
                    }))
                  }
                  placeholder="Categoría"
                  className="ui-input"
                />
                <input
                  type="number"
                  min={1}
                  value={c.cantidad}
                  onChange={(e) =>
                    setNeedForm((f) => ({
                      ...f,
                      categorias: f.categorias.map((x, j) =>
                        j === i
                          ? { ...x, cantidad: Number(e.target.value) || 1 }
                          : x,
                      ),
                    }))
                  }
                  className="ui-input"
                />
                <button
                  onClick={() =>
                    setNeedForm((f) => ({
                      ...f,
                      categorias: f.categorias.filter((_, j) => j !== i),
                    }))
                  }
                  className="rounded-xl border border-red-200 text-red-600"
                >
                  <Trash2 className="w-4 h-4 mx-auto" />
                </button>
              </div>
            ))}
          </div>
          <textarea
            value={needForm.notas}
            onChange={(e) =>
              setNeedForm((f) => ({ ...f, notas: e.target.value }))
            }
            rows={2}
            className="ui-input w-full"
            placeholder="Observaciones…"
          />
          <div className="flex justify-between gap-3">
            <button
              onClick={() =>
                setNeedForm((f) => ({
                  ...f,
                  categorias: [...f.categorias, { categoria: "", cantidad: 1 }],
                }))
              }
              className="text-sm font-bold text-[#00548E]"
            >
              + Añadir categoría
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowNeedForm(false);
                  setEditingNeedId(null);
                }}
                className="px-4 py-2.5 rounded-xl border font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={() => void saveNeed()}
                disabled={busy}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold"
              >
                {editingNeedId ? "Guardar cambios" : "Confirmar necesidad"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid lg:grid-cols-[340px_1fr] gap-6 min-w-0">
        <aside className="ui-surface p-4 h-fit">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-black">Necesidades</h2>
            <select
              value={needSort}
              onChange={(e) => setNeedSort(e.target.value as any)}
              className="ui-input !w-auto !py-1.5 text-xs"
            >
              <option value="recientes">Recientes</option>
              <option value="obra">Por obra</option>
              <option value="mes">Por mes</option>
            </select>
          </div>
          <div className="space-y-2">
            {sortedNeeds.map((n) => (
              <div
                key={n.id}
                className={`rounded-xl border p-3 ${selectedNeedId === n.id ? "border-[#00548E] bg-blue-50 dark:bg-blue-950/20" : "border-slate-200 dark:border-slate-800"}`}
              >
                <button
                  onClick={() => setSelectedNeedId(n.id)}
                  className="w-full text-left"
                >
                  <div className="font-bold text-sm">{n.obra}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {n.mes} {n.ano || ""} ·{" "}
                    {n.categorias.reduce((s, c) => s + c.cantidad, 0)}{" "}
                    trabajadores
                  </div>
                </button>
                <div className="flex gap-2 mt-2 pt-2 border-t">
                  <button
                    onClick={() => startEditNeed(n)}
                    className="text-xs font-bold text-blue-700 inline-flex gap-1 items-center"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <button
                    onClick={() => void removeNeed(n)}
                    className="text-xs font-bold text-rose-700 inline-flex gap-1 items-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
            {!needs.length && (
              <div className="text-sm text-slate-500 p-3">
                Cree primero una necesidad.
              </div>
            )}
          </div>
        </aside>
        <main className="space-y-5 min-w-0">
          {selectedNeed ? (
            <>
              <div className="ui-surface p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="font-black text-xl">{selectedNeed.obra}</h2>
                    <p className="text-sm text-slate-500">
                      {selectedNeed.codigoObra &&
                        `Obra ${selectedNeed.codigoObra} · `}
                      {selectedNeed.mes} {selectedNeed.ano || ""}
                    </p>
                  </div>
                  <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm cursor-pointer">
                    <FileText className="w-4 h-4" />
                    Añadir informe SAE
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      className="hidden"
                      disabled={busy}
                      onChange={(e) => {
                        void handleReportFile(e.target.files?.[0]);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  {[
                    ["Candidatos", stats.candidates],
                    ["Seleccionados", stats.selected],
                    ["Contratados", stats.contracted],
                    ["Sin resultado", stats.pending],
                  ].map(([l, v]) => (
                    <div
                      key={String(l)}
                      className="rounded-xl bg-slate-50 dark:bg-slate-900 border p-3"
                    >
                      <div className="text-2xl font-black">{v}</div>
                      <div className="text-xs text-slate-500">{l}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {categoryStats.map((c) => (
                    <span
                      key={c.id}
                      className="text-xs font-semibold rounded-full border px-3 py-1.5"
                    >
                      {c.categoria}: necesarios {c.cantidad} · candidatos{" "}
                      {c.pool} · asignados {c.assigned}
                    </span>
                  ))}
                </div>
              </div>
              {!!reports.length && (
                <div className="ui-surface p-5">
                  <h3 className="font-black mb-3">Informes SAE</h3>
                  <div className="space-y-2">
                    {reports.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border rounded-xl p-3"
                      >
                        <div>
                          <div className="font-bold text-sm">{r.fileName}</div>
                          <div className="text-xs text-slate-500">
                            Oferta {r.offerNumber || "—"} ·{" "}
                            {r.quincena || r.mes || "Periodo no detectado"} ·{" "}
                            {
                              candidates.filter((c) => c.reportId === r.id)
                                .length
                            }{" "}
                            candidatos
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => void openPreview(r)}
                            className="px-3 py-2 rounded-lg border font-bold text-xs"
                          >
                            Vista previa / ajustar
                          </button>
                          <button
                            onClick={() => void generateReturnPdf(r)}
                            className="px-3 py-2 rounded-lg border font-bold text-xs inline-flex gap-1 items-center"
                          >
                            <Download className="w-4 h-4" />
                            Descargar devolución
                          </button>
                          <button
                            onClick={() => void removeReport(r)}
                            className="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 font-bold text-xs inline-flex gap-1 items-center"
                          >
                            <Trash2 className="w-4 h-4" />
                            Eliminar informe
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="ui-surface p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-black text-lg">Candidatos SAE</h3>
                    <p className="text-xs text-slate-500">
                      Una contratación registrada puede revertirse y volver a
                      editarse.
                    </p>
                  </div>
                  <Users className="w-5 h-5" />
                </div>
                {!candidates.length ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
                    Suba un informe SAE.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {candidates.map((c) => (
                      <div key={c.id} className="rounded-2xl border p-4">
                        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                          <div className="flex-1">
                            <div className="font-black text-sm">
                              {c.orderNumber}.{" "}
                              {c.normalizedName ||
                                titleCaseSpanish(c.fullNameOriginal)}{" "}
                              {c.linkedWorkerId && (
                                <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                                  <Link2 className="inline w-3 h-3" /> registro
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {c.categoria || "Categoría pendiente"} · Oferta{" "}
                              {c.offerNumber || "—"}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {["", "1ª Quincena", "2ª Quincena"].map((q) => (
                              <button
                                key={q || "none"}
                                disabled={c.estado === "Contratado"}
                                onClick={() =>
                                  void patchCandidate(c, {
                                    quincena: q,
                                    estado: q || "Sin asignar",
                                  })
                                }
                                className={`px-3 py-2 rounded-lg text-xs font-bold border disabled:opacity-50 ${c.quincena === q ? "bg-[#00548E] text-white" : ""}`}
                              >
                                {q || "Sin asignar"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3 grid md:grid-cols-[1fr_auto] gap-3 items-end">
                          <div className="grid sm:grid-cols-2 gap-2">
                            <input
                              value={c.apellidos}
                              disabled={c.estado === "Contratado"}
                              onChange={(e) =>
                                setCandidates((p) =>
                                  p.map((x) =>
                                    x.id === c.id
                                      ? {
                                          ...x,
                                          apellidos: e.target.value,
                                          normalizedName:
                                            `${e.target.value} ${x.nombre}`.trim(),
                                        }
                                      : x,
                                  ),
                                )
                              }
                              onBlur={() =>
                                void updateSaeCandidate(c.id, {
                                  apellidos: c.apellidos,
                                  normalizedName: c.normalizedName,
                                })
                              }
                              className="ui-input text-sm"
                              placeholder="Apellidos"
                            />
                            <input
                              value={c.nombre}
                              disabled={c.estado === "Contratado"}
                              onChange={(e) =>
                                setCandidates((p) =>
                                  p.map((x) =>
                                    x.id === c.id
                                      ? {
                                          ...x,
                                          nombre: e.target.value,
                                          normalizedName:
                                            `${x.apellidos} ${e.target.value}`.trim(),
                                        }
                                      : x,
                                  ),
                                )
                              }
                              onBlur={() =>
                                void updateSaeCandidate(c.id, {
                                  nombre: c.nombre,
                                  normalizedName: c.normalizedName,
                                })
                              }
                              className="ui-input text-sm"
                              placeholder="Nombre"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {c.estado !== "Contratado" ? (
                              <button
                                onClick={() => void registerWorker(c)}
                                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex gap-1 items-center"
                              >
                                <UserCheck className="w-4 h-4" />
                                Registrar trabajador
                              </button>
                            ) : (
                              <>
                                <span className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold inline-flex gap-1 items-center">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Contratado · 2001
                                </span>
                                <button
                                  onClick={() => void revertWorker(c)}
                                  className="px-3 py-2 rounded-lg border border-amber-300 text-amber-700 text-xs font-bold inline-flex gap-1 items-center"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                  Revertir contratación
                                </button>
                              </>
                            )}
                            <select
                              value={c.resultCode}
                              disabled={c.estado === "Contratado"}
                              onChange={(e) =>
                                void patchCandidate(c, {
                                  resultCode: e.target.value,
                                })
                              }
                              className="ui-input text-xs min-w-[220px]"
                            >
                              <option value="">Resultado SAE pendiente</option>
                              {SAE_RESULT_CODES.map(([code, label]) => (
                                <option key={code} value={code}>
                                  {code} · {label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="ui-surface p-10 text-center">
              <CalendarRange className="w-10 h-10 mx-auto text-slate-400 mb-3" />
              <h2 className="font-black">Cree una necesidad para comenzar</h2>
            </div>
          )}
        </main>
      </div>
      <div className="ui-surface p-4 text-xs text-slate-500 flex gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        <span>
          2001 significa “Contratará al candidato”. Los no contratados requieren
          selección expresa del motivo. Las reversiones eliminan únicamente el
          registro creado desde SAE y restablecen el candidato.
        </span>
      </div>
      {previewReport && (
        <div
          className="fixed inset-0 z-[180] bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
        >
          <div className="w-full max-w-6xl h-[92vh] bg-white dark:bg-slate-950 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="font-black">
                  Vista previa SAE · {previewReport.fileName}
                </div>
                <div className="text-xs text-slate-500">
                  X/Y desplazan todos los códigos en milímetros.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold">
                  X{" "}
                  <input
                    type="number"
                    step="0.5"
                    value={previewOffsetX}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      setPreviewOffsetX(v);
                      void refreshPreview(previewReport, v, previewOffsetY);
                    }}
                    className="ui-input !w-20 !py-1.5"
                  />
                </label>
                <label className="text-xs font-bold">
                  Y{" "}
                  <input
                    type="number"
                    step="0.5"
                    value={previewOffsetY}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      setPreviewOffsetY(v);
                      void refreshPreview(previewReport, previewOffsetX, v);
                    }}
                    className="ui-input !w-20 !py-1.5"
                  />
                </label>
                <button
                  onClick={() => void applyPreviewOffset()}
                  className="px-3 py-2 rounded-lg bg-[#00548E] text-white text-xs font-bold"
                >
                  Guardar posición
                </button>
                <button
                  onClick={closePreview}
                  className="px-3 py-2 rounded-lg border text-xs font-bold"
                >
                  Cerrar
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900">
              {previewUrl ? (
                <iframe
                  title="Vista previa documento SAE"
                  src={previewUrl}
                  className="w-full h-full border-0"
                />
              ) : (
                <div className="h-full grid place-items-center">
                  Preparando…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
