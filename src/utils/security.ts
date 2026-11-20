import { PlatformRole, SupportTicketCategory, SupportTicketPriority } from '../types';

export type BusinessErrorCategory = 'connection' | 'permission' | 'validation' | 'unknown';

export interface SanitizedBusinessError {
  userMessage: string;
  errorType: BusinessErrorCategory;
  technicalDetail: string;
}

const INFRASTRUCTURE_TERMS_REGEX =
  /\b(supabase|postgres(?:ql)?|pgrst\d*|rpc|sqlstate|rls|row-level security|row level security|business_members|platform_admins|support_incidents|support_notifications|business_support_tickets|support_ticket_messages|n8n|gemini|service_role|anon key|jwt)\b/i;

export function containsInfrastructureTerms(text: string): boolean {
  return INFRASTRUCTURE_TERMS_REGEX.test(text);
}

export const VALID_SUPPORT_CATEGORIES: readonly SupportTicketCategory[] = [
  'general_question',
  'technical_problem',
  'booking_calendar_issue',
  'ai_receptionist_issue',
  'customer_service_concern',
  'account_access_problem',
  'feature_request',
  'complaint',
  'other',
] as const;

export const VALID_SUPPORT_PRIORITIES: readonly SupportTicketPriority[] = [
  'low',
  'medium',
  'high',
  'urgent',
] as const;

export function validateSupportTicketInput(
  input: {
    category: string;
    subject: string;
    description: string;
    priority: string;
  },
  lang: 'en' | 'es' = 'en'
): {
  valid: boolean;
  error?: string;
  normalized?: {
    category: SupportTicketCategory;
    priority: SupportTicketPriority;
    subject: string;
    description: string;
  };
} {
  const subject = (input.subject || '').trim();
  const description = (input.description || '').trim();

  if (!VALID_SUPPORT_CATEGORIES.includes(input.category as SupportTicketCategory)) {
    return {
      valid: false,
      error:
        lang === 'es'
          ? 'Selecciona una categoría de soporte válida.'
          : 'Please select a valid support category.',
    };
  }

  if (!VALID_SUPPORT_PRIORITIES.includes(input.priority as SupportTicketPriority)) {
    return {
      valid: false,
      error:
        lang === 'es'
          ? 'Selecciona una prioridad válida.'
          : 'Please select a valid priority level.',
    };
  }

  if (subject.length < 3 || subject.length > 200) {
    return {
      valid: false,
      error:
        lang === 'es'
          ? 'El asunto debe tener entre 3 y 200 caracteres.'
          : 'Subject must be between 3 and 200 characters.',
    };
  }

  if (description.length < 5) {
    return {
      valid: false,
      error:
        lang === 'es'
          ? 'La descripción debe tener al menos 5 caracteres.'
          : 'Description must be at least 5 characters.',
    };
  }

  return {
    valid: true,
    normalized: {
      category: input.category as SupportTicketCategory,
      priority: input.priority as SupportTicketPriority,
      subject,
      description,
    },
  };
}

/**
 * Converts low-level database/API errors into clean business-facing messages while preserving
 * technical detail strictly for internal/Super Admin diagnostics.
 */
