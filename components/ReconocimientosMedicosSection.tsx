import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileUp,
  HeartPulse,
  Loader2,
  MessageCircle,
  Search,
  Share2,
  ShieldAlert,
  UserCheck,
  X,
} from "lucide-react";
import {
  Person,
  MedicalRecordImportItem,
  getAptitudMedicaInfo,
} from "../types";
import { extractClientDocumentText } from "../src/lib/clientDocumentText";
import { analyzeMedicalDocumentText } from "../src/lib/medicalDocumentAnalyzer";
import { updateDocument } from "../src/services/databaseService";
import { persistMedicalRecognition } from "../src/services/medicalRecognitionService";
import {
  createMedicalAppointmentPdfFile,
  openMedicalAppointmentWhatsAppMessage,
  sharePreparedMedicalAppointmentPdf,
} from "../src/lib/shareMedicalAppointment";
import { prepareMedicalAppointmentConfirmation } from "../src/lib/medicalAppointmentConfirmation";

interface Props {
  people: Person[];
  onUpdatePeople: (updatedPeople: Person[]) => void;
  onToast: (message: string, type: "success" | "error") => void;
}

interface ReviewItem extends MedicalRecordImportItem {
  id: string;
  selected: boolean;
}

type ConfirmationStatus = "pendiente" | "confirmada" | "no_puede_asistir";

const patchPerson = (person: Person, item: MedicalRecordImportItem): Person => {
  const limited = item.resultado === "Apto con Limitación";
  const limitations = limited ? item.limitaciones || "" : "";
  return {
    ...person,
    reconocimientoEstado: item.resultado,
    aptitudMedica: limited ? "Apto con limitaciones" : item.resultado,
    limitacionesAptitud: limitations,
    reconocimientoLimitaciones: limitations,
    reconocimientoFecha:
      item.fechaReconocimiento || person.reconocimientoFecha || "",
    reconocimientoValidez: item.validez || person.reconocimientoValidez || "",
    reconocimientoObservaciones:
      item.observaciones ||
      `Reconocimiento importado desde ${item.archivoOrigen || "documento médico"}.`,
    documentacionCompleta:
      item.resultado === "No Apto" ? "No" : person.documentacionCompleta,
  };
};

const normalizeWhatsAppPhone = (value: string): string => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
};

const formatAppointmentDate = (value: string): string => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || "-";
};

const isTomorrow = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const now = new Date();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  const key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  return value === key;
};

const getConfirmationStatus = (person: Person): ConfirmationStatus => {
  const raw = String((person as any).confirmacionCitaEstado || "")
    .trim()
    .toLowerCase();
  return raw === "confirmada" || raw === "no_puede_asistir" ? raw : "pendiente";
};

const confirmationBadge = (status: ConfirmationStatus) => {
  if (status === "confirmada")
    return {
      label: "Confirmada",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    };
  if (status === "no_puede_asistir")
    return {
      label: "No puede asistir",
      cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    };
  return {
    label: "Pendiente de confirmación",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  };
};

