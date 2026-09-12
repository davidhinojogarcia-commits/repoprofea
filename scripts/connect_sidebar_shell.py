from pathlib import Path
p = Path('components/Sidebar.tsx')
s = p.read_text()
old = "fixed lg:sticky top-0 left-0 z-50 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-300 flex flex-col no-print app-navigation-panel"
new = "fixed lg:sticky top-0 left-0 z-50 h-screen border-r border-slate-200/80 dark:border-slate-800 shadow-sm transition-all duration-300 flex flex-col no-print app-navigation-panel profea-sidebar-shell"
if old not in s:
    raise SystemExit('sidebar shell class not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('Sidebar shell connected to design system.')
