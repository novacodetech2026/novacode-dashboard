import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_GROUPS,
  BusinessCategoryOption,
  normalizeCategoryId,
} from '../data/businessCategories';
import { CategoryIcon } from './CategoryIcon';
import { Language } from '../types';
import { Check, ChevronDown, Search, X } from 'lucide-react';

interface CategorySelectorProps {
  value: string;
  customName?: string;
  language: Language;
  onChange: (categoryId: string, meta: { labelEn: string; labelEs: string; customName?: string }) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const CategorySelector: React.FC<CategorySelectorProps> = ({
  value,
  customName = '',
  language,
  onChange,
  placeholder,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [localCustomName, setLocalCustomName] = useState(
    customName || (value?.startsWith('custom:') ? value.slice(7) : '')
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedId = normalizeCategoryId(value);
  const selectedOption =
    BUSINESS_CATEGORIES.find(c => c.id === normalizedId) ||
    BUSINESS_CATEGORIES[BUSINESS_CATEGORIES.length - 1];

  useEffect(() => {
    if (customName) {
      setLocalCustomName(customName);
    } else if (value?.startsWith('custom:')) {
      setLocalCustomName(value.slice(7));
    }
  }, [customName, value]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 20);
    } else {
      setQuery('');
      setHighlightedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUSINESS_CATEGORIES;
    return BUSINESS_CATEGORIES.filter(opt => {
      const group = BUSINESS_CATEGORY_GROUPS.find(g => g.id === opt.groupId);
      const haystack = `${opt.labelEn} ${opt.labelEs} ${opt.keywords.join(' ')} ${group?.labelEn || ''} ${group?.labelEs || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  const groupedOptions = useMemo(() => {
    return BUSINESS_CATEGORY_GROUPS.map(group => ({
      group,
      items: filteredOptions.filter(opt => opt.groupId === group.id),
    })).filter(g => g.items.length > 0);
  }, [filteredOptions]);

  const flatVisibleOptions = useMemo(
    () => groupedOptions.flatMap(g => g.items),
    [groupedOptions]
  );

  const selectOption = (opt: BusinessCategoryOption) => {
    if (opt.id === 'custom_business') {
      const trimmed = localCustomName.trim();
      onChange('custom_business', {
        labelEn: trimmed || opt.labelEn,
        labelEs: trimmed || opt.labelEs,
        customName: trimmed || undefined,
      });
    } else {
      setLocalCustomName('');
      onChange(opt.id, {
        labelEn: opt.labelEn,
        labelEs: opt.labelEs,
        customName: undefined,
      });
    }
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev =>
        flatVisibleOptions.length === 0 ? 0 : (prev + 1) % flatVisibleOptions.length
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev =>
        flatVisibleOptions.length === 0
          ? 0
          : (prev - 1 + flatVisibleOptions.length) % flatVisibleOptions.length
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = flatVisibleOptions[highlightedIndex];
      if (target) {
        selectOption(target);
      }
    }
  };

  const displayLabel =
    normalizedId === 'custom_business' && localCustomName.trim()
      ? localCustomName.trim()
      : language === 'es'
      ? selectedOption.labelEs
      : selectedOption.labelEn;

  return (
    <div ref={containerRef} className="relative space-y-2" onKeyDown={handleKeyDown}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 hover:border-indigo-300 dark:hover:border-indigo-700 text-sm lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <CategoryIcon iconName={selectedOption.iconName} className="w-3.5 h-3.5" />
          </span>
          <span className="truncate font-semibold">
            {displayLabel || placeholder || (language === 'es' ? 'Seleccionar categoría...' : 'Select industry category...')}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Search Input */}
          <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
            <div className="relative">
              <Search className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-slate-400 absolute left-3 top-3.5 lg:top-2.5" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder={language === 'es' ? 'Buscar categoría o industria...' : 'Search industry or category...'}
                className="w-full min-h-[44px] lg:min-h-0 pl-9 lg:pl-8 pr-11 lg:pr-8 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center absolute right-0 lg:right-2 top-0 lg:top-2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Grouped List */}
          <div className="max-h-72 overflow-y-auto p-1.5 space-y-2">
            {groupedOptions.length === 0 ? (
              <div className="py-6 px-3 text-center text-sm lg:text-xs text-slate-400">
                {language === 'es'
                  ? 'No se encontraron categorías. Selecciona "Negocio Personalizado".'
                  : 'No matching categories. Try "Custom Business".'}
              </div>
            ) : (
              groupedOptions.map(({ group, items }) => (
                <div key={group.id}>
                  <div className="px-2.5 py-1 text-xs lg:text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {language === 'es' ? group.labelEs : group.labelEn}
                  </div>
                  <div className="space-y-0.5">
                    {items.map(opt => {
                      const flatIdx = flatVisibleOptions.findIndex(i => i.id === opt.id);
                      const isSelected = opt.id === normalizedId;
                      const isHighlighted = flatIdx === highlightedIndex;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => setHighlightedIndex(flatIdx)}
                          onClick={() => selectOption(opt)}
                          className={`w-full min-h-[44px] lg:min-h-0 flex items-center justify-between gap-2.5 px-3 lg:px-2.5 py-2.5 lg:py-2 rounded-xl text-left text-sm lg:text-xs transition-colors ${
                            isSelected
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                              : isHighlighted
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-indigo-100 dark:bg-indigo-900/70 text-indigo-600 dark:text-indigo-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}>
                              <CategoryIcon iconName={opt.iconName} className="w-3.5 h-3.5" />
                            </span>
                            <span className="truncate">
                              {language === 'es' ? opt.labelEs : opt.labelEn}
                            </span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Custom business name field when Custom Business is selected */}
      {normalizedId === 'custom_business' && (
        <div className="pt-1">
          <input
            type="text"
            value={localCustomName}
            onChange={e => {
              const nextVal = e.target.value;
              setLocalCustomName(nextVal);
              onChange('custom_business', {
                labelEn: nextVal.trim() || 'Custom Business',
                labelEs: nextVal.trim() || 'Negocio Personalizado',
                customName: nextVal,
              });
            }}
            placeholder={
              language === 'es'
                ? 'Especifica el tipo de negocio personalizado (ej. Estudio de Arquitectura)'
                : 'Specify custom business type (e.g. Architecture Studio)'
            }
            className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 lg:py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}
    </div>
  );
};
