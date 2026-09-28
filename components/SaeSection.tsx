import React, { useEffect, useMemo, useState } from "react";
import { appConfirm } from '../src/lib/appDialog';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit3,
  FileText,
  FileUp,
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
  SaeReportVersion,
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
  updateSaeReportStatus,
} from "../src/services/saeService";
import { loadAppBusinessSettings } from "../src/services/appSettingsService";
import { supabase } from "../src/lib/supabase";
import { useAuthShell } from "./AuthGate";
import {
  listAnnualHiringPeriods,
  type AnnualHiringPeriodsRecord,
} from "../src/services/annualHiringPeriodsService";

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
const saeReportPeriodLabel = (report: SaeReport) => {
  if (report.quincena) return report.quincena;
  const category = norm(report.categoria);
  if (category && !/\bpeon(?:es)?\b/.test(category)) return "Mensual";
  return "Periodo por confirmar";
};
const saeReportPeriodOrder = (label: string) =>
  label.startsWith("1") ? 1 : label.startsWith("2") ? 2 : label === "Mensual" ? 3 : 4;
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
  const { supervisorName } = useAuthShell();
  const [needs, setNeeds] = useState<SaeNeed[]>([]);
  const [selectedNeedId, setSelectedNeedId] = useState(() =>
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("profea-sae-selected-need") || ""
      : "",
  );
  const [reports, setReports] = useState<SaeReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState(() =>
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("profea-sae-selected-report") || ""
      : "",
  );
  const [candidates, setCandidates] = useState<SaeCandidate[]>([]);
  const [needForm, setNeedForm] = useState<NeedForm>(emptyNeed);
  const [pendingImportedNeeds, setPendingImportedNeeds] = useState<NeedForm[]>(
    [],
  );
  const [showNeedForm, setShowNeedForm] = useState(false);
  const [editingNeedId, setEditingNeedId] = useState<string | null>(null);
  const [openMonthKeys, setOpenMonthKeys] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [returnedReportIds, setReturnedReportIds] = useState<string[]>([]);
  const [previewReport, setPreviewReport] = useState<SaeReport | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewOffsetX, setPreviewOffsetX] = useState(0);
  const [previewOffsetY, setPreviewOffsetY] = useState(0);
  const [annualPeriods, setAnnualPeriods] = useState<AnnualHiringPeriodsRecord[]>([]);
  const selectedNeed = needs.find((n) => n.id === selectedNeedId) || null;
  const selectedReport = reports.find((report) => report.id === selectedReportId) || null;
  const activeCandidates = useMemo(
    () =>
      selectedReportId
        ? candidates.filter((candidate) => candidate.reportId === selectedReportId)
        : [],
    [candidates, selectedReportId],
  );
  const selectedReportLocked = selectedReport?.status === "finalized";
  const currentYear = new Date().getFullYear();
  const currentAnnualPeriods = annualPeriods.find((record) => record.year === currentYear) || null;
  const annualPeriodsDone = Boolean(
    currentAnnualPeriods?.months.some(
      (month) =>
        (month.period1Start && month.period1End) ||
        (month.period2Start && month.period2End),
    ),
  );

  const groupedNeeds = useMemo(() => {
    const groups = new Map<string, { key: string; mes: string; ano: number | null; monthOrder: number; needs: SaeNeed[] }>();

    for (const need of needs) {
      const monthOrder = monthNumber(need.mes) || 0;
      const year = need.ano || null;
      const key = `${year || 0}-${monthOrder}-${norm(need.mes)}`;
      const current = groups.get(key);
      if (current) {
        current.needs.push(need);
      } else {
        groups.set(key, {
          key,
          mes: need.mes,
          ano: year,
          monthOrder,
          needs: [need],
        });
      }
    }

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        needs: [...group.needs].sort((a, b) =>
          a.obra.localeCompare(b.obra, "es", { sensitivity: "base" }),
        ),
      }))
      .sort((a, b) =>
        (b.ano || 0) - (a.ano || 0) ||
        b.monthOrder - a.monthOrder ||
        a.mes.localeCompare(b.mes, "es", { sensitivity: "base" }),
      );
  }, [needs]);

  const groupedReports = useMemo(() => {
    const groups = new Map<string, { label: string; order: number; reports: SaeReport[] }>();
    for (const report of reports) {
      const label = saeReportPeriodLabel(report);
      const current = groups.get(label);
      if (current) current.reports.push(report);
      else
        groups.set(label, {
          label,
          order: saeReportPeriodOrder(label),
          reports: [report],
        });
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        reports: [...group.reports].sort((a, b) =>
          String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
        ),
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "es"));
  }, [reports]);

  const monthKeyForNeed = (need: SaeNeed) =>
    `${need.ano || 0}-${monthNumber(need.mes) || 0}-${norm(need.mes)}`;

  const toggleMonth = (key: string) => {
    setOpenMonthKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
    setSelectedReportId((current) =>
      current && r.some((report) => report.id === current)
        ? current
        : r[0]?.id || "",
    );
  };
  useEffect(() => {
    void refresh().catch((e) =>
      onToast(e.message || "No se pudo cargar SAE.", "error"),
    );
  }, []);
  useEffect(() => {
    let shouldFocus = false;
    try {
      shouldFocus = window.sessionStorage.getItem("profea-sae-focus-candidates") === "1";
    } catch {}
    if (!shouldFocus) return;

    const focusCandidates = () => {
      const target = document.getElementById("sae-candidate-selection");
      if (!target) return false;
      try {
        window.sessionStorage.removeItem("profea-sae-focus-candidates");
      } catch {}
      window.setTimeout(() => {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("ring-2", "ring-[#00548E]/30");
        window.setTimeout(() => target.classList.remove("ring-2", "ring-[#00548E]/30"), 1800);
      }, 120);
      onToast("Citación completada. Seleccione el siguiente candidato SAE.", "success");
      return true;
    };

    if (focusCandidates()) return;
    const timer = window.setInterval(() => {
      if (focusCandidates()) window.clearInterval(timer);
    }, 150);
    const timeout = window.setTimeout(() => window.clearInterval(timer), 5000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [selectedNeedId, selectedReportId, activeCandidates.length]);
  useEffect(() => {
    let cancelled = false;
    const loadAnnualPeriods = async () => {
      try {
        const records = await listAnnualHiringPeriods();
        if (!cancelled) setAnnualPeriods(records);
      } catch (error) {
        console.warn("No se pudo comprobar la anualidad SAE:", error);
      }
    };
    const handleAnnualPeriodsUpdated = () => void loadAnnualPeriods();
    void loadAnnualPeriods();
    window.addEventListener("profea:annual-hiring-periods-updated", handleAnnualPeriodsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("profea:annual-hiring-periods-updated", handleAnnualPeriodsUpdated);
    };
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
        setSelectedReportId((current) =>
          current && r.some((report) => report.id === current)
            ? current
            : r[0]?.id || "",
        );
      })
      .catch((e) =>
        onToast(e.message || "No se pudo cargar la solicitud de mano de obra.", "error"),
      );
  }, [selectedNeedId]);
  useEffect(() => {
    setReturnedReportIds([]);
    const selected = needs.find(need => need.id === selectedNeedId);
    if (!selected) return;
    const key = monthKeyForNeed(selected);
    setOpenMonthKeys(current => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, [selectedNeedId, needs]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const stats = useMemo(
    () => ({
      candidates: activeCandidates.length,
      selected: activeCandidates.filter((c) =>
        [
          "Preseleccionado",
          "1ª Quincena",
          "2ª Quincena",
          "Mensual",
          "Contratado",
        ].includes(c.estado),
      ).length,
      contracted: activeCandidates.filter((c) => c.estado === "Contratado").length,
      pending: activeCandidates.filter((c) => !c.resultCode).length,
    }),
    [activeCandidates],
  );
  const categoryStats = useMemo(
    () =>
      (selectedNeed?.categorias || []).map((req) => {
        const pool = activeCandidates.filter(
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
    [selectedNeed, activeCandidates],
  );
  const stepLabels = [
    "Solicitud de mano de obra",
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
      reports.every(
        (r) => r.status === "finalized" || returnedReportIds.includes(r.id),
      );
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
    setProgress("Analizando solicitud de mano de obra…");
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
          ? `${forms.length} solicitudes de mano de obra detectadas. Revise cada una.`
          : "Solicitud de mano de obra analizada. Revise los datos antes de confirmar.",
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
        onToast("Solicitud de mano de obra actualizada.", "success");
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
          `Solicitud guardada. Quedan ${rest.length + 1} por revisar.`,
          "success",
        );
      } else {
        setShowNeedForm(false);
        setNeedForm(emptyNeed);
        onToast("Solicitud de mano de obra creada correctamente.", "success");
      }
    } catch (e: any) {
      onToast(e.message || "No se pudo guardar la solicitud de mano de obra.", "error");
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
      !(await appConfirm(
        `¿Eliminar la solicitud de mano de obra de ${n.obra} (${n.mes} ${n.ano || ""}) y sus informes/candidatos asociados?`,
      ))
    )
      return;
    setBusy(true);
    try {
      await deleteSaeNeed(n.id);
      await refresh("");
      setShowNeedForm(false);
      setEditingNeedId(null);
      onToast("Solicitud de mano de obra eliminada.", "success");
    } catch (e: any) {
      onToast(e.message || "No se pudo eliminar la solicitud de mano de obra.", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeReport = async (report: SaeReport) => {
    if (
      !(await appConfirm(
        `¿Eliminar exclusivamente el informe “${report.fileName}” y sus candidatos importados? La solicitud de mano de obra y los trabajadores ya registrados se conservarán sin cambios.`,
      ))
    )
      return;
    setBusy(true);
    try {
      await deleteSaeReport(report);
      await refresh(selectedNeedId);
      onToast(
        "Informe SAE eliminado. La solicitud y los trabajadores registrados se conservan.",
        "success",
      );
    } catch (error: any) {
      onToast(error.message || "No se pudo eliminar el informe SAE.", "error");
    } finally {
      setBusy(false);
    }
  };

  const processReportFile = async (
    file: File,
    targetNeed: SaeNeed,
    progressPrefix = "",
  ) => {
    const parsed = await parseSaeReportFile(file, (message) =>
      setProgress(`${progressPrefix}${message}`),
    );
    if (!parsed.candidates.length)
      throw new Error("No se han reconocido candidatos.");
    const workKey = (v: string) => {
      const s = norm(v).replace(/[.\s_\-/:]+/g, "");
      const code = s.match(/(\d{5})/)?.[1] || "";
      const type = s.includes("gr") ? "gr" : s.includes("ee") ? "ee" : "";
      return code && type ? `${code}${type}` : s;
    };
    if (
      workKey(targetNeed.codigoObra) &&
      workKey(parsed.codigoObra) &&
      workKey(targetNeed.codigoObra) !== workKey(parsed.codigoObra)
    )
      throw new Error(
        `El informe corresponde a la obra ${parsed.codigoObra}, pero está seleccionada ${targetNeed.codigoObra}.`,
      );
    if (
      targetNeed.mes &&
      parsed.mes &&
      norm(targetNeed.mes) !== norm(parsed.mes)
    )
      throw new Error(
        `El informe corresponde a ${parsed.mes}, pero la solicitud de mano de obra es de ${targetNeed.mes}.`,
      );

    const fileBase64 = await fileToDataUrl(file);
    const createdReportId = await createSaeReport(
      targetNeed.id,
      {
        fileName: file.name,
        fileBase64,
        extractedText: parsed.sourceText,
        extractionSource: parsed.source,
        offerNumber: parsed.offerNumber,
        obra: parsed.obra || targetNeed.obra,
        codigoObra: parsed.codigoObra || targetNeed.codigoObra,
        mes: parsed.mes || targetNeed.mes,
        quincena: parsed.quincena,
        categoria: parsed.categoria,
      },
      parsed.candidates.map((candidate) => {
        const isQualified =
          Boolean(parsed.categoria) &&
          !/\bpeon(?:es)?\b/i.test(normalizeSaeTextForPeriod(parsed.categoria));
        return {
          orderNumber: candidate.orderNumber,
          fullNameOriginal: candidate.fullNameOriginal,
          normalizedName: candidate.normalizedName,
          apellidos: candidate.apellidos,
          nombre: candidate.nombre,
          categoria: parsed.categoria,
          obra: parsed.obra || targetNeed.obra,
          codigoObra: parsed.codigoObra || targetNeed.codigoObra,
          offerNumber: parsed.offerNumber,
          mes: parsed.mes || targetNeed.mes,
          quincena: isQualified ? "Mensual" : "",
          estado: isQualified ? "Mensual" : "Sin asignar",
          resultCode: "",
          linkedWorkerId: null,
          pageNumber: candidate.pageNumber,
          overlayX: candidate.overlayX,
          overlayY: candidate.overlayY,
          confidence: candidate.confidence,
        };
      }),
    );

    const period =
      parsed.quincena ||
      (parsed.categoria && !/\bpeon(?:es)?\b/i.test(normalizeSaeTextForPeriod(parsed.categoria))
        ? "Mensual"
        : "Periodo por confirmar");

    return {
      id: createdReportId,
      fileName: file.name,
      candidateCount: parsed.candidates.length,
      period,
    };
  };

  const normalizeSaeTextForPeriod = (value: string) =>
    norm(value).replace(/[^a-z0-9ñáéíóúü ]/gi, " ");

  const handleReportFiles = async (files?: FileList | File[]) => {
    const selectedFiles = Array.from(files || []);
    const targetNeed = selectedNeed;
    if (!selectedFiles.length || !targetNeed) return;

    setBusy(true);
    const imported: {
      id: string;
      fileName: string;
      candidateCount: number;
      period: string;
    }[] = [];
    const failed: { fileName: string; message: string }[] = [];

    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const prefix =
          selectedFiles.length > 1
            ? `Informe ${index + 1}/${selectedFiles.length} · ${file.name} · `
            : "";
        setProgress(`${prefix}Leyendo informe SAE…`);
        try {
          imported.push(await processReportFile(file, targetNeed, prefix));
        } catch (error: any) {
          failed.push({
            fileName: file.name,
            message: error?.message || "No se pudo analizar el informe.",
          });
        }
      }

      if (imported.length) {
        await refresh(targetNeed.id);
        setSelectedReportId(imported[imported.length - 1].id);
        const candidatesTotal = imported.reduce(
          (total, item) => total + item.candidateCount,
          0,
        );
        onToast(
          imported.length === 1
            ? `${candidatesTotal} candidatos SAE reconocidos. El informe se ha clasificado y archivado por periodo.`
            : `${imported.length} informes SAE importados y clasificados por periodo · ${candidatesTotal} candidatos reconocidos.`,
          "success",
        );
      }

      if (failed.length) {
        const detail = failed
          .slice(0, 3)
          .map((item) => `${item.fileName}: ${item.message}`)
          .join(" · ");
        onToast(
          `${failed.length} informe(s) no se pudieron importar. ${detail}`,
          "error",
        );
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const resolveAnnualPeriodDates = (candidate: SaeCandidate, resolvedPeriod: string) => {
    const reportForCandidate = reports.find((report) => report.id === candidate.reportId) || null;
    const year = Number(selectedNeed?.ano || 0) || new Date().getFullYear();
    const monthLabel = reportForCandidate?.mes || candidate.mes || selectedNeed?.mes || "";
    const month = monthNumber(monthLabel);
    const annuality = annualPeriods.find((record) => record.year === year);
    const monthPeriods = annuality?.months.find((item) => item.month === month);

    if (!monthPeriods) return { periodoInicio: "", periodoFin: "" };

    if (resolvedPeriod.startsWith("2")) {
      return {
        periodoInicio: monthPeriods.period2Start || "",
        periodoFin: monthPeriods.period2End || "",
      };
    }

    if (resolvedPeriod === "Mensual") {
      return {
        periodoInicio: monthPeriods.period1Start || monthPeriods.period2Start || "",
        periodoFin: monthPeriods.period2End || monthPeriods.period1End || "",
      };
    }

    return {
      periodoInicio: monthPeriods.period1Start || "",
      periodoFin: monthPeriods.period1End || "",
    };
  };

  const registerWorker = async (candidate: SaeCandidate) => {
    const selectedResultCode = String(candidate.resultCode || "").trim() || "2001";
    const reportForCandidate = reports.find((report) => report.id === candidate.reportId) || null;
    const resolvedPeriod =
      candidate.quincena ||
      (reportForCandidate && saeReportPeriodLabel(reportForCandidate) === "Mensual"
        ? "Mensual"
        : "");
    if (!resolvedPeriod)
      return onToast("Confirme primero el periodo del informe.", "error");
    const { periodoInicio, periodoFin } = resolveAnnualPeriodDates(candidate, resolvedPeriod);
    const reportForWorker = reports.find((report) => report.id === candidate.reportId) || null;
    const hiringMonth = reportForWorker?.mes || candidate.mes || selectedNeed?.mes || "";
    const hiringYear = Number(selectedNeed?.ano || 0) || new Date().getFullYear();
    const workerFortnight = resolvedPeriod === "Mensual"
      ? `Mes ${hiringMonth} ${hiringYear}`.trim()
      : `${resolvedPeriod.replace(" Quincena", "")} ${hiringMonth} ${hiringYear}`.trim();
    const previousCandidates = people.filter(
      (p) => norm(p.apellidosNombre) === norm(candidate.normalizedName),
    );
    const hasMedicalData = (p: any) =>
      Boolean(
        String(p?.aptitudMedica || "").trim() ||
        String(p?.reconocimientoEstado || "").trim() ||
        String(p?.reconocimientoFecha || "").trim() ||
        String(p?.reconocimientoValidez || "").trim(),
      );
    const previous =
      previousCandidates
        .filter(hasMedicalData)
        .sort((a, b) =>
          String(b.reconocimientoFecha || b.fechaRegistro || "").localeCompare(
            String(a.reconocimientoFecha || a.fechaRegistro || ""),
          ),
        )[0] ||
      previousCandidates
        .sort((a, b) =>
          String(b.fechaRegistro || "").localeCompare(String(a.fechaRegistro || "")),
        )[0];

    let previousMedicalLimitations =
      previous?.reconocimientoLimitaciones ||
      previous?.limitacionesAptitud ||
      "";
    let previousMedicalObservations = previous?.reconocimientoObservaciones || "";
    let previousMedicalDate = previous?.reconocimientoFecha || "";
    let previousMedicalValidity = previous?.reconocimientoValidez || "";
    const previousMedicalState =
      previous?.aptitudMedica || previous?.reconocimientoEstado || "";
    const needsHistoricalLimitations =
      norm(previousMedicalState).includes("limitaci") &&
      !String(previousMedicalLimitations || "").trim();

    if (previous && needsHistoricalLimitations) {
      try {
        const workerRows = await supabase.query("reconocimientos", {
          query: `select=*&trabajador_id=eq.${encodeURIComponent(String(previous.id))}&order=fecha_reconocimiento.desc&limit=1`,
        });
        let recognition = workerRows?.[0];
        if (!recognition && previous.dni) {
          const dni = String(previous.dni).replace(/[\\s-]/g, "").toUpperCase();
          const dniRows = await supabase.query("reconocimientos", {
            query: `select=*&dni=eq.${encodeURIComponent(dni)}&order=fecha_reconocimiento.desc&limit=1`,
          });
          recognition = dniRows?.[0];
        }
        if (recognition) {
          previousMedicalLimitations =
            recognition.limitaciones ||
            recognition.data?.limitaciones ||
            previousMedicalLimitations;
          previousMedicalObservations =
            recognition.observaciones ||
            recognition.data?.observaciones ||
            previousMedicalObservations;
          previousMedicalDate =
            recognition.fecha_reconocimiento ||
            recognition.data?.fechaReconocimiento ||
            previousMedicalDate;
          previousMedicalValidity =
            recognition.validez ||
            recognition.data?.validez ||
            previousMedicalValidity;
        }
      } catch (error) {
        console.warn("No se pudieron recuperar las limitaciones médicas históricas:", error);
      }
    }

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
        supervisorResponsable: supervisorName,
        numOferta: candidate.offerNumber,
        obra: canonicalWork,
        categoria: canonicalCategory,
        quincena: workerFortnight,
        apellidosNombre: candidate.normalizedName,
        dni: previous?.dni || "",
        fechaNacimiento: previous?.fechaNacimiento || "",
        periodoInicio,
        periodoFin,
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
        aptitudMedica: previous?.aptitudMedica || previous?.reconocimientoEstado || "Pendiente",
        limitacionesAptitud: previousMedicalLimitations,
        reconocimientoEstado: previous?.reconocimientoEstado || previous?.aptitudMedica || "Pendiente",
        reconocimientoFecha: previousMedicalDate,
        reconocimientoValidez: previousMedicalValidity,
        reconocimientoLimitaciones: previousMedicalLimitations,
        reconocimientoObservaciones: previousMedicalObservations,
        sincronizadoEnNube: true,
      };
      await createDocument("trabajadores", workerId, worker as any);
      await patchCandidate(candidate, {
        estado: "Contratado",
        resultCode: selectedResultCode,
        linkedWorkerId: workerId,
      });
      window.sessionStorage.setItem("profea-sae-selected-need", candidate.needId || selectedNeedId);
      window.sessionStorage.setItem("profea-sae-selected-report", candidate.reportId || selectedReportId);
      window.sessionStorage.setItem("profea-sae-return-worker-id", String(workerId));
      window.dispatchEvent(
        new CustomEvent("profea:sae-worker-registered", {
          detail: { workerId, worker },
        }),
      );
      onToast(
        `Trabajador registrado en ${canonicalWork}${canonicalCategory ? ` como ${canonicalCategory}` : ""} y contratación SAE confirmada con código ${selectedResultCode}. Complete ahora su ficha en Directorio.`,
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
      !(await appConfirm(
        `¿Revertir la contratación de ${candidate.normalizedName}? Se eliminará únicamente el registro de trabajador creado por esta contratación SAE y el candidato volverá a su quincena.`,
      ))
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
    archivedVersion?: SaeReportVersion,
  ): Promise<Uint8Array> => {
    const rows = archivedVersion?.candidates?.length
      ? archivedVersion.candidates
      : candidates.filter((c) => c.reportId === report.id);
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
      const reportRows = candidates.filter((candidate) => candidate.reportId === report.id);
      const snapshot = reportRows.map((candidate) => ({
        id: candidate.id,
        orderNumber: candidate.orderNumber,
        resultCode: candidate.resultCode,
        pageNumber: candidate.pageNumber,
        overlayX: candidate.overlayX,
        overlayY: candidate.overlayY,
      }));
      const finalizedAt = new Date().toISOString();
      const versionNumber =
        (await updateSaeReportStatus(report.id, "finalized", snapshot)) ||
        (report.versions?.length || 0) + 1;
      setReports((previous) =>
        previous.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status: "finalized",
                versions: [
                  ...(item.versions || []),
                  {
                    version: versionNumber,
                    finalizedAt,
                    candidates: snapshot,
                  },
                ],
              }
            : item,
        ),
      );
      setReturnedReportIds((prev) =>
        prev.includes(report.id) ? prev : [...prev, report.id],
      );
      onToast(
        `Documento SAE generado y archivado como versión ${versionNumber}.`,
        "success",
      );
    } catch (e: any) {
      onToast(e.message || "No se pudo generar el documento.", "error");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const downloadArchivedVersion = async (
    report: SaeReport,
    version: SaeReportVersion,
  ) => {
    setBusy(true);
    setProgress(`Recuperando versión ${version.version} del informe SAE…`);
    try {
      const bytes = await buildReturnPdfBytes(report, 0, 0, true, version);
      const url = URL.createObjectURL(bytesToBlob(bytes));
      const a = document.createElement("a");
      a.href = url;
      a.download = `SAE_FINAL_${report.offerNumber || report.id}_V${version.version}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast(
        `Versión ${version.version} del informe SAE recuperada correctamente.`,
        "success",
      );
    } catch (error: any) {
      onToast(
        error.message || "No se pudo recuperar la versión archivada.",
        "error",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const reopenReport = async (report: SaeReport) => {
    try {
      await updateSaeReportStatus(report.id, "review");
      setReports((previous) =>
        previous.map((item) =>
          item.id === report.id ? { ...item, status: "review" } : item,
        ),
      );
      setReturnedReportIds((previous) => previous.filter((id) => id !== report.id));
      setSelectedReportId(report.id);
      onToast("Informe reabierto para revisión y modificación.", "success");
    } catch (error: any) {
      onToast(error.message || "No se pudo reabrir el informe SAE.", "error");
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
              Periodos anuales → solicitud de mano de obra → informes → candidatos → quincenas → registros →
              contratación → devolución SAE.
            </p>
          </div>

        </div>
        <div
          className={`mt-5 rounded-2xl border p-4 sm:p-5 ${
            annualPeriodsDone
              ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
              : "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20"
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`w-9 h-9 shrink-0 rounded-xl grid place-items-center font-black text-sm ${
                annualPeriodsDone
                  ? "bg-emerald-600 text-white"
                  : "bg-[#00548E] text-white"
              }`}>
                {annualPeriodsDone ? <CheckCircle2 className="w-5 h-5" /> : "0"}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-black text-base sm:text-lg">Paso 0 · Periodos anuales</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                    annualPeriodsDone
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                  }`}>
                    {annualPeriodsDone ? `${currentYear} configurado` : `Pendiente · ${currentYear}`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Se configura una sola vez al año y queda guardado para todas las gestiones SAE de la anualidad.
                </p>
                {annualPeriodsDone && (
                  <p className="mt-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {currentAnnualPeriods?.months.length || 0} mes(es) con periodos guardados. Puedes modificarlos cuando sea necesario.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("profea:open-annual-hiring-periods", {
                      detail: { mode: "import" },
                    }),
                  )
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-2.5 text-sm font-black hover:bg-[#004270]"
              >
                <FileUp className="w-4 h-4" />
                Importar periodos
              </button>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("profea:open-annual-hiring-periods", {
                      detail: { mode: "manual" },
                    }),
                  )
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-black"
              >
                <CalendarRange className="w-4 h-4" />
                Añadir periodos
              </button>
            </div>
          </div>
        </div>

        <div
          className="mt-5 grid sm:grid-cols-2 xl:grid-cols-4 gap-3"
          aria-label="Progreso SAE"
        >
          {stepLabels.map((label, index) => {
            const step = index + 1;
            const done = completedSteps[index];
            const current = !done && activeStep === step;
            const tone = done
              ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
              : current
                ? "border-blue-300 bg-blue-50/80 dark:border-blue-800 dark:bg-blue-950/25"
                : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900";
            return (
              <div
                key={label}
                aria-current={current ? "step" : undefined}
                className={`rounded-2xl border p-3.5 transition-colors ${tone}`}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={`w-7 h-7 shrink-0 rounded-lg grid place-items-center text-xs font-black ${
                      done
                        ? "bg-emerald-600 text-white"
                        : current
                          ? "bg-[#00548E] text-white"
                          : "bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-500"
                    }`}
                  >
                    {done ? <CheckCircle2 className="w-4 h-4" /> : step}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider font-black text-slate-400">
                      Paso {step}
                    </div>
                    <div className="font-black text-sm leading-tight">{label}</div>
                  </div>
                </div>

                {step === 1 && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="min-h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-3 py-2 text-xs font-black cursor-pointer hover:bg-[#004270]">
                      <FileText className="w-4 h-4" />
                      Importar solicitud
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,image/*"
                        disabled={busy}
                        onChange={(event) => {
                          void handleNeedFile(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={startNewNeed}
                      disabled={busy}
                      className="min-h-10 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-black disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                      Nueva solicitud
                    </button>
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-3">
                    <label
                      className={`min-h-10 w-full inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black ${
                        selectedNeed && !busy
                          ? "bg-[#00548E] text-white cursor-pointer hover:bg-[#004270]"
                          : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                      }`}
                      title={selectedNeed ? "Importar informe SAE para la solicitud seleccionada" : "Selecciona primero una solicitud"}
                    >
                      <FileText className="w-4 h-4" />
                      Añadir informes SAE
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        className="hidden"
                        multiple
                        disabled={!selectedNeed || busy}
                        onChange={(event) => {
                          void handleReportFiles(event.target.files || undefined);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {selectedNeed ? (
                      <div className="mt-1.5 text-[10px] text-slate-500">
                        Puede seleccionar varios informes a la vez. Se analizarán por separado y se archivarán en esta obra según su periodo.
                      </div>
                    ) : (
                      <div className="mt-1.5 text-[10px] text-slate-500">
                        Selecciona primero una solicitud del Paso 1.
                      </div>
                    )}
                  </div>
                )}
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
                ? "Editar solicitud de mano de obra"
                : "Revisión de solicitud de mano de obra"}
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
                {editingNeedId ? "Guardar cambios" : "Confirmar solicitud"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid lg:grid-cols-[340px_1fr] gap-6 min-w-0">
        <aside className="ui-surface p-4 h-fit">
          <div className="mb-3">
            <h2 className="font-black">Solicitudes de mano de obra</h2>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Organizadas por mes. Pulse un mes para ver sus obras.
            </p>
          </div>
          <div className="space-y-2">
            {groupedNeeds.map(group => {
              const isOpen = openMonthKeys.has(group.key);
              const workerTotal = group.needs.reduce(
                (total, need) => total + need.categorias.reduce((sum, category) => sum + category.cantidad, 0),
                0,
              );
              const selectedInside = group.needs.some(need => need.id === selectedNeedId);
              return (
                <div
                  key={group.key}
                  className={`overflow-hidden rounded-xl border ${selectedInside ? "border-[#00548E]/60 dark:border-blue-700" : "border-slate-200 dark:border-slate-800"}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleMonth(group.key)}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors ${selectedInside ? "bg-blue-50 dark:bg-blue-950/25" : "bg-slate-50/80 hover:bg-slate-100 dark:bg-slate-900/70 dark:hover:bg-slate-800/80"}`}
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0">
                      <div className="font-black text-sm capitalize">
                        {group.mes} {group.ano || ""}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {group.needs.length} {group.needs.length === 1 ? "obra" : "obras"} · {workerTotal} trabajadores
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isOpen && (
                    <div className="space-y-2 border-t border-slate-200 p-2 dark:border-slate-800">
                      {group.needs.map(n => (
                        <div
                          key={n.id}
                          className={`rounded-lg border p-3 ${selectedNeedId === n.id ? "border-[#00548E] bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}
                        >
                          <button
                            onClick={() => setSelectedNeedId(n.id)}
                            className="w-full text-left"
                          >
                            <div className="font-bold text-sm leading-snug">{n.obra}</div>
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                              {n.codigoObra ? `Obra ${n.codigoObra} · ` : ""}
                              {n.categorias.reduce((sum, category) => sum + category.cantidad, 0)} trabajadores
                            </div>
                          </button>
                          <div className="flex gap-3 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                            <button
                              onClick={() => startEditNeed(n)}
                              className="text-xs font-bold text-blue-700 dark:text-blue-400 inline-flex gap-1 items-center"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Editar
                            </button>
                            <button
                              onClick={() => void removeNeed(n)}
                              className="text-xs font-bold text-rose-700 dark:text-rose-400 inline-flex gap-1 items-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Eliminar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!needs.length && (
              <div className="text-sm text-slate-500 p-3">
                Cree primero una solicitud de mano de obra.
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
                  <div className="mb-4">
                    <h3 className="font-black">Informes SAE por periodo</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Cada informe mantiene sus candidatos aislados. Seleccione un informe para trabajar únicamente con sus trabajadores.
                    </p>
                  </div>
                  <div className="space-y-4">
                    {groupedReports.map((group) => (
                      <div key={group.label} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                          <div className="font-black text-sm">{group.label}</div>
                          <div className="text-[11px] text-slate-500">
                            {group.reports.length} {group.reports.length === 1 ? "informe" : "informes"}
                          </div>
                        </div>
                        <div className="p-2 space-y-2">
                          {group.reports.map((r) => {
                            const reportCandidates = candidates.filter((candidate) => candidate.reportId === r.id);
                            const isSelected = selectedReportId === r.id;
                            const isFinalized = r.status === "finalized";
                            return (
                              <div
                                key={r.id}
                                className={`rounded-xl border p-3 ${isSelected ? "border-[#00548E] bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/20" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => setSelectedReportId(r.id)}
                                  aria-pressed={isSelected}
                                  className={`sae-report-selector w-full text-left rounded-xl border-2 px-3.5 py-3 transition-all shadow-sm ${isSelected
                                    ? "border-[#00548E] bg-[#00548E] text-white shadow-md ring-2 ring-[#00548E]/20 dark:border-sky-300 dark:bg-sky-700 dark:text-white dark:ring-sky-400/25"
                                    : "border-slate-300 bg-white text-slate-900 hover:border-[#00548E] hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-400 dark:hover:bg-slate-700"}`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                                      <div className="sae-report-filename font-black text-sm break-all">{r.fileName}</div>
                                      <span className={`sae-report-status text-[10px] font-black px-2 py-0.5 rounded-full ${isSelected
                                        ? "bg-white/95 text-slate-900 border border-white"
                                        : isFinalized
                                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
                                          : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"}`}>
                                        {isFinalized ? "Finalizado" : "En revisión"}
                                      </span>
                                    </div>
                                    <span className={`sae-report-action shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${isSelected
                                      ? "bg-white text-[#003f6b]"
                                      : "bg-[#00548E] text-white dark:bg-sky-500 dark:text-slate-950"}`}>
                                      {isSelected ? "Seleccionado" : "Seleccionar informe"}
                                    </span>
                                  </div>
                                  <div className={`sae-report-meta mt-2 text-xs font-semibold ${isSelected ? "text-blue-50 dark:text-white" : "text-slate-700 dark:text-slate-200"}`}>
                                    Oferta {r.offerNumber || "—"} · {reportCandidates.length} candidatos · {r.categoria || "Categoría no detectada"}
                                    {r.versions?.length ? ` · ${r.versions.length} versión(es) finalizada(s)` : ""}
                                  </div>
                                </button>
                                <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                                  <button
                                    onClick={() => {
                                      setSelectedReportId(r.id);
                                      void openPreview(r);
                                    }}
                                    className="px-3 py-2 rounded-lg border font-bold text-xs"
                                  >
                                    Consultar / ajustar
                                  </button>
                                  {isFinalized ? (
                                    <button
                                      onClick={() => void reopenReport(r)}
                                      className="px-3 py-2 rounded-lg border border-amber-300 text-amber-700 font-bold text-xs inline-flex gap-1 items-center"
                                    >
                                      <RotateCcw className="w-4 h-4" />
                                      Reabrir para modificar
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => void generateReturnPdf(r)}
                                      className="px-3 py-2 rounded-lg border font-bold text-xs inline-flex gap-1 items-center"
                                    >
                                      <Download className="w-4 h-4" />
                                      Finalizar y descargar
                                    </button>
                                  )}
                                  <button
                                    onClick={() => void removeReport(r)}
                                    className="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 font-bold text-xs inline-flex gap-1 items-center"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    Eliminar informe
                                  </button>
                                  {(r.versions || []).map((version) => (
                                    <button
                                      key={`${r.id}-version-${version.version}`}
                                      type="button"
                                      onClick={() => void downloadArchivedVersion(r, version)}
                                      className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs inline-flex gap-1 items-center"
                                      title={
                                        version.finalizedAt
                                          ? `Finalizada el ${new Date(version.finalizedAt).toLocaleString("es-ES")}`
                                          : `Versión ${version.version}`
                                      }
                                    >
                                      <Download className="w-4 h-4" />
                                      Versión {version.version}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div id="sae-candidate-selection" className="ui-surface p-4 sm:p-5 scroll-mt-24 transition-shadow duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-black text-lg">
                      {selectedReport ? `Trabajadores del informe · ${selectedReport.fileName}` : "Trabajadores del informe"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {selectedReport
                        ? `${saeReportPeriodLabel(selectedReport)} · ${activeCandidates.length} candidato(s). Esta lista pertenece exclusivamente a este informe.`
                        : "Seleccione un informe SAE para consultar sus trabajadores sin mezclarlos con otros informes."}
                    </p>
                  </div>
                  <Users className="w-5 h-5" />
                </div>
                {!selectedReport ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
                    Seleccione un informe SAE.
                  </div>
                ) : !activeCandidates.length ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
                    Este informe no contiene candidatos.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedReportLocked && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300">
                        Informe finalizado y archivado. Use “Reabrir para modificar” si necesita realizar cambios.
                      </div>
                    )}
                    {activeCandidates.map((c) => (
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
                              {c.quincena ? ` · Quincena: ${c.quincena}` : ""}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(() => {
                              const isQualified =
                                Boolean(c.categoria) &&
                                !/\bpeon(?:es)?\b/i.test(normalizeSaeTextForPeriod(c.categoria));
                              const options = isQualified
                                ? ["Mensual"]
                                : ["1ª Quincena", "2ª Quincena"];
                              const effectivePeriod =
                                c.quincena || (isQualified ? "Mensual" : "");

                              return options.map((q) => {
                                const active = effectivePeriod === q;
                                return (
                                  <button
                                    key={q}
                                    disabled={c.estado === "Contratado" || selectedReportLocked}
                                    onClick={() =>
                                      void patchCandidate(c, {
                                        quincena: q,
                                        estado: q,
                                      })
                                    }
                                    className={`px-4 py-2.5 rounded-xl text-xs font-black border-2 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                      active
                                        ? "bg-[#00548E] border-[#00548E] text-white shadow-[#00548E]/20"
                                        : "bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-700 text-[#00548E] dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                    }`}
                                  >
                                    {q}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                        <div className="mt-3 grid md:grid-cols-[1fr_auto] gap-3 items-end">
                          <div className="grid sm:grid-cols-2 gap-2">
                            <input
                              value={c.apellidos}
                              disabled={c.estado === "Contratado" || selectedReportLocked}
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
                              disabled={c.estado === "Contratado" || selectedReportLocked}
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
                          <div className="flex flex-wrap items-end gap-2">
                            {c.estado !== "Contratado" ? (
                              <button
                                onClick={() => void registerWorker(c)}
                                disabled={selectedReportLocked}
                                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black inline-flex gap-2 items-center shadow-md shadow-emerald-600/20 ring-1 ring-emerald-700/20 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <UserCheck className="w-4 h-4" />
                                Registrar trabajador
                              </button>
                            ) : (
                              <>
                                <span className="px-3 py-2.5 rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-xs font-black inline-flex gap-1.5 items-center border border-emerald-300 dark:border-emerald-800">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Contratado · {c.resultCode || "2001"}
                                </span>
                                <button
                                  onClick={() => void revertWorker(c)}
                                  disabled={selectedReportLocked}
                                  className="px-3 py-2.5 rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs font-bold inline-flex gap-1.5 items-center hover:bg-amber-100 dark:hover:bg-amber-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                  Revertir contratación
                                </button>
                              </>
                            )}

                            <label
                              className={`min-w-[240px] rounded-xl border-2 px-3 py-2 shadow-sm transition-all ${
                                c.resultCode === "2001"
                                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/25"
                                  : c.resultCode
                                    ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
                                    : "border-[#00548E] bg-blue-50/80 dark:border-blue-600 dark:bg-blue-950/25"
                              }`}
                            >
                              <span
                                className={`mb-1 block text-[10px] font-black uppercase tracking-wider ${
                                  c.resultCode === "2001"
                                    ? "text-emerald-700 dark:text-emerald-300"
                                    : c.resultCode
                                      ? "text-amber-700 dark:text-amber-300"
                                      : "text-[#00548E] dark:text-blue-300"
                                }`}
                              >
                                Resultado SAE
                              </span>
                              <select
                                value={c.resultCode}
                                disabled={c.estado === "Contratado" || selectedReportLocked}
                                onChange={(e) =>
                                  void patchCandidate(c, {
                                    resultCode: e.target.value,
                                  })
                                }
                                className="w-full rounded-lg border-0 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs font-black text-slate-900 dark:text-white shadow-inner outline-none focus:ring-2 focus:ring-[#00548E]/30 disabled:opacity-60"
                              >
                                <option value="">Seleccionar resultado…</option>
                                {SAE_RESULT_CODES.map(([code, label]) => (
                                  <option key={code} value={code}>
                                    {code} · {label}
                                  </option>
                                ))}
                              </select>
                              <span className="mt-1 block text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                {c.resultCode === "2001"
                                  ? "Candidato marcado para contratar"
                                  : c.resultCode
                                    ? "Resultado asignado"
                                    : "Pendiente de asignar"}
                              </span>
                            </label>
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
              <h2 className="font-black">Cree una solicitud de mano de obra para comenzar</h2>
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
