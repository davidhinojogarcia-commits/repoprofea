import React, { useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import { hydrateStoredPdfConfig } from '../src/lib/exportUtils';

let initialized = false;

const applyPdfRuntimeDefaults = () => {
  if (initialized) return;
  initialized = true;
  applyPlugin(jsPDF);
  (jsPDF as any).autoTableSetDefaults?.({
    didParseCell: (data: any) => {
      if (data?.section !== 'head' || !data?.cell) return;
      const original = Array.isArray(data.cell.text)
        ? data.cell.text.join(' ').trim()
        : String(data.cell.text || '').trim();
      const normalized = original.toUpperCase().replace(/\s+/g, ' ');
      const replacements: Record<string, string> = {
        'CONF.': 'CONFIRMACIÓN',
        'CONF': 'CONFIRMACIÓN',
        'TRABAJADOR / DNI / NAC.': 'TRABAJADOR / DNI / NACIMIENTO',
        'TRABAJADOR/DNI/NAC.': 'TRABAJADOR / DNI / NACIMIENTO',
        'SITIO RECONOCIMIENTO': 'SITIO RECONOCIMIENTO MÉDICO',
      };
      const completeText = replacements[normalized] || original;
      data.cell.text = [completeText];
      const words = completeText.split(/\s+/).filter(Boolean);
      const longestWord = words.reduce((max: number, word: string) => Math.max(max, word.length), 0);
      data.cell.styles.overflow = 'linebreak';
      data.cell.styles.halign = 'center';
      data.cell.styles.valign = 'middle';
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.cellPadding = 1.15;
      data.cell.styles.minCellHeight = Math.max(Number(data.cell.styles.minCellHeight || 0), 9);
      if (completeText.length >= 30 || longestWord >= 16) data.cell.styles.fontSize = 5.6;
      else if (completeText.length >= 20 || longestWord >= 12) data.cell.styles.fontSize = 6.0;
      else data.cell.styles.fontSize = 6.5;
    },
  });
};

export default function PdfRuntimeInitializer() {
  useEffect(() => {
    applyPdfRuntimeDefaults();
    void hydrateStoredPdfConfig().catch(error =>
      console.warn('No se pudo precargar la configuración PDF:', error),
    );
  }, []);
  return null;
}
