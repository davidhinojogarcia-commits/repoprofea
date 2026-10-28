import React from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useHandwrittenSignature } from "../src/hooks/useHandwrittenSignature";
export const SignaturePad: React.FC<{
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, name, value, onChange }) => {
  const { ref, handlers, clear, error } = useHandwrittenSignature({
    value,
    onChange,
  });

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="font-black text-sm">{label}</div>
          <div className="text-xs text-slate-500">
            {name || "Nombre pendiente"}
          </div>
        </div>
        {value && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
            Firmado
          </span>
        )}
      </div>
      <canvas
        ref={ref}
        {...handlers}
        aria-label={label}
        className="w-full h-[165px] rounded-xl border-2 border-slate-300 bg-white touch-none"
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-2 flex justify-between gap-2">
        <span className="text-xs text-slate-500">
          Firmar con el dedo o lápiz táctil
        </span>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Borrar
        </button>
      </div>
    </div>
  );
};
