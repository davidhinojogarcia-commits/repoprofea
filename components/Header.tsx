import React from 'react';
import { Menu, Sun, Moon, Bell, Compass, SlidersHorizontal } from 'lucide-react';
import { BUTTON_GHOST } from '../constants';
import { OfflineSyncStatus } from './OfflineSyncStatus';

interface HeaderProps {
  onMenuClick?: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  onOpenNotificationManager?: () => void;
  alertsCount?: number;
  guidedMode?: boolean;
  onInterfaceModeToggle?: () => void;
  isInterfaceModeSaving?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onMenuClick, theme, onThemeToggle, onOpenNotificationManager, alertsCount = 0, guidedMode = false, onInterfaceModeToggle, isInterfaceModeSaving = false }) => (
  <div className={`sticky top-0 z-[80] ui-glass p-4 sm:p-5 md:p-6 rounded-2xl mb-6 md:mb-8 transition-all relative flex flex-col items-center overflow-hidden no-print app-navigation-panel ${guidedMode ? 'profea-guided-header' : ''}`}>
    <div className="absolute top-0 left-0 w-full h-1 bg-brand-primary" />
    <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6 w-full max-w-none">
      <div className="flex items-center gap-4 md:gap-6 w-full md:w-auto justify-between md:justify-start">
        <div className="flex items-center gap-4">
          {onMenuClick && <button onClick={onMenuClick} className={`${BUTTON_GHOST} profea-mobile-menu-button lg:hidden !p-2 -ml-2 no-print`} aria-label="Abrir menú"><Menu className="w-7 h-7" /><span className={guidedMode ? 'text-sm font-black' : 'sr-only'}>Menú</span></button>}
          <div className="flex items-center select-none py-1">
            <img src="/logo-diputacion-profea.svg" alt="Diputación de Cádiz - COOPERACIÓN PROFEA" className="dark:hidden h-10 sm:h-12 md:h-14 w-auto object-contain transition-transform hover:scale-[1.01]" />
            <img src="/logo-diputacion-profea-dark.svg" alt="Diputación de Cádiz - COOPERACIÓN PROFEA" className="hidden dark:block h-10 sm:h-12 md:h-14 w-auto object-contain transition-transform hover:scale-[1.01]" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 w-full md:w-auto justify-between md:justify-end">
        <div className="text-left md:text-right hidden xl:block mr-2"><h2 className="text-brand-primary dark:text-blue-400 text-xs md:text-sm font-bold uppercase tracking-[0.2em] opacity-80">Sistema de Gestión</h2></div>
        <OfflineSyncStatus />
        {onInterfaceModeToggle && (
          <button
            type="button"
            onClick={onInterfaceModeToggle}
            disabled={isInterfaceModeSaving}
            className="profea-interface-mode-button ui-button-secondary !min-h-0 p-2.5 sm:px-3 flex items-center justify-center gap-2 shadow-xs shrink-0 no-print cursor-pointer disabled:opacity-60"
            title={guidedMode ? 'Cambiar a Vista completa' : 'Activar Vista guiada'}
            aria-label={guidedMode ? 'Cambiar a Vista completa' : 'Activar Vista guiada'}
            aria-pressed={guidedMode}
          >
            {guidedMode ? <SlidersHorizontal className="w-5 h-5 text-brand-primary dark:text-blue-300" /> : <Compass className="w-5 h-5 text-brand-primary dark:text-blue-300" />}
            <span className={`${guidedMode ? 'inline' : 'hidden sm:inline'} text-[12px] font-black whitespace-nowrap`}>
              {isInterfaceModeSaving ? 'Guardando…' : guidedMode ? 'Vista completa' : 'Vista guiada'}
            </span>
          </button>
        )}
        {onOpenNotificationManager && <button onClick={onOpenNotificationManager} className="profea-notification-button ui-button-secondary !min-h-0 p-2.5 flex items-center justify-center shadow-xs shrink-0 no-print cursor-pointer relative group" title="Gestión de Notificaciones Push y Alertas" aria-label="Gestión de Notificaciones Push"><Bell className="w-5 h-5 text-amber-500 group-hover:rotate-12 transition-transform" />{alertsCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900 animate-pulse shadow-sm">{alertsCount > 9 ? '9+' : alertsCount}</span>}</button>}
        <button onClick={onThemeToggle} className="profea-theme-button ui-button-secondary !min-h-0 p-2.5 flex items-center justify-center shadow-xs shrink-0 no-print cursor-pointer" title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'} aria-label="Alternar tema">{theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-600" />}</button>
      </div>
    </div>
    <div className="absolute -bottom-6 -right-6 opacity-[0.045] pointer-events-none select-none"><span className="text-8xl font-black text-brand-primary dark:text-blue-500">PROFEA</span></div>
  </div>
);
