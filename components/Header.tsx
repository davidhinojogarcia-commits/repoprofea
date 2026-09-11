import React from 'react';
import { Menu, Sun, Moon, Undo2, Redo2, Bell } from 'lucide-react';
import { BUTTON_GHOST } from '../constants';

interface HeaderProps {
  onMenuClick?: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onOpenNotificationManager?: () => void;
  alertsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({ onMenuClick, theme, onThemeToggle, onUndo, onRedo, canUndo = false, canRedo = false, onOpenNotificationManager, alertsCount = 0 }) => (
  <div className="sticky top-0 z-[80] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 sm:p-5 md:p-6 rounded-2xl shadow-sm mb-6 md:mb-8 border border-slate-200 dark:border-slate-800/80 transition-all duration-300 relative flex flex-col items-center overflow-hidden no-print app-navigation-panel">
    <div className="absolute top-0 left-0 w-full h-1 bg-brand-primary" />
    <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6 w-full max-w-none">
      <div className="flex items-center gap-4 md:gap-6 w-full md:w-auto justify-between md:justify-start">
        <div className="flex items-center gap-4">
          {onMenuClick && <button onClick={onMenuClick} className={`${BUTTON_GHOST} lg:hidden !p-2 -ml-2 !rounded-lg dark:text-slate-300 dark:hover:bg-slate-800 no-print`} aria-label="Abrir menú"><Menu className="w-6 h-6" /></button>}
          <div className="flex items-center select-none py-1">
            <img src="/logo-diputacion-profea.svg" alt="Diputación de Cádiz - COOPERACIÓN PROFEA" className="dark:hidden h-10 sm:h-12 md:h-14 w-auto object-contain transition-transform hover:scale-[1.01]" />
            <img src="/logo-diputacion-profea-dark.svg" alt="Diputación de Cádiz - COOPERACIÓN PROFEA" className="hidden dark:block h-10 sm:h-12 md:h-14 w-auto object-contain transition-transform hover:scale-[1.01]" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 w-full md:w-auto justify-between md:justify-end">
        <div className="text-left md:text-right hidden xl:block mr-2"><h2 className="text-brand-primary dark:text-blue-400 text-xs md:text-sm font-bold uppercase tracking-[0.2em] opacity-80">Sistema de Gestión</h2></div>
        {(onUndo || onRedo) && <div className="flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80 no-print shadow-xs">
          {onUndo && <button onClick={onUndo} disabled={!canUndo} className={`p-2 rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold select-none ${canUndo ? 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs hover:scale-105 active:scale-95 cursor-pointer' : 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'}`} title={canUndo ? 'Deshacer cambio (Ctrl+Z)' : 'Nada que deshacer'} aria-label="Deshacer cambio"><Undo2 className="w-4 h-4" /><span className="hidden sm:inline text-[11px]">Deshacer</span></button>}
          {onRedo && <button onClick={onRedo} disabled={!canRedo} className={`p-2 rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold select-none ${canRedo ? 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs hover:scale-105 active:scale-95 cursor-pointer' : 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'}`} title={canRedo ? 'Rehacer cambio (Ctrl+Y)' : 'Nada que rehacer'} aria-label="Rehacer cambio"><Redo2 className="w-4 h-4" /><span className="hidden sm:inline text-[11px]">Rehacer</span></button>}
        </div>}
        {onOpenNotificationManager && <button onClick={onOpenNotificationManager} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/80 transition-all flex items-center justify-center shadow-xs hover:scale-105 shrink-0 no-print cursor-pointer relative group" title="Gestión de Notificaciones Push y Alertas" aria-label="Gestión de Notificaciones Push"><Bell className="w-5 h-5 text-amber-500 group-hover:rotate-12 transition-transform" />{alertsCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900 animate-pulse shadow-sm">{alertsCount > 9 ? '9+' : alertsCount}</span>}</button>}
        <button onClick={onThemeToggle} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/80 transition-all flex items-center justify-center shadow-xs hover:scale-105 shrink-0 no-print cursor-pointer" title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'} aria-label="Alternar tema">{theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-600" />}</button>
      </div>
    </div>
    <div className="absolute -bottom-6 -right-6 opacity-[0.05] pointer-events-none select-none"><span className="text-8xl font-black text-brand-primary dark:text-blue-500">PROFEA</span></div>
  </div>
);
