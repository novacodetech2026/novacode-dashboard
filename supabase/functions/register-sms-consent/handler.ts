const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const DEFAULT_DISCLOSURE_VERSION = 'v1.0-2026-11-15';
const VALID_CONSENT_SOURCES = new Set(['web_form', 'qr_code', 'booking_widget', 'in_person', 'api']);
const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_MAX_AGE_MS = 5 * 60 * 1000;

export interface AdminQueryBuilder {
  select: (columns: string) => {
    eq: (column: string, value: unknown) => {
      maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
    };
  };
}

export interface SupabaseAdminClientLike {
  rpc: (
    fnName: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: any; error: { message?: string } | null }>;
  from?: (tableName: string) => AdminQueryBuilder;
}

export interface RegisterSmsConsentDeps {
  getEnv: (name: string) => string | undefined;
  createAdminClient: (url: string, serviceRoleKey: string) => SupabaseAdminClientLike;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  randomUUID?: () => string;
}

interface SmsConsentSubmitPayload {
  businessId?: number | string | null;
  customerName?: string | null;
  phoneNumber?: string;
  consentChecked?: boolean;
  consentSource?: string;
  disclosureVersion?: string;
  honeypot?: string;
  companyWebsite?: string;
  formRenderedAtMs?: number;
  turnstileToken?: string | null;
  pageUrl?: string | null;
}

interface TurnstileSiteverifyResponse {
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function parsePositiveBigInt(val?: number | string | null): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return Number.isSafeInteger(val) && val > 0 ? val : null;
  }
  const trimmed = String(val).trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
  }
  return null;
}

function normalizePhoneToE164(rawPhone: string): { valid: boolean; e164?: string; error?: string } {
  const trimmed = (rawPhone || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Phone number is required.' };
  }

  let cleaned = trimmed.replace(/[\s\-().]+/g, '');
  if (/^[0-9]{10}$/.test(cleaned)) {
    cleaned = `+1${cleaned}`;
  } else if (/^1[0-9]{10}$/.test(cleaned)) {
    cleaned = `+${cleaned}`;
  }

  if (!/^\+[1-9][0-9]{7,14}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Please enter a valid phone number including area code or country code (e.g. +1 555 234 5678).',
    };
  }

  const digits = cleaned.slice(1);
  if (
    /^(\d)\1+$/.test(digits) ||
    (/^\+1\d{10}$/.test(cleaned) && (!/^\+1[2-9]\d{9}$/.test(cleaned) || /^(\d)\1+$/.test(cleaned.slice(2))))
  ) {
    return { valid: false, error: 'Please enter a valid reachable phone number.' };
  }

  return { valid: true, e164: cleaned };
}

function extractClientIp(req: Request): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

