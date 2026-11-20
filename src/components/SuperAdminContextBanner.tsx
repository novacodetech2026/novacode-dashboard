import React from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  Building2,
  ArrowLeft,
  Clock,
  Users,
  Sparkles,
  Settings as SettingsIcon,
  LayoutDashboard,
} from 'lucide-react';
import { SUPER_ADMIN_ONLY_TABS } from '../utils/security';

export const SuperAdminContextBanner: React.FC = () => {
  const {
    t,
    canViewPlatformAdmin,
    currentUser,
    currentTenant,
    availableTenants,
    setCurrentTenantId,
    activeTab,
    setActiveTab,
  } = useApp();

  if (!canViewPlatformAdmin || !currentUser) {
    return null;
  }

  const isOnPlatformAdmin = (SUPER_ADMIN_ONLY_TABS as readonly string[]).includes(activeTab);

  const handleSelectorChange = (value: string) => {
    if (value === '__platform_admin__') {
      setActiveTab('admin');
      return;
    }
    setCurrentTenantId(value);
    if (isOnPlatformAdmin) {
      setActiveTab('overview');
    }
  };

  return (
    <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-violet-950 text-white border-b border-indigo-500/30 px-4 lg:px-8 py-3 lg:py-2.5">
      <div className="max-w-[1600px] mx-auto flex flex-col xl:flex-row xl:items-center justify-between gap-3 lg:gap-2.5">
        {/* Left: True Authenticated Super Admin Identity + Prominent Active Business */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/20 border border-violet-400/40 text-xs lg:text-[11px] font-bold text-violet-200 shrink-0 max-w-full">
            <ShieldCheck className="w-3.5 h-3.5 text-violet-300 shrink-0" />
            <span>{t.auth.roleSuperAdmin}</span>
            <span className="text-violet-300/70">·</span>
            <span className="font-mono text-xs lg:text-[10px] text-violet-100 truncate max-w-[160px] sm:max-w-[180px]">
              {currentUser.email}
            </span>
          </div>

          <span className="hidden md:inline-block text-xs lg:text-[10px] font-medium text-indigo-200/80 px-2 py-0.5 rounded bg-white/5 border border-white/10">
            {t.superAdmin.noImpersonationBadge}
          </span>

          {currentTenant?.id && (
            <div className="flex items-center gap-2 px-3 py-1.5 lg:py-1 rounded-xl bg-white/10 border border-white/15 min-w-0 max-w-full">
              <Building2 className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
              <span className="text-xs lg:text-[11px] text-indigo-200 font-medium shrink-0">
                {t.superAdmin.managingBusinessLabel}:
              </span>
              <span className="text-sm lg:text-xs font-extrabold text-white truncate">
                {currentTenant.name}
              </span>
              <span className="text-xs lg:text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-100 shrink-0">
                #{currentTenant.id}
              </span>
            </div>
          )}
        </div>

        {/* Right: Business Selector + Return to Platform Administration + Quick Business Links */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t.superAdmin.businessSelectorLabel}
            value={isOnPlatformAdmin ? '__platform_admin__' : (currentTenant?.id || '__platform_admin__')}
            onChange={e => handleSelectorChange(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] lg:min-h-0 px-3 py-2 lg:py-1.5 rounded-xl bg-slate-900/90 border border-indigo-400/40 text-base lg:text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-violet-400 sm:max-w-[260px]"
          >
            <option value="__platform_admin__">{t.superAdmin.platformAdminOption}</option>
            {availableTenants.map(biz => (
              <option key={biz.id} value={biz.id}>
                {biz.name} (#{biz.id})
              </option>
            ))}
          </select>

          {!isOnPlatformAdmin && (
            <>
              <div className="hidden sm:flex items-center gap-1 bg-white/5 p-0.5 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className={`min-h-[40px] lg:min-h-0 px-2.5 py-1.5 lg:px-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    activeTab === 'overview' ? 'bg-indigo-600 text-white' : 'text-indigo-200 hover:bg-white/10'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                  <span>{t.nav.overview}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('appointments')}
                  className={`min-h-[40px] lg:min-h-0 px-2.5 py-1.5 lg:px-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    activeTab === 'appointments' ? 'bg-indigo-600 text-white' : 'text-indigo-200 hover:bg-white/10'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                  <span>{t.nav.appointments}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('customers')}
                  className={`min-h-[40px] lg:min-h-0 px-2.5 py-1.5 lg:px-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    activeTab === 'customers' ? 'bg-indigo-600 text-white' : 'text-indigo-200 hover:bg-white/10'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                  <span>{t.nav.customers}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('services')}
                  className={`min-h-[40px] lg:min-h-0 px-2.5 py-1.5 lg:px-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    activeTab === 'services' ? 'bg-indigo-600 text-white' : 'text-indigo-200 hover:bg-white/10'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                  <span>{t.nav.services}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className={`min-h-[40px] lg:min-h-0 px-2.5 py-1.5 lg:px-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    activeTab === 'settings' ? 'bg-indigo-600 text-white' : 'text-indigo-200 hover:bg-white/10'
                  }`}
                >
                  <SettingsIcon className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                  <span>{t.nav.settings}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2 lg:px-3 lg:py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm lg:text-xs font-bold shadow-xs transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                <span>{t.superAdmin.returnToPlatformAdmin}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
