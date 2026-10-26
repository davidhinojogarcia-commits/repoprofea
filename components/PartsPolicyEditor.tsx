import React, { useState } from "react";
import { PART_REASONS, type PartPolicy } from "../src/lib/parts/domain";
import { partsRequest } from "../src/services/partsService";
const field =
  "mt-1 block w-full rounded-xl border bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-white";
export default function PartsPolicyEditor({
  policy,
  revision,
  worksiteId,
  onSaved,
}: {
  key?: string | number;
  policy: PartPolicy | null;
  revision: number;
  worksiteId: string;
  onSaved: (policy: PartPolicy) => void;
}) {
  const [value, setValue] = useState<PartPolicy>(
    policy || {
      employer: "",
      agreement: "",
      reviewedBy: "",
      reviewedAt: "",
      windowDays: 0,
      retentionDays: 0,
      legalBasis: "",
      authority: "",
      reasons: PART_REASONS.map(([id, label, requiresReview]) => ({
        id,
        label,
        requiresReview,
      })),
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ack, setAck] = useState(false),
    [newReason, setNewReason] = useState("");
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer font-bold">
        Política de seguimiento y conservación · validación jurídica
      </summary>
      <p className="my-2 text-sm">
        No hay plazos legales predeterminados. Registra únicamente criterios
        revisados por el responsable laboral y de protección de datos. El
        cómputo no impone sanciones. Bloqueo y supresión requieren su
        procedimiento autorizado; no se ejecutan purgas automáticas.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          void partsRequest({
            action: "policy",
            worksiteId,
            expected: revision,
            policy: value,
          })
            .then((r) => onSaved(r.policy))
            .catch((e: any) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {(
          [
            "employer",
            "agreement",
            "reviewedBy",
            "legalBasis",
            "authority",
          ] as const
        ).map((key, i) => (
          <label className="block" key={key}>
            {
              [
                "Entidad empleadora de esta obra",
                "Convenio o régimen laboral aplicable",
                "Responsable que valida los criterios",
                "Base jurídica y criterios aprobados",
                "Órgano competente para valoración",
              ][i]
            }
            <textarea
              className={field}
              required
              maxLength={1500}
              value={value[key]}
              onChange={(e) =>
                setValue((p) => ({ ...p, [key]: e.target.value }))
              }
            />
          </label>
        ))}
        <label className="block">
          Horizonte aprobado de comparabilidad (días, máximo técnico 365)
          <input
            className={field}
            required
            type="number"
            min="1"
            max="365"
            value={value.windowDays || ""}
            onChange={(e) =>
              setValue((p) => ({ ...p, windowDays: Number(e.target.value) }))
            }
          />
        </label>
        <label className="block">
          Plazo de conservación aprobado (días, máximo técnico 3650)
          <input
            className={field}
            required
            type="number"
            min={value.windowDays || 1}
            max="3650"
            value={value.retentionDays || ""}
            onChange={(e) =>
              setValue((p) => ({ ...p, retentionDays: Number(e.target.value) }))
            }
          />
        </label>
        <h4 className="font-bold">Motivos y clasificación operativa</h4>
        {value.reasons.map((r, index) => (
          <div key={r.id} className="rounded-lg border p-2">
            <span>{r.label}</span>
            <label className="ml-2">
              <input
                type="checkbox"
                checked={r.requiresReview}
                disabled={PART_REASONS.some(
                  ([id, , mandatory]) => id === r.id && mandatory,
                )}
                onChange={(e) =>
                  setValue((p) => ({
                    ...p,
                    reasons: p.reasons.map((v, i) =>
                      i === index
                        ? { ...v, requiresReview: e.target.checked }
                        : v,
                    ),
                  }))
                }
              />
              Requiere revisión
            </label>
          </div>
        ))}
        <label className="block">
          Añadir motivo
          <input
            className={field}
            value={newReason}
            maxLength={120}
            onChange={(e) => setNewReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="min-h-[48px] rounded-xl border p-3 font-bold"
          disabled={!newReason.trim() || value.reasons.length >= 30}
          onClick={() => {
            setValue((p) => ({
              ...p,
              reasons: [
                ...p.reasons,
                {
                  id: "custom_" + crypto.randomUUID(),
                  label: newReason.trim(),
                  requiresReview: true,
                },
              ],
            }));
            setNewReason("");
          }}
        >
          Añadir al catálogo
        </button>
        <label className="flex gap-2">
          <input
            required
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          Confirmo que estos criterios y plazos han sido revisados por los
          responsables indicados.
        </label>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={busy || !ack}
          className="min-h-[48px] rounded-xl bg-[#00548E] p-3 font-bold text-white disabled:opacity-50"
        >
          Guardar política con trazabilidad
        </button>
      </form>
    </details>
  );
}
