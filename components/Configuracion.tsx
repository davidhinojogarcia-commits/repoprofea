import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Trash2,
  Plus,
  Settings,
  MapPin,
  GraduationCap,
  Stethoscope,
  Phone,
  Briefcase,
  Search,
  AlertCircle,
  Database,
  Download,
  FileJson,
  CheckCircle,
  LogIn,
  LogOut,
  ExternalLink,
  Upload,
  FileArchive,
  Layers,
  ShieldAlert,
  RefreshCw,
  Loader2,
  FileText,
  Check,
  Edit3,
  Save,
  X,
  Building2,
  UserCheck,
  Users,
  Clock,
} from "lucide-react";
import { Person, DeletedPerson } from "../types";
import {
  compressToGzip,
  decompressFromGzip,
  isCompressionSupported,
} from "../src/lib/compression";
import { restoreBackupToSupabase } from "../src/services/backupRestoreService";
import {
  createDocument,
  deleteDocument,
  getDocuments,
  updateDocument,
} from "../src/services/databaseService";
import {
  DEFAULT_SUPERVISOR_SETTINGS,
  DEFAULT_TECHNICIAN_SETTINGS,
  DEFAULT_ADMINISTRATIVE_SETTINGS,
  DEFAULT_MEDICAL_PROVIDER_SETTINGS,
  DEFAULT_FOOTWEAR_PROVIDER_SETTINGS,
  DEFAULT_TRAINING_PROVIDER_SETTINGS,
  loadAppBusinessSettings,
  saveAppBusinessSettings,
  type SupervisorSettings,
  type TechnicianSettings,
  type AdministrativeSettings,
  type MedicalProviderSettings,
  type FootwearProviderSettings,
  type TrainingProviderSettings,
  type TrainingProviderEntry,
} from "../src/services/appSettingsService";
import { downloadPDF } from "../src/lib/exportUtils";
import { PageHeader } from "./ui/PageHeader";
import { useAuthShell } from "./AuthGate";
import { APP_BUILD, APP_RELEASE_DATE, APP_RELEASE_NOTES, APP_VERSION } from "../src/lib/appVersion";
import { buildWorkerMasterRecords, maskWorkerIban, maskWorkerNuss } from "../src/lib/workerMaster";
import { downloadWorkerMasterExcel, downloadWorkerMasterPdf, workerRecordIsComplete, workerRecordYear } from "../src/lib/workerMasterExport";
import {
  getStoredReporteTecnicoConfig,
  saveStoredReporteTecnicoConfig,
  getStoredObrasRecursosPreventivos,
  saveStoredObraRecursoPreventivo,
  deleteStoredObraRecursoPreventivo,
  replaceStoredObrasRecursosPreventivos,
  ObraRecursoPreventivo,
} from "../src/lib/subcontratasDefaults";

interface ConfiguracionProps {
  savedObras: string[];
  setSavedObras: React.Dispatch<React.SetStateAction<string[]>>;
  savedLugares: string[];
  setSavedLugares: React.Dispatch<React.SetStateAction<string[]>>;
  savedSitios: string[];
  setSavedSitios: React.Dispatch<React.SetStateAction<string[]>>;
  savedTelefonos: string[];
  setSavedTelefonos: React.Dispatch<React.SetStateAction<string[]>>;
  savedCategorias: string[];
  setSavedCategorias: React.Dispatch<React.SetStateAction<string[]>>;
  people: Person[];
  deletedPeople: DeletedPerson[];
  setPeople: React.Dispatch<React.SetStateAction<Person[]>>;
  setDeletedPeople: React.Dispatch<React.SetStateAction<DeletedPerson[]>>;
  workStartHour: string;
  setWorkStartHour: React.Dispatch<React.SetStateAction<string>>;
  workEndHour: string;
  setWorkEndHour: React.Dispatch<React.SetStateAction<string>>;
  googleUser?: any;
  googleToken?: string | null;
  autoSaveToDrive?: boolean;
  setAutoSaveToDrive?: (val: boolean) => void;
  onGoogleLogin?: () => void;
  onGoogleLogout?: () => void;
  autoThemeByTime: boolean;
  setAutoThemeByTime: (val: boolean) => void;
  driveBackupConfig?: any;
  setDriveBackupConfig?: (config: any) => void;
  onExecuteDriveBackupNow?: () => Promise<void>;
  isBackingUpToDrive?: boolean;
  setToast?: React.Dispatch<
    React.SetStateAction<{ message: string; type: "success" | "error" } | null>
  >;
  onImportWorkers?: (file: File) => void;
}

