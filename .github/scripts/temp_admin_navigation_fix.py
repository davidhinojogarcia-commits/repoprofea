from pathlib import Path

# AuthGate becomes authentication-only shell and exposes authenticated role/sign-out controls.
p = Path('components/AuthGate.tsx')
s = p.read_text()
s = s.replace("import { Eye, EyeOff, Loader2, LogIn, LogOut, ShieldCheck } from 'lucide-react';", "import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';")
s = s.replace("\nconst AdminPanel = React.lazy(() => import('./AdminPanel').then(module => ({ default: module.AdminPanel })));\n", "\n")
s = s.replace("  const [adminOpen, setAdminOpen] = useState(false);\n", "")
s = s.replace("      setAdminOpen(false);\n      setSigningOut(false);", "      setSigningOut(false);")
s = s.replace("      setAdminOpen(false);\n      await signOutUser();", "      await signOutUser();")
start = s.index("  if (user && role) return <div className=\"min-h-screen\">")
end = s.index("\n\n  return <div className=\"min-h-screen flex items-center justify-center", start)
new_block = '''  if (user && role) return <AuthShellContext.Provider value={{ user, role, signingOut, signOut: handleSignOut }}><div className="min-h-screen">{children}</div></AuthShellContext.Provider>;'''
s = s[:start] + new_block + s[end:]
insert = '''\nexport interface AuthShellValue {\n  user: SupabaseUser;\n  role: AppRole;\n  signingOut: boolean;\n  signOut: () => Promise<void>;\n}\n\nexport const AuthShellContext = React.createContext<AuthShellValue | null>(null);\nexport function useAuthShell() {\n  const value = React.useContext(AuthShellContext);\n  if (!value) throw new Error('useAuthShell debe usarse dentro de AuthGate.');\n  return value;\n}\n'''
marker = "interface AuthGateProps { children: React.ReactNode; }\n"
s = s.replace(marker, marker + insert, 1)
p.write_text(s)

# Sidebar integrates admin and sign-out as aligned actions inside the same navigation rail.
p = Path('components/Sidebar.tsx')
s = p.read_text()
s = s.replace("import { LayoutDashboard, UserPlus, Users, BarChart3, Menu, ChevronLeft, Filter, MapPin, Clock, Search, Settings, Trash2, Camera, Calendar, CalendarDays, Cloud, HardHat } from 'lucide-react';", "import { LayoutDashboard, UserPlus, Users, BarChart3, Menu, ChevronLeft, Filter, MapPin, Clock, Search, Settings, Trash2, Camera, Calendar, CalendarDays, HardHat, ShieldCheck, LogOut, Loader2 } from 'lucide-react';")
s = s.replace("import { MultiSearchableDropdown } from './MultiSearchableDropdown';", "import { MultiSearchableDropdown } from './MultiSearchableDropdown';\nimport { useAuthShell } from './AuthGate';")
s = s.replace("export type ViewMode = 'dashboard' | 'calendario' | 'registro' | 'directorio' | 'estadisticas' | 'configuracion' | 'papelera' | 'citas' | 'subcontratas';", "export type ViewMode = 'dashboard' | 'calendario' | 'registro' | 'directorio' | 'estadisticas' | 'configuracion' | 'papelera' | 'citas' | 'subcontratas' | 'administracion';")
needle = ") => {\n  const menuItems:"
s = s.replace(needle, ") => {\n  const { role, signOut, signingOut } = useAuthShell();\n  const menuItems:", 1)
camera_end = '''        </div>\n\n        {/* Footer Area */}'''
actions = '''        </div>\n\n        {/* Session / administration actions aligned with the scanner button */}\n        <div className="px-3 pb-3 space-y-2 no-print">\n          {role === 'admin' && (\n            <button\n              type="button"\n              onClick={() => handleNavClick('administracion')}\n              className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-colors ${activeView === 'administracion' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white' : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'} ${isCollapsed && !isMobileOpen ? 'lg:h-11 lg:w-11 lg:p-0 lg:mx-auto lg:rounded-full' : ''}`}\n              title="Administración"\n            >\n              <ShieldCheck className="w-5 h-5 shrink-0" />\n              <span className={`${isCollapsed && !isMobileOpen ? 'lg:hidden' : ''}`}>Administración</span>\n            </button>\n          )}\n          <button\n            type="button"\n            onClick={() => void signOut()}\n            disabled={signingOut}\n            className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-slate-600/70 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-colors disabled:opacity-60 ${isCollapsed && !isMobileOpen ? 'lg:h-11 lg:w-11 lg:p-0 lg:mx-auto lg:rounded-full' : ''}`}\n            title="Cerrar sesión"\n          >\n            {signingOut ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <LogOut className="w-5 h-5 shrink-0" />}\n            <span className={`${isCollapsed && !isMobileOpen ? 'lg:hidden' : ''}`}>{signingOut ? 'Cerrando…' : 'Cerrar sesión'}</span>\n          </button>\n        </div>\n\n        {/* Footer Area */}'''
if camera_end not in s: raise SystemExit('sidebar footer anchor not found')
s = s.replace(camera_end, actions, 1)
p.write_text(s)

# App renders Administration like any other active view, preserving sidebar/header.
p = Path('App.tsx')
s = p.read_text()
anchor = "import { SubcontratasSection } from './components/SubcontratasSection';"
s = s.replace(anchor, anchor + "\nimport { AdminPanel } from './components/AdminPanel';", 1)
view_anchor = "          {activeView === 'papelera' && ("
admin_view = '''          {activeView === 'administracion' && (\n            <div className="max-w-7xl mx-auto">\n              <AdminPanel onClose={() => setActiveView('dashboard')} />\n            </div>\n          )}\n\n'''
if view_anchor not in s: raise SystemExit('app view anchor not found')
s = s.replace(view_anchor, admin_view + view_anchor, 1)
p.write_text(s)

# Admin panel should behave as embedded section, not an independent full-screen page.
p = Path('components/AdminPanel.tsx')
s = p.read_text().replace('return <section className="min-h-screen bg-slate-50 dark:bg-slate-950">', 'return <section className="w-full bg-transparent">', 1)
p.write_text(s)
