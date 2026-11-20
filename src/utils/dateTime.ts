/**
 * Timezone-safe date and calendar grid utilities for Novacode Tech.
 * Prevents UTC offset shifts caused by `.toISOString().split('T')[0]`.
 */

export function getDateStringInTimezone(date: Date = new Date(), timeZone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    }
    if (map.year && map.month && map.day) {
      return `${map.year}-${map.month}-${map.day}`;
    }
  } catch {
    // Fallback to local wall-clock date if invalid timezone string is supplied
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getHourInTimezone(date: Date = new Date(), timeZone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(date);
    const hourPart = parts.find(p => p.type === 'hour')?.value;
    const parsed = Number(hourPart);
    if (Number.isFinite(parsed)) {
      return parsed === 24 ? 0 : parsed;
    }
  } catch {
    // Fallback to local hour
  }
  return date.getHours();
}

export function getDayOfWeekFromDateString(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return 0;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

export function getDayOfWeekInTimezone(date: Date = new Date(), timeZone?: string): number {
  const dateStr = getDateStringInTimezone(date, timeZone);
  return getDayOfWeekFromDateString(dateStr);
}

export function parseDateStringNoonUtc(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function formatUtcDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftDateString(dateStr: string, deltaDays: number): string {
  const d = parseDateStringNoonUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return formatUtcDateString(d);
}

export function shiftMonthDateString(dateStr: string, deltaMonths: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const targetFirst = new Date(Date.UTC(year, month - 1 + deltaMonths, 1, 12, 0, 0));
  const targetYear = targetFirst.getUTCFullYear();
  const targetMonth0 = targetFirst.getUTCMonth();
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth0 + 1, 0, 12, 0, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return formatUtcDateString(new Date(Date.UTC(targetYear, targetMonth0, clampedDay, 12, 0, 0)));
}

export function getWeekDates(anchorDateStr: string): string[] {
  const dow = getDayOfWeekFromDateString(anchorDateStr); // 0 = Sun..6 = Sat
  const sunday = shiftDateString(anchorDateStr, -dow);
  return Array.from({ length: 7 }, (_, i) => shiftDateString(sunday, i));
}

export interface CalendarMonthCell {
  dateStr: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  dayOfWeek: number;
}

export function getCalendarMonthGrid(anchorDateStr: string): CalendarMonthCell[] {
  const [year, month] = anchorDateStr.split('-').map(Number);
  const safeYear = year || new Date().getFullYear();
  const safeMonth0 = (month || 1) - 1;

  const firstOfMonth = new Date(Date.UTC(safeYear, safeMonth0, 1, 12, 0, 0));
  const firstDayOfWeek = firstOfMonth.getUTCDay(); // 0..6 (Sun..Sat)
  const daysInMonth = new Date(Date.UTC(safeYear, safeMonth0 + 1, 0, 12, 0, 0)).getUTCDate();

  const totalCells = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;
  const gridStartDate = new Date(firstOfMonth);
  gridStartDate.setUTCDate(firstOfMonth.getUTCDate() - firstDayOfWeek);

  const cells: CalendarMonthCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(gridStartDate);
    cellDate.setUTCDate(gridStartDate.getUTCDate() + i);
    cells.push({
      dateStr: formatUtcDateString(cellDate),
      dayNumber: cellDate.getUTCDate(),
      isCurrentMonth: cellDate.getUTCMonth() === safeMonth0 && cellDate.getUTCFullYear() === safeYear,
      dayOfWeek: cellDate.getUTCDay(),
    });
  }

  return cells;
}

export function formatReadableDate(
  dateStr: string,
  locale: 'en' | 'es',
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseDateStringNoonUtc(dateStr);
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-US', {
    timeZone: 'UTC',
    ...(options || { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
  }).format(d);
}

export function parseTimeToMinutes(timeStr: string): number {
  const [rawH, rawM] = String(timeStr || '00:00').split(':').map(Number);
  const h = Number.isFinite(rawH) ? rawH : 0;
  const m = Number.isFinite(rawM) ? rawM : 0;
  return h * 60 + m;
}

export function formatMinutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getNowDateAndMinutesInTimezone(
  now: Date = new Date(),
  timeZone?: string
): { dateStr: string; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(now);

    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        map[p.type] = p.value;
      }
    }

    if (map.year && map.month && map.day) {
      const h = map.hour === '24' ? 0 : Number(map.hour ?? 0);
      const m = Number(map.minute ?? 0);
      return {
        dateStr: `${map.year}-${map.month}-${map.day}`,
        minutes: (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0),
      };
    }
  } catch {
    // Fallback to local clock if timezone is invalid
  }

  return {
    dateStr: getDateStringInTimezone(now, timeZone),
    minutes: now.getHours() * 60 + now.getMinutes(),
  };
}

export function getZonedDateTimeUtcMs(
  dateStr: string,
  timeStr: string,
  timeZone?: string
): number {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  const [hour, minute] = String(timeStr || '00:00').split(':').map(Number);
  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;

  if (!year || !month || !day) {
    return new Date(`${dateStr}T${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}:00`).getTime();
  }

  if (!timeZone) {
    return new Date(`${dateStr}T${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}:00`).getTime();
  }

  try {
    const utcGuess = Date.UTC(year, month - 1, day, safeHour, safeMinute, 0);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    const getOffsetMs = (utcMs: number): number => {
      const parts = formatter.formatToParts(new Date(utcMs));
      const map: Record<string, number> = {};
      for (const p of parts) {
        if (p.type !== 'literal') {
          map[p.type] = Number(p.value);
        }
      }
      const h = map.hour === 24 ? 0 : (map.hour ?? 0);
      const tzAsUtc = Date.UTC(map.year, (map.month ?? 1) - 1, map.day ?? 1, h, map.minute ?? 0, map.second ?? 0);
      return tzAsUtc - utcMs;
    };

    const offset1 = getOffsetMs(utcGuess);
    const offset2 = getOffsetMs(utcGuess - offset1);
    return utcGuess - offset2;
  } catch {
    return new Date(`${dateStr}T${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}:00`).getTime();
  }
}

