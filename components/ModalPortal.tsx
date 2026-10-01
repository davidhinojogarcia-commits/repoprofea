import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

let bodyLockCount = 0;
let originalBodyOverflow = '';
let modalLayerSequence = 0;
const MODAL_LAYER_BASE = 2_000_000_000;
const MODAL_LAYER_STEP = 10;

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const ModalPortal: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<number>(0);
  if (!layerRef.current) {
    modalLayerSequence += 1;
    layerRef.current = MODAL_LAYER_BASE + (modalLayerSequence * MODAL_LAYER_STEP);
  }

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (bodyLockCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('profea-modal-open');
    }
    bodyLockCount += 1;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const first = rootRef.current?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) {
        document.body.style.overflow = originalBodyOverflow;
        document.body.classList.remove('profea-modal-open');
      }
      previousFocus?.focus?.();
    };
  }, []);

  if (typeof document === 'undefined') return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const nodes = Array.from((rootRef.current?.querySelectorAll(focusableSelector) ?? []) as NodeListOf<HTMLElement>)
      .filter(node => !node.hasAttribute('disabled') && node.tabIndex !== -1);
    if (!nodes.length) {
      event.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      ref={rootRef}
      className="profea-modal-overlay fixed inset-0 isolate pointer-events-auto"
      style={{ zIndex: layerRef.current }}
      role="presentation"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
};

export default ModalPortal;
