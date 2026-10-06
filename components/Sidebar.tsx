import React from 'react';
import { LayoutDashboard, UserPlus, Users, Menu, ChevronLeft, Settings, Trash2, Camera, Calendar, CalendarDays, HardHat, BriefcaseBusiness, ShieldCheck, LogOut, Loader2, Files, Wrench, ClipboardCheck } from 'lucide-react';
import { useAuthShell } from './AuthGate';
import { APP_BUILD, APP_VERSION } from '../src/lib/appVersion';

export type ViewMode = 'dashboard' | 'calendario' | 'registro' | 'sae' | 'directorio' | 'estadisticas' | 'configuracion' | 'papelera' | 'citas' | 'subcontratas' | 'prevencion' | 'documentacion_obra' | 'documentacion_encargados' | 'inventario' | 'administracion';

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
  guidedMode?: boolean;
}

type SidebarMenuItem = {
  id: ViewMode;
  label: string;
  subtitle?: string;
  icon: React.ElementType;
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  setActiveView,
  isCollapsed,
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen,
  onOpenScanner,
  guidedMode = false,
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

  const completeMenuGroups: { label: string; items: SidebarMenuItem[] }[] = [
    {
      label: 'Contratación',
      items: [
        { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
        { id: 'sae', label: 'Selección', icon: BriefcaseBusiness },
        { id: 'directorio', label: 'Directorio', icon: Users },
        { id: 'registro', label: 'Nuevo Registro', icon: UserPlus },
        { id: 'calendario', label: 'Calendario Integrado', icon: CalendarDays },
      ],
    },
    {
      label: 'Prevención y CAE',
      items: [
        { id: 'prevencion', label: 'Incidencias y alertas', icon: ShieldCheck },
        { id: 'citas', label: 'Reconocimientos Médicos', icon: Calendar },
        { id: 'documentacion_obra', label: 'Documentación de obra', icon: Files },
        { id: 'documentacion_encargados', label: 'Documentación de encargados', icon: ClipboardCheck },
        {
          id: 'subcontratas',
          label: 'CAE',
          subtitle: 'Coordinación de Actividades Empresariales',
          icon: HardHat,
        },
      ],
    },
    {
      label: 'Logística',
      items: [
        { id: 'inventario', label: 'Herramientas y maquinaria', icon: Wrench },
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

  const guidedMenuGroups: { label: string; items: SidebarMenuItem[] }[] = [
    {
      label: 'Sigue estos pasos',
      items: [
        { id: 'dashboard', label: 'Menú inicial', subtitle: 'Vuelve aquí si tienes dudas', icon: LayoutDashboard },
        { id: 'sae', label: '1. Selección SAE', subtitle: 'Empieza aquí para contratar', icon: BriefcaseBusiness },
        { id: 'directorio', label: '2. Trabajadores', subtitle: 'Revisa datos y documentos', icon: Users },
        { id: 'registro', label: '3. Añadir trabajador', subtitle: 'Alta manual si la necesitas', icon: UserPlus },
        { id: 'citas', label: '4. Reconocimientos', subtitle: 'Citas y aptitud médica', icon: Calendar },
        { id: 'documentacion_obra', label: '5. Documentación', subtitle: 'Documentos de la obra', icon: Files },
        { id: 'documentacion_encargados', label: 'Documentación de encargados', subtitle: 'Firmas y partes recibidos', icon: ClipboardCheck },
        { id: 'subcontratas', label: '6. CAE', subtitle: 'Coordinación de empresas', icon: HardHat },
        { id: 'prevencion', label: 'Incidencias y alertas', subtitle: 'Comprobaciones y seguimiento por obra', icon: ShieldCheck },
        { id: 'inventario', label: '7. Maquinaria', subtitle: 'Equipos y herramientas', icon: Wrench },
        { id: 'configuracion', label: 'Configuración', subtitle: 'Datos y preferencias de la app', icon: Settings },
      ],
    },
  ];

  const menuGroups = guidedMode ? guidedMenuGroups : completeMenuGroups;

  const handleNavClick = (id: ViewMode) => {
    setActiveView(id);
    window.dispatchEvent(new CustomEvent('profea:navigate', { detail: { view: id } }));
    setIsMobileOpen(false);
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="profea-nonmodal-overlay fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-screen border-r border-slate-200/80 dark:border-slate-800 shadow-sm transition-all duration-300 flex flex-col no-print app-navigation-panel profea-sidebar-shell
          ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}
          ${isMobileOpen ? 'translate-x-0 w-[min(88vw,20rem)]' : '-translate-x-full lg:translate-x-0'}
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
            className="profea-mobile-close-menu lg:hidden flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
            aria-label="Cerrar menú"
          >
            <ChevronLeft className="w-6 h-6" />
            {guidedMode && <span className="text-sm font-black">Cerrar</span>}
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-2 overflow-y-auto overscroll-contain custom-scrollbar">
          {guidedMode && (!isCollapsed || isMobileOpen) && (
            <div className="profea-guided-menu-help mb-4 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm leading-5 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
              <span className="font-black">Vista guiada.</span> Si tienes dudas, empieza por el paso 1 y sigue el orden.
            </div>
          )}
          {menuGroups.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex === 0 ? '' : 'pt-4'}>
              <div className={`profea-sidebar-group-label px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500 ${isCollapsed && !isMobileOpen ? 'lg:hidden' : ''}`}>
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
                      className={`profea-sidebar-item w-full min-h-12 flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden ${isActive ? 'profea-sidebar-item--active text-white' : 'text-slate-700 dark:text-slate-300'}`}
                      title={isCollapsed && !isMobileOpen ? item.label : undefined}
                    >
                      <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-brand-primary dark:group-hover:text-blue-400'}`} />
                      <span className={`min-w-0 flex-1 flex flex-col items-start text-left transition-all duration-300 ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:w-0 lg:hidden' : 'opacity-100 w-auto'}`}>
                        <span className={`profea-sidebar-label w-full font-semibold text-sm leading-[1.15] whitespace-normal break-words ${isActive ? 'text-white' : 'text-slate-800 dark:text-slate-100 group-hover:text-brand-primary dark:group-hover:text-blue-400'}`}>
                          {item.label}
                        </span>
                        {item.subtitle && (
                          <span className={`profea-sidebar-subtitle mt-0.5 text-[10px] leading-[1.2] font-medium max-w-[13rem] ${isActive ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}`}>
                            {item.subtitle}
                          </span>
                        )}
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
            type="button"
            onClick={() => {
              // En móvil cerramos primero el panel lateral para dejar el modal del
              // escáner completamente visible. En escritorio mantenemos el estado actual.
              if (isMobileOpen) setIsMobileOpen(false);
              onOpenScanner();
            }}
            className={`profea-sidebar-item w-full min-h-12 flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative text-slate-700 dark:text-slate-300 ${isCollapsed && !isMobileOpen ? 'lg:h-12 lg:w-full' : ''}`}
            title={isCollapsed && !isMobileOpen ? 'Escáner' : 'Escáner de documentos'}
          >
            <Camera className="w-5 h-5 shrink-0 text-slate-500 dark:text-slate-400 group-hover:text-brand-primary dark:group-hover:text-blue-400" />
            <span className={`min-w-0 flex flex-col items-start text-left transition-all duration-300 ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:w-0 lg:hidden' : 'opacity-100 w-auto'}`}>
              <span className="font-semibold text-sm whitespace-nowrap text-slate-800 dark:text-slate-100 group-hover:text-brand-primary dark:group-hover:text-blue-400">
                Escáner
              </span>
            </span>

            {isCollapsed && !isMobileOpen && (
              <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                Escáner
              </div>
            )}
          </button>
        </div>

        <div className="px-3 pb-3 space-y-2 no-print">
          {role === 'admin' && !guidedMode && (
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

        <div className={`px-4 pb-2 text-[9px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 ${isCollapsed && !isMobileOpen ? 'lg:hidden' : ''}`} title={`Build ${APP_BUILD}`}>
          GestionProfea · v{APP_VERSION}
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
