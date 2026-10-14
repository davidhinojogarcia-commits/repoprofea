import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { exportSignaturePng, SIGNATURE_INK_COLOR, SIGNATURE_LINE_WIDTH } from '../lib/signatureInk';

export function useHandwrittenSignature(options: { value?: string; onChange?: (value: string) => void; disabled?: boolean } = {}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const active = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const exported = useRef('');
  const restoreGeneration = useRef(0);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let configured = false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
      if (configured && canvas.width === width && canvas.height === height) return;
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d')?.drawImage(canvas, 0, 0);
      canvas.width = width; canvas.height = height; active.current = null;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) { setError('No se pudo preparar el panel de firma.'); return; }
      configured = true;
      ctx.strokeStyle = SIGNATURE_INK_COLOR; ctx.fillStyle = SIGNATURE_INK_COLOR;
      ctx.lineWidth = SIGNATURE_LINE_WIDTH * ratio; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const scale = Math.min(1, width / copy.width, height / copy.height);
      ctx.drawImage(copy, (width-copy.width*scale)/2, (height-copy.height*scale)/2, copy.width*scale, copy.height*scale);
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    return () => { observer?.disconnect(); active.current = null; };
  }, []);
  useEffect(() => {
    if (options.value === undefined || options.value === exported.current) return;
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let cancelled = false;
    const generation = ++restoreGeneration.current;
    const value = options.value;
    // Clearing externally or changing the worker must clear the old pixels as well.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    active.current = null; setHasInk(false);
    if (!value) { exported.current = ''; return; }
    const image = new Image();
    image.onload = () => {
      if (cancelled || generation !== restoreGeneration.current) return;
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      ctx.drawImage(image, (canvas.width-image.width*scale)/2, (canvas.height-image.height*scale)/2, image.width*scale, image.height*scale);
      exported.current = value; setHasInk(true); setError('');
    };
    image.onerror = () => { if (!cancelled && generation === restoreGeneration.current) setError('No se pudo recuperar la imagen de la firma.'); };
    image.src = value;
    return () => { cancelled = true; };
  }, [options.value]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget, box = canvas.getBoundingClientRect();
    // Map into the backing bitmap even after a responsive/orientation layout change.
    return { x: (event.clientX - box.left) * canvas.width / box.width, y: (event.clientY - box.top) * canvas.height / box.height };
  };
  const finish = (event: PointerEvent<HTMLCanvasElement>, dot: boolean) => {
    const stroke = active.current;
    if (!stroke || stroke.id !== event.pointerId) return;
    if (dot && !stroke.moved) {
      const ctx = event.currentTarget.getContext('2d');
      if (ctx) { ctx.beginPath(); ctx.arc(stroke.x, stroke.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
    }
    active.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const value = exportSignaturePng(event.currentTarget);
    exported.current = value; setHasInk(Boolean(value)); options.onChange?.(value);
  };
  const clear = () => {
    const canvas = ref.current;
    if (!canvas || options.disabled) return;
    active.current = null; restoreGeneration.current++;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    exported.current = ''; setHasInk(false); setError(''); options.onChange?.('');
  };
  return { ref, hasInk, error, clear, exportPng: (trim = false) => ref.current ? exportSignaturePng(ref.current, trim) : '', handlers: {
    onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => {
      if (options.disabled || active.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
      restoreGeneration.current++;
      event.preventDefault(); active.current = { id: event.pointerId, ...point(event), moved: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => {
      const stroke = active.current;
      if (options.disabled || !stroke || stroke.id !== event.pointerId) return;
      event.preventDefault(); const ctx = event.currentTarget.getContext('2d');
      if (!ctx) return;
      const next = point(event);
      ctx.beginPath(); ctx.moveTo(stroke.x, stroke.y); ctx.lineTo(next.x, next.y); ctx.stroke();
      active.current = { id: stroke.id, ...next, moved: true }; setHasInk(true);
    },
    onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => finish(event, true),
    onPointerCancel: (event: PointerEvent<HTMLCanvasElement>) => finish(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLCanvasElement>) => finish(event, false),
  } };
}