async function hashValueSha256(value: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface TurnstileVerifyOutcome {
  ok: boolean;
  status: number;
  error?: string;
}

async function verifyTurnstileTokenStrict(options: {
  token: string;
  secretKey: string;
  remoteIp: string;
  allowedHostnamesCsv?: string;
  fetchImpl: typeof fetch;
  nowMs: number;
  idempotencyKey: string;
}): Promise<TurnstileVerifyOutcome> {
  const { token, secretKey, remoteIp, allowedHostnamesCsv, fetchImpl, nowMs, idempotencyKey } = options;

  let resp: Response;
  try {
    const form = new URLSearchParams();
    form.set('secret', secretKey);
    form.set('response', token);
    form.set('idempotency_key', idempotencyKey);
    if (remoteIp && remoteIp !== 'unknown') {
      form.set('remoteip', remoteIp);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : undefined;

    try {
      resp = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: controller?.signal,
      });
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Unable to complete security verification right now. Please try again.',
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      status: 503,
      error: 'Security verification service is temporarily unavailable. Please try again.',
    };
  }

  let data: TurnstileSiteverifyResponse;
  try {
    data = (await resp.json()) as TurnstileSiteverifyResponse;
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Invalid response from security verification service.',
    };
  }

  if (data?.success !== true) {
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];

    // Never leak secret status or env variable names to callers
    if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
      return {
        ok: false,
        status: 500,
        error: 'Security verification service is temporarily unavailable.',
      };
    }

    if (codes.includes('timeout-or-duplicate')) {
      return {
        ok: false,
        status: 403,
        error: 'Verification token expired or already used. Please complete the challenge again.',
      };
    }

    if (codes.includes('missing-input-response')) {
      return {
        ok: false,
        status: 400,
        error: 'Please complete the security verification challenge before submitting.',
      };
    }

    return {
      ok: false,
      status: 403,
      error: 'Security verification failed. Please complete the challenge and try again.',
    };
  }

  // Freshness check: reject stale Turnstile tokens older than 5 minutes
  if (data.challenge_ts) {
    const challengeTimeMs = Date.parse(data.challenge_ts);
    if (Number.isFinite(challengeTimeMs) && nowMs - challengeTimeMs > TURNSTILE_MAX_AGE_MS) {
      return {
        ok: false,
        status: 403,
        error: 'Verification token has expired. Please complete the challenge again.',
      };
    }
  }

  // Optional strict hostname binding if TURNSTILE_ALLOWED_HOSTNAMES is configured
  const allowedList = (allowedHostnamesCsv || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowedList.length > 0) {
    const verifiedHost = (data.hostname || '').trim().toLowerCase();
    if (!verifiedHost || !allowedList.includes(verifiedHost)) {
      return {
        ok: false,
        status: 403,
        error: 'Security verification hostname mismatch. Please reload the page and try again.',
      };
    }
  }

  return { ok: true, status: 200 };
}

