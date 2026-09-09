import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

interface MultiSearchableDropdownProps {
  options: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  icon?: React.ReactNode;
  allLabel?: string;
  className?: string;
  buttonClassName?: string;
}

export const MultiSearchableDropdown: React.FC<MultiSearchableDropdownProps> = ({
  options,
  selectedValues,
  onChange,
  placeholder,
  icon,
  allLabel = 'Todas',
  className = '',
  buttonClassName = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(option =>
    option.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAllSelected = selectedValues.length === 0 || selectedValues.includes('Todas');

  const handleToggleOption = (option: string) => {
    if (option === 'Todas') {
      onChange(['Todas']);
      return;
    }

    let newValues: string[];
    if (isAllSelected) {
      newValues = [option];
    } else {
      if (selectedValues.includes(option)) {
        newValues = selectedValues.filter(v => v !== option);
        if (newValues.length === 0) newValues = ['Todas'];
      } else {
        newValues = [...selectedValues, option];
      }
    }
    onChange(newValues);
  };

  const removeValue = (e: React.MouseEvent, valueToRemove: string) => {
    e.stopPropagation();
    const newValues = selectedValues.filter(v => v !== valueToRemove);
    onChange(newValues.length === 0 ? ['Todas'] : newValues);
  };

  return (
    <div className={`relative w-full sm:w-72 ${className}`} ref={dropdownRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/80 transition-colors cursor-pointer min-h-[46px] ${buttonClassName} ${isOpen ? 'ring-2 ring-[#00548E]/20 dark:ring-blue-500/30 border-[#00548E] dark:border-blue-500' : ''}`}
      >
        <div className="flex items-center gap-2 flex-wrap max-w-[90%]">
          {icon && <span className="text-slate-500 dark:text-slate-400 shrink-0">{icon}</span>}
          {isAllSelected ? (
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
              {placeholder}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {selectedValues.map(val => (
                <span 
                  key={val} 
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#00548E]/10 text-[#00548E] text-[11px] font-bold rounded-md border border-[#00548E]/20 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60"
                >
                  {val}
                  <X 
                    className="w-3 h-3 cursor-pointer hover:opacity-75" 
                    onClick={(e) => removeValue(e, val)}
                  />
                </span>
              ))}
            </div>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#00548E] dark:focus:border-blue-500 focus:ring-2 focus:ring-[#00548E]/20 dark:focus:ring-blue-500/30 transition-all placeholder-slate-400 dark:placeholder-slate-500"
                autoFocus
              />
            </div>
          </div>
          
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
            <button
              onClick={() => handleToggleOption('Todas')}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer ${
                isAllSelected ? 'bg-[#00548E]/10 text-[#00548E] font-bold dark:bg-blue-950/60 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80'
              }`}
            >
              <span className="truncate">{allLabel}</span>
              {isAllSelected && <Check className="w-4 h-4 text-[#00548E] dark:text-blue-400" />}
            </button>
            
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                No se encontraron resultados
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selectedValues.includes(option);
                return (
                  <button
                    key={option}
                    onClick={() => handleToggleOption(option)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#00548E]/10 text-[#00548E] font-bold dark:bg-blue-950/60 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                    }`}
                    title={option}
                  >
                    <span className="truncate text-left">{option}</span>
                    {isSelected && <Check className="w-4 h-4 text-[#00548E] dark:text-blue-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
