import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck,
  Clock,
  FileDown,
  FileText,
  FolderOpen,
  HardHat,
  RefreshCw,
  Save,
  Users,
  X,
  Wrench,
  GraduationCap,
  ShieldCheck,
  UserPlus,
  Search,
  Trash2,
} from "lucide-react";
import { Person } from "../types";
import { getDocuments } from "../src/services/databaseService";
import { loadAppBusinessSettings } from "../src/services/appSettingsService";
import { supabase } from "../src/lib/supabase";
import { downloadPDF } from "../src/lib/exportUtils";
import {
  generateEpiDeliveryPdf,
  generateMachineryAuthorizationPdf,
  generateTrainingInformationPdf,
} from "../src/lib/worksiteDocumentsPdf";
import { generateContractAttendancePdf } from "../src/lib/worksiteAttendancePdf";
import { AdditionalWorksiteDocumentsWorkspace } from "./AdditionalWorksiteDocumentsPanel";

type WorkRow = {
  id: string;
  nombre: string;
  empresa?: string;
  cif?: string;
  recurso_preventivo?: string;
  recurso_preventivo_categoria?: string;
  municipio?: string;
};

type EpiKey =
  | "casco"
  | "chaleco"
  | "orejeras"
  | "gafas"
  | "guantes"
  | "mascarillas"
  | "calzado";

type AttendanceOverride = { start: string; end: string };
type DocumentationView =
  | "obra"
  | "trabajadores"
  | "epis"
  | "formacion"
  | "maquinaria"
  | "control"
  | "otros";

const WORKSITE_LAST_WORK_KEY = "profea:worksite-doc:last-work";
const WORKSITE_LAST_VIEW_KEY = "profea:worksite-doc:last-view";
const DOCUMENTATION_VIEWS: DocumentationView[] = [
  "obra",
  "trabajadores",
  "epis",
  "formacion",
  "maquinaria",
  "control",
  "otros",
];
const storedDocumentationView = (): DocumentationView => {
  if (typeof window === "undefined") return "obra";
  const stored = window.localStorage.getItem(WORKSITE_LAST_VIEW_KEY) as DocumentationView | null;
  return stored && DOCUMENTATION_VIEWS.includes(stored) ? stored : "obra";
};

const DEFAULT_COMPANY = "AEPSA (Diputación Provincial de Cádiz)";
const DIPUTACION_CADIZ_CIF = "P1100000G";
const DEFAULT_EPIS: Record<EpiKey, boolean> = {
  casco: true,
  chaleco: true,
  orejeras: true,
  gafas: true,
  guantes: true,
  mascarillas: true,
  calzado: true,
};

