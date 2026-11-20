import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  getTimezoneEntries,
  getBrowserTimezone,
  formatTimezoneSummary,
  TimezoneEntry,
  TimezoneRegion,
} from '../utils/timezone';
import { Language } from '../types';
import { Check, ChevronDown, Globe, Search, Sparkles, X } from 'lucide-react';

interface TimezoneSelectorProps {
  value: string;
  onChange: (timezone: string) => void;
  language: Language;
  disabled?: boolean;
}

const REGION_ORDER: TimezoneRegion[] = [
  'Americas',
  'Europe',
  'Asia',
  'Pacific',
  'Africa',
  'Other',
];

const REGION_LABELS_ES: Record<TimezoneRegion, string> = {
  Americas: 'América',
  Europe: 'Europa',
  Asia: 'Asia',
  Pacific: 'Australia y Pacífico',
  Africa: 'África',
  Other: 'UTC / Otros',
};

export const TimezoneSelector: React.FC<TimezoneSelectorProps> = ({
  value,
  onChange,
  language,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => getTimezoneEntries(), []);
  const detectedTimezone = useMemo(() => getBrowserTimezone(), []);
  const selectedEntry = useMemo(
    () => entries.find(e => e.id === value),
    [entries, value]
  );

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 20);
    } else {
      setQuery('');
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.searchKeywords.includes(q));
  }, [entries, query]);

  const grouped = useMemo(() => {
    return REGION_ORDER.map(region => ({
      region,
      label: language === 'es' ? REGION_LABELS_ES[region] : region === 'Pacific' ? 'Australia & Pacific' : region,
      items: filtered.filter(item => item.region === region),
    })).filter(g => g.items.length > 0);
  }, [filtered, language]);

  const handleSelect = (tzId: string) => {
    onChange(tzId);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 hover:border-indigo-300 dark:hover:border-indigo-700 text-sm lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Globe className="w-4 h-4 text-indigo-500 shrink-0" />
          <div className="min-w-0 text-left">
            <span className="font-semibold truncate block">
              {selectedEntry
                ? `${selectedEntry.city} — ${selectedEntry.offsetLabel}`
                : formatTimezoneSummary(value)}
            </span>
            <span className="text-xs lg:text-[10px] font-mono text-slate-400 truncate block">
              {value}
            </span>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Search Bar */}
          <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-slate-400 absolute left-3 top-3.5 lg:top-2.5" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={
                  language === 'es'
                    ? 'Buscar ciudad, país o zona IANA (ej. Santo Domingo, Madrid)...'
                    : 'Search city, country, or IANA zone (e.g. New York, Tokyo)...'
                }
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

            {/* Browser Auto-Detected Suggestion */}
            {detectedTimezone && detectedTimezone !== value && (
              <button
                type="button"
                onClick={() => handleSelect(detectedTimezone)}
                className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-between gap-2 px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/50 border border-indigo-200/70 dark:border-indigo-800/70 text-xs lg:text-[11px] text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100/70 dark:hover:bg-indigo-900/50 transition-colors"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Sparkles className="w-3.5 h-3.5 lg:w-3 lg:h-3 shrink-0" />
                  <span className="truncate">
                    {language === 'es' ? 'Zona detectada:' : 'Detected:'}{' '}
                    <strong className="font-mono">{detectedTimezone}</strong>
                  </span>
                </span>
                <span className="font-semibold shrink-0">
                  {language === 'es' ? 'Usar' : 'Use'}
                </span>
              </button>
            )}
          </div>

          {/* Timezone Regions List */}
          <div className="max-h-72 overflow-y-auto p-1.5 space-y-2">
            {grouped.length === 0 ? (
              <div className="py-6 text-center text-sm lg:text-xs text-slate-400">
                {language === 'es' ? 'No se encontraron zonas horarias.' : 'No matching timezones found.'}
              </div>
            ) : (
              grouped.map(group => (
                <div key={group.region}>
                  <div className="px-2.5 py-1 text-xs lg:text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center justify-between">
                    <span>{group.label}</span>
                    <span className="font-mono">{group.items.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((tz: TimezoneEntry) => {
                      const isSelected = tz.id === value;
                      return (
                        <button
                          key={tz.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelect(tz.id)}
                          className={`w-full min-h-[44px] lg:min-h-0 flex items-center justify-between gap-2 px-3 lg:px-2.5 py-2.5 lg:py-2 rounded-xl text-left text-sm lg:text-xs transition-colors ${
                            isSelected
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate">{tz.city}</div>
                            <div className="text-xs lg:text-[10px] font-mono text-slate-400 truncate">{tz.id}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs lg:text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              {tz.offsetLabel}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                          </div>
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
    </div>
  );
};
