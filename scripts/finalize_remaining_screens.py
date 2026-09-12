from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing pattern: {label}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# Registration: same institutional surface and quieter hierarchy.
# -----------------------------------------------------------------------------
p = Path('components/RegistrationForm.tsx')
s = p.read_text()
s = replace_once(
    s,
    '<div id="form-container" className="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 h-fit transition-all duration-300">',
    '<div id="form-container" className="ui-surface p-5 sm:p-6 md:p-8 text-slate-800 dark:text-slate-100 h-fit">',
    'registration shell'
)
s = replace_once(
    s,
    '<div className="flex items-center gap-3 mb-8 border-b border-slate-200 dark:border-slate-800 pb-4">\n        <div className="p-2 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-xl">\n          <UserCheck className="w-5 h-5 text-brand-primary dark:text-blue-400" />\n        </div>\n        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tight">REGISTRO CONTRATACIÓN</h2>\n      </div>',
    '<div className="flex items-start gap-3 mb-7 border-b border-slate-200 dark:border-slate-800 pb-5">\n        <div className="p-2.5 bg-[var(--ui-gradient-brand)] rounded-xl text-white shadow-sm">\n          <UserCheck className="w-5 h-5" />\n        </div>\n        <div>\n          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--ui-brand-700)]">Operativa</div>\n          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">Nueva contratación</h2>\n          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Alta de trabajador y datos necesarios para su incorporación PROFEA.</p>\n        </div>\n      </div>',
    'registration header'
)
p.write_text(s)

# -----------------------------------------------------------------------------
# Directory: remove heavy legacy shadows and use common surfaces.
# -----------------------------------------------------------------------------
p = Path('components/PersonListView.tsx')
s = p.read_text()
s = s.replace(
    'className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl h-full flex flex-col items-center justify-center text-center text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800"',
    'className="ui-surface p-8 h-full flex flex-col items-center justify-center text-center text-slate-800 dark:text-slate-100"',
    1
)
s = s.replace(
    'className="bg-white dark:bg-slate-900 p-4 sm:p-6 lg:p-8 rounded-2xl shadow-xl text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800"',
    'className="ui-surface p-4 sm:p-6 lg:p-8 text-slate-800 dark:text-slate-100"',
    1
)
s = s.replace(
    'className="text-[#00548E] dark:text-blue-400 text-2xl font-bold flex items-center"',
    'className="text-[var(--ui-text)] text-xl sm:text-2xl font-black tracking-tight flex items-center"',
    1
)
s = s.replace('<User className="w-8 h-8 mr-3" /> Registros ({people.length})', '<span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--ui-gradient-brand)] text-white mr-3"><User className="w-5 h-5" /></span> Directorio ({people.length})', 1)
p.write_text(s)

# -----------------------------------------------------------------------------
# Calendar: common surface language; keep status colors for actual events.
# -----------------------------------------------------------------------------
p = Path('components/CalendarioIntegrado.tsx')
s = p.read_text()
s = s.replace(
    'className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"',
    'className="ui-surface p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4"',
    1
)
s = s.replace(
    'className="p-2.5 bg-gradient-to-br from-[#00548E] to-blue-700 text-white rounded-2xl shadow-md"',
    'className="p-2.5 bg-[var(--ui-gradient-brand)] text-white rounded-xl shadow-sm"',
    1
)
s = s.replace(
    'className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4"',
    'className="ui-surface p-5 space-y-4"',
    1
)
p.write_text(s)

# -----------------------------------------------------------------------------
# Medical appointments: retain the branded hero, but make it the shared gradient
# and normalize the functional cards underneath.
# -----------------------------------------------------------------------------
p = Path('components/GestionCitas.tsx')
s = p.read_text()
s = s.replace(
    'className="bg-gradient-to-r from-[#00548E] to-blue-800 text-white rounded-3xl p-6 sm:p-8 shadow-md relative overflow-hidden"',
    'className="bg-[var(--ui-gradient-brand)] text-white rounded-[var(--ui-radius-xl)] p-6 sm:p-8 shadow-[var(--ui-shadow-md)] relative overflow-hidden"',
    1
)
s = s.replace(
    'className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-2 shadow-xs flex flex-col sm:flex-row gap-2"',
    'className="ui-surface p-2 flex flex-col sm:flex-row gap-2"',
    1
)
s = s.replace(
    'className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in duration-300"',
    'className="ui-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"',
    1
)
s = s.replace(
    'className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6"',
    'className="ui-surface p-6 space-y-6"',
    1
)
p.write_text(s)