const safe = (value: unknown) => String(value ?? "").trim();
const normalize = (value: string) => safe(value).toLocaleLowerCase("es").replace(/\s+/g, " ");
const normalizeCompany = (value: string) =>
  normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const resolveKnownCompanyCif = (company: string): string => {
  const normalized = normalizeCompany(company);
  if ((normalized.includes("diputacion") && normalized.includes("cadiz")) || normalized.includes("aepsa")) {
    return DIPUTACION_CADIZ_CIF;
  }
  return "";
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const workIdentity = (value: string): string => {
  const raw = normalize(value).replace(/[._\-/:]+/g, " ");
  const code = raw.match(/\b(\d{5})\b/)?.[1] || "";
  const compact = raw.replace(/\s+/g, "");
  const type = compact.includes("gr") ? "GR" : compact.includes("ee") ? "EE" : "";
  return code && type ? `${code} ${type}` : "";
};
const sameWork = (left: string, right: string) => {
  const a = workIdentity(left);
  const b = workIdentity(right);
  return a && b ? a === b : normalize(left) === normalize(right);
};
const formatDate = (value: string) => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : safe(value) || "-";
};
const periodLabelFor = (person: Person): string => {
  if (safe(person.quincena)) return safe(person.quincena);
  if (safe(person.periodoInicio) || safe(person.periodoFin)) {
    return `${formatDate(person.periodoInicio)} – ${formatDate(person.periodoFin)}`;
  }
  return "Sin periodo";
};
const iso = (value: unknown) => {
  const text = safe(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
};
const overlaps = (person: Person, start: string, end: string) => {
  const pStart = iso(person.periodoInicio);
  const pEnd = iso(person.periodoFin);
  if (!pStart || !pEnd || !start || !end) return false;
  return pStart <= end && pEnd >= start;
};
const workerKey = (person: Person) => String(person.id);
const cleanDni = (person: Person) => safe(person.dni).toUpperCase().replace(/[\s-]/g, "");

export const WorksiteDocumentationPortal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workers, setWorkers] = useState<Person[]>([]);
  const [workRows, setWorkRows] = useState<WorkRow[]>([]);
  const [configuredWorks, setConfiguredWorks] = useState<string[]>([]);
  const [selectedWork, setSelectedWork] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem(WORKSITE_LAST_WORK_KEY) || "",
  );
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [empresa, setEmpresa] = useState(DEFAULT_COMPANY);
  const [cif, setCif] = useState(DIPUTACION_CADIZ_CIF);
  const [recursoPreventivo, setRecursoPreventivo] = useState("");
  const [documentDate, setDocumentDate] = useState(todayIso());
  const [trainingAction, setTrainingAction] = useState("Información y formación preventiva del puesto de trabajo y de la obra");
  const [trainingDuration, setTrainingDuration] = useState("1 h");
  const [epiSelection, setEpiSelection] = useState<Record<EpiKey, boolean>>(DEFAULT_EPIS);
  const [globalMachinery, setGlobalMachinery] = useState("");
  const [machineryByWorker, setMachineryByWorker] = useState<Record<string, string>>({});
  const [manualAttendanceIds, setManualAttendanceIds] = useState<string[]>([]);
  const [attendanceOverrides, setAttendanceOverrides] = useState<Record<string, AttendanceOverride>>({});
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(0);
  const [activeDocumentView, setActiveDocumentView] = useState<DocumentationView>(storedDocumentationView);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [people, obras, settings] = await Promise.all([
        getDocuments<Person>("trabajadores"),
        supabase.query("obras", {
          query: "select=id,nombre,municipio,empresa,cif,recurso_preventivo,recurso_preventivo_categoria&order=nombre.asc",
        }),
        loadAppBusinessSettings(),
      ]);
      setWorkers(people || []);
      setWorkRows((obras || []) as WorkRow[]);
      setConfiguredWorks((settings.savedObras || []).map(safe).filter(Boolean));
    } catch (error) {
      console.error("No se pudo cargar Documentación de obra:", error);
      showToast("No se han podido cargar las obras y trabajadores.", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const handleNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      const open = detail?.view === "documentacion_obra";
      setIsOpen(open);
      if (open) void refresh();
    };
    window.addEventListener("profea:navigate", handleNavigation as EventListener);
    return () => window.removeEventListener("profea:navigate", handleNavigation as EventListener);
  }, [refresh]);

  useEffect(() => {
    const updateWidth = () => {
      if (window.innerWidth < 1024) return setSidebarWidth(0);
      const sidebar = document.querySelector(".profea-sidebar-shell") as HTMLElement | null;
      setSidebarWidth(sidebar?.getBoundingClientRect().width || 0);
    };
    updateWidth();
    const sidebar = document.querySelector(".profea-sidebar-shell") as HTMLElement | null;
    const observer = sidebar && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateWidth) : null;
    if (sidebar && observer) observer.observe(sidebar);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [isOpen]);

  const workNames = useMemo(() => {
    const values = new Set<string>(
      [...workRows.map((work) => safe(work.nombre)), ...configuredWorks]
        .map((work) => workIdentity(work) || safe(work))
        .filter(Boolean),
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }, [configuredWorks, workRows]);

  useEffect(() => {
    if (!selectedWork && workNames.length) setSelectedWork(workNames[0]);
    if (selectedWork && !workNames.includes(selectedWork) && workNames.length) setSelectedWork(workNames[0]);
  }, [selectedWork, workNames]);

  useEffect(() => {
    if (!selectedWork || typeof window === "undefined") return;
    window.localStorage.setItem(WORKSITE_LAST_WORK_KEY, selectedWork);
  }, [selectedWork]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WORKSITE_LAST_VIEW_KEY, activeDocumentView);
  }, [activeDocumentView]);

  const selectDocumentView = (view: DocumentationView) => {
    setActiveDocumentView(view);
    if (typeof window === "undefined" || window.innerWidth >= 1024) return;
    window.requestAnimationFrame(() => {
      document.getElementById("worksite-doc-content")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const selectedWorkWorkers = useMemo(
    () => workers.filter((person) => sameWork(person.obra || "", selectedWork)),
    [workers, selectedWork],
  );

  const periods = useMemo<string[]>(
    () => Array.from(new Set<string>(selectedWorkWorkers.map(periodLabelFor))).sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    [selectedWorkWorkers],
  );

  useEffect(() => {
    if (!selectedPeriod || !periods.includes(selectedPeriod)) setSelectedPeriod(periods[0] || "");
  }, [periods, selectedPeriod]);

  const periodWorkers = useMemo(
    () => selectedWorkWorkers.filter((person) => !selectedPeriod || periodLabelFor(person) === selectedPeriod),
    [selectedWorkWorkers, selectedPeriod],
  );

  const attendanceRange = useMemo(() => {
    const starts = periodWorkers.map((p) => iso(p.periodoInicio)).filter(Boolean).sort();
    const ends = periodWorkers.map((p) => iso(p.periodoFin)).filter(Boolean).sort();
    return { start: starts[0] || "", end: ends[ends.length - 1] || "" };
  }, [periodWorkers]);

  const automaticAttendanceWorkers = useMemo(() => {
    if (!attendanceRange.start || !attendanceRange.end) return periodWorkers;
    const candidates = selectedWorkWorkers.filter((person) => overlaps(person, attendanceRange.start, attendanceRange.end));
    const byDni = new Map<string, Person>();
    candidates.forEach((person) => {
      const key = cleanDni(person) || workerKey(person);
      const previous = byDni.get(key);
      if (!previous || iso(person.periodoFin) > iso(previous.periodoFin)) byDni.set(key, person);
    });
    return Array.from(byDni.values());
  }, [attendanceRange, periodWorkers, selectedWorkWorkers]);

  const automaticAttendanceIds = useMemo(
    () => new Set(automaticAttendanceWorkers.map(workerKey)),
    [automaticAttendanceWorkers],
  );

  const manualAttendanceWorkers = useMemo(
    () => selectedWorkWorkers.filter((person) => manualAttendanceIds.includes(workerKey(person)) && !automaticAttendanceIds.has(workerKey(person))),
    [selectedWorkWorkers, manualAttendanceIds, automaticAttendanceIds],
  );

  const attendanceWorkers = useMemo(() => {
    const manual = manualAttendanceWorkers.map((person) => {
      const override = attendanceOverrides[workerKey(person)];
      return override?.start && override?.end
        ? { ...person, periodoInicio: override.start, periodoFin: override.end }
        : person;
    });
    return [...automaticAttendanceWorkers, ...manual];
  }, [automaticAttendanceWorkers, manualAttendanceWorkers, attendanceOverrides]);

  const manualCandidates = useMemo(() => {
    const term = normalize(attendanceSearch);
    return selectedWorkWorkers
      .filter((person) => !automaticAttendanceIds.has(workerKey(person)))
      .filter((person) => {
        if (!term) return true;
        return [person.apellidosNombre, person.dni, person.categoria, periodLabelFor(person)].some((value) => normalize(safe(value)).includes(term));
      })
      .sort((a, b) => safe(a.apellidosNombre).localeCompare(safe(b.apellidosNombre), "es"));
  }, [selectedWorkWorkers, automaticAttendanceIds, attendanceSearch]);

  useEffect(() => {
    setManualAttendanceIds([]);
    setAttendanceOverrides({});
    setAttendanceSearch("");
  }, [selectedWork, selectedPeriod]);

  useEffect(() => {
    const row = workRows.find((item) => sameWork(item.nombre, selectedWork));
    const nextCompany = safe(row?.empresa) || DEFAULT_COMPANY;
    setEmpresa(nextCompany);
    setCif(safe(row?.cif) || resolveKnownCompanyCif(nextCompany));
    setRecursoPreventivo(safe(row?.recurso_preventivo));
  }, [selectedWork, workRows]);

  useEffect(() => {
    const automaticCif = resolveKnownCompanyCif(empresa);
    if (automaticCif && cif !== automaticCif) setCif(automaticCif);
  }, [empresa, cif]);

  useEffect(() => {
    const dated = periodWorkers.map((p) => safe(p.periodoInicio)).filter(Boolean).sort()[0];
    setDocumentDate(dated && /^\d{4}-\d{2}-\d{2}/.test(dated) ? dated.slice(0, 10) : todayIso());
    const storageKey = `profea:obra-docs:maquinaria:${selectedWork}:${selectedPeriod}`;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
      setMachineryByWorker(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setMachineryByWorker({});
    }
  }, [selectedWork, selectedPeriod, periodWorkers]);

  useEffect(() => {
    if (!selectedWork || !selectedPeriod) return;
    localStorage.setItem(
      `profea:obra-docs:maquinaria:${selectedWork}:${selectedPeriod}`,
      JSON.stringify(machineryByWorker),
    );
  }, [machineryByWorker, selectedWork, selectedPeriod]);

  const saveWorkConfig = async () => {
    if (!selectedWork) return;
    if (!safe(recursoPreventivo)) return showToast("Indica el encargado/recurso preventivo de la obra.", "error");
    setSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Sesión no disponible");
      const row = workRows.find((item) => sameWork(item.nombre, selectedWork));
      const body = {
        empresa: safe(empresa) || DEFAULT_COMPANY,
        cif: safe(cif) || resolveKnownCompanyCif(empresa),
        recurso_preventivo: safe(recursoPreventivo),
        updated_by: data.user.id,
      };
      if (row) {
        await supabase.query("obras", { method: "PATCH", prefer: "return=minimal", query: `id=eq.${encodeURIComponent(row.id)}`, body });
      } else {
        await supabase.query("obras", {
          method: "POST",
          prefer: "return=minimal",
          body: {
            nombre: selectedWork,
            codigo: "",
            municipio: "",
            descripcion: "",
            ...body,
            owner_id: data.user.id,
            created_by: data.user.id,
          },
        });
      }
      await refresh();
      showToast("Datos de la obra guardados.");
    } catch (error) {
      console.error("Error guardando configuración de obra:", error);
      showToast("No se ha podido guardar el recurso preventivo de la obra.", "error");
    } finally {
      setSaving(false);
    }
  };

  const ensureReady = () => {
    if (!selectedWork) return (showToast("Selecciona una obra.", "error"), false);
    if (!selectedPeriod) return (showToast("Selecciona un periodo.", "error"), false);
    if (!periodWorkers.length) return (showToast("No hay trabajadores contratados en ese periodo.", "error"), false);
    if (!safe(recursoPreventivo)) return (showToast("Indica el encargado/recurso preventivo antes de generar el documento.", "error"), false);
    return true;
  };

  const context = useMemo(() => ({
    obra: selectedWork,
    municipio: safe(workRows.find((item) => sameWork(item.nombre, selectedWork))?.municipio),
    empresa: safe(empresa) || DEFAULT_COMPANY,
    cif: safe(cif) || resolveKnownCompanyCif(empresa),
    recursoPreventivo: safe(recursoPreventivo),
    fecha: documentDate,
    periodoLabel: selectedPeriod || "Sin periodo",
    accionFormativa: trainingAction,
    duracionFormacion: trainingDuration,
    epis: epiSelection,
    maquinariaPorTrabajador: machineryByWorker,
  }), [selectedWork, workRows, empresa, cif, recursoPreventivo, documentDate, selectedPeriod, trainingAction, trainingDuration, epiSelection, machineryByWorker]);

  const exportEpis = () => {
    if (!ensureReady()) return;
    const { doc, filename } = generateEpiDeliveryPdf(periodWorkers, context);
    downloadPDF(doc, filename);
  };

  const exportTraining = () => {
    if (!ensureReady()) return;
    const { doc, filename } = generateTrainingInformationPdf(periodWorkers, context);
    downloadPDF(doc, filename);
  };

  const exportMachinery = () => {
    if (!ensureReady()) return;
    const missing = periodWorkers.filter((p) => !safe(machineryByWorker[String(p.id)]));
    if (missing.length && !window.confirm(`${missing.length} trabajador(es) no tienen maquinaria indicada. ¿Generar el PDF igualmente?`)) return;
    const { doc, filename } = generateMachineryAuthorizationPdf(periodWorkers, context);
    downloadPDF(doc, filename);
  };

  const exportAttendance = () => {
    if (!selectedWork || !selectedPeriod) return showToast("Selecciona obra y periodo.", "error");
    if (!attendanceWorkers.length) return showToast("No hay trabajadores para el control horario.", "error");
    if (!safe(recursoPreventivo)) return showToast("Indica el encargado/recurso preventivo antes de generar el control horario.", "error");
    const missingDates = attendanceWorkers.filter((person) => !iso(person.periodoInicio) || !iso(person.periodoFin));
    if (missingDates.length) {
      showToast(`${missingDates.length} trabajador(es) no tienen completo el periodo efectivo del control horario.`, "error");
      return;
    }
    const invalidManual = manualAttendanceWorkers.filter((person) => {
      const override = attendanceOverrides[workerKey(person)];
      return !override?.start || !override?.end || override.start > override.end;
    });
    if (invalidManual.length) {
      showToast("Revisa las fechas de prórroga de los trabajadores añadidos manualmente.", "error");
      return;
    }
    const { doc, filename } = generateContractAttendancePdf(attendanceWorkers, context);
    downloadPDF(doc, filename);
  };

  const addManualAttendanceWorker = (person: Person) => {
    const key = workerKey(person);
    if (manualAttendanceIds.includes(key) || automaticAttendanceIds.has(key)) return;
    setManualAttendanceIds((prev) => [...prev, key]);
    const fallbackStart = attendanceRange.start || iso(person.periodoInicio) || documentDate;
    const fallbackEnd = attendanceRange.end || iso(person.periodoFin) || documentDate;
    setAttendanceOverrides((prev) => ({ ...prev, [key]: { start: fallbackStart, end: fallbackEnd } }));
  };

  const removeManualAttendanceWorker = (person: Person) => {
    const key = workerKey(person);
    setManualAttendanceIds((prev) => prev.filter((id) => id !== key));
    setAttendanceOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const applyMachineryToAll = () => {
    const value = safe(globalMachinery);
    if (!value) return;
    setMachineryByWorker((prev) => {
      const next = { ...prev };
      periodWorkers.forEach((person) => { next[String(person.id)] = value; });
      return next;
    });
  };

  const closeAndGoToSummary = () => {
    const button = document.querySelector('[data-profea-view="dashboard"]') as HTMLButtonElement | null;
    if (button) button.click();
    else setIsOpen(false);
  };

  if (!isOpen) return null;

  const libraryItems: {
    id: DocumentationView;
    label: string;
    description: string;
    icon: React.ElementType;
  }[] = [
    { id: "obra", label: "Datos de la obra", description: "Empresa, CIF y responsable", icon: HardHat },
    { id: "trabajadores", label: "Trabajadores", description: `${periodWorkers.length} en el periodo`, icon: Users },
    { id: "epis", label: "Entrega de EPIs", description: "Relación y firma", icon: ShieldCheck },
    { id: "formacion", label: "Formación e información", description: "Documento preventivo", icon: GraduationCap },
    { id: "maquinaria", label: "Autorización de maquinaria", description: "Equipos por trabajador", icon: Wrench },
    { id: "control", label: "Control horario", description: "Activos y prórrogas", icon: Clock },
    { id: "otros", label: "Otros documentos", description: "Biblioteca complementaria", icon: FolderOpen },
  ];

  return (
    <div
      className="fixed top-0 right-0 bottom-0 z-[35] overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      style={{ left: sidebarWidth }}
    >
      <div className="min-h-full px-2 sm:px-6 lg:px-8 py-2 sm:py-6 pb-20">
        <div className="max-w-[1580px] mx-auto space-y-3 sm:space-y-6">
          <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#003f6b] via-[#00548E] to-[#0876b8] px-4 py-4 sm:px-6 sm:py-5 text-white flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <ClipboardCheck className="w-6 h-6 sm:w-7 sm:h-7" />
                  <h1 className="text-xl sm:text-2xl font-black tracking-tight">Documentación de obra</h1>
                </div>
                <p className="hidden sm:block text-sm text-blue-100 mt-1">
                  Biblioteca documental por obra y periodo, con cada documento en su propio espacio de trabajo.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 p-2.5 sm:px-4 sm:py-2 text-sm font-semibold hover:bg-white/20"
                  title="Actualizar"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Actualizar</span>
                </button>
                <button
                  type="button"
                  onClick={closeAndGoToSummary}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 p-2.5 sm:px-4 sm:py-2 text-sm font-semibold hover:bg-white/20"
                  title="Cerrar"
                >
                  <X className="w-4 h-4" />
                  <span className="hidden sm:inline">Cerrar</span>
                </button>
              </div>
            </div>
          </header>

          <div className="lg:hidden sticky top-0 z-30 -mx-2 border-y border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-md shadow-sm">
            <div className="px-3 pt-3 pb-2">
              <label className="block text-[10px] uppercase tracking-wider font-black text-slate-500 dark:text-slate-400">
                Obra actual
                <select
                  value={selectedWork}
                  onChange={(event) => setSelectedWork(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-black"
                >
                  {workNames.map((work) => (
                    <option key={work} value={work}>{work}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="overflow-x-auto overscroll-x-contain px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-2 min-w-max">
                {libraryItems.map((item) => {
                  const Icon = item.icon;
                  const selected = activeDocumentView === item.id;
                  const mobileLabel =
                    item.id === "obra" ? "Obra" :
                    item.id === "trabajadores" ? "Trabajadores" :
                    item.id === "epis" ? "EPIs" :
                    item.id === "formacion" ? "Formación" :
                    item.id === "maquinaria" ? "Maquinaria" :
                    item.id === "control" ? "Control" : "Otros";
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectDocumentView(item.id)}
                      className={`min-h-14 rounded-xl border px-3 py-2 flex flex-col items-center justify-center gap-1 text-[10px] font-black transition-colors ${
                        selected
                          ? "border-[#00548E] bg-[#00548E] text-white shadow-sm"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
                      }`}
                      aria-current={selected ? "page" : undefined}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{mobileLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-3 lg:gap-5 items-start">
            <aside
              data-worksite-document-library="1"
              className="hidden lg:block rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm h-fit lg:sticky lg:top-5"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-black text-sm uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Obras
                </h2>
                <span className="text-xs font-bold rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-2.5 py-1">
                  {workNames.length}
                </span>
              </div>

              <div className="space-y-2 max-h-[34vh] overflow-y-auto pr-1">
                {workNames.map((work) => {
                  const count = workers.filter((person) => sameWork(person.obra || "", work)).length;
                  return (
                    <button
                      key={work}
                      type="button"
                      onClick={() => setSelectedWork(work)}
                      className={`w-full text-left rounded-xl border px-3.5 py-3 transition ${
                        selectedWork === work
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100 shadow-sm"
                          : "border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700"
                      }`}
                    >
                      <div className="font-bold text-sm leading-tight">{work}</div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {count} registro(s) de trabajadores
                      </div>
                    </button>
                  );
                })}
                {!workNames.length && (
                  <div className="p-4 text-sm text-slate-500">
                    No hay obras registradas en Configuración → Obras.
                  </div>
                )}
              </div>

              <div className="my-4 border-t border-slate-200 dark:border-slate-800" />

              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#00548E] dark:text-blue-400" />
                  <h2 className="font-black text-sm uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Biblioteca de documentación
                  </h2>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Selecciona un apartado para trabajar en el panel derecho.
                </p>
              </div>

              <div className="space-y-1.5">
                {libraryItems.map((item) => {
                  const Icon = item.icon;
                  const selected = activeDocumentView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectDocumentView(item.id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left flex items-center gap-3 transition-colors ${
                        selected
                          ? "border-[#00548E] bg-[#00548E] text-white shadow-sm"
                          : "border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700"
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          selected ? "text-white" : "text-slate-500 dark:text-slate-400"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-black">{item.label}</span>
                        <span
                          className={`block mt-0.5 text-[10px] truncate ${
                            selected ? "text-blue-100" : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <main id="worksite-doc-content" className="space-y-3 sm:space-y-5 min-w-0 scroll-mt-40">
              <section className="rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-5 shadow-sm">
                <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
                  <label className="hidden lg:block text-xs font-bold text-slate-600 dark:text-slate-300">
                    Obra
                    <input
                      value={selectedWork}
                      readOnly
                      className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-sm font-bold"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Periodo
                    <select
                      value={selectedPeriod}
                      onChange={(event) => setSelectedPeriod(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm"
                    >
                      {periods.map((period) => (
                        <option key={period}>{period}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Fecha del documento
                    <input
                      type="date"
                      value={documentDate}
                      onChange={(event) => setDocumentDate(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm"
                    />
                  </label>
                  <label className="col-span-2 sm:col-span-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                    Trabajadores
                    <div className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-sm font-black">
                      {periodWorkers.length} en este periodo
                    </div>
                  </label>
                </div>
              </section>

              {activeDocumentView === "obra" && (
                <section className="rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-5">
                    <HardHat className="w-5 h-5 text-blue-600" />
                    <div>
                      <h2 className="font-black text-lg">Datos de la obra</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Datos comunes que utilizarán los documentos de esta obra.
                      </p>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="text-sm font-semibold">
                      Empresa
                      <input
                        value={empresa}
                        onChange={(event) => setEmpresa(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5"
                      />
                    </label>
                    <label className="text-sm font-semibold">
                      CIF
                      <input
                        value={cif}
                        onChange={(event) => setCif(event.target.value.toUpperCase())}
                        placeholder="Se completa automáticamente"
                        className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5"
                      />
                    </label>
                    <label className="text-sm font-semibold sm:col-span-2">
                      Encargado / recurso preventivo
                      <input
                        value={recursoPreventivo}
                        onChange={(event) => setRecursoPreventivo(event.target.value)}
                        placeholder="Nombre y apellidos"
                        className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5"
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void saveWorkConfig()}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white px-4 py-2.5 font-bold disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      {saving ? "Guardando…" : "Guardar datos de la obra"}
                    </button>
                  </div>
                </section>
              )}

              {activeDocumentView === "trabajadores" && (
                <section className="rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-blue-600" />
                    <h2 className="font-black text-lg">Trabajadores del periodo</h2>
                  </div>
                  <div className="sm:hidden space-y-2">
                    {periodWorkers.map((person) => (
                      <div key={person.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/60 dark:bg-slate-950/30">
                        <div className="font-black text-sm leading-snug">{person.apellidosNombre}</div>
                        <div className="mt-1 text-xs text-slate-500">{person.dni} · {person.categoria || "Sin puesto"}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                          <div><span className="block text-slate-400">Inicio</span><b>{formatDate(person.periodoInicio)}</b></div>
                          <div><span className="block text-slate-400">Fin</span><b>{formatDate(person.periodoFin)}</b></div>
                          <div><span className="block text-slate-400">Calzado</span><b>{person.calzado || "-"}</b></div>
                        </div>
                      </div>
                    ))}
                    {!periodWorkers.length && <div className="text-sm text-slate-500 p-3">No hay trabajadores en este periodo.</div>}
                  </div>
                  <div className="hidden sm:block overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        <tr>
                          <th className="text-left px-4 py-3">Nombre y apellidos</th>
                          <th className="text-left px-4 py-3">DNI/NIE</th>
                          <th className="text-left px-4 py-3">Puesto</th>
                          <th className="text-left px-4 py-3">Inicio</th>
                          <th className="text-left px-4 py-3">Fin</th>
                          <th className="text-left px-4 py-3">Calzado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodWorkers.map((person) => (
                          <tr key={person.id} className="border-t border-slate-200 dark:border-slate-800">
                            <td className="px-4 py-3 font-semibold">{person.apellidosNombre}</td>
                            <td className="px-4 py-3">{person.dni}</td>
                            <td className="px-4 py-3">{person.categoria || "-"}</td>
                            <td className="px-4 py-3">{formatDate(person.periodoInicio)}</td>
                            <td className="px-4 py-3">{formatDate(person.periodoFin)}</td>
                            <td className="px-4 py-3">{person.calzado || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {activeDocumentView === "epis" && (
                <section className="rounded-3xl border border-emerald-200 dark:border-emerald-900/70 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-emerald-600" />
                        <h2 className="font-black text-xl">Entrega de EPIs</h2>
                      </div>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Genera la relación nominal con los equipos entregados y la firma de cada trabajador.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={exportEpis}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 font-bold"
                    >
                      <FileDown className="w-4 h-4" />
                      Generar PDF EPIs
                    </button>
                  </div>
                  <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                    {(Object.keys(DEFAULT_EPIS) as EpiKey[]).map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-3"
                      >
                        <input
                          type="checkbox"
                          checked={epiSelection[key]}
                          onChange={(event) =>
                            setEpiSelection((current) => ({ ...current, [key]: event.target.checked }))
                          }
                        />
                        <span className="capitalize font-semibold">{key}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {activeDocumentView === "formacion" && (
                <section className="rounded-3xl border border-indigo-200 dark:border-indigo-900/70 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <GraduationCap className="w-5 h-5 text-indigo-600" />
                        <h2 className="font-black text-xl">Formación e información</h2>
                      </div>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Documento preventivo de información y formación asociado al periodo seleccionado.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={exportTraining}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 font-bold"
                    >
                      <FileDown className="w-4 h-4" />
                      Generar PDF Formación
                    </button>
                  </div>
                  <div className="mt-5 grid lg:grid-cols-[1fr_180px] gap-4">
                    <label className="text-sm font-bold">
                      Acción formativa / información
                      <textarea
                        value={trainingAction}
                        onChange={(event) => setTrainingAction(event.target.value)}
                        rows={6}
                        className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5"
                      />
                    </label>
                    <label className="text-sm font-bold">
                      Duración
                      <input
                        value={trainingDuration}
                        onChange={(event) => setTrainingDuration(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5"
                      />
                    </label>
                  </div>
                </section>
              )}

              {activeDocumentView === "maquinaria" && (
                <section className="rounded-3xl border border-amber-200 dark:border-amber-900/70 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-5">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Wrench className="w-5 h-5 text-amber-600" />
                        <h2 className="font-black text-xl">Autorización de maquinaria</h2>
                      </div>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Define los equipos autorizados de forma general o individual por trabajador.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={exportMachinery}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-5 py-3 font-bold"
                    >
                      <FileDown className="w-4 h-4" />
                      Generar PDF Maquinaria
                    </button>
                  </div>

                  <div className="rounded-2xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/15 p-4">
                    <label className="text-sm font-bold">
                      Maquinaria o equipos para aplicar a todos
                      <textarea
                        value={globalMachinery}
                        onChange={(event) => setGlobalMachinery(event.target.value)}
                        rows={3}
                        placeholder="Ej.: Dumper, hormigonera, radial…"
                        className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={applyMachineryToAll}
                      className="mt-2 rounded-xl border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-950/30"
                    >
                      Aplicar a todos
                    </button>
                  </div>

                  <div className="space-y-3">
                    {periodWorkers.map((person) => (
                      <div
                        key={person.id}
                        className="grid md:grid-cols-[minmax(230px,0.7fr)_minmax(0,1.3fr)] gap-3 items-center rounded-2xl border border-slate-200 dark:border-slate-800 p-3"
                      >
                        <div>
                          <div className="font-bold text-sm">{person.apellidosNombre}</div>
                          <div className="text-xs text-slate-500">
                            {person.dni} · {person.categoria || "Sin puesto"}
                          </div>
                        </div>
                        <input
                          value={machineryByWorker[String(person.id)] || ""}
                          onChange={(event) =>
                            setMachineryByWorker((current) => ({
                              ...current,
                              [String(person.id)]: event.target.value,
                            }))
                          }
                          placeholder="Varias máquinas separadas por coma"
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeDocumentView === "control" && (
                <section className="rounded-3xl border border-blue-200 dark:border-blue-900/70 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-5">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                    <div className="max-w-3xl">
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-[#00548E] dark:text-blue-400" />
                        <h2 className="font-black text-xl">Control horario · trabajadores activos y prórrogas</h2>
                      </div>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        La aplicación incluye automáticamente los trabajadores cuyo contrato se solape con el periodo y permite añadir prórrogas manuales.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 px-3 py-1.5">
                          Automáticos: {automaticAttendanceWorkers.length}
                        </span>
                        <span className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 px-3 py-1.5">
                          Añadidos: {manualAttendanceWorkers.length}
                        </span>
                        <span className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 px-3 py-1.5">
                          Fichas: {attendanceWorkers.length}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={exportAttendance}
                      disabled={!attendanceWorkers.length}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white px-5 py-3 font-bold disabled:opacity-50 disabled:cursor-not-allowed min-w-[250px]"
                    >
                      <FileDown className="w-4 h-4" />
                      Generar control horario
                    </button>
                  </div>

                  <div className="rounded-2xl border border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-4">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <UserPlus className="w-4 h-4" />
                      Añadir trabajador de un periodo anterior
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Al añadirlo, indica las fechas efectivas de la prórroga. Solo se utilizarán en su ficha de control horario.
                    </p>
                    <div className="mt-3 relative">
                      <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                      <input
                        value={attendanceSearch}
                        onChange={(event) => setAttendanceSearch(event.target.value)}
                        placeholder="Buscar por nombre, DNI, puesto o periodo anterior…"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm"
                      />
                    </div>
                    <div className="mt-3 max-h-56 overflow-y-auto space-y-2">
                      {manualCandidates.slice(0, 50).map((person) => {
                        const added = manualAttendanceIds.includes(workerKey(person));
                        return (
                          <div
                            key={person.id}
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5"
                          >
                            <div>
                              <div className="font-semibold text-sm">{person.apellidosNombre}</div>
                              <div className="text-xs text-slate-500">
                                {person.dni} · {person.categoria || "Sin puesto"} · {periodLabelFor(person)}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={added}
                              onClick={() => addManualAttendanceWorker(person)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-300 dark:border-blue-800 px-3 py-2 text-xs font-bold text-blue-700 dark:text-blue-200 disabled:opacity-50"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              {added ? "Añadido" : "Añadir"}
                            </button>
                          </div>
                        );
                      })}
                      {!manualCandidates.length && (
                        <div className="text-xs text-slate-500 py-2">
                          No hay trabajadores anteriores disponibles con ese filtro.
                        </div>
                      )}
                    </div>
                  </div>

                  {!!manualAttendanceWorkers.length && (
                    <div className="space-y-3">
                      <h3 className="font-black text-sm">Prórrogas añadidas manualmente</h3>
                      {manualAttendanceWorkers.map((person) => {
                        const key = workerKey(person);
                        const override = attendanceOverrides[key] || {
                          start: attendanceRange.start,
                          end: attendanceRange.end,
                        };
                        return (
                          <div
                            key={key}
                            className="grid xl:grid-cols-[minmax(220px,1fr)_170px_170px_auto] gap-3 items-end rounded-2xl border border-slate-200 dark:border-slate-800 p-3"
                          >
                            <div>
                              <div className="font-bold text-sm">{person.apellidosNombre}</div>
                              <div className="text-xs text-slate-500">
                                {person.dni} · Registro anterior: {periodLabelFor(person)}
                              </div>
                            </div>
                            <label className="text-xs font-bold">
                              Inicio prórroga
                              <input
                                type="date"
                                value={override.start || ""}
                                onChange={(event) =>
                                  setAttendanceOverrides((current) => ({
                                    ...current,
                                    [key]: { ...override, start: event.target.value },
                                  }))
                                }
                                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2"
                              />
                            </label>
                            <label className="text-xs font-bold">
                              Fin prórroga
                              <input
                                type="date"
                                value={override.end || ""}
                                onChange={(event) =>
                                  setAttendanceOverrides((current) => ({
                                    ...current,
                                    [key]: { ...override, end: event.target.value },
                                  }))
                                }
                                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeManualAttendanceWorker(person)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-300"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Quitar
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {activeDocumentView === "otros" && (
                <AdditionalWorksiteDocumentsWorkspace selectedWork={selectedWork} />
              )}
            </main>
          </div>
        </div>
      </div>

      {toast && (
        <div
          className={`fixed top-5 right-5 z-[80] rounded-xl px-4 py-3 shadow-xl border text-sm font-semibold ${
            toast.type === "success"
              ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950 dark:text-green-100"
              : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:text-red-100"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};
