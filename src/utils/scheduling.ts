import { Appointment, Language, Service, Tenant } from '../types';
import {
  formatMinutesToTime,
  getDayOfWeekFromDateString,
  getNowDateAndMinutesInTimezone,
  getZonedDateTimeUtcMs,
  parseTimeToMinutes,
} from './dateTime';

export interface EffectiveBusinessHours {
  date: string;
  open: string;
  close: string;
  openMinutes: number;
  closeMinutes: number;
  isClosed: boolean;
  isSpecialHours: boolean;
  specialLabel?: string;
}

export type BookingValidationReason =
  | 'invalid_input'
  | 'inactive_service'
  | 'past_datetime'
  | 'business_closed'
  | 'outside_operating_hours'
  | 'overlap_conflict'
  | 'buffer_conflict';

export interface BookingValidationResult {
  valid: boolean;
  reason?: BookingValidationReason;
  conflictAppointmentId?: string;
  effectiveHours: EffectiveBusinessHours;
  bufferMinutes: number;
}

export interface TimeSlotOption {
  time: string;
  endTime: string;
  status: 'available' | 'past' | 'conflict' | 'buffer';
  isAvailable: boolean;
}

export type CancellationValidationReason =
  | 'already_cancelled'
  | 'already_completed'
  | 'within_cancellation_buffer';

export interface CancellationValidationResult {
  allowed: boolean;
  reason?: CancellationValidationReason;
  requiredHours: number;
  remainingHours?: number;
}

export function resolveBusinessHoursForDate(
  tenant: Pick<Tenant, 'settings'>,
  dateStr: string
): EffectiveBusinessHours {
  const specialList = tenant?.settings?.specialHours;
  const specialMatch = Array.isArray(specialList)
    ? specialList.find(sh => sh?.date === dateStr)
    : undefined;

  if (specialMatch) {
    if (specialMatch.isClosed) {
      return {
        date: dateStr,
        open: '',
        close: '',
        openMinutes: 0,
        closeMinutes: 0,
        isClosed: true,
        isSpecialHours: true,
        specialLabel: specialMatch.label,
      };
    }

    const open = specialMatch.open || '';
    const close = specialMatch.close || '';
    const openMinutes = open ? parseTimeToMinutes(open) : 0;
    const closeMinutes = close ? parseTimeToMinutes(close) : 0;
    const hasValidWindow = Boolean(open && close && openMinutes < closeMinutes);

    return {
      date: dateStr,
      open,
      close,
      openMinutes,
      closeMinutes,
      isClosed: !hasValidWindow,
      isSpecialHours: true,
      specialLabel: specialMatch.label,
    };
  }

  const dow = getDayOfWeekFromDateString(dateStr);
  const weekly = tenant?.settings?.operatingHours?.[dow];
  if (!weekly || weekly.isClosed) {
    return {
      date: dateStr,
      open: weekly?.open || '',
      close: weekly?.close || '',
      openMinutes: 0,
      closeMinutes: 0,
      isClosed: true,
      isSpecialHours: false,
    };
  }

  const open = weekly.open || '';
  const close = weekly.close || '';
  const openMinutes = open ? parseTimeToMinutes(open) : 0;
  const closeMinutes = close ? parseTimeToMinutes(close) : 0;
  const hasValidWindow = Boolean(open && close && openMinutes < closeMinutes);

  return {
    date: dateStr,
    open,
    close,
    openMinutes,
    closeMinutes,
    isClosed: !hasValidWindow,
    isSpecialHours: false,
  };
}

