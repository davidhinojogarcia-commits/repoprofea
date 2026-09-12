from pathlib import Path

css_path = Path('notification-modal-layout.css')
css = css_path.read_text()
block = r'''

/* CAE AI review modal: explicit institutional header fallback.
   Tailwind's runtime arbitrary background variable can be omitted on first paint,
   leaving white text on a white surface. Keep the review header visible and pinned
   while the checklist body scrolls. */
#modal-review-ia-checklist-changes > div > :first-child {
  position: sticky !important;
  top: 0 !important;
  z-index: 30 !important;
  color: #ffffff !important;
  background-color: #00548e !important;
  background-image: linear-gradient(125deg, #071827 0%, #00548e 52%, #003f6b 100%) !important;
  box-shadow: 0 8px 24px rgba(7, 24, 39, 0.18) !important;
}

#modal-review-ia-checklist-changes > div > :first-child h3,
#modal-review-ia-checklist-changes > div > :first-child strong,
#modal-review-ia-checklist-changes > div > :first-child button,
#modal-review-ia-checklist-changes > div > :first-child svg {
  color: #ffffff !important;
  opacity: 1 !important;
  visibility: visible !important;
}

#modal-review-ia-checklist-changes > div > :first-child p {
  color: #dbeafe !important;
}

@media (max-width: 639px) {
  #modal-review-ia-checklist-changes > div > :first-child {
    padding: 0.875rem 1rem !important;
  }

  #modal-review-ia-checklist-changes > div > :first-child h3 {
    font-size: 0.95rem !important;
    line-height: 1.25rem !important;
  }
}
'''
if 'CAE AI review modal: explicit institutional header fallback.' not in css:
    css_path.write_text(css.rstrip() + block + '\n')

modal_path = Path('components/ChecklistReviewModal.tsx')
modal = modal_path.read_text()
old = 'className="bg-[var(--ui-gradient-brand)] p-5 text-white shrink-0"'
new = 'className="profea-cae-review-header bg-[var(--ui-gradient-brand)] p-5 text-white shrink-0"'
if old not in modal:
    raise SystemExit('Expected CAE review header class not found')
modal_path.write_text(modal.replace(old, new, 1))
