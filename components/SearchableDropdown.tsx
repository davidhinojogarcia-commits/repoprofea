import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

interface SearchableDropdownProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon?: React.ReactNode;
  allLabel?: string;
  className?: string;
  buttonClassName?: string;
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  options,
  value,
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

  const handleSelect = (option: string) => {
    onChange(option);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`relative w-full sm:w-56 ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary/20 ${buttonClassName}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-slate-500 dark:text-slate-400 shrink-0">{icon}</span>}
          <span className="text-sm font-medium text-slate-700 dark:text-slate-100 truncate">
            {value === 'Todas' ? placeholder : value}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {options.length > 5 && (
            <div className="p-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all placeholder-slate-400 dark:placeholder-slate-500"
                  autoFocus
                />
              </div>
            </div>
          )}
          
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
            <button
              onClick={() => handleSelect('Todas')}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${
                value === 'Todas' ? 'bg-brand-primary/10 text-brand-primary font-bold dark:bg-brand-primary/20 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <span className="truncate">{allLabel}</span>
              {value === 'Todas' && <Check className="w-4 h-4" />}
            </button>
            
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                No se encontraron resultados
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option}
                  onClick={() => handleSelect(option)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${
                    value === option ? 'bg-brand-primary/10 text-brand-primary font-bold dark:bg-brand-primary/20 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                  title={option}
                >
                  <span className="truncate text-left">{option}</span>
                  {value === option && <Check className="w-4 h-4 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
