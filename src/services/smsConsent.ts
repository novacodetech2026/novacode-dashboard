import { SEED_TENANTS } from '../data/seedData';
import { getSupabaseClient, normalizeSupabaseUrl } from './supabase';

export const SMS_CONSENT_DISCLOSURE_VERSION = 'v1.0-2026-11-15';
export const SMS_CONSENT_SOURCE_WEB_FORM = 'web_form' as const;

export type SmsConsentSource = 'web_form' | 'qr_code' | 'booking_widget' | 'in_person' | 'api';

export interface PublicSmsBusinessInfo {
  id: string;
  name: string;
  slug?: string;
  tagline?: string;
  website?: string;
  defaultLanguage: 'en' | 'es';
  smsOptInEnabled: boolean;
  messagingApproved: boolean;
  disclosureVersion: string;
}

export interface ResolveSmsBusinessResult {
  business: PublicSmsBusinessInfo | null;
  availableBusinesses: PublicSmsBusinessInfo[];
  source: 'supabase' | 'preview';
  requiresSelection: boolean;
  error?: string;
}

export interface SmsConsentSubmissionInput {
  businessId: string;
  businessName: string;
  customerName?: string;
  phoneNumber: string;
  consentChecked: boolean;
  consentSource?: SmsConsentSource;
  honeypot?: string;
  formRenderedAtMs?: number;
  turnstileToken?: string | null;
}

export interface SmsConsentReceipt {
  consentId: string;
  businessId: string;
  businessName: string;
  customerName?: string;
  phoneNumber: string;
  consentTimestamp: string;
  consentDisclosureVersion: string;
  consentSource: SmsConsentSource;
  messagingApproved: boolean;
  persistenceMode: 'supabase' | 'preview_local';
}

export interface SubmitSmsConsentResult {
  success: boolean;
  receipt?: SmsConsentReceipt;
  error?: string;
  rateLimited?: boolean;
}

export interface PhoneValidationResult {
  valid: boolean;
  e164?: string;
  display?: string;
  error?: string;
}

const PREVIEW_CONSENTS_STORAGE_KEY = 'novacode_sms_consent_records';
const COOLDOWN_STORAGE_PREFIX = 'novacode_sms_consent_cooldown_';
const CLIENT_COOLDOWN_WINDOW_MS = 15_000;

/**
 * Verbatim Twilio A2P 10DLC consent disclosure required for Novacode Tech LLC.
 */
export function buildSmsConsentDisclosure(businessName: string): string {
  const safeName = (businessName || '').trim() || 'Participating Business';
  return `By checking this box, I agree to receive conversational and appointment-related SMS messages from ${safeName}, powered by Novacode Tech LLC, at the phone number provided. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is not a condition of purchase.`;
}

/**
 * Normalizes North American (10/11 digit) or international E.164 numbers and validates format.
 */
