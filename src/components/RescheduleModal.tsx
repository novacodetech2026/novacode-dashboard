import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Appointment } from '../types';
import { Calendar, Clock, AlertTriangle, X, RefreshCw } from 'lucide-react';
import {
  getDateStringInTimezone,
  getAppointmentDurationMinutes,
  formatAppointmentDuration,
} from '../utils/dateTime';
import {
  generateBookingTimeSlots,
  validateBookingWindow,
  formatBookingValidationError,
} from '../utils/scheduling';

interface RescheduleModalProps {
  appointment: Appointment;
  isOpen: boolean;
  onClose: () => void;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({ appointment, isOpen, onClose }) => {
  const {
    rescheduleAppointment,
    currentTenant,
    appointments = [],
    services = [],
    language,
    t,
  } = useApp();

  const [newDate, setNewDate] = useState(appointment.date);
  const [newTime, setNewTime] = useState(appointment.startTime);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNewDate(appointment.date);
      setNewTime(appointment.startTime);
      setErrorMessage(null);
    }
  }, [isOpen, appointment.id, appointment.date, appointment.startTime]);

  const todayStr = getDateStringInTimezone(new Date(), currentTenant?.timezone);
  const appointmentDuration = useMemo(
    () => getAppointmentDurationMinutes(appointment),
    [appointment]
  );

  const slotAnalysis = useMemo(() => {
    return generateBookingTimeSlots({
      tenant: currentTenant,
      date: newDate,
      durationMinutes: appointmentDuration ?? 0,
      appointments,
      staffId: appointment.staffId,
      excludeAppointmentId: appointment.id,
    });
  }, [currentTenant, newDate, appointmentDuration, appointments, appointment.staffId, appointment.id]);

  if (!isOpen) return null;

  const targetService = services.find(s => s.id === appointment.serviceId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (appointmentDuration === null || appointmentDuration <= 0) {
      setErrorMessage(t.appointment.durationUnavailable);
      return;
    }

    const scheduleCheck = validateBookingWindow({
      tenant: currentTenant,
      date: newDate,
      startTime: newTime,
      durationMinutes: appointmentDuration,
      appointments,
      staffId: appointment.staffId,
      excludeAppointmentId: appointment.id,
      service: targetService,
    });

    if (!scheduleCheck.valid) {
      setErrorMessage(formatBookingValidationError(scheduleCheck, language));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await rescheduleAppointment(appointment.id, newDate, newTime);
      if (result.success) {
        onClose();
      } else {
        setErrorMessage(result.error || 'Failed to reschedule.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
      <div className="w-full sm:max-w-md max-h-[92dvh] bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 lg:p-5 border-b border-slate-200/80 dark:border-slate-800 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.appointment.rescheduleTitle}
            </h3>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {t.appointment.rescheduleDesc.replace('{customer}', appointment.customerName)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5 lg:w-4 lg:h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 lg:p-5 space-y-4 flex-1 overflow-y-auto">
            {errorMessage && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm lg:text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div>
              <label htmlFor="reschedule-date" className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.appointment.newDate}
              </label>
              <div className="relative">
                <input
                  id="reschedule-date"
                  type="date"
                  min={todayStr}
                  value={newDate}
                  onChange={e => {
                    setErrorMessage(null);
                    setNewDate(e.target.value);
                  }}
                  required
                  className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-base lg:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                />
                <Calendar className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 lg:top-3 pointer-events-none" />
              </div>
            </div>

            <div className="p-3 lg:p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 text-xs lg:text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-1.5">
              <span>
                {slotAnalysis.effectiveHours.isClosed
                  ? slotAnalysis.effectiveHours.specialLabel
                    ? t.bookingModal.closedHolidayNotice
                        .replace('{label}', slotAnalysis.effectiveHours.specialLabel)
                        .replace('{date}', newDate)
                    : t.bookingModal.closedDayNotice.replace('{date}', newDate)
                  : slotAnalysis.effectiveHours.isSpecialHours && slotAnalysis.effectiveHours.specialLabel
                  ? t.bookingModal.specialHoursNotice
                      .replace('{label}', slotAnalysis.effectiveHours.specialLabel)
                      .replace('{open}', slotAnalysis.effectiveHours.open)
                      .replace('{close}', slotAnalysis.effectiveHours.close)
                  : t.bookingModal.operatingHoursInfo
                      .replace('{tz}', currentTenant?.timezone || 'UTC')
                      .replace('{open}', slotAnalysis.effectiveHours.open)
                      .replace('{close}', slotAnalysis.effectiveHours.close)}
              </span>
              {(currentTenant?.settings?.bufferBetweenAppointmentsMinutes || 0) > 0 && (
                <span className="font-mono text-indigo-600 dark:text-indigo-400">
                  +{currentTenant.settings.bufferBetweenAppointmentsMinutes}m
                </span>
              )}
            </div>

            <div>
              <label htmlFor="reschedule-time" className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.appointment.newTime}
              </label>
              <div className="relative">
                <input
                  id="reschedule-time"
                  type="time"
                  value={newTime}
                  onChange={e => {
                    setErrorMessage(null);
                    setNewTime(e.target.value);
                  }}
                  required
                  className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-base lg:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                />
                <Clock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 lg:top-3 pointer-events-none" />
              </div>
              <p className="text-xs lg:text-[11px] text-slate-400 mt-1.5">
                {formatAppointmentDuration(appointment, t.appointment)} · {appointment.serviceName}
              </p>
            </div>

            {!slotAnalysis.effectiveHours.isClosed && slotAnalysis.slots.length > 0 && (
              <div>
                <p className="text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  {t.bookingModal.timeSlotLabel}
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-1.5 max-h-44 lg:max-h-36 overflow-y-auto pr-0.5">
                  {slotAnalysis.slots.map(slot => {
                    const isSelected = newTime === slot.time;
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!slot.isAvailable}
                        onClick={() => {
                          setErrorMessage(null);
                          setNewTime(slot.time);
                        }}
                        className={`min-h-[44px] lg:min-h-0 py-2 lg:py-1.5 px-2 text-xs lg:text-[11px] font-mono font-medium rounded-lg border transition-colors ${
                          !slot.isAvailable
                            ? 'opacity-30 border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 cursor-not-allowed line-through'
                            : isSelected
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {slot.time}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2.5 p-4 lg:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] lg:min-h-0 w-full sm:w-auto px-4 py-2.5 lg:py-2 rounded-xl text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || slotAnalysis.effectiveHours.isClosed}
              className="min-h-[44px] lg:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 lg:py-2 rounded-xl text-sm lg:text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm shadow-indigo-600/20 transition-all"
            >
              {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{t.appointment.saveReschedule}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