const PLAIN_TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const FULL_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})(?:T|\s+)(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(.*)$/;

export function normalizeTimestampString(value: string): string {
  const trimmed = value.trim();
  const match = FULL_TIMESTAMP_RE.exec(trimmed);
  if (!match) return trimmed;
  const [, datePart, timePart, rawOffset] = match;
  let offsetPart = rawOffset.trim();
  if (/^[+-]\d{2}$/.test(offsetPart)) {
    offsetPart = `${offsetPart}:00`;
  }
  return `${datePart}T${timePart}${offsetPart}`;
}

export function parseTimestampUtcMs(value?: string | null): number | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !FULL_TIMESTAMP_RE.test(trimmed)) return null;
  const normalized = normalizeTimestampString(trimmed);
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function extractDateAndTimeInTimezone(
  value?: string | null,
  timeZone?: string
): { date?: string; time?: string } {
  if (!value || typeof value !== 'string') return {};
  const trimmed = value.trim();
  if (!trimmed) return {};

  const plainMatch = PLAIN_TIME_RE.exec(trimmed);
  if (plainMatch) {
    const hh = plainMatch[1].padStart(2, '0');
    const mm = plainMatch[2];
    return { time: `${hh}:${mm}` };
  }

  const utcMs = parseTimestampUtcMs(trimmed);
  if (utcMs !== null) {
    const parsed = new Date(utcMs);
    try {
      const opts: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        ...(timeZone ? { timeZone } : {}),
      };
      const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(parsed);
      const map: Record<string, string> = {};
      for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
      }
      const h = map.hour === '24' ? '00' : (map.hour || '00');
      if (map.year && map.month && map.day) {
        return {
          date: `${map.year}-${map.month}-${map.day}`,
          time: `${h}:${map.minute || '00'}`,
        };
      }
    } catch {
      const iso = parsed.toISOString();
      return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
    }
  }

  return {};
}

function parsePlainTimeToSeconds(value: string): number | null {
  const match = PLAIN_TIME_RE.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export function calculateAppointmentDurationMinutes(
  startTimeValue?: string | null,
  endTimeValue?: string | null
): number | null {
  if (
    typeof startTimeValue !== 'string' ||
    typeof endTimeValue !== 'string' ||
    !startTimeValue.trim() ||
    !endTimeValue.trim()
  ) {
    return null;
  }

  const startMs = parseTimestampUtcMs(startTimeValue);
  const endMs = parseTimestampUtcMs(endTimeValue);
  if (startMs !== null && endMs !== null) {
    const diffMinutes = Math.round((endMs - startMs) / 60_000);
    return diffMinutes > 0 ? diffMinutes : null;
  }

  const startSec = parsePlainTimeToSeconds(startTimeValue);
  const endSec = parsePlainTimeToSeconds(endTimeValue);
  if (startSec !== null && endSec !== null) {
    const diffMinutes = Math.round((endSec - startSec) / 60);
    return diffMinutes > 0 ? diffMinutes : null;
  }

  return null;
}

export function getAppointmentDurationMinutes(appointment?: {
  startTime?: string | null;
  endTime?: string | null;
  rawStartTime?: string | null;
  rawEndTime?: string | null;
} | null): number | null {
  if (!appointment) return null;

  if (appointment.rawStartTime !== undefined || appointment.rawEndTime !== undefined) {
    const rawDuration = calculateAppointmentDurationMinutes(
      appointment.rawStartTime,
      appointment.rawEndTime
    );
    if (rawDuration !== null) return rawDuration;
    if (!appointment.rawStartTime || !appointment.rawEndTime) {
      // If either raw timestamp was explicitly absent on a DB row, do not fall back
      if (!appointment.startTime?.trim() || !appointment.endTime?.trim()) {
        return null;
      }
    }
  }

  return calculateAppointmentDurationMinutes(appointment.startTime, appointment.endTime);
}

export function formatAppointmentDuration(
  appointment: {
    startTime?: string | null;
    endTime?: string | null;
    rawStartTime?: string | null;
    rawEndTime?: string | null;
  } | null | undefined,
  labels: { minutes: string; durationUnavailable: string },
  options?: { compact?: boolean }
): string {
  const durationMinutes = getAppointmentDurationMinutes(appointment);
  if (durationMinutes === null) {
    return labels.durationUnavailable;
  }
  return options?.compact
    ? `${durationMinutes}m`
    : `${durationMinutes} ${labels.minutes}`;
}

export function formatAppointmentTimeRange(
  appointment: { startTime?: string | null; endTime?: string | null } | null | undefined,
  separator = ' – '
): string {
  const start = typeof appointment?.startTime === 'string' ? appointment.startTime.trim() : '';
  const end = typeof appointment?.endTime === 'string' ? appointment.endTime.trim() : '';
  if (start && end) return `${start}${separator}${end}`;
  if (start) return start;
  if (end) return end;
  return '—';
}


