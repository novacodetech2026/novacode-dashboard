import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Tenant, Language } from '../types';
import { getCategoryDisplayLabel } from '../data/businessCategories';
import { CORPORATE_BRAND } from '../data/branding';
import { Check, ChevronsUpDown, Search, ShieldCheck, Building2, X } from 'lucide-react';

interface WorkspaceSwitcherProps {
  currentTenant: Tenant;
  availableTenants: Tenant[];
  isSidebarCollapsed: boolean;
  canViewPlatformAdmin: boolean;
  activeTab: string;
  language: Language;
  onSelectTenant: (tenantId: string) => void;
  onManageBusinesses: () => void;
}

export function getBusinessInitials(name?: string): string {
  const cleaned = (name || 'NT').trim();
  if (!cleaned) return 'NT';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export const WorkspaceAvatar: React.FC<{
  tenant: Tenant;
  size?: 'sm' | 'md';
}> = ({ tenant, size = 'md' }) => {
  const isImageUrl =
    typeof tenant.logo === 'string' &&
    (tenant.logo.startsWith('http://') || tenant.logo.startsWith('https://') || tenant.logo.startsWith('data:'));

  const dimensions = size === 'sm' ? 'w-7 h-7 text-[11px] rounded-lg' : 'w-9 h-9 text-xs rounded-xl';

  if (isImageUrl) {
    return (
      <img
        src={tenant.logo}
        alt={tenant.name}
        className={`${dimensions} object-cover border border-slate-200 dark:border-slate-700 shrink-0`}
      />
    );
  }

  const initials = getBusinessInitials(tenant.name);
  return (
    <div
      className={`${dimensions} bg-gradient-to-br from-indigo-500/15 via-violet-500/15 to-indigo-600/20 dark:from-indigo-500/30 dark:to-violet-500/30 border border-indigo-200/80 dark:border-indigo-700/60 text-indigo-700 dark:text-indigo-200 font-bold tracking-tight flex items-center justify-center shrink-0`}
    >
      {initials}
    </div>
  );
};

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  currentTenant,
  availableTenants,
  isSidebarCollapsed,
  canViewPlatformAdmin,
  activeTab,
  language,
  onSelectTenant,
  onManageBusinesses,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 20);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEsc);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const filteredTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableTenants;
    return availableTenants.filter(tnt => {
      const catLabel = getCategoryDisplayLabel(
        tnt.category,
        language,
        tnt.categoryLabelEn,
        tnt.categoryLabelEs,
        tnt.settings?.categoryDetails?.customName
      ).toLowerCase();
      return (
        tnt.name.toLowerCase().includes(q) ||
        tnt.id.toLowerCase().includes(q) ||
        catLabel.includes(q)
      );
    });
  }, [availableTenants, searchQuery, language]);

  const isCorporateShell = !currentTenant.id;
  const activeCategoryLabel = isCorporateShell
    ? (language === 'es' ? CORPORATE_BRAND.taglineEs : CORPORATE_BRAND.taglineEn)
    : getCategoryDisplayLabel(
        currentTenant.category,
        language,
        currentTenant.categoryLabelEn,
        currentTenant.categoryLabelEs,
        currentTenant.settings?.categoryDetails?.customName
      );

  return (
    <div ref={containerRef} className="p-3 border-b border-slate-200/80 dark:border-slate-800 relative">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        title={currentTenant.name}
        className={`w-full min-h-[44px] lg:min-h-0 flex items-center ${isSidebarCollapsed ? 'justify-center p-1.5' : 'gap-2.5 p-2'} rounded-xl border transition-all text-left ${
          isOpen
            ? 'bg-slate-100/90 dark:bg-slate-800 border-indigo-300 dark:border-indigo-700 shadow-xs'
            : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200/70 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100/60 dark:hover:bg-slate-800/70'
        }`}
      >
        {isCorporateShell ? (
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
            N
          </div>
        ) : (
          <WorkspaceAvatar tenant={currentTenant} size="md" />
        )}

        {!isSidebarCollapsed && (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm lg:text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {isCorporateShell ? CORPORATE_BRAND.companyName : currentTenant.name}
                </p>
              </div>
              <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {activeCategoryLabel}
              </p>
            </div>
            <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </>
        )}
      </button>

      {/* Floating Searchable Dropdown */}
      {isOpen && (
        <div
          className={`absolute z-50 mt-1.5 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
            isSidebarCollapsed
              ? 'left-full top-2 ml-2 w-72'
              : 'left-3 right-3 top-full'
          }`}
        >
          {/* Search Input */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
            <div className="relative">
              <Search className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={language === 'es' ? 'Buscar espacio de trabajo...' : 'Find workspace...'}
                className="w-full min-h-[44px] lg:min-h-0 pl-8 pr-9 lg:pr-7 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-0 lg:right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Authorized Businesses List */}
          <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5" role="listbox">
            <div className="px-2 py-1 text-xs lg:text-[10px] font-bold tracking-wider uppercase text-slate-400 flex items-center justify-between">
              <span>{language === 'es' ? 'Espacios de trabajo' : 'Workspaces'}</span>
              <span className="font-mono tabular-nums">{filteredTenants.length}</span>
            </div>

            {filteredTenants.length === 0 ? (
              <div className="py-5 px-3 text-center text-sm lg:text-xs text-slate-400">
                {language === 'es' ? 'Sin negocios coincidentes' : 'No matching businesses'}
              </div>
            ) : (
              filteredTenants.map(tnt => {
                const isSelected = tnt.id === currentTenant.id;
                const catLabel = getCategoryDisplayLabel(
                  tnt.category,
                  language,
                  tnt.categoryLabelEn,
                  tnt.categoryLabelEs,
                  tnt.settings?.categoryDetails?.customName
                );
                return (
                  <button
                    key={tnt.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelectTenant(tnt.id);
                      setIsOpen(false);
                    }}
                    className={`w-full min-h-[44px] lg:min-h-0 flex items-center gap-2.5 px-2.5 lg:px-2 py-2.5 lg:py-2 rounded-xl text-left text-sm lg:text-xs transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <WorkspaceAvatar tenant={tnt} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{tnt.name}</span>
                        {tnt.isActive === false && (
                          <span className="text-xs lg:text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            ({language === 'es' ? 'Suspendido' : 'Suspended'})
                          </span>
                        )}
                      </div>
                      <div className="text-xs lg:text-[10px] text-slate-400 truncate">
                        {catLabel}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Super Admin Only: Manage Businesses */}
          {canViewPlatformAdmin && (
            <div className="p-1.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80">
              <button
                type="button"
                onClick={() => {
                  onManageBusinesses();
                  setIsOpen(false);
                }}
                className={`w-full min-h-[44px] lg:min-h-0 flex items-center gap-2 px-2.5 py-2.5 lg:py-2 rounded-xl text-sm lg:text-xs font-semibold transition-colors ${
                  activeTab === 'admin'
                    ? 'bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {activeTab === 'admin' ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                )}
                <span className="truncate">
                  {language === 'es' ? 'Administrar Negocios' : 'Manage Businesses'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
