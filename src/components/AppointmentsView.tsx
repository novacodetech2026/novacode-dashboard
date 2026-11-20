import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Search, 
  Filter, 
  Download, 
  Plus, 
  Calendar, 
  Clock, 
  ChevronRight, 
  Home, 
  Building, 
  CheckCircle2, 
  XCircle,
  RotateCcw,
  RefreshCw,
  Globe
} from 'lucide-react';
import { AppointmentStatus, LocationType } from '../types';
import {
  getDateStringInTimezone,
  formatAppointmentDuration,
  formatAppointmentTimeRange,
} from '../utils/dateTime';
import { escapeCsvCell } from '../utils/security';

export const AppointmentsView: React.FC = () => {
  const { 
    t, 
    language, 
    currentTenant, 
    appointments, 
    setIsNewBookingModalOpen, 
    setSelectedAppointmentForDetail, 
    updateAppointmentStatus,
    mode,
    reloadLiveAppointments,
    isLoadingLiveData
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedLocation, setSelectedLocation] = useState<'all' | LocationType>('all');

  const hasOnlineAppointments = useMemo(
    () => appointments.some(a => a.locationType === 'online'),
    [appointments]
  );

  const filteredAppointments = useMemo(() => {
    const q = (searchQuery || '').toLowerCase();
    return appointments.filter(apt => {
      const matchesSearch =
        (apt.customerName || '').toLowerCase().includes(q) ||
        (apt.customerPhone || '').includes(searchQuery) ||
        (apt.serviceName || '').toLowerCase().includes(q);

      const matchesStatus = selectedStatus === 'all' || apt.status === selectedStatus;
      const matchesLocation = selectedLocation === 'all' || apt.locationType === selectedLocation;

      return matchesSearch && matchesStatus && matchesLocation;
    }).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.startTime || '').localeCompare(a.startTime || '');
    });
  }, [appointments, searchQuery, selectedStatus, selectedLocation]);

  // Export CSV (RFC-4180 quoted + formula-injection neutralized)
  const handleExportCsv = () => {
    const headers = ['ID', 'Date', 'Time', 'Customer', 'Phone', 'Service', 'Price', 'Location', 'Status'];
    const rows = filteredAppointments.map(a => [
      escapeCsvCell(a.id),
      escapeCsvCell(a.date),
      escapeCsvCell(formatAppointmentTimeRange(a, '-')),
      escapeCsvCell(a.customerName || ''),
      escapeCsvCell(a.customerPhone || ''),
      escapeCsvCell(a.serviceName || ''),
      escapeCsvCell((Number(a.price) || 0).toFixed(2)),
      escapeCsvCell(a.locationType === 'at_home' ? 'At-Home' : a.locationType === 'online' ? 'Online' : 'In-Business'),
      escapeCsvCell(a.status),
    ]);

    const csvContent = [headers.map(escapeCsvCell).join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    try {
      link.href = url;
      const todayStr = getDateStringInTimezone(new Date(), currentTenant.timezone);
      link.setAttribute('download', `novacode_appointments_${currentTenant.slug || 'export'}_${todayStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const statusBadges: Record<AppointmentStatus, { bg: string; label: string }> = {
    pending: {
      bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/80',
      label: t.appointment.pending,
    },
    confirmed: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/80',
      label: t.appointment.confirmed,
    },
    completed: {
      bg: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 border border-teal-200/80 dark:border-teal-800/80',
      label: t.appointment.completed,
    },
    cancelled: {
      bg: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 line-through',
      label: t.appointment.cancelled,
    },
    no_show: {
      bg: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/80',
      label: t.appointment.noShow,
    },
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header and Controls */}
      <div className="p-4 lg:p-6 rounded-2xl lg:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3.5 lg:space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 lg:gap-4">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              {t.appointmentsView.title}
            </h1>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.appointmentsView.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {mode === 'supabase' && (
              <button
                type="button"
                onClick={reloadLiveAppointments}
                disabled={isLoadingLiveData}
                className="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                title={t.common.refresh}
              >
                <RefreshCw className={`w-4 h-4 lg:w-3.5 lg:h-3.5 text-indigo-500 ${isLoadingLiveData ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{language === 'es' ? 'Sincronizar' : 'Sync'}</span>
              </button>
            )}
            <button
              onClick={handleExportCsv}
              className="flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
            >
              <Download className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-slate-500" />
              <span>{t.appointmentsView.exportCsv}</span>
            </button>
            <button
              onClick={() => setIsNewBookingModalOpen(true)}
              className="flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{t.dashboard.newAppointment}</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 lg:gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder={t.appointmentsView.searchPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="w-full sm:w-auto min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t.appointmentsView.statusFilter}</option>
              <option value="pending">{t.appointment.pending}</option>
              <option value="confirmed">{t.appointment.confirmed}</option>
              <option value="completed">{t.appointment.completed}</option>
              <option value="cancelled">{t.appointment.cancelled}</option>
              <option value="no_show">{t.appointment.noShow}</option>
            </select>

            <select
              value={selectedLocation}
              onChange={e => setSelectedLocation(e.target.value as 'all' | LocationType)}
              className="w-full sm:w-auto min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t.calendar.allLocations}</option>
              <option value="in_business">{t.calendar.inBusinessOnly}</option>
              <option value="at_home">{t.calendar.atHomeOnly}</option>
              {hasOnlineAppointments && <option value="online">{t.calendar.onlineOnly}</option>}
            </select>
          </div>
        </div>
      </div>

      {/* Appointments Data Table (Single-DOM stacked cards on mobile, table on lg+) */}
      <div className="bg-transparent lg:bg-white lg:dark:bg-slate-900 rounded-2xl lg:rounded-3xl lg:border border-slate-200/80 dark:border-slate-800 overflow-hidden lg:shadow-xs">
        <div className="lg:overflow-x-auto">
          <table className="w-full text-left text-sm lg:text-xs block lg:table">
            <thead className="hidden lg:table-header-group bg-slate-50/70 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-5 py-3.5">{t.appointment.time}</th>
                <th className="px-5 py-3.5">{t.appointment.customer}</th>
                <th className="px-5 py-3.5">{t.appointment.service}</th>
                <th className="px-5 py-3.5">{t.appointment.location}</th>
                <th className="px-5 py-3.5">{t.appointment.status}</th>
                <th className="px-5 py-3.5 text-right">{t.appointment.price}</th>
                <th className="px-5 py-3.5 text-right">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group divide-y-0 lg:divide-y divide-slate-100 dark:divide-slate-800 space-y-3 lg:space-y-0">
              {filteredAppointments.length === 0 ? (
                <tr className="block lg:table-row bg-white dark:bg-slate-900 rounded-2xl lg:rounded-none border lg:border-0 border-slate-200/80 dark:border-slate-800">
                  <td colSpan={7} className="block lg:table-cell px-5 py-12 text-center text-sm lg:text-xs text-slate-400">
                    <p className="font-semibold text-slate-700 dark:text-slate-300">
                      {t.appointmentsView.emptyTitle}
                    </p>
                    <p className="mt-1">{t.appointmentsView.emptyDesc}</p>
                  </td>
                </tr>
              ) : (
                filteredAppointments.map(apt => {
                  const badge = statusBadges[apt.status];
                  return (
                    <tr
                      key={apt.id}
                      onClick={() => setSelectedAppointmentForDetail(apt)}
                      className="grid grid-cols-[1fr_auto] lg:table-row items-center gap-x-3 gap-y-2 p-4 lg:p-0 bg-white dark:bg-slate-900 rounded-2xl lg:rounded-none border lg:border-0 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 cursor-pointer transition-colors shadow-xs lg:shadow-none"
                    >
                      {/* Date & Time */}
                      <td className="lg:px-5 lg:py-4 whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {apt.date || '—'}
                        </div>
                        <div className="text-xs lg:text-[11px] font-mono text-slate-400">
                          {formatAppointmentTimeRange(apt, ' - ')}
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="col-span-2 lg:col-span-1 lg:px-5 lg:py-4 min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {apt.customerName}
                        </div>
                        <div className="text-xs lg:text-[11px] font-mono text-slate-400 truncate">
                          {apt.customerPhone}
                        </div>
                      </td>

                      {/* Service */}
                      <td className="col-span-2 lg:col-span-1 lg:px-5 lg:py-4 min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate lg:max-w-xs">
                          {apt.serviceName}
                        </div>
                        <div className="text-xs lg:text-[11px] text-slate-400 font-mono">
                          {formatAppointmentDuration(apt, t.appointment)}
                        </div>
                      </td>

                      {/* Location */}
                      <td className="lg:px-5 lg:py-4 whitespace-nowrap text-xs">
                        {apt.locationType === 'at_home' ? (
                          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                            <Home className="w-3.5 h-3.5 shrink-0" />
                            <span>{t.appointment.atHome}</span>
                          </div>
                        ) : apt.locationType === 'online' ? (
                          <div className="flex items-center gap-1.5 text-sky-700 dark:text-sky-400 font-medium">
                            <Globe className="w-3.5 h-3.5 shrink-0" />
                            <span>{language === 'es' ? 'En línea' : 'Online'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-400 font-medium">
                            <Building className="w-3.5 h-3.5 shrink-0" />
                            <span>{t.appointment.inBusiness}</span>
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="row-start-1 col-start-2 lg:row-start-auto lg:col-start-auto justify-self-end lg:justify-self-auto lg:px-5 lg:py-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-md text-xs lg:text-[10px] font-semibold ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </td>

                      {/* Price */}
                      <td className="justify-self-end lg:justify-self-auto lg:px-5 lg:py-4 text-right whitespace-nowrap font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {currentTenant.currencySymbol}{(Number(apt.price) || 0).toFixed(2)}
                      </td>

                      {/* Actions */}
                      <td className="col-span-2 lg:col-span-1 flex justify-end lg:table-cell lg:px-5 lg:py-4 text-right whitespace-nowrap pt-2 lg:pt-4 border-t border-slate-100 lg:border-t-0 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setSelectedAppointmentForDetail(apt)}
                          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title={t.appointment.viewDetails}
                        >
                          <ChevronRight className="w-5 h-5 lg:w-4 lg:h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <div className="mt-3 lg:mt-0 px-4 lg:px-5 py-3 rounded-2xl lg:rounded-none bg-white dark:bg-slate-900 border lg:border-0 lg:border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>{t.appointmentsView.totalCount.replace('{count}', String(filteredAppointments.length))}</span>
          <span className="font-mono text-xs lg:text-[11px]">{currentTenant.timezone}</span>
        </div>
      </div>
    </div>
  );
};