export function sanitizeErrorForBusiness(
  rawError: unknown,
  lang: 'en' | 'es' = 'en'
): SanitizedBusinessError {
  const technicalDetail =
    typeof rawError === 'string'
      ? rawError
      : rawError && typeof rawError === 'object'
      ? [
          'code' in rawError && (rawError as any).code ? `[${String((rawError as any).code)}]` : '',
          'message' in rawError && (rawError as any).message ? String((rawError as any).message) : '',
          'details' in rawError && (rawError as any).details ? String((rawError as any).details) : '',
        ]
          .filter(Boolean)
          .join(' ') || String(rawError)
      : 'Unknown error';

  const lower = technicalDetail.toLowerCase();

  const isPermission =
    lower.includes('42501') ||
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('row level security') ||
    lower.includes('unauthorized') ||
    lower.includes('not authorized') ||
    lower.includes('forbidden') ||
    lower.includes('active business membership required') ||
    lower.includes('jwt expired') ||
    lower.includes('invalid jwt');

  if (isPermission) {
    return {
      errorType: 'permission',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'No tienes permisos suficientes para realizar esta acción.'
          : 'You do not have permission to perform this action.',
    };
  }

  if (lower.includes('closed support ticket')) {
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'Esta solicitud está cerrada y ya no acepta respuestas.'
          : 'This support request is closed and can no longer receive replies.',
    };
  }

  if (lower.includes('inactive services cannot be booked') || lower.includes('service is inactive')) {
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'Los servicios inactivos no se pueden agendar. Reactiva el servicio o selecciona uno activo.'
          : 'Inactive services cannot be booked. Please reactivate the service first or choose an active service.',
    };
  }

  if (lower.includes('cancellation rejected') || lower.includes('hours in advance') || lower.includes('cancellation buffer')) {
    const hoursMatch = technicalDetail.match(/(\d+)\s*hours?/i);
    const hrs = hoursMatch ? hoursMatch[1] : null;
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? hrs
            ? `No se puede cancelar: la política del negocio requiere al menos ${hrs} horas de anticipación.`
            : 'No se puede cancelar dentro del período mínimo de anticipación configurado por el negocio.'
          : hrs
          ? `Cannot cancel: this business requires at least ${hrs} hours advance notice before the appointment start time.`
          : 'Cannot cancel within the business minimum cancellation notice window.',
    };
  }

  if (lower.includes('business is closed') || lower.includes('closed on')) {
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'El negocio permanece cerrado en la fecha seleccionada (día festivo o cierre programado).'
          : 'The business is closed on the selected date due to operating schedule or holiday hours.',
    };
  }

  if (lower.includes('outside operating hours')) {
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'El horario seleccionado está fuera del horario de atención del negocio.'
          : 'The selected time is outside the business operating hours.',
    };
  }

  if (lower.includes('cannot be scheduled in the past') || lower.includes('in the past')) {
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'No se puede agendar ni reprogramar en una fecha u horario pasado.'
          : 'Appointments cannot be scheduled or rescheduled in the past.',
    };
  }

  if (lower.includes('schedule conflict') || lower.includes('required') && lower.includes('buffer') || lower.includes('overlaps another booking')) {
    const minsMatch = technicalDetail.match(/(\d+)\s*minute/i);
    const mins = minsMatch ? minsMatch[1] : null;
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? mins
            ? `Conflicto de horario o margen de preparación (${mins} min requeridos entre citas).`
            : 'Conflicto de horario: la cita se superpone con otra reserva o con el margen de preparación.'
          : mins
          ? `Schedule conflict: overlaps another booking or required ${mins}-minute buffer between appointments.`
          : 'Schedule conflict: appointment overlaps an existing booking or preparation buffer.',
    };
  }

  if (
    lower.includes('23514') ||
    lower.includes('violates check constraint') ||
    lower.includes('check constraint')
  ) {
    return {
      errorType: 'validation',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'Algunos campos no cumplen con los requisitos mínimos. Verifica la información e inténtalo de nuevo.'
          : 'Some fields do not meet the required format or length. Please review your input and try again.',
    };
  }

  const isConnection =
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('not connected') ||
    lower.includes('econn') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('unavailable');

  if (isConnection) {
    return {
      errorType: 'connection',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'No pudimos conectar en este momento. Verifica tu conexión e inténtalo nuevamente.'
          : 'Unable to connect right now. Please check your connection and try again.',
    };
  }

  if (
    lower.includes('42p01') ||
    lower.includes('pgrst205') ||
    lower.includes('does not exist') ||
    lower.includes('could not find the table')
  ) {
    return {
      errorType: 'connection',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'Este módulo se está preparando para tu cuenta. Inténtalo nuevamente en unos minutos.'
          : 'This feature is currently being prepared for your account. Please try again shortly.',
    };
  }

  if (containsInfrastructureTerms(technicalDetail)) {
    return {
      errorType: 'unknown',
      technicalDetail,
      userMessage:
        lang === 'es'
          ? 'No pudimos completar esta operación en este momento. Inténtalo nuevamente.'
          : 'We could not complete this request right now. Please try again.',
    };
  }

  return {
    errorType: 'validation',
    technicalDetail,
    userMessage:
      technicalDetail.trim() ||
      (lang === 'es' ? 'Ocurrió un problema inesperado.' : 'An unexpected issue occurred.'),
  };
}

export function isPrivilegedServiceRoleKey(key?: string | null): boolean {
  const trimmed = (key || '').trim();
  if (!trimmed) return false;
  if (/service_role/i.test(trimmed)) return true;

  const parts = trimmed.split('.');
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(decoded);
    return payload?.role === 'service_role' || payload?.role === 'supabase_admin';
  } catch {
    return false;
  }
}

export const SUPER_ADMIN_ONLY_TABS = ['admin', 'support-center', 'incidents', 'infrastructure'] as const;
export const OWNER_OR_ADMIN_ONLY_TABS = ['settings'] as const;
export const BUSINESS_TABS = [
  'overview',
  'calendar',
  'appointments',
  'customers',
  'services',
  'messages',
  'ai-assistant',
  'support',
  'settings',
] as const;

export function canAccessTab(
  tabId: string,
  role: PlatformRole,
  flags?: { canViewPlatformAdmin?: boolean; canManageBusinessSettings?: boolean }
): boolean {
  const allowAdmin = flags?.canViewPlatformAdmin ?? role === 'super_admin';
  const allowSettings = flags?.canManageBusinessSettings ?? (role === 'super_admin' || role === 'owner');

  if ((SUPER_ADMIN_ONLY_TABS as readonly string[]).includes(tabId)) {
    return allowAdmin;
  }
  if ((OWNER_OR_ADMIN_ONLY_TABS as readonly string[]).includes(tabId)) {
    return allowSettings;
  }
  return (BUSINESS_TABS as readonly string[]).includes(tabId);
}

export function resolveTabFromPathname(
  pathname: string,
  flags: { canViewPlatformAdmin: boolean; canManageBusinessSettings: boolean },
  role: PlatformRole
): string {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!clean) {
    return flags.canViewPlatformAdmin ? 'admin' : 'overview';
  }

  const routeMap: Record<string, string> = {
    admin: 'admin',
    platform: 'admin',
    'support-center': 'support-center',
    support_center: 'support-center',
    incidents: 'incidents',
    infrastructure: 'infrastructure',
    overview: 'overview',
    calendar: 'calendar',
    appointments: 'appointments',
    customers: 'customers',
    services: 'services',
    messages: 'messages',
    'ai-assistant': 'ai-assistant',
    'ai-receptionist': 'ai-assistant',
    support: 'support',
    'help-support': 'support',
    settings: 'settings',
    'business-settings': 'settings',
  };

  const target = routeMap[clean] || 'overview';
  if (!canAccessTab(target, role, flags)) {
    return 'overview';
  }
  return target;
}

const CSV_FORMULA_PREFIX_REGEX = /^[\t\r ]*[=+\-@]|^[\t\r]/;

/**
 * Safely quotes and neutralizes CSV cells against spreadsheet formula injection.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const neutralized = CSV_FORMULA_PREFIX_REGEX.test(raw) ? `'${raw}` : raw;
  const escaped = neutralized.replace(/"/g, '""');
  return `"${escaped}"`;
}

