import React, { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './InstitutionalDocumentActions.css';

/** Shared institutional action layout. Action callbacks and permission guards stay with the caller. */
export function InstitutionalDocumentActions({
  primary,
  secondary,
  hasPrimary = true,
}: {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  hasPrimary?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className="profea-institutional-document-actions min-w-0"
      aria-label="Acciones del documento"
      onKeyDown={event => {
        if (event.key === 'Escape' && expanded) {
          event.stopPropagation();
          setExpanded(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {hasPrimary && (
        <div className="profea-institutional-document-actions__primary" aria-label="Acciones principales">
          {primary}
        </div>
      )}
      <div className="profea-institutional-document-actions__secondary">
        <button
          type="button"
          ref={triggerRef}
          aria-expanded={expanded}
          aria-controls={contentId}
          className="profea-institutional-document-actions__toggle"
          onClick={() => setExpanded(current => !current)}
        >
          <span>Más acciones</span><ChevronDown aria-hidden="true" size={18} />
        </button>
        <div
          id={contentId}
          className={`profea-institutional-document-actions__secondary-grid ${expanded ? 'is-expanded' : ''}`}
          aria-label="Otras acciones del documento"
          onClick={event => {
            if ((event.target as HTMLElement).closest?.('button:not(:disabled)')) {
              setExpanded(false);
            }
          }}
        >
          {secondary}
        </div>
      </div>
    </div>
  );
}
