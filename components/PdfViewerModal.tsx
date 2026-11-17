import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ModalPortal from './ModalPortal';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Printer, 
  Download, 
  X, 
  FileText, 
  Maximize2, 
  Loader2, 
  AlertCircle,
  LayoutGrid,
  Check
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Worker empaquetado por Vite: el visor no depende de un CDN externo.
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

interface PdfViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string | null;
  title?: string;
  downloadFilename?: string;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  isOpen,
  onClose,
  pdfUrl,
  title = 'Visualizador de Documento PDF',
  downloadFilename = 'Documento_PROFEA.pdf'
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showThumbnails, setShowThumbnails] = useState<boolean>(false);
  const [useFallbackIframe, setUseFallbackIframe] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);

  // Load PDF Document
  useEffect(() => {
    if (!isOpen || !pdfUrl) return;

    let isMounted = true;
    setLoading(true);
    setError(null);
    setUseFallbackIframe(false);
    setCurrentPage(1);
    setPageInput('1');
    setScale(1.2);
    setRotation(0);

    const loadDocument = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });

        const doc = await loadingTask.promise;
        if (!isMounted) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err) {
        reportOperationalError('PDF.js rendering fallback triggered:', err, 'warn');
        if (isMounted) {
          setError('No se pudo usar la vista interactiva. Cargando visor predeterminado...');
          setUseFallbackIframe(true);
          setLoading(false);
        }
      }
    };

    loadDocument();

    return () => {
      isMounted = false;
    };
  }, [isOpen, pdfUrl]);

  // Sync page input field when page changes
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  // Render current page to Canvas
  const renderCurrentPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || useFallbackIframe) return;

    try {
      setLoading(true);
      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (!context) return;

      const pixelRatio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * pixelRatio, rotation });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Adjust CSS displayed dimensions
      canvas.style.width = `${viewport.width / pixelRatio}px`;
      canvas.style.height = `${viewport.height / pixelRatio}px`;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      await page.render(renderContext).promise;
      setLoading(false);
    } catch (err) {
      reportOperationalError('Error rendering page:', err);
      setLoading(false);
    }
  }, [pdfDoc, currentPage, scale, rotation, useFallbackIframe]);

  useEffect(() => {
    if (pdfDoc && isOpen) {
      renderCurrentPage();
    }
  }, [pdfDoc, currentPage, scale, rotation, isOpen, renderCurrentPage]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentPage(prev => Math.max(prev - 1, 1));
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrentPage(prev => Math.min(prev + 1, numPages));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, numPages, onClose]);

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(pageInput, 10);
    if (!isNaN(p) && p >= 1 && p <= numPages) {
      setCurrentPage(p);
    } else {
      setPageInput(currentPage.toString());
    }
  };

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.25, 3.0));
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => setScale(1.2);
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  // Trigger Print with App Navigation hidden
  const handlePrint = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 200);
  };

  if (!isOpen || !pdfUrl) return null;

  return (
    <ModalPortal label="PdfViewerModal"><div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col h-screen w-screen overflow-hidden font-sans select-none">
      {/* Top Viewer Header / Toolbar (hidden on print) */}
      <div className="bg-slate-900 border-b border-slate-800 text-slate-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg z-20 no-print">
        {/* Title / Document Info */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="truncate">
            <h2 className="text-sm font-bold text-slate-100 truncate max-w-xs sm:max-w-md">{title}</h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">
              {numPages > 0 ? `${numPages} ${numPages === 1 ? 'Página' : 'Páginas'}` : 'Documento PDF'} · PROFEA
            </p>
          </div>
        </div>

        {/* Navigation & Controls Bar (Only if PDF.js loaded) */}
        {!useFallbackIframe && numPages > 0 && (
          <div className="flex items-center gap-1 sm:gap-2 bg-slate-800/80 p-1 rounded-xl border border-slate-700/80">
            {/* Page Jump: First / Prev */}
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
              title="Primera página"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
              title="Página anterior (←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Page Selector Input */}
            <form onSubmit={handlePageSubmit} className="flex items-center gap-1.5 px-2">
              <span className="text-xs text-slate-400 hidden sm:inline">Página</span>
              <input
                type="text"
                value={pageInput}
                onChange={e => setPageInput(e.target.value)}
                onBlur={handlePageSubmit}
                className="w-10 text-center bg-slate-900 border border-slate-700 text-slate-100 text-xs py-1 rounded-md focus:outline-none focus:border-blue-500 font-mono font-bold"
              />
              <span className="text-xs text-slate-400">de {numPages}</span>
            </form>

            {/* Page Jump: Next / Last */}
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, numPages))}
              disabled={currentPage >= numPages}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
              title="Página siguiente (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(numPages)}
              disabled={currentPage >= numPages}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
              title="Última página"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

            {/* Zoom Controls */}
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-all cursor-pointer hidden sm:block"
              title="Alejar zoom (-)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs font-mono font-bold text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-all cursor-pointer hidden sm:block"
              title="Restablecer zoom a 100%"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-all cursor-pointer hidden sm:block"
              title="Acercar zoom (+)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

            {/* Rotation */}
            <button
              onClick={handleRotate}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-all cursor-pointer hidden sm:block"
              title="Rotar 90°"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Thumbnails Sidebar Toggle */}
            <button
              onClick={() => setShowThumbnails(!showThumbnails)}
              className={`p-1.5 rounded-lg transition-all cursor-pointer hidden md:block ${
                showThumbnails ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
              title="Ver lista de páginas"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Action Buttons: Print, Download, Close */}
        <div className="flex items-center gap-2">
          {/* Print Button */}
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-bold transition-all border border-slate-700 cursor-pointer shadow-sm active:scale-95"
            title="Imprimir documento (Oculta navegación de la app)"
          >
            <Printer className="w-4 h-4 text-blue-400" />
            <span className="hidden sm:inline">Imprimir</span>
          </button>

          {/* Download Button */}
          <a
            href={pdfUrl}
            download={downloadFilename}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#00548E] hover:bg-[#003B64] text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-[#00548E]/20 active:scale-95"
            title="Descargar archivo PDF"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Descargar</span>
          </a>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer border border-slate-700 active:scale-95"
            title="Cerrar visor"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Canvas / Viewer Body */}
      <div className="flex-1 flex overflow-hidden relative bg-slate-950">
        {/* Page Thumbnails Sidebar */}
        {showThumbnails && !useFallbackIframe && numPages > 0 && (
          <div className="w-48 bg-slate-900 border-r border-slate-800 p-3 overflow-y-auto space-y-3 z-10 custom-scrollbar no-print hidden md:block">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Páginas</p>
            {Array.from({ length: numPages }, (_, i) => i + 1).map(pNum => (
              <button
                key={pNum}
                onClick={() => setCurrentPage(pNum)}
                className={`w-full p-2 rounded-xl text-left transition-all border flex items-center justify-between text-xs font-semibold cursor-pointer ${
                  pNum === currentPage
                    ? 'bg-blue-600/20 border-blue-500 text-blue-400 shadow-sm'
                    : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>Página {pNum}</span>
                {pNum === currentPage && <Check className="w-3.5 h-3.5 text-blue-400" />}
              </button>
            ))}
          </div>
        )}

        {/* Central Document Display */}
        <div 
          ref={containerRef}
          className="flex-1 overflow-auto p-4 sm:p-8 flex items-center justify-center relative custom-scrollbar print:p-0 print:overflow-visible print:bg-white"
        >
          {loading && !useFallbackIframe && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-xs text-slate-200 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-xs font-semibold">Cargando página {currentPage}...</p>
            </div>
          )}

          {/* Render with Canvas (PDF.js) */}
          {!useFallbackIframe ? (
            <div className="relative shadow-2xl rounded-lg overflow-hidden bg-white max-w-full print:shadow-none print:rounded-none">
              <canvas ref={canvasRef} className="block mx-auto max-w-full h-auto" />
            </div>
          ) : (
            /* Fallback embedded iframe */
            <iframe
              src={pdfUrl}
              title="Vista de PDF"
              className="w-full h-full border-none bg-slate-900 rounded-xl shadow-inner"
            />
          )}
        </div>
      </div>

      {/* Hidden container specifically for printing all pages or clean document output */}
      <div className="hidden print:block print:fixed print:inset-0 print:bg-white print:z-[9999] print:p-0">
        <iframe
          src={pdfUrl}
          title="Documento Completo para Impresión"
          className="w-full h-screen border-none bg-white"
        />
      </div>
    </div></ModalPortal>
  );
};