export const ReconocimientosMedicosSection: React.FC<Props> = ({
  people,
  onUpdatePeople,
  onToast,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [search, setSearch] = useState("");
  const [pendingPdfPerson, setPendingPdfPerson] = useState<Person | null>(null);
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [pendingPdfGenerating, setPendingPdfGenerating] = useState(false);
  const [pendingPdfError, setPendingPdfError] = useState("");
  const [pendingPdfDownloadedForManualShare, setPendingPdfDownloadedForManualShare] = useState(false);
  const pendingPdfReturnRef = useRef(false);

  useEffect(() => {
    const focusWorkerId = Number(sessionStorage.getItem("profea-medical-focus-worker-id") || "");
    if (!Number.isFinite(focusWorkerId)) return;
    const person = people.find((item) => item.id === focusWorkerId);
    if (!person) return;
    setSearch(person.dni || person.apellidosNombre || "");
    sessionStorage.removeItem("profea-medical-focus-worker-id");
    window.setTimeout(() => {
      document.getElementById(`medical-worker-${person.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  }, [people]);
  const pendingPdfGeneratingRef = useRef(false);

  const stats = useMemo(
    () => ({
      total: people.length,
      aptos: people.filter((p) => getAptitudMedicaInfo(p).estado === "Apto")
        .length,
      limitados: people.filter(
        (p) => getAptitudMedicaInfo(p).estado === "Apto con limitaciones",
      ).length,
      noAptos: people.filter(
        (p) => getAptitudMedicaInfo(p).estado === "No Apto",
      ).length,
      pendientes: people.filter(
        (p) => getAptitudMedicaInfo(p).estado === "Pendiente",
      ).length,
    }),
    [people],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      `${p.apellidosNombre} ${p.dni} ${p.obra}`.toLowerCase().includes(q),
    );
  }, [people, search]);

  const upcomingAppointments = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return people
      .filter(
        (p) =>
          p.necesitaReconocimiento === "Sí" &&
          p.citaDia &&
          p.citaHora &&
          p.sitioReconocimiento &&
          p.citaDia >= todayKey,
      )
      .sort((a, b) =>
        `${a.citaDia} ${a.citaHora}`.localeCompare(
          `${b.citaDia} ${b.citaHora}`,
        ),
      );
  }, [people]);

  const preparePendingPdf = async (person: Person) => {
    if (pendingPdfGeneratingRef.current) return;
    pendingPdfGeneratingRef.current = true;
    setPendingPdfGenerating(true);
    setPendingPdfError("");
    try {
      const file = await createMedicalAppointmentPdfFile(person);
      setPendingPdfFile(file);
      try {
        await updateDocument("trabajadores", person.id, {
          ...person,
          confirmacionCitaDocumentoPreparadoFecha: new Date().toISOString(),
          confirmacionCitaDocumentoNombre: file.name,
        } as any);
      } catch (error) {
        reportOperationalError("[medical-pdf-ready] No se pudo registrar la preparación del PDF", error, 'warn');
      }
      onToast(
        `PDF de citación listo para compartir con ${person.apellidosNombre}.`,
        "success",
      );
    } catch (error: any) {
      reportOperationalError("[medical-pdf-ready]", error);
      setPendingPdfError(
        error?.message || "No se pudo generar el PDF de la citación.",
      );
    } finally {
      pendingPdfGeneratingRef.current = false;
      setPendingPdfGenerating(false);
    }
  };

  const clearPendingPdf = () => {
    setPendingPdfPerson(null);
    setPendingPdfFile(null);
    setPendingPdfError("");
    setPendingPdfDownloadedForManualShare(false);
    pendingPdfReturnRef.current = false;
    try {
      sessionStorage.removeItem("profea:medical-pdf-pending");
    } catch {}
  };

  const returnToSaeAfterMedicalShare = (personId: number) => {
    try {
      const returnWorkerId = sessionStorage.getItem(
        "profea-medical-return-to-sae-worker-id",
      );
      if (returnWorkerId !== String(personId)) return false;
      sessionStorage.removeItem("profea-medical-return-to-sae-worker-id");
      sessionStorage.removeItem("profea-medical-focus-worker-id");
      sessionStorage.setItem("profea-sae-focus-candidates", "1");
      sessionStorage.setItem("profea-sae-last-completed-worker-id", String(personId));
      window.dispatchEvent(
        new CustomEvent("profea:navigate", {
          detail: { view: "sae", section: "candidates", reason: "medical-pdf-shared", workerId: personId },
        }),
      );
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const recoverPending = () => {
      if (pendingPdfPerson) return;
      try {
        const raw = sessionStorage.getItem("profea:medical-pdf-pending");
        if (!raw) return;
        const parsed = JSON.parse(raw) as { personId?: number };
        const person = people.find((item) => item.id === Number(parsed.personId));
        if (person) {
          setPendingPdfPerson(person);
          // Si iOS/Android recargó la PWA al volver de WhatsApp, retomamos
          // automáticamente el paso pendiente y generamos el PDF.
          if (document.visibilityState === "visible") {
            window.setTimeout(() => void preparePendingPdf(person), 0);
          }
        }
      } catch {}
    };
    recoverPending();
  }, [people, pendingPdfPerson]);

  useEffect(() => {
    const handleAway = () => {
      if (pendingPdfPerson && document.visibilityState === "hidden") {
        pendingPdfReturnRef.current = true;
      }
    };
    const handleReturn = () => {
      if (
        pendingPdfPerson &&
        pendingPdfReturnRef.current &&
        document.visibilityState === "visible" &&
        !pendingPdfFile &&
        !pendingPdfGeneratingRef.current
      ) {
        pendingPdfReturnRef.current = false;
        void preparePendingPdf(pendingPdfPerson);
      }
    };
    const handleBlur = () => {
      if (pendingPdfPerson) pendingPdfReturnRef.current = true;
    };
    const handleFocus = () => {
      if (
        pendingPdfPerson &&
        pendingPdfReturnRef.current &&
        !pendingPdfFile &&
        !pendingPdfGeneratingRef.current
      ) {
        pendingPdfReturnRef.current = false;
        void preparePendingPdf(pendingPdfPerson);
      }
    };
    document.addEventListener("visibilitychange", handleAway);
    document.addEventListener("visibilitychange", handleReturn);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleAway);
      document.removeEventListener("visibilitychange", handleReturn);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [pendingPdfPerson, pendingPdfFile]);

  const openWhatsApp = async (person: Person, reminder: boolean) => {
    const phone = normalizeWhatsAppPhone(person.telefono || "");
    if (phone.length < 10) {
      onToast(
        `El trabajador ${person.apellidosNombre} no tiene un teléfono válido para WhatsApp.`,
        "error",
      );
      return;
    }
    try {
      const prepared = await prepareMedicalAppointmentConfirmation(person);
      onUpdatePeople(
        people.map((p) => (p.id === person.id ? prepared.updatedPerson : p)),
      );
      setPendingPdfPerson(prepared.updatedPerson);
      setPendingPdfFile(null);
      setPendingPdfError("");
      setPendingPdfDownloadedForManualShare(false);
      pendingPdfReturnRef.current = false;
      try {
        sessionStorage.setItem(
          "profea:medical-pdf-pending",
          JSON.stringify({ personId: person.id, reminder }),
        );
      } catch {}
      openMedicalAppointmentWhatsAppMessage(
        prepared.updatedPerson,
        reminder,
        prepared.links,
      );
      onToast(
        `WhatsApp abierto para ${person.apellidosNombre}. Al volver se preparará automáticamente el PDF.`,
        "success",
      );
    } catch (error: any) {
      reportOperationalError("[medical-whatsapp-share]", error);
      onToast(
        error?.message ||
          "No se pudo preparar el mensaje de WhatsApp y la confirmación.",
        "error",
      );
    }
  };

  const sharePendingPdf = async () => {
    if (!pendingPdfPerson) return;
    try {
      const file =
        pendingPdfFile || (await createMedicalAppointmentPdfFile(pendingPdfPerson));
      if (!pendingPdfFile) setPendingPdfFile(file);
      const result = await sharePreparedMedicalAppointmentPdf(
        pendingPdfPerson,
        file,
      );
      if (result === "shared") {
        const sharedPerson = pendingPdfPerson;
        const now = new Date().toISOString();

        // La trazabilidad del envío se guarda en segundo plano para no frenar
        // el paso al siguiente candidato.
        void updateDocument("trabajadores", sharedPerson.id, {
          ...sharedPerson,
          confirmacionCitaDocumentoCompartidoFecha: now,
          confirmacionCitaDocumentoNombre: file.name,
        } as any).catch((error) => {
          reportOperationalError("[medical-pdf-share] No se pudo registrar la acción de compartir", error, 'warn');
        });

        onToast(
          `PDF compartido desde el dispositivo. Volviendo a Gestión SAE para continuar con el siguiente candidato.`,
          "success",
        );
        clearPendingPdf();
        returnToSaeAfterMedicalShare(sharedPerson.id);
      } else if (result === "downloaded") {
        setPendingPdfDownloadedForManualShare(true);
        onToast(
          "Este dispositivo no permite confirmar automáticamente el envío. Se ha descargado el PDF: adjúntalo manualmente y pulsa «Ya lo he compartido · continuar SAE».",
          "success",
        );
      }
    } catch (error: any) {
      reportOperationalError("[medical-pdf-share]", error);
      onToast(error?.message || "No se pudo compartir el PDF.", "error");
    }
  };

  const confirmManualShareAndReturnToSae = async () => {
    if (!pendingPdfPerson || !pendingPdfFile) return;
    const sharedPerson = pendingPdfPerson;
    const now = new Date().toISOString();
    try {
      await updateDocument("trabajadores", sharedPerson.id, {
        ...sharedPerson,
        confirmacionCitaDocumentoCompartidoFecha: now,
        confirmacionCitaDocumentoNombre: pendingPdfFile.name,
        confirmacionCitaDocumentoCompartidoManual: true,
      } as any);
    } catch (error) {
      reportOperationalError("[medical-pdf-share-manual] No se pudo registrar la acción de compartir", error, 'warn');
    }
    onToast(
      "Citación marcada como compartida. Volviendo a SAE para seleccionar el siguiente candidato.",
      "success",
    );
    clearPendingPdf();
    returnToSaeAfterMedicalShare(sharedPerson.id);
  };

  const setConfirmation = async (
    person: Person,
    status: ConfirmationStatus,
  ) => {
    const now = new Date().toISOString();
    const updated = {
      ...person,
      confirmacionCitaEstado: status,
      confirmacionCitaFecha: now,
    } as Person & Record<string, any>;
    try {
      await updateDocument("trabajadores", person.id, updated as any);
      onUpdatePeople(people.map((p) => (p.id === person.id ? updated : p)));
      const label =
        status === "confirmada"
          ? "confirmada"
          : status === "no_puede_asistir"
            ? "marcada como no puede asistir"
            : "puesta como pendiente";
      onToast(`Cita de ${person.apellidosNombre} ${label}.`, "success");
    } catch (error) {
      reportOperationalError("[medical-confirmation] update", error);
      onToast(
        "No se pudo guardar el estado de confirmación de la cita.",
        "error",
      );
    }
  };

  const persist = async (items: MedicalRecordImportItem[]) => {
    const replacements = new Map<number, Person>();
    let failed = 0;
    for (const item of items) {
      if (
        !item.matchedPersonId ||
        !item.resultado ||
        item.resultado === "Pendiente"
      )
        continue;
      const original = people.find((p) => p.id === item.matchedPersonId);
      if (!original) continue;
      const updated = patchPerson(original, item);
      try {
        await updateDocument("trabajadores", updated.id, updated as any);
        await persistMedicalRecognition(updated);
        replacements.set(updated.id, updated);
      } catch (error) {
        failed += 1;
        reportOperationalError("[medical-v2] persist", error);
      }
    }
    if (replacements.size)
      onUpdatePeople(people.map((p) => replacements.get(p.id) || p));
    return { applied: replacements.size, failed };
  };

  const processFiles = async (files: FileList) => {
    const list = Array.from(files).filter(
      (f) =>
        f.type === "application/pdf" ||
        f.type.startsWith("image/") ||
        /\.(pdf|png|jpe?g|webp)$/i.test(f.name),
    );
    if (!list.length)
      return onToast(
        "Seleccione PDF o imágenes de reconocimientos médicos.",
        "error",
      );
    setBusy(true);
    setReview([]);
    try {
      const detected: ReviewItem[] = [];
      const unreadable: string[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const extracted = await extractClientDocumentText(file, (msg) =>
          setProgress(`Documento ${i + 1}/${list.length} · ${msg}`),
        );
        if (!extracted.text.trim()) {
          unreadable.push(file.name);
          continue;
        }
        setProgress(
          `Documento ${i + 1}/${list.length} · identificando trabajadores y aptitud…`,
        );
        analyzeMedicalDocumentText(extracted.text, people, file.name).forEach(
          (row, j) =>
            detected.push({
              ...row,
              id: `${Date.now()}_${i}_${j}_${row.matchedPersonId || "x"}`,
              selected: true,
            }),
        );
      }
      if (!detected.length) {
        onToast(
          `No se reconocieron resultados médicos vinculables a trabajadores registrados.${unreadable.length ? ` No se pudo leer: ${unreadable.join(", ")}.` : ""}`,
          "error",
        );
        return;
      }

      const byWorker = new Map<number, Set<string>>();
      detected.forEach((item) => {
        if (!item.matchedPersonId) return;
        const set = byWorker.get(item.matchedPersonId) || new Set<string>();
        set.add(item.resultado);
        byWorker.set(item.matchedPersonId, set);
      });
      const conflicts = new Set(
        Array.from(byWorker.entries())
          .filter(([, s]) => s.size > 1)
          .map(([id]) => id),
      );
      const normalized = detected.map((item) =>
        conflicts.has(item.matchedPersonId || -1)
          ? {
              ...item,
              confianza: "baja" as const,
              selected: false,
              inconsistencias: [
                ...(item.inconsistencias || []),
                "Resultados contradictorios. Revisar manualmente.",
              ],
            }
          : item,
      );

      const automatic = normalized.filter(
        (i) =>
          i.matchedPersonId &&
          i.confianza === "alta" &&
          i.resultado !== "Pendiente",
      );
      const pending = normalized.filter(
        (i) => !automatic.some((a) => a.id === i.id),
      );
      const saved = await persist(automatic);
      setReview(pending);
      const aptos = automatic.filter((i) => i.resultado === "Apto").length;
      const limited = automatic.filter(
        (i) => i.resultado === "Apto con Limitación",
      ).length;
      const noAptos = automatic.filter((i) => i.resultado === "No Apto").length;
      const msg = `${saved.applied} aplicados automáticamente: ${aptos} aptos, ${limited} aptos con limitaciones y ${noAptos} no aptos.${pending.length ? ` ${pending.length} para revisión.` : ""}${saved.failed ? ` ${saved.failed} no pudieron guardarse.` : ""}`;
      onToast(msg, noAptos || saved.failed ? "error" : "success");
    } catch (error: any) {
      onToast(
        error?.message ||
          "No se pudieron analizar los reconocimientos médicos.",
        "error",
      );
    } finally {
      setBusy(false);
      setProgress("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const applyReviewed = async () => {
    const selected = review.filter(
      (i) => i.selected && i.matchedPersonId && i.resultado !== "Pendiente",
    );
    if (!selected.length)
      return onToast("No hay resultados revisados seleccionados.", "error");
    setBusy(true);
    setProgress("Guardando resultados revisados…");
    try {
      const result = await persist(selected);
      const ids = new Set(selected.map((i) => i.id));
      setReview((prev) => prev.filter((i) => !ids.has(i.id)));
      onToast(
        `${result.applied} reconocimientos aplicados a las fichas.`,
        result.failed ? "error" : "success",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="space-y-6 min-w-0">
      <div className="ui-surface p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#00548E] dark:text-blue-400 mb-1">
              <HeartPulse className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-[0.14em]">
                Reconocimientos médicos
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black">
              Importación de resultados de reconocimientos médicos
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-3xl">
              Importa los informes o resultados emitidos por el servicio médico.
              GestionProfea identifica automáticamente a cada trabajador y asigna
              a su ficha el resultado que le corresponde, dejando actualizado su
              estado como Apto, Apto con limitaciones o No apto.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm cursor-pointer">
              <FileUp className="w-4 h-4" /> Importar resultados
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) =>
                  e.target.files && void processFiles(e.target.files)
                }
              />
            </label>
          </div>
        </div>
      </div>

      {busy && (
        <div className="ui-surface p-4 flex items-center gap-3 text-sm font-semibold">
          <Loader2 className="w-4 h-4 animate-spin text-[#00548E]" />
          {progress || "Procesando…"}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(
          [
            ["Trabajadores", stats.total],
            ["Aptos", stats.aptos],
            ["Con limitaciones", stats.limitados],
            ["No aptos", stats.noAptos],
            ["Pendientes", stats.pendientes],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="ui-surface p-4">
            <div className="text-2xl font-black">{value}</div>
            <div className="text-xs text-slate-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="ui-surface p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <MessageCircle className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-[0.14em]">
                WhatsApp
              </span>
            </div>
            <h2 className="font-black text-lg mt-1">
              Avisos y confirmación de citas médicas
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Primero abre el WhatsApp directo del trabajador con la cita y los
              enlaces de confirmación. Al volver a GestionProfea se genera el PDF
              individual con todas las instrucciones y queda listo para compartir
              desde el dispositivo. No usa Twilio ni API de pago.
            </p>
          </div>
          <div className="text-xs font-black px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
            {upcomingAppointments.length} cita(s) próximas
          </div>
        </div>

        {pendingPdfPerson && (
          <div className="rounded-2xl border-2 border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/25 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900 flex items-center justify-center text-[#00548E] dark:text-blue-300 shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-black text-base text-slate-900 dark:text-white">
                  {pendingPdfGenerating
                    ? "Generando PDF de la citación…"
                    : pendingPdfFile
                      ? "PDF listo para compartir"
                      : "Cuando vuelvas de WhatsApp prepararemos el PDF"}
                </div>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200 mt-1">
                  {pendingPdfPerson.apellidosNombre}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                  WhatsApp: {pendingPdfPerson.telefono || "Sin teléfono"}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Al compartir archivos, iPhone/Android no permiten que GestionProfea
                  seleccione automáticamente el contacto de WhatsApp. Comprueba que
                  eliges este trabajador. Su confirmación se registrará cuando pulse
                  “Confirmar asistencia” en el enlace recibido.
                </div>
                {pendingPdfError && (
                  <div className="mt-2 text-xs font-bold text-red-700 dark:text-red-300">
                    {pendingPdfError}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 shrink-0 sm:w-52">
                {!pendingPdfFile && !pendingPdfGenerating && (
                  <button
                    type="button"
                    onClick={() => void preparePendingPdf(pendingPdfPerson)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900 px-4 py-3 text-sm font-black text-[#00548E] dark:text-blue-300"
                  >
                    <FileText className="w-4 h-4" />
                    Preparar PDF ahora
                  </button>
                )}
                {pendingPdfGenerating && (
                  <div className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/70 dark:bg-slate-900/70 px-4 py-3 text-sm font-bold text-slate-600 dark:text-slate-300">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generando…
                  </div>
                )}
                {pendingPdfFile && (
                  <button
                    type="button"
                    onClick={() => void sharePendingPdf()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] hover:bg-[#004a7d] px-4 py-3 text-sm font-black text-white"
                  >
                    <Share2 className="w-4 h-4" />
                    Compartir PDF ahora
                  </button>
                )}
                {pendingPdfFile && pendingPdfDownloadedForManualShare && (
                  <button
                    type="button"
                    onClick={() => void confirmManualShareAndReturnToSae()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-3 text-sm font-black text-white"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Ya lo he compartido · continuar SAE
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearPendingPdf}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  <X className="w-4 h-4" />
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {upcomingAppointments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center text-sm text-slate-500">
            No hay citas médicas futuras con fecha, hora y lugar completos.
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingAppointments.map((person) => {
              const reminderToday = isTomorrow(person.citaDia);
              const phoneOk =
                normalizeWhatsAppPhone(person.telefono || "").length >= 10;
              const status = getConfirmationStatus(person);
              const badge = confirmationBadge(status);
              return (
                <div
                  key={`wa_${person.id}`}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-black text-sm truncate">
                          {person.apellidosNombre}
                        </div>
                        <span
                          className={`text-[10px] font-black px-2 py-1 rounded-full ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {formatAppointmentDate(person.citaDia)} ·{" "}
                        {person.citaHora} h · {person.sitioReconocimiento}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {person.obra || "Sin obra"} ·{" "}
                        {person.telefono || "Sin teléfono"}
                      </div>
                      {person.observaciones && (
                        <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          Observaciones: {person.observaciones}
                        </div>
                      )}
                      {(person as any).confirmacionCitaFecha && (
                        <div className="text-[10px] text-slate-400 mt-1">
                          Última actualización de confirmación:{" "}
                          {new Date(
                            (person as any).confirmacionCitaFecha,
                          ).toLocaleString("es-ES")}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!phoneOk}
                        onClick={() => void openWhatsApp(person, false)}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white text-xs font-black transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />{" "}
                        {status === "pendiente"
                          ? "Enviar cita"
                          : "Reenviar cita"}
                      </button>
                      <button
                        type="button"
                        disabled={!phoneOk}
                        onClick={() => void openWhatsApp(person, true)}
                        className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-black transition-colors ${reminderToday ? "bg-amber-500 hover:bg-amber-600 text-white" : "border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                      >
                        <MessageCircle className="w-4 h-4" />{" "}
                        {reminderToday
                          ? "Recordatorio hoy"
                          : "Enviar recordatorio"}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 sm:mr-auto">
                      Registrar respuesta recibida
                    </span>
                    <button
                      type="button"
                      onClick={() => void setConfirmation(person, "confirmada")}
                      className={`px-3 py-2 rounded-xl text-xs font-black transition-colors ${status === "confirmada" ? "bg-emerald-600 text-white" : "border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"}`}
                    >
                      ✓ Confirmada
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void setConfirmation(person, "no_puede_asistir")
                      }
                      className={`px-3 py-2 rounded-xl text-xs font-black transition-colors ${status === "no_puede_asistir" ? "bg-red-600 text-white" : "border border-red-300 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"}`}
                    >
                      No puede asistir
                    </button>
                    {status !== "pendiente" && (
                      <button
                        type="button"
                        onClick={() =>
                          void setConfirmation(person, "pendiente")
                        }
                        className="px-3 py-2 rounded-xl text-xs font-black border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Volver a pendiente
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!!review.length && (
        <div className="ui-surface p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-lg">Casos para revisión</h2>
              <p className="text-xs text-slate-500">
                Solo aparecen coincidencias medias/bajas o resultados
                contradictorios.
              </p>
            </div>
            <button
              onClick={() => void applyReviewed()}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold inline-flex items-center gap-2 justify-center"
            >
              <UserCheck className="w-4 h-4" /> Aplicar seleccionados
            </button>
          </div>
          <div className="space-y-3">
            {review.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4"
              >
                <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
                  <label className="flex items-start gap-3 flex-1">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={(e) =>
                        setReview((prev) =>
                          prev.map((x) =>
                            x.id === item.id
                              ? { ...x, selected: e.target.checked }
                              : x,
                          ),
                        )
                      }
                      className="mt-1"
                    />
                    <div>
                      <div className="font-black text-sm">
                        {item.matchedPersonName || item.apellidosNombre}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {item.archivoOrigen} · confianza {item.confianza}
                      </div>
                      {!!item.inconsistencias?.length && (
                        <div className="text-xs text-amber-700 mt-1">
                          {item.inconsistencias.join(" · ")}
                        </div>
                      )}
                    </div>
                  </label>
                  <div className="grid sm:grid-cols-2 gap-2 lg:w-[520px]">
                    <select
                      value={item.resultado}
                      onChange={(e) =>
                        setReview((prev) =>
                          prev.map((x) =>
                            x.id === item.id
                              ? { ...x, resultado: e.target.value }
                              : x,
                          ),
                        )
                      }
                      className="ui-input text-sm"
                    >
                      <option>Apto</option>
                      <option value="Apto con Limitación">
                        Apto con limitaciones
                      </option>
                      <option value="No Apto">No apto</option>
                      <option>Pendiente</option>
                    </select>
                    <input
                      value={item.limitaciones || ""}
                      disabled={item.resultado !== "Apto con Limitación"}
                      onChange={(e) =>
                        setReview((prev) =>
                          prev.map((x) =>
                            x.id === item.id
                              ? { ...x, limitaciones: e.target.value }
                              : x,
                          ),
                        )
                      }
                      className="ui-input text-sm"
                      placeholder="Limitaciones"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ui-surface p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-black text-lg">Aptitud actual</h2>
            <p className="text-xs text-slate-500">
              La ficha del trabajador es la fuente de verdad para los informes
              generados.
            </p>
          </div>
          <div className="relative sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ui-input pl-9 text-sm"
              placeholder="Buscar trabajador, DNI u obra…"
            />
          </div>
        </div>
        <div className="space-y-2">
          {filtered.map((person) => {
            const info = getAptitudMedicaInfo(person);
            const cls =
              info.estado === "Apto"
                ? "bg-emerald-100 text-emerald-700"
                : info.estado === "Apto con limitaciones"
                  ? "bg-amber-100 text-amber-700"
                  : info.estado === "No Apto"
                    ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-600";
            return (
              <div id={`medical-worker-${person.id}`}
                key={person.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between"
              >
                <div>
                  <div className="font-bold text-sm">
                    {person.apellidosNombre}
                  </div>
                  <div className="text-xs text-slate-500">
                    {person.dni || "Sin DNI"} · {person.obra || "Sin obra"}
                    {person.reconocimientoFecha
                      ? ` · ${person.reconocimientoFecha}`
                      : ""}
                  </div>
                  {info.limitaciones && (
                    <div className="text-xs text-amber-700 mt-1">
                      Limitaciones: {info.limitaciones}
                    </div>
                  )}
                </div>
                <span
                  className={`text-xs font-black px-3 py-1.5 rounded-full ${cls}`}
                >
                  {info.estado}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-surface p-4 text-xs text-slate-500 flex gap-2 items-start">
        <ShieldAlert className="w-4 h-4 text-[#00548E] shrink-0 mt-0.5" />
        <span>
          El motor no realiza diagnósticos: únicamente identifica al trabajador
          y transcribe su aptitud y limitaciones. Las coincidencias dudosas
          nunca se aplican automáticamente.
        </span>
      </div>
      {stats.noAptos > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="text-sm">
            <strong>
              {stats.noAptos} trabajador(es) constan como No apto.
            </strong>{" "}
            Su documentación queda marcada como incompleta.
          </div>
        </div>
      )}
      {stats.aptos + stats.limitados > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4 flex gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="text-sm">
            Los resultados quedan guardados en la ficha y se reflejan en los
            informes que utilizan los datos actuales del trabajador.
          </div>
        </div>
      )}
    </div>
  );
};