# -----------------------------------------------------------------------------
# Settings: use the shared PageHeader and common active navigation treatment.
# -----------------------------------------------------------------------------
p = Path('components/Configuracion.tsx')
s = p.read_text()
import_anchor = "import { downloadPDF } from '../src/lib/exportUtils';\n"
if "import { PageHeader } from './ui/PageHeader';" not in s:
    s = replace_once(s, import_anchor, import_anchor + "import { PageHeader } from './ui/PageHeader';\n", 'settings PageHeader import')
old_header = '''      <div className="mb-8">\n        <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-3">\n          <div className="bg-brand-primary p-2 rounded-xl shadow-lg shadow-brand-primary/20">\n            <Settings className="w-8 h-8 text-white" />\n          </div>\n          Configuración de Autocompletado\n        </h1>\n        <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">\n          Gestione las listas de sugerencias que se guardan automáticamente durante el uso de la aplicación.\n        </p>\n      </div>'''
new_header = '''      <PageHeader\n        eyebrow="Sistema"\n        title="Configuración"\n        description="Catálogos, jornada laboral, recursos de obra y copias de seguridad de PROFEA."\n        icon={<Settings className="w-5 h-5" />}\n        className="mb-8"\n      />'''
s = replace_once(s, old_header, new_header, 'settings header')
s = s.replace("? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20'", "? 'profea-sidebar-item--active text-white'", 3)
p.write_text(s)

# -----------------------------------------------------------------------------
# Trash: PageHeader + destructive action; amber remains only on expiring records.
# -----------------------------------------------------------------------------
p = Path('components/Papelera.tsx')
s = p.read_text()
if "import { PageHeader } from './ui/PageHeader';" not in s:
    s = replace_once(s, "import { supabase } from '../src/lib/supabase';\n", "import { supabase } from '../src/lib/supabase';\nimport { PageHeader } from './ui/PageHeader';\n", 'trash PageHeader import')
start = s.find('      {/* Informative Header Card */}')
end = s.find('\n\n      {/* Control Bar: Search and Stats */}', start)
if start == -1 or end == -1:
    raise SystemExit('Trash header boundaries not found')
new = '''      <PageHeader\n        eyebrow="Sistema"\n        title="Papelera"\n        description="Los registros eliminados permanecen disponibles para restauración durante 30 días antes de su eliminación definitiva."\n        icon={<Trash2 className="w-5 h-5" />}\n        actions={deletedPeople.length > 0 ? (\n          <button\n            onClick={() => setConfirmEmptyOpen(true)}\n            disabled={emptyingTrash}\n            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"\n            title="Vaciar papelera permanentemente"\n          >\n            <Trash2 className="w-4 h-4" />\n            {emptyingTrash ? 'Vaciando…' : 'Vaciar Papelera'}\n          </button>\n        ) : undefined}\n      />'''
s = s[:start] + new + s[end:]
s = s.replace('className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary dark:text-slate-100 transition-all shadow-sm"', 'className="ui-field pl-10 pr-4 py-2.5 text-sm"', 1)
s = s.replace('className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center shadow-sm"', 'className="ui-surface p-12 text-center"', 1)
s = s.replace('className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800/80 overflow-hidden"', 'className="ui-surface overflow-hidden"', 1)
p.write_text(s)

# -----------------------------------------------------------------------------
# Administration: shared PageHeader/surfaces without changing permission logic.
# -----------------------------------------------------------------------------
p = Path('components/AdminPanel.tsx')
s = p.read_text()
if "import {PageHeader} from './ui/PageHeader';" not in s:
    s = replace_once(s, "import {AdminShareManager} from './AdminShareManager';\n", "import {AdminShareManager} from './AdminShareManager';\nimport {PageHeader} from './ui/PageHeader';\n", 'admin PageHeader import')
old = '<header className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm px-5 py-4 flex items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-primary text-white p-2.5"><ShieldCheck size={22}/></div><div><h1 className="text-2xl font-bold">Administración</h1><p className="text-sm text-slate-500">Usuarios, permisos, compartición y auditoría</p></div></div>{onClose&&<button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20}/></button>}</header>'
new = '<PageHeader eyebrow="Sistema" title="Administración" description="Usuarios, permisos, compartición y trazabilidad de la actividad." icon={<ShieldCheck size={20}/>} actions={onClose?<button type="button" onClick={onClose} className="ui-button-ghost px-3 py-2" aria-label="Cerrar administración"><X size={20}/></button>:undefined}/>'
s = replace_once(s, old, new, 'admin header')
s = s.replace('className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 flex flex-wrap gap-2"', 'className="ui-surface p-2 flex flex-wrap gap-2"', 1)
s = s.replace('className="min-w-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-5 lg:p-6 relative min-h-[420px]"', 'className="ui-surface min-w-0 p-4 sm:p-5 lg:p-6 relative min-h-[420px]"', 1)
p.write_text(s)

print('Remaining screen visual convergence applied successfully.')
