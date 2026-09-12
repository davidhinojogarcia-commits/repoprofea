from pathlib import Path

path = Path('components/Stats.tsx')
text = path.read_text()

text = text.replace(
"import { MultiSearchableDropdown } from './MultiSearchableDropdown';\n",
"import { MultiSearchableDropdown } from './MultiSearchableDropdown';\nimport { PageHeader } from './ui/PageHeader';\nimport { BUTTON_PRIMARY, BUTTON_SECONDARY } from '../constants';\n",
1,
)

text = text.replace(
"    <div className=\"space-y-6 mb-8\">\n      {/* Controles de Filtro */}",
"    <div className=\"space-y-6 mb-8\">\n      <PageHeader\n        eyebrow=\"Gestión PROFEA\"\n        title=\"Centro de Control\"\n        description=\"Situación operativa de contrataciones, formación, reconocimientos y distribución por obra.\"\n        icon={<BarChart3 className=\"h-5 w-5\" />}\n      />\n\n      {/* Controles de Filtro */}",
1,
)

text = text.replace(
"<div className=\"bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800/80\">",
"<div className=\"ui-surface p-5 sm:p-6\">",
1,
)

text = text.replace(
"<h2 className=\"text-lg font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tight\">Resumen de Gestión</h2>\n              <p className=\"text-slate-400 dark:text-slate-500 text-xs\">Filtra y analiza la evolución de contrataciones PROFEA</p>",
"<h2 className=\"text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight\">Filtros y acciones</h2>\n              <p className=\"text-slate-400 dark:text-slate-500 text-xs\">Acota la información y genera los informes institucionales desde una única zona.</p>",
1,
)

text = text.replace(
"className=\"w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-emerald-500/15 cursor-pointer\"",
"className={`${BUTTON_SECONDARY} w-full sm:w-auto text-xs uppercase tracking-wider`}",
1,
)
text = text.replace(
"className=\"w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-blue-500/10 cursor-pointer\"",
"className={`${BUTTON_PRIMARY} w-full sm:w-auto text-xs uppercase tracking-wider`}",
1,
)
text = text.replace(
"className=\"w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-amber-500/15 cursor-pointer\"",
"className={`${BUTTON_SECONDARY} w-full sm:w-auto text-xs uppercase tracking-wider`}",
1,
)

# Migrate repeated KPI cards to the common surface while preserving chart/layout logic.
text = text.replace(
"bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-300",
"ui-surface p-5 hover:shadow-md transition-all duration-200",
)

# Use shared field treatment for date controls.
text = text.replace(
"className=\"p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand-primary text-xs font-medium text-slate-700 dark:text-slate-200\"",
"className=\"ui-field px-3 py-2 text-xs font-medium\"",
)

path.write_text(text)
print('Stats converted toward the shared Control Center visual language.')