export function validateBookingWindow(params: {
  tenant: Pick<Tenant, 'timezone' | 'settings'>;
  date: string;
  startTime: string;
  durationMinutes: number;
  appointments: Appointment[];
  staffId?: string;
  excludeAppointmentId?: string;
  service?: Pick<Service, 'active'> | null;
  now?: Date;
}): BookingValidationResult {
  const {
    tenant,
    date,
    startTime,
    durationMinutes,
    appointments,
    staffId,
    excludeAppointmentId,
    service,
    now = new Date(),
  } = params;

  const effectiveHours = resolveBusinessHoursForDate(tenant, date);
  const bufferMinutes = Math.max(0, Number(tenant?.settings?.bufferBetweenAppointmentsMinutes) || 0);

  if (service && !service.active) {
    return {
      valid: false,
      reason: 'inactive_service',
      effectiveHours,
      bufferMinutes,
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}/.test(startTime || '') || durationMinutes <= 0) {
    return {
      valid: false,
      reason: 'invalid_input',
      effectiveHours,
      bufferMinutes,
    };
  }

  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = startMinutes + durationMinutes;

  const nowInTz = getNowDateAndMinutesInTimezone(now, tenant?.timezone);
  if (date < nowInTz.dateStr || (date === nowInTz.dateStr && startMinutes < nowInTz.minutes)) {
    return {
      valid: false,
      reason: 'past_datetime',
      effectiveHours,
      bufferMinutes,
    };
  }

  if (effectiveHours.isClosed) {
    return {
      valid: false,
      reason: 'business_closed',
      effectiveHours,
      bufferMinutes,
    };
  }

  if (startMinutes < effectiveHours.openMinutes || endMinutes > effectiveHours.closeMinutes) {
    return {
      valid: false,
      reason: 'outside_operating_hours',
      effectiveHours,
      bufferMinutes,
    };
  }

  // Check strict overlap first, then buffer conflict, against all active appointments on that date
  let bufferConflictId: string | undefined;

  for (const existing of appointments) {
    if (excludeAppointmentId && existing.id === excludeAppointmentId) continue;
    if (existing.status === 'cancelled' || existing.status === 'no_show') continue;
    if (existing.date !== date) continue;

    if (staffId && existing.staffId && existing.staffId !== staffId) {
      continue;
    }

    const existingStart = parseTimeToMinutes(existing.startTime);
    const parsedEnd = existing.endTime ? parseTimeToMinutes(existing.endTime) : NaN;
    const existingEnd =
      Number.isFinite(parsedEnd) && parsedEnd > existingStart
        ? parsedEnd
        : existingStart + Math.max(1, Number(existing.durationMinutes) || 60);

    if (startMinutes < existingEnd && endMinutes > existingStart) {
      return {
        valid: false,
        reason: 'overlap_conflict',
        conflictAppointmentId: existing.id,
        effectiveHours,
        bufferMinutes,
      };
    }

    if (
      bufferMinutes > 0 &&
      startMinutes < existingEnd + bufferMinutes &&
      endMinutes + bufferMinutes > existingStart
    ) {
      bufferConflictId = bufferConflictId || existing.id;
    }
  }

  if (bufferConflictId) {
    return {
      valid: false,
      reason: 'buffer_conflict',
      conflictAppointmentId: bufferConflictId,
      effectiveHours,
      bufferMinutes,
    };
  }

  return {
    valid: true,
    effectiveHours,
    bufferMinutes,
  };
}

export function generateBookingTimeSlots(params: {
  tenant: Pick<Tenant, 'timezone' | 'settings'>;
  date: string;
  durationMinutes: number;
  appointments: Appointment[];
  staffId?: string;
  excludeAppointmentId?: string;
  stepMinutes?: number;
  now?: Date;
}): {
  effectiveHours: EffectiveBusinessHours;
  slots: TimeSlotOption[];
} {
  const {
    tenant,
    date,
    durationMinutes,
    appointments,
    staffId,
    excludeAppointmentId,
    stepMinutes = 30,
    now = new Date(),
  } = params;

  const effectiveHours = resolveBusinessHoursForDate(tenant, date);
  const safeDuration = Math.max(15, Number(durationMinutes) || 60);
  const safeStep = Math.max(5, Number(stepMinutes) || 30);

  if (effectiveHours.isClosed || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return { effectiveHours, slots: [] };
  }

  const slots: TimeSlotOption[] = [];
  for (
    let startMins = effectiveHours.openMinutes;
    startMins + safeDuration <= effectiveHours.closeMinutes;
    startMins += safeStep
  ) {
    const time = formatMinutesToTime(startMins);
    const endTime = formatMinutesToTime(startMins + safeDuration);
    const validation = validateBookingWindow({
      tenant,
      date,
      startTime: time,
      durationMinutes: safeDuration,
      appointments,
      staffId,
      excludeAppointmentId,
      now,
    });

    let status: TimeSlotOption['status'] = 'available';
    if (!validation.valid) {
      if (validation.reason === 'past_datetime') status = 'past';
      else if (validation.reason === 'buffer_conflict') status = 'buffer';
      else status = 'conflict';
    }

    slots.push({
      time,
      endTime,
      status,
      isAvailable: validation.valid,
    });
  }

  return { effectiveHours, slots };
}