export async function handleRegisterSmsConsentRequest(
  req: Request,
  deps: RegisterSmsConsentDeps
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const fetchImpl = deps.fetchImpl || fetch;
  const nowMs = deps.nowMs || (() => Date.now());
  const randomUUID = deps.randomUUID || (() => crypto.randomUUID());

  const supabaseUrl = (deps.getEnv('SUPABASE_URL') || '').trim();
  const supabaseServiceRoleKey = (deps.getEnv('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  const hashSalt = (deps.getEnv('SMS_CONSENT_HASH_SALT') || '').trim() || 'novacode-sms-consent-v1';
  const turnstileSecret = (deps.getEnv('TURNSTILE_SECRET_KEY') || '').trim();
  const allowedHostnames = deps.getEnv('TURNSTILE_ALLOWED_HOSTNAMES');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ success: false, error: 'Server configuration incomplete.' }, 500);
  }

  const supabaseAdmin = deps.createAdminClient(supabaseUrl, supabaseServiceRoleKey);

  // ---------------------------------------------------------------------------
  // GET: Public Non-PII Business Lookup
  // ---------------------------------------------------------------------------
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const bizIdParam = url.searchParams.get('business_id') || url.searchParams.get('business');
    const slugParam = url.searchParams.get('slug');
    const parsedBizId = parsePositiveBigInt(bizIdParam);
    const cleanSlug = slugParam ? slugParam.trim().toLowerCase().slice(0, 120) : null;

    if (bizIdParam && parsedBizId === null) {
      return jsonResponse({ success: false, error: 'Invalid business identifier.' }, 400);
    }

    if (parsedBizId !== null || cleanSlug) {
      const { data, error } = await supabaseAdmin.rpc('get_public_sms_consent_business', {
        p_business_id: parsedBizId,
        p_slug: cleanSlug,
      });

      if (error) {
        return jsonResponse({ success: false, error: 'Unable to load business registration details.' }, 500);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return jsonResponse(
          { success: false, error: 'Business registration page not found or inactive.' },
          404
        );
      }

      return jsonResponse({
        success: true,
        business: {
          id: String(row.business_id),
          name: row.business_name,
          slug: row.business_slug || undefined,
          tagline: row.tagline || undefined,
          website: row.website || undefined,
          defaultLanguage: row.default_language === 'es' ? 'es' : 'en',
          smsOptInEnabled: row.sms_opt_in_enabled !== false,
          messagingApproved: row.messaging_approved === true,
          disclosureVersion: row.disclosure_version || DEFAULT_DISCLOSURE_VERSION,
        },
      });
    }

    const { data: listData, error: listErr } = await supabaseAdmin.rpc('get_public_sms_consent_businesses');
    if (listErr) {
      return jsonResponse({ success: false, error: 'Unable to load participating businesses.' }, 500);
    }

    const businesses = (Array.isArray(listData) ? listData : []).map((row: any) => ({
      id: String(row.business_id),
      name: row.business_name,
      slug: row.business_slug || undefined,
      smsOptInEnabled: true,
      messagingApproved: row.messaging_approved === true,
      disclosureVersion: row.disclosure_version || DEFAULT_DISCLOSURE_VERSION,
    }));

    return jsonResponse({
      success: true,
      businesses,
      business: businesses.length === 1 ? businesses[0] : null,
    });
  }

  // ---------------------------------------------------------------------------
  // POST: Mandatory Turnstile Verification + Hardened SMS Consent Persistence
  // ---------------------------------------------------------------------------
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  }

  // Fail closed if TURNSTILE_SECRET_KEY is not configured on the server
  if (!turnstileSecret) {
    return jsonResponse(
      { success: false, error: 'Security verification is not configured on the server.' },
      500
    );
  }

  let payload: SmsConsentSubmitPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON request body.' }, 400);
  }

  // 1. Honeypot & automated timing bot rejection
  const trapValue = (payload.honeypot || payload.companyWebsite || '').trim();
  if (trapValue.length > 0) {
    return jsonResponse({ success: false, error: 'Submission could not be processed.' }, 400);
  }

  if (typeof payload.formRenderedAtMs === 'number') {
    const elapsedMs = nowMs() - payload.formRenderedAtMs;
    if (elapsedMs >= 0 && elapsedMs < 500) {
      return jsonResponse(
        { success: false, error: 'Please wait a moment and review the SMS consent disclosure before submitting.' },
        400
      );
    }
  }

  // 2. Explicit consent validation
  if (payload.consentChecked !== true) {
    return jsonResponse(
      { success: false, error: 'You must check the SMS consent box to register.' },
      400
    );
  }

  // 3. Business identifier validation
  const businessId = parsePositiveBigInt(payload.businessId);
  if (businessId === null) {
    return jsonResponse(
      { success: false, error: 'A valid business must be selected before submitting.' },
      400
    );
  }

  // 4. Phone number normalization & validation
  const phoneCheck = normalizePhoneToE164(payload.phoneNumber || '');
  if (!phoneCheck.valid || !phoneCheck.e164) {
    return jsonResponse({ success: false, error: phoneCheck.error || 'Invalid phone number.' }, 400);
  }

  // 5. Require well-formed Turnstile token BEFORE contacting Siteverify or touching persistence
  const rawToken = typeof payload.turnstileToken === 'string' ? payload.turnstileToken.trim() : '';
  if (!rawToken) {
    return jsonResponse(
      { success: false, error: 'Please complete the security verification challenge before submitting.' },
      400
    );
  }
  if (rawToken.length < 10 || rawToken.length > 2048 || /\s/.test(rawToken)) {
    return jsonResponse(
      { success: false, error: 'Invalid security verification token. Please complete the challenge again.' },
      403
    );
  }

  // 6. Fast replay pre-check against server-side single-use token store
  const tokenHash = await hashValueSha256(rawToken, `turnstile:${hashSalt}`);
  if (typeof supabaseAdmin.from === 'function') {
    const { data: existingToken } = await supabaseAdmin
      .from('sms_turnstile_used_tokens')
      .select('token_hash')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (existingToken?.token_hash) {
      return jsonResponse(
        {
          success: false,
          error: 'Verification token has already been used. Please complete the challenge again.',
        },
        403
      );
    }
  }

  // 7. Mandatory server-side Cloudflare Turnstile Siteverify check
  const clientIp = extractClientIp(req);
  const verifyOutcome = await verifyTurnstileTokenStrict({
    token: rawToken,
    secretKey: turnstileSecret,
    remoteIp: clientIp,
    allowedHostnamesCsv: allowedHostnames,
    fetchImpl,
    nowMs: nowMs(),
    idempotencyKey: randomUUID(),
  });

  if (!verifyOutcome.ok) {
    return jsonResponse(
      { success: false, error: verifyOutcome.error || 'Security verification failed.' },
      verifyOutcome.status
    );
  }

  // 8. Persist atomically with single-use token hash claim & sliding-window rate limiting
  const cleanName = payload.customerName ? String(payload.customerName).trim().slice(0, 120) : null;
  const rawSource = (payload.consentSource || 'web_form').trim().toLowerCase();
  const cleanSource = VALID_CONSENT_SOURCES.has(rawSource) ? rawSource : 'web_form';
  const cleanVersion = (payload.disclosureVersion || DEFAULT_DISCLOSURE_VERSION).trim().slice(0, 40);
  const ipHash = clientIp !== 'unknown' ? await hashValueSha256(clientIp, hashSalt) : null;
  const userAgent = (req.headers.get('user-agent') || '').trim().slice(0, 512) || null;
  const pageUrl = payload.pageUrl ? String(payload.pageUrl).trim().slice(0, 1024) : null;

  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('submit_public_sms_consent', {
    p_business_id: businessId,
    p_phone_number: phoneCheck.e164,
    p_consent_given: true,
    p_turnstile_token_hash: tokenHash,
    p_customer_name: cleanName,
    p_consent_source: cleanSource,
    p_disclosure_version: cleanVersion,
    p_honeypot: null,
    p_ip_hash: ipHash,
    p_user_agent: userAgent,
    p_page_url: pageUrl,
    p_phone_raw: (payload.phoneNumber || '').trim().slice(0, 40),
  });

  if (rpcError) {
    const msg = rpcError.message || 'Unable to save SMS consent.';
    if (msg.includes('TURNSTILE_REUSED') || msg.includes('TURNSTILE_REQUIRED')) {
      return jsonResponse(
        {
          success: false,
          error: 'Verification token expired or already used. Please complete the challenge again.',
        },
        403
      );
    }
    if (msg.includes('RATE_LIMIT_EXCEEDED')) {
      return jsonResponse(
        { success: false, error: 'Too many submissions detected. Please wait 15 minutes before trying again.' },
        429
      );
    }
    if (msg.includes('BUSINESS_NOT_FOUND') || msg.includes('OPT_IN_DISABLED')) {
      return jsonResponse(
        { success: false, error: 'This business SMS consent registration is currently unavailable.' },
        404
      );
    }
    if (msg.includes('INVALID_PHONE') || msg.includes('CONSENT_REQUIRED') || msg.includes('SPAM_REJECTED')) {
      return jsonResponse(
        { success: false, error: msg.replace(/^[A-Z_]+:\s*/, '') },
        400
      );
    }
    return jsonResponse({ success: false, error: 'Unable to register SMS consent right now.' }, 500);
  }

  // Zero automatic outbound SMS is ever triggered here.
  return jsonResponse({
    success: true,
    record: {
      consentId: rpcResult.consent_id,
      businessId: String(rpcResult.business_id),
      businessName: rpcResult.business_name,
      phoneNumber: rpcResult.phone_number,
      consentTimestamp: rpcResult.consent_timestamp,
      consentDisclosureVersion: rpcResult.consent_disclosure_version,
      consentSource: rpcResult.consent_source,
      messagingApproved: rpcResult.messaging_approved === true,
    },
  });
}
