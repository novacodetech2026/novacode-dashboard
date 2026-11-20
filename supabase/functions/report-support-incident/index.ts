// Supabase Edge Function: report-support-incident
// Deploy with: supabase functions deploy report-support-incident
// Required secrets (server-side ONLY, never exposed in frontend):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// Optional secret for n8n / backend webhook callers:
//   INCIDENT_REPORT_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-incident-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_SOURCES = new Set([
  'business_report',
  'technical_error',
  'integration_failure',
  'security_alert',
]);

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

interface IncidentPayload {
  businessId?: number | string | null;
  businessName?: string | null;
  source?: string;
  severity?: string;
  title?: string;
  description?: string;
  errorCode?: string | null;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function parseOptionalBigInt(val?: number | string | null): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return Number.isSafeInteger(val) && val > 0 ? val : null;
  }
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    const num = Number(val.trim());
    return Number.isSafeInteger(num) && num > 0 ? num : null;
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed. Use POST.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret = Deno.env.get('INCIDENT_REPORT_SECRET');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      { success: false, error: 'Server configuration incomplete.' },
      500
    );
  }

  let payload: IncidentPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON payload.' }, 400);
  }

  const rawTitle = (payload.title || '').trim().slice(0, 200);
  if (!rawTitle) {
    return jsonResponse({ success: false, error: 'Incident title is required.' }, 400);
  }

  const rawDescription = (payload.description || '').trim().slice(0, 2000);
  const rawErrorCode = payload.errorCode ? String(payload.errorCode).trim().slice(0, 80) : null;
  const bizId = parseOptionalBigInt(payload.businessId);
  const rawBizName = payload.businessName ? String(payload.businessName).trim().slice(0, 120) : null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Verify caller identity:
  //    Path A: Trusted server-side / n8n caller presenting INCIDENT_REPORT_SECRET
  //    Path B: Authenticated app user presenting valid Supabase JWT
  const providedSecret = (req.headers.get('x-incident-secret') || '').trim();
  const isTrustedServerCaller =
    Boolean(webhookSecret) &&
    Boolean(providedSecret) &&
    constantTimeEquals(providedSecret, webhookSecret!);

  let reportedByUserId: string | null = null;
  let isSuperAdmin = false;

  if (!isTrustedServerCaller) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return jsonResponse({ success: false, error: 'Invalid or expired session.' }, 401);
    }

    reportedByUserId = user.id;

    const { data: superCheck } = await userClient.rpc('is_super_admin');
    isSuperAdmin = superCheck === true;

    // Non-Super-Admin authenticated sessions may only report incidents scoped to a business they actively belong to
    if (!isSuperAdmin && bizId !== null) {
      const { data: memberCheck, error: memberErr } = await userClient.rpc('is_business_member', {
        p_business_id: bizId,
      });

      // Fallback positional parameter check if signature parameter name differs
      if (memberErr) {
        const { data: bmRow } = await supabaseAdmin
          .from('business_members')
          .select('id')
          .eq('business_id', bizId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!bmRow) {
          return jsonResponse({ success: false, error: 'Forbidden: business membership required.' }, 403);
        }
      } else if (memberCheck !== true) {
        return jsonResponse({ success: false, error: 'Forbidden: active business membership required.' }, 403);
      }
    }
  }

  const normalizedSource =
    payload.source && VALID_SOURCES.has(payload.source)
      ? isTrustedServerCaller || isSuperAdmin
        ? payload.source
        : payload.source === 'security_alert' || payload.source === 'integration_failure'
        ? 'technical_error'
        : payload.source
      : isTrustedServerCaller
      ? 'integration_failure'
      : 'technical_error';

  const normalizedSeverity =
    payload.severity && VALID_SEVERITIES.has(payload.severity) ? payload.severity : 'medium';

  // 2. Deduplicate identical open incidents within the last 5 minutes
  const fiveMinutesAgoIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  let dupQuery = supabaseAdmin
    .from('support_incidents')
    .select('id')
    .eq('title', rawTitle)
    .eq('status', 'open')
    .gte('created_at', fiveMinutesAgoIso)
    .limit(1);

  dupQuery = bizId !== null ? dupQuery.eq('business_id', bizId) : dupQuery.is('business_id', null);

  const { data: existingDup } = await dupQuery.maybeSingle();
  if (existingDup?.id) {
    return jsonResponse({
      success: true,
      deduplicated: true,
      incidentId: existingDup.id,
    });
  }

  // 3. Persist technical incident (service_role only; trg_support_incident_after_insert notifies Super Admin)
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('support_incidents')
    .insert({
      business_id: bizId,
      business_name: rawBizName,
      reported_by: reportedByUserId,
      source: normalizedSource,
      severity: normalizedSeverity,
      status: 'open',
      title: rawTitle,
      description: rawDescription,
      error_code: rawErrorCode,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return jsonResponse(
      { success: false, error: insertErr?.message || 'Unable to record technical incident.' },
      500
    );
  }

  // Return ONLY incidentId (never return sensitive incident table details to non-admin callers)
  return jsonResponse({
    success: true,
    incidentId: inserted.id,
  });
});
