import React from 'react';
import { LayoutDashboard, UserPlus, Users, BarChart3, Menu, ChevronLeft, Filter, MapPin, Clock, Search, Settings, Trash2, Camera, Calendar, CalendarDays, HardHat, ShieldCheck, LogOut, Loader2 } from 'lucide-react';
import { MultiSearchableDropdown } from './MultiSearchableDropdown';
import { useAuthShell } from './AuthGate';

export type ViewMode = 'dashboard' | 'calendario' | 'registro' | 'directorio' | 'estadisticas' | 'configuracion' | 'papelera' | 'citas' | 'subcontratas' | 'administracion';

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
  searchTerm = '',
  setSearchTerm = (_: string) => {},
  selectedObraFilter = ['Todas'],
  setSelectedObraFilter = (_: string[]) => {},
  selectedQuincenaFilter = ['Todas'],
  setSelectedQuincenaFilter = (_: string[]) => {},
  savedObras = [],
  uniqueQuincenas = [],
  onOpenScanner,
}) => {
  const { role, signOut, signingOut } = useAuthShell();
  const menuItems: { id: ViewMode; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Vista General', icon: LayoutDashboard },
    { id: 'calendario', label: 'Calendario Integrado', icon: CalendarDays },
    { id: 'citas', label: 'Reconocimientos Médicos', icon: Calendar },
    { id: 'registro', label: 'Nuevo Registro', icon: UserPlus },
    { id: 'directorio', label: 'Directorio', icon: Users },
    { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3 },
    { id: 'subcontratas', label: 'Subcontratas (CAE)', icon: HardHat },
    { id: 'configuracion', label: 'Configuración', icon: Settings },
    { id: 'papelera', label: 'Papelera', icon: Trash2 },
  ];

  const handleNavClick = (id: ViewMode) => {
    setActiveView(id);
    setIsMobileOpen(false);
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside 
        className={`
          fixed lg:sticky top-0 left-0 z-50 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-300 flex flex-col no-print app-navigation-panel
          ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}
          ${isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header / Logo Area */}
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
          
          {/* Collapse Toggle (Desktop) */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
            title={isCollapsed ? "Expandir menú" : "Colapsar menú"}
          >
            {isCollapsed ? <Menu className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>

          {/* Close Toggle (Mobile) */}
          <button 
            onClick={() => setIsMobileOpen(false)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto custom-scrollbar">
          {menuItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative
                  ${isActive 
                    ? 'bg-brand-primary text-white shadow-md shadow-brand-primary/20' 
                    : 'bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/65 hover:text-brand-primary dark:hover:text-blue-400'
                  }
                `}
                title={isCollapsed && !isMobileOpen ? item.label : undefined}
              >
                <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-600 dark:text-slate-400 group-hover:text-brand-primary dark:group-hover:text-blue-400'}`} />
                <span className={`font-semibold text-sm whitespace-nowrap transition-all duration-300 ${isActive ? 'text-white' : 'text-slate-800 dark:text-slate-100 group-hover:text-brand-primary dark:group-hover:text-blue-400'} ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:w-0 lg:hidden' : 'opacity-100 w-auto'}`}>
                  {item.label}
                </span>

                {/* Tooltip for collapsed state */}
                {isCollapsed && !isMobileOpen && (
                  <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
                    {item.label}
                  </div>
                )}
              </button>
            );
          })}

          {/* Filters Section */}
          <div className={`mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 transition-all duration-300 ${isCollapsed && !isMobileOpen ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100 h-auto'}`}>
            <div className="px-3 mb-4 flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Filter className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Filtros</span>
            </div>
            
            <div className="space-y-4 px-1">
              {/* Search */}
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary dark:text-slate-100 transition-all"
                />
              </div>

              {/* Obra Filter */}
              <MultiSearchableDropdown
                options={savedObras}
                selectedValues={selectedObraFilter}
                onChange={setSelectedObraFilter}
                placeholder="Obra: Todas"
                allLabel="Todas las obras"
                icon={<MapPin className="w-4 h-4" />}
                className="!w-full"
                buttonClassName="!bg-slate-50 !border-slate-200 !py-2 !h-auto"
              />

              {/* Quincena Filter */}
              <MultiSearchableDropdown
                options={uniqueQuincenas}
                selectedValues={selectedQuincenaFilter}
                onChange={setSelectedQuincenaFilter}
                placeholder="Quincena: Todas"
                allLabel="Todas las quincenas"
                icon={<Clock className="w-4 h-4" />}
                className="!w-full"
                buttonClassName="!bg-slate-50 !border-slate-200 !py-2 !h-auto"
              />
            </div>
          </div>
        </nav>

        {/* Camera Scanner Button */}
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

            {/* Tooltip for collapsed state */}
            {isCollapsed && !isMobileOpen && (
              <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-md">
                Escanear Cámara
              </div>
            )}
          </button>
        </div>

        {/* Session / administration actions aligned with the scanner button */}
        <div className="px-3 pb-3 space-y-2 no-print">
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => handleNavClick('administracion')}
              className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-colors ${activeView === 'administracion' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white' : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'} ${isCollapsed && !isMobileOpen ? 'lg:h-11 lg:w-11 lg:p-0 lg:mx-auto lg:rounded-full' : ''}`}
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

        {/* Footer Area */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className={`flex items-center gap-3 overflow-hidden transition-all duration-300 ${isCollapsed && !isMobileOpen ? 'lg:opacity-0 lg:h-0' : 'opacity-100 h-auto'}`}>
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <span className="text-slate-500 dark:text-slate-400 text-xs font-bold">DC</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">Diputación de Cádiz</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Gestión PROFEA</span>
              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">© David Hinojo García</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
