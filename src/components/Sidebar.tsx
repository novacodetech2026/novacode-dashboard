import React from 'react';
import { useApp } from '../context/AppContext';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import {
  LayoutDashboard,
  CalendarDays,
  Clock,
  Users,
  Sparkles,
  MessageSquare,
  Bot,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  LogOut,
  LogIn,
  ShieldCheck,
  ServerCog,
  LifeBuoy,
  Database,
  AlertTriangle,
} from 'lucide-react';

interface SidebarProps {
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, setIsMobileOpen }) => {
  const {
    activeTab,
    setActiveTab,
    t,
    language,
    theme,
    toggleTheme,
    currentTenant,
    availableTenants,
    setCurrentTenantId,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    conversations,
    supportTickets,
    supportNotifications = [],
    platformIncidents = [],
    capturedTechnicalIncidents = [],
    businessInvitations = [],
    authDiagnosticError,
    mode,
    setMode,
    currentUser,
    effectiveRole,
    isSuperAdminCheckFailed,
    canViewPlatformAdmin,
    canManageBusinessSettings,
    setIsAuthModalOpen,
    logout,
  } = useApp();

  const unreadMessagesCount = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  const unreadSupportCount = supportTickets.filter(
    tk => (!currentTenant.id || tk.businessId === currentTenant.id) && tk.unreadByBusiness
  ).length;

  const unreadAdminTicketIds = new Set<string>();
  if (canViewPlatformAdmin) {
    supportTickets.forEach(tk => {
      if (tk.unreadByAdmin) unreadAdminTicketIds.add(tk.id);
    });
    supportNotifications.forEach(n => {
      if (n.targetRole === 'super_admin' && !n.isRead && n.ticketId) {
        unreadAdminTicketIds.add(n.ticketId);
      }
    });
  }
  const unreadAdminSupportCount = unreadAdminTicketIds.size;

  const openIncidentsBadgeCount = canViewPlatformAdmin
    ? platformIncidents.filter(i => i.status !== 'resolved').length +
      businessInvitations.filter(inv => inv.status === 'failed').length +
      capturedTechnicalIncidents.filter(i => i.status !== 'resolved').length +
      (authDiagnosticError ? 1 : 0)
    : 0;

  const businessNavItems = [
    { id: 'overview', label: t.nav.overview, icon: LayoutDashboard },
    { id: 'calendar', label: t.nav.calendar, icon: CalendarDays },
    { id: 'appointments', label: t.nav.appointments, icon: Clock },
    { id: 'customers', label: t.nav.customers, icon: Users },
    { id: 'services', label: t.nav.services, icon: Sparkles },
    {
      id: 'messages',
      label: t.nav.messages,
      icon: MessageSquare,
      badge: unreadMessagesCount > 0 ? unreadMessagesCount : undefined,
    },
    { id: 'ai-assistant', label: t.nav.aiAssistant, icon: Bot },
    ...(canManageBusinessSettings
      ? [{ id: 'settings', label: t.nav.settings, icon: Settings }]
      : []),
    {
      id: 'support',
      label: t.nav.helpSupport,
      icon: LifeBuoy,
      badge: unreadSupportCount > 0 ? unreadSupportCount : undefined,
    },
  ];

  const adminNavItems = canViewPlatformAdmin
    ? [
        { id: 'admin', label: t.nav.platformAdmin, icon: ShieldCheck },
        {
          id: 'support-center',
          label: t.nav.supportCenter,
          icon: LifeBuoy,
          badge: unreadAdminSupportCount > 0 ? unreadAdminSupportCount : undefined,
        },
        {
          id: 'incidents',
          label: t.nav.supportIncidents,
          icon: AlertTriangle,
          badge: openIncidentsBadgeCount > 0 ? openIncidentsBadgeCount : undefined,
        },
        { id: 'infrastructure', label: t.nav.infrastructure, icon: ServerCog },
      ]
    : [];

  const getActualRoleLabel = () => {
    if (!currentUser) return '';
    if (currentUser.isSuperAdmin || effectiveRole === 'super_admin') return t.auth.roleSuperAdmin;
    if (isSuperAdminCheckFailed) {
      return canViewPlatformAdmin ? t.auth.roleCheckError : t.auth.roleVerificationNeeded;
    }
    const rawRole = currentUser.role || 'none';
    if (rawRole === 'owner') return t.auth.roleOwner;
    if (rawRole === 'admin') return t.auth.roleAdmin;
    if (rawRole === 'manager') return t.auth.roleManager;
    if (rawRole === 'staff' || rawRole === 'member') return t.auth.roleStaff;
    return t.auth.roleNone;
  };

  const handleNavClick = (id: string) => {
    setActiveTab(id);
    if (isMobileOpen) {
      setIsMobileOpen(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      {/* Main Sidebar */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-40 h-dvh lg:h-auto flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 transition-all duration-200 ease-out shrink-0 ${
          isMobileOpen ? 'translate-x-0 w-72 max-w-[85vw]' : '-translate-x-full lg:translate-x-0'
        } ${isSidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-64'}`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200/80 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-bold text-sm shadow-xs shadow-indigo-500/20 shrink-0">
              N
            </div>
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 block truncate">
                  Novacode Tech
                </span>
                <span className="text-xs lg:text-[11px] font-medium text-slate-500 dark:text-slate-400 block truncate">
                  {t.brand.tagline}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(prev => !prev)}
            className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            title={isSidebarCollapsed ? t.nav.expand : t.nav.collapse}
            aria-label={isSidebarCollapsed ? t.nav.expand : t.nav.collapse}
          >
            {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Modern Searchable Workspace Switcher */}
        <WorkspaceSwitcher
          currentTenant={currentTenant}
          availableTenants={availableTenants}
          isSidebarCollapsed={isSidebarCollapsed}
          canViewPlatformAdmin={canViewPlatformAdmin}
          activeTab={activeTab}
          language={language}
          onSelectTenant={tenantId => {
            setCurrentTenantId(tenantId);
            if (
              activeTab === 'admin' ||
              activeTab === 'infrastructure' ||
              activeTab === 'incidents' ||
              activeTab === 'support-center'
            ) {
              setActiveTab('overview');
            }
            if (isMobileOpen) setIsMobileOpen(false);
          }}
          onManageBusinesses={() => {
            setActiveTab('admin');
            if (isMobileOpen) setIsMobileOpen(false);
          }}
        />

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {/* Super Admin Only Section */}
          {adminNavItems.length > 0 && (
            <div className="space-y-1.5 lg:space-y-1">
              {!isSidebarCollapsed && (
                <div className="px-3 pb-1 text-xs lg:text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                  {language === 'es' ? 'Administración' : 'Platform'}
                </div>
              )}
              {adminNavItems.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    title={isSidebarCollapsed ? item.label : undefined}
                    className={`group relative w-full flex items-center ${
                      isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'
                    } py-2.5 rounded-xl text-sm lg:text-xs font-medium transition-all min-h-[44px] lg:min-h-[40px] ${
                      isActive
                        ? 'bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-semibold ring-1 ring-inset ring-violet-200/70 dark:ring-violet-800/60'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                      }`}
                    />
                    {!isSidebarCollapsed && (
                      <span className="truncate flex-1 text-left">{item.label}</span>
                    )}
                    {!isSidebarCollapsed && item.badge !== undefined && (
                      <span className="px-1.5 py-0.5 text-xs lg:text-[10px] font-bold font-mono tabular-nums rounded-md bg-violet-600 text-white leading-none">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Business Workspace Navigation */}
          <div className="space-y-1.5 lg:space-y-1">
            {!isSidebarCollapsed && adminNavItems.length > 0 && (
              <div className="px-3 pb-1 text-xs lg:text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {language === 'es' ? 'Espacio de Negocio' : 'Workspace'}
              </div>
            )}
            {businessNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={`group relative w-full flex items-center ${
                    isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'
                  } py-2.5 rounded-xl text-sm lg:text-xs font-medium transition-all min-h-[44px] lg:min-h-[40px] ${
                    isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold ring-1 ring-inset ring-indigo-200/70 dark:ring-indigo-800/60'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                    }`}
                  />
                  {!isSidebarCollapsed && (
                    <span className="truncate flex-1 text-left">{item.label}</span>
                  )}
                  {!isSidebarCollapsed && item.badge !== undefined && (
                    <span className="px-1.5 py-0.5 text-xs lg:text-[10px] font-bold font-mono tabular-nums rounded-md bg-indigo-600 text-white leading-none">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Data Mode Switcher: STRICTLY Super Admin Only (Never visible to Business Owners or Staff) */}
        {canViewPlatformAdmin && (
          !isSidebarCollapsed ? (
            <div className="mx-3 mb-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs lg:text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {language === 'es' ? 'Fuente de Datos' : 'Data Mode'}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-xs lg:text-[10px] font-semibold ${
                    mode === 'supabase' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${mode === 'supabase' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  {mode === 'supabase' ? 'Supabase' : 'Demo'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 lg:gap-1 p-0.5 rounded-lg bg-slate-200/60 dark:bg-slate-900/60 text-xs lg:text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setMode('supabase')}
                  className={`min-h-[44px] lg:min-h-0 py-1.5 lg:py-1 px-1.5 rounded-md transition-all text-center truncate ${
                    mode === 'supabase'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {language === 'es' ? 'En Vivo' : 'Live'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('demo')}
                  className={`min-h-[44px] lg:min-h-0 py-1.5 lg:py-1 px-1.5 rounded-md transition-all text-center truncate ${
                    mode === 'demo'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Demo
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-2 mb-2 flex justify-center">
              <button
                type="button"
                onClick={() => setMode(mode === 'supabase' ? 'demo' : 'supabase')}
                className={`min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 rounded-xl text-xs font-bold transition-colors ${
                  mode === 'supabase'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600'
                    : 'bg-amber-50 dark:bg-amber-950/50 text-amber-600'
                }`}
                title={mode === 'supabase' ? 'Supabase Live' : 'Demo Mode'}
              >
                <Database className="w-4 h-4" />
              </button>
            </div>
          )
        )}

        {/* Bottom User & Theme Bar */}
        <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3 border-t border-slate-200/80 dark:border-slate-800 space-y-2 shrink-0">
          {/* Theme Toggle Row */}
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-1'}`}>
            {!isSidebarCollapsed && (
              <span className="text-xs lg:text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {theme === 'dark'
                  ? language === 'es'
                    ? 'Tema Oscuro'
                    : 'Dark Theme'
                  : language === 'es'
                  ? 'Tema Claro'
                  : 'Light Theme'}
              </span>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-500" />}
            </button>
          </div>

          {/* User Account / Actual Role Status */}
          {currentUser ? (
            <div className="flex items-center justify-between pt-1 gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-xs ${
                    currentUser.isSuperAdmin
                      ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600'
                      : 'bg-gradient-to-br from-indigo-600 to-violet-600'
                  }`}
                >
                  {currentUser.email ? currentUser.email.charAt(0).toUpperCase() : 'U'}
                </div>
                {!isSidebarCollapsed && (
                  <div className="min-w-0">
                    <p className="text-sm lg:text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {getActualRoleLabel()}
                    </p>
                    <p className="text-xs lg:text-[10px] text-slate-400 truncate font-mono">
                      {currentUser.email}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                title={t.nav.logout}
                aria-label={t.nav.logout}
              >
                <LogOut className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              </button>
            </div>
          ) : (
            <div className="pt-1">
              {!isSidebarCollapsed ? (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all active:scale-[0.98]"
                >
                  <LogIn className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                  <span>{t.nav.login}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="w-full min-h-[44px] lg:min-h-0 p-2 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-600 transition-colors"
                  title={t.nav.login}
                >
                  <LogIn className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