export function normalizeAndValidatePhoneNumber(rawInput: string): PhoneValidationResult {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Phone number is required.' };
  }

  // Reject alphabetic characters early
  if (/[a-zA-Z]/.test(trimmed)) {
    return { valid: false, error: 'Phone number must contain only digits and formatting symbols.' };
  }

  let cleaned = trimmed.replace(/[\s\-().]+/g, '');
  if (cleaned.startsWith('00') && cleaned.length > 2) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  if (/^\d{10}$/.test(cleaned)) {
    cleaned = `+1${cleaned}`;
  } else if (/^1\d{10}$/.test(cleaned)) {
    cleaned = `+${cleaned}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Enter a valid phone number with area code or country code (e.g., +1 555 234 5678).',
    };
  }

  const digits = cleaned.slice(1);
  if (
    /^(\d)\1+$/.test(digits) ||
    (/^\+1\d{10}$/.test(cleaned) && (!/^\+1[2-9]\d{9}$/.test(cleaned) || /^(\d)\1+$/.test(cleaned.slice(2))))
  ) {
    return { valid: false, error: 'Enter a valid reachable phone number.' };
  }

  // Format US/CA +1 numbers cleanly for receipt display
  let display = cleaned;
  if (/^\+1\d{10}$/.test(cleaned)) {
    display = `+1 (${cleaned.slice(2, 5)}) ${cleaned.slice(5, 8)}-${cleaned.slice(8)}`;
  }

  return { valid: true, e164: cleaned, display };
}

function getEdgeFunctionEndpoint(): { url: string; anonKey: string } | null {
  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  let storedUrl = '';
  let storedKey = '';

  try {
    const raw = localStorage.getItem('novacode_supabase_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      storedUrl = parsed.url || '';
      storedKey = parsed.anonKey || '';
    }
  } catch {
    // Ignore localStorage failures
  }

  const normalized = normalizeSupabaseUrl(envUrl || storedUrl);
  const anonKey = (envKey || storedKey || '').trim();
  if (!normalized.isValid || !normalized.url || !anonKey) {
    return null;
  }

  return {
    url: `${normalized.url}/functions/v1/register-sms-consent`,
    anonKey,
  };
}

function mapSeedTenants(): PublicSmsBusinessInfo[] {
  return SEED_TENANTS.filter((t) => t.isActive !== false).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug || t.id.replace(/^tenant-/, ''),
    tagline: t.tagline,
    website: t.website,
    defaultLanguage: t.defaultLanguage === 'es' ? 'es' : 'en',
    smsOptInEnabled: true,
    messagingApproved: false,
    disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION,
  }));
}

export async function resolveSmsConsentBusiness(options: {
  businessId?: string | null;
  slug?: string | null;
}): Promise<ResolveSmsBusinessResult> {
  const requestedId = options.businessId?.trim() || null;
  const requestedSlug = options.slug?.trim().toLowerCase() || null;

  const client = getSupabaseClient();
  const edge = getEdgeFunctionEndpoint();

  // Live Supabase path (never touches service_role on client)
  if (client && edge) {
    // 1. Try Edge Function GET lookup first
    try {
      const query = new URLSearchParams();
      if (requestedId) query.set('business_id', requestedId);
      if (requestedSlug) query.set('slug', requestedSlug);
      const qs = query.toString();

      const resp = await fetch(qs ? `${edge.url}?${qs}` : edge.url, {
        method: 'GET',
        headers: {
          apikey: edge.anonKey,
          Authorization: `Bearer ${edge.anonKey}`,
        },
      });

      if (resp.ok) {
        const body = await resp.json();
        const businesses: PublicSmsBusinessInfo[] = Array.isArray(body?.businesses) ? body.businesses : [];
        const resolved: PublicSmsBusinessInfo | null = body?.business || null;

        if (resolved) {
          return {
            business: resolved,
            availableBusinesses: businesses.length > 0 ? businesses : [resolved],
            source: 'supabase',
            requiresSelection: false,
          };
        }

        if (!requestedId && !requestedSlug && businesses.length > 0) {
          return {
            business: businesses.length === 1 ? businesses[0] : null,
            availableBusinesses: businesses,
            source: 'supabase',
            requiresSelection: businesses.length > 1,
          };
        }
      } else if (resp.status === 404 || resp.status === 400) {
        const errBody = await resp.json().catch(() => null);
        return {
          business: null,
          availableBusinesses: [],
          source: 'supabase',
          requiresSelection: false,
          error: errBody?.error || 'The requested business SMS registration page could not be found.',
        };
      }
    } catch {
      // Fall through cleanly to hardened public RPC if Edge Function isn't deployed yet
    }

    // 2. Fallback to hardened SECURITY DEFINER public lookup RPC (anon-safe, non-PII)
    try {
      if (requestedId || requestedSlug) {
        const numericId = requestedId && /^\d+$/.test(requestedId) ? Number(requestedId) : null;
        if (requestedId && numericId === null) {
          return {
            business: null,
            availableBusinesses: [],
            source: 'supabase',
            requiresSelection: false,
            error: 'Invalid business identifier.',
          };
        }

        const { data, error } = await client.rpc('get_public_sms_consent_business', {
          p_business_id: numericId,
          p_slug: requestedSlug,
        });

        if (!error) {
          const row = Array.isArray(data) ? data[0] : data;
          if (!row) {
            return {
              business: null,
              availableBusinesses: [],
              source: 'supabase',
              requiresSelection: false,
              error: 'The requested business SMS registration page could not be found.',
            };
          }
          const biz: PublicSmsBusinessInfo = {
            id: String(row.business_id),
            name: row.business_name,
            slug: row.business_slug || undefined,
            tagline: row.tagline || undefined,
            website: row.website || undefined,
            defaultLanguage: row.default_language === 'es' ? 'es' : 'en',
            smsOptInEnabled: row.sms_opt_in_enabled !== false,
            messagingApproved: row.messaging_approved === true,
            disclosureVersion: row.disclosure_version || SMS_CONSENT_DISCLOSURE_VERSION,
          };
          return {
            business: biz,
            availableBusinesses: [biz],
            source: 'supabase',
            requiresSelection: false,
          };
        }
      } else {
        const { data, error } = await client.rpc('get_public_sms_consent_businesses');
        if (!error && Array.isArray(data)) {
          const businesses: PublicSmsBusinessInfo[] = data.map((row: any) => ({
            id: String(row.business_id),
            name: row.business_name,
            slug: row.business_slug || undefined,
            defaultLanguage: 'en' as const,
            smsOptInEnabled: true,
            messagingApproved: row.messaging_approved === true,
            disclosureVersion: row.disclosure_version || SMS_CONSENT_DISCLOSURE_VERSION,
          }));
          return {
            business: businesses.length === 1 ? businesses[0] : null,
            availableBusinesses: businesses,
            source: 'supabase',
            requiresSelection: businesses.length > 1,
            error:
              businesses.length === 0
                ? 'No participating businesses are currently available for SMS consent registration.'
                : undefined,
          };
        }
      }
    } catch {
      // Surface clean unavailable message if Supabase RPC fails
    }

    return {
      business: null,
      availableBusinesses: [],
      source: 'supabase',
      requiresSelection: false,
      error: 'Unable to load business registration details right now. Please try again later.',
    };
  }

  // Local / preview fallback when Supabase env/client is not configured
  const previewBusinesses = mapSeedTenants();
  if (requestedId) {
    const matched = previewBusinesses.find(
      (b) => b.id.toLowerCase() === requestedId.toLowerCase() || (b.slug && b.slug === requestedId.toLowerCase())
    );
    if (!matched) {
      return {
        business: null,
        availableBusinesses: previewBusinesses,
        source: 'preview',
        requiresSelection: false,
        error: 'The requested business could not be found.',
      };
    }
    return {
      business: matched,
      availableBusinesses: previewBusinesses,
      source: 'preview',
      requiresSelection: false,
    };
  }

  if (requestedSlug) {
    const matched = previewBusinesses.find((b) => b.slug === requestedSlug);
    if (!matched) {
      return {
        business: null,
        availableBusinesses: previewBusinesses,
        source: 'preview',
        requiresSelection: false,
        error: 'The requested business could not be found.',
      };
    }
    return {
      business: matched,
      availableBusinesses: previewBusinesses,
      source: 'preview',
      requiresSelection: false,
    };
  }

  return {
    business: previewBusinesses[0] || null,
    availableBusinesses: previewBusinesses,
    source: 'preview',
    requiresSelection: false,
  };
}

function checkClientCooldown(businessId: string, e164Phone: string): boolean {
  try {
    const key = `${COOLDOWN_STORAGE_PREFIX}${businessId}_${e164Phone}`;
    const lastTs = Number(sessionStorage.getItem(key) || '0');
    if (lastTs > 0 && Date.now() - lastTs < CLIENT_COOLDOWN_WINDOW_MS) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

function markClientCooldown(businessId: string, e164Phone: string): void {
  try {
    const key = `${COOLDOWN_STORAGE_PREFIX}${businessId}_${e164Phone}`;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Ignore storage errors
  }
}

export async function submitSmsConsentRegistration(
  input: SmsConsentSubmissionInput
): Promise<SubmitSmsConsentResult> {
  // 1. Honeypot trap check
  if ((input.honeypot || '').trim().length > 0) {
    return {
      success: false,
      error: 'Your submission could not be verified. Please refresh and try again.',
    };
  }

  // 2. Minimum form fill elapsed time guard
  if (typeof input.formRenderedAtMs === 'number') {
    const elapsed = Date.now() - input.formRenderedAtMs;
    if (elapsed >= 0 && elapsed < 500) {
      return {
        success: false,
        error: 'Please review the SMS disclosure before submitting.',
      };
    }
  }

  // 3. Explicit consent validation
  if (input.consentChecked !== true) {
    return {
      success: false,
      error: 'Please check the SMS consent box to continue.',
    };
  }

  // 4. Phone validation
  const phoneResult = normalizeAndValidatePhoneNumber(input.phoneNumber);
  if (!phoneResult.valid || !phoneResult.e164) {
    return {
      success: false,
      error: phoneResult.error || 'Please enter a valid phone number.',
    };
  }

  // 5. Business validation
  const businessId = (input.businessId || '').trim();
  if (!businessId) {
    return {
      success: false,
      error: 'No business is selected for this registration.',
    };
  }

  // 6. Client-side burst cooldown check
  if (!checkClientCooldown(businessId, phoneResult.e164)) {
    return {
      success: false,
      rateLimited: true,
      error: 'Consent for this number was just submitted. Please wait a few seconds before submitting again.',
    };
  }

  const cleanName = (input.customerName || '').trim().slice(0, 120) || undefined;
  const consentSource: SmsConsentSource = input.consentSource || SMS_CONSENT_SOURCE_WEB_FORM;
  const pageUrl =
    typeof window !== 'undefined' ? window.location.href.slice(0, 1024) : undefined;

  const configuredSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
  const cleanTurnstileToken = (input.turnstileToken || '').trim();
  const client = getSupabaseClient();
  const edge = getEdgeFunctionEndpoint();

  if ((configuredSiteKey || (client && edge)) && !cleanTurnstileToken) {
    return {
      success: false,
      error: 'Please complete the security verification challenge before submitting.',
    };
  }

  // Live Supabase submission path: strictly routed through Edge Function server-side Turnstile verification (ZERO auto-SMS)
  if (client && edge) {
    try {
      const resp = await fetch(edge.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: edge.anonKey,
          Authorization: `Bearer ${edge.anonKey}`,
        },
        body: JSON.stringify({
          businessId,
          customerName: cleanName || null,
          phoneNumber: phoneResult.e164,
          consentChecked: true,
          consentSource,
          disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION,
          honeypot: input.honeypot || '',
          formRenderedAtMs: input.formRenderedAtMs,
          turnstileToken: cleanTurnstileToken,
          pageUrl,
        }),
      });

      const body = await resp.json().catch(() => null);
      if (resp.ok && body?.success && body?.record) {
        markClientCooldown(businessId, phoneResult.e164);
        return {
          success: true,
          receipt: {
            consentId: String(body.record.consentId),
            businessId: String(body.record.businessId),
            businessName: String(body.record.businessName || input.businessName),
            customerName: cleanName,
            phoneNumber: String(body.record.phoneNumber || phoneResult.e164),
            consentTimestamp: String(body.record.consentTimestamp),
            consentDisclosureVersion: String(
              body.record.consentDisclosureVersion || SMS_CONSENT_DISCLOSURE_VERSION
            ),
            consentSource: (body.record.consentSource || consentSource) as SmsConsentSource,
            messagingApproved: body.record.messagingApproved === true,
            persistenceMode: 'supabase',
          },
        };
      }

      if (resp.status === 429) {
        return {
          success: false,
          rateLimited: true,
          error: body?.error || 'Too many requests. Please wait 15 minutes and try again.',
        };
      }

      if (resp.status === 404) {
        return {
          success: false,
          error: 'SMS consent verification service is unavailable. Ensure the register-sms-consent Edge Function is deployed.',
        };
      }

      return {
        success: false,
        error: body?.error || 'Unable to verify and save your SMS consent right now.',
      };
    } catch {
      return {
        success: false,
        error: 'Unable to reach the SMS consent verification service. Please check your connection and try again.',
      };
    }
  }

  // Local / preview persistence (used only when Supabase is not configured in local environment)
  const consentTimestamp = new Date().toISOString();
  const consentId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `consent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const previewRecord = {
    id: consentId,
    business_id: businessId,
    business_name: input.businessName,
    customer_name: cleanName || null,
    phone_number: phoneResult.e164,
    consent_given: true,
    consent_timestamp: consentTimestamp,
    consent_disclosure_version: SMS_CONSENT_DISCLOSURE_VERSION,
    consent_disclosure_text: buildSmsConsentDisclosure(input.businessName),
    consent_source: consentSource,
    messaging_approved: false,
  };

  try {
    const existingRaw = localStorage.getItem(PREVIEW_CONSENTS_STORAGE_KEY);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    const next = Array.isArray(existing) ? [previewRecord, ...existing].slice(0, 100) : [previewRecord];
    localStorage.setItem(PREVIEW_CONSENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota issues
  }

  markClientCooldown(businessId, phoneResult.e164);

  return {
    success: true,
    receipt: {
      consentId,
      businessId,
      businessName: input.businessName,
      customerName: cleanName,
      phoneNumber: phoneResult.e164,
      consentTimestamp,
      consentDisclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION,
      consentSource,
      messagingApproved: false,
      persistenceMode: 'preview_local',
    },
  };
}
