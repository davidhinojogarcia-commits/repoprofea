from pathlib import Path
import re

path = Path('components/SaeSection.tsx')
text = path.read_text(encoding='utf-8')

text = text.replace("import jsPDF from 'jspdf';", "import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';")

text = text.replace(
"  const [activeStep, setActiveStep] = useState(1);",
"""  const [activeStep, setActiveStep] = useState(1);
  const [previewReport, setPreviewReport] = useState<SaeReport | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewOffsetX, setPreviewOffsetX] = useState(0);
  const [previewOffsetY, setPreviewOffsetY] = useState(0);"""
)

start = text.index("  const prepareWorker = async (candidate: SaeCandidate) => {")
end = text.index("  const stepLabels =", start)
replacement = r'''  const registerWorker = async (candidate: SaeCandidate) => {
    if (!candidate.quincena) return onToast('Asigne primero una quincena.', 'error');
    const previous = people.find(p => norm(p.apellidosNombre) === norm(candidate.normalizedName));
    const workerId = Date.now() + Math.floor(Math.random() * 900000);
    const worker = {
      id: workerId,
      fechaRegistro: new Date().toISOString(),
      supervisorResponsable: previous?.supervisorResponsable || '',
      numOferta: candidate.offerNumber,
      obra: candidate.obra || selectedNeed?.obra || '',
      categoria: candidate.categoria || '',
      quincena: candidate.quincena,
      apellidosNombre: candidate.normalizedName,
      dni: previous?.dni || '',
      fechaNacimiento: previous?.fechaNacimiento || '',
      periodoInicio: '',
      periodoFin: '',
      telefono: previous?.telefono || '',
      calzado: previous?.calzado || '',
      formacion: previous?.formacion || 'No',
      lugarFormacion: previous?.lugarFormacion || '',
      citaDia: '', citaHora: '', sitioReconocimiento: '',
      documentacionCompleta: 'No',
      observaciones: `Contratación SAE · Oferta ${candidate.offerNumber} · Orden ${candidate.orderNumber}.`,
      necesitaReconocimiento: previous?.necesitaReconocimiento || 'No',
      sincronizadoEnNube: true,
    };
    try {
      await createDocument('trabajadores', workerId, worker as any);
      await patchCandidate(candidate, { estado: 'Contratado', resultCode: '2001', linkedWorkerId: workerId });
      onToast('Trabajador registrado y contratación SAE confirmada automáticamente (2001).', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo registrar al trabajador.', 'error');
    }
  };

  const mmToPt = (mm: number) => mm * 72 / 25.4;

  const buildReturnPdfBytes = async (report: SaeReport, offsetX = 0, offsetY = 0, requireComplete = true) => {
    const rows = candidates.filter(c => c.reportId === report.id);
    if (!rows.length) throw new Error('No hay candidatos asociados al informe.');
    if (requireComplete) {
      const pending = rows.filter(c => !c.resultCode);
      if (pending.length) throw new Error(`Quedan ${pending.length} candidatos sin código SAE.`);
    }
    if (!report.fileBase64.startsWith('data:application/pdf')) throw new Error('La devolución sobre original requiere que el informe de origen sea PDF.');

    const pdf = await PDFDocument.load(dataUrlToBytes(report.fileBase64));
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pages = pdf.getPages();
    for (const candidate of rows) {
      const page = pages[Math.max(0, candidate.pageNumber - 1)];
      if (!page) continue;
      const code = candidate.resultCode || (requireComplete ? '' : '2001');
      if (!code) continue;
      const x = mmToPt(candidate.overlayX + offsetX);
      const y = page.getHeight() - mmToPt(candidate.overlayY + offsetY) - 8;
      page.drawText(code, { x, y, size: 10, font, color: rgb(0, 0, 0) });
    }
    return pdf.save();
  };

  const downloadPdfBytes = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const generateReturnPdf = async (report: SaeReport) => {
    setBusy(true); setProgress('Generando PDF SAE sobre el original…');
    try {
      const bytes = await buildReturnPdfBytes(report, 0, 0, true);
      downloadPdfBytes(bytes, `SAE_CUMPLIMENTADO_${report.offerNumber || report.id}.pdf`);
      onToast('Documento SAE generado manteniendo intacto el PDF original.', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo generar el documento SAE.', 'error');
    } finally {
      setBusy(false); setProgress('');
    }
  };

  const refreshPreview = async (report: SaeReport, offsetX = previewOffsetX, offsetY = previewOffsetY) => {
    const bytes = await buildReturnPdfBytes(report, offsetX, offsetY, false);
    const nextUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return nextUrl; });
  };

  const openPreview = async (report: SaeReport) => {
    setPreviewReport(report);
    setPreviewOffsetX(0); setPreviewOffsetY(0);
    try { await refreshPreview(report, 0, 0); }
    catch (e: any) { setPreviewReport(null); onToast(e.message || 'No se pudo abrir la vista previa.', 'error'); }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(''); setPreviewReport(null); setPreviewOffsetX(0); setPreviewOffsetY(0);
  };

  const applyPreviewOffset = async () => {
    if (!previewReport) return;
    const rows = candidates.filter(c => c.reportId === previewReport.id);
    try {
      await Promise.all(rows.map(c => updateSaeCandidate(c.id, { overlayX: c.overlayX + previewOffsetX, overlayY: c.overlayY + previewOffsetY })));
      setCandidates(prev => prev.map(c => c.reportId === previewReport.id ? { ...c, overlayX: c.overlayX + previewOffsetX, overlayY: c.overlayY + previewOffsetY } : c));
      setPreviewOffsetX(0); setPreviewOffsetY(0);
      await refreshPreview(previewReport, 0, 0);
      onToast('Ajuste de posición guardado para este informe SAE.', 'success');
    } catch (e: any) {
      onToast(e.message || 'No se pudo guardar el ajuste.', 'error');
    }
  };

'''
text = text[:start] + replacement + text[end:]

