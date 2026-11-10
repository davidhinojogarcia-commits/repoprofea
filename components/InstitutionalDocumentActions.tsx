import React, { useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import './InstitutionalDocumentActions.css';

/**
 * Shared institutional action layout for supervisor document cards.
 * Child actions retain their own handlers, disabled states and permission checks.
 */
export function InstitutionalDocumentActions({
  primary,
  secondary,
  hasPrimary = true,
}: {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  hasPrimary?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  return (
    <div className="profea-institutional-document-actions min-w-0" aria-label="Acciones del documento">
      {hasPrimary && <div className="profea-institutional-document-actions__primary" aria-label="Acciones principales">{primary}</div>}
      <details
        ref={detailsRef}
        className="profea-institutional-document-actions__secondary"
        onKeyDown={event => {
          if (event.key === 'Escape' && detailsRef.current?.open) {
            detailsRef.current.open = false;
            summaryRef.current?.focus();
            event.stopPropagation();
          }
        }}
        onClickCapture={event => {
          if (!(event.target instanceof Element)) return;
          const action = event.target.closest('button');
          if (action && !action.disabled && detailsRef.current?.open) {
            detailsRef.current.open = false;
          }
        }}
      >
        <summary ref={summaryRef} className="profea-institutional-document-actions__toggle">
          <span>Más acciones</span><ChevronDown aria-hidden="true" size={18} />
        </summary>
        <div className="profea-institutional-document-actions__secondary-grid" aria-label="Otras acciones del documento">{secondary}</div>
      </details>
    </div>
  );
}