export function validateCancellationWindow(
  appointment: Pick<Appointment, 'date' | 'startTime' | 'status'>,
  tenant: Pick<Tenant, 'timezone' | 'settings'>,
  now: Date = new Date()
): CancellationValidationResult {
  const requiredHours = Math.max(0, Number(tenant?.settings?.cancellationBufferHours) || 0);

  if (appointment.status === 'cancelled') {
    return { allowed: false, reason: 'already_cancelled', requiredHours };
  }

  if (appointment.status === 'completed') {
    return { allowed: false, reason: 'already_completed', requiredHours };
  }

  if (requiredHours === 0) {
    return { allowed: true, requiredHours: 0 };
  }

  const appointmentStartMs = getZonedDateTimeUtcMs(
    appointment.date,
    appointment.startTime,
    tenant?.timezone
  );
  const diffMs = appointmentStartMs - now.getTime();
  const remainingHours = diffMs / 3_600_000;

  if (diffMs < requiredHours * 3_600_000) {
    return {
      allowed: false,
      reason: 'within_cancellation_buffer',
      requiredHours,
      remainingHours,
    };
  }

  return {
    allowed: true,
    requiredHours,
    remainingHours,
  };
}

export function formatBookingValidationError(
  result: BookingValidationResult,
  lang: Language
): string {
  const isEs = lang === 'es';
  const { reason, effectiveHours, bufferMinutes } = result;

  switch (reason) {
    case 'inactive_service':
      return isEs
        ? 'Los servicios inactivos no se pueden agendar. Reactiva el servicio o selecciona uno activo.'
        : 'Inactive services cannot be booked. Please reactivate the service first or choose an active service.';
    case 'past_datetime':
      return isEs
        ? 'No se puede agendar ni reprogramar en una fecha u horario pasado.'
        : 'Appointments cannot be scheduled or rescheduled in the past.';
    case 'business_closed':
      return isEs
        ? `El negocio permanece cerrado el ${effectiveHours.date}${effectiveHours.specialLabel ? ` (${effectiveHours.specialLabel})` : ''}.`
        : `The business is closed on ${effectiveHours.date}${effectiveHours.specialLabel ? ` (${effectiveHours.specialLabel})` : ''}.`;
    case 'outside_operating_hours':
      return isEs
        ? `El horario seleccionado está fuera del horario de atención (${effectiveHours.open} – ${effectiveHours.close}).`
        : `The selected time is outside operating hours (${effectiveHours.open} – ${effectiveHours.close}).`;
    case 'buffer_conflict':
      return isEs
        ? `Conflicto de preparación: se requiere un margen de ${bufferMinutes} minutos entre citas.`
        : `Preparation buffer conflict: ${bufferMinutes} minutes are required between appointments.`;
    case 'overlap_conflict':
      return isEs
        ? 'Conflicto de horario: ya existe una cita reservada en este bloque de tiempo.'
        : 'Schedule conflict: another appointment is already booked during this time slot.';
    default:
      return isEs
        ? 'Por favor selecciona una fecha y hora válidas.'
        : 'Please select a valid date and time.';
  }
}

export function formatCancellationValidationError(
  result: CancellationValidationResult,
  lang: Language
): string {
  const isEs = lang === 'es';
  switch (result.reason) {
    case 'already_cancelled':
      return isEs ? 'Esta cita ya fue cancelada.' : 'This appointment is already cancelled.';
    case 'already_completed':
      return isEs
        ? 'Las citas completadas no pueden cancelarse.'
        : 'Completed appointments cannot be cancelled.';
    case 'within_cancellation_buffer':
      return isEs
        ? `No se puede cancelar: la política del negocio requiere al menos ${result.requiredHours} horas de anticipación.`
        : `Cannot cancel: this business requires at least ${result.requiredHours} hours advance notice before the appointment start time.`;
    default:
      return isEs ? 'No es posible cancelar esta cita.' : 'Unable to cancel this appointment.';
  }
}
