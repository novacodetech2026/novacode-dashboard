import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Menu,
  Plus,
  Bell,
  Clock,
  MessageSquare,
  ChevronRight,
  X,
  ShieldCheck,
  AlertTriangle,
  LifeBuoy,
  CheckCheck,
  CheckCircle2,
  CalendarClock,
  XCircle,
} from 'lucide-react';

interface TopHeaderProps {
  onOpenMobileMenu: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onOpenMobileMenu }) => {
  const {
    t,
    language,
    setLanguage,
    currentTenant,
    activeTab,
    setActiveTab,
    setIsNewBookingModalOpen,
    setSelectedAppointmentForDetail,
    setActiveConversationId,
    appointments,
    conversations,
    supabaseConfig,
    mode,
    currentUser,
    effectiveRole,
    isSuperAdminCheckFailed,
    authDiagnosticError,
    canViewPlatformAdmin,
    setIsAuthModalOpen,
    platformMetrics,
    platformIncidents,
    capturedTechnicalIncidents,
    supportTickets,
    markTicketRead,
    supportNotifications,
    markSingleSupportNotificationRead,
    markSupportNotificationsRead,
    setPendingAdminTicketId,
    setPendingAdminIncidentId,
    businessInvitations,
    businessNotifications,
    markBusinessNotificationsRead,
    markSingleBusinessNotificationRead,
    openAppointmentFromNotification,
  } = useApp();

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const tabTitles: Record<string, string> = {
    admin: t.nav.platformAdmin,
    'support-center': t.nav.supportCenter,
    incidents: t.nav.supportIncidents,
    infrastructure: t.nav.infrastructure,
    overview: t.nav.overview,
    calendar: t.nav.calendar,
    appointments: t.nav.appointments,
    customers: t.nav.customers,
    services: t.nav.services,
    messages: t.nav.messages,
    'ai-assistant': t.nav.aiAssistant,
    settings: t.nav.settings,
    support: t.nav.helpSupport,
  };

  const getHeaderRoleLabel = () => {
    if (mode !== 'supabase' || !currentUser) return null;
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

  const headerRoleLabel = getHeaderRoleLabel();
  const currentTabTitle = tabTitles[activeTab] || t.nav.overview;

  // Super Admin Alerts: ONLY support tickets, system failures, security/technical incidents, failed invites (never routine customer booking data)
  const failedInvites = canViewPlatformAdmin
    ? businessInvitations.filter(inv => inv.status === 'failed')
    : [];
  const openIncidents = canViewPlatformAdmin
    ? platformIncidents.filter(inc => inc.status !== 'resolved')
    : [];
  const sessionTechnicalIncidents = canViewPlatformAdmin
    ? capturedTechnicalIncidents.filter(
        cap =>
          cap.status !== 'resolved' &&
          !openIncidents.some(
            persisted =>
              persisted.title === cap.title && (persisted.businessId || '') === (cap.businessId || '')
          )
      )
    : [];
  const unreadAdminSupportNotifs = canViewPlatformAdmin
    ? supportNotifications.filter(n => n.targetRole === 'super_admin' && !n.isRead)
    : [];
  const unreadAdminTicketFallbacks = canViewPlatformAdmin
    ? supportTickets.filter(
        tk => tk.unreadByAdmin && !unreadAdminSupportNotifs.some(n => n.ticketId === tk.id)
      )
    : [];
  const hasHealthAlert =
    canViewPlatformAdmin &&
    (platformMetrics.systemHealth === 'degraded' || platformMetrics.systemHealth === 'offline');
  const hasAuthDiagnosticAlert = Boolean(authDiagnosticError || isSuperAdminCheckFailed);

  const superAdminAlertsCount =
    (hasAuthDiagnosticAlert ? 1 : 0) +
    (hasHealthAlert ? 1 : 0) +
    failedInvites.length +
    openIncidents.length +
    sessionTechnicalIncidents.length +
    unreadAdminSupportNotifs.length +
    unreadAdminTicketFallbacks.length;

  // Business Owner / Staff Notifications: Strictly scoped to currentTenant.id
  const scopedSupportNotifications = !canViewPlatformAdmin
    ? supportNotifications.filter(
        n => n.targetRole === 'business' && n.businessId === currentTenant.id && !n.isRead
      )
    : [];
  const unreadBusinessTicketFallbacks = !canViewPlatformAdmin
    ? supportTickets.filter(
        tk =>
          tk.businessId === currentTenant.id &&
          tk.unreadByBusiness &&
          !scopedSupportNotifications.some(n => n.ticketId === tk.id)
      )
    : [];
  const scopedBusinessNotifications = !canViewPlatformAdmin
    ? businessNotifications.filter(
        n =>
          n.businessId === currentTenant.id &&
          !n.read &&
          !(
            (n.type === 'support_reply' || n.type === 'support_status') &&
            n.ticketId &&
            scopedSupportNotifications.some(sn => sn.ticketId === n.ticketId)
          )
      )
    : [];
  const pendingAppointments = !canViewPlatformAdmin
    ? appointments.filter(a => a.status === 'pending')
    : [];
  const unreadConversations = !canViewPlatformAdmin
    ? conversations.filter(c => (c.unreadCount || 0) > 0)
    : [];

  const totalNotifications = canViewPlatformAdmin
    ? superAdminAlertsCount
    : scopedBusinessNotifications.length +
      scopedSupportNotifications.length +
      unreadBusinessTicketFallbacks.length +
      pendingAppointments.length +
      unreadConversations.length;

  return (
    <header className="h-16 px-3 sm:px-4 lg:px-8 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-4">
      {/* Zone 1: Mobile Hamburger + Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm lg:text-xs font-medium text-slate-500 dark:text-slate-400 truncate min-w-0">
          <span className="hidden sm:inline-block font-semibold text-slate-900 dark:text-slate-100 truncate">
            {currentTenant.name}
          </span>
          <span className="hidden sm:inline-block text-slate-300 dark:text-slate-600">/</span>
          <span className="text-indigo-600 dark:text-indigo-400 font-semibold truncate">
            {currentTabTitle}
          </span>
        </div>
      </div>

      {/* Zone 2: Timezone, Role & Infrastructure Status (Strictly role-gated) */}
      <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-500 dark:text-slate-400 shrink-0 min-w-0">
        <span className="hidden xl:inline font-mono text-[11px] tabular-nums">{currentTenant.timezone}</span>
        <span aria-hidden="true" className="hidden xl:inline text-slate-300 dark:text-slate-600">·</span>

        {headerRoleLabel && (
          <span
            title={canViewPlatformAdmin && authDiagnosticError ? authDiagnosticError : headerRoleLabel || undefined}
            className={`hidden sm:inline-flex items-center gap-1.5 px-2 lg:px-2.5 py-1 rounded-lg text-xs lg:text-[11px] font-semibold border whitespace-nowrap max-w-[140px] md:max-w-none truncate ${
              currentUser?.isSuperAdmin || effectiveRole === 'super_admin'
                ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800'
                : isSuperAdminCheckFailed
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                : 'bg-slate-100/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            {(currentUser?.isSuperAdmin || effectiveRole === 'super_admin') && (
              <ShieldCheck className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
            )}
            {isSuperAdminCheckFailed && !(currentUser?.isSuperAdmin || effectiveRole === 'super_admin') && (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span className="truncate">{headerRoleLabel}</span>
          </span>
        )}

        {/* Infrastructure status toggle: STRICTLY Super Admin Only */}
        {canViewPlatformAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('infrastructure')}
            className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs lg:text-[11px] font-semibold border transition-colors whitespace-nowrap min-h-[44px] lg:min-h-0 ${
              mode === 'supabase' && supabaseConfig.isConnected
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800 hover:bg-emerald-100/70'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40'
            }`}
            title={language === 'es' ? 'Abrir Infraestructura de Plataforma' : 'Open Platform Infrastructure'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                mode === 'supabase' && supabaseConfig.isConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span>
              {mode === 'supabase' && supabaseConfig.isConnected
                ? (language === 'es' ? 'En Vivo' : 'Live')
                : (language === 'es' ? 'Modo Demo' : 'Demo')}
            </span>
          </button>
        )}
      </div>

      {/* Zone 3: Notifications + Global EN/ES Switcher + Primary CTA */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Notifications Bell */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="relative p-2 rounded-xl border border-slate-200/80 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors min-w-[44px] min-h-[44px] lg:min-w-[38px] lg:min-h-[38px] flex items-center justify-center"
            title={t.dashboard.notifications}
            aria-label={t.dashboard.notifications}
          >
            <Bell className="w-4 h-4" />
            {totalNotifications > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 lg:w-4 lg:h-4 rounded-full bg-rose-500 text-white text-xs lg:text-[10px] font-bold font-mono tabular-nums flex items-center justify-center leading-none ring-2 ring-white dark:ring-slate-900">
                {totalNotifications}
              </span>
            )}
          </button>

          {/* Notifications Dropdown (Strictly Separated by Role & Business) */}
          {isNotificationsOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsNotificationsOpen(false)}
              />
              <div className="fixed lg:absolute left-4 right-4 lg:left-auto lg:right-0 top-[4.25rem] lg:top-full lg:mt-2 w-auto lg:w-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {canViewPlatformAdmin ? t.dashboard.platformAlerts : t.dashboard.notifications}
                    </h4>
                    {totalNotifications > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 text-xs lg:text-[10px] font-bold font-mono tabular-nums">
                        {totalNotifications}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!canViewPlatformAdmin &&
                      (scopedBusinessNotifications.length > 0 ||
                        scopedSupportNotifications.length > 0 ||
                        unreadBusinessTicketFallbacks.length > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            markBusinessNotificationsRead();
                            markSupportNotificationsRead();
                          }}
                          className="inline-flex items-center gap-1 min-h-[44px] lg:min-h-0 px-2 lg:px-0 text-xs lg:text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <CheckCheck className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                          <span>{t.dashboard.clearAll}</span>
                        </button>
                      )}
                    {canViewPlatformAdmin &&
                      (unreadAdminSupportNotifs.length > 0 ||
                        unreadAdminTicketFallbacks.length > 0) && (
                        <button
                          type="button"
                          onClick={markSupportNotificationsRead}
                          className="inline-flex items-center gap-1 min-h-[44px] lg:min-h-0 px-2 lg:px-0 text-xs lg:text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <CheckCheck className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                          <span>{t.dashboard.clearAll}</span>
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => setIsNotificationsOpen(false)}
                      className="min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                    >
                      <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                    </button>
                  </div>
                </div>

                {canViewPlatformAdmin ? (
                  <div className="max-h-[55dvh] lg:max-h-72 overflow-y-auto space-y-2">
                    {totalNotifications === 0 ? (
                      <p className="text-sm lg:text-xs text-slate-400 text-center py-6">
                        {t.dashboard.noPlatformAlerts}
                      </p>
                    ) : (
                      <>
                        {hasAuthDiagnosticAlert && (
                          <div
                            onClick={() => {
                              setActiveTab('incidents');
                              setIsNotificationsOpen(false);
                            }}
                            className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-800/70 text-sm lg:text-xs cursor-pointer flex items-start gap-2.5"
                          >
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 dark:text-slate-100">
                                {t.auth.superAdminRpcFailedTitle}
                              </p>
                              <p className="text-xs lg:text-[11px] text-rose-700 dark:text-rose-300 font-mono truncate">
                                {authDiagnosticError}
                              </p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                          </div>
                        )}

                        {hasHealthAlert && (
                          <div
                            onClick={() => {
                              setActiveTab('infrastructure');
                              setIsNotificationsOpen(false);
                            }}
                            className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/70 text-sm lg:text-xs cursor-pointer flex items-start gap-2.5"
                          >
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 dark:text-slate-100">
                                {t.superAdmin.systemHealth}: {platformMetrics.systemHealth.toUpperCase()}
                              </p>
                              <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                {platformMetrics.healthDetail}
                              </p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                          </div>
                        )}

                        {failedInvites.map(inv => (
                          <div
                            key={inv.id}
                            onClick={() => {
                              setActiveTab('incidents');
                              setIsNotificationsOpen(false);
                            }}
                            className="p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/60 text-sm lg:text-xs cursor-pointer flex items-start gap-2.5"
                          >
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                {language === 'es' ? 'Fallo de Invitación' : 'Failed Owner Invite'} · {inv.businessName || `#${inv.businessId}`}
                              </p>
                              <p className="text-xs lg:text-[11px] text-slate-500 font-mono truncate">
                                {inv.lastError || inv.email}
                              </p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                          </div>
                        ))}

                        {unreadAdminSupportNotifs.map(notif => (
                          <div
                            key={notif.id}
                            onClick={() => {
                              if (notif.ticketId) {
                                markTicketRead(notif.ticketId);
                                setPendingAdminTicketId?.(notif.ticketId);
                                setActiveTab('support-center');
                              } else if (notif.incidentId) {
                                markSingleSupportNotificationRead?.(notif.id);
                                setPendingAdminIncidentId?.(notif.incidentId);
                                setActiveTab('incidents');
                              } else {
                                markSingleSupportNotificationRead?.(notif.id);
                                setActiveTab('support-center');
                              }
                              setIsNotificationsOpen(false);
                            }}
                            className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-800/70 text-sm lg:text-xs cursor-pointer flex items-start gap-2.5"
                          >
                            <LifeBuoy className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                {notif.title}
                              </p>
                              <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                {notif.body}
                              </p>
                            </div>
                            {markSingleSupportNotificationRead && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  markSingleSupportNotificationRead(notif.id);
                                }}
                                aria-label={`${t.superAdmin.markReadSingle}: ${notif.title}`}
                                className="min-h-[44px] lg:min-h-0 px-2.5 lg:px-1.5 py-1.5 lg:py-0.5 rounded-md bg-white/90 dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-xs lg:text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 shrink-0"
                              >
                                {t.superAdmin.markReadSingle}
                              </button>
                            )}
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                          </div>
                        ))}

                        {unreadAdminTicketFallbacks.map(tk => (
                          <div
                            key={tk.id}
                            onClick={() => {
                              markTicketRead(tk.id);
                              setPendingAdminTicketId?.(tk.id);
                              setActiveTab('support-center');
                              setIsNotificationsOpen(false);
                            }}
                            className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-800/70 text-sm lg:text-xs cursor-pointer flex items-start gap-2.5"
                          >
                            <LifeBuoy className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                {tk.businessName || `Business #${tk.businessId}`}: {tk.subject}
                              </p>
                              <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                {t.helpSupport.statuses[tk.status]}
                              </p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                          </div>
                        ))}

                        {sessionTechnicalIncidents.map(inc => (
                          <div
                            key={inc.id}
                            onClick={() => {
                              setActiveTab('incidents');
                              setIsNotificationsOpen(false);
                            }}
                            className="p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/60 text-sm lg:text-xs cursor-pointer flex items-start gap-2.5"
                          >
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                {inc.title}
                              </p>
                              <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                {inc.businessName || 'Platform'} · {inc.severity.toUpperCase()}
                              </p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                          </div>
                        ))}

                        {openIncidents.map(inc => (
                          <div
                            key={inc.id}
                            onClick={() => {
                              setPendingAdminIncidentId?.(inc.id);
                              setActiveTab('incidents');
                              setIsNotificationsOpen(false);
                            }}
                            className="p-3 rounded-xl bg-violet-50/60 dark:bg-violet-950/30 border border-violet-200/60 dark:border-violet-800/60 text-sm lg:text-xs cursor-pointer flex items-start gap-2.5"
                          >
                            <LifeBuoy className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                {inc.title}
                              </p>
                              <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                {inc.businessName || (inc.businessId ? `#${inc.businessId}` : 'Platform')} · {inc.severity.toUpperCase()}
                              </p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="max-h-[55dvh] lg:max-h-72 overflow-y-auto space-y-2">
                      {totalNotifications === 0 ? (
                        <p className="text-sm lg:text-xs text-slate-400 text-center py-6">
                          {t.dashboard.noNotifications}
                        </p>
                      ) : (
                        <>
                          {scopedSupportNotifications.map(notif => (
                            <div
                              key={notif.id}
                              onClick={() => {
                                if (notif.ticketId) {
                                  markTicketRead(notif.ticketId);
                                } else {
                                  markSupportNotificationsRead();
                                }
                                setActiveTab('support');
                                setIsNotificationsOpen(false);
                              }}
                              className="p-3 rounded-xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200/70 dark:border-violet-800/70 text-sm lg:text-xs cursor-pointer transition-all flex items-start gap-2.5"
                            >
                              <LifeBuoy className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {notif.title}
                                </p>
                                <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                  {notif.body}
                                </p>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                            </div>
                          ))}

                          {unreadBusinessTicketFallbacks.map(tk => (
                            <div
                              key={tk.id}
                              onClick={() => {
                                markTicketRead(tk.id);
                                setActiveTab('support');
                                setIsNotificationsOpen(false);
                              }}
                              className="p-3 rounded-xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200/70 dark:border-violet-800/70 text-sm lg:text-xs cursor-pointer transition-all flex items-start gap-2.5"
                            >
                              <LifeBuoy className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {language === 'es' ? 'Actualización de Soporte' : 'Support Update'}: {tk.subject}
                                </p>
                                <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                  {t.helpSupport.statuses[tk.status]}
                                </p>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                            </div>
                          ))}

                          {scopedBusinessNotifications.map(notif => {
                            const isCancelled =
                              notif.eventType === 'appointment_cancelled' ||
                              notif.type === 'appointment_cancelled';
                            const isRescheduled =
                              notif.eventType === 'appointment_rescheduled' ||
                              notif.type === 'appointment_updated';
                            const isConfirmed =
                              notif.eventType === 'appointment_confirmed' ||
                              notif.type === 'appointment_confirmed';

                            const displayTitle = isCancelled
                              ? t.dashboard.bookingCancelledTitle
                              : isRescheduled
                              ? t.dashboard.bookingRescheduledTitle
                              : isConfirmed
                              ? t.dashboard.bookingConfirmedTitle
                              : notif.title;

                            const hasStructuredDetails = Boolean(
                              notif.customerName || notif.serviceName || notif.appointmentDate
                            );
                            const primaryLine = hasStructuredDetails
                              ? `${notif.customerName || t.appointment.customer} · ${
                                  notif.serviceName || t.appointment.service
                                }`
                              : notif.description;
                            const scheduleLine = notif.appointmentDate
                              ? notif.appointmentStartTime
                                ? `${notif.appointmentDate} @ ${notif.appointmentStartTime}`
                                : notif.appointmentDate
                              : notif.appointmentStartTime || '';

                            const cardTone = isCancelled
                              ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200/70 dark:border-rose-800/70 hover:border-rose-300'
                              : isRescheduled
                              ? 'bg-sky-50/70 dark:bg-sky-950/30 border-sky-200/70 dark:border-sky-800/70 hover:border-sky-300'
                              : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/70 dark:border-emerald-800/70 hover:border-emerald-300';

                            const IconComp = isCancelled
                              ? XCircle
                              : isRescheduled
                              ? CalendarClock
                              : CheckCircle2;
                            const iconTone = isCancelled
                              ? 'text-rose-600 dark:text-rose-400'
                              : isRescheduled
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-emerald-600 dark:text-emerald-400';

                            return (
                              <div
                                key={notif.id}
                                onClick={() => {
                                  if (openAppointmentFromNotification) {
                                    openAppointmentFromNotification(notif);
                                  } else {
                                    markSingleBusinessNotificationRead?.(notif.id);
                                    setActiveTab('appointments');
                                  }
                                  setIsNotificationsOpen(false);
                                }}
                                className={`p-3 rounded-xl border text-sm lg:text-xs cursor-pointer transition-all flex items-start gap-2.5 ${cardTone}`}
                              >
                                <IconComp className={`w-4 h-4 shrink-0 mt-0.5 ${iconTone}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                    {displayTitle}
                                  </p>
                                  <p className="text-xs lg:text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                                    {primaryLine}
                                  </p>
                                  {scheduleLine && (
                                    <p className="text-xs lg:text-[11px] text-slate-500 font-mono tabular-nums truncate mt-0.5">
                                      {scheduleLine}
                                    </p>
                                  )}
                                </div>
                                {markSingleBusinessNotificationRead && (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      markSingleBusinessNotificationRead(notif.id);
                                    }}
                                    aria-label={`${t.dashboard.markReadSingle}: ${primaryLine}`}
                                    className="min-h-[44px] lg:min-h-0 px-2.5 lg:px-1.5 py-1.5 lg:py-0.5 rounded-md bg-white/90 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs lg:text-[10px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                                  >
                                    {t.dashboard.markReadSingle}
                                  </button>
                                )}
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                              </div>
                            );
                          })}

                          {pendingAppointments.map(apt => (
                            <div
                              key={apt.id}
                              onClick={() => {
                                setSelectedAppointmentForDetail(apt);
                                setIsNotificationsOpen(false);
                              }}
                              className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/60 hover:border-amber-300 text-sm lg:text-xs cursor-pointer transition-all flex items-start gap-2.5"
                            >
                              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {apt.customerName} · {apt.serviceName}
                                </p>
                                <p className="text-xs lg:text-[11px] text-slate-500 font-mono tabular-nums">
                                  {apt.date} @ {apt.startTime} ({t.appointment.pending})
                                </p>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                            </div>
                          ))}

                          {unreadConversations.map(conv => (
                            <div
                              key={conv.id}
                              onClick={() => {
                                setActiveTab('messages');
                                setActiveConversationId(conv.id);
                                setIsNotificationsOpen(false);
                              }}
                              className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60 hover:border-indigo-300 text-sm lg:text-xs cursor-pointer transition-all flex items-start gap-2.5"
                            >
                              <MessageSquare className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {conv.customerName} ({conv.channel.toUpperCase()})
                                </p>
                                <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                                  {conv.lastMessageSnippet}
                                </p>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    <p className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs lg:text-[10px] text-slate-400 leading-relaxed">
                      {t.dashboard.externalMessagingNotice}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Single Global Language Selector (EN | ES) */}
        <div
          className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80"
          role="group"
          aria-label="Language selection"
        >
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`min-h-[44px] min-w-[40px] lg:min-h-0 lg:min-w-0 px-2 sm:px-2.5 py-1.5 lg:py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              language === 'en'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs ring-1 ring-slate-900/5 dark:ring-white/10'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLanguage('es')}
            className={`min-h-[44px] min-w-[40px] lg:min-h-0 lg:min-w-0 px-2 sm:px-2.5 py-1.5 lg:py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              language === 'es'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs ring-1 ring-slate-900/5 dark:ring-white/10'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            ES
          </button>
        </div>

        {/* Primary Action Button (Single New Appointment button in top nav) */}
        <button
          type="button"
          onClick={() => setIsNewBookingModalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm lg:text-xs font-semibold shadow-xs active:scale-[0.98] transition-all whitespace-nowrap min-h-[44px] lg:min-h-[38px]"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">{t.dashboard.newAppointment}</span>
          <span className="sm:hidden">{language === 'es' ? 'Cita' : 'Book'}</span>
        </button>
      </div>
    </header>
  );
};