old_buttons = '''                      {!c.linkedWorkerId && <button onClick={()=>void prepareWorker(c)} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold inline-flex items-center gap-1"><UserCheck className="w-4 h-4"/> Preparar registro</button>}
                      {c.linkedWorkerId && c.estado!=='Contratado' && <button onClick={()=>void confirmContract(c)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> Confirmar contratación</button>}'''
new_buttons = '''                      {c.estado!=='Contratado' && <button onClick={()=>void registerWorker(c)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1"><UserCheck className="w-4 h-4"/> Registrar nuevo trabajador</button>}
                      {c.estado==='Contratado' && <span className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> Contratado · SAE 2001</span>}'''
if old_buttons not in text:
    raise SystemExit('No se encontró bloque de botones de contratación')
text = text.replace(old_buttons, new_buttons, 1)

text = text.replace(
    'El candidato no se convierte en trabajador hasta preparar/enlazar su registro.',
    'El candidato se considera contratado en el momento en que se guarda como nuevo trabajador; se asigna automáticamente SAE 2001.'
)

old_report_button = '''<button onClick={()=>void generateReturnPdf(r)} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-bold text-xs"><Download className="w-4 h-4"/> Descargar devolución</button>'''
new_report_button = '''<div className="flex flex-wrap gap-2"><button onClick={()=>void openPreview(r)} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-bold text-xs"><FileText className="w-4 h-4"/> Vista previa / ajustar</button><button onClick={()=>void generateReturnPdf(r)} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-bold text-xs"><Download className="w-4 h-4"/> Descargar devolución</button></div>'''
if old_report_button not in text:
    raise SystemExit('No se encontró botón de devolución')
text = text.replace(old_report_button, new_report_button, 1)

modal = r'''

      {previewReport && (
        <div className="fixed inset-0 z-[180] bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) closePreview(); }}>
          <div className="w-full max-w-6xl h-[92vh] bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div><div className="font-black">Vista previa SAE · {previewReport.fileName}</div><div className="text-xs text-slate-500">Ajuste global en milímetros. La descarga final conserva el PDF original y añade únicamente los códigos.</div></div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold">X <input type="number" step="0.5" value={previewOffsetX} onChange={e=>{ const v=Number(e.target.value)||0; setPreviewOffsetX(v); void refreshPreview(previewReport,v,previewOffsetY); }} className="ui-input !w-20 !py-1.5 ml-1"/></label>
                <label className="text-xs font-bold">Y <input type="number" step="0.5" value={previewOffsetY} onChange={e=>{ const v=Number(e.target.value)||0; setPreviewOffsetY(v); void refreshPreview(previewReport,previewOffsetX,v); }} className="ui-input !w-20 !py-1.5 ml-1"/></label>
                <button onClick={()=>void applyPreviewOffset()} className="px-3 py-2 rounded-lg bg-[#00548E] text-white text-xs font-bold">Guardar posición</button>
                <button onClick={closePreview} className="px-3 py-2 rounded-lg border text-xs font-bold">Cerrar</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900">{previewUrl ? <iframe title="Vista previa documento SAE" src={previewUrl} className="w-full h-full border-0"/> : <div className="h-full grid place-items-center text-sm text-slate-500">Preparando vista previa…</div>}</div>
          </div>
        </div>
      )}
'''
marker = "    </div>\n  );\n};"
pos = text.rfind(marker)
if pos < 0:
    raise SystemExit('No se encontró cierre del componente')
text = text[:pos] + modal + text[pos:]

path.write_text(text, encoding='utf-8')
print('Mejoras SAE aplicadas')
