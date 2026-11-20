import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { WorkspaceAvatar } from './WorkspaceSwitcher';
import { getCategoryDisplayLabel } from '../data/businessCategories';
import { CORPORATE_BRAND } from '../data/branding';
import {
  CalendarDays,
  Clock,
  AlertCircle,
  Users,
  Home,
  Building,
  CheckCircle2,
  Bot,
  ChevronRight,
  ArrowUpRight,
  ShieldCheck,
  MessageSquare,
  Check,
  RefreshCw,
} from 'lucide-react';
import { AppointmentStatus } from '../types';
import {
  getDateStringInTimezone,
  getHourInTimezone,
  formatAppointmentDuration,
} from '../utils/dateTime';
import { resolveBusinessHoursForDate } from '../utils/scheduling';

export const DashboardView: React.FC = () => {
  const {
    t,
    language,
    currentTenant,
    appointments,
    customers,
    conversations,
    setSelectedAppointmentForDetail,
    updateAppointmentStatus,
    setActiveTab,
    setActiveConversationId,
    mode,
    isLoadingLiveData,
    liveDataError,
    reloadLiveAppointments,
    currentUser,
    hasNoBusinessMembership,
    isSuperAdminCheckFailed,
    effectiveRole,
    setIsAuthModalOpen,
    activeServicesCount,
  } = useApp();

  const isCorporateShell = !currentTenant.id;

  const now = new Date();
  const todayStr = getDateStringInTimezone(now, currentTenant.timezone);
  const currentHour = getHourInTimezone(now, currentTenant.timezone);

  // Personalized Greeting
  const greetingText = useMemo(() => {
    let base: string = t.dashboard.greetingMorning;
    if (currentHour >= 12 && currentHour < 18) {
      base = t.dashboard.greetingAfternoon;
    } else if (currentHour >= 18 || currentHour < 5) {
      base = t.dashboard.greetingEvening;
    }
    return base.replace('{name}', currentTenant.name);
  }, [t, currentHour, currentTenant.name]);

  // Formatted date in active language
  const formattedTodayDate = useMemo(() => {
    return new Intl.DateTimeFormat(language === 'es' ? 'es-MX' : 'en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: currentTenant.timezone,
    }).format(now);
  }, [language, currentTenant.timezone, now]);

  // Operating Hours for Today (respecting specialHours / holiday overrides)
  const todayHours = resolveBusinessHoursForDate(currentTenant, todayStr);

  // Real Database KPIs calculation
  const todayAppointments = useMemo(() => {
    return appointments
      .filter(a => a.date === todayStr)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  }, [appointments, todayStr]);

  const inBusinessTodayCount = todayAppointments.filter(a => a.locationType === 'in_business').length;
  const atHomeTodayCount = todayAppointments.filter(a => a.locationType === 'at_home').length;

  const upcomingAppointments = useMemo(() => {
    return appointments.filter(a => a.date > todayStr && a.status !== 'cancelled' && a.status !== 'no_show');
  }, [appointments, todayStr]);

  const pendingAppointments = useMemo(() => {
    return appointments.filter(a => a.status === 'pending');
  }, [appointments]);

  const activeCustomersCount = useMemo(() => {
    const cutoffMs = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const recentBookedIds = new Set(
      appointments
        .filter(a => {
          if (a.status === 'cancelled' || a.status === 'no_show') return false;
          const ts = Date.parse(a.date);
          return Number.isFinite(ts) && ts >= cutoffMs;
        })
        .map(a => a.customerId)
    );
    return customers.filter(c => {
      if ((c.totalAppointments || 0) > 0) return true;
      if (recentBookedIds.has(c.id)) return true;
      const lastTs = c.lastInteractionAt ? Date.parse(c.lastInteractionAt) : NaN;
      return Number.isFinite(lastTs) && lastTs >= cutoffMs;
    }).length;
  }, [customers, appointments]);

  // Recent 3 Conversations
  const recentConversations = useMemo(() => {
    return [...conversations].slice(0, 3);
  }, [conversations]);

  // Status badges styling (Pending = Amber, Confirmed = Green, Cancelled = Neutral Gray)
  const statusBadgeConfig: Record<AppointmentStatus, { bg: string; text: string; label: string }> = {
    pending: {
      bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/80',
      text: 'text-amber-700 dark:text-amber-400',
      label: t.appointment.pending,
    },
    confirmed: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/80',
      text: 'text-emerald-700 dark:text-emerald-400',
      label: t.appointment.confirmed,
    },
    completed: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/80',
      text: 'text-emerald-700 dark:text-emerald-400',
      label: t.appointment.completed,
    },
    cancelled: {
      bg: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 line-through',
      text: 'text-slate-500 dark:text-slate-400',
      label: t.appointment.cancelled,
    },
    no_show: {
      bg: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/80',
      text: 'text-rose-700 dark:text-rose-400',
      label: t.appointment.noShow,
    },
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* 1. Welcoming Compact Header (Isolated Corporate Brand vs. Client Business Profile) */}
      {isCorporateShell ? (
        <div className="p-4 lg:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-bold text-base flex items-center justify-center shadow-xs shrink-0">
              N
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {language === 'es' ? CORPORATE_BRAND.taglineEs : CORPORATE_BRAND.taglineEn}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
                {language === 'es' ? CORPORATE_BRAND.welcomeTitleEs : CORPORATE_BRAND.welcomeTitleEn}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                {language === 'es' ? CORPORATE_BRAND.welcomeSubtitleEs : CORPORATE_BRAND.welcomeSubtitleEn}
              </p>
              <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
                {language === 'es' ? CORPORATE_BRAND.descriptionEs : CORPORATE_BRAND.descriptionEn}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 lg:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <WorkspaceAvatar tenant={currentTenant} size="md" />
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {getCategoryDisplayLabel(
                    currentTenant.category,
                    language,
                    currentTenant.categoryLabelEn,
                    currentTenant.categoryLabelEs,
                    currentTenant.settings?.categoryDetails?.customName
                  )}
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="text-xs font-medium text-slate-500 capitalize">
                  {formattedTodayDate}
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-1.5 h-1.5 rounded-full ${todayHours.isClosed ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                  <span className="font-medium tabular-nums">
                    {todayHours.isClosed
                      ? t.dashboard.businessClosed
                      : `${t.dashboard.businessOpen}: ${todayHours.open} - ${todayHours.close}`}
                  </span>
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="text-xs font-medium text-slate-500 tabular-nums">
                  {t.services.totalServices.replace('{count}', String(activeServicesCount))}
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
                {greetingText}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {currentTenant.description || t.dashboard.subtitle}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Live Mode Authentication / Membership Security Banners */}
      {mode === 'supabase' && !currentUser && (
        <div className="p-4 lg:p-5 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.auth.signInTitle}
              </h3>
              <p className="text-sm lg:text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                {t.auth.signInRequiredDesc}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            className="min-h-[44px] lg:min-h-0 px-4 py-2.5 lg:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors shrink-0 self-start sm:self-auto"
          >
            {t.auth.signInButton}
          </button>
        </div>
      )}

      {mode === 'supabase' && currentUser && hasNoBusinessMembership && !isSuperAdminCheckFailed && (
        <div className="p-4 lg:p-5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-start gap-3 shadow-xs">
          <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
              {t.auth.noMembershipTitle}
            </h3>
            <p className="text-sm lg:text-xs text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">
              {t.auth.noMembershipDesc}
            </p>
          </div>
        </div>
      )}

      {mode === 'supabase' && currentUser && effectiveRole === 'staff' && !isSuperAdminCheckFailed && (
        <div className="p-4 lg:px-4 lg:py-3 rounded-2xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3 text-sm lg:text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-indigo-500 shrink-0" />
          <div>
            <span className="font-bold text-slate-900 dark:text-slate-100">{t.auth.staffRestrictedTitle}: </span>
            <span>{t.auth.staffRestrictedNotice}</span>
          </div>
        </div>
      )}

      {/* 2. Four Compact KPI Cards in One Row on Desktop */}
      <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {/* KPI 1: Today's Appointments */}
        <div className="p-4 lg:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-800/60 shadow-xs transition-all group">
          <div className="flex items-center justify-between mb-2.5 gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t.dashboard.todayAppointments}
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center transition-transform group-hover:scale-105 shrink-0">
              <CalendarDays className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100 tracking-tight">
            {todayAppointments.length}
          </div>
          <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1.5 font-medium truncate">
            <span>{inBusinessTodayCount} {t.appointment.inBusiness.toLowerCase()}</span>
            <span>·</span>
            <span>{atHomeTodayCount} {t.appointment.atHome.toLowerCase()}</span>
          </p>
        </div>

        {/* KPI 2: Upcoming Bookings */}
        <div className="p-4 lg:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-800/60 shadow-xs transition-all group">
          <div className="flex items-center justify-between mb-2.5 gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t.dashboard.upcomingAppointments}
            </span>
            <div className="w-8 h-8 rounded-xl bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center transition-transform group-hover:scale-105 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100 tracking-tight">
            {upcomingAppointments.length}
          </div>
          <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 font-medium truncate">
            {t.dashboard.upcomingAppointmentsDesc}
          </p>
        </div>

        {/* KPI 3: Pending Confirmations */}
        <div className={`p-4 lg:p-5 rounded-2xl border shadow-xs transition-all group ${
          pendingAppointments.length > 0 
            ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-800/80 hover:border-amber-300' 
            : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-amber-300'
        }`}>
          <div className="flex items-center justify-between mb-2.5 gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t.dashboard.pendingConfirmations}
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center transition-transform group-hover:scale-105 shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100 tracking-tight">
              {pendingAppointments.length}
            </div>
            {pendingAppointments.length > 0 && (
              <span className="text-xs lg:text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                {t.dashboard.actionNeeded}
              </span>
            )}
          </div>
          <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 font-medium truncate">
            {t.dashboard.pendingConfirmationsDesc}
          </p>
        </div>

        {/* KPI 4: Active Customers */}
        <div className="p-4 lg:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800/60 shadow-xs transition-all group">
          <div className="flex items-center justify-between mb-2.5 gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t.dashboard.activeCustomers}
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-transform group-hover:scale-105 shrink-0">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100 tracking-tight">
            {activeCustomersCount}
          </div>
          <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 font-medium truncate">
            {t.dashboard.activeCustomersDesc}
          </p>
        </div>
      </div>

      {/* 3. Real Responsive Desktop Grid: LEFT (Schedule) vs RIGHT (Pending Approvals & Messages) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
        {/* LEFT COLUMN: Today's Visual Schedule (Span 7/8 on large desktop) */}
        <div className="lg:col-span-7 xl:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                  {t.dashboard.visualSchedule}
                </h2>
                <span className="px-2 py-0.5 rounded-md text-xs lg:text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-mono tabular-nums shrink-0">
                  {todayAppointments.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t.dashboard.visualScheduleSubtitle}
              </p>
            </div>

            <button
              onClick={() => setActiveTab('calendar')}
              className="min-h-[44px] lg:min-h-0 px-2 lg:px-0 flex items-center gap-1 text-sm lg:text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
            >
              <span>{t.dashboard.viewAll}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {mode === 'supabase' && isLoadingLiveData && appointments.length === 0 ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map(idx => (
                <div
                  key={idx}
                  className="p-4 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-16 h-10 rounded-lg bg-slate-200/70 dark:bg-slate-700/60 shrink-0" />
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="h-3.5 w-44 max-w-full rounded bg-slate-200/70 dark:bg-slate-700/60" />
                      <div className="h-3 w-32 max-w-full rounded bg-slate-200/50 dark:bg-slate-800" />
                    </div>
                  </div>
                  <div className="h-6 w-16 rounded-lg bg-slate-200/70 dark:bg-slate-700/60 shrink-0" />
                </div>
              ))}
            </div>
          ) : liveDataError && appointments.length === 0 ? (
            <div className="text-center py-10 px-4 rounded-2xl bg-rose-50/40 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/70 space-y-3">
              <AlertCircle className="w-7 h-7 text-rose-500 mx-auto" />
              <p className="text-sm lg:text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto leading-relaxed">
                {liveDataError}
              </p>
              <button
                type="button"
                onClick={reloadLiveAppointments}
                className="min-h-[44px] lg:min-h-0 inline-flex items-center gap-1.5 px-4 py-2.5 lg:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{language === 'es' ? 'Reintentar' : 'Retry'}</span>
              </button>
            </div>
          ) : todayAppointments.length === 0 ? (
            <div className="text-center py-10 lg:py-12 px-4 rounded-2xl bg-slate-50/50 dark:bg-slate-800/30 border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
                <CalendarDays className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t.dashboard.noAppointmentsToday}
                </p>
                <p className="text-sm lg:text-xs text-slate-500 max-w-sm mx-auto mt-1 leading-relaxed">
                  {t.dashboard.noAppointmentsTodayDesc}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {todayAppointments.map(apt => {
                const badge = statusBadgeConfig[apt.status];
                const isAtHome = apt.locationType === 'at_home';

                return (
                  <div
                    key={apt.id}
                    onClick={() => setSelectedAppointmentForDetail(apt)}
                    className="group relative p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/60 hover:shadow-md hover:shadow-slate-900/5 transition-all cursor-pointer bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4"
                  >
                    {/* Left: Time & Core Details */}
                    <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                      {/* Time Pillar */}
                      <div className="w-16 sm:w-20 shrink-0 text-left sm:text-center sm:pr-4 sm:border-r border-slate-100 dark:border-slate-800">
                        <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {apt.startTime || '—'}
                        </p>
                        <p className="text-xs lg:text-[11px] font-mono text-slate-400">
                          {apt.endTime || '—'}
                        </p>
                        <span className="inline-block mt-1 text-xs lg:text-[10px] font-mono text-slate-400 leading-tight">
                          {formatAppointmentDuration(apt, t.appointment, { compact: true })}
                        </span>
                      </div>

                      {/* Service & Client */}
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate max-w-full">
                            {apt.customerName}
                          </span>
                          <span className="text-xs lg:text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase font-mono">
                            {apt.customerLanguage}
                          </span>
                          <span className={`px-2 py-0.5 rounded-md text-xs lg:text-[10px] font-semibold ${badge.bg}`}>
                            {badge.label}
                          </span>
                        </div>

                        <p className="text-sm lg:text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                          {apt.serviceName}
                        </p>

                        <div className="flex items-center gap-3 text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 flex-wrap pt-0.5">
                          <span className="flex items-center gap-1 min-w-0">
                            {isAtHome ? (
                              <>
                                <Home className="w-3.5 h-3.5 lg:w-3 lg:h-3 text-emerald-500 shrink-0" />
                                <span className="text-emerald-700 dark:text-emerald-400 font-medium truncate max-w-[14rem] sm:max-w-xs">
                                  {apt.address || t.appointment.atHome}
                                </span>
                              </>
                            ) : (
                              <>
                                <Building className="w-3.5 h-3.5 lg:w-3 lg:h-3 text-indigo-500 shrink-0" />
                                <span>{t.appointment.inBusiness}</span>
                              </>
                            )}
                          </span>

                          {apt.staffName && (
                            <>
                              <span>·</span>
                              <span className="truncate">{apt.staffName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Price & Inline Fast Actions */}
                    <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
                      <div className="text-left md:text-right">
                        <span className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {currentTenant.currencySymbol}{(Number(apt.price) || 0).toFixed(2)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 lg:gap-1.5" onClick={e => e.stopPropagation()}>
                        {apt.status === 'pending' && (
                          <button
                            onClick={() => updateAppointmentStatus(apt.id, 'confirmed')}
                            className="min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors"
                            title={t.appointment.confirmAction}
                          >
                            {t.dashboard.confirmQuick}
                          </button>
                        )}
                        {apt.status === 'confirmed' && (
                          <button
                            onClick={() => updateAppointmentStatus(apt.id, 'completed')}
                            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center px-3 lg:px-2.5 py-2 lg:py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors"
                            title={t.appointment.completeAction}
                          >
                            <Check className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedAppointmentForDetail(apt)}
                          className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title={t.appointment.viewDetails}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Pending Approvals & Recent Messages (Span 5/4 on desktop) */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-4 lg:space-y-6">
          {/* Section 1: Pending Confirmations Panel */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                <h3 className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                  {t.dashboard.pendingSectionTitle}
                </h3>
              </div>
              <span className="text-xs lg:text-[11px] font-mono font-bold tabular-nums px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
                {pendingAppointments.length}
              </span>
            </div>

            {pendingAppointments.length === 0 ? (
              <div className="py-6 text-center space-y-1.5">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t.dashboard.allCaughtUp}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto">
                {pendingAppointments.map(apt => (
                  <div
                    key={apt.id}
                    onClick={() => setSelectedAppointmentForDetail(apt)}
                    className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer transition-all space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {apt.customerName}
                      </p>
                      <span className="text-sm lg:text-xs font-mono font-bold tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
                        {currentTenant.currencySymbol}{(Number(apt.price) || 0).toFixed(2)}
                      </span>
                    </div>

                    <p className="text-xs lg:text-[11px] text-slate-600 dark:text-slate-400 truncate">
                      {apt.serviceName}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/50 dark:border-slate-700/50 flex-wrap">
                      <span className="text-xs lg:text-[10px] font-mono tabular-nums text-slate-500">
                        {apt.date} @ {apt.startTime}
                      </span>

                      <div className="flex items-center gap-2 lg:gap-1.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => updateAppointmentStatus(apt.id, 'confirmed')}
                          className="min-h-[44px] lg:min-h-0 px-3 lg:px-2 py-2 lg:py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs lg:text-[10px] font-bold shadow-xs transition-colors whitespace-nowrap"
                        >
                          {t.dashboard.confirmQuick}
                        </button>
                        <button
                          onClick={() => setSelectedAppointmentForDetail(apt)}
                          className="min-h-[44px] lg:min-h-0 px-3 lg:px-2 py-2 lg:py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white text-slate-600 dark:text-slate-300 text-xs lg:text-[10px] font-semibold transition-colors whitespace-nowrap"
                        >
                          {t.appointment.viewDetails}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Recent Conversations & AI Activity */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-500 shrink-0" />
                <h3 className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                  {t.dashboard.recentMessagesTitle}
                </h3>
              </div>
              <button
                onClick={() => setActiveTab('messages')}
                className="min-h-[44px] lg:min-h-0 px-2 lg:px-0 text-xs lg:text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t.dashboard.viewAll}
              </button>
            </div>

            <div className="space-y-2.5">
              {recentConversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => {
                    setActiveTab('messages');
                    setActiveConversationId(conv.id);
                  }}
                  className="p-3 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-xs lg:text-[10px] font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
                        {(conv.customerName || 'C').charAt(0).toUpperCase()}
                      </div>
                      <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {conv.customerName}
                      </p>
                    </div>

                    <span className="text-xs lg:text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono shrink-0">
                      {conv.channel}
                    </span>
                  </div>

                  <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 truncate pl-8">
                    "{conv.lastMessageSnippet}"
                  </p>

                  <div className="flex items-center justify-between pt-1 pl-8">
                    {conv.isAiHandled ? (
                      <span className="inline-flex items-center gap-1 text-xs lg:text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                        <Bot className="w-3 h-3" />
                        <span>{t.messages.aiHandled}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs lg:text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        <Users className="w-3 h-3" />
                        <span>{t.messages.staffHandled}</span>
                      </span>
                    )}

                    <span className="text-xs lg:text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                      {t.dashboard.openChat} →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: AI Assistant Readiness Callout */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span className="truncate">{t.aiAssistant.readyTitle}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                </p>
                <p className="text-xs lg:text-[11px] text-slate-600 dark:text-slate-400 truncate">
                  {t.dashboard.aiActiveNotice}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('ai-assistant')}
              className="min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 transition-colors shrink-0"
              title={t.aiAssistant.simulatorTitle}
            >
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
