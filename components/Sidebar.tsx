import React from 'react';
import { LayoutDashboard, UserPlus, Users, Menu, ChevronLeft, Settings, Trash2, Camera, Calendar, CalendarDays, HardHat, BriefcaseBusiness, ShieldCheck, LogOut, Loader2, Files } from 'lucide-react';
import { useAuthShell } from './AuthGate';

export type ViewMode = 'dashboard' | 'calendario' | 'registro' | 'sae' | 'directorio' | 'estadisticas' | 'configuracion' | 'papelera' | 'citas' | 'subcontratas' | 'documentacion_obra' | 'administracion';

interface SidebarProps {
  activeView: ViewMode;
  setActiveView: (view: ViewMode) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedObraFilter: string[];
  setSelectedObraFilter: (obras: string[]) => void;
  selectedQuincenaFilter: string[];
  setSelectedQuincenaFilter: (quincenas: string[]) => void;
  savedObras: string[];
  uniqueQuincenas: string[];
  onOpenScanner: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  setActiveView,
  isCollapsed,
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen,
  onOpenScanner,
}) => {
  const { user, role, signOut, signingOut } = useAuthShell();
  const metadata = (user.user_metadata || {}) as Record<string, any>;
  const signedInName = [metadata.nombre, metadata.apellidos].filter(Boolean).join(' ').trim() || user.email || 'Usuario';
  const signedInInitials = signedInName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'U';

  const menuGroups: { label: string; items: { id: ViewMode; label: string; icon: React.ElementType }[] }[] = [
    {
      label: 'Contratación',
      items: [
        { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
        { id: 'sae', label: 'SAE', icon: BriefcaseBusiness },
        { id: 'directorio', label: 'Directorio', icon: Users },
        { id: 'registro', label: 'Nuevo Registro', icon: UserPlus },
        { id: 'calendario', label: 'Calendario Integrado', icon: CalendarDays },
      ],
    },
    {
      label: 'Prevención y CAE',
      items: [
        { id: 'citas', label: 'Reconocimientos Médicos', icon: Calendar },
        { id: 'subcontratas', label: 'Subcontratas (CAE)', icon: HardHat },
        { id: 'documentacion_obra', label: 'Documentación de obra', icon: Files },
      ],
    },
    {
      label: 'Sistema',
      items: [
        { id: 'configuracion', label: 'Configuración', icon: Settings },
        { id: 'papelera', label: 'Papelera', icon: Trash2 },
      ],
    },
  ];

  const handleNavClick = (id: ViewMode) => {
    setActiveView(id);
    window.dispatchEvent(new CustomEvent('profea:navigate', { detail: { view: id } }));
    setIsMobileOpen(false);
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-50 h-screen border-r border-slate-200/80 dark:border-slate-800 shadow-sm transition-all duration-300 flex flex-col no-print app-navigation-panel profea-sidebar-shell
          ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}
          ${isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="h-20 flex items-center justify-between px-3 border-b border-slate-200 dark:border-slate-800">
          <div className={`flex items-center gap-2 overflow-hidden transition-opacity duration-300 ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:w-0' : 'opacity-100 w-auto'}`}>
            <img
              src="/logo-diputacion-profea.svg"
              alt="Logo PROFEA Diputación de Cádiz"
              className="dark:hidden h-9 w-auto max-w-[170px] object-contain"
            />
            <img
              src="/logo-diputacion-profea-dark.svg"
              alt="Logo PROFEA Diputación de Cádiz"
              className="hidden dark:block h-9 w-auto max-w-[170px] object-contain"
            />
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
            title={isCollapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            {isCollapsed ? <Menu className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>

          <button
            onClick={() => setIsMobileOpen(false)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto custom-scrollbar">
          {menuGroups.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex === 0 ? '' : 'pt-4'}>
              <div className={`px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500 ${isCollapsed && !isMobileOpen ? 'lg:hidden' : ''}`}>
                {group.label}
              </div>
              <div className="space-y-1.5">
                {group.items.map((item) => {
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      data-profea-view={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={`profea-sidebar-item w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative ${isActive ? 'profea-sidebar-item--active text-white' : 'text-slate-700 dark:text-slate-300'}`}
                      title={isCollapsed && !isMobileOpen ? item.label : undefined}
                    >
                      <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-brand-primary dark:group-hover:text-blue-400'}`} />
                      <span className={`font-semibold text-sm whitespace-nowrap transition-all duration-300 ${isActive ? 'text-white' : 'text-slate-800 dark:text-slate-100 group-hover:text-brand-primary dark:group-hover:text-blue-400'} ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:w-0 lg:hidden' : 'opacity-100 w-auto'}`}>
                        {item.label}
                      </span>

                      {isCollapsed && !isMobileOpen && (
                        <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                          {item.label}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-slate-200 dark:border-slate-800/80 no-print">
          <button
            onClick={onOpenScanner}
            className={`
              w-full flex items-center justify-center gap-2 px-3 py-3 bg-gradient-to-r from-[#00548E] to-blue-700 hover:from-[#004270] hover:to-blue-800 text-white rounded-xl shadow-md transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 group relative
              ${isCollapsed && !isMobileOpen ? 'h-11 w-11 !p-0 rounded-full mx-auto' : ''}
            `}
            title="Escáner de Documentos con Cámara"
          >
            <Camera className="w-5 h-5 group-hover:scale-115 transition-transform" />
            <span className={`font-bold text-xs tracking-wider uppercase whitespace-nowrap transition-all duration-300 ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:w-0 lg:hidden' : 'opacity-100 w-auto'}`}>
              Escanear Cámara
            </span>

            {isCollapsed && !isMobileOpen && (
              <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-md">
                Escanear Cámara
              </div>
            )}
          </button>
        </div>

        <div className="px-3 pb-3 space-y-2 no-print">
          {role === 'admin' && (
            <button
              type="button"
              data-profea-view="administracion"
              onClick={() => handleNavClick('administracion')}
              className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-colors ${activeView === 'administracion' ? 'bg-brand-primary text-white border-brand-primary shadow-md shadow-brand-primary/20 hover:bg-brand-secondary dark:bg-brand-primary dark:text-white dark:border-brand-primary dark:hover:bg-brand-secondary' : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-brand-primary dark:hover:text-blue-400'} ${isCollapsed && !isMobileOpen ? 'lg:h-11 lg:w-11 lg:p-0 lg:mx-auto lg:rounded-full' : ''}`}
              title="Administración"
            >
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span className={`${isCollapsed && !isMobileOpen ? 'lg:hidden' : ''}`}>Administración</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-slate-600/70 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-colors disabled:opacity-60 ${isCollapsed && !isMobileOpen ? 'lg:h-11 lg:w-11 lg:p-0 lg:mx-auto lg:rounded-full' : ''}`}
            title="Cerrar sesión"
          >
            {signingOut ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <LogOut className="w-5 h-5 shrink-0" />}
            <span className={`${isCollapsed && !isMobileOpen ? 'lg:hidden' : ''}`}>{signingOut ? 'Cerrando…' : 'Cerrar sesión'}</span>
          </button>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className={`flex items-center gap-3 overflow-hidden transition-all duration-300 ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:h-0' : 'opacity-100 h-auto'}`}>
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <span className="text-slate-500 dark:text-slate-400 text-xs font-bold">{signedInInitials}</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate" title={signedInName}>{signedInName}</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{role === 'admin' ? 'Administrador · PROFEA' : 'Usuario · PROFEA'}</span>
              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium truncate" title={user.email || ''}>{user.email || 'Sesión activa'}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
