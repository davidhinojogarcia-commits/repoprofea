from pathlib import Path

view = Path('components/PersonListView.tsx')
text = view.read_text()

text = text.replace(
    '<div className="ui-surface p-4 sm:p-6 lg:p-8 text-slate-800 dark:text-slate-100">',
    '<div id="directorio-section" className="ui-surface p-4 sm:p-6 lg:p-8 text-slate-800 dark:text-slate-100">',
    1,
)
text = text.replace(
    'className="flex flex-wrap gap-2 justify-end items-center"',
    'className="directorio-primary-actions flex flex-wrap gap-2 justify-end items-center"',
    1,
)
text = text.replace(
    'className="flex-1 md:flex-none flex items-center justify-center bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-300 px-4 py-2 rounded-lg transition-colors text-sm font-semibold shadow-sm border border-blue-200 dark:border-blue-800/80 cursor-pointer"',
    'className="directorio-import-button flex-1 md:flex-none flex items-center justify-center bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-300 px-4 py-2 rounded-lg transition-colors text-sm font-semibold shadow-sm border border-blue-200 dark:border-blue-800/80 cursor-pointer"',
    1,
)
text = text.replace(
    'className="flex flex-wrap gap-2 justify-end border-t pt-2 border-slate-200 dark:border-slate-800"',
    'className="directorio-export-groups flex flex-wrap gap-2 justify-end border-t pt-2 border-slate-200 dark:border-slate-800"',
    1,
)
# Export rows: Reconocimientos, Calzado and PRL.
export_start = text.find('directorio-export-groups')
if export_start < 0:
    raise SystemExit('directorio export group not found')
head, tail = text[:export_start], text[export_start:]
tail = tail.replace('className="flex items-center justify-end gap-2"', 'className="directorio-export-row flex items-center justify-end gap-2"', 3)
text = head + tail
view.write_text(text)

css = Path('dark-mode-hardening.css')
styles = css.read_text()
marker = '/* Directorio mobile action layout */'
if marker not in styles:
    styles += r'''

/* Directorio mobile action layout */
#directorio-section .directorio-primary-actions button,
#directorio-section .directorio-export-row button {
  min-width: 0;
  white-space: normal;
  word-break: normal;
  overflow-wrap: normal;
  text-wrap: balance;
}

@media (max-width: 767px) {
  #directorio-section {
    padding: 1rem !important;
    overflow: hidden;
  }

  #directorio-section > div:first-child {
    align-items: stretch !important;
  }

  #directorio-section h2 {
    width: 100%;
    justify-content: center;
    text-align: center;
  }

  #directorio-section .directorio-primary-actions {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: .65rem !important;
    justify-content: stretch !important;
  }

  #directorio-section .directorio-primary-actions > button {
    width: 100% !important;
    min-height: 3rem;
    padding: .65rem .75rem !important;
    font-size: .82rem !important;
    line-height: 1.05rem !important;
    border-radius: .9rem !important;
  }

  #directorio-section .directorio-import-button {
    grid-column: 1 / -1;
  }

  #directorio-section .directorio-export-groups {
    width: 100%;
    padding-top: .9rem !important;
    gap: .75rem !important;
  }

  #directorio-section .directorio-export-groups > div {
    width: 100% !important;
  }

  #directorio-section .directorio-export-row {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: .55rem !important;
    align-items: stretch !important;
  }

  #directorio-section .directorio-export-row > span {
    grid-column: 1 / -1;
    margin: 0 0 .05rem 0 !important;
    font-size: .68rem !important;
    line-height: .9rem !important;
    letter-spacing: .035em;
  }

  #directorio-section .directorio-export-row > button {
    width: 100% !important;
    min-height: 2.8rem;
    padding: .55rem .65rem !important;
    font-size: .72rem !important;
    line-height: .95rem !important;
    border-radius: .8rem !important;
  }

  #directorio-section .directorio-primary-actions svg,
  #directorio-section .directorio-export-row svg {
    flex: 0 0 auto;
  }
}
'''
css.write_text(styles)
