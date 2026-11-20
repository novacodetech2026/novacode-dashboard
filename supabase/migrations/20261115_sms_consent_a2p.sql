-- =============================================================================
-- NOVACODE TECH LLC — TWILIO A2P 10DLC SMS CONSENT REGISTRATION & MESSAGING CONFIG
-- Migration: 20261115_sms_consent_a2p.sql
--
-- REVIEW ONLY — APPLY VIA SUPABASE CLI OR STAGED SQL EDITOR AFTER REVIEW.
-- Preserves all existing booking RPCs (book_appointment, check_availability,
-- cancel_appointment, can_book_appointments), V3 Support System, Release A
-- Booking Notifications, customer records, and existing RLS policies.
--
-- SECURITY & COMPLIANCE GUARANTEES:
--   1. Multi-tenant isolation: every consent record & messaging config is scoped
--      to public.businesses(id) BIGINT.
--   2. Zero anonymous READ exposure: anon CANNOT SELECT from sms_consents,
--      sms_consent_rate_limits, or internal business_messaging_configs.
--   3. Abuse & spam protection: public submissions run exclusively through the
--      Edge Function (service_role) or hardened SECURITY DEFINER RPC
--      public.submit_public_sms_consent(...) which enforces honeypot rejection,
--      E.164 phone validation, explicit consent=true, active business check, and
--      sliding-window per-phone & per-IP rate limiting.
--   4. No automated outbound SMS until approved: business_messaging_configs
--      enforces CHECK (auto_send_enabled = FALSE OR a2p_status = 'approved').
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Pre-Flight Schema & Helper Checks
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_id_type TEXT;
BEGIN
    IF to_regclass('public.businesses') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.businesses table is required.';
    END IF;

    SELECT data_type INTO v_biz_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'id';

    IF v_biz_id_type IS DISTINCT FROM 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight check failed: expected public.businesses.id BIGINT, found %.',
            COALESCE(v_biz_id_type, 'missing');
    END IF;

    IF to_regprocedure('public.is_super_admin()') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.is_super_admin() function is required.';
    END IF;

    IF to_regprocedure('public.support_is_active_business_member(bigint)') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.support_is_active_business_member(bigint) function is required.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        RAISE EXCEPTION 'Pre-flight check failed: anon role does not exist.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION 'Pre-flight check failed: authenticated role does not exist.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'Pre-flight check failed: service_role does not exist.';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. Self-Contained Active Business Evaluator (Schema-Adaptive JSONB Check)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sms_is_business_row_active(p_biz_json JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_temp
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF p_biz_json IS NULL THEN
        RETURN FALSE;
    END IF;

    IF (p_biz_json ? 'deleted_at')
       AND NULLIF(TRIM(COALESCE(p_biz_json->>'deleted_at', '')), '') IS NOT NULL THEN
        RETURN FALSE;
    END IF;

    IF (p_biz_json ? 'is_active')
       AND COALESCE((p_biz_json->>'is_active')::boolean, FALSE) = FALSE THEN
        RETURN FALSE;
    END IF;

    IF (p_biz_json ? 'active')
       AND COALESCE((p_biz_json->>'active')::boolean, FALSE) = FALSE THEN
        RETURN FALSE;
    END IF;

    IF (p_biz_json ? 'status') THEN
        v_status := LOWER(TRIM(COALESCE(p_biz_json->>'status', '')));
        IF v_status <> '' AND v_status NOT IN ('active', 'enabled', 'live') THEN
            RETURN FALSE;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Business Messaging Configs (Gates Automated SMS Behind A2P 10DLC Approval)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_messaging_configs (
    business_id BIGINT PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    a2p_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (
        a2p_status IN ('not_configured', 'pending_approval', 'approved', 'rejected', 'suspended')
    ),
    sms_opt_in_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    auto_send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    consent_disclosure_version TEXT NOT NULL DEFAULT 'v1.0-2026-11-15' CHECK (
        LENGTH(TRIM(consent_disclosure_version)) BETWEEN 2 AND 40
    ),
    campaign_sid TEXT,
    messaging_service_sid TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sms_auto_send_requires_approval CHECK (
        auto_send_enabled = FALSE OR a2p_status = 'approved'
    )
);

-- Seed default pending_approval rows for existing businesses (auto_send_enabled = FALSE)
INSERT INTO public.business_messaging_configs (business_id)
SELECT b.id
FROM public.businesses b
ON CONFLICT (business_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. SMS Consents Table (Immutable A2P 10DLC Opt-In Audit Records)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name TEXT CHECK (customer_name IS NULL OR LENGTH(TRIM(customer_name)) <= 120),
    phone_number TEXT NOT NULL CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
    phone_raw TEXT CHECK (phone_raw IS NULL OR LENGTH(phone_raw) <= 40),
    consent_given BOOLEAN NOT NULL CHECK (consent_given = TRUE),
    consent_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consent_disclosure_version TEXT NOT NULL CHECK (LENGTH(TRIM(consent_disclosure_version)) BETWEEN 2 AND 40),
    consent_disclosure_text TEXT NOT NULL CHECK (LENGTH(TRIM(consent_disclosure_text)) >= 40),
    consent_source TEXT NOT NULL DEFAULT 'web_form' CHECK (
        consent_source IN ('web_form', 'qr_code', 'booking_widget', 'in_person', 'api')
    ),
    ip_hash TEXT CHECK (ip_hash IS NULL OR LENGTH(ip_hash) <= 128),
    user_agent TEXT CHECK (user_agent IS NULL OR LENGTH(user_agent) <= 512),
    page_url TEXT CHECK (page_url IS NULL OR LENGTH(page_url) <= 1024),
    status TEXT NOT NULL DEFAULT 'opted_in' CHECK (status IN ('opted_in', 'opted_out')),
    opted_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_consents_business_time
    ON public.sms_consents (business_id, consent_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sms_consents_business_phone_time
    ON public.sms_consents (business_id, phone_number, consent_timestamp DESC);

-- -----------------------------------------------------------------------------
-- 4. Sliding-Window Rate Limiting Table (No Public/Authenticated Direct Access)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_consent_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempt_count INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_consent_rate_limits_window
    ON public.sms_consent_rate_limits (window_started_at);

-- -----------------------------------------------------------------------------
-- 4b. Single-Use Turnstile Token Replay Store (Service-Role Only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_turnstile_used_tokens (
    token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_sms_turnstile_used_tokens_expires
    ON public.sms_turnstile_used_tokens (expires_at);

-- -----------------------------------------------------------------------------
-- 5. Updated-At Trigger for Messaging Configs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sms_config_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_temp
AS $$
BEGIN
    NEW.updated_at := NOW();
    IF NEW.a2p_status = 'approved' AND NEW.approved_at IS NULL THEN
        NEW.approved_at := NOW();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_messaging_configs_updated_at ON public.business_messaging_configs;
CREATE TRIGGER trg_business_messaging_configs_updated_at
    BEFORE UPDATE ON public.business_messaging_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_sms_config_set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Public Lookup RPCs (Returns ONLY Non-PII Business Display Fields)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_sms_consent_business(
    p_business_id BIGINT DEFAULT NULL,
    p_slug TEXT DEFAULT NULL
)
RETURNS TABLE (
    business_id BIGINT,
    business_name TEXT,
    business_slug TEXT,
    tagline TEXT,
    website TEXT,
    default_language TEXT,
    sms_opt_in_enabled BOOLEAN,
    messaging_approved BOOLEAN,
    disclosure_version TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_slug TEXT := NULLIF(LOWER(TRIM(COALESCE(p_slug, ''))), '');
BEGIN
    IF p_business_id IS NULL AND v_clean_slug IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        b.id AS business_id,
        COALESCE(NULLIF(TRIM(to_jsonb(b)->>'name'), ''), 'Business #' || b.id::TEXT) AS business_name,
        NULLIF(TRIM(to_jsonb(b)->>'slug'), '') AS business_slug,
        NULLIF(TRIM(to_jsonb(b)->>'tagline'), '') AS tagline,
        NULLIF(TRIM(to_jsonb(b)->>'website'), '') AS website,
        COALESCE(NULLIF(TRIM(to_jsonb(b)->>'default_language'), ''), 'en') AS default_language,
        COALESCE(mc.sms_opt_in_enabled, TRUE) AS sms_opt_in_enabled,
        COALESCE(mc.a2p_status = 'approved' AND mc.auto_send_enabled = TRUE, FALSE) AS messaging_approved,
        COALESCE(mc.consent_disclosure_version, 'v1.0-2026-11-15') AS disclosure_version
    FROM public.businesses b
    LEFT JOIN public.business_messaging_configs mc ON mc.business_id = b.id
    WHERE public.sms_is_business_row_active(to_jsonb(b))
      AND COALESCE(mc.sms_opt_in_enabled, TRUE) = TRUE
      AND (
          (p_business_id IS NOT NULL AND b.id = p_business_id)
          OR (
              p_business_id IS NULL
              AND v_clean_slug IS NOT NULL
              AND LOWER(TRIM(COALESCE(to_jsonb(b)->>'slug', ''))) = v_clean_slug
          )
      )
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_sms_consent_businesses()
RETURNS TABLE (
    business_id BIGINT,
    business_name TEXT,
    business_slug TEXT,
    messaging_approved BOOLEAN,
    disclosure_version TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id AS business_id,
        COALESCE(NULLIF(TRIM(to_jsonb(b)->>'name'), ''), 'Business #' || b.id::TEXT) AS business_name,
        NULLIF(TRIM(to_jsonb(b)->>'slug'), '') AS business_slug,
        COALESCE(mc.a2p_status = 'approved' AND mc.auto_send_enabled = TRUE, FALSE) AS messaging_approved,
        COALESCE(mc.consent_disclosure_version, 'v1.0-2026-11-15') AS disclosure_version
    FROM public.businesses b
    LEFT JOIN public.business_messaging_configs mc ON mc.business_id = b.id
    WHERE public.sms_is_business_row_active(to_jsonb(b))
      AND COALESCE(mc.sms_opt_in_enabled, TRUE) = TRUE
    ORDER BY COALESCE(NULLIF(TRIM(to_jsonb(b)->>'name'), ''), 'Business #' || b.id::TEXT) ASC
    LIMIT 50;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Hardened Server-Only Submission RPC (Turnstile Replay Lock + Rate Limit + Audit)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_public_sms_consent(
    BIGINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.submit_public_sms_consent(
    p_business_id BIGINT,
    p_phone_number TEXT,
    p_consent_given BOOLEAN,
    p_turnstile_token_hash TEXT,
    p_customer_name TEXT DEFAULT NULL,
    p_consent_source TEXT DEFAULT 'web_form',
    p_disclosure_version TEXT DEFAULT 'v1.0-2026-11-15',
    p_honeypot TEXT DEFAULT NULL,
    p_ip_hash TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_page_url TEXT DEFAULT NULL,
    p_phone_raw TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_biz_json JSONB;
    v_business_name TEXT;
    v_opt_in_enabled BOOLEAN;
    v_a2p_status TEXT;
    v_auto_send_enabled BOOLEAN;
    v_config_version TEXT;
    v_clean_token_hash TEXT;
    v_clean_phone TEXT;
    v_clean_name TEXT;
    v_clean_source TEXT;
    v_clean_version TEXT;
    v_disclosure_text TEXT;
    v_phone_bucket TEXT;
    v_ip_bucket TEXT;
    v_attempts INTEGER;
    v_now TIMESTAMPTZ := NOW();
    v_consent_id UUID;
    v_consented_at TIMESTAMPTZ;
BEGIN
    -- 1. Honeypot spam rejection
    IF NULLIF(TRIM(COALESCE(p_honeypot, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'SPAM_REJECTED: Automated submission rejected.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 2. Explicit opt-in consent requirement
    IF p_consent_given IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'CONSENT_REQUIRED: Explicit SMS consent is required before submitting.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 3. Validate target business exists, is active, and allows SMS opt-in
    IF p_business_id IS NULL OR p_business_id <= 0 THEN
        RAISE EXCEPTION 'INVALID_BUSINESS: A valid business identifier is required.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT
        to_jsonb(b),
        COALESCE(mc.sms_opt_in_enabled, TRUE),
        COALESCE(mc.a2p_status, 'pending_approval'),
        COALESCE(mc.auto_send_enabled, FALSE),
        COALESCE(mc.consent_disclosure_version, 'v1.0-2026-11-15')
    INTO
        v_biz_json,
        v_opt_in_enabled,
        v_a2p_status,
        v_auto_send_enabled,
        v_config_version
    FROM public.businesses b
    LEFT JOIN public.business_messaging_configs mc ON mc.business_id = b.id
    WHERE b.id = p_business_id
    LIMIT 1;

    IF v_biz_json IS NULL OR NOT public.sms_is_business_row_active(v_biz_json) THEN
        RAISE EXCEPTION 'BUSINESS_NOT_FOUND: This business registration page is unavailable.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_opt_in_enabled IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'OPT_IN_DISABLED: SMS opt-in registration is currently disabled for this business.'
            USING ERRCODE = 'P0001';
    END IF;

    v_business_name := COALESCE(NULLIF(TRIM(v_biz_json->>'name'), ''), 'Business #' || p_business_id::TEXT);

    -- 4. Validate and normalize E.164 phone number
    v_clean_phone := regexp_replace(TRIM(COALESCE(p_phone_number, '')), '[\s\-\(\)\.]+', '', 'g');
    IF v_clean_phone ~ '^[0-9]{10}$' THEN
        v_clean_phone := '+1' || v_clean_phone;
    ELSIF v_clean_phone ~ '^1[0-9]{10}$' THEN
        v_clean_phone := '+' || v_clean_phone;
    END IF;

    IF v_clean_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
        RAISE EXCEPTION 'INVALID_PHONE: Please provide a valid phone number including country or area code.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Reject obviously synthetic repeated-digit numbers or invalid NANP +1 area codes (e.g., +10000000000)
    IF substring(v_clean_phone FROM 2) ~ '^([0-9])\1+$'
       OR (
           v_clean_phone ~ '^\+1[0-9]{10}$'
           AND (v_clean_phone !~ '^\+1[2-9][0-9]{9}$' OR substring(v_clean_phone FROM 3) ~ '^([0-9])\1+$')
       ) THEN
        RAISE EXCEPTION 'INVALID_PHONE: Please provide a valid reachable phone number.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 5. Sanitize optional metadata & source allowlist
    v_clean_name := NULLIF(LEFT(TRIM(COALESCE(p_customer_name, '')), 120), '');
    v_clean_source := LOWER(TRIM(COALESCE(p_consent_source, 'web_form')));
    IF v_clean_source NOT IN ('web_form', 'qr_code', 'booking_widget', 'in_person', 'api') THEN
        v_clean_source := 'web_form';
    END IF;

    v_clean_version := COALESCE(NULLIF(LEFT(TRIM(COALESCE(p_disclosure_version, '')), 40), ''), v_config_version);

    -- 6. DB-side sliding-window rate limiting (per-phone + optional per-IP hash, 15-minute window)
    v_phone_bucket := 'phone:' || p_business_id::TEXT || ':' || v_clean_phone;
    INSERT INTO public.sms_consent_rate_limits (bucket_key, window_started_at, attempt_count, updated_at)
    VALUES (v_phone_bucket, v_now, 1, v_now)
    ON CONFLICT (bucket_key) DO UPDATE
    SET
        window_started_at = CASE
            WHEN public.sms_consent_rate_limits.window_started_at < v_now - INTERVAL '15 minutes'
                THEN v_now
            ELSE public.sms_consent_rate_limits.window_started_at
        END,
        attempt_count = CASE
            WHEN public.sms_consent_rate_limits.window_started_at < v_now - INTERVAL '15 minutes'
                THEN 1
            ELSE public.sms_consent_rate_limits.attempt_count + 1
        END,
        updated_at = v_now
    RETURNING attempt_count INTO v_attempts;

    IF v_attempts > 3 THEN
        RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED: Too many consent attempts for this phone number. Please wait 15 minutes.'
            USING ERRCODE = 'P0001';
    END IF;

    IF NULLIF(TRIM(COALESCE(p_ip_hash, '')), '') IS NOT NULL THEN
        v_ip_bucket := 'ip:' || p_business_id::TEXT || ':' || LEFT(TRIM(p_ip_hash), 64);
        INSERT INTO public.sms_consent_rate_limits (bucket_key, window_started_at, attempt_count, updated_at)
        VALUES (v_ip_bucket, v_now, 1, v_now)
        ON CONFLICT (bucket_key) DO UPDATE
        SET
            window_started_at = CASE
                WHEN public.sms_consent_rate_limits.window_started_at < v_now - INTERVAL '15 minutes'
                    THEN v_now
                ELSE public.sms_consent_rate_limits.window_started_at
            END,
            attempt_count = CASE
                WHEN public.sms_consent_rate_limits.window_started_at < v_now - INTERVAL '15 minutes'
                    THEN 1
                ELSE public.sms_consent_rate_limits.attempt_count + 1
            END,
            updated_at = v_now
        RETURNING attempt_count INTO v_attempts;

        IF v_attempts > 12 THEN
            RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED: Too many submissions from this network. Please wait before trying again.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Opportunistic cleanup of expired buckets and expired Turnstile hashes older than 24 hours
    DELETE FROM public.sms_consent_rate_limits
    WHERE window_started_at < v_now - INTERVAL '24 hours';

    DELETE FROM public.sms_turnstile_used_tokens
    WHERE expires_at < v_now;

    -- 7. Require & atomically claim single-use server-verified Turnstile token hash
    v_clean_token_hash := LOWER(TRIM(COALESCE(p_turnstile_token_hash, '')));
    IF v_clean_token_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'TURNSTILE_REQUIRED: Verified Turnstile token digest is required.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.sms_turnstile_used_tokens (token_hash, business_id, used_at, expires_at)
    VALUES (v_clean_token_hash, p_business_id, v_now, v_now + INTERVAL '24 hours')
    ON CONFLICT (token_hash) DO NOTHING;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TURNSTILE_REUSED: Security verification token has already been used. Please complete the challenge again.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 8. Build exact verbatim Twilio A2P 10DLC disclosure snapshot
    v_disclosure_text :=
        'By checking this box, I agree to receive conversational and appointment-related SMS messages from '
        || v_business_name
        || ', powered by Novacode Tech LLC, at the phone number provided. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is not a condition of purchase.';

    -- 9. Insert immutable consent record (never triggers outbound SMS)
    INSERT INTO public.sms_consents (
        business_id,
        customer_name,
        phone_number,
        phone_raw,
        consent_given,
        consent_timestamp,
        consent_disclosure_version,
        consent_disclosure_text,
        consent_source,
        ip_hash,
        user_agent,
        page_url,
        status
    )
    VALUES (
        p_business_id,
        v_clean_name,
        v_clean_phone,
        NULLIF(LEFT(TRIM(COALESCE(p_phone_raw, '')), 40), ''),
        TRUE,
        v_now,
        v_clean_version,
        v_disclosure_text,
        v_clean_source,
        NULLIF(LEFT(TRIM(COALESCE(p_ip_hash, '')), 128), ''),
        NULLIF(LEFT(TRIM(COALESCE(p_user_agent, '')), 512), ''),
        NULLIF(LEFT(TRIM(COALESCE(p_page_url, '')), 1024), ''),
        'opted_in'
    )
    RETURNING id, consent_timestamp
    INTO v_consent_id, v_consented_at;

    RETURN jsonb_build_object(
        'success', TRUE,
        'consent_id', v_consent_id,
        'business_id', p_business_id,
        'business_name', v_business_name,
        'phone_number', v_clean_phone,
        'consent_timestamp', v_consented_at,
        'consent_disclosure_version', v_clean_version,
        'consent_source', v_clean_source,
        'messaging_approved', (v_a2p_status = 'approved' AND v_auto_send_enabled = TRUE)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Enable Row Level Security & Least-Privilege Grants
-- -----------------------------------------------------------------------------
ALTER TABLE public.business_messaging_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_consent_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_turnstile_used_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_messaging_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.business_messaging_configs TO authenticated;
GRANT ALL ON TABLE public.business_messaging_configs TO service_role;

REVOKE ALL ON TABLE public.sms_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sms_consents TO authenticated;
GRANT ALL ON TABLE public.sms_consents TO service_role;

REVOKE ALL ON TABLE public.sms_consent_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sms_consent_rate_limits TO service_role;

REVOKE ALL ON TABLE public.sms_turnstile_used_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sms_turnstile_used_tokens TO service_role;

-- Messaging configs policies: readable by active business members & super admin; writable only by super_admin / service_role
DROP POLICY IF EXISTS messaging_configs_select_member ON public.business_messaging_configs;
CREATE POLICY messaging_configs_select_member
    ON public.business_messaging_configs
    FOR SELECT
    TO authenticated
    USING (public.support_is_active_business_member(business_id));

DROP POLICY IF EXISTS messaging_configs_select_super_admin ON public.business_messaging_configs;
CREATE POLICY messaging_configs_select_super_admin
    ON public.business_messaging_configs
    FOR SELECT
    TO authenticated
    USING (public.is_super_admin());

DROP POLICY IF EXISTS messaging_configs_admin_manage ON public.business_messaging_configs;
CREATE POLICY messaging_configs_admin_manage
    ON public.business_messaging_configs
    FOR ALL
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- SMS consents policies: tenant-scoped SELECT ONLY for active business members & Super Admin (ZERO anon SELECT)
DROP POLICY IF EXISTS sms_consents_select_member ON public.sms_consents;
CREATE POLICY sms_consents_select_member
    ON public.sms_consents
    FOR SELECT
    TO authenticated
    USING (public.support_is_active_business_member(business_id));

DROP POLICY IF EXISTS sms_consents_select_super_admin ON public.sms_consents;
CREATE POLICY sms_consents_select_super_admin
    ON public.sms_consents
    FOR SELECT
    TO authenticated
    USING (public.is_super_admin());

-- Function execution grants
REVOKE ALL ON FUNCTION public.sms_is_business_row_active(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_is_business_row_active(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.get_public_sms_consent_business(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_sms_consent_business(BIGINT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_public_sms_consent_businesses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_sms_consent_businesses() TO anon, authenticated, service_role;

-- Strictly server-only (service_role) so Turnstile verification in Edge Function cannot be bypassed
REVOKE ALL ON FUNCTION public.submit_public_sms_consent(
    BIGINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_sms_consent(
    BIGINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMIT;

-- =============================================================================
-- STAGING VERIFICATION SUITE (COMMENTED — RUN IN STAGING TRANSACTION ONLY)
-- =============================================================================
/*
BEGIN;

-- 1. Verify anon cannot read sms_consents or call submit_public_sms_consent directly
SET LOCAL ROLE anon;
DO $$
DECLARE
    v_blocked_select BOOLEAN := FALSE;
    v_blocked_rpc BOOLEAN := FALSE;
    v_dummy_hash TEXT := repeat('a', 64);
BEGIN
    BEGIN
        PERFORM 1 FROM public.sms_consents LIMIT 1;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked_select := TRUE;
    END;
    IF NOT v_blocked_select THEN
        RAISE EXCEPTION 'TEST FAILED: anon unexpectedly read public.sms_consents';
    END IF;

    BEGIN
        PERFORM public.submit_public_sms_consent(1, '+15552345678', TRUE, v_dummy_hash);
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked_rpc := TRUE;
    END;
    IF NOT v_blocked_rpc THEN
        RAISE EXCEPTION 'TEST FAILED: anon unexpectedly bypassed Edge Function to call submit_public_sms_consent';
    END IF;
END $$;
RESET ROLE;

-- 2. Verify explicit consent = FALSE is rejected even under service_role
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_biz_id BIGINT;
    v_blocked BOOLEAN := FALSE;
    v_hash TEXT := repeat('b', 64);
BEGIN
    SELECT business_id INTO v_biz_id FROM public.get_public_sms_consent_businesses() LIMIT 1;
    IF v_biz_id IS NOT NULL THEN
        BEGIN
            PERFORM public.submit_public_sms_consent(v_biz_id, '+15552345678', FALSE, v_hash, 'Test User');
        EXCEPTION
            WHEN raise_exception THEN
                v_blocked := TRUE;
        END;
        IF NOT v_blocked THEN
            RAISE EXCEPTION 'TEST FAILED: consent=false should be rejected';
        END IF;
    END IF;
END $$;
RESET ROLE;

-- 3. Verify valid service_role submission persists AND token replay is rejected
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_biz_id BIGINT;
    v_res JSONB;
    v_hash TEXT := repeat('c', 64);
    v_replay_blocked BOOLEAN := FALSE;
BEGIN
    SELECT business_id INTO v_biz_id FROM public.get_public_sms_consent_businesses() LIMIT 1;
    IF v_biz_id IS NOT NULL THEN
        v_res := public.submit_public_sms_consent(
            p_business_id => v_biz_id,
            p_phone_number => '(555) 234-5678',
            p_consent_given => TRUE,
            p_turnstile_token_hash => v_hash,
            p_customer_name => 'Staging Verifier',
            p_consent_source => 'web_form',
            p_disclosure_version => 'v1.0-2026-11-15'
        );
        IF (v_res->>'success')::BOOLEAN IS DISTINCT FROM TRUE
           OR (v_res->>'phone_number') <> '+15552345678'
           OR (v_res->>'messaging_approved')::BOOLEAN IS NOT FALSE THEN
            RAISE EXCEPTION 'TEST FAILED: unexpected submit_public_sms_consent payload: %', v_res;
        END IF;

        BEGIN
            PERFORM public.submit_public_sms_consent(
                p_business_id => v_biz_id,
                p_phone_number => '(555) 234-5679',
                p_consent_given => TRUE,
                p_turnstile_token_hash => v_hash,
                p_customer_name => 'Replay Attacker'
            );
        EXCEPTION
            WHEN raise_exception THEN
                IF SQLERRM LIKE '%TURNSTILE_REUSED%' THEN
                    v_replay_blocked := TRUE;
                END IF;
        END;
        IF NOT v_replay_blocked THEN
            RAISE EXCEPTION 'TEST FAILED: reused Turnstile token hash should be rejected';
        END IF;
    END IF;
END $$;
RESET ROLE;

ROLLBACK;
*/