export const Configuracion: React.FC<ConfiguracionProps> = ({
  savedObras,
  setSavedObras,
  savedLugares,
  setSavedLugares,
  savedSitios,
  setSavedSitios,
  savedTelefonos,
  setSavedTelefonos,
  savedCategorias,
  setSavedCategorias,
  people,
  deletedPeople,
  setPeople,
  setDeletedPeople,
  workStartHour,
  setWorkStartHour,
  workEndHour,
  setWorkEndHour,
  autoThemeByTime,
  setAutoThemeByTime,
  setToast,
  onImportWorkers,
}) => {
  const { supervisorName, profile, user } = useAuthShell();
  const [supervisorForm, setSupervisorForm] = useState<SupervisorSettings>(DEFAULT_SUPERVISOR_SETTINGS);
  const [technicianForm, setTechnicianForm] = useState<TechnicianSettings>(DEFAULT_TECHNICIAN_SETTINGS);
  const [administrativeForm, setAdministrativeForm] = useState<AdministrativeSettings>(DEFAULT_ADMINISTRATIVE_SETTINGS);
  const [medicalProviderForm, setMedicalProviderForm] = useState<MedicalProviderSettings>(DEFAULT_MEDICAL_PROVIDER_SETTINGS);
  const [footwearProviderForm, setFootwearProviderForm] = useState<FootwearProviderSettings>(DEFAULT_FOOTWEAR_PROVIDER_SETTINGS);
  const [trainingProviders, setTrainingProviders] = useState<TrainingProviderEntry[]>([]);
  const [activeTrainingProviderId, setActiveTrainingProviderId] = useState("");
  const [trainingProviderDraft, setTrainingProviderDraft] = useState<TrainingProviderSettings>(DEFAULT_TRAINING_PROVIDER_SETTINGS);
  const [supervisorLoaded, setSupervisorLoaded] = useState(false);
  const [technicianLoaded, setTechnicianLoaded] = useState(false);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<
    | "obras"
    | "lugares"
    | "sitios"
    | "trabajadores"
    | "categorias"
    | "supervisor"
    | "technician"
    | "administrative"
    | "medicalProvider"
    | "footwearProvider"
    | "trainingProvider"
    | "horario"
    | "backup"
  >("lugares");

  const [newItem, setNewItem] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [workerExportYear, setWorkerExportYear] = useState("all");
  const [workerExportDataFilter, setWorkerExportDataFilter] = useState("all");
  const [workerExportSelectedKeys, setWorkerExportSelectedKeys] = useState<string[]>([]);
  const [workerExportBusy, setWorkerExportBusy] = useState<"" | "excel" | "pdf">("");

  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // Recursos Preventivos por Obra state
  const [obrasRecursos, setObrasRecursos] = useState<
    Record<string, ObraRecursoPreventivo>
  >(() => getStoredObrasRecursosPreventivos());
  const [newObraRecurso, setNewObraRecurso] = useState("");
  const [newObraTelefono, setNewObraTelefono] = useState("");
  const [newObraMunicipio, setNewObraMunicipio] = useState("");
  const [obrasMaestras, setObrasMaestras] = useState<any[]>([]);
  const [newObraCategoria, setNewObraCategoria] = useState("Encargado de Obra");
  const [editingObraRecurso, setEditingObraRecurso] = useState<{
    obra: string;
    nombre: string;
    recurso: string;
    categoria: string;
    telefono: string;
    municipio: string;
    id?: string;
  } | null>(null);

  useEffect(() => {
    void getDocuments<any>("obras", { limitCount: 10000 })
      .then((rows) => {
        setObrasMaestras(rows);
        const storedRecursos = getStoredObrasRecursosPreventivos();
        setObrasRecursos(
          Object.fromEntries(
            rows.map((row) => [
              row.nombre,
              {
                obra: row.nombre,
                recursoPreventivoNombre: row.recursoPreventivo || "",
                recursoPreventivoCategoria:
                  row.recursoPreventivoCategoria || "Encargado de Obra",
                recursoPreventivoTelefono:
                  storedRecursos[row.nombre]?.recursoPreventivoTelefono || "",
              },
            ]),
          ),
        );
        if (rows.length)
          setSavedObras(
            rows
              .map((row) => String(row.nombre || "").trim())
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b, "es")),
          );
      })
      .catch((error) =>
        console.error("No se pudieron cargar las obras maestras:", error),
      );
  }, [setSavedObras]);

  useEffect(() => {
    let active = true;
    void loadAppBusinessSettings()
      .then((settings) => {
        if (!active) return;
        const configured = settings.supervisor || DEFAULT_SUPERVISOR_SETTINGS;
        setSupervisorForm({
          ...DEFAULT_SUPERVISOR_SETTINGS,
          ...configured,
          nombreApellidos: configured.nombreApellidos || supervisorName || "",
          email: configured.email || profile?.email || user?.email || "",
        });
        setTechnicianForm({
          ...DEFAULT_TECHNICIAN_SETTINGS,
          ...(settings.technician || {}),
        });
        setAdministrativeForm({
          ...DEFAULT_ADMINISTRATIVE_SETTINGS,
          ...(settings.administrative || {}),
        });
        setMedicalProviderForm({
          ...DEFAULT_MEDICAL_PROVIDER_SETTINGS,
          ...(settings.medicalProvider || {}),
        });
        setFootwearProviderForm({
          ...DEFAULT_FOOTWEAR_PROVIDER_SETTINGS,
          ...(settings.footwearProvider || {}),
        });
        setTrainingProviders(settings.trainingProviders || []);
        setActiveTrainingProviderId(settings.activeTrainingProviderId || settings.trainingProviders?.[0]?.id || "");
        setTrainingProviderDraft({ ...DEFAULT_TRAINING_PROVIDER_SETTINGS });
      })
      .catch((error) => console.error("No se pudo cargar la configuración del supervisor:", error))
      .finally(() => {
        if (active) {
          setSupervisorLoaded(true);
          setTechnicianLoaded(true);
          setContactsLoaded(true);
        }
      });
    return () => { active = false; };
  }, [supervisorName, profile?.email, user?.email]);

  // State for parsed backup verification
  const [loadedBackup, setLoadedBackup] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerImportInputRef = useRef<HTMLInputElement>(null);

  // Build a complete backup from Supabase, the application's source of truth.
  // UI state is deliberately not used for business records so a stale render can never
  // produce a backup that differs from the database.
  const createBackupData = async () => {
    const [
      dbPeople,
      dbTrash,
      citas,
      subcontratas,
      reconocimientos,
      contrataciones,
      appSettings,
    ] = await Promise.all([
      getDocuments<Person>("trabajadores", { limitCount: 10000 }),
      getDocuments<DeletedPerson>("trash", { limitCount: 10000 }),
      getDocuments<any>("citas", { limitCount: 10000 }),
      getDocuments<any>("subcontratas", { limitCount: 10000 }),
      getDocuments<any>("reconocimientos", { limitCount: 10000 }),
      getDocuments<any>("contrataciones", { limitCount: 10000 }),
      loadAppBusinessSettings(),
    ]);

    return {
      type: "profea_complete_backup",
      system: "Sistema de Gestión PROFEA",
      version: "3.0.0",
      storage: "supabase",
      exportDate: new Date().toISOString(),
      totalRecords: dbPeople.length,
      totalTrashRecords: dbTrash.length,
      people: dbPeople,
      deletedPeople: dbTrash,
      citas,
      subcontratas,
      reconocimientos,
      contrataciones,
      config: {
        obras: appSettings.savedObras,
        lugares: appSettings.savedLugares,
        sitios: appSettings.savedSitios,
        telefonos: appSettings.savedTelefonos,
        categorias: appSettings.savedCategorias,
        workStartHour: appSettings.workStartHour,
        workEndHour: appSettings.workEndHour,
        supervisor: appSettings.supervisor,
        technician: appSettings.technician,
        administrative: appSettings.administrative,
        medicalProvider: appSettings.medicalProvider,
        footwearProvider: appSettings.footwearProvider,
        trainingProvider: appSettings.trainingProvider,
        trainingProviders: appSettings.trainingProviders,
        activeTrainingProviderId: appSettings.activeTrainingProviderId,
        // Backward compatibility for backups created before v3.
        subcontratas,
        reporteTecnicoConfig: getStoredReporteTecnicoConfig(),
        obrasRecursosPreventivos: getStoredObrasRecursosPreventivos(),
      },
    };
  };

  // 1. Download Compressed Backup (GZIP)
  const handleDownloadBackupGzip = async () => {
    try {
      if (!isCompressionSupported()) {
        // Fallback to standard JSON if CompressionStream is not available
        await handleDownloadBackupNormal();
        return;
      }

      const backupObj = await createBackupData();
      const jsonStr = JSON.stringify(backupObj);
      const blob = await compressToGzip(jsonStr);

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      link.href = url;
      link.download = `copia_completa_profea_${dateStr}.json.gz`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (setToast) {
        setToast({
          message: "Copia de seguridad COMPRIMIDA descargada con éxito",
          type: "success",
        });
      }
    } catch (error: any) {
      console.error(error);
      alert(
        "⚠️ Hubo un error al generar la copia de seguridad comprimida: " +
          error.message,
      );
    }
  };

  // 2. Download Standard JSON Backup (Uncompressed fallback/alternative)
  const handleDownloadBackupNormal = async () => {
    try {
      const backupObj = await createBackupData();
      const jsonStr = JSON.stringify(backupObj, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      link.href = url;
      link.download = `copia_completa_profea_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (setToast) {
        setToast({
          message: "Copia de seguridad estándar descargada con éxito",
          type: "success",
        });
      }
    } catch (error) {
      console.error(error);
      alert("⚠️ Hubo un error al generar la copia de seguridad estándar.");
    }
  };

  // 3. Import backup file
  const handleImportBackupFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let jsonText = "";
      if (file.name.endsWith(".gz")) {
        jsonText = await decompressFromGzip(file);
      } else if (file.name.endsWith(".json")) {
        jsonText = await file.text();
      } else {
        alert(
          "⚠️ Formato de archivo no soportado. Por favor, seleccione un archivo .json o .json.gz",
        );
        return;
      }

      const parsed = JSON.parse(jsonText);
      if (
        parsed &&
        (parsed.type === "profea_complete_backup" || parsed.people)
      ) {
        setLoadedBackup(parsed);
      } else {
        alert(
          "⚠️ El archivo no parece ser una copia de seguridad válida de esta aplicación.",
        );
      }
    } catch (error: any) {
      console.error(error);
      alert(
        "⚠️ Error al leer o procesar el archivo de copia de seguridad: " +
          error.message,
      );
    } finally {
      e.target.value = "";
    }
  };

  // 4. Confirm and Execute Restore. Supabase is the source of truth:
  // nothing is applied to React state until the database restore succeeds.
  const executeRestore = async (mode: "replace" | "merge") => {
    if (!loadedBackup) return;

    const backupPeople: Person[] = Array.isArray(loadedBackup.people)
      ? loadedBackup.people
      : [];
    const backupDeletedPeople: DeletedPerson[] = Array.isArray(
      loadedBackup.deletedPeople,
    )
      ? loadedBackup.deletedPeople
      : [];
    const backupConfig = loadedBackup.config || {};

    const mergePeopleByDni = (current: Person[], incoming: Person[]) => {
      const merged = [...current];
      incoming.forEach((bp) => {
        const dni = String(bp?.dni || "")
          .trim()
          .toLowerCase();
        const idx = dni
          ? merged.findIndex(
              (p) =>
                String(p?.dni || "")
                  .trim()
                  .toLowerCase() === dni,
            )
          : -1;
        if (idx !== -1) merged[idx] = bp;
        else merged.push(bp);
      });
      return merged;
    };

    const mergeTrashByDni = (
      current: DeletedPerson[],
      incoming: DeletedPerson[],
    ) => {
      const merged = [...current];
      incoming.forEach((bdp) => {
        const dni = String(bdp?.person?.dni || "")
          .trim()
          .toLowerCase();
        const idx = dni
          ? merged.findIndex(
              (dp) =>
                String(dp?.person?.dni || "")
                  .trim()
                  .toLowerCase() === dni,
            )
          : -1;
        if (idx !== -1) merged[idx] = bdp;
        else merged.push(bdp);
      });
      return merged;
    };

    try {
      const result = await restoreBackupToSupabase(loadedBackup, mode);

      if (mode === "replace") {
        setPeople(backupPeople);
        setDeletedPeople(backupDeletedPeople);
      } else {
        setPeople((prev) => mergePeopleByDni(prev, backupPeople));
        setDeletedPeople((prev) => mergeTrashByDni(prev, backupDeletedPeople));
      }

      // Reflect exactly what was persisted in Supabase.
      setSavedObras(result.settings.savedObras);
      setSavedLugares(result.settings.savedLugares);
      setSavedSitios(result.settings.savedSitios);
      setSavedTelefonos(result.settings.savedTelefonos);
      setSavedCategorias(result.settings.savedCategorias);
      setWorkStartHour(result.settings.workStartHour);
      setWorkEndHour(result.settings.workEndHour);

      // These report-only preferences are still migrated separately; keep compatibility
      // without using them as business-data storage.
      if (backupConfig.reporteTecnicoConfig) {
        saveStoredReporteTecnicoConfig(backupConfig.reporteTecnicoConfig);
      }
      if (backupConfig.obrasRecursosPreventivos) {
        replaceStoredObrasRecursosPreventivos(
          backupConfig.obrasRecursosPreventivos,
        );
        setObrasRecursos(backupConfig.obrasRecursosPreventivos);
      }

      setLoadedBackup(null);
      if (setToast) {
        setToast({
          message:
            mode === "replace"
              ? "Copia restaurada y persistida en Supabase correctamente."
              : "Copia combinada y persistida en Supabase correctamente.",
          type: "success",
        });
      }
    } catch (error: any) {
      console.error("Error restaurando copia en Supabase:", error);
      if (setToast) {
        setToast({
          message: `No se pudo restaurar la copia en la base de datos: ${error?.message || "error desconocido"}`,
          type: "error",
        });
      } else {
        alert("No se pudo restaurar la copia en la base de datos.");
      }
    }
  };

  const workerMasterRecords = useMemo(() => buildWorkerMasterRecords(people), [people]);
  const workerExportYears = useMemo(
    () => Array.from(new Set(workerMasterRecords.map(workerRecordYear).filter(Boolean))).sort((a, b) => b.localeCompare(a)),
    [workerMasterRecords],
  );
  const filteredWorkerMasterRecords = useMemo(() => {
    const q = searchTerm.trim().toLocaleLowerCase("es");
    return workerMasterRecords.filter((worker) => {
      const matchesSearch = !q || [
        worker.apellidosNombre,
        worker.dni,
        worker.fechaNacimiento,
        worker.telefono,
        worker.numeroSeguridadSocial,
        worker.iban,
        worker.calzado,
      ].some((value) => String(value || "").toLocaleLowerCase("es").includes(q));

      const matchesYear =
        workerExportYear === "all" || workerRecordYear(worker) === workerExportYear;

      const matchesData =
        workerExportDataFilter === "all" ||
        (workerExportDataFilter === "complete" && workerRecordIsComplete(worker)) ||
        (workerExportDataFilter === "incomplete" && !workerRecordIsComplete(worker)) ||
        (workerExportDataFilter === "missing-phone" && !worker.telefono) ||
        (workerExportDataFilter === "missing-nuss" && !worker.numeroSeguridadSocial) ||
        (workerExportDataFilter === "missing-iban" && !worker.iban);

      return matchesSearch && matchesYear && matchesData;
    });
  }, [workerMasterRecords, searchTerm, workerExportYear, workerExportDataFilter]);

  const workerExportVisibleKeys = useMemo(
    () => new Set(filteredWorkerMasterRecords.map(worker => worker.key)),
    [filteredWorkerMasterRecords],
  );
  const workerExportSelectedVisible = useMemo(
    () => filteredWorkerMasterRecords.filter(worker => workerExportSelectedKeys.includes(worker.key)),
    [filteredWorkerMasterRecords, workerExportSelectedKeys],
  );
  const workerExportRows = workerExportSelectedVisible.length
    ? workerExportSelectedVisible
    : filteredWorkerMasterRecords;

  const toggleWorkerExportSelection = (key: string) => {
    setWorkerExportSelectedKeys(current =>
      current.includes(key) ? current.filter(item => item !== key) : [...current, key],
    );
  };

  const selectAllFilteredWorkers = () => {
    setWorkerExportSelectedKeys(current =>
      Array.from(new Set([...current.filter(key => !workerExportVisibleKeys.has(key)), ...filteredWorkerMasterRecords.map(worker => worker.key)])),
    );
  };

  const clearWorkerExportSelection = () => setWorkerExportSelectedKeys([]);

  const exportWorkers = async (format: "excel" | "pdf") => {
    if (!workerExportRows.length) {
      setToast?.({ message: "No hay trabajadores dentro de los filtros actuales para exportar.", type: "error" });
      return;
    }
    setWorkerExportBusy(format);
    try {
      if (format === "excel") await downloadWorkerMasterExcel(workerExportRows);
      else await downloadWorkerMasterPdf(workerExportRows, supervisorName);
      setToast?.({
        message: `${workerExportRows.length} trabajador${workerExportRows.length === 1 ? "" : "es"} exportado${workerExportRows.length === 1 ? "" : "s"} en ${format === "excel" ? "Excel" : "PDF"}.`,
        type: "success",
      });
    } catch (error: any) {
      console.error("[worker-master-export]", error);
      setToast?.({
        message: error?.message || `No se pudo generar la exportación ${format === "excel" ? "Excel" : "PDF"}.`,
        type: "error",
      });
    } finally {
      setWorkerExportBusy("");
    }
  };

  const bankAccountCatalog = useMemo(() => {
    const rows = new Map<string, string[]>();
    people.forEach((person) => {
      const normalized = String(person.iban || "").replace(/\s+/g, "").toUpperCase();
      if (!normalized) return;
      const names = rows.get(normalized) || [];
      if (person.apellidosNombre && !names.includes(person.apellidosNombre)) names.push(person.apellidosNombre);
      rows.set(normalized, names);
    });
    return Array.from(rows.entries())
      .map(([value, names]) => {
        const masked = value.length > 8
          ? value.slice(0, 4) + " •••• •••• •••• " + value.slice(-4)
          : "•••• " + value.slice(-4);
        return masked + (names.length ? " · " + names.join(" · ") : "");
      })
      .sort((a, b) => a.localeCompare(b, "es"));
  }, [people]);

  const socialSecurityCatalog = useMemo(() => {
    const rows = new Map<string, string[]>();
    people.forEach((person) => {
      const normalized = String(person.numeroSeguridadSocial || "").replace(/[^0-9]/g, "");
      if (!normalized) return;
      const names = rows.get(normalized) || [];
      if (person.apellidosNombre && !names.includes(person.apellidosNombre)) names.push(person.apellidosNombre);
      rows.set(normalized, names);
    });
    return Array.from(rows.entries())
      .map(([value, names]) => {
        const masked = value.length > 4 ? "••••••••" + value.slice(-4) : value;
        return masked + (names.length ? " · " + names.join(" · ") : "");
      })
      .sort((a, b) => a.localeCompare(b, "es"));
  }, [people]);

  const isReadOnlyAdministrativeCatalog = false;

  const tabs = [
    {
      id: "obras",
      label: "Obras",
      icon: Building2,
      list: savedObras,
      setter: setSavedObras,
    },
    {
      id: "lugares",
      label: "Lugares Formación",
      icon: GraduationCap,
      list: savedLugares,
      setter: setSavedLugares,
    },
    {
      id: "sitios",
      label: "Sitios Reconocimiento",
      icon: Stethoscope,
      list: savedSitios,
      setter: setSavedSitios,
    },
    {
      id: "trabajadores",
      label: "Trabajadores",
      icon: Users,
      list: workerMasterRecords.map(worker => worker.apellidosNombre || worker.dni),
      setter: setSavedTelefonos,
    },
    {
      id: "categorias",
      label: "Categorías",
      icon: Briefcase,
      list: savedCategorias,
      setter: setSavedCategorias,
    },
  ] as const;

  const currentTab = tabs.find((t) => t.id === activeTab);

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTab) return;
    const trimmed = newItem.trim();
    if (!trimmed) return;

    if (
      currentTab.list.some(
        (item) => item.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return;
    }

    currentTab.setter((prev) =>
      [...prev, trimmed].sort((a, b) => a.localeCompare(b)),
    );
    setNewItem("");
  };

  const handleDeleteItem = async (itemToDelete: string) => {
    if (!currentTab) return;
    if (activeTab === "obras") {
      const master = obrasMaestras.find((item) => item.nombre === itemToDelete);
      if (master?.id) await deleteDocument("obras", master.id);
      setObrasMaestras((prev) => prev.filter((item) => item.id !== master?.id));
    }
    currentTab.setter((prev) => prev.filter((item) => item !== itemToDelete));
    if (activeTab === "obras") {
      deleteStoredObraRecursoPreventivo(itemToDelete);
      setObrasRecursos(getStoredObrasRecursosPreventivos());
    }
    setDeletingItem(null);
  };

  const handleAddObraWithRecurso = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedObra = newItem.trim();
    const trimmedRecurso = newObraRecurso.trim();
    if (!trimmedObra) {
      if (setToast)
        setToast({
          message: "Introduzca el nombre de la obra.",
          type: "error",
        });
      return;
    }
    if (!trimmedRecurso) {
      if (setToast)
        setToast({
          message: "El campo Recurso Preventivo es obligatorio.",
          type: "error",
        });
      return;
    }
    if (savedObras.some((o) => o.toLowerCase() === trimmedObra.toLowerCase())) {
      if (setToast)
        setToast({
          message: "Ya existe una obra registrada con ese nombre.",
          type: "error",
        });
      return;
    }

    const id = crypto.randomUUID();
    await createDocument("obras", id, {
      nombre: trimmedObra,
      municipio: newObraMunicipio.trim(),
      recursoPreventivo: trimmedRecurso,
      recursoPreventivoCategoria: newObraCategoria,
    });
    setObrasMaestras((prev) => [
      ...prev,
      {
        id,
        nombre: trimmedObra,
        municipio: newObraMunicipio.trim(),
        recursoPreventivo: trimmedRecurso,
        recursoPreventivoCategoria: newObraCategoria,
      },
    ]);
    setSavedObras((prev) =>
      [...prev, trimmedObra].sort((a, b) => a.localeCompare(b)),
    );
    saveStoredObraRecursoPreventivo(
      trimmedObra,
      trimmedRecurso,
      newObraCategoria,
      newObraTelefono,
    );
    setObrasRecursos(getStoredObrasRecursosPreventivos());
    setNewItem("");
    setNewObraRecurso("");
    setNewObraTelefono("");
    setNewObraMunicipio("");
    setNewObraCategoria("Encargado de Obra");
    if (setToast) {
      setToast({
        message: `Obra "${trimmedObra}" añadida con recurso preventivo "${trimmedRecurso}".`,
        type: "success",
      });
    }
  };

  const handleSaveEditObraRecurso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingObraRecurso) return;
    const { obra, nombre, recurso, categoria, telefono } = editingObraRecurso;
    const trimmedNombre = nombre.trim();
    if (!trimmedNombre) {
      if (setToast)
        setToast({
          message: "El nombre de la obra no puede estar vacío.",
          type: "error",
        });
      return;
    }
    if (!recurso.trim()) {
      if (setToast)
        setToast({
          message: "El nombre del Recurso Preventivo no puede estar vacío.",
          type: "error",
        });
      return;
    }
    if (
      trimmedNombre.toLowerCase() !== obra.toLowerCase() &&
      savedObras.some((o) => o.toLowerCase() === trimmedNombre.toLowerCase())
    ) {
      if (setToast)
        setToast({
          message: "Ya existe otra obra registrada con ese nombre.",
          type: "error",
        });
      return;
    }

    const master = editingObraRecurso.id
      ? obrasMaestras.find((item) => item.id === editingObraRecurso.id)
      : obrasMaestras.find((item) => item.nombre === obra);
    if (!master?.id) {
      if (setToast)
        setToast({
          message: "No se ha encontrado la obra maestra en Supabase.",
          type: "error",
        });
      return;
    }
    await updateDocument("obras", master.id, {
      nombre: trimmedNombre,
      municipio: editingObraRecurso.municipio.trim(),
      recursoPreventivo: recurso.trim(),
      recursoPreventivoCategoria: categoria.trim(),
    });
    setObrasMaestras((prev) =>
      prev.map((item) =>
        item.id === master.id
          ? {
              ...item,
              nombre: trimmedNombre,
              municipio: editingObraRecurso.municipio.trim(),
              recursoPreventivo: recurso.trim(),
              recursoPreventivoCategoria: categoria.trim(),
            }
          : item,
      ),
    );
    if (trimmedNombre !== obra) {
      setSavedObras((prev) =>
        prev
          .map((item) => (item === obra ? trimmedNombre : item))
          .sort((a, b) => a.localeCompare(b)),
      );
      deleteStoredObraRecursoPreventivo(obra);
    }
    saveStoredObraRecursoPreventivo(
      trimmedNombre,
      recurso.trim(),
      categoria.trim(),
      telefono.trim(),
    );
    setObrasRecursos(getStoredObrasRecursosPreventivos());
    setEditingObraRecurso(null);
    if (setToast) {
      setToast({
        message: `Obra "${trimmedNombre}" actualizada correctamente.`,
        type: "success",
      });
    }
  };

  const handleToggleSelectAll = () => {
    const allFilteredSelected = filteredList.every((item) =>
      selectedItems.includes(item),
    );
    if (allFilteredSelected) {
      // Deselect all filtered items
      setSelectedItems((prev) =>
        prev.filter((item) => !filteredList.includes(item)),
      );
    } else {
      // Select all filtered items
      setSelectedItems((prev) => {
        const union = [...prev];
        filteredList.forEach((item) => {
          if (!union.includes(item)) {
            union.push(item);
          }
        });
        return union;
      });
    }
  };

  const handleBulkDelete = async () => {
    if (!currentTab) return;
    if (activeTab === "obras") {
      const selectedWorks = obrasMaestras.filter((item) =>
        selectedItems.includes(item.nombre),
      );
      await Promise.all(
        selectedWorks.map((item) => deleteDocument("obras", item.id)),
      );
      setObrasMaestras((prev) =>
        prev.filter((item) => !selectedItems.includes(item.nombre)),
      );
    }
    currentTab.setter((prev) =>
      prev.filter((item) => !selectedItems.includes(item)),
    );
    if (activeTab === "obras") {
      selectedItems.forEach((item) => deleteStoredObraRecursoPreventivo(item));
      setObrasRecursos(getStoredObrasRecursosPreventivos());
    }
    if (setToast) {
      setToast({
        message: `Se han eliminado ${selectedItems.length} elementos de la lista de ${currentTab.label.toLowerCase()}`,
        type: "success",
      });
    }
    setSelectedItems([]);
    setShowBulkConfirm(false);
  };

  const filteredList = currentTab
    ? currentTab.list.filter((item) =>
        item.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : [];

  const renderContactPanel = (
    title: string,
    description: string,
    form: any,
    setForm: React.Dispatch<React.SetStateAction<any>>,
    settingsKey: "administrative" | "medicalProvider" | "footwearProvider",
    options: { empresa?: boolean; numeroTrabajador?: boolean } = {},
  ) => {
    const fields = [
      ...(options.empresa ? [["empresa", "Empresa", "Nombre de la empresa", "text"]] : []),
      ["nombreApellidos", "Nombre y apellidos del contacto responsable", "Nombre completo", "text"],
      ["telefono", "Teléfono de contacto", "Ej: 600 123 456", "tel"],
      ["email", "Correo electrónico", "correo@empresa.es", "email"],
      ...(options.numeroTrabajador ? [["numeroTrabajador", "Nº de trabajador / empleado", "Opcional", "text"]] : []),
    ];
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in duration-300">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <h2 className="text-xl font-black text-slate-900 dark:text-white">{title}</h2>
          <p className="text-sm text-slate-700 dark:text-slate-200 mt-2 max-w-2xl">{description}</p>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {fields.map(([key, label, placeholder, type]) => (
              <label key={key} className="space-y-2">
                <span className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">{label}</span>
                <input
                  type={type}
                  value={String(form[key] || "")}
                  onChange={(event) => setForm((previous: any) => ({ ...previous, [key]: event.target.value }))}
                  placeholder={placeholder}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00548E]/30"
                />
              </label>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#00548E] dark:text-sky-300">Previsualización</p>
            {options.empresa && <p className="mt-2 text-sm font-black text-slate-900 dark:text-white">{form.empresa || "Empresa pendiente"}</p>}
            <p className="mt-1 text-base font-black text-slate-900 dark:text-white">{form.nombreApellidos || "Contacto responsable"}</p>
            {form.telefono && <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tel.: {form.telefono}</p>}
            {form.email && <p className="text-sm text-slate-700 dark:text-slate-200">{form.email}</p>}
            {form.numeroTrabajador && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Nº trabajador: {form.numeroTrabajador}</p>}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!contactsLoaded}
              onClick={async () => {
                if (!String(form.nombreApellidos || "").trim()) {
                  setToast?.({ message: "Indica el nombre y apellidos del contacto responsable.", type: "error" });
                  return;
                }
                if (!String(form.email || "").trim()) {
                  setToast?.({ message: "Indica el correo electrónico del contacto.", type: "error" });
                  return;
                }
                try {
                  await saveAppBusinessSettings({ [settingsKey]: form } as any);
                  window.dispatchEvent(new CustomEvent("profea:contact-settings-updated", { detail: { settingsKey } }));
                  setToast?.({ message: `${title} guardado correctamente.`, type: "success" });
                } catch (error) {
                  console.error("No se pudieron guardar los datos de contacto:", error);
                  setToast?.({ message: "No se pudieron guardar los datos de contacto.", type: "error" });
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#003f6b] transition-colors disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              Guardar datos
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        eyebrow="Sistema"
        title="Configuración"
        description="Catálogos, jornada laboral, recursos de obra y copias de seguridad de PROFEA."
        icon={<Settings className="w-5 h-5" />}
        className="mb-8"
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1 space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchTerm("");
                setNewItem("");
                setDeletingItem(null);
                setSelectedItems([]);
                setShowBulkConfirm(false);
              }}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold
                ${
                  activeTab === tab.id
                    ? "profea-sidebar-item--active text-white"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
                }
              `}
            >
              <tab.icon
                className={`w-5 h-5 ${activeTab === tab.id ? "text-white" : "text-slate-400 dark:text-slate-500"}`}
              />
              {tab.label}
              <span
                className={`ml-auto px-2 py-0.5 rounded-full text-[10px] ${activeTab === tab.id ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"}`}
              >
                {tab.list.length}
              </span>
            </button>
          ))}

          <div className="border-t border-slate-200 dark:border-slate-800 my-4 pt-4"></div>

          <button
            onClick={() => {
              setActiveTab("supervisor");
              setSearchTerm("");
              setNewItem("");
              setDeletingItem(null);
              setSelectedItems([]);
              setShowBulkConfirm(false);
            }}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold
              ${activeTab === "supervisor"
                ? "profea-sidebar-item--active text-white"
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"}
            `}
          >
            <UserCheck className={`w-5 h-5 ${activeTab === "supervisor" ? "text-white" : "text-slate-400 dark:text-slate-500"}`} />
            Supervisor responsable
          </button>

          <button
            onClick={() => {
              setActiveTab("technician");
              setSearchTerm("");
              setNewItem("");
              setDeletingItem(null);
              setSelectedItems([]);
              setShowBulkConfirm(false);
            }}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold
              ${activeTab === "technician"
                ? "profea-sidebar-item--active text-white"
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"}
            `}
          >
            <Briefcase className={`w-5 h-5 ${activeTab === "technician" ? "text-white" : "text-slate-400 dark:text-slate-500"}`} />
            Técnico responsable
          </button>

          {[
            ["administrative", "Administrativo/a", Users],
            ["medicalProvider", "Empresa reconocimientos médicos", Stethoscope],
            ["footwearProvider", "Proveedor de calzado", Building2],
            ["trainingProvider", "Empresa de formación", GraduationCap],
          ].map(([id, label, Icon]: any) => (
            <button
              key={id}
              onClick={() => {
                setActiveTab(id);
                setSearchTerm("");
                setNewItem("");
                setDeletingItem(null);
                setSelectedItems([]);
                setShowBulkConfirm(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold ${
                activeTab === id
                  ? "profea-sidebar-item--active text-white"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700"
              }`}
            >
              <Icon className={`w-5 h-5 ${activeTab === id ? "text-white" : "text-slate-500 dark:text-slate-300"}`} />
              <span className="text-left leading-tight">{label}</span>
            </button>
          ))}

          <button
            onClick={() => {
              setActiveTab("horario");
              setSearchTerm("");
              setNewItem("");
              setDeletingItem(null);
              setSelectedItems([]);
              setShowBulkConfirm(false);
            }}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold
              ${
                activeTab === "horario"
                  ? "profea-sidebar-item--active text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
              }
            `}
          >
            <Clock
              className={`w-5 h-5 ${activeTab === "horario" ? "text-white" : "text-slate-400 dark:text-slate-500"}`}
            />
            Horario de jornal
          </button>

          <button
            onClick={() => {
              setActiveTab("backup");
              setSearchTerm("");
              setNewItem("");
              setDeletingItem(null);
              setSelectedItems([]);
              setShowBulkConfirm(false);
            }}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold
              ${
                activeTab === "backup"
                  ? "profea-sidebar-item--active text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
              }
            `}
          >
            <Database
              className={`w-5 h-5 ${activeTab === "backup" ? "text-white" : "text-slate-400 dark:text-slate-500"}`}
            />
            Copia de Seguridad
          </button>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          {activeTab === "trabajadores" ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Users className="w-6 h-6 text-[#00548E] dark:text-blue-400" />
                  Ficha maestra de trabajadores
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-3xl">
                  Una persona mantiene una sola identidad. Aquí se consolidan sus datos personales permanentes; obra, categoría, periodos, SAE y aptitud médica siguen perteneciendo a cada contratación o historial.
                </p>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_180px_220px] gap-3 mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Buscar por nombre, DNI/NIE, teléfono, Seguridad Social, IBAN o talla..."
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00548E]/30"
                    />
                  </div>

                  <select
                    value={workerExportYear}
                    onChange={(e) => setWorkerExportYear(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100"
                    title="Filtrar por año de la última contratación registrada"
                  >
                    <option value="all">Todos los años</option>
                    {workerExportYears.map(year => <option key={year} value={year}>Última contratación {year}</option>)}
                  </select>

                  <select
                    value={workerExportDataFilter}
                    onChange={(e) => setWorkerExportDataFilter(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100"
                    title="Filtrar según los datos personales disponibles"
                  >
                    <option value="all">Todos los datos</option>
                    <option value="complete">Ficha personal completa</option>
                    <option value="incomplete">Ficha personal incompleta</option>
                    <option value="missing-phone">Sin teléfono</option>
                    <option value="missing-nuss">Sin Seguridad Social</option>
                    <option value="missing-iban">Sin cuenta bancaria</option>
                  </select>
                </div>

                <div className="mb-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 p-4">
                  <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-800 dark:text-slate-100">
                        {filteredWorkerMasterRecords.length} visibles · {workerExportSelectedVisible.length} seleccionados
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Si seleccionas trabajadores, se exportarán solo los seleccionados dentro de los filtros actuales. Si no seleccionas ninguno, se exportarán todos los visibles.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={selectAllFilteredWorkers}
                        disabled={!filteredWorkerMasterRecords.length}
                        className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold disabled:opacity-50"
                      >
                        Seleccionar filtrados
                      </button>
                      <button
                        type="button"
                        onClick={clearWorkerExportSelection}
                        disabled={!workerExportSelectedKeys.length}
                        className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold disabled:opacity-50"
                      >
                        Limpiar selección
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportWorkers("excel")}
                        disabled={!workerExportRows.length || Boolean(workerExportBusy)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black inline-flex items-center gap-2 disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" />
                        {workerExportBusy === "excel" ? "Generando…" : "Exportar Excel"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportWorkers("pdf")}
                        disabled={!workerExportRows.length || Boolean(workerExportBusy)}
                        className="px-4 py-2 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white text-xs font-black inline-flex items-center gap-2 disabled:opacity-50"
                      >
                        <FileText className="w-4 h-4" />
                        {workerExportBusy === "pdf" ? "Generando…" : "Exportar PDF"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 text-[10px] text-amber-700 dark:text-amber-300">
                    Las exportaciones incluyen los datos personales completos, incluido Nº de Seguridad Social e IBAN. Utilícelas únicamente para la gestión administrativa autorizada.
                  </div>
                </div>

                <div className="mb-5 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-4">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{workerMasterRecords.length} personas únicas memorizadas</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Los datos proceden del Directorio existente. No se crea una segunda base duplicada: al volver a contratar a una persona, GestionProfea recupera estos datos y solo pide los datos de la nueva contratación.
                  </p>
                </div>

                <div className="space-y-3 max-h-[650px] overflow-y-auto pr-1">
                  {filteredWorkerMasterRecords.map((worker) => (
                    <div key={worker.key} className={`rounded-2xl border p-4 transition-colors ${workerExportSelectedKeys.includes(worker.key) ? "border-[#00548E] bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/20" : "border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30"}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={workerExportSelectedKeys.includes(worker.key)}
                            onChange={() => toggleWorkerExportSelection(worker.key)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-[#00548E] shrink-0"
                            aria-label={`Seleccionar ${worker.apellidosNombre || worker.dni || "trabajador"} para exportar`}
                          />
                          <div className="min-w-0">
                          <p className="font-black text-slate-900 dark:text-white">{worker.apellidosNombre || "Trabajador sin nombre"}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">DNI/NIE: <span className="font-bold text-slate-700 dark:text-slate-200">{worker.dni || "-"}</span></p>
                          </div>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-[11px] font-bold text-[#00548E] dark:text-blue-300">{worker.contratos} contratación{worker.contratos === 1 ? "" : "es"}</p>
                          {worker.ultimaContratacion && <p className="text-[10px] text-slate-400">Última: {worker.ultimaContratacion.split("-").reverse().join("/")}</p>}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mt-4 text-xs">
                        <p><span className="text-slate-400">Fecha nacimiento:</span> <strong className="text-slate-700 dark:text-slate-200">{worker.fechaNacimiento ? worker.fechaNacimiento.split("-").reverse().join("/") : "-"}</strong></p>
                        <p><span className="text-slate-400">Teléfono:</span> <strong className="text-slate-700 dark:text-slate-200">{worker.telefono || "-"}</strong></p>
                        <p><span className="text-slate-400">Talla calzado:</span> <strong className="text-slate-700 dark:text-slate-200">{worker.calzado || "-"}</strong></p>
                        <p><span className="text-slate-400">Seguridad Social:</span> <strong className="text-slate-700 dark:text-slate-200">{maskWorkerNuss(worker.numeroSeguridadSocial)}</strong></p>
                        <p className="sm:col-span-2"><span className="text-slate-400">Cuenta bancaria:</span> <strong className="text-slate-700 dark:text-slate-200">{maskWorkerIban(worker.iban)}</strong></p>
                      </div>
                    </div>
                  ))}
                  {filteredWorkerMasterRecords.length === 0 && (
                    <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No se han encontrado trabajadores con ese criterio.</div>
                  )}
                </div>

                <p className="mt-5 text-[11px] text-slate-400">
                  Por seguridad, la cuenta bancaria y el número de Seguridad Social se muestran parcialmente ocultos en este listado. La edición completa sigue realizándose desde la ficha del trabajador en el Directorio.
                </p>
              </div>
            </div>
          ) : activeTab === "supervisor" ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <UserCheck className="w-6 h-6 text-[#00548E] dark:text-blue-400" />
                  Datos del supervisor responsable
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-2xl">
                  Estos datos serán la referencia común del supervisor en citaciones, informes y pantallas de GestionProfea.
                </p>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {[
                    ["nombreApellidos", "Nombre y apellidos", "Ej: David Hinojo García", "text"],
                    ["telefono", "Teléfono", "Ej: 600 123 456", "tel"],
                    ["zona", "Zona / ámbito territorial", "Ej: Sierra de Cádiz", "text"],
                    ["cargo", "Cargo / puesto", "Ej: Supervisor PROFEA", "text"],
                    ["email", "Correo electrónico profesional", "correo@dipucadiz.es", "email"],
                    ["identificacionInterna", "Nº empleado / identificación interna", "Opcional", "text"],
                  ].map(([key, label, placeholder, type]) => (
                    <label key={key} className="space-y-2">
                      <span className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">{label}</span>
                      <input
                        type={type}
                        value={String((supervisorForm as any)[key] || "")}
                        onChange={(e) => setSupervisorForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00548E]/30"
                      />
                    </label>
                  ))}
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supervisorForm.usarPorDefecto}
                    onChange={(e) => setSupervisorForm((prev) => ({ ...prev, usarPorDefecto: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#00548E]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">Usar como supervisor responsable por defecto</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">El nombre, teléfono, zona, cargo y correo se reutilizarán automáticamente en los apartados e informes que necesiten identificar al supervisor.</span>
                  </span>
                </label>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#00548E] dark:text-blue-300">Previsualización</p>
                  <p className="mt-2 text-base font-black text-slate-900 dark:text-white">{supervisorForm.nombreApellidos || "Supervisor responsable"}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{supervisorForm.cargo || "Supervisor PROFEA"}</p>
                  {supervisorForm.zona && <p className="text-sm text-slate-600 dark:text-slate-300">Zona: {supervisorForm.zona}</p>}
                  {supervisorForm.telefono && <p className="text-sm text-slate-600 dark:text-slate-300">Tel.: {supervisorForm.telefono}</p>}
                  {supervisorForm.email && <p className="text-sm text-slate-600 dark:text-slate-300">{supervisorForm.email}</p>}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!supervisorLoaded}
                    onClick={async () => {
                      if (!supervisorForm.nombreApellidos.trim()) {
                        setToast?.({ message: "Indica el nombre y apellidos del supervisor.", type: "error" });
                        return;
                      }
                      try {
                        await saveAppBusinessSettings({ supervisor: supervisorForm });
                        window.dispatchEvent(new CustomEvent("profea:supervisor-settings-updated"));
                        setToast?.({ message: "Datos del supervisor guardados y disponibles para toda la aplicación.", type: "success" });
                      } catch (error) {
                        console.error("No se pudieron guardar los datos del supervisor:", error);
                        setToast?.({ message: "No se pudieron guardar los datos del supervisor.", type: "error" });
                      }
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#00436f] transition-colors disabled:opacity-60"
                  >
                    <Save className="w-4 h-4" />
                    Guardar supervisor
                  </button>
                </div>
              </div>
            </div>
          ) : activeTab === "technician" ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Briefcase className="w-6 h-6 text-[#00548E] dark:text-blue-400" />
                  Datos del técnico responsable
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-2xl">
                  Se utilizarán automáticamente en los informes y campos donde corresponda identificar al técnico responsable.
                </p>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {[
                    ["nombreApellidos", "Nombre y apellidos", "Nombre completo", "text"],
                    ["telefono", "Teléfono", "Ej: 600 123 456", "tel"],
                    ["zona", "Zona / ámbito territorial", "Ej: Sierra de Cádiz", "text"],
                    ["cargo", "Cargo / puesto", "Ej: Técnico responsable", "text"],
                    ["email", "Correo electrónico profesional", "correo@dipucadiz.es", "email"],
                    ["numeroTrabajador", "Nº de trabajador / empleado", "Opcional", "text"],
                    ["titulacion", "Titulación / especialidad", "Ej: Arquitecto técnico / Ingeniero técnico", "text"],
                  ].map(([key, label, placeholder, type]) => (
                    <label key={key} className="space-y-2">
                      <span className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">{label}</span>
                      <input
                        type={type}
                        value={String((technicianForm as any)[key] || "")}
                        onChange={(e) => setTechnicianForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00548E]/30"
                      />
                    </label>
                  ))}
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={technicianForm.usarPorDefecto}
                    onChange={(e) => setTechnicianForm((prev) => ({ ...prev, usarPorDefecto: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#00548E]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">Usar como técnico responsable por defecto</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">Los datos se reutilizarán automáticamente en los informes y apartados que tengan un campo de técnico responsable.</span>
                  </span>
                </label>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#00548E] dark:text-blue-300">Previsualización</p>
                  <p className="mt-2 text-base font-black text-slate-900 dark:text-white">{technicianForm.nombreApellidos || "Técnico responsable"}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{technicianForm.cargo || "Técnico responsable"}</p>
                  {technicianForm.titulacion && <p className="text-sm text-slate-600 dark:text-slate-300">{technicianForm.titulacion}</p>}
                  {technicianForm.zona && <p className="text-sm text-slate-600 dark:text-slate-300">Zona: {technicianForm.zona}</p>}
                  {technicianForm.telefono && <p className="text-sm text-slate-600 dark:text-slate-300">Tel.: {technicianForm.telefono}</p>}
                  {technicianForm.email && <p className="text-sm text-slate-600 dark:text-slate-300">{technicianForm.email}</p>}
                  {technicianForm.numeroTrabajador && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Nº trabajador: {technicianForm.numeroTrabajador}</p>}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!technicianLoaded}
                    onClick={async () => {
                      if (!technicianForm.nombreApellidos.trim()) {
                        setToast?.({ message: "Indica el nombre y apellidos del técnico responsable.", type: "error" });
                        return;
                      }
                      try {
                        await saveAppBusinessSettings({ technician: technicianForm });
                        window.dispatchEvent(new CustomEvent("profea:technician-settings-updated"));
                        setToast?.({ message: "Datos del técnico guardados y disponibles para los informes.", type: "success" });
                      } catch (error) {
                        console.error("No se pudieron guardar los datos del técnico:", error);
                        setToast?.({ message: "No se pudieron guardar los datos del técnico.", type: "error" });
                      }
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#00436f] transition-colors disabled:opacity-60"
                  >
                    <Save className="w-4 h-4" />
                    Guardar técnico
                  </button>
                </div>
              </div>
            </div>
          ) : activeTab === "administrative" ? (
            renderContactPanel(
              "Datos del administrativo/a",
              "Se utilizarán como destinatario de la relación administrativa de trabajadores y en las comunicaciones que correspondan.",
              administrativeForm,
              setAdministrativeForm,
              "administrative",
              { numeroTrabajador: true },
            )
          ) : activeTab === "medicalProvider" ? (
            renderContactPanel(
              "Empresa de reconocimientos médicos",
              "Contacto responsable para el envío de la relación de citas y documentación vinculada a reconocimientos médicos.",
              medicalProviderForm,
              setMedicalProviderForm,
              "medicalProvider",
              { empresa: true },
            )
          ) : activeTab === "footwearProvider" ? (
            renderContactPanel(
              "Proveedor de calzado",
              "Contacto responsable que recibirá la relación de tallas y necesidades de calzado.",
              footwearProviderForm,
              setFootwearProviderForm,
              "footwearProvider",
              { empresa: true },
            )
          ) : activeTab === "trainingProvider" ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">Empresas de formación</h2>
                    <p className="text-sm text-slate-700 dark:text-slate-200 mt-2 max-w-2xl">
                      Puedes guardar varias empresas. La marcada como activa será la destinataria automática del correo de Formación PRL en Acciones informativas rápidas.
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-1 text-xs font-black text-[#00548E] dark:text-blue-200">
                    {trainingProviders.length} {trainingProviders.length === 1 ? "empresa" : "empresas"}
                  </span>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  {trainingProviders.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-600 dark:text-slate-300">
                      No hay empresas de formación guardadas. Añade la primera debajo.
                    </div>
                  ) : trainingProviders.map((provider) => {
                    const active = provider.id === activeTrainingProviderId;
                    return (
                      <div
                        key={provider.id}
                        className={`rounded-2xl border p-4 transition-all ${active
                          ? "border-emerald-400 bg-emerald-50/70 dark:border-emerald-700 dark:bg-emerald-950/20 ring-2 ring-emerald-500/10"
                          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/40"}`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-black text-slate-900 dark:text-white">{provider.empresa || "Empresa sin nombre"}</p>
                              {active && (
                                <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                                  Activa para envíos
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{provider.nombreApellidos || "Sin contacto responsable"}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                              {provider.email || "Sin correo"}{provider.telefono ? ` · ${provider.telefono}` : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!active && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await saveAppBusinessSettings({
                                      trainingProviders,
                                      activeTrainingProviderId: provider.id,
                                    });
                                    setActiveTrainingProviderId(provider.id);
                                    window.dispatchEvent(new CustomEvent("profea:contact-settings-updated", { detail: { settingsKey: "trainingProvider" } }));
                                    setToast?.({ message: `${provider.empresa || "Empresa"} activada para los envíos de formación.`, type: "success" });
                                  } catch (error) {
                                    console.error("No se pudo activar la empresa de formación:", error);
                                    setToast?.({ message: "No se pudo activar la empresa de formación.", type: "error" });
                                  }
                                }}
                                className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                              >
                                Activar para envíos
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setTrainingProviderDraft({
                                empresa: provider.empresa,
                                nombreApellidos: provider.nombreApellidos,
                                telefono: provider.telefono,
                                email: provider.email,
                              })}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title="Copia los datos al formulario para crear una variante o modificarlos antes de guardar"
                            >
                              Editar / duplicar
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`¿Eliminar ${provider.empresa || "esta empresa de formación"}?`)) return;
                                const next = trainingProviders.filter(item => item.id !== provider.id);
                                const nextActive = active ? (next[0]?.id || "") : activeTrainingProviderId;
                                try {
                                  await saveAppBusinessSettings({
                                    trainingProviders: next,
                                    activeTrainingProviderId: nextActive,
                                  });
                                  setTrainingProviders(next);
                                  setActiveTrainingProviderId(nextActive);
                                  window.dispatchEvent(new CustomEvent("profea:contact-settings-updated", { detail: { settingsKey: "trainingProvider" } }));
                                  setToast?.({ message: "Empresa de formación eliminada.", type: "success" });
                                } catch (error) {
                                  console.error("No se pudo eliminar la empresa de formación:", error);
                                  setToast?.({ message: "No se pudo eliminar la empresa de formación.", type: "error" });
                                }
                              }}
                              className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Plus className="w-5 h-5 text-[#00548E] dark:text-blue-300" />
                    <h3 className="font-black text-slate-900 dark:text-white">Añadir empresa de formación</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      ["empresa", "Empresa", "Nombre de la empresa", "text"],
                      ["nombreApellidos", "Contacto responsable", "Nombre y apellidos", "text"],
                      ["telefono", "Teléfono", "Ej: 600 123 456", "tel"],
                      ["email", "Correo electrónico", "correo@empresa.es", "email"],
                    ].map(([key, label, placeholder, type]) => (
                      <label key={key} className="space-y-2">
                        <span className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">{label}</span>
                        <input
                          type={type}
                          value={String((trainingProviderDraft as any)[key] || "")}
                          onChange={(event) => setTrainingProviderDraft(previous => ({ ...previous, [key]: event.target.value }))}
                          placeholder={placeholder}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00548E]/30"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setTrainingProviderDraft({ ...DEFAULT_TRAINING_PROVIDER_SETTINGS })}
                      className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-black text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      disabled={!contactsLoaded}
                      onClick={async () => {
                        const empresa = trainingProviderDraft.empresa.trim();
                        const nombreApellidos = trainingProviderDraft.nombreApellidos.trim();
                        const email = trainingProviderDraft.email.trim();
                        if (!empresa || !nombreApellidos || !email) {
                          setToast?.({ message: "Indica empresa, contacto responsable y correo electrónico.", type: "error" });
                          return;
                        }
                        const id = `training-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                        const added: TrainingProviderEntry = {
                          id,
                          empresa,
                          nombreApellidos,
                          telefono: trainingProviderDraft.telefono.trim(),
                          email,
                        };
                        const next = [...trainingProviders, added];
                        const nextActive = activeTrainingProviderId || id;
                        try {
                          await saveAppBusinessSettings({
                            trainingProviders: next,
                            activeTrainingProviderId: nextActive,
                          });
                          setTrainingProviders(next);
                          setActiveTrainingProviderId(nextActive);
                          setTrainingProviderDraft({ ...DEFAULT_TRAINING_PROVIDER_SETTINGS });
                          window.dispatchEvent(new CustomEvent("profea:contact-settings-updated", { detail: { settingsKey: "trainingProvider" } }));
                          setToast?.({
                            message: `${empresa} guardada${nextActive === id ? " y activada para los envíos." : "."}`,
                            type: "success",
                          });
                        } catch (error) {
                          console.error("No se pudo guardar la empresa de formación:", error);
                          setToast?.({ message: "No se pudo guardar la empresa de formación.", type: "error" });
                        }
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-2.5 text-xs font-black text-white hover:bg-[#003f6b] disabled:opacity-60"
                    >
                      <Plus className="w-4 h-4" />
                      Añadir empresa
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === "horario" ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Clock className="w-6 h-6 text-[#00548E] dark:text-blue-400" />
                  Horario de jornal
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-2xl">
                  Define la hora oficial de entrada y salida. Los informes y documentos que hagan referencia al horario de trabajo utilizarán estos valores.
                </p>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <label className="space-y-2">
                    <span className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">Hora de entrada</span>
                    <input
                      type="time"
                      value={workStartHour}
                      onChange={(e) => setWorkStartHour(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 text-base font-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00548E]/30"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">Hora de salida</span>
                    <input
                      type="time"
                      value={workEndHour}
                      onChange={(e) => setWorkEndHour(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3 text-base font-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00548E]/30"
                    />
                  </label>
                </div>
                <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-4">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Jornada configurada: {workStartHour || "--:--"} – {workEndHour || "--:--"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Esta configuración se guarda para tu cuenta y se incluye en las copias de seguridad.
                  </p>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!workStartHour || !workEndHour) {
                        setToast?.({ message: "Indica la hora de entrada y la hora de salida.", type: "error" });
                        return;
                      }
                      if (workEndHour <= workStartHour) {
                        setToast?.({ message: "La hora de salida debe ser posterior a la hora de entrada.", type: "error" });
                        return;
                      }
                      try {
                        await saveAppBusinessSettings({ workStartHour, workEndHour });
                        setToast?.({ message: `Horario de jornal guardado: ${workStartHour} – ${workEndHour}`, type: "success" });
                      } catch (error) {
                        console.error("No se pudo guardar el horario de jornal:", error);
                        setToast?.({ message: "No se pudo guardar el horario de jornal.", type: "error" });
                      }
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#00436f] transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    Guardar horario
                  </button>
                </div>
              </div>
            </div>
          ) : activeTab === "backup" ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 font-bold">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Database className="w-6 h-6 text-brand-primary animate-pulse" />
                  Copia de Seguridad Completa
                </h2>
                {onImportWorkers && (
                  <div className="mt-5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Importación de trabajadores</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Importa un listado de trabajadores desde Excel, CSV, JSON o PDF.</p>
                    </div>
                    <input
                      ref={workerImportInputRef}
                      type="file"
                      className="hidden"
                      accept=".xlsx,.xls,.csv,.json,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onImportWorkers(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => workerImportInputRef.current?.click()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-bold text-blue-700 dark:text-blue-300 shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      Importación de trabajadores
                    </button>
                  </div>
                )}
                <div className="mt-5 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div><p className="text-sm font-bold text-slate-800 dark:text-slate-100">Instalación de PROFEA</p><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Instala PROFEA como aplicación o acceso directo con el icono oficial de Diputación de Cádiz. El sistema detectará tu dispositivo y navegador.</p></div>
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('profea:open-install'))} className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-bold text-sky-700 dark:text-sky-300 shadow-sm hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"><Download className="w-4 h-4"/>Instalar PROFEA</button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  Respalde toda la base de datos local de trabajadores activos,
                  el histórico completo de la papelera y la configuración.
                </p>
              </div>

              <div className="p-6 space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                      Trabajadores Activos
                    </span>
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-100 block mt-1">
                      {people.length}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                      En el directorio principal
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                      En la Papelera
                    </span>
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-100 block mt-1">
                      {deletedPeople.length}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                      Histórico recuperable (30d)
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                      Sugerencias
                    </span>
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-100 block mt-1">
                      {savedObras.length +
                        savedCategorias.length +
                        savedLugares.length +
                        savedSitios.length}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                      Listas de autocompletado
                    </span>
                  </div>
                </div>

                {/* Main Action Block: Export and Compression Information */}
                <div className="p-5 rounded-2xl border border-emerald-200/60 dark:border-emerald-950 bg-emerald-50/15 dark:bg-emerald-950/10 space-y-4">
                  <div className="flex gap-3 items-start">
                    <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                      <FileArchive className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-emerald-800 dark:text-emerald-400">
                        Compresión GZIP Nativa
                      </h4>
                      <p className="text-xs text-emerald-700/80 dark:text-emerald-500/80 mt-1 leading-relaxed">
                        El modo de exportación comprimida procesa toda la base
                        de datos localmente usando algoritmos de compresión
                        modernos de su navegador. Esto reduce enormemente el
                        tamaño del archivo, ideal para respaldos rápidos y
                        transferencias livianas.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      onClick={handleDownloadBackupGzip}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-5 rounded-xl shadow-md shadow-emerald-500/10 transition-all text-xs uppercase tracking-wider cursor-pointer"
                    >
                      <FileArchive className="w-4 h-4" />
                      Exportación Completa (.json.gz)
                    </button>
                    <button
                      onClick={handleDownloadBackupNormal}
                      className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 font-bold py-3 px-5 rounded-xl border border-slate-200 dark:border-slate-700 transition-all text-xs uppercase tracking-wider cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      JSON Plano (.json)
                    </button>
                  </div>
                </div>

                {/* Import / Restore Section */}
                <div className="border-t border-slate-200/60 dark:border-slate-850 pt-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <Upload className="w-4.5 h-4.5 text-slate-500" />
                      Restaurar Copia de Seguridad
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Seleccione el archivo de respaldo previo (
                      <strong className="font-bold text-slate-600 dark:text-slate-300">
                        .json
                      </strong>{" "}
                      o{" "}
                      <strong className="font-bold text-slate-600 dark:text-slate-300">
                        .json.gz
                      </strong>
                      ) para restaurar en este dispositivo.
                    </p>
                  </div>

                  <div>
                    {/* Drag-n-drop clickable Area */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-brand-primary dark:hover:border-blue-500 rounded-2xl p-8 text-center cursor-pointer bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-850/30 transition-all group flex flex-col justify-center items-center"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImportBackupFile}
                        accept=".json, .json.gz, .gz"
                        className="hidden"
                      />
                      <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                        <Upload className="w-6 h-6 text-slate-500 dark:text-slate-400" />
                      </div>
                      <span className="text-sm font-bold text-slate-750 dark:text-slate-300 block">
                        Seleccionar Archivo de Respaldo Local
                      </span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 block mt-1">
                        Compatible con archivos de exportación .json y copias
                        comprimidas .json.gz
                      </span>
                    </div>
                  </div>
                </div>

                {/* Custom Modal for Restore Confirmation and Options */}
                {loadedBackup && (
                  <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                      {/* Modal Header */}
                      <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/20">
                        <div className="flex gap-4 items-start">
                          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-2xl shrink-0">
                            <ShieldAlert className="w-6 h-6 animate-pulse" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                              Copia de Seguridad Detectada
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              Se ha verificado la integridad de los datos
                              cargados. Por favor, elija cómo desea proceder con
                              la restauración.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Modal Details */}
                      <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-3 text-xs p-4 rounded-2xl bg-slate-50 dark:bg-slate-850/50 border border-slate-200/50 dark:border-slate-800">
                          <div>
                            <span className="text-slate-400 dark:text-slate-500 block">
                              Fecha de Exportación
                            </span>
                            <span className="font-extrabold text-slate-700 dark:text-slate-200 mt-0.5 block">
                              {loadedBackup.exportDate
                                ? new Date(
                                    loadedBackup.exportDate,
                                  ).toLocaleDateString("es-ES", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "Fecha desconocida"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 dark:text-slate-500 block">
                              Versión del Formato
                            </span>
                            <span className="font-mono font-bold text-slate-700 dark:text-slate-200 mt-0.5 block">
                              v{loadedBackup.version || "1.0.0"}
                            </span>
                          </div>
                          <div className="col-span-2 border-t border-slate-200/50 dark:border-slate-700/50 pt-2.5 mt-1">
                            <span className="text-slate-400 dark:text-slate-500 block mb-1">
                              Registros de Trabajadores Incluidos
                            </span>
                            <div className="flex items-center gap-4 text-slate-700 dark:text-slate-200 font-bold">
                              <span>
                                Activos:{" "}
                                <strong className="text-brand-primary dark:text-blue-400">
                                  {loadedBackup.people?.length || 0}
                                </strong>
                              </span>
                              <span>
                                Papelera:{" "}
                                <strong className="text-amber-600 dark:text-amber-400">
                                  {loadedBackup.deletedPeople?.length || 0}
                                </strong>
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          {/* Option 1: Replace */}
                          <div className="p-3 rounded-xl border border-red-200 dark:border-red-950/40 bg-red-50/10 dark:bg-red-950/10 space-y-1">
                            <span className="text-xs font-bold text-red-600 dark:text-red-400 block">
                              Opción A: Reemplazar Todo (Limpieza completa)
                            </span>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              Sustituye completamente la base de datos actual,
                              la papelera y el autocompletado por los datos de
                              la copia de seguridad. Los registros locales
                              actuales que no estén en la copia se perderán.
                            </p>
                          </div>

                          {/* Option 2: Merge */}
                          <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-950/40 bg-blue-50/10 dark:bg-blue-950/10 space-y-1">
                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 block">
                              Opción B: Combinar e Integrar (Seguro)
                            </span>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              Une los registros del respaldo con los actuales
                              sin duplicados (identifica por DNI). Conserva los
                              nuevos trabajadores y añade los del respaldo que
                              falten.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Modal Footer */}
                      <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2.5 justify-end bg-slate-50/50 dark:bg-slate-850/10">
                        <button
                          type="button"
                          onClick={() => setLoadedBackup(null)}
                          className="px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer text-center"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => executeRestore("merge")}
                          className="px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-md shadow-blue-500/10 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          Combinar Datos
                        </button>
                        <button
                          type="button"
                          onClick={() => executeRestore("replace")}
                          className="px-4 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-md shadow-red-500/10 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Reemplazar Todo
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "obras" ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <MapPin className="w-6 h-6 text-brand-primary" />
                      Configuración de Obras y Recursos Preventivos
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                      Asigne a cada obra su Recurso Preventivo obligatorio y
                      Categoría del puesto (ej. Encargado de Obra) para el
                      cumplimiento de la Ley 32/2006 y su inclusión en las
                      firmas de los reportes técnicos en PDF.
                    </p>
                  </div>
                </div>

                {/* Formulario de Alta con Recurso Preventivo Obligatorio */}
                <form
                  onSubmit={handleAddObraWithRecurso}
                  className="mt-5 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3"
                >
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Plus className="w-4 h-4 text-brand-primary" />
                    <span>
                      Añadir Nueva Obra con Recurso Preventivo Asignado
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Nombre de la Obra *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: Obra PFEA Jerez - C/ Larga..."
                        value={newItem}
                        onChange={(e) => setNewItem(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Municipio
                      </label>
                      <input
                        type="text"
                        placeholder="Pendiente de completar"
                        value={newObraMunicipio}
                        onChange={(e) => setNewObraMunicipio(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Recurso Preventivo Asignado *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Nombre y Apellidos..."
                        value={newObraRecurso}
                        onChange={(e) => setNewObraRecurso(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Teléfono Recurso Preventivo
                      </label>
                      <input
                        type="tel"
                        placeholder="Ej: 600 123 456"
                        value={newObraTelefono}
                        onChange={(e) => setNewObraTelefono(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Categoría del Puesto
                      </label>
                      <select
                        value={newObraCategoria}
                        onChange={(e) => setNewObraCategoria(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      >
                        <option value="Encargado de Obra">
                          Encargado de Obra
                        </option>
                        <option value="Capataz de Obra">Capataz de Obra</option>
                        <option value="Técnico Básico PRL (60h)">
                          Técnico Básico PRL (60h)
                        </option>
                        <option value="Oficial 1ª / Recurso Preventivo">
                          Oficial 1ª / Recurso
                        </option>
                        <option value="Jefe de Obra">Jefe de Obra</option>
                        <option value="Personal Designado PRL">
                          Personal Designado PRL
                        </option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 px-4 py-2 bg-brand-primary text-white text-xs font-bold rounded-xl hover:bg-brand-primary/90 transition-colors shadow-md shadow-brand-primary/20 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Añadir Obra y Asignar Recurso</span>
                    </button>
                  </div>
                </form>
              </div>

              <div className="p-6">
                {/* Search Bar */}
                <div className="mb-6 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Filtrar por nombre de obra, recurso preventivo o categoría..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-all placeholder-slate-400"
                  />
                </div>

                {savedObras.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-850 p-4 rounded-2xl mb-6">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="select-all-obras-checkbox"
                        checked={
                          savedObras.filter((o) => {
                            const rec =
                              obrasRecursos[o]?.recursoPreventivoNombre || "";
                            const cat =
                              obrasRecursos[o]?.recursoPreventivoCategoria ||
                              "";
                            const searchLower = searchTerm.toLowerCase();
                            return (
                              o.toLowerCase().includes(searchLower) ||
                              rec.toLowerCase().includes(searchLower) ||
                              cat.toLowerCase().includes(searchLower)
                            );
                          }).length > 0 &&
                          savedObras
                            .filter((o) => {
                              const rec =
                                obrasRecursos[o]?.recursoPreventivoNombre || "";
                              const cat =
                                obrasRecursos[o]?.recursoPreventivoCategoria ||
                                "";
                              const searchLower = searchTerm.toLowerCase();
                              return (
                                o.toLowerCase().includes(searchLower) ||
                                rec.toLowerCase().includes(searchLower) ||
                                cat.toLowerCase().includes(searchLower)
                              );
                            })
                            .every((item) => selectedItems.includes(item))
                        }
                        onChange={() => {
                          const filtered = savedObras.filter((o) => {
                            const rec =
                              obrasRecursos[o]?.recursoPreventivoNombre || "";
                            const cat =
                              obrasRecursos[o]?.recursoPreventivoCategoria ||
                              "";
                            const searchLower = searchTerm.toLowerCase();
                            return (
                              o.toLowerCase().includes(searchLower) ||
                              rec.toLowerCase().includes(searchLower) ||
                              cat.toLowerCase().includes(searchLower)
                            );
                          });
                          const allSelected = filtered.every((item) =>
                            selectedItems.includes(item),
                          );
                          if (allSelected) {
                            setSelectedItems((prev) =>
                              prev.filter((i) => !filtered.includes(i)),
                            );
                          } else {
                            setSelectedItems((prev) =>
                              Array.from(new Set([...prev, ...filtered])),
                            );
                          }
                        }}
                        className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                      />
                      <label
                        htmlFor="select-all-obras-checkbox"
                        className="text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none"
                      >
                        Seleccionar todas las obras filtradas
                      </label>
                    </div>

                    {selectedItems.length > 0 && (
                      <div className="flex items-center gap-3 animate-in fade-in duration-200">
                        <span className="text-xs font-bold text-brand-primary dark:text-blue-400">
                          {selectedItems.length} seleccionadas
                        </span>

                        {showBulkConfirm ? (
                          <div className="flex items-center gap-1.5 bg-red-500/10 dark:bg-red-950/20 px-2 py-1 rounded-xl border border-red-500/20">
                            <span className="text-[10px] font-black text-red-500 uppercase mr-1">
                              ¿Eliminar seleccionadas?
                            </span>
                            <button
                              type="button"
                              onClick={handleBulkDelete}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-lg transition-colors cursor-pointer"
                            >
                              SÍ
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowBulkConfirm(false)}
                              className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowBulkConfirm(true)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Borrado Masivo
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItems([]);
                            setShowBulkConfirm(false);
                          }}
                          className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                          Limpiar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* List of Obras with Recurso Preventivo cards */}
                {(() => {
                  const filteredObras = savedObras.filter((o) => {
                    const rec = obrasRecursos[o]?.recursoPreventivoNombre || "";
                    const cat =
                      obrasRecursos[o]?.recursoPreventivoCategoria || "";
                    const searchLower = searchTerm.toLowerCase();
                    return (
                      o.toLowerCase().includes(searchLower) ||
                      rec.toLowerCase().includes(searchLower) ||
                      cat.toLowerCase().includes(searchLower)
                    );
                  });

                  if (filteredObras.length === 0) {
                    return (
                      <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                        <AlertCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <p className="text-slate-500 dark:text-slate-400 font-medium">
                          No se encontraron obras registradas
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[550px] overflow-y-auto pr-2 custom-scrollbar">
                      {filteredObras.map((obra) => {
                        const recursoData = obrasRecursos[obra];
                        const isSelected = selectedItems.includes(obra);
                        return (
                          <div
                            key={obra}
                            className={`group p-3.5 bg-white dark:bg-slate-800 border rounded-xl hover:border-brand-primary/30 dark:hover:border-blue-500/30 hover:shadow-xs transition-all flex flex-col justify-between gap-3 ${
                              isSelected
                                ? "border-brand-primary/40 bg-brand-primary/5 dark:bg-brand-primary/10"
                                : "border-slate-200 dark:border-slate-800"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    setSelectedItems((prev) =>
                                      prev.includes(obra)
                                        ? prev.filter((i) => i !== obra)
                                        : [...prev, obra],
                                    );
                                    setShowBulkConfirm(false);
                                  }}
                                  className="w-4 h-4 mt-0.5 rounded text-brand-primary focus:ring-brand-primary/20 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                    <h4
                                      className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate"
                                      title={obra}
                                    >
                                      {obra}
                                    </h4>
                                  </div>

                                  {/* Recurso Preventivo Badge */}
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {obrasMaestras.find(
                                      (item) => item.nombre === obra,
                                    )?.municipio ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                        {
                                          obrasMaestras.find(
                                            (item) => item.nombre === obra,
                                          )?.municipio
                                        }
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                        Municipio pendiente
                                      </span>
                                    )}
                                    {recursoData?.recursoPreventivoNombre ? (
                                      <>
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                          <UserCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                          <span className="truncate max-w-[150px]">
                                            {
                                              recursoData.recursoPreventivoNombre
                                            }
                                          </span>
                                        </span>
                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                                          {recursoData.recursoPreventivoCategoria ||
                                            "Encargado de Obra"}
                                        </span>
                                        {recursoData.recursoPreventivoTelefono && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200 border border-sky-200 dark:border-sky-800">
                                            <Phone className="w-3 h-3" />
                                            {recursoData.recursoPreventivoTelefono}
                                          </span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                        <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                                        <span>Sin recurso asignado</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingObraRecurso({
                                      obra,
                                      nombre: obra,
                                      id: obrasMaestras.find(
                                        (item) => item.nombre === obra,
                                      )?.id,
                                      municipio:
                                        obrasMaestras.find(
                                          (item) => item.nombre === obra,
                                        )?.municipio || "",
                                      recurso:
                                        recursoData?.recursoPreventivoNombre ||
                                        "",
                                      categoria:
                                        recursoData?.recursoPreventivoCategoria ||
                                        "Encargado de Obra",
                                      telefono:
                                        recursoData?.recursoPreventivoTelefono || "",
                                    })
                                  }
                                  className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors cursor-pointer"
                                  title="Editar obra"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingItem(obra)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                                  title="Eliminar obra"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {deletingItem === obra && (
                              <div className="flex items-center justify-between p-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 animate-in fade-in duration-150">
                                <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                                  ¿Eliminar esta obra?
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteItem(obra)}
                                    className="px-2.5 py-1 bg-rose-600 text-white text-[10px] font-black rounded-md hover:bg-rose-700 transition-colors cursor-pointer"
                                  >
                                    SÍ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeletingItem(null)}
                                    className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-md hover:bg-slate-300 transition-colors cursor-pointer"
                                  >
                                    NO
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Modal para Editar Obra y Recurso Preventivo */}
              {editingObraRecurso && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                  <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in fade-in zoom-in duration-200">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 rounded-lg">
                          <UserCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                            Editar Obra
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[280px]">
                            Modifica los datos de la obra y su recurso
                            preventivo
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingObraRecurso(null)}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-md"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <form
                      onSubmit={handleSaveEditObraRecurso}
                      className="space-y-4"
                    >
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Municipio
                        </label>
                        <input
                          type="text"
                          value={editingObraRecurso.municipio}
                          onChange={(e) =>
                            setEditingObraRecurso({
                              ...editingObraRecurso,
                              municipio: e.target.value,
                            })
                          }
                          placeholder="Pendiente de completar"
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        />
                        {!editingObraRecurso.municipio.trim() && (
                          <p className="mt-1 text-xs text-amber-600">
                            Pendiente de completar
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Nombre de la Obra *
                        </label>
                        <input
                          type="text"
                          required
                          value={editingObraRecurso.nombre}
                          onChange={(e) =>
                            setEditingObraRecurso({
                              ...editingObraRecurso,
                              nombre: e.target.value,
                            })
                          }
                          placeholder="Nombre de la obra"
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Nombre y Apellidos del Recurso Preventivo *
                        </label>
                        <input
                          type="text"
                          required
                          value={editingObraRecurso.recurso}
                          onChange={(e) =>
                            setEditingObraRecurso({
                              ...editingObraRecurso,
                              recurso: e.target.value,
                            })
                          }
                          placeholder="Ej: Manuel Gómez Serrano"
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Teléfono del Recurso Preventivo
                        </label>
                        <input
                          type="tel"
                          value={editingObraRecurso.telefono}
                          onChange={(e) =>
                            setEditingObraRecurso({
                              ...editingObraRecurso,
                              telefono: e.target.value,
                            })
                          }
                          placeholder="Ej: 600 123 456"
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Categoría del Puesto de Trabajo
                        </label>
                        <select
                          value={editingObraRecurso.categoria}
                          onChange={(e) =>
                            setEditingObraRecurso({
                              ...editingObraRecurso,
                              categoria: e.target.value,
                            })
                          }
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="Encargado de Obra">
                            Encargado de Obra
                          </option>
                          <option value="Capataz de Obra">
                            Capataz de Obra
                          </option>
                          <option value="Técnico Básico PRL (60h)">
                            Técnico Básico PRL (60h)
                          </option>
                          <option value="Oficial 1ª / Recurso Preventivo">
                            Oficial 1ª / Recurso Preventivo
                          </option>
                          <option value="Jefe de Obra">Jefe de Obra</option>
                          <option value="Personal Designado PRL">
                            Personal Designado PRL
                          </option>
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                          ℹ️ Esta persona aparecerá en la casilla de Recurso
                          Preventivo del Reporte Técnico PDF de esta obra.
                        </p>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setEditingObraRecurso(null)}
                          className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Guardar Cambios</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    {currentTab && (
                      <currentTab.icon className="w-6 h-6 text-brand-primary" />
                    )}
                    {currentTab?.label}
                  </h2>

                  {!isReadOnlyAdministrativeCatalog && <form
                    onSubmit={handleAddItem}
                    className="flex w-full sm:w-auto gap-2"
                  >
                    <input
                      type="text"
                      placeholder={
                        currentTab
                          ? `Añadir ${currentTab.label.toLowerCase()}...`
                          : ""
                      }
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      className="flex-1 sm:w-64 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all placeholder-slate-400"
                    />
                    <button
                      type="submit"
                      className="bg-brand-primary text-white p-2 rounded-xl hover:bg-brand-primary/90 transition-colors shadow-md shadow-brand-primary/10"
                      title="Añadir"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </form>}
                </div>
              </div>

              <div className="p-6">
                <div className="mb-6 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Filtrar lista..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-all placeholder-slate-400"
                  />
                </div>

                {currentTab && currentTab.list.length > 0 && !isReadOnlyAdministrativeCatalog && (
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-850 p-4 rounded-2xl mb-6">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="select-all-checkbox"
                        checked={
                          filteredList.length > 0 &&
                          filteredList.every((item) =>
                            selectedItems.includes(item),
                          )
                        }
                        onChange={handleToggleSelectAll}
                        className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                      />
                      <label
                        htmlFor="select-all-checkbox"
                        className="text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none"
                      >
                        Seleccionar todos los filtrados ({filteredList.length})
                      </label>
                    </div>

                    {selectedItems.length > 0 && (
                      <div className="flex items-center gap-3 animate-in fade-in duration-200">
                        <span className="text-xs font-bold text-brand-primary dark:text-blue-400">
                          {selectedItems.length} seleccionados
                        </span>

                        {showBulkConfirm ? (
                          <div className="flex items-center gap-1.5 bg-red-500/10 dark:bg-red-950/20 px-2 py-1 rounded-xl border border-red-500/20">
                            <span className="text-[10px] font-black text-red-500 uppercase mr-1">
                              ¿Eliminar seleccionados?
                            </span>
                            <button
                              type="button"
                              onClick={handleBulkDelete}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-lg transition-colors cursor-pointer"
                            >
                              SÍ
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowBulkConfirm(false)}
                              className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowBulkConfirm(true)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Borrado Masivo
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItems([]);
                            setShowBulkConfirm(false);
                          }}
                          className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                          Limpiar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {filteredList.length === 0 ? (
                  <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <AlertCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-500 dark:text-slate-400 font-medium">
                      No se encontraron elementos
                    </p>
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm("")}
                        className="text-brand-primary text-sm font-bold mt-2 hover:underline"
                      >
                        Limpiar búsqueda
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredList.map((item, index) => (
                      <div
                        key={index}
                        className={`group flex items-center justify-between p-3 bg-white dark:bg-slate-800 border rounded-xl hover:border-brand-primary/30 dark:hover:border-blue-500/30 hover:shadow-sm transition-all ${
                          selectedItems.includes(item)
                            ? "border-brand-primary/40 bg-brand-primary/5 dark:bg-brand-primary/10 dark:border-blue-500/40"
                            : "border-slate-200 dark:border-slate-800"
                        }`}
                      >
                        {deletingItem === item ? (
                          <div className="flex items-center justify-between w-full animate-in fade-in zoom-in-95 duration-200">
                            <span className="text-xs font-bold text-red-500 uppercase">
                              ¿Eliminar?
                            </span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDeleteItem(item)}
                                className="px-3 py-1 bg-red-500 text-white text-[10px] font-bold rounded-lg hover:bg-red-600 transition-colors"
                              >
                                SÍ
                              </button>
                              <button
                                onClick={() => setDeletingItem(null)}
                                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                              >
                                NO
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 min-w-0 pr-4">
                              {!isReadOnlyAdministrativeCatalog && (
                                <input
                                  type="checkbox"
                                  checked={selectedItems.includes(item)}
                                  onChange={() => {
                                    setSelectedItems((prev) =>
                                      prev.includes(item)
                                        ? prev.filter((i) => i !== item)
                                        : [...prev, item],
                                    );
                                    setShowBulkConfirm(false);
                                  }}
                                  className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary/20 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all cursor-pointer"
                                />
                              )}
                              <span className="text-sm text-slate-700 dark:text-slate-200 font-medium truncate">
                                {item}
                              </span>
                            </div>
                            {!isReadOnlyAdministrativeCatalog && (
                              <button
                                onClick={() => setDeletingItem(item)}
                                className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-all lg:opacity-0 group-hover:opacity-100"
                                title="Eliminar"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border-t border-amber-100 dark:border-amber-900/40 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  <strong>Nota:</strong>{" "}
                  {isReadOnlyAdministrativeCatalog
                    ? "Estos datos se obtienen automáticamente de las fichas de trabajadores guardadas. Se muestran de forma parcialmente oculta y no se duplican en otro almacén."
                    : "Eliminar un elemento de esta lista no afectará a los registros ya guardados. Simplemente dejará de aparecer como sugerencia en los formularios."}
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/20">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-primary dark:text-blue-400">Información de la aplicación</p>
                  <h2 className="text-lg font-black text-slate-900 dark:text-slate-100 mt-1">GestionProfea · v{APP_VERSION}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Actualizada: {APP_RELEASE_DATE} · Build: {APP_BUILD}
                  </p>
                </div>
                <span className="inline-flex items-center self-start sm:self-auto rounded-full border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  Versión estable
                </span>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-3">Novedades de esta versión</h3>
              <ul className="space-y-2">
                {APP_RELEASE_NOTES.map((note) => (
                  <li key={note} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-4">
                El número de versión cambiará con cada mejora publicada para identificar exactamente qué edición de GestionProfea estás utilizando.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
