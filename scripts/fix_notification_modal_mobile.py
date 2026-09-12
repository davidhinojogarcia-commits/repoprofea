from pathlib import Path

component = Path('components/PushNotificationManagerModal.tsx')
text = component.read_text()
footer = '''\n        {/* Footer */}\n        <div className="profea-notifications-footer px-6 py-4 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">\n          <span className="text-[11px] text-slate-500 font-medium">\n            Sistema PROFEA · Notificaciones Web Integradas con Service Worker\n          </span>\n          <button\n            onClick={onClose}\n            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 rounded-xl text-xs font-bold transition-all cursor-pointer"\n          >\n            Cerrar Modal\n          </button>\n        </div>\n'''
if footer not in text:
    raise SystemExit('Notification footer block not found')
text = text.replace(footer, '\n')
component.write_text(text)

css = Path('notification-modal-layout.css')
text = css.read_text()
text = text.replace('''\n  /* Footer stays visible above Safari/Chrome bottom UI instead of becoming part of\n     the scrolling content. */\n  #root [class~="fixed"][class~="inset-0"][class~="z-[110]"] > .max-w-4xl.rounded-3xl > :last-child {\n    flex: 0 0 auto !important;\n    padding: 0.75rem 0.875rem calc(0.75rem + env(safe-area-inset-bottom)) !important;\n    gap: 0.75rem !important;\n    background: rgba(241, 245, 249, 0.98) !important;\n  }\n\n  .dark #root [class~="fixed"][class~="inset-0"][class~="z-[110]"] > .max-w-4xl.rounded-3xl > :last-child {\n    background: rgba(15, 23, 42, 0.98) !important;\n  }\n\n  #root [class~="fixed"][class~="inset-0"][class~="z-[110]"] > .max-w-4xl.rounded-3xl > :last-child > span {\n    max-width: 62% !important;\n    line-height: 1.25 !important;\n  }\n\n  #root [class~="fixed"][class~="inset-0"][class~="z-[110]"] > .max-w-4xl.rounded-3xl > :last-child > button {\n    flex: 0 0 auto !important;\n    min-height: 2.5rem !important;\n  }\n''', '\n')
text = text.replace('#root .profea-notifications-diagnostics,\n#root .profea-notifications-footer { background: #f1f5f9 !important; }', '#root .profea-notifications-diagnostics { background: #f1f5f9 !important; }')
text = text.replace('\n.dark #root .profea-notifications-footer { background: #0f172a !important; border-color: #334155 !important; }\n', '\n')
text = text.replace('''\n  #root .profea-notifications-footer > span { display: none; }\n  #root .profea-notifications-footer { justify-content: flex-end !important; }\n''', '\n  #root .profea-notifications-body { padding-bottom: max(1rem, env(safe-area-inset-bottom)) !important; }\n')
css.write_text(text)
