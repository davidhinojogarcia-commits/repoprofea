import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { supabase } from '../src/lib/supabase';

const cleanDni = (value: unknown) => String(value ?? '').toUpperCase().replace(/[\s-]/g, '');
const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const RENUNCIA_LABEL = 'RENUNCIA · SAE 2100';
const RED_FILL_PDF: [number, number, number] = [254, 226, 226];
const RED_TEXT_PDF: [number, number, number] = [153, 27, 27];
const RED_FILL_EXCEL = 'FEE2E2';
const RED_TEXT_EXCEL = '991B1B';

const renouncedDnis = new Set<string>();
const renouncedNames = new Set<string>();

const rowText = (row: unknown): string => {
  if (!Array.isArray(row)) return String(row ?? '');
  return row.map((cell: any) => {
    if (cell && typeof cell === 'object' && 'content' in cell) return String(cell.content ?? '');
    return String(cell ?? '');
  }).join(' | ');
};

const isRenouncedRow = (value: unknown) => {
  const text = String(value ?? '');
  const normalizedText = normalize(text);
  for (const dni of renouncedDnis) if (dni && cleanDni(text).includes(dni)) return true;
  for (const name of renouncedNames) if (name && normalizedText.includes(name)) return true;
  return normalizedText.includes('renuncia sae 2100') || normalizedText.includes('renuncia · sae 2100');
};

const installPdfHighlight = () => {
  applyPlugin(jsPDF);
  (jsPDF as any).autoTableSetDefaults?.({
    didParseCell: (data: any) => {
      if (data?.section === 'head' && data?.cell) {
        const original = Array.isArray(data.cell.text) ? data.cell.text.join(' ').trim() : String(data.cell.text || '').trim();
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
      }

      if (data?.section !== 'body' || !data?.cell || !isRenouncedRow(rowText(data?.row?.raw))) return;
      data.cell.styles.fillColor = RED_FILL_PDF;
      data.cell.styles.textColor = RED_TEXT_PDF;
      data.cell.styles.fontStyle = 'bold';
      if (data.column?.index === 1) {
        const current = Array.isArray(data.cell.text) ? data.cell.text.join('\n') : String(data.cell.text || '');
        if (!normalize(current).includes('renuncia')) data.cell.text = [`${current}\n${RENUNCIA_LABEL}`];
      }
    },
  });
};

const installExcelHighlight = () => {
  const probe = new ExcelJS.Workbook().addWorksheet('__renuncia_probe__');
  const proto: any = Object.getPrototypeOf(probe);
  if (!proto || proto.__profeaRenunciaPatched) return;
  proto.__profeaRenunciaPatched = true;
  const originalAddRow = proto.addRow;
  proto.addRow = function(values: any, style?: any) {
    const row = originalAddRow.call(this, values, style);
    const text = Array.isArray(values) ? values.map(v => String(v ?? '')).join(' | ') : String(values ?? '');
    if (isRenouncedRow(text)) {
      row.eachCell({ includeEmpty: true }, (cell: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_FILL_EXCEL } };
        cell.font = { ...(cell.font || {}), color: { argb: RED_TEXT_EXCEL }, bold: true };
      });
      const lastCell = row.getCell(row.cellCount || (Array.isArray(values) ? values.length : 1));
      const current = String(lastCell.value ?? '');
      if (!normalize(current).includes('renuncia')) lastCell.value = current ? `${current}\n${RENUNCIA_LABEL}` : RENUNCIA_LABEL;
    }
    return row;
  };
};

export const ExportRenunciationEnhancer: React.FC = () => {
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await supabase.query('trabajadores', { query: 'select=dni,apellidos_nombre,data&order=updated_at.desc&limit=5000' });
        if (!active) return;
        renouncedDnis.clear();
        renouncedNames.clear();
        for (const row of rows || []) {
          const data = row.data || {};
          const isRenuncia = normalize(data.estadoContratacion) === 'renuncia' || String(data.codigoSaeResultado || '') === '2100';
          if (!isRenuncia) continue;
          const dni = cleanDni(row.dni || data.dni);
          const name = normalize(row.apellidos_nombre || data.apellidosNombre);
          if (dni) renouncedDnis.add(dni);
          if (name) renouncedNames.add(name);
        }
      } catch (error) {
        reportOperationalError('No se pudieron cargar renuncias para exportaciones', error, 'warn');
      }
    };
    installPdfHighlight();
    installExcelHighlight();
    void load();
    const handler = () => void load();
    window.addEventListener('profea:renuncias-updated', handler);
    return () => { active = false; window.removeEventListener('profea:renuncias-updated', handler); };
  }, []);
  return null;
};
