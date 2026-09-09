import React from 'react';

interface PrintHeaderProps {
  title?: string;
  subtitle?: string;
}

export const PrintHeader: React.FC<PrintHeaderProps> = ({
  title = "SISTEMA DE CONTRATACIÓN Y GESTIÓN PROFEA",
  subtitle = "Informe Oficial de Control y Registro Administrativo"
}) => {
  const currentDate = new Date().toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  return (
    <div className="hidden print:flex print-only-header flex-row items-center justify-between w-full pb-3 mb-4 border-b-2 border-[#00548E]">
      <div className="flex items-center gap-3">
        <img 
          src="/logo-diputacion-profea.svg" 
          alt="Diputación de Cádiz - PROFEA" 
          className="h-12 w-auto object-contain print-logo"
        />
        <div>
          <h1 className="text-xs font-black uppercase text-slate-900 tracking-wider">
            EXCMA. DIPUTACIÓN PROVINCIAL DE CÁDIZ
          </h1>
          <p className="text-[10px] font-bold text-[#00548E] uppercase tracking-wider">
            ÁREA DE COOPERACIÓN · PROGRAMA PROFEA
          </p>
        </div>
      </div>

      <div className="text-right">
        <h2 className="text-[10px] font-black uppercase tracking-wider text-slate-800">
          {title}
        </h2>
        <p className="text-[9px] text-slate-600 font-medium mt-0.5">
          {subtitle}
        </p>
        <p className="text-[8px] font-mono text-slate-500 mt-0.5">
          Emisión: {currentDate} | Documento Oficial
        </p>
      </div>
    </div>
  );
};
