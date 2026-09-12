from pathlib import Path

path = Path('components/Sidebar.tsx')
text = path.read_text()

old_menu = """  const menuItems: { id: ViewMode; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
    { id: 'calendario', label: 'Calendario Integrado', icon: CalendarDays },
    { id: 'citas', label: 'Reconocimientos Médicos', icon: Calendar },
    { id: 'registro', label: 'Nuevo Registro', icon: UserPlus },
    { id: 'directorio', label: 'Directorio', icon: Users },
    { id: 'subcontratas', label: 'Subcontratas (CAE)', icon: HardHat },
    { id: 'configuracion', label: 'Configuración', icon: Settings },
    { id: 'papelera', label: 'Papelera', icon: Trash2 },
  ];
"""
new_menu = """  const menuGroups: { label: string; items: { id: ViewMode; label: string; icon: React.ElementType }[] }[] = [
    {
      label: 'Operativa',
      items: [
        { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
        { id: 'calendario', label: 'Calendario Integrado', icon: CalendarDays },
        { id: 'registro', label: 'Nuevo Registro', icon: UserPlus },
        { id: 'directorio', label: 'Directorio', icon: Users },
      ],
    },
    {
      label: 'Prevención y CAE',
      items: [
        { id: 'citas', label: 'Reconocimientos Médicos', icon: Calendar },
        { id: 'subcontratas', label: 'Subcontratas (CAE)', icon: HardHat },
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
"""
if old_menu not in text:
    raise SystemExit('menu block not found')
text = text.replace(old_menu, new_menu, 1)

old_nav = """          {menuItems.map((item) => {
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

                {isCollapsed && !isMobileOpen && (
                  <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
                    {item.label}
                  </div>
                )}
              </button>
            );
          })}
"""
new_nav = """          {menuGroups.map((group, groupIndex) => (
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
"""
if old_nav not in text:
    raise SystemExit('nav block not found')
text = text.replace(old_nav, new_nav, 1)

text = text.replace(
"className=\"fixed lg:sticky top-0 left-0 z-50 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-300 flex flex-col no-print app-navigation-panel\"",
"className=\"fixed lg:sticky top-0 left-0 z-50 h-screen border-r border-slate-200/80 dark:border-slate-800 shadow-sm transition-all duration-300 flex flex-col no-print app-navigation-panel profea-sidebar-shell\"",
1,
)

path.write_text(text)
print('Sidebar navigation grouped and polished.')
