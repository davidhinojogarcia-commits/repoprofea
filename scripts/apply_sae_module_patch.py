from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'No se encontró ancla para {label}')
    return text.replace(old, new, 1)

app_path = Path('App.tsx')
app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "const SubcontratasSection = lazy(() => import('./components/SubcontratasSection').then(module => ({ default: module.SubcontratasSection })));\nconst AdminPanel",
    "const SubcontratasSection = lazy(() => import('./components/SubcontratasSection').then(module => ({ default: module.SubcontratasSection })));\nconst SaeSection = lazy(() => import('./components/SaeSection').then(module => ({ default: module.SaeSection })));\nconst AdminPanel",
    'lazy SAE',
)
anchor = """          {activeView === 'subcontratas' && (\n            <Suspense fallback={<ViewLoadingFallback />}>\n            <div className=\"w-full max-w-[1600px] mx-auto min-w-0\">\n              <SubcontratasSection\n                savedObras={savedObras}\n                onUpdateSavedObras={setSavedObras}\n                supervisoresDisponibles={supervisoresDisponibles}\n                onToast={(message, type) => setToast({ message, type })}\n              />\n            </div>\n            </Suspense>\n          )}\n"""
sae_block = anchor + """\n          {activeView === 'sae' && (\n            <Suspense fallback={<ViewLoadingFallback />}>\n            <div className=\"w-full max-w-[1600px] mx-auto min-w-0\">\n              <SaeSection\n                people={visiblePeople}\n                onToast={(message, type) => setToast({ message, type })}\n              />\n            </div>\n            </Suspense>\n          )}\n"""
app = replace_once(app, anchor, sae_block, 'vista SAE')
app_path.write_text(app, encoding='utf-8')

sidebar_path = Path('components/Sidebar.tsx')
sidebar = sidebar_path.read_text(encoding='utf-8')
sidebar = replace_once(
    sidebar,
    "import { LayoutDashboard, UserPlus, Users, Menu, ChevronLeft, Filter, MapPin, Clock, Search, Settings, Trash2, Camera, Calendar, CalendarDays, HardHat, ShieldCheck, LogOut, Loader2 } from 'lucide-react';",
    "import { LayoutDashboard, UserPlus, Users, Menu, ChevronLeft, Filter, MapPin, Clock, Search, Settings, Trash2, Camera, Calendar, CalendarDays, HardHat, BriefcaseBusiness, ShieldCheck, LogOut, Loader2 } from 'lucide-react';",
    'icono SAE',
)
sidebar = replace_once(
    sidebar,
    "export type ViewMode = 'dashboard' | 'calendario' | 'registro' | 'directorio' | 'estadisticas' | 'configuracion' | 'papelera' | 'citas' | 'subcontratas' | 'administracion';",
    "export type ViewMode = 'dashboard' | 'calendario' | 'registro' | 'sae' | 'directorio' | 'estadisticas' | 'configuracion' | 'papelera' | 'citas' | 'subcontratas' | 'administracion';",
    'ViewMode SAE',
)
sidebar = replace_once(
    sidebar,
    "        { id: 'registro', label: 'Nuevo Registro', icon: UserPlus },\n        { id: 'directorio', label: 'Directorio', icon: Users },",
    "        { id: 'registro', label: 'Nuevo Registro', icon: UserPlus },\n        { id: 'sae', label: 'SAE', icon: BriefcaseBusiness },\n        { id: 'directorio', label: 'Directorio', icon: Users },",
    'menu SAE',
)
sidebar_path.write_text(sidebar, encoding='utf-8')

sae_path = Path('components/SaeSection.tsx')
sae = sae_path.read_text(encoding='utf-8')
sae = sae.replace(
    "await page.render({ canvasContext: ctx, viewport }).promise;",
    "await page.render({ canvas, canvasContext: ctx, viewport }).promise;",
)
sae_path.write_text(sae, encoding='utf-8')

print('SAE integrado en App.tsx y Sidebar.tsx; PDF renderer actualizado')
