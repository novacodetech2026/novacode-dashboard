import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Calendar as CalendarIcon,
  Clock,
  Home,
  Building,
  Globe,
  Plus,
  AlertCircle,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { AppointmentStatus, LocationType } from '../types';
import {
  getDateStringInTimezone,
  getDayOfWeekFromDateString,
  shiftDateString,
  shiftMonthDateString,
  getWeekDates,
  getCalendarMonthGrid,
  formatReadableDate,
  formatAppointmentDuration,
  formatAppointmentTimeRange,
} from '../utils/dateTime';

export const CalendarView: React.FC = () => {
  const {
    t,
    language,
    mode,
    currentTenant,
    appointments,
    staff,
    services,
    isLoadingLiveData,
    liveDataError,
    liveDataErrorType,
    reloadLiveAppointments,
    setSelectedAppointmentForDetail,
    setIsNewBookingModalOpen,
  } = useApp();

  const isEs = language === 'es';
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | AppointmentStatus>('all');
  const [selectedLocation, setSelectedLocation] = useState<'all' | LocationType>('all');

  const todayStr = useMemo(
    () => getDateStringInTimezone(new Date(), currentTenant.timezone),
    [currentTenant.timezone]
  );

  const [anchorDateStr, setAnchorDateStr] = useState<string>(() =>
    getDateStringInTimezone(new Date(), currentTenant.timezone)
  );

  useEffect(() => {
    setAnchorDateStr(getDateStringInTimezone(new Date(), currentTenant.timezone));
    setSelectedStaffId('all');
    setSelectedServiceId('all');
    setSelectedStatus('all');
    setSelectedLocation('all');
  }, [currentTenant.id, currentTenant.timezone]);

  const formattedDateHeader = useMemo(() => {
    return formatReadableDate(anchorDateStr, language, {
      month: 'long',
      year: 'numeric',
      ...(viewMode === 'day' ? { day: 'numeric' } : {}),
    });
  }, [anchorDateStr, language, viewMode]);

  const handlePrev = () => {
    if (viewMode === 'day') setAnchorDateStr(prev => shiftDateString(prev, -1));
    else if (viewMode === 'week') setAnchorDateStr(prev => shiftDateString(prev, -7));
    else setAnchorDateStr(prev => shiftMonthDateString(prev, -1));
  };

  const handleNext = () => {
    if (viewMode === 'day') setAnchorDateStr(prev => shiftDateString(prev, 1));
    else if (viewMode === 'week') setAnchorDateStr(prev => shiftDateString(prev, 7));
    else setAnchorDateStr(prev => shiftMonthDateString(prev, 1));
  };

  const handleToday = () => {
    setAnchorDateStr(todayStr);
  };

  // Real-data-only filter capability detection
  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    staff.forEach(st => {
      if (st.id && st.name) map.set(st.id, st.name);
    });
    appointments.forEach(apt => {
      if (apt.staffId && apt.staffName && !map.has(apt.staffId)) {
        map.set(apt.staffId, apt.staffName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [staff, appointments]);

  const hasStaffFilterData = staffOptions.length > 0;
  const hasOnlineAppointments = useMemo(
    () => appointments.some(apt => apt.locationType === 'online'),
    [appointments]
  );

  const hasActiveFilters =
    selectedStaffId !== 'all' ||
    selectedServiceId !== 'all' ||
    selectedStatus !== 'all' ||
    selectedLocation !== 'all';

  const handleClearFilters = () => {
    setSelectedStaffId('all');
    setSelectedServiceId('all');
    setSelectedStatus('all');
    setSelectedLocation('all');
  };

  const weekDateStrings = useMemo(() => getWeekDates(anchorDateStr), [anchorDateStr]);
  const monthGridCells = useMemo(() => getCalendarMonthGrid(anchorDateStr), [anchorDateStr]);

  const filteredAppointments = useMemo(() => {
    return appointments
      .filter(apt => {
        if (selectedStatus !== 'all' && apt.status !== selectedStatus) return false;
        if (hasStaffFilterData && selectedStaffId !== 'all' && apt.staffId !== selectedStaffId) {
          return false;
        }
        if (selectedServiceId !== 'all' && apt.serviceId !== selectedServiceId) return false;
        if (selectedLocation !== 'all' && apt.locationType !== selectedLocation) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.startTime || '').localeCompare(b.startTime || '');
      });
  }, [
    appointments,
    selectedStatus,
    hasStaffFilterData,
    selectedStaffId,
    selectedServiceId,
    selectedLocation,
  ]);

  const statusStyles: Record<
    AppointmentStatus,
    { card: string; badge: string; dot: string; label: string }
  > = {
    pending: {
      card: 'bg-amber-50/90 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-100 hover:border-amber-400',
      badge: 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300',
      dot: 'bg-amber-500',
      label: t.appointment.pending,
    },
    confirmed: {
      card: 'bg-emerald-50/90 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/80 text-emerald-950 dark:text-emerald-100 hover:border-emerald-400',
      badge: 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300',
      dot: 'bg-emerald-500',
      label: t.appointment.confirmed,
    },
    completed: {
      card: 'bg-teal-50/90 dark:bg-teal-950/35 border-teal-200 dark:border-teal-800/80 text-teal-950 dark:text-teal-100 hover:border-teal-400',
      badge: 'bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300',
      dot: 'bg-teal-500',
      label: t.appointment.completed,
    },
    cancelled: {
      card: 'bg-slate-100/90 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300',
      badge: 'bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
      dot: 'bg-slate-400',
      label: t.appointment.cancelled,
    },
    no_show: {
      card: 'bg-rose-50/90 dark:bg-rose-950/35 border-rose-200 dark:border-rose-800/80 text-rose-950 dark:text-rose-100 hover:border-rose-400',
      badge: 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300',
      dot: 'bg-rose-500',
      label: t.appointment.noShow,
    },
  };

  const renderLocationBadge = (locationType: LocationType) => {
    if (locationType === 'at_home') {
      return (
        <span className="inline-flex items-center gap-1 text-xs lg:text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
          <Home className="w-3.5 h-3.5 lg:w-3 lg:h-3 shrink-0" />
          <span className="truncate">{t.appointment.atHome}</span>
        </span>
      );
    }
    if (locationType === 'online') {
      return (
        <span className="inline-flex items-center gap-1 text-xs lg:text-[10px] font-medium text-sky-700 dark:text-sky-400">
          <Globe className="w-3.5 h-3.5 lg:w-3 lg:h-3 shrink-0" />
          <span className="truncate">{isEs ? 'En línea' : 'Online'}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs lg:text-[10px] font-medium text-indigo-700 dark:text-indigo-400">
        <Building className="w-3.5 h-3.5 lg:w-3 lg:h-3 shrink-0" />
        <span className="truncate">{t.appointment.inBusiness}</span>
      </span>
    );
  };

  const showLoadingState = mode === 'supabase' && isLoadingLiveData && appointments.length === 0;
  const showPermissionError =
    mode === 'supabase' && !isLoadingLiveData && liveDataErrorType === 'permission' && appointments.length === 0;
  const showConnectionError =
    mode === 'supabase' &&
    !isLoadingLiveData &&
    Boolean(liveDataError) &&
    liveDataErrorType !== 'permission' &&
    appointments.length === 0;

  // Appointments visible in current active period (Day / Week / Month)
  const dayAppointments = useMemo(
    () => filteredAppointments.filter(a => a.date === anchorDateStr),
    [filteredAppointments, anchorDateStr]
  );

  const weekPeriodAppointments = useMemo(() => {
    const set = new Set(weekDateStrings);
    return filteredAppointments.filter(a => set.has(a.date));
  }, [filteredAppointments, weekDateStrings]);

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* Calendar Header & Controls */}
      <div className="p-4 lg:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-4 shadow-xs">
        {/* Row 1: Date Header, Navigation & View Switcher */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 capitalize tracking-tight break-words">
                {formattedDateHeader}
              </h1>
              <p className="text-xs lg:text-[11px] font-mono tabular-nums text-slate-400 mt-0.5 truncate">
                {currentTenant.timezone}
              </p>
            </div>

            <div className="flex items-center gap-1.5 lg:gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={handlePrev}
                className="min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors"
                title={t.calendar.previous}
                aria-label={t.calendar.previous}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="min-h-[44px] lg:min-h-0 px-3.5 lg:px-3 py-2 lg:py-1 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                {t.calendar.today}
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors"
                title={t.calendar.next}
                aria-label={t.calendar.next}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-start gap-2 flex-wrap">
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl gap-1">
              {(['day', 'week', 'month'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setViewMode(m)}
                  className={`min-h-[44px] lg:min-h-0 px-3.5 lg:px-3 py-2 lg:py-1.5 text-sm lg:text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                    viewMode === m
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {t.calendar[m]}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsNewBookingModalOpen(true)}
              className="min-h-[44px] lg:min-h-0 flex items-center gap-1.5 px-4 lg:px-3.5 py-2.5 lg:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{t.dashboard.newAppointment}</span>
            </button>
          </div>
        </div>

        {/* Row 2: Real-Data-Only Filters Strip & Status Legend */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-sm lg:text-xs">
          <div className="grid grid-cols-1 sm:flex sm:items-center gap-2.5 sm:flex-wrap">
            <div className="flex items-center gap-1.5 text-slate-400 font-medium text-xs">
              <Filter className="w-3.5 h-3.5" />
              <span>{t.common.filter}:</span>
            </div>

            {/* Staff Filter: Only rendered when real staff / staff assignments exist */}
            {hasStaffFilterData && (
              <select
                aria-label={t.calendar.filterStaff}
                value={selectedStaffId}
                onChange={e => setSelectedStaffId(e.target.value)}
                className="min-h-[44px] lg:min-h-0 w-full sm:w-auto px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-base lg:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">{t.calendar.allStaff}</option>
                {staffOptions.map(st => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            )}

            {/* Service Filter */}
            <select
              aria-label={t.calendar.filterService}
              value={selectedServiceId}
              onChange={e => setSelectedServiceId(e.target.value)}
              className="min-h-[44px] lg:min-h-0 w-full sm:w-auto px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-base lg:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">{t.calendar.allServices}</option>
              {services.map(svc => (
                <option key={svc.id} value={svc.id}>
                  {isEs ? svc.nameEs : svc.nameEn}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              aria-label={t.calendar.filterStatus}
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value as 'all' | AppointmentStatus)}
              className="min-h-[44px] lg:min-h-0 w-full sm:w-auto px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-base lg:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">{t.calendar.allStatuses}</option>
              <option value="pending">{t.appointment.pending}</option>
              <option value="confirmed">{t.appointment.confirmed}</option>
              <option value="completed">{t.appointment.completed}</option>
              <option value="cancelled">{t.appointment.cancelled}</option>
              <option value="no_show">{t.appointment.noShow}</option>
            </select>

            {/* Location Filter */}
            <select
              aria-label={t.calendar.filterLocation}
              value={selectedLocation}
              onChange={e => setSelectedLocation(e.target.value as 'all' | LocationType)}
              className="min-h-[44px] lg:min-h-0 w-full sm:w-auto px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-base lg:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">{t.calendar.allLocations}</option>
              <option value="in_business">{t.calendar.inBusinessOnly}</option>
              <option value="at_home">{t.calendar.atHomeOnly}</option>
              {hasOnlineAppointments && <option value="online">{t.calendar.onlineOnly}</option>}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors whitespace-nowrap"
              >
                {t.calendar.clearFilters}
              </button>
            )}
          </div>

          {/* Status Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs lg:text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>{t.appointment.pending}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{t.appointment.confirmed}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>{t.appointment.cancelled}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>{t.appointment.noShow}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Explicit Loading / Error / Empty / Filtered Empty States */}
      {showLoadingState ? (
        <div
          aria-busy="true"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-3 shadow-xs"
        >
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="h-16 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800"
            />
          ))}
        </div>
      ) : showPermissionError ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-800/70 p-6 lg:p-10 text-center space-y-3 shadow-xs">
          <Lock className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {isEs ? 'Acceso restringido' : 'Access Restricted'}
          </p>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {liveDataError}
          </p>
        </div>
      ) : showConnectionError ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800/70 p-6 lg:p-10 text-center space-y-3 shadow-xs">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {isEs ? 'No pudimos cargar el calendario' : 'Unable to load calendar'}
          </p>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {liveDataError}
          </p>
          <button
            type="button"
            onClick={reloadLiveAppointments}
            className="min-h-[44px] lg:min-h-0 inline-flex items-center gap-1.5 px-4 py-2.5 lg:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isEs ? 'Reintentar' : 'Retry'}</span>
          </button>
        </div>
      ) : appointments.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-8 lg:p-12 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {t.calendar.noAppointmentsDay}
          </p>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
            {t.dashboard.noAppointmentsTodayDesc}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsNewBookingModalOpen(true)}
              className="min-h-[44px] lg:min-h-0 inline-flex items-center gap-1.5 px-4 py-2.5 lg:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold"
            >
              <Plus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{t.dashboard.newAppointment}</span>
            </button>
          </div>
        </div>
      ) : hasActiveFilters && filteredAppointments.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-8 lg:p-12 text-center space-y-3 shadow-xs">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {t.calendar.noAppointmentsMatch}
          </p>
          <button
            type="button"
            onClick={handleClearFilters}
            className="min-h-[44px] lg:min-h-0 px-4 py-2.5 lg:py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
          >
            {t.calendar.clearFilters}
          </button>
        </div>
      ) : (
        <>
          {/* WEEK VIEW: Desktop 7-Column Grid + Mobile Agenda List */}
          {viewMode === 'week' && (
            <>
              {/* Desktop Week Grid */}
              <div className="hidden md:block bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-x-auto shadow-xs">
                <div className="min-w-[780px]">
                  <div className="grid grid-cols-7 border-b border-slate-200/80 dark:border-slate-800">
                    {weekDateStrings.map(dateISO => {
                      const isToday = dateISO === todayStr;
                      const dow = getDayOfWeekFromDateString(dateISO);
                      const dayNumber = Number(dateISO.split('-')[2]);

                      return (
                        <div
                          key={dateISO}
                          className={`p-3 text-center border-r last:border-r-0 border-slate-200/80 dark:border-slate-800 ${
                            isToday ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : 'bg-slate-50/40 dark:bg-slate-900'
                          }`}
                        >
                          <p className="text-[11px] font-semibold text-slate-400 uppercase">
                            {t.shortDays[dow]}
                          </p>
                          <p
                            className={`text-base font-extrabold font-mono tabular-nums mt-0.5 ${
                              isToday
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {dayNumber}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-7 min-h-[420px]">
                    {weekDateStrings.map(dateISO => {
                      const items = filteredAppointments.filter(a => a.date === dateISO);
                      const isToday = dateISO === todayStr;

                      return (
                        <div
                          key={dateISO}
                          className={`p-2 border-r last:border-r-0 border-slate-200/80 dark:border-slate-800 space-y-2 ${
                            isToday ? 'bg-indigo-50/20 dark:bg-indigo-950/10' : 'bg-slate-50/20 dark:bg-slate-950/20'
                          }`}
                        >
                          {items.length === 0 ? (
                            <div className="h-full flex items-center justify-center p-3">
                              <span className="text-[11px] text-slate-300 dark:text-slate-700">—</span>
                            </div>
                          ) : (
                            items.map(apt => {
                              const st = statusStyles[apt.status] || statusStyles.pending;
                              return (
                                <button
                                  key={apt.id}
                                  type="button"
                                  onClick={() => setSelectedAppointmentForDetail(apt)}
                                  className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all shadow-xs ${st.card}`}
                                >
                                  <div className="flex items-center justify-between gap-1 font-mono tabular-nums font-bold text-[11px]">
                                    <span>
                                      {formatAppointmentTimeRange(apt, '–')}
                                    </span>
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                                  </div>
                                  <p
                                    className={`font-bold truncate mt-1 ${
                                      apt.status === 'cancelled' ? 'line-through' : ''
                                    }`}
                                  >
                                    {apt.customerName || t.appointment.customer}
                                  </p>
                                  <p className="text-[10px] truncate opacity-85">
                                    {apt.serviceName || t.appointment.service}
                                  </p>
                                  <div className="mt-1.5 flex items-center justify-between gap-1">
                                    {renderLocationBadge(apt.locationType)}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Mobile Week Agenda View */}
              <div className="md:hidden bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t.calendar.agendaTitle}
                </h2>
                {weekPeriodAppointments.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">{t.calendar.noAppointmentsDay}</p>
                ) : (
                  <div className="space-y-2.5">
                    {weekPeriodAppointments.map(apt => {
                      const st = statusStyles[apt.status] || statusStyles.pending;
                      return (
                        <button
                          key={apt.id}
                          type="button"
                          onClick={() => setSelectedAppointmentForDetail(apt)}
                          className={`w-full min-h-[44px] text-left p-4 rounded-xl border flex items-center justify-between gap-3 ${st.card}`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 text-xs font-mono tabular-nums font-bold">
                              <span>{apt.date}</span>
                              <span>·</span>
                              <span>
                                {formatAppointmentTimeRange(apt, '–')}
                              </span>
                            </div>
                            <p
                              className={`text-sm font-bold truncate ${
                                apt.status === 'cancelled' ? 'line-through' : ''
                              }`}
                            >
                              {apt.customerName || t.appointment.customer}
                            </p>
                            <p className="text-xs truncate opacity-80">{apt.serviceName}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-md text-xs font-semibold shrink-0 ${st.badge}`}>
                            {st.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* DAY VIEW */}
          {viewMode === 'day' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 capitalize min-w-0 break-words">
                  {formatReadableDate(anchorDateStr, language, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                  {dayAppointments.length}
                </span>
              </div>

              {dayAppointments.length === 0 ? (
                <div className="text-center py-12 text-sm lg:text-xs text-slate-400">
                  {t.calendar.noAppointmentsDay}
                </div>
              ) : (
                <div className="space-y-3 lg:space-y-2.5">
                  {dayAppointments.map(apt => {
                    const st = statusStyles[apt.status] || statusStyles.pending;
                    return (
                      <button
                        key={apt.id}
                        type="button"
                        onClick={() => setSelectedAppointmentForDetail(apt)}
                        className={`w-full min-h-[44px] text-left p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${st.card}`}
                      >
                        <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                          <div className="font-mono tabular-nums font-bold text-sm shrink-0">
                            {formatAppointmentTimeRange(apt)}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <p
                              className={`font-bold text-sm truncate ${
                                apt.status === 'cancelled' ? 'line-through' : ''
                              }`}
                            >
                              {apt.customerName || t.appointment.customer}
                            </p>
                            <p className="text-xs opacity-85 truncate">
                              {apt.serviceName || t.appointment.service} (
                              {formatAppointmentDuration(apt, t.appointment)})
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 flex-wrap">
                          {renderLocationBadge(apt.locationType)}
                          <span className={`px-2 py-0.5 rounded-md text-xs lg:text-[10px] font-semibold ${st.badge}`}>
                            {st.label}
                          </span>
                          <span className="font-mono tabular-nums font-bold text-sm lg:text-xs">
                            {currentTenant.currencySymbol}
                            {(Number(apt.price) || 0).toFixed(2)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* MONTH VIEW (Real Calendar Weekday Grid) */}
          {viewMode === 'month' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-3 sm:p-6 shadow-xs">
              <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
                {t.shortDays.map((d, i) => (
                  <div
                    key={i}
                    className="text-center font-bold text-xs lg:text-[11px] text-slate-400 uppercase py-1.5"
                  >
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {monthGridCells.map(cell => {
                  const cellApts = filteredAppointments.filter(a => a.date === cell.dateStr);
                  const isToday = cell.dateStr === todayStr;

                  return (
                    <div
                      key={cell.dateStr}
                      onClick={() => {
                        setAnchorDateStr(cell.dateStr);
                        setViewMode('day');
                      }}
                      className={`min-h-[56px] sm:min-h-[104px] p-1.5 sm:p-2 rounded-xl border cursor-pointer transition-colors ${
                        isToday
                          ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20'
                          : cell.isCurrentMonth
                          ? 'border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 hover:border-indigo-300'
                          : 'border-slate-100 dark:border-slate-800/50 bg-slate-50/20 dark:bg-slate-900/40 opacity-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-mono tabular-nums font-bold ${
                            isToday
                              ? 'text-indigo-600 dark:text-indigo-400'
                              : cell.isCurrentMonth
                              ? 'text-slate-700 dark:text-slate-300'
                              : 'text-slate-400'
                          }`}
                        >
                          {cell.dayNumber}
                        </span>
                        {cellApts.length > 0 && (
                          <span className="text-xs lg:text-[10px] font-mono tabular-nums text-indigo-600 dark:text-indigo-400 font-semibold lg:text-slate-400">
                            {cellApts.length}
                          </span>
                        )}
                      </div>

                      {cellApts.length > 0 && (
                        <>
                          <div className="sm:hidden mt-1 flex items-center gap-0.5 flex-wrap">
                            {cellApts.slice(0, 3).map(a => {
                              const st = statusStyles[a.status] || statusStyles.pending;
                              return <span key={a.id} className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />;
                            })}
                          </div>
                          <div className="hidden sm:block mt-1 space-y-1">
                            {cellApts.slice(0, 2).map(a => {
                              const st = statusStyles[a.status] || statusStyles.pending;
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setSelectedAppointmentForDetail(a);
                                  }}
                                  className={`w-full text-left text-[10px] font-medium truncate px-1.5 py-0.5 rounded border ${st.card} ${
                                    a.status === 'cancelled' ? 'line-through' : ''
                                  }`}
                                >
                                  <span className="font-mono tabular-nums">{a.startTime || '—'}</span>{' '}
                                  {a.customerName || t.appointment.customer}
                                </button>
                              );
                            })}
                            {cellApts.length > 2 && (
                              <span className="text-[9px] text-slate-400 block px-1 font-mono tabular-nums">
                                {t.calendar.moreCount.replace('{count}', String(cellApts.length - 2))}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
