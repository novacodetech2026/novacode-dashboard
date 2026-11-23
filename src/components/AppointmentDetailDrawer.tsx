import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Appointment } from '../types';
import { 
  X, 
  Clock, 
  Calendar, 
  MapPin, 
  User, 
  Phone, 
  DollarSign, 
  CheckCircle2, 
  CalendarClock, 
  Trash2, 
  Sparkles,
  Home,
  Building,
  AlertTriangle,
  RotateCcw,
  Globe
} from 'lucide-react';
import { RescheduleModal } from './RescheduleModal';
import {
  formatAppointmentDuration,
  formatAppointmentTimeRange,
} from '../utils/dateTime';

interface AppointmentDetailDrawerProps {
  appointment: Appointment | null;
  onClose: () => void;
}

export const AppointmentDetailDrawer: React.FC<AppointmentDetailDrawerProps> = ({ appointment, onClose }) => {
  const { 
    t, 
    language, 
    currentTenant, 
    updateAppointmentStatus, 
    cancelAppointment 
  } = useApp();

  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  useEffect(() => {
    setCancelError(null);
    setStatusError(null);
    setShowCancelConfirm(false);
    setIsUpdatingStatus(false);
    setIsCancelling(false);
  }, [appointment?.id, appointment?.status]);

  if (!appointment) return null;

  const statusColors = {
    pending: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/80',
    confirmed: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/80',
    completed: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 border border-teal-200/80 dark:border-teal-800/80',
    cancelled: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 line-through',
    no_show: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/80',
  };

  const statusLabel = {
    pending: t.appointment.pending,
    confirmed: t.appointment.confirmed,
    completed: t.appointment.completed,
    cancelled: t.appointment.cancelled,
    no_show: t.appointment.noShow,
  }[appointment.status];

  const sourceLabels = {
    ai_whatsapp: t.appointment.sourceAiWhatsapp,
    ai_sms: t.appointment.sourceAiSms,
    manual_dashboard: t.appointment.sourceManual,
    online_widget: t.appointment.sourceWidget,
  };

  const runStatusUpdate = async (nextStatus: Appointment['status']) => {
    if (isUpdatingStatus || isCancelling) return;
    setStatusError(null);
    setIsUpdatingStatus(true);
    try {
      const res = (await updateAppointmentStatus(appointment.id, nextStatus)) as
        | { success?: boolean; error?: string }
        | void;
      if (res && res.success === false) {
        setStatusError(
          res.error ||
            (language === 'es'
              ? 'No se pudo actualizar el estado de la cita.'
              : 'Unable to update appointment status.')
        );
      }
    } catch (err: unknown) {
      setStatusError(
        err instanceof Error
          ? err.message
          : language === 'es'
          ? 'No se pudo actualizar el estado de la cita.'
          : 'Unable to update appointment status.'
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleConfirm = () => runStatusUpdate('confirmed');
  const handleComplete = () => runStatusUpdate('completed');
  const handleMarkNoShow = () => runStatusUpdate('no_show');
  const handleReactivate = () => runStatusUpdate('confirmed');

  const handleCancel = async () => {
    if (isCancelling || isUpdatingStatus) return;
    setCancelError(null);
    setIsCancelling(true);
    try {
      const res = await cancelAppointment(appointment.id);
      if (res.success) {
        setShowCancelConfirm(false);
        onClose();
      } else {
        setCancelError(
          res.error ||
            (language === 'es'
              ? 'No se pudo cancelar la cita.'
              : 'Unable to cancel this appointment.')
        );
      }
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs transition-opacity animate-in fade-in"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 lg:p-6 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`px-2.5 py-0.5 rounded-md text-xs lg:text-[11px] font-semibold shrink-0 ${statusColors[appointment.status]}`}>
                {statusLabel}
              </span>
              <span className="text-xs text-slate-400 font-mono truncate">
                {appointment.id}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              {appointment.serviceName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-5 lg:space-y-6">
          {/* Schedule Banner */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm lg:text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {appointment.date || '—'}
                </p>
                <p className="text-sm lg:text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">
                  {formatAppointmentTimeRange(appointment) !== '—'
                    ? `${formatAppointmentTimeRange(appointment)} (${formatAppointmentDuration(appointment, t.appointment)})`
                    : formatAppointmentDuration(appointment, t.appointment)}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className="text-xs text-slate-400">{t.appointment.price}</p>
              <p className="text-base lg:text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {currentTenant.currencySymbol}{(Number(appointment.price) || 0).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Customer Card */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
              {t.appointment.customer}
            </h4>
            <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 lg:w-8 lg:h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-sm lg:text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0">
                    {(appointment.customerName || 'C').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {appointment.customerName || t.appointment.customer}
                    </p>
                    <p className="text-xs lg:text-[11px] text-slate-500 font-mono truncate">
                      {appointment.customerPhone}
                    </p>
                  </div>
                </div>

                <span className="px-2 py-0.5 rounded text-xs lg:text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                  {appointment.customerLanguage.toUpperCase()}
                </span>
              </div>

              {appointment.notes && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-sm lg:text-xs text-slate-600 dark:text-slate-400 bg-amber-50/50 dark:bg-amber-950/20 p-2.5 rounded-lg break-words">
                  <span className="font-semibold text-amber-800 dark:text-amber-400 block text-xs lg:text-[11px] mb-0.5">
                    {t.appointment.notes}:
                  </span>
                  {appointment.notes}
                </div>
              )}
            </div>
          </div>

          {/* Location & Service Details */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
              {t.appointment.location}
            </h4>
            <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-sm lg:text-xs font-semibold text-slate-800 dark:text-slate-200">
                {appointment.locationType === 'at_home' ? (
                  <>
                    <Home className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.appointment.atHome}</span>
                  </>
                ) : appointment.locationType === 'online' ? (
                  <>
                    <Globe className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{language === 'es' ? 'En línea' : 'Online'}</span>
                  </>
                ) : (
                  <>
                    <Building className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span>{t.appointment.inBusiness}</span>
                  </>
                )}
              </div>
              <p className="text-sm lg:text-xs text-slate-600 dark:text-slate-400 pl-6 break-words">
                {appointment.locationType === 'at_home' 
                  ? (appointment.address || t.appointment.addressProvidedByClient) 
                  : appointment.locationType === 'online'
                  ? (appointment.address || (language === 'es' ? 'Sesión en línea' : 'Online session'))
                  : currentTenant.address}
              </p>
            </div>
          </div>

          {/* Assigned Staff */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
              {t.appointment.assignedStaff}
            </h4>
            <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
              <div className="w-9 h-9 lg:w-8 lg:h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                  {appointment.staffName || t.appointment.unassignedFirstAvailable}
                </p>
                <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                  {currentTenant.name}
                </p>
              </div>
            </div>
          </div>

          {/* Booking Metadata Source */}
          <div className="flex items-center justify-between text-sm lg:text-xs text-slate-500 dark:text-slate-400 pt-2">
            <span>{t.appointment.source}</span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">
              {sourceLabels[appointment.source]}
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 lg:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-6 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-2.5 shrink-0">
          {showCancelConfirm ? (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm lg:text-xs font-bold text-rose-900 dark:text-rose-200">
                    {t.appointment.confirmCancelTitle}
                  </p>
                  <p className="text-xs lg:text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">
                    {t.appointment.confirmCancelDesc.replace('{customer}', appointment.customerName)}
                  </p>
                  {(currentTenant.settings?.cancellationBufferHours || 0) > 0 && (
                    <p className="text-xs lg:text-[11px] text-rose-600/90 dark:text-rose-300/90 mt-1 font-medium">
                      {t.appointment.cancellationPolicyNotice.replace(
                        '{hours}',
                        String(currentTenant.settings.cancellationBufferHours)
                      )}
                    </p>
                  )}
                </div>
              </div>
              {cancelError && (
                <div className="p-2.5 rounded-lg bg-white/80 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-700 text-xs lg:text-[11px] font-medium text-rose-800 dark:text-rose-200">
                  {cancelError}
                </div>
              )}
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => {
                    setCancelError(null);
                    setShowCancelConfirm(false);
                  }}
                  className="min-h-[44px] lg:min-h-0 px-3.5 lg:px-3 py-2 lg:py-1.5 text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  {t.appointment.keepBookingButton}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="min-h-[44px] lg:min-h-0 px-3.5 lg:px-3 py-2 lg:py-1.5 text-sm lg:text-xs font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg transition-all"
                >
                  {t.appointment.confirmCancelButton}
                </button>
              </div>
            </div>
          ) : (
            <>
              {statusError && (
                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-200 break-words">
                  {statusError}
                </div>
              )}
              {appointment.status === 'cancelled' || appointment.status === 'no_show' ? (
                <button
                  type="button"
                  disabled={isUpdatingStatus}
                  onClick={handleReactivate}
                  className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{t.appointment.reopenAction}</span>
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {appointment.status === 'pending' && (
                    <button
                      type="button"
                      disabled={isUpdatingStatus}
                      onClick={handleConfirm}
                      className="col-span-2 min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-sm transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t.appointment.confirmAction}</span>
                    </button>
                  )}

                  {appointment.status === 'confirmed' && (
                    <>
                      <button
                        type="button"
                        disabled={isUpdatingStatus}
                        onClick={handleComplete}
                        className="min-h-[44px] lg:min-h-0 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-sm transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{t.appointment.completeAction}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isUpdatingStatus}
                        onClick={handleMarkNoShow}
                        className="min-h-[44px] lg:min-h-0 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/60 disabled:opacity-50 text-rose-700 dark:text-rose-300 text-sm lg:text-xs font-semibold transition-colors"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{t.appointment.markNoShowAction}</span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    disabled={isUpdatingStatus}
                    onClick={() => setIsRescheduleOpen(true)}
                    className="min-h-[44px] lg:min-h-0 flex items-center justify-center gap-1.5 px-3 py-2.5 lg:py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-sm lg:text-xs font-semibold transition-colors"
                  >
                    <CalendarClock className="w-3.5 h-3.5 text-slate-500" />
                    <span>{t.appointment.rescheduleAction}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isUpdatingStatus}
                    onClick={() => setShowCancelConfirm(true)}
                    className="min-h-[44px] lg:min-h-0 flex items-center justify-center gap-1.5 px-3 py-2.5 lg:py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 disabled:opacity-50 text-sm lg:text-xs font-semibold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>{t.appointment.cancelAction}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Reschedule Modal */}
      {isRescheduleOpen && (
        <RescheduleModal
          appointment={appointment}
          isOpen={isRescheduleOpen}
          onClose={() => setIsRescheduleOpen(false)}
        />
      )}
    </>
  );
};
