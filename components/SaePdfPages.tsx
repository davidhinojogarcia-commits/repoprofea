import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function SaePdfPages({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, entries[0].contentRect.width - 24)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    setError(''); setLoading(true); setDoc(null);
    const task = pdfjs.getDocument({ url });
    void task.promise.then(value => { if (active) setDoc(value); }).catch((e) => {
      console.warn('SAE PDF load failed', e);
      if (active) { setError('No se pudo cargar el PDF. Vuelva a abrir la previsualización.'); setLoading(false); }
    });
    return () => { active = false; void task.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let active = true;
    let render: pdfjs.RenderTask | undefined;
    setLoading(true); setError('');
    void doc.getPage(Math.min(page, doc.numPages)).then(pdfPage => {
      if (!active || !canvas.current) return;
      const scale = width / pdfPage.getViewport({ scale: 1 }).width * zoom;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: scale * ratio });
      const element = canvas.current;
      element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height);
      element.style.width = `${viewport.width / ratio}px`;
      element.style.height = `${viewport.height / ratio}px`;
      render = pdfPage.render({ canvas: element, viewport });
      return render.promise;
    }).then(() => { if (active) setLoading(false); }).catch(() => {
      if (active) { setError('No se pudo dibujar la página.'); setLoading(false); }
    });
    return () => { active = false; render?.cancel(); };
  }, [doc, page, width, zoom]);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center justify-center gap-2 p-2">
      <button type="button" className="min-h-11 rounded border px-3" disabled={!doc || page <= 1} onClick={() => setPage(p => p - 1)}>Página anterior</button>
      <span>Página {doc ? Math.min(page, doc.numPages) : 0} de {doc?.numPages || 0}</span>
      <button type="button" className="min-h-11 rounded border px-3" disabled={!doc || page >= doc.numPages} onClick={() => setPage(p => p + 1)}>Página siguiente</button>
      <button type="button" aria-label="Alejar PDF" className="min-h-11 rounded border px-3" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</button>
      <button type="button" className="min-h-11 rounded border px-3" onClick={() => setZoom(1)}>Ajustar ancho</button>
      <button type="button" aria-label="Acercar PDF" className="min-h-11 rounded border px-3" onClick={() => setZoom(z => Math.min(3, z + 0.25))}>+</button>
    </div>
    {loading && <p role="status">Preparando página…</p>}
    {error && <p role="alert">{error}</p>}
    <div ref={container} className="min-h-0 flex-1 overflow-auto p-3" style={{ touchAction: 'pan-x pan-y pinch-zoom', WebkitOverflowScrolling: 'touch' }}>
      <canvas ref={canvas} aria-label="Vista previa documento SAE" className="block bg-white shadow" />
    </div>
  </div>;
}
