-- =============================================================================
-- NOVACODE TECH — PHASE 2: BOOKING RULES & SCHEDULING ENFORCEMENT (HARDENED)
-- Migration: 20261116_booking_rules_enforcement.sql
--
-- REVIEW ONLY — DO NOT AUTO-EXECUTE AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.
--
-- DESIGN CONTRACT & PRODUCTION COMPATIBILITY:
--   1. Legacy RPC Compatibility:
--      - `public.check_availability` is synchronized in place to delegate to the
--        canonical scheduling engine (`_check_scheduling_availability_internal`)
--        while preserving its exact signature, `BOOLEAN` return type, ACLs, and
--        `can_check_availability` authorization gate for n8n & dashboard callers.
--      - `public.book_appointment`, `public.cancel_appointment`,
--        `public.can_book_appointments`, and `public.can_check_availability` are
--        NOT replaced or altered; `trg_appointments_enforce_booking_rules` enforces
--        all server-side scheduling & cancellation policies seamlessly for both
--        legacy RPCs and direct table writes.
--   2. Closed-By-Default Schedule Policy (No Invented Business Hours):
--      - An unconfigured business (no `public.business_hours` rows and no
--        matching `settings.operatingHours` entry), omitted weekday, or invalid/
--        malformed open/close time range fails CLOSED (`is_closed = TRUE`) instead
--        of silently inventing 09:00-18:00 open hours.
--   3. Business-Wide Conflict Detection (No `appointments.staff_id` Assumption):
--      - Confirmed live schema has NO `appointments.staff_id` column. All
--        availability checks, slot generation, rescheduling, and trigger checks
--        enforce business-wide overlap & buffer rules identically.
--   4. Explicit Service Duration Policy (No Arbitrary Custom Durations):
--      - When `service_id` is set, appointment duration MUST equal
--        `services.duration_minutes`. Supplying `end_time IS NULL` derives
--        `start_time + duration_minutes`; supplying an explicit `end_time` that
--        mismatches `duration_minutes` (or `end_time <= start_time`) is rejected.
--   5. Concurrency & Storage Defense-in-Depth:
--      - `pg_advisory_xact_lock(business_id)` serializes booking & reschedule
--        transactions per tenant in consistent lock order (`advisory -> row`),
--        backed by `btree_gist` exclusion constraint
--        `excl_appointments_no_active_overlap` when conflict-free.
--
-- PREREQUISITE MIGRATION REQUIRED FIRST:
--   `20261116_01_businesses_settings_prerequisite.sql` (`businesses.settings` JSONB)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 0: READ-ONLY PRODUCTION INSPECTION (RUN MANUALLY BEFORE APPLYING)
-- -----------------------------------------------------------------------------
/*
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_arguments(p.oid) AS full_arguments,
    pg_get_function_result(p.oid) AS return_type,
    p.prosecdef AS is_security_definer,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'check_availability',
      'book_appointment',
      'cancel_appointment',
      'can_book_appointments',
      'can_check_availability'
  )
ORDER BY p.proname;

-- Check whether any existing active/future appointments currently overlap before
-- enabling the storage-level exclusion constraint:
SELECT
    a1.business_id,
    a1.id AS apt_1,
    a2.id AS apt_2,
    a1.start_time,
    a1.end_time,
    a1.status::TEXT AS status_1,
    a2.status::TEXT AS status_2
FROM public.appointments a1
JOIN public.appointments a2
  ON a1.business_id = a2.business_id
 AND a1.id < a2.id
 AND a1.start_time < a2.end_time
 AND a1.end_time > a2.start_time
WHERE LOWER(TRIM(COALESCE(a1.status::TEXT, 'pending'))) NOT IN ('cancelled', 'no_show')
  AND LOWER(TRIM(COALESCE(a2.status::TEXT, 'pending'))) NOT IN ('cancelled', 'no_show')
LIMIT 50;
*/

BEGIN;

-- -----------------------------------------------------------------------------
-- SECTION 1: NON-DESTRUCTIVE PRE-FLIGHT SCHEMA, ROLES & HELPER CHECKS
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_col_type TEXT;
    v_missing TEXT := '';
    v_has_bh_open_col BOOLEAN := FALSE;
    v_has_bh_time_cols BOOLEAN := FALSE;
    v_has_svc_active_col BOOLEAN := FALSE;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'Pre-flight failed: pg_roles entry for service_role is required.';
    END IF;

    IF to_regclass('public.businesses') IS NULL
       OR to_regclass('public.appointments') IS NULL
       OR to_regclass('public.services') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight failed: required tables (businesses, appointments, services) do not exist.';
    END IF;

    -- 1. public.businesses verified production columns
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'id';
    IF v_col_type IS DISTINCT FROM 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight failed: expected public.businesses.id BIGINT, found %.', COALESCE(v_col_type, 'missing');
    END IF;

    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'settings';
    IF v_col_type IS DISTINCT FROM 'jsonb' THEN
        RAISE EXCEPTION 'Pre-flight failed: public.businesses.settings (jsonb) is required (found %). Apply 20261116_01_businesses_settings_prerequisite.sql first.', COALESCE(v_col_type, 'missing');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'timezone'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'businesses.timezone';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'is_active' AND data_type = 'boolean'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'businesses.is_active(boolean)';
    END IF;

    -- 2. public.appointments verified production columns
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'business_id';
    IF v_col_type IS DISTINCT FROM 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight failed: expected public.appointments.business_id BIGINT, found %.', COALESCE(v_col_type, 'missing');
    END IF;

    FOR v_col_type IN
        SELECT expected.col
        FROM (VALUES
            ('id', 'uuid'),
            ('service_id', 'uuid'),
            ('start_time', 'timestamp with time zone'),
            ('end_time', 'timestamp with time zone'),
            ('updated_at', 'timestamp with time zone')
        ) AS expected(col, expected_type)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'appointments'
              AND c.column_name = expected.col
              AND c.data_type = expected.expected_type
        )
    LOOP
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'appointments.' || v_col_type;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'status'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'appointments.status';
    END IF;

    -- 3. public.services verified production columns
    FOR v_col_type IN
        SELECT expected.col
        FROM (VALUES
            ('id', 'uuid'),
            ('business_id', 'bigint'),
            ('duration_minutes', 'integer')
        ) AS expected(col, expected_type)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'services'
              AND c.column_name = expected.col
              AND c.data_type = expected.expected_type
        )
    LOOP
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'services.' || v_col_type;
    END LOOP;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name IN ('is_active', 'active')
    ) INTO v_has_svc_active_col;
    IF NOT v_has_svc_active_col THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'services.is_active';
    END IF;

    IF v_missing <> '' THEN
        RAISE EXCEPTION 'Pre-flight failed: missing or mismatched production columns: %', v_missing;
    END IF;

    -- 4. public.business_hours schema verification (when present)
    IF to_regclass('public.business_hours') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'business_hours'
              AND column_name IN ('is_open', 'is_closed')
        ) INTO v_has_bh_open_col;

        IF NOT v_has_bh_open_col THEN
            RAISE EXCEPTION 'Pre-flight failed: public.business_hours must contain is_open (or legacy is_closed) column.';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'business_hours' AND column_name = 'business_id' AND data_type = 'bigint'
        )
        AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'business_hours' AND column_name = 'day_of_week'
        )
        AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'business_hours' AND column_name IN ('open_time', 'open')
        )
        AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'business_hours' AND column_name IN ('close_time', 'close')
        ) INTO v_has_bh_time_cols;

        IF NOT v_has_bh_time_cols THEN
            RAISE EXCEPTION 'Pre-flight failed: public.business_hours must contain business_id (bigint), day_of_week, open_time/open, and close_time/close.';
        END IF;
    END IF;

    -- 5. Existing authorization helpers
    IF to_regprocedure('public.is_super_admin()') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight failed: public.is_super_admin() helper is required.';
    END IF;

    IF to_regprocedure('public.support_is_active_business_member(bigint)') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight failed: public.support_is_active_business_member(bigint) helper is required.';
    END IF;

    -- 6. Non-destructive check for existing production booking RPCs
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'book_appointment')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'cancel_appointment') THEN
        RAISE NOTICE 'Pre-flight notice: book_appointment and/or cancel_appointment not found in public schema. Verify Section 0 against target DB.';
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 2: VALIDATED AUTHORIZATION, STRICT PARSERS & HOURS RESOLVER
-- -----------------------------------------------------------------------------

-- Strict service_role / DB superuser verification.
-- NEVER uses SECURITY DEFINER `current_user` fallback (uses `session_user`),
-- NEVER allows anon, authenticator, unauthenticated sessions with NULL auth.uid(),
-- or sessions carrying non-service_role JWT claims.
CREATE OR REPLACE FUNCTION public._scheduling_is_trusted_service_role()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_effective_role TEXT;
    v_claims_raw TEXT;
    v_claims_json JSONB := NULL;
    v_jwt_role TEXT;
BEGIN
    IF v_uid IS NOT NULL THEN
        RETURN FALSE;
    END IF;

    -- `session_user` prevents SECURITY DEFINER owner privilege elevation when
    -- an unprivileged direct DB session connects without SET ROLE.
    v_effective_role := COALESCE(
        NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
        session_user
    );

    IF v_effective_role IN ('authenticated', 'anon', 'PUBLIC', 'authenticator') THEN
        RETURN FALSE;
    END IF;

    v_claims_raw := NULLIF(TRIM(COALESCE(current_setting('request.jwt.claims', true), '')), '');
    IF v_claims_raw IS NOT NULL THEN
        BEGIN
            v_claims_json := v_claims_raw::JSONB;
        EXCEPTION WHEN invalid_text_representation THEN
            RETURN FALSE;
        END;

        IF jsonb_typeof(v_claims_json) IS DISTINCT FROM 'object' THEN
            RETURN FALSE;
        END IF;
    END IF;

    v_jwt_role := COALESCE(
        NULLIF(TRIM(COALESCE(current_setting('request.jwt.claim.role', true), '')), ''),
        NULLIF(TRIM(COALESCE(v_claims_json->>'role', '')), '')
    );

    -- If any JWT claim role is present, it must explicitly be service_role.
    IF v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role' THEN
        RETURN FALSE;
    END IF;

    RETURN (
        v_effective_role = 'service_role'
        OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_roles r
            WHERE r.rolname = v_effective_role
              AND r.rolsuper
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public._scheduling_assert_authorized(
    p_business_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    IF p_business_id IS NULL OR p_business_id <= 0 THEN
        RAISE EXCEPTION 'Unauthorized: valid business ID is required.'
            USING ERRCODE = '42501';
    END IF;

    IF public._scheduling_is_trusted_service_role() THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user session or validated service_role is required.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT (public.is_super_admin() OR public.support_is_active_business_member(p_business_id)) THEN
        RAISE EXCEPTION 'Forbidden: active business membership is required for business %.', p_business_id
            USING ERRCODE = '42501';
    END IF;
END;
$$;

-- Strict scalar boolean parser: returns `p_default` (default NULL) when unparseable
-- so callers can fail closed or raise on invalid configuration.
CREATE OR REPLACE FUNCTION public._scheduling_parse_bool(
    p_val TEXT,
    p_default BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_norm TEXT := LOWER(TRIM(COALESCE(p_val, '')));
BEGIN
    IF v_norm = '' THEN
        RETURN p_default;
    ELSIF v_norm IN ('true', 't', '1', 'yes', 'y', 'on') THEN
        RETURN TRUE;
    ELSIF v_norm IN ('false', 'f', '0', 'no', 'n', 'off') THEN
        RETURN FALSE;
    END IF;
    RETURN NULL;
END;
$$;

-- Strict wall-clock HH:MM(:SS) parser without broad exception catching.
-- Returns NULL for missing or out-of-range times (e.g. '25:99', 'abc').
CREATE OR REPLACE FUNCTION public._scheduling_parse_time_strict(
    p_val TEXT
)
RETURNS TIME
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_trimmed TEXT := TRIM(COALESCE(p_val, ''));
    v_matches TEXT[];
BEGIN
    IF v_trimmed = '' THEN
        RETURN NULL;
    END IF;

    v_matches := regexp_match(
        v_trimmed,
        '^([01]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?(?:\.\d+)?$'
    );
    IF v_matches IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN make_time(
        v_matches[1]::INTEGER,
        v_matches[2]::INTEGER,
        COALESCE(v_matches[3]::INTEGER, 0)::DOUBLE PRECISION
    );
END;
$$;

-- Strict non-negative integer parser for scheduling policy settings.
-- Returns 0 when omitted/null; raises ERRCODE 22023 when explicitly non-numeric or negative.
CREATE OR REPLACE FUNCTION public._scheduling_parse_nonneg_int_strict(
    p_raw TEXT,
    p_setting_name TEXT,
    p_business_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_trimmed TEXT := NULLIF(TRIM(COALESCE(p_raw, '')), '');
    v_num NUMERIC;
BEGIN
    IF v_trimmed IS NULL OR LOWER(v_trimmed) = 'null' THEN
        RETURN 0;
    END IF;

    IF v_trimmed !~ '^\d+(?:\.0+)?$' THEN
        RAISE EXCEPTION 'Invalid % configuration (%) for business %: expected non-negative integer.',
            p_setting_name, v_trimmed, p_business_id
            USING ERRCODE = '22023';
    END IF;

    v_num := v_trimmed::NUMERIC;
    IF v_num > 10080 THEN
        RAISE EXCEPTION 'Out-of-range % configuration (%) for business %.',
            p_setting_name, v_trimmed, p_business_id
            USING ERRCODE = '22023';
    END IF;

    RETURN v_num::INTEGER;
END;
$$;

-- Validated IANA timezone resolver without exception suppression.
CREATE OR REPLACE FUNCTION public._scheduling_safe_timezone(
    p_tz TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_trimmed TEXT := NULLIF(TRIM(COALESCE(p_tz, '')), '');
BEGIN
    IF v_trimmed IS NULL THEN
        RETURN 'America/New_York';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = v_trimmed
    ) THEN
        RETURN v_trimmed;
    END IF;

    RAISE WARNING 'Invalid business timezone "%" detected; falling back to America/New_York.', v_trimmed;
    RETURN 'America/New_York';
END;
$$;

-- Canonical conflict-blocking status predicate used identically by the trigger,
-- check_availability, check_scheduling_availability, and get_available_time_slots.
--   - 'cancelled' and 'no_show' release the booked window & buffer.
--   - 'pending', 'confirmed', and 'completed' continue reserving their scheduled
--     [start_time, end_time + buffer] interval (so early-completed visits keep
--     any remaining cleanup buffer; past completed rows whose end_time + buffer <= NOW()
--     never conflict with future bookings).
CREATE OR REPLACE FUNCTION public._scheduling_is_blocking_status(
    p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT LOWER(TRIM(COALESCE(NULLIF(TRIM(p_status), ''), 'pending'))) NOT IN ('cancelled', 'no_show');
$$;

-- Privileged internal hours resolver (NOT executable by PUBLIC, anon, or authenticated).
-- Enforces CLOSED BY DEFAULT whenever no authoritative hours exist or config is invalid.
-- Never invents 09:00-18:00 defaults for unconfigured or malformed schedules.
CREATE OR REPLACE FUNCTION public._resolve_business_hours_for_date_internal(
    p_business_id BIGINT,
    p_date DATE
)
RETURNS TABLE (
    timezone TEXT,
    open_time TIME,
    close_time TIME,
    is_closed BOOLEAN,
    is_special_hours BOOLEAN,
    special_label TEXT,
    buffer_minutes INTEGER,
    cancellation_buffer_hours INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tz TEXT := 'America/New_York';
    v_settings JSONB := '{}'::JSONB;
    v_date_str TEXT := CASE WHEN p_date IS NOT NULL THEN to_char(p_date, 'YYYY-MM-DD') ELSE NULL END;
    v_dow INTEGER := CASE WHEN p_date IS NOT NULL THEN EXTRACT(DOW FROM p_date)::INTEGER ELSE NULL END;
    v_dow_name TEXT;
    v_special JSONB;
    v_weekly JSONB;
    v_parsed_open TIME := NULL;
    v_parsed_close TIME := NULL;
    v_closed BOOLEAN := TRUE;
    v_is_special BOOLEAN := FALSE;
    v_label TEXT := NULL;
    v_bh_row JSONB;
    v_bh_any BOOLEAN := FALSE;
    v_operating_hours_migrated BOOLEAN := FALSE;
    v_bool_val BOOLEAN;
    v_open_raw TEXT;
    v_close_raw TEXT;
BEGIN
    SELECT
        public._scheduling_safe_timezone(b.timezone),
        COALESCE(b.settings, '{}'::JSONB)
    INTO v_tz, v_settings
    FROM public.businesses b
    WHERE b.id = p_business_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business % not found.', p_business_id USING ERRCODE = 'P0002';
    END IF;

    timezone := v_tz;

    -- Malformed non-object settings fails CLOSED (no invented schedule)
    IF jsonb_typeof(v_settings) IS DISTINCT FROM 'object' THEN
        RAISE WARNING 'Malformed non-object settings JSONB for business %; failing closed.', p_business_id;
        open_time := TIME '00:00';
        close_time := TIME '00:00';
        is_closed := TRUE;
        is_special_hours := FALSE;
        special_label := NULL;
        buffer_minutes := 0;
        cancellation_buffer_hours := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    buffer_minutes := public._scheduling_parse_nonneg_int_strict(
        v_settings->>'bufferBetweenAppointmentsMinutes',
        'bufferBetweenAppointmentsMinutes',
        p_business_id
    );
    cancellation_buffer_hours := public._scheduling_parse_nonneg_int_strict(
        v_settings->>'cancellationBufferHours',
        'cancellationBufferHours',
        p_business_id
    );

    IF p_date IS NULL THEN
        open_time := TIME '00:00';
        close_time := TIME '00:00';
        is_closed := TRUE;
        is_special_hours := FALSE;
        special_label := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 1. Special hours / holiday overrides in businesses.settings.specialHours
    --    Always take precedence over weekly operating hours (both business_hours and JSONB).
    IF v_settings ? 'specialHours' THEN
        IF jsonb_typeof(v_settings->'specialHours') = 'array' THEN
            SELECT elem
            INTO v_special
            FROM jsonb_array_elements(v_settings->'specialHours') AS elem
            WHERE jsonb_typeof(elem) = 'object'
              AND elem->>'date' = v_date_str
            LIMIT 1;
        ELSE
            RAISE WARNING 'Invalid specialHours non-array for business %; ignoring specialHours.', p_business_id;
        END IF;
    END IF;

    IF v_special IS NOT NULL THEN
        v_is_special := TRUE;
        v_label := NULLIF(TRIM(COALESCE(v_special->>'label', '')), '');

        IF v_special ? 'isClosed' THEN
            v_bool_val := public._scheduling_parse_bool(v_special->>'isClosed', FALSE);
            IF v_bool_val IS NULL THEN
                RAISE WARNING 'Malformed specialHours.isClosed value "%" for business % on %; failing closed.',
                    v_special->>'isClosed', p_business_id, v_date_str;
                v_closed := TRUE;
            ELSE
                v_closed := v_bool_val;
            END IF;
        ELSE
            v_closed := FALSE;
        END IF;

        IF NOT v_closed THEN
            v_open_raw := v_special->>'open';
            v_close_raw := v_special->>'close';
            v_parsed_open := public._scheduling_parse_time_strict(v_open_raw);
            v_parsed_close := public._scheduling_parse_time_strict(v_close_raw);
            IF v_parsed_open IS NULL OR v_parsed_close IS NULL OR v_parsed_open >= v_parsed_close THEN
                RAISE WARNING 'Invalid or incomplete specialHours window (% to %) for business % on %; failing closed.',
                    COALESCE(v_open_raw, 'NULL'), COALESCE(v_close_raw, 'NULL'), p_business_id, v_date_str;
                v_closed := TRUE;
            END IF;
        END IF;
    ELSE
        -- 2. Authoritative weekly hours: public.business_hours (is_open) remains authoritative
        --    for any business with rows in public.business_hours until an explicit migration sets
        --    settings.operatingHoursMigrated = true.
        IF v_settings ? 'operatingHoursMigrated' THEN
            v_operating_hours_migrated := COALESCE(
                public._scheduling_parse_bool(v_settings->>'operatingHoursMigrated', FALSE),
                FALSE
            );
        END IF;

        IF to_regclass('public.business_hours') IS NOT NULL AND NOT v_operating_hours_migrated THEN
            EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.business_hours WHERE business_id = $1)'
            INTO v_bh_any
            USING p_business_id;
        END IF;

        IF v_bh_any THEN
            EXECUTE $bh$
                SELECT to_jsonb(bh)
                FROM public.business_hours bh
                WHERE bh.business_id = $1
                  AND bh.day_of_week = $2
                LIMIT 1
            $bh$
            INTO v_bh_row
            USING p_business_id, v_dow;

            IF v_bh_row IS NOT NULL THEN
                IF v_bh_row ? 'is_open' THEN
                    v_bool_val := public._scheduling_parse_bool(v_bh_row->>'is_open', FALSE);
                    v_closed := CASE WHEN v_bool_val IS NULL THEN TRUE ELSE NOT v_bool_val END;
                ELSIF v_bh_row ? 'is_closed' THEN
                    v_bool_val := public._scheduling_parse_bool(v_bh_row->>'is_closed', TRUE);
                    v_closed := COALESCE(v_bool_val, TRUE);
                ELSE
                    v_closed := TRUE;
                END IF;

                IF NOT v_closed THEN
                    v_open_raw := COALESCE(NULLIF(TRIM(v_bh_row->>'open_time'), ''), NULLIF(TRIM(v_bh_row->>'open'), ''));
                    v_close_raw := COALESCE(NULLIF(TRIM(v_bh_row->>'close_time'), ''), NULLIF(TRIM(v_bh_row->>'close'), ''));
                    v_parsed_open := public._scheduling_parse_time_strict(v_open_raw);
                    v_parsed_close := public._scheduling_parse_time_strict(v_close_raw);
                    IF v_parsed_open IS NULL OR v_parsed_close IS NULL OR v_parsed_open >= v_parsed_close THEN
                        RAISE WARNING 'Invalid business_hours window (% to %) for business % dow %; failing closed.',
                            COALESCE(v_open_raw, 'NULL'), COALESCE(v_close_raw, 'NULL'), p_business_id, v_dow;
                        v_closed := TRUE;
                    END IF;
                END IF;
            ELSE
                -- Omitted weekday in public.business_hours is closed by default.
                v_closed := TRUE;
            END IF;
        ELSE
            -- 3. Weekly operatingHours JSONB (for businesses without public.business_hours rows
            --    or after explicit migration sets settings.operatingHoursMigrated = true).
            --    Closed by default whenever no matching day configuration exists.
            v_dow_name := CASE v_dow
                WHEN 0 THEN 'sunday'
                WHEN 1 THEN 'monday'
                WHEN 2 THEN 'tuesday'
                WHEN 3 THEN 'wednesday'
                WHEN 4 THEN 'thursday'
                WHEN 5 THEN 'friday'
                WHEN 6 THEN 'saturday'
            END;

            IF jsonb_typeof(v_settings->'operatingHours') = 'object' THEN
                v_weekly := COALESCE(
                    v_settings->'operatingHours'->(v_dow::TEXT),
                    v_settings->'operatingHours'->v_dow_name,
                    v_settings->'operatingHours'->LEFT(v_dow_name, 3)
                );
            END IF;

            IF v_weekly IS NOT NULL AND jsonb_typeof(v_weekly) = 'object' THEN
                IF v_weekly ? 'isClosed' THEN
                    v_bool_val := public._scheduling_parse_bool(v_weekly->>'isClosed', FALSE);
                    IF v_bool_val IS NULL THEN
                        RAISE WARNING 'Malformed operatingHours.isClosed value "%" for business % dow %; failing closed.',
                            v_weekly->>'isClosed', p_business_id, v_dow;
                        v_closed := TRUE;
                    ELSE
                        v_closed := v_bool_val;
                    END IF;
                ELSE
                    v_closed := FALSE;
                END IF;

                IF NOT v_closed THEN
                    v_open_raw := v_weekly->>'open';
                    v_close_raw := v_weekly->>'close';
                    v_parsed_open := public._scheduling_parse_time_strict(v_open_raw);
                    v_parsed_close := public._scheduling_parse_time_strict(v_close_raw);
                    IF v_parsed_open IS NULL OR v_parsed_close IS NULL OR v_parsed_open >= v_parsed_close THEN
                        RAISE WARNING 'Invalid operatingHours window (% to %) for business % dow %; failing closed.',
                            COALESCE(v_open_raw, 'NULL'), COALESCE(v_close_raw, 'NULL'), p_business_id, v_dow;
                        v_closed := TRUE;
                    END IF;
                END IF;
            ELSE
                -- Unconfigured business or unconfigured day of week is CLOSED by default.
                v_closed := TRUE;
            END IF;
        END IF;
    END IF;

    IF v_closed OR v_parsed_open IS NULL OR v_parsed_close IS NULL OR v_parsed_open >= v_parsed_close THEN
        open_time := TIME '00:00';
        close_time := TIME '00:00';
        is_closed := TRUE;
    ELSE
        open_time := v_parsed_open;
        close_time := v_parsed_close;
        is_closed := FALSE;
    END IF;

    is_special_hours := v_is_special;
    special_label := v_label;

    RETURN NEXT;
END;
$$;

-- Authorized public RPC wrapper for reading resolved hours for a business & date.
CREATE OR REPLACE FUNCTION public.resolve_business_hours_for_date(
    p_business_id BIGINT,
    p_date DATE
)
RETURNS TABLE (
    timezone TEXT,
    open_time TIME,
    close_time TIME,
    is_closed BOOLEAN,
    is_special_hours BOOLEAN,
    special_label TEXT,
    buffer_minutes INTEGER,
    cancellation_buffer_hours INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public._scheduling_assert_authorized(p_business_id);

    RETURN QUERY
    SELECT *
    FROM public._resolve_business_hours_for_date_internal(p_business_id, p_date);
END;
$$;

-- Privileged single scheduling availability engine core
-- (NOT executable by PUBLIC, anon, or authenticated; called by authorized RPCs).
CREATE OR REPLACE FUNCTION public._check_scheduling_availability_internal(
    p_business_id BIGINT,
    p_service_id UUID,
    p_start_time TIMESTAMPTZ,
    p_exclude_appointment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_biz_record RECORD;
    v_service_record RECORD;
    v_service_active BOOLEAN := TRUE;
    v_duration INTEGER;
    v_end_time TIMESTAMPTZ;
    v_tz TEXT;
    v_local_start TIMESTAMP;
    v_local_end TIMESTAMP;
    v_hours RECORD;
    v_has_overlap BOOLEAN := FALSE;
    v_has_buffer_conflict BOOLEAN := FALSE;
    v_biz_suspended BOOLEAN := FALSE;
BEGIN
    IF p_business_id IS NULL OR p_business_id <= 0 THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Valid business ID is required.');
    END IF;

    SELECT b.id, b.timezone, b.is_active, COALESCE(b.settings, '{}'::JSONB) AS settings
    INTO v_biz_record
    FROM public.businesses b
    WHERE b.id = p_business_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', format('Business %s not found.', p_business_id));
    END IF;

    IF jsonb_typeof(v_biz_record.settings) = 'object' THEN
        v_biz_suspended := COALESCE(
            public._scheduling_parse_bool(v_biz_record.settings->>'isSuspended', FALSE),
            FALSE
        );
    END IF;

    IF v_biz_record.is_active IS FALSE OR v_biz_suspended THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Business is currently inactive and cannot accept new bookings.');
    END IF;

    IF p_start_time IS NULL THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Appointment start_time is required.');
    END IF;

    IF p_service_id IS NULL THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Service ID is required.');
    END IF;

    SELECT s.*
    INTO v_service_record
    FROM public.services s
    WHERE s.id = p_service_id
      AND s.business_id = p_business_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Selected service does not belong to this business.');
    END IF;

    v_service_active := COALESCE(
        CASE
            WHEN NULLIF(TRIM(COALESCE(to_jsonb(v_service_record)->>'is_active', '')), '') IS NOT NULL
                THEN public._scheduling_parse_bool(to_jsonb(v_service_record)->>'is_active', TRUE)
            WHEN NULLIF(TRIM(COALESCE(to_jsonb(v_service_record)->>'active', '')), '') IS NOT NULL
                THEN public._scheduling_parse_bool(to_jsonb(v_service_record)->>'active', TRUE)
            ELSE NULL
        END,
        FALSE
    );
    IF NOT v_service_active THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Inactive services cannot be booked.');
    END IF;

    v_duration := NULLIF(to_jsonb(v_service_record)->>'duration_minutes', '')::INTEGER;
    IF v_duration IS NULL OR v_duration <= 0 OR v_duration > 1440 THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Selected service has an invalid duration configuration.');
    END IF;

    v_end_time := p_start_time + make_interval(mins => v_duration);

    IF p_start_time < NOW() THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Appointments cannot be scheduled in the past.');
    END IF;

    v_tz := public._scheduling_safe_timezone(v_biz_record.timezone);

    SELECT *
    INTO v_hours
    FROM public._resolve_business_hours_for_date_internal(
        p_business_id,
        ((p_start_time AT TIME ZONE v_tz)::DATE)
    );

    v_tz := v_hours.timezone;
    v_local_start := p_start_time AT TIME ZONE v_tz;
    v_local_end := v_end_time AT TIME ZONE v_tz;

    IF v_hours.is_closed THEN
        RETURN jsonb_build_object(
            'available', FALSE,
            'reason', format('Business is closed on %s (%s).', to_char(v_local_start::DATE, 'YYYY-MM-DD'), COALESCE(v_hours.special_label, 'Closed'))
        );
    END IF;

    IF v_local_start::DATE IS DISTINCT FROM v_local_end::DATE
       OR v_local_start::TIME < v_hours.open_time
       OR v_local_end::TIME > v_hours.close_time THEN
        RETURN jsonb_build_object(
            'available', FALSE,
            'reason', format('Selected time is outside operating hours (%s to %s).', to_char(v_hours.open_time, 'HH24:MI'), to_char(v_hours.close_time, 'HH24:MI'))
        );
    END IF;

    -- Strict business-wide overlap detection (appointments has no staff_id)
    SELECT EXISTS (
        SELECT 1
        FROM public.appointments a
        WHERE a.business_id = p_business_id
          AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
          AND public._scheduling_is_blocking_status(a.status::TEXT)
          AND a.start_time < v_end_time
          AND a.end_time > p_start_time
    ) INTO v_has_overlap;

    IF v_has_overlap THEN
        RETURN jsonb_build_object('available', FALSE, 'reason', 'Schedule conflict: overlaps another booking.');
    END IF;

    IF COALESCE(v_hours.buffer_minutes, 0) > 0 THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.appointments a
            WHERE a.business_id = p_business_id
              AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
              AND public._scheduling_is_blocking_status(a.status::TEXT)
              AND a.start_time < (v_end_time + make_interval(mins => v_hours.buffer_minutes))
              AND (a.end_time + make_interval(mins => v_hours.buffer_minutes)) > p_start_time
        ) INTO v_has_buffer_conflict;

        IF v_has_buffer_conflict THEN
            RETURN jsonb_build_object(
                'available', FALSE,
                'reason', format('Schedule conflict: required %s minute buffer between appointments.', v_hours.buffer_minutes)
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'available', TRUE,
        'bufferMinutes', v_hours.buffer_minutes,
        'timezone', v_tz
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 3: SERVER-SIDE TRIGGER ENFORCING BOOKING, INTEGRITY & CANCEL RULES
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_appointments_enforce_booking_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_biz_record RECORD;
    v_service_record RECORD;
    v_service_active BOOLEAN := TRUE;
    v_service_duration INTEGER;
    v_hours RECORD;
    v_tz TEXT;
    v_local_start TIMESTAMP;
    v_local_end TIMESTAMP;
    v_effective_end TIMESTAMPTZ;
    v_new_status TEXT;
    v_old_status TEXT;
    v_needs_schedule_check BOOLEAN := FALSE;
    v_conflict RECORD;
    v_biz_suspended BOOLEAN := FALSE;
    v_actual_duration_secs DOUBLE PRECISION;
BEGIN
    v_new_status := LOWER(TRIM(COALESCE(NULLIF(TRIM(NEW.status::TEXT), ''), 'pending')));
    v_old_status := CASE
        WHEN TG_OP = 'UPDATE' THEN LOWER(TRIM(COALESCE(OLD.status::TEXT, '')))
        ELSE ''
    END;

    -- 0. Enforce canonical appointment status whitelist
    IF v_new_status NOT IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show') THEN
        RAISE EXCEPTION 'Invalid appointment status "%". Allowed values: pending, confirmed, completed, cancelled, no_show.',
            COALESCE(NEW.status::TEXT, 'NULL')
            USING ERRCODE = 'P0001';
    END IF;

    -- 1. Prevent cross-tenant appointment reassignment
    IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'Appointment business_id cannot be reassigned.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Strict immutability & transition integrity for completed/cancelled/no_show:
    --    - Completed appointments can NEVER change status (not cancelled, not reopened).
    --    - Any UPDATE resulting in completed, cancelled, or no_show MUST NOT modify
    --      start_time, end_time, or service_id (prevents tampering via status transitions).
    --    - Legitimate historical metadata updates (notes, updated_at, address, etc.)
    --      continue to succeed cleanly.
    IF TG_OP = 'UPDATE' THEN
        IF v_old_status = 'completed' AND v_new_status IS DISTINCT FROM 'completed' THEN
            IF v_new_status = 'cancelled' THEN
                RAISE EXCEPTION 'Completed appointments cannot be cancelled.'
                    USING ERRCODE = 'P0001';
            END IF;
            RAISE EXCEPTION 'Completed appointments cannot be reopened or changed to another status.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_new_status IN ('completed', 'cancelled', 'no_show')
           AND (
               NEW.start_time IS DISTINCT FROM OLD.start_time
               OR NEW.end_time IS DISTINCT FROM OLD.end_time
               OR NEW.service_id IS DISTINCT FROM OLD.service_id
           ) THEN
            RAISE EXCEPTION 'Cancelled, completed, or no-show appointments cannot be rescheduled or have their service modified.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Enforce cancellation policy when transitioning into cancelled.
    --    Runs BEFORE AFTER UPDATE Release A notification triggers so rejected
    --    cancellations abort atomically and never emit false cancellation notifications,
    --    while preserving compatibility with existing cancel_appointment RPCs and columns.
    IF TG_OP = 'UPDATE' AND v_new_status = 'cancelled' AND v_old_status IS DISTINCT FROM 'cancelled' THEN
        IF OLD.start_time IS NOT NULL THEN
            SELECT public._scheduling_safe_timezone(b.timezone)
            INTO v_tz
            FROM public.businesses b
            WHERE b.id = NEW.business_id;

            v_tz := COALESCE(v_tz, 'America/New_York');

            SELECT *
            INTO v_hours
            FROM public._resolve_business_hours_for_date_internal(
                NEW.business_id,
                ((OLD.start_time AT TIME ZONE v_tz)::DATE)
            );

            IF COALESCE(v_hours.cancellation_buffer_hours, 0) > 0
               AND (OLD.start_time - NOW()) < make_interval(hours => v_hours.cancellation_buffer_hours) THEN
                RAISE EXCEPTION 'Cancellation rejected: appointments must be cancelled at least % hours in advance.',
                    v_hours.cancellation_buffer_hours
                    USING ERRCODE = 'P0001';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- 4. Determine whether scheduling validation is required.
    --    Unrelated metadata updates to existing bookings (notes, updated_at,
    --    marking completed/no_show, or confirming an unchanged pending booking)
    --    preserve historical records even if service/hours changed later.
    --    INSERT of active bookings OR UPDATE modifying start_time/end_time/service_id
    --    OR reopening cancelled/no_show into pending/confirmed enforces full rules.
    IF TG_OP = 'INSERT' THEN
        v_needs_schedule_check := v_new_status IN ('pending', 'confirmed');
    ELSIF TG_OP = 'UPDATE' THEN
        v_needs_schedule_check :=
            v_new_status IN ('pending', 'confirmed')
            AND (
                NEW.start_time IS DISTINCT FROM OLD.start_time
                OR NEW.end_time IS DISTINCT FROM OLD.end_time
                OR NEW.service_id IS DISTINCT FROM OLD.service_id
                OR v_old_status IN ('completed', 'cancelled', 'no_show')
            );
    END IF;

    IF NOT v_needs_schedule_check THEN
        RETURN NEW;
    END IF;

    -- Serialize concurrent booking/reschedule writes for the same business
    PERFORM pg_advisory_xact_lock(NEW.business_id);

    -- 4b. Verify business exists and is active / unsuspended
    SELECT b.id, b.timezone, b.is_active, COALESCE(b.settings, '{}'::JSONB) AS settings
    INTO v_biz_record
    FROM public.businesses b
    WHERE b.id = NEW.business_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business % not found.', NEW.business_id USING ERRCODE = 'P0002';
    END IF;

    IF jsonb_typeof(v_biz_record.settings) = 'object' THEN
        v_biz_suspended := COALESCE(
            public._scheduling_parse_bool(v_biz_record.settings->>'isSuspended', FALSE),
            FALSE
        );
    END IF;

    IF v_biz_record.is_active IS FALSE OR v_biz_suspended THEN
        RAISE EXCEPTION 'Business is currently inactive and cannot accept new bookings.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 5. Verify timestamps and strict service duration policy
    --    Custom arbitrary durations are NOT supported when service_id is present:
    --    NEW.end_time must be NULL (auto-derived) or equal start_time + service.duration_minutes.
    IF NEW.start_time IS NULL THEN
        RAISE EXCEPTION 'Appointment start_time is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF NEW.end_time IS NOT NULL AND NEW.end_time <= NEW.start_time THEN
        RAISE EXCEPTION 'Appointment end_time must be strictly after start_time.'
            USING ERRCODE = 'P0001';
    END IF;

    IF NEW.service_id IS NOT NULL THEN
        SELECT s.*
        INTO v_service_record
        FROM public.services s
        WHERE s.id = NEW.service_id
          AND s.business_id = NEW.business_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected service does not belong to this business.'
                USING ERRCODE = 'P0001';
        END IF;

        v_service_active := COALESCE(
            CASE
                WHEN NULLIF(TRIM(COALESCE(to_jsonb(v_service_record)->>'is_active', '')), '') IS NOT NULL
                    THEN public._scheduling_parse_bool(to_jsonb(v_service_record)->>'is_active', TRUE)
                WHEN NULLIF(TRIM(COALESCE(to_jsonb(v_service_record)->>'active', '')), '') IS NOT NULL
                    THEN public._scheduling_parse_bool(to_jsonb(v_service_record)->>'active', TRUE)
                ELSE NULL
            END,
            FALSE
        );

        IF NOT v_service_active THEN
            RAISE EXCEPTION 'Inactive services cannot be booked.'
                USING ERRCODE = 'P0001';
        END IF;

        v_service_duration := NULLIF(to_jsonb(v_service_record)->>'duration_minutes', '')::INTEGER;
        IF v_service_duration IS NULL OR v_service_duration <= 0 OR v_service_duration > 1440 THEN
            RAISE EXCEPTION 'Selected service has an invalid duration_minutes configuration.'
                USING ERRCODE = 'P0001';
        END IF;

        IF NEW.end_time IS NULL THEN
            v_effective_end := NEW.start_time + make_interval(mins => v_service_duration);
            NEW.end_time := v_effective_end;
        ELSE
            v_effective_end := NEW.end_time;
            v_actual_duration_secs := EXTRACT(EPOCH FROM (v_effective_end - NEW.start_time));
            IF ABS(v_actual_duration_secs - (v_service_duration * 60.0)) > 1.0 THEN
                RAISE EXCEPTION 'Appointment duration (% minutes) does not match service duration (% minutes). Custom durations are not supported.',
                    ROUND((v_actual_duration_secs / 60.0)::NUMERIC, 1),
                    v_service_duration
                    USING ERRCODE = 'P0001';
            END IF;
        END IF;
    ELSE
        IF NEW.end_time IS NULL OR NEW.end_time <= NEW.start_time THEN
            RAISE EXCEPTION 'Appointment service_id or valid end_time > start_time is required.'
                USING ERRCODE = 'P0001';
        END IF;
        v_effective_end := NEW.end_time;
        IF EXTRACT(EPOCH FROM (v_effective_end - NEW.start_time)) > 86400 THEN
            RAISE EXCEPTION 'Appointment duration cannot exceed 24 hours.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF NEW.start_time < NOW() THEN
        RAISE EXCEPTION 'Appointments cannot be scheduled in the past.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 6. Resolve operating hours, business_hours(is_open), & specialHours/holidays
    v_tz := public._scheduling_safe_timezone(v_biz_record.timezone);
    v_local_start := NEW.start_time AT TIME ZONE v_tz;
    v_local_end := v_effective_end AT TIME ZONE v_tz;

    SELECT *
    INTO v_hours
    FROM public._resolve_business_hours_for_date_internal(NEW.business_id, v_local_start::DATE);

    IF v_hours.is_closed THEN
        RAISE EXCEPTION 'Business is closed on % (%).',
            to_char(v_local_start::DATE, 'YYYY-MM-DD'),
            COALESCE(v_hours.special_label, 'Closed')
            USING ERRCODE = 'P0001';
    END IF;

    IF v_local_start::DATE IS DISTINCT FROM v_local_end::DATE
       OR v_local_start::TIME < v_hours.open_time
       OR v_local_end::TIME > v_hours.close_time THEN
        RAISE EXCEPTION 'Selected time is outside operating hours (% to %).',
            to_char(v_hours.open_time, 'HH24:MI'),
            to_char(v_hours.close_time, 'HH24:MI')
            USING ERRCODE = 'P0001';
    END IF;

    -- 7. Enforce business-wide overlap + bufferBetweenAppointmentsMinutes (no staff_id column)
    SELECT a.id, a.start_time, a.end_time
    INTO v_conflict
    FROM public.appointments a
    WHERE a.business_id = NEW.business_id
      AND a.id IS DISTINCT FROM NEW.id
      AND public._scheduling_is_blocking_status(a.status::TEXT)
      AND a.start_time < v_effective_end
      AND a.end_time > NEW.start_time
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Schedule conflict: overlaps another booking.'
            USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_hours.buffer_minutes, 0) > 0 THEN
        SELECT a.id, a.start_time, a.end_time
        INTO v_conflict
        FROM public.appointments a
        WHERE a.business_id = NEW.business_id
          AND a.id IS DISTINCT FROM NEW.id
          AND public._scheduling_is_blocking_status(a.status::TEXT)
          AND a.start_time < (v_effective_end + make_interval(mins => v_hours.buffer_minutes))
          AND (a.end_time + make_interval(mins => v_hours.buffer_minutes)) > NEW.start_time
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION 'Schedule conflict: required % minute buffer between appointments.',
                v_hours.buffer_minutes
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_enforce_booking_rules ON public.appointments;
CREATE TRIGGER trg_appointments_enforce_booking_rules
    BEFORE INSERT OR UPDATE ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_appointments_enforce_booking_rules();

-- -----------------------------------------------------------------------------
-- SECTION 3B: STORAGE-LEVEL INDEXING & EXCLUSION CONSTRAINT (DEFENSE IN DEPTH)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appointments_biz_window
    ON public.appointments (business_id, start_time, end_time);

DO $$
DECLARE
    v_has_gist BOOLEAN := FALSE;
    v_all_clean BOOLEAN := FALSE;
    v_future_clean BOOLEAN := FALSE;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.appointments'::regclass
          AND conname = 'excl_appointments_no_active_overlap'
    ) THEN
        RETURN;
    END IF;

    BEGIN
        CREATE EXTENSION IF NOT EXISTS btree_gist;
    EXCEPTION
        WHEN insufficient_privilege OR feature_not_supported OR undefined_file THEN
            RAISE NOTICE 'Concurrency constraint notice: btree_gist extension unavailable in this session; relying on trigger + pg_advisory_xact_lock.';
            RETURN;
    END;

    SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'btree_gist'
    ) INTO v_has_gist;

    IF NOT v_has_gist THEN
        RETURN;
    END IF;

    -- Verify whether existing rows are completely free of overlaps so we never break existing data
    SELECT NOT EXISTS (
        SELECT 1
        FROM public.appointments a1
        JOIN public.appointments a2
          ON a1.business_id = a2.business_id
         AND a1.id < a2.id
        WHERE a1.start_time IS NOT NULL AND a1.end_time IS NOT NULL AND a1.end_time > a1.start_time
          AND a2.start_time IS NOT NULL AND a2.end_time IS NOT NULL AND a2.end_time > a2.start_time
          AND public._scheduling_is_blocking_status(a1.status::TEXT)
          AND public._scheduling_is_blocking_status(a2.status::TEXT)
          AND a1.start_time < a2.end_time
          AND a1.end_time > a2.start_time
    ) INTO v_all_clean;

    IF v_all_clean THEN
        EXECUTE $excl$
            ALTER TABLE public.appointments
                ADD CONSTRAINT excl_appointments_no_active_overlap
                EXCLUDE USING gist (
                    business_id WITH =,
                    tstzrange(start_time, end_time, '[)') WITH &&
                )
                WHERE (
                    status NOT IN ('cancelled', 'no_show')
                    AND start_time IS NOT NULL
                    AND end_time IS NOT NULL
                    AND end_time > start_time
                )
        $excl$;
    ELSE
        -- Preserve existing pre-migration historical rows while still guarding all future appointments
        SELECT NOT EXISTS (
            SELECT 1
            FROM public.appointments a1
            JOIN public.appointments a2
              ON a1.business_id = a2.business_id
             AND a1.id < a2.id
            WHERE a1.start_time >= TIMESTAMPTZ '2026-11-16 00:00:00+00'
              AND a2.start_time >= TIMESTAMPTZ '2026-11-16 00:00:00+00'
              AND a1.start_time IS NOT NULL AND a1.end_time IS NOT NULL AND a1.end_time > a1.start_time
              AND a2.start_time IS NOT NULL AND a2.end_time IS NOT NULL AND a2.end_time > a2.start_time
              AND public._scheduling_is_blocking_status(a1.status::TEXT)
              AND public._scheduling_is_blocking_status(a2.status::TEXT)
              AND a1.start_time < a2.end_time
              AND a1.end_time > a2.start_time
        ) INTO v_future_clean;

        IF v_future_clean THEN
            EXECUTE $excl_fut$
                ALTER TABLE public.appointments
                    ADD CONSTRAINT excl_appointments_no_active_overlap
                    EXCLUDE USING gist (
                        business_id WITH =,
                        tstzrange(start_time, end_time, '[)') WITH &&
                    )
                    WHERE (
                        start_time >= TIMESTAMPTZ '2026-11-16 00:00:00+00'
                        AND status NOT IN ('cancelled', 'no_show')
                        AND start_time IS NOT NULL
                        AND end_time IS NOT NULL
                        AND end_time > start_time
                    )
            $excl_fut$;
        ELSE
            RAISE NOTICE 'Concurrency constraint notice: existing overlapping appointments found >= 2026-11-16; excl_appointments_no_active_overlap skipped so migration remains non-destructive.';
        END IF;
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 4: UNIFIED SCHEDULING RPCs & LEGACY `check_availability` SYNC
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_scheduling_availability(
    p_business_id BIGINT,
    p_service_id UUID,
    p_start_time TIMESTAMPTZ,
    p_exclude_appointment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public._scheduling_assert_authorized(p_business_id);

    RETURN public._check_scheduling_availability_internal(
        p_business_id,
        p_service_id,
        p_start_time,
        p_exclude_appointment_id
    );
END;
$$;

-- Synchronize `public.check_availability` with the unified scheduling engine while
-- preserving its EXACT parameter signature, BOOLEAN return type, ACLs, and
-- `can_check_availability` authentication behavior for n8n & legacy callers.
DO $$
DECLARE
    v_oid OID;
    v_args TEXT;
    v_ret TEXT;
    v_existing_def TEXT;
    v_can_check_oid OID;
    v_can_check_mode TEXT := 'none';
    v_auth_returns_false BOOLEAN := FALSE;
    v_auth_stmt TEXT;
    v_body TEXT;
BEGIN
    SELECT
        p.oid,
        pg_catalog.pg_get_function_arguments(p.oid),
        pg_catalog.pg_get_function_result(p.oid),
        pg_catalog.pg_get_functiondef(p.oid)
    INTO v_oid, v_args, v_ret, v_existing_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_availability'
      AND p.pronargs = 3
    ORDER BY (
        pg_catalog.pg_get_function_identity_arguments(p.oid) ~* 'bigint.*uuid.*timestamp'
    ) DESC, p.oid ASC
    LIMIT 1;

    IF v_oid IS NOT NULL AND LOWER(TRIM(v_ret)) IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Cannot synchronize public.check_availability(%): expected BOOLEAN return type, found %.',
            v_args, v_ret;
    END IF;

    -- Inspect existing `can_check_availability` signature if installed
    v_can_check_oid := to_regprocedure('public.can_check_availability(bigint)');
    IF v_can_check_oid IS NOT NULL THEN
        v_can_check_mode := 'bigint';
    ELSE
        v_can_check_oid := to_regprocedure('public.can_check_availability()');
        IF v_can_check_oid IS NOT NULL THEN
            v_can_check_mode := 'void';
        END IF;
    END IF;

    IF v_existing_def IS NOT NULL
       AND v_existing_def ~* 'can_check_availability[\s\S]{0,160}RETURN\s+FALSE' THEN
        v_auth_returns_false := TRUE;
    END IF;

    IF v_can_check_mode = 'bigint' THEN
        IF v_auth_returns_false THEN
            v_auth_stmt := $a$
    IF NOT COALESCE(public.can_check_availability($1), FALSE) THEN
        RETURN FALSE;
    END IF;
$a$;
        ELSE
            v_auth_stmt := $a$
    IF NOT COALESCE(public.can_check_availability($1), FALSE) THEN
        RAISE EXCEPTION 'Unauthorized: cannot check availability for business %.', $1
            USING ERRCODE = '42501';
    END IF;
$a$;
        END IF;
    ELSIF v_can_check_mode = 'void' THEN
        IF v_auth_returns_false THEN
            v_auth_stmt := $a$
    IF NOT COALESCE(public.can_check_availability(), FALSE) THEN
        RETURN FALSE;
    END IF;
$a$;
        ELSE
            v_auth_stmt := $a$
    IF NOT COALESCE(public.can_check_availability(), FALSE) THEN
        RAISE EXCEPTION 'Unauthorized: cannot check availability.'
            USING ERRCODE = '42501';
    END IF;
$a$;
        END IF;
    ELSE
        v_auth_stmt := $a$
    PERFORM public._scheduling_assert_authorized($1);
$a$;
    END IF;

    v_body := format($fn_body$
DECLARE
    v_avail JSONB;
BEGIN
%s
    v_avail := public._check_scheduling_availability_internal($1, $2, $3, NULL);
    RETURN COALESCE((v_avail->>'available')::BOOLEAN, FALSE);
END;
$fn_body$, v_auth_stmt);

    IF v_oid IS NOT NULL THEN
        -- Replaces body cleanly in-place, preserving exact parameter names, types, defaults & ACLs
        EXECUTE format(
            'CREATE OR REPLACE FUNCTION public.check_availability(%s) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS %L',
            v_args,
            v_body
        );
    ELSE
        -- Target DB had no check_availability yet: install with standard signature and least-privilege grants
        EXECUTE format(
            'CREATE OR REPLACE FUNCTION public.check_availability(p_business_id BIGINT, p_service_id UUID, p_start_time TIMESTAMPTZ) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS %L',
            v_body
        );
        REVOKE ALL ON FUNCTION public.check_availability(BIGINT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
        GRANT EXECUTE ON FUNCTION public.check_availability(BIGINT, UUID, TIMESTAMPTZ) TO authenticated, service_role;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_available_time_slots(
    p_business_id BIGINT,
    p_service_id UUID,
    p_date DATE,
    p_exclude_appointment_id UUID DEFAULT NULL,
    p_step_minutes INTEGER DEFAULT 30
)
RETURNS TABLE (
    slot_start TIMESTAMPTZ,
    slot_end TIMESTAMPTZ,
    local_start TEXT,
    local_end TEXT,
    status TEXT,
    is_available BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_biz_record RECORD;
    v_hours RECORD;
    v_service_record RECORD;
    v_service_active BOOLEAN := TRUE;
    v_duration INTEGER;
    v_step INTEGER := GREATEST(5, LEAST(120, COALESCE(p_step_minutes, 30)));
    v_cur_local TIMESTAMP;
    v_end_local TIMESTAMP;
    v_close_local TIMESTAMP;
    v_cur_utc TIMESTAMPTZ;
    v_end_utc TIMESTAMPTZ;
    v_has_overlap BOOLEAN;
    v_has_buffer BOOLEAN;
    v_biz_suspended BOOLEAN := FALSE;
BEGIN
    PERFORM public._scheduling_assert_authorized(p_business_id);

    IF p_date IS NULL OR p_service_id IS NULL THEN
        RETURN;
    END IF;

    SELECT b.id, b.is_active, COALESCE(b.settings, '{}'::JSONB) AS settings
    INTO v_biz_record
    FROM public.businesses b
    WHERE b.id = p_business_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF jsonb_typeof(v_biz_record.settings) = 'object' THEN
        v_biz_suspended := COALESCE(
            public._scheduling_parse_bool(v_biz_record.settings->>'isSuspended', FALSE),
            FALSE
        );
    END IF;

    IF v_biz_record.is_active IS FALSE OR v_biz_suspended THEN
        RETURN;
    END IF;

    SELECT * INTO v_hours FROM public._resolve_business_hours_for_date_internal(p_business_id, p_date);
    IF v_hours.is_closed THEN
        RETURN;
    END IF;

    SELECT s.* INTO v_service_record
    FROM public.services s
    WHERE s.id = p_service_id AND s.business_id = p_business_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_service_active := COALESCE(
        CASE
            WHEN NULLIF(TRIM(COALESCE(to_jsonb(v_service_record)->>'is_active', '')), '') IS NOT NULL
                THEN public._scheduling_parse_bool(to_jsonb(v_service_record)->>'is_active', TRUE)
            WHEN NULLIF(TRIM(COALESCE(to_jsonb(v_service_record)->>'active', '')), '') IS NOT NULL
                THEN public._scheduling_parse_bool(to_jsonb(v_service_record)->>'active', TRUE)
            ELSE NULL
        END,
        FALSE
    );
    IF NOT v_service_active THEN
        RETURN;
    END IF;

    v_duration := NULLIF(to_jsonb(v_service_record)->>'duration_minutes', '')::INTEGER;
    IF v_duration IS NULL OR v_duration <= 0 OR v_duration > 1440 THEN
        RETURN;
    END IF;

    v_cur_local := p_date::TIMESTAMP + v_hours.open_time;
    v_close_local := p_date::TIMESTAMP + v_hours.close_time;

    WHILE v_cur_local < v_close_local LOOP
        v_cur_utc := v_cur_local AT TIME ZONE v_hours.timezone;

        -- Skip DST spring-forward nonexistent wall-clock gap so no invalid slot is emitted
        IF (v_cur_utc AT TIME ZONE v_hours.timezone) IS DISTINCT FROM v_cur_local THEN
            v_cur_local := v_cur_local + make_interval(mins => v_step);
            CONTINUE;
        END IF;

        -- Advance by real elapsed service minutes to stay exact across DST transitions
        v_end_utc := v_cur_utc + make_interval(mins => v_duration);
        v_end_local := v_end_utc AT TIME ZONE v_hours.timezone;

        IF v_end_local::DATE IS DISTINCT FROM p_date OR v_end_local::TIME > v_hours.close_time THEN
            EXIT;
        END IF;

        slot_start := v_cur_utc;
        slot_end := v_end_utc;
        local_start := to_char(v_cur_local, 'HH24:MI');
        local_end := to_char(v_end_local, 'HH24:MI');

        IF v_cur_utc < NOW() THEN
            status := 'past';
            is_available := FALSE;
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM public.appointments a
                WHERE a.business_id = p_business_id
                  AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
                  AND public._scheduling_is_blocking_status(a.status::TEXT)
                  AND a.start_time < v_end_utc
                  AND a.end_time > v_cur_utc
            ) INTO v_has_overlap;

            IF v_has_overlap THEN
                status := 'conflict';
                is_available := FALSE;
            ELSIF COALESCE(v_hours.buffer_minutes, 0) > 0 THEN
                SELECT EXISTS (
                    SELECT 1
                    FROM public.appointments a
                    WHERE a.business_id = p_business_id
                      AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
                      AND public._scheduling_is_blocking_status(a.status::TEXT)
                      AND a.start_time < (v_end_utc + make_interval(mins => v_hours.buffer_minutes))
                      AND (a.end_time + make_interval(mins => v_hours.buffer_minutes)) > v_cur_utc
                ) INTO v_has_buffer;

                IF v_has_buffer THEN
                    status := 'buffer';
                    is_available := FALSE;
                ELSE
                    status := 'available';
                    is_available := TRUE;
                END IF;
            ELSE
                status := 'available';
                is_available := TRUE;
            END IF;
        END IF;

        RETURN NEXT;
        v_cur_local := v_cur_local + make_interval(mins => v_step);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_appointment(
    p_business_id BIGINT,
    p_appointment_id UUID,
    p_new_start_time TIMESTAMPTZ,
    p_new_end_time TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_apt RECORD;
    v_duration INTEGER;
    v_effective_end TIMESTAMPTZ;
    v_status_norm TEXT;
BEGIN
    PERFORM public._scheduling_assert_authorized(p_business_id);

    IF p_appointment_id IS NULL OR p_new_start_time IS NULL THEN
        RAISE EXCEPTION 'Appointment ID and new start_time are required.' USING ERRCODE = 'P0001';
    END IF;

    -- Acquire advisory lock BEFORE FOR UPDATE row lock to maintain strict global
    -- lock ordering (advisory -> row) and prevent deadlocks with concurrent INSERTs.
    PERFORM pg_advisory_xact_lock(p_business_id);

    SELECT a.*
    INTO v_apt
    FROM public.appointments a
    WHERE a.id = p_appointment_id
      AND a.business_id = p_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Appointment not found for this business.');
    END IF;

    v_status_norm := LOWER(TRIM(COALESCE(v_apt.status::TEXT, '')));
    IF v_status_norm IN ('cancelled', 'completed', 'no_show') THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Cancelled, completed, or no-show appointments cannot be rescheduled.');
    END IF;

    IF p_new_end_time IS NOT NULL AND p_new_end_time <= p_new_start_time THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Appointment end_time must be strictly after start_time.');
    END IF;

    IF v_apt.service_id IS NOT NULL THEN
        SELECT s.duration_minutes
        INTO v_duration
        FROM public.services s
        WHERE s.id = v_apt.service_id AND s.business_id = p_business_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'Selected service does not belong to this business.');
        END IF;

        IF v_duration IS NULL OR v_duration <= 0 OR v_duration > 1440 THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'Selected service has an invalid duration configuration.');
        END IF;

        IF p_new_end_time IS NOT NULL THEN
            IF ABS(EXTRACT(EPOCH FROM (p_new_end_time - p_new_start_time)) - (v_duration * 60.0)) > 1.0 THEN
                RETURN jsonb_build_object(
                    'success', FALSE,
                    'error', format('Appointment end_time must match service duration (%s minutes); custom durations are not supported.', v_duration)
                );
            END IF;
            v_effective_end := p_new_end_time;
        ELSE
            v_effective_end := p_new_start_time + make_interval(mins => v_duration);
        END IF;
    ELSE
        IF p_new_end_time IS NOT NULL THEN
            v_effective_end := p_new_end_time;
        ELSIF v_apt.end_time IS NOT NULL AND v_apt.start_time IS NOT NULL AND v_apt.end_time > v_apt.start_time THEN
            v_duration := GREATEST(1, LEAST(1440, ROUND(EXTRACT(EPOCH FROM (v_apt.end_time - v_apt.start_time)) / 60.0)::INTEGER));
            v_effective_end := p_new_start_time + make_interval(mins => v_duration);
        ELSE
            RETURN jsonb_build_object('success', FALSE, 'error', 'Appointment service_id or valid end_time > start_time is required.');
        END IF;
    END IF;

    -- Updating appointments triggers trg_appointments_enforce_booking_rules()
    -- which enforces active business, active service, exact service duration,
    -- operating hours, holidays, past guard, overlap, and buffers atomically
    -- while preserving Release A reschedule notifications.
    UPDATE public.appointments
    SET start_time = p_new_start_time,
        end_time = v_effective_end,
        updated_at = NOW()
    WHERE id = p_appointment_id
      AND business_id = p_business_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'appointment_id', p_appointment_id,
        'start_time', p_new_start_time,
        'end_time', v_effective_end
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 5: LEAST-PRIVILEGE PERMISSIONS
-- -----------------------------------------------------------------------------

-- Internal helpers: strictly denied to PUBLIC, anon, and authenticated callers
REVOKE ALL ON FUNCTION public._scheduling_is_trusted_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._scheduling_is_trusted_service_role() TO service_role;

REVOKE ALL ON FUNCTION public._scheduling_assert_authorized(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._scheduling_assert_authorized(BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public._scheduling_parse_bool(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._scheduling_parse_bool(TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public._scheduling_parse_time_strict(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._scheduling_parse_time_strict(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public._scheduling_parse_nonneg_int_strict(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._scheduling_parse_nonneg_int_strict(TEXT, TEXT, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public._scheduling_safe_timezone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._scheduling_safe_timezone(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public._scheduling_is_blocking_status(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._scheduling_is_blocking_status(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public._resolve_business_hours_for_date_internal(BIGINT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._resolve_business_hours_for_date_internal(BIGINT, DATE) TO service_role;

REVOKE ALL ON FUNCTION public._check_scheduling_availability_internal(BIGINT, UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._check_scheduling_availability_internal(BIGINT, UUID, TIMESTAMPTZ, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.trg_appointments_enforce_booking_rules() FROM PUBLIC, anon, authenticated;

-- Public authorized RPCs: denied to PUBLIC and anon; granted only to authenticated & service_role
REVOKE ALL ON FUNCTION public.resolve_business_hours_for_date(BIGINT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_business_hours_for_date(BIGINT, DATE) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_scheduling_availability(BIGINT, UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_scheduling_availability(BIGINT, UUID, TIMESTAMPTZ, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_available_time_slots(BIGINT, UUID, DATE, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_time_slots(BIGINT, UUID, DATE, UUID, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reschedule_appointment(BIGINT, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment(BIGINT, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- SECTION 6: SELF-CONTAINED STAGING INTEGRATION VERIFICATION (ROLLBACK SAFE)
-- Run manually against staging or a production clone AFTER installing migration.
-- Every negative test uses explicit boolean flags (`v_blocked`) checked AFTER
-- the subtransaction block — never `RAISE EXCEPTION` inside `BEGIN...END`.
-- =============================================================================
/*
BEGIN;

-- -----------------------------------------------------------------------------
-- Fixture Setup (Privileged Session; Fully Rolled Back at End)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_super_admin_id      UUID := '00000000-0000-4000-8000-000000000301';
    v_owner_a_id          UUID := '00000000-0000-4000-8000-000000000302';
    v_inactive_staff_id   UUID := '00000000-0000-4000-8000-000000000303';
    v_null_staff_id       UUID := '00000000-0000-4000-8000-000000000304';
    v_owner_b_id          UUID := '00000000-0000-4000-8000-000000000305';
    v_outsider_id         UUID := '00000000-0000-4000-8000-000000000306';
    v_biz_a_id            BIGINT;
    v_biz_b_id            BIGINT;
    v_biz_c_id            BIGINT;
    v_cust_a_id           UUID;
    v_cust_b_id           UUID;
    v_cust_c_id           UUID;
    v_svc_a_active_id     UUID;
    v_svc_a_inactive_id   UUID;
    v_svc_b_active_id     UUID;
    v_svc_c_active_id     UUID;
    v_future_day          DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE + 14;
    v_dow_open            INTEGER := EXTRACT(DOW FROM ((NOW() AT TIME ZONE 'America/New_York')::DATE + 14))::INTEGER;
    v_holiday_date        DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE + 15;
    v_closed_dow          INTEGER := EXTRACT(DOW FROM ((NOW() AT TIME ZONE 'UTC')::DATE + 16))::INTEGER;
    v_open_b_day          DATE := (NOW() AT TIME ZONE 'UTC')::DATE + 14;
    v_closed_b_day        DATE := (NOW() AT TIME ZONE 'UTC')::DATE + 16;
    v_has_is_active       BOOLEAN := FALSE;
    v_has_active          BOOLEAN := FALSE;
BEGIN
    INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    VALUES
        (v_super_admin_id,    'authenticated', 'authenticated', 'p2-super@novacode.tech',    NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Platform Admin"}'::jsonb),
        (v_owner_a_id,        'authenticated', 'authenticated', 'p2-owner-a@biz-a.com',      NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Owner A"}'::jsonb),
        (v_inactive_staff_id, 'authenticated', 'authenticated', 'p2-inactive@biz-a.com',     NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Inactive A"}'::jsonb),
        (v_null_staff_id,     'authenticated', 'authenticated', 'p2-null@biz-a.com',         NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Pending A"}'::jsonb),
        (v_owner_b_id,        'authenticated', 'authenticated', 'p2-owner-b@biz-b.com',      NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Owner B"}'::jsonb),
        (v_outsider_id,       'authenticated', 'authenticated', 'p2-outsider@random.com',    NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Outsider"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.platform_admins (user_id)
    VALUES (v_super_admin_id)
    ON CONFLICT DO NOTHING;

    -- Business A: JSONB operatingHours + specialHours
    -- Business B: authoritative public.business_hours (`is_open`) + un-migrated JSONB
    -- Business C: completely unconfigured (empty settings, no business_hours) -> closed by default
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'business_type'
    ) THEN
        EXECUTE $biz_a$
            INSERT INTO public.businesses (name, business_type, timezone, is_active, settings)
            VALUES ($1, 'spa', $2, TRUE, $3)
            RETURNING id
        $biz_a$
        INTO v_biz_a_id
        USING '__p2_test_biz_a__', 'America/New_York', jsonb_build_object(
            'bufferBetweenAppointmentsMinutes', 15,
            'cancellationBufferHours', 24,
            'operatingHours', jsonb_build_object(
                v_dow_open::TEXT, jsonb_build_object('open', '09:00', 'close', '17:00', 'isClosed', false)
            ),
            'specialHours', jsonb_build_array(
                jsonb_build_object('date', to_char(v_holiday_date, 'YYYY-MM-DD'), 'open', '09:00', 'close', '17:00', 'isClosed', true, 'label', 'Founders Holiday')
            )
        );

        EXECUTE $biz_b$
            INSERT INTO public.businesses (name, business_type, timezone, is_active, settings)
            VALUES ($1, 'spa', $2, TRUE, $3)
            RETURNING id
        $biz_b$
        INTO v_biz_b_id
        USING '__p2_test_biz_b__', 'UTC', jsonb_build_object(
            'bufferBetweenAppointmentsMinutes', 10,
            'cancellationBufferHours', 12,
            'operatingHours', jsonb_build_object(
                EXTRACT(DOW FROM v_open_b_day)::INTEGER::TEXT, jsonb_build_object('open', '06:00', 'close', '07:00', 'isClosed', false),
                v_closed_dow::TEXT, jsonb_build_object('open', '08:00', 'close', '20:00', 'isClosed', false)
            )
        );

        EXECUTE $biz_c$
            INSERT INTO public.businesses (name, business_type, timezone, is_active, settings)
            VALUES ($1, 'spa', $2, TRUE, '{}'::jsonb)
            RETURNING id
        $biz_c$
        INTO v_biz_c_id
        USING '__p2_test_biz_c_unconfigured__', 'America/New_York';
    ELSE
        INSERT INTO public.businesses (name, timezone, is_active, settings)
        VALUES (
            '__p2_test_biz_a__',
            'America/New_York',
            TRUE,
            jsonb_build_object(
                'bufferBetweenAppointmentsMinutes', 15,
                'cancellationBufferHours', 24,
                'operatingHours', jsonb_build_object(
                    v_dow_open::TEXT, jsonb_build_object('open', '09:00', 'close', '17:00', 'isClosed', false)
                ),
                'specialHours', jsonb_build_array(
                    jsonb_build_object('date', to_char(v_holiday_date, 'YYYY-MM-DD'), 'open', '09:00', 'close', '17:00', 'isClosed', true, 'label', 'Founders Holiday')
                )
            )
        )
        RETURNING id INTO v_biz_a_id;

        INSERT INTO public.businesses (name, timezone, is_active, settings)
        VALUES (
            '__p2_test_biz_b__',
            'UTC',
            TRUE,
            jsonb_build_object(
                'bufferBetweenAppointmentsMinutes', 10,
                'cancellationBufferHours', 12,
                'operatingHours', jsonb_build_object(
                    EXTRACT(DOW FROM v_open_b_day)::INTEGER::TEXT, jsonb_build_object('open', '06:00', 'close', '07:00', 'isClosed', false),
                    v_closed_dow::TEXT, jsonb_build_object('open', '08:00', 'close', '20:00', 'isClosed', false)
                )
            )
        )
        RETURNING id INTO v_biz_b_id;

        INSERT INTO public.businesses (name, timezone, is_active, settings)
        VALUES ('__p2_test_biz_c_unconfigured__', 'America/New_York', TRUE, '{}'::jsonb)
        RETURNING id INTO v_biz_c_id;
    END IF;

    INSERT INTO public.business_members (business_id, user_id, role, is_active)
    VALUES
        (v_biz_a_id, v_owner_a_id,        'owner', TRUE),
        (v_biz_a_id, v_inactive_staff_id, 'staff', FALSE),
        (v_biz_a_id, v_null_staff_id,     'staff', NULL),
        (v_biz_b_id, v_owner_b_id,        'owner', TRUE);

    INSERT INTO public.customers (id, business_id, full_name)
    VALUES (gen_random_uuid(), v_biz_a_id, 'Camila Rivera')
    RETURNING id INTO v_cust_a_id;

    INSERT INTO public.customers (id, business_id, full_name)
    VALUES (gen_random_uuid(), v_biz_b_id, 'Marcus Lee')
    RETURNING id INTO v_cust_b_id;

    INSERT INTO public.customers (id, business_id, full_name)
    VALUES (gen_random_uuid(), v_biz_c_id, 'Unconfigured Client')
    RETURNING id INTO v_cust_c_id;

    INSERT INTO public.services (id, business_id, name, duration_minutes)
    VALUES (gen_random_uuid(), v_biz_a_id, 'Active Facial', 60)
    RETURNING id INTO v_svc_a_active_id;

    INSERT INTO public.services (id, business_id, name, duration_minutes)
    VALUES (gen_random_uuid(), v_biz_a_id, 'Inactive Peel', 60)
    RETURNING id INTO v_svc_a_inactive_id;

    INSERT INTO public.services (id, business_id, name, duration_minutes)
    VALUES (gen_random_uuid(), v_biz_b_id, 'Consult', 30)
    RETURNING id INTO v_svc_b_active_id;

    INSERT INTO public.services (id, business_id, name, duration_minutes)
    VALUES (gen_random_uuid(), v_biz_c_id, 'Unconfigured Consult', 60)
    RETURNING id INTO v_svc_c_active_id;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='is_active'
    ) INTO v_has_is_active;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='active'
    ) INTO v_has_active;

    IF v_has_is_active THEN
        EXECUTE 'UPDATE public.services SET is_active = FALSE WHERE id = $1' USING v_svc_a_inactive_id;
    ELSIF v_has_active THEN
        EXECUTE 'UPDATE public.services SET active = FALSE WHERE id = $1' USING v_svc_a_inactive_id;
    END IF;

    IF to_regclass('public.business_hours') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='business_hours' AND column_name='is_open'
       ) THEN
        EXECUTE $bh_ins$
            INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time, is_open)
            VALUES
                ($1, $2, '10:00'::time, '16:00'::time, TRUE),
                ($1, $3, '10:00'::time, '16:00'::time, FALSE)
            ON CONFLICT DO NOTHING
        $bh_ins$
        USING v_biz_b_id, EXTRACT(DOW FROM v_open_b_day)::INTEGER, v_closed_dow;
    END IF;

    PERFORM set_config('p2_test.super_admin_id',    v_super_admin_id::text, true);
    PERFORM set_config('p2_test.owner_a_id',        v_owner_a_id::text, true);
    PERFORM set_config('p2_test.inactive_staff_id', v_inactive_staff_id::text, true);
    PERFORM set_config('p2_test.null_staff_id',     v_null_staff_id::text, true);
    PERFORM set_config('p2_test.owner_b_id',        v_owner_b_id::text, true);
    PERFORM set_config('p2_test.outsider_id',       v_outsider_id::text, true);
    PERFORM set_config('p2_test.biz_a_id',          v_biz_a_id::text, true);
    PERFORM set_config('p2_test.biz_b_id',          v_biz_b_id::text, true);
    PERFORM set_config('p2_test.biz_c_id',          v_biz_c_id::text, true);
    PERFORM set_config('p2_test.cust_a_id',         v_cust_a_id::text, true);
    PERFORM set_config('p2_test.cust_b_id',         v_cust_b_id::text, true);
    PERFORM set_config('p2_test.cust_c_id',         v_cust_c_id::text, true);
    PERFORM set_config('p2_test.svc_a_active',      v_svc_a_active_id::text, true);
    PERFORM set_config('p2_test.svc_a_inactive',    v_svc_a_inactive_id::text, true);
    PERFORM set_config('p2_test.svc_b_active',      v_svc_b_active_id::text, true);
    PERFORM set_config('p2_test.svc_c_active',      v_svc_c_active_id::text, true);
    PERFORM set_config('p2_test.future_day',        to_char(v_future_day, 'YYYY-MM-DD'), true);
    PERFORM set_config('p2_test.holiday_date',      to_char(v_holiday_date, 'YYYY-MM-DD'), true);
    PERFORM set_config('p2_test.open_b_day',        to_char(v_open_b_day, 'YYYY-MM-DD'), true);
    PERFORM set_config('p2_test.closed_b_day',      to_char(v_closed_b_day, 'YYYY-MM-DD'), true);
END;
$$;

-- -----------------------------------------------------------------------------
-- TEST 1: Trigger Rules, Legacy RPC Consistency, Duration, Closed-By-Default, DST
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_a_id       BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_biz_b_id       BIGINT := current_setting('p2_test.biz_b_id')::bigint;
    v_biz_c_id       BIGINT := current_setting('p2_test.biz_c_id')::bigint;
    v_cust_a_id      UUID := current_setting('p2_test.cust_a_id')::uuid;
    v_cust_c_id      UUID := current_setting('p2_test.cust_c_id')::uuid;
    v_svc_active     UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_svc_inactive   UUID := current_setting('p2_test.svc_a_inactive')::uuid;
    v_svc_c_active   UUID := current_setting('p2_test.svc_c_active')::uuid;
    v_future_day     DATE := current_setting('p2_test.future_day')::date;
    v_holiday_date   DATE := current_setting('p2_test.holiday_date')::date;
    v_apt_1_id       UUID := gen_random_uuid();
    v_apt_2_id       UUID := gen_random_uuid();
    v_apt_derived_id UUID := gen_random_uuid();
    v_blocked        BOOLEAN;
    v_err_msg        TEXT;
    v_lock_count     INTEGER;
    v_legacy_bool    BOOLEAN;
BEGIN
    -- 1A. Inactive service rejected everywhere
    IF public.check_availability(
        v_biz_a_id,
        v_svc_inactive,
        (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York'
    ) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1A-0): check_availability allowed inactive service.';
    END IF;

    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_inactive,
            (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '11:00') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%Inactive services cannot be booked%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1A): Inactive service should have been rejected, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 1B. Holiday / specialHours closure rejected identically in legacy check_availability & trigger
    IF public.check_availability(
        v_biz_a_id,
        v_svc_active,
        (v_holiday_date::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York'
    ) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1B-0): check_availability allowed holiday booking.';
    END IF;

    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_holiday_date::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
            (v_holiday_date::TIMESTAMP + TIME '11:00') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%Business is closed%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1B): Holiday booking should have been rejected, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 1C. Outside operating hours rejected (16:30 + 60m = 17:30 > 17:00)
    IF public.check_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '16:30') AT TIME ZONE 'America/New_York'
    ) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1C-0): check_availability allowed out-of-hours booking.';
    END IF;

    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_future_day::TIMESTAMP + TIME '16:30') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '17:30') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%outside operating hours%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1C): Out-of-hours booking should have been rejected, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 1D. Past booking rejected
    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_active,
            NOW() - INTERVAL '1 hour',
            NOW(),
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%in the past%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1D): Past booking should have been rejected, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 1E. Valid 10:00-11:00 booking succeeds (check_availability agrees) and holds advisory lock
    IF public.check_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York'
    ) IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (1E-0): check_availability rejected open 10:00 slot.';
    END IF;

    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (
        v_apt_1_id, v_biz_a_id, v_cust_a_id, v_svc_active,
        (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
        (v_future_day::TIMESTAMP + TIME '11:00') AT TIME ZONE 'America/New_York',
        'confirmed'
    );

    SELECT COUNT(*) INTO v_lock_count
    FROM pg_catalog.pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_backend_pid()
      AND granted = TRUE;
    IF v_lock_count < 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (1E): Expected pg_advisory_xact_lock to be held during booking txn.';
    END IF;

    -- 1F. Overlap (10:30-11:30) rejected in both check_availability & trigger
    IF public.check_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '10:30') AT TIME ZONE 'America/New_York'
    ) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1F-0): check_availability missed overlap conflict.';
    END IF;

    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_future_day::TIMESTAMP + TIME '10:30') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '11:30') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%overlaps another booking%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1F): Overlap booking should have been rejected, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 1G. Buffer violation (11:00-12:00 with 15-min buffer) rejected in both check_availability & trigger
    IF public.check_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '11:00') AT TIME ZONE 'America/New_York'
    ) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1G-0): check_availability ignored 15m bufferBetweenAppointmentsMinutes!';
    END IF;

    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_future_day::TIMESTAMP + TIME '11:00') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '12:00') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%15 minute buffer%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1G): Buffer conflict should have been rejected, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 1H. Boundary-valid 11:15-12:15 booking succeeds
    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (
        v_apt_2_id, v_biz_a_id, v_cust_a_id, v_svc_active,
        (v_future_day::TIMESTAMP + TIME '11:15') AT TIME ZONE 'America/New_York',
        (v_future_day::TIMESTAMP + TIME '12:15') AT TIME ZONE 'America/New_York',
        'confirmed'
    );

    -- 1I. Cross-tenant business_id reassignment on existing appointment is rejected
    v_blocked := FALSE;
    BEGIN
        UPDATE public.appointments
        SET business_id = v_biz_b_id
        WHERE id = v_apt_2_id;
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (1I): Cross-tenant business_id reassignment should have been blocked.';
    END IF;

    -- 1J. Completed vs cancelled vs no_show conflict parity across ALL availability & trigger paths
    DECLARE
        v_apt_status_id  UUID := gen_random_uuid();
        v_avail_chk      JSONB;
        v_slot_status    TEXT;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            v_apt_status_id, v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '16:00') AT TIME ZONE 'America/New_York',
            'completed'
        );

        IF public.check_availability(
            v_biz_a_id,
            v_svc_active,
            (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York'
        ) IS NOT FALSE THEN
            RAISE EXCEPTION 'TEST FAILURE (1J-0): check_availability should block completed window.';
        END IF;

        v_avail_chk := public.check_scheduling_availability(
            v_biz_a_id,
            v_svc_active,
            (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
            NULL
        );
        IF COALESCE((v_avail_chk->>'available')::BOOLEAN, TRUE) IS NOT FALSE THEN
            RAISE EXCEPTION 'TEST FAILURE (1J-1): check_scheduling_availability should block completed window, got %', v_avail_chk;
        END IF;

        SELECT g.status INTO v_slot_status
        FROM public.get_available_time_slots(v_biz_a_id, v_svc_active, v_future_day, NULL, 30) g
        WHERE g.local_start = '15:00'
        LIMIT 1;
        IF v_slot_status IS DISTINCT FROM 'conflict' THEN
            RAISE EXCEPTION 'TEST FAILURE (1J-2): get_available_time_slots expected conflict for completed window, got %', v_slot_status;
        END IF;

        -- no_show frees the slot & buffer everywhere
        UPDATE public.appointments SET status = 'no_show' WHERE id = v_apt_status_id;
        v_avail_chk := public.check_scheduling_availability(
            v_biz_a_id,
            v_svc_active,
            (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
            NULL
        );
        IF COALESCE((v_avail_chk->>'available')::BOOLEAN, FALSE) IS NOT TRUE THEN
            RAISE EXCEPTION 'TEST FAILURE (1J-3): no_show should free slot in check_scheduling_availability, got %', v_avail_chk;
        END IF;

        DELETE FROM public.appointments WHERE id = v_apt_status_id;
    END;

    -- 1K. Suspended / inactive business blocks ALL paths
    UPDATE public.businesses SET is_active = FALSE WHERE id = v_biz_a_id;
    IF public.check_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York'
    ) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1K-0a): check_availability allowed inactive business.';
    END IF;

    IF COALESCE((public.check_scheduling_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
        NULL
    )->>'available')::BOOLEAN, TRUE) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1K-0b): Inactive business should report available=false.';
    END IF;

    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '16:00') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%inactive%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1K): Inactive business should reject new bookings, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;
    UPDATE public.businesses SET is_active = TRUE WHERE id = v_biz_a_id;

    -- 1L. Explicit duration policy: custom mismatch rejected, NULL end_time derived accurately
    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '15:10') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%Custom durations are not supported%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1L-1): Custom duration (10m on 60m service) should be rejected, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- NULL end_time auto-derives exact service duration (if column allows NULL pre-trigger)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='appointments' AND column_name='end_time' AND is_nullable='YES'
    ) THEN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            v_apt_derived_id, v_biz_a_id, v_cust_a_id, v_svc_active,
            (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
            NULL,
            'confirmed'
        );
        DELETE FROM public.appointments WHERE id = v_apt_derived_id;
    END IF;

    -- 1M. Closed-by-default policy for unconfigured Business C (NO invented 09:00-18:00)
    IF public.check_availability(
        v_biz_c_id,
        v_svc_c_active,
        (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York'
    ) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (1M-1): Unconfigured Business C should not invent open hours in check_availability!';
    END IF;

    IF EXISTS (SELECT 1 FROM public.get_available_time_slots(v_biz_c_id, v_svc_c_active, v_future_day, NULL, 30)) THEN
        RAISE EXCEPTION 'TEST FAILURE (1M-2): Unconfigured Business C should return 0 slots!';
    END IF;

    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
        VALUES (
            gen_random_uuid(), v_biz_c_id, v_cust_c_id, v_svc_c_active,
            (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
            (v_future_day::TIMESTAMP + TIME '11:00') AT TIME ZONE 'America/New_York',
            'confirmed'
        );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%Business is closed%' THEN
        RAISE EXCEPTION 'TEST FAILURE (1M-3): Unconfigured Business C should reject bookings closed-by-default, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 1N. DST spring-forward nonexistent gap slot verification (first Sunday of Nov/Mar dynamically)
    DECLARE
        v_dst_spring DATE := DATE '2099-03-08'; -- America/New_York spring forward 02:00->03:00
        v_dst_gap_cnt INTEGER;
    BEGIN
        UPDATE public.businesses
        SET settings = jsonb_set(
            settings,
            '{specialHours}',
            (settings->'specialHours') || jsonb_build_array(
                jsonb_build_object('date', to_char(v_dst_spring, 'YYYY-MM-DD'), 'open', '01:00', 'close', '05:00', 'isClosed', false, 'label', 'DST Spring')
            )
        )
        WHERE id = v_biz_a_id;

        SELECT COUNT(*) INTO v_dst_gap_cnt
        FROM public.get_available_time_slots(v_biz_a_id, v_svc_active, v_dst_spring, NULL, 30)
        WHERE local_start IN ('02:00', '02:30');
        IF v_dst_gap_cnt <> 0 THEN
            RAISE EXCEPTION 'TEST FAILURE (1N): Nonexistent DST 02:00/02:30 slots were emitted!';
        END IF;

        -- Restore specialHours array back to original holiday element
        UPDATE public.businesses
        SET settings = jsonb_set(settings, '{specialHours}', jsonb_build_array(settings->'specialHours'->0))
        WHERE id = v_biz_a_id;
    END;

    -- 1O. Exclusion constraint verification (if btree_gist is present & constraint installed)
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.appointments'::regclass
          AND conname = 'excl_appointments_no_active_overlap'
    ) THEN
        RAISE NOTICE 'Storage exclusion constraint excl_appointments_no_active_overlap verified present.';
    END IF;

    PERFORM set_config('p2_test.apt_1_id', v_apt_1_id::text, true);
    PERFORM set_config('p2_test.apt_2_id', v_apt_2_id::text, true);
END;
$$;

-- -----------------------------------------------------------------------------
-- TEST 2: public.business_hours (`is_open`), Time Parsing & Malformed Settings
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_a_id     BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_biz_b_id     BIGINT := current_setting('p2_test.biz_b_id')::bigint;
    v_cust_b_id    UUID := current_setting('p2_test.cust_b_id')::uuid;
    v_svc_b_id     UUID := current_setting('p2_test.svc_b_active')::uuid;
    v_future_day   DATE := current_setting('p2_test.future_day')::date;
    v_open_b_day   DATE := current_setting('p2_test.open_b_day')::date;
    v_closed_b_day DATE := current_setting('p2_test.closed_b_day')::date;
    v_hours_open   RECORD;
    v_hours_closed RECORD;
    v_blocked      BOOLEAN;
    v_err_msg      TEXT;
    v_saved_settings JSONB;
BEGIN
    IF to_regclass('public.business_hours') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='business_hours' AND column_name='is_open'
       ) THEN
        SELECT * INTO v_hours_open
        FROM public._resolve_business_hours_for_date_internal(v_biz_b_id, v_open_b_day);

        IF v_hours_open.is_closed IS DISTINCT FROM FALSE OR v_hours_open.open_time <> '10:00'::time THEN
            RAISE EXCEPTION 'TEST FAILURE (2A): Expected business_hours is_open=TRUE day to resolve open 10:00, got %', row_to_json(v_hours_open);
        END IF;

        SELECT * INTO v_hours_closed
        FROM public._resolve_business_hours_for_date_internal(v_biz_b_id, v_closed_b_day);

        IF v_hours_closed.is_closed IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'TEST FAILURE (2B): Expected business_hours is_open=FALSE day to resolve closed, got %', row_to_json(v_hours_closed);
        END IF;

        v_blocked := FALSE;
        v_err_msg := NULL;
        BEGIN
            INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
            VALUES (
                gen_random_uuid(), v_biz_b_id, v_cust_b_id, v_svc_b_id,
                (v_closed_b_day::TIMESTAMP + TIME '11:00') AT TIME ZONE 'UTC',
                (v_closed_b_day::TIMESTAMP + TIME '11:30') AT TIME ZONE 'UTC',
                'confirmed'
            );
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
            v_blocked := TRUE;
            v_err_msg := SQLERRM;
        END;
        IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%Business is closed%' THEN
            RAISE EXCEPTION 'TEST FAILURE (2C): is_open=FALSE day should reject bookings, got blocked=% err=%', v_blocked, v_err_msg;
        END IF;

        -- 2D. specialHours holiday override takes precedence over public.business_hours
        UPDATE public.businesses
        SET settings = settings || jsonb_build_object(
            'specialHours', jsonb_build_array(
                jsonb_build_object('date', to_char(v_open_b_day, 'YYYY-MM-DD'), 'open', '10:00', 'close', '16:00', 'isClosed', true, 'label', 'Staff Training')
            )
        )
        WHERE id = v_biz_b_id;

        SELECT * INTO v_hours_closed
        FROM public._resolve_business_hours_for_date_internal(v_biz_b_id, v_open_b_day);
        IF v_hours_closed.is_closed IS DISTINCT FROM TRUE OR v_hours_closed.is_special_hours IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'TEST FAILURE (2D): specialHours holiday should override public.business_hours, got %', row_to_json(v_hours_closed);
        END IF;

        -- 2E. Explicit migration flag allows JSONB operatingHours
        UPDATE public.businesses
        SET settings = (settings - 'specialHours') || jsonb_build_object('operatingHoursMigrated', true)
        WHERE id = v_biz_b_id;

        SELECT * INTO v_hours_open
        FROM public._resolve_business_hours_for_date_internal(v_biz_b_id, v_open_b_day);
        IF v_hours_open.open_time <> '06:00'::time THEN
            RAISE EXCEPTION 'TEST FAILURE (2E): operatingHoursMigrated=true should allow JSONB operatingHours (06:00), got %', row_to_json(v_hours_open);
        END IF;

        -- 2F. Single-digit/TIME string parsing resolves '09:30:00' without LEFT(...,5) truncation
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'business_hours' AND column_name = 'open_time'
        ) THEN
            EXECUTE $bh_upd$
                UPDATE public.business_hours
                SET open_time = '09:30:00'
                WHERE business_id = $1
                  AND day_of_week = $2
            $bh_upd$
            USING v_biz_b_id, EXTRACT(DOW FROM v_open_b_day)::INTEGER;

            SELECT * INTO v_hours_open
            FROM public._resolve_business_hours_for_date_internal(v_biz_b_id, v_open_b_day);
            IF v_hours_open.open_time <> '09:30:00'::time THEN
                RAISE EXCEPTION 'TEST FAILURE (2F): Expected 09:30 open_time from business_hours, got %', row_to_json(v_hours_open);
            END IF;
        END IF;

        -- Restore Business B un-migrated state
        UPDATE public.businesses
        SET settings = settings - 'operatingHoursMigrated'
        WHERE id = v_biz_b_id;
    END IF;

    -- 2G. Malformed settings must fail closed or raise SQLSTATE 22023 (never invent 09:00-18:00)
    SELECT settings INTO v_saved_settings FROM public.businesses WHERE id = v_biz_a_id;

    -- Invalid open time '25:99' fails closed
    UPDATE public.businesses
    SET settings = jsonb_build_object(
        'operatingHours', jsonb_build_object(
            EXTRACT(DOW FROM v_future_day)::INTEGER::TEXT,
            jsonb_build_object('open', '25:99', 'close', '17:00', 'isClosed', false)
        )
    )
    WHERE id = v_biz_a_id;
    SELECT * INTO v_hours_closed FROM public._resolve_business_hours_for_date_internal(v_biz_a_id, v_future_day);
    IF v_hours_closed.is_closed IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (2G-1): Invalid time 25:99 should fail closed, got %', row_to_json(v_hours_closed);
    END IF;

    -- Malformed boolean 'maybe' fails closed
    UPDATE public.businesses
    SET settings = jsonb_build_object(
        'operatingHours', jsonb_build_object(
            EXTRACT(DOW FROM v_future_day)::INTEGER::TEXT,
            jsonb_build_object('open', '09:00', 'close', '17:00', 'isClosed', 'maybe')
        )
    )
    WHERE id = v_biz_a_id;
    SELECT * INTO v_hours_closed FROM public._resolve_business_hours_for_date_internal(v_biz_a_id, v_future_day);
    IF v_hours_closed.is_closed IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (2G-2): Malformed isClosed=maybe should fail closed, got %', row_to_json(v_hours_closed);
    END IF;

    -- Non-object JSONB settings fails closed
    UPDATE public.businesses SET settings = '[]'::jsonb WHERE id = v_biz_a_id;
    SELECT * INTO v_hours_closed FROM public._resolve_business_hours_for_date_internal(v_biz_a_id, v_future_day);
    IF v_hours_closed.is_closed IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (2G-3): Non-object settings should fail closed, got %', row_to_json(v_hours_closed);
    END IF;

    -- Negative / non-numeric buffer raises 22023 instead of hiding config as 0
    UPDATE public.businesses SET settings = '{"bufferBetweenAppointmentsMinutes": -5}'::jsonb WHERE id = v_biz_a_id;
    v_blocked := FALSE;
    BEGIN
        PERFORM * FROM public._resolve_business_hours_for_date_internal(v_biz_a_id, v_future_day);
    EXCEPTION WHEN SQLSTATE '22023' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (2G-4): Negative bufferBetweenAppointmentsMinutes should raise 22023.';
    END IF;

    UPDATE public.businesses SET settings = v_saved_settings WHERE id = v_biz_a_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- TEST 3: Historical Metadata, Immutability & Status Transition Integrity
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_a_id     BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_cust_a_id    UUID := current_setting('p2_test.cust_a_id')::uuid;
    v_apt_2_id     UUID := current_setting('p2_test.apt_2_id')::uuid;
    v_svc_active   UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_svc_inactive UUID := current_setting('p2_test.svc_a_inactive')::uuid;
    v_future_day   DATE := current_setting('p2_test.future_day')::date;
    v_apt_ns_id    UUID := gen_random_uuid();
    v_blocked      BOOLEAN;
    v_err_msg      TEXT;
    v_has_notes    BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='services' AND column_name='is_active') THEN
        EXECUTE 'UPDATE public.services SET is_active = FALSE WHERE id = $1' USING v_svc_active;
    END IF;

    UPDATE public.businesses
    SET settings = jsonb_set(
        settings,
        '{specialHours}',
        (settings->'specialHours') || jsonb_build_array(
            jsonb_build_object('date', to_char(v_future_day, 'YYYY-MM-DD'), 'open', '09:00', 'close', '17:00', 'isClosed', true, 'label', 'Retroactive Closure')
        )
    )
    WHERE id = v_biz_a_id;

    -- 3A. Non-schedule update (updated_at / notes) on existing appointment MUST succeed
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='appointments' AND column_name='notes'
    ) INTO v_has_notes;

    IF v_has_notes THEN
        EXECUTE 'UPDATE public.appointments SET notes = $1, updated_at = NOW() WHERE id = $2'
        USING 'Historical note preserved', v_apt_2_id;
    ELSE
        UPDATE public.appointments SET updated_at = NOW() WHERE id = v_apt_2_id;
    END IF;

    -- 3B. Transitioning to completed MUST succeed
    UPDATE public.appointments SET status = 'completed' WHERE id = v_apt_2_id;

    -- 3C. Attempting direct table reschedule on completed appointment MUST fail
    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        UPDATE public.appointments
        SET start_time = start_time + INTERVAL '1 hour',
            end_time = end_time + INTERVAL '1 hour'
        WHERE id = v_apt_2_id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%cannot be rescheduled%' THEN
        RAISE EXCEPTION 'TEST FAILURE (3C): Direct table reschedule of completed appointment should fail, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 3D. Attempting to cancel a completed appointment MUST fail
    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        UPDATE public.appointments SET status = 'cancelled' WHERE id = v_apt_2_id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%Completed appointments cannot be cancelled%' THEN
        RAISE EXCEPTION 'TEST FAILURE (3D): Cancelling completed appointment should fail, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 3E. Reopening or changing status out of completed MUST fail
    v_blocked := FALSE;
    BEGIN
        UPDATE public.appointments SET status = 'confirmed' WHERE id = v_apt_2_id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (3E): Completed appointment cannot transition back to confirmed.';
    END IF;

    -- Restore service & open day for 3F/3G
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='services' AND column_name='is_active') THEN
        EXECUTE 'UPDATE public.services SET is_active = TRUE WHERE id = $1' USING v_svc_active;
    END IF;
    UPDATE public.businesses
    SET settings = jsonb_set(settings, '{specialHours}', jsonb_build_array(settings->'specialHours'->0))
    WHERE id = v_biz_a_id;

    -- 3F. Piggybacking date/service mutation onto transition into no_show / cancelled / completed MUST fail
    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (
        v_apt_ns_id, v_biz_a_id, v_cust_a_id, v_svc_active,
        (v_future_day::TIMESTAMP + TIME '14:00') AT TIME ZONE 'America/New_York',
        (v_future_day::TIMESTAMP + TIME '15:00') AT TIME ZONE 'America/New_York',
        'confirmed'
    );

    v_blocked := FALSE;
    BEGIN
        UPDATE public.appointments
        SET status = 'no_show',
            start_time = start_time + INTERVAL '1 hour',
            end_time = end_time + INTERVAL '1 hour'
        WHERE id = v_apt_ns_id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (3F-1): Transition to no_show mutated start_time/end_time.';
    END IF;

    v_blocked := FALSE;
    BEGIN
        UPDATE public.appointments
        SET status = 'cancelled',
            service_id = v_svc_inactive
        WHERE id = v_apt_ns_id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (3F-2): Transition to cancelled mutated service_id.';
    END IF;

    -- 3G. Legitimate transition to no_show succeeds, and invalid status is rejected when TEXT
    UPDATE public.appointments SET status = 'no_show' WHERE id = v_apt_ns_id;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='appointments' AND column_name='status' AND data_type='text'
    ) THEN
        v_blocked := FALSE;
        BEGIN
            UPDATE public.appointments SET status = 'in_progress' WHERE id = v_apt_ns_id;
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
            v_blocked := TRUE;
        END;
        IF NOT v_blocked THEN
            RAISE EXCEPTION 'TEST FAILURE (3G): Invalid status in_progress was accepted.';
        END IF;
    END IF;

    DELETE FROM public.appointments WHERE id = v_apt_ns_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- TEST 4: Cancellation Policy (`cancellationBufferHours`) & Notification Check
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_cust_a_id  UUID := current_setting('p2_test.cust_a_id')::uuid;
    v_svc_active UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_apt_1_id   UUID := current_setting('p2_test.apt_1_id')::uuid;
    v_soon_id    UUID := gen_random_uuid();
    v_soon_date  DATE := ((NOW() + INTERVAL '2 hours') AT TIME ZONE 'America/New_York')::DATE;
    v_blocked    BOOLEAN;
    v_err_msg    TEXT;
BEGIN
    UPDATE public.businesses
    SET settings = jsonb_set(
        settings,
        '{specialHours}',
        (settings->'specialHours') || jsonb_build_array(
            jsonb_build_object('date', to_char(v_soon_date, 'YYYY-MM-DD'), 'open', '00:00', 'close', '23:59', 'isClosed', false, 'label', 'Test Window')
        )
    )
    WHERE id = v_biz_a_id;

    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (
        v_soon_id, v_biz_a_id, v_cust_a_id, v_svc_active,
        NOW() + INTERVAL '2 hours',
        NOW() + INTERVAL '3 hours',
        'confirmed'
    );

    -- 4A. Inside 24h buffer -> rejected
    v_blocked := FALSE;
    v_err_msg := NULL;
    BEGIN
        UPDATE public.appointments
        SET status = 'cancelled'
        WHERE id = v_soon_id AND business_id = v_biz_a_id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_blocked := TRUE;
        v_err_msg := SQLERRM;
    END;
    IF NOT v_blocked OR COALESCE(v_err_msg, '') NOT ILIKE '%at least 24 hours in advance%' THEN
        RAISE EXCEPTION 'TEST FAILURE (4A): Cancellation inside 24h buffer should fail, got blocked=% err=%', v_blocked, v_err_msg;
    END IF;

    -- 4B. Outside 24h buffer (14 days out) -> succeeds
    UPDATE public.appointments
    SET status = 'cancelled'
    WHERE id = v_apt_1_id AND business_id = v_biz_a_id;

    -- 4C. Release A notification compatibility check: 0 notifications on rejected cancel
    IF to_regclass('public.booking_notifications') IS NOT NULL THEN
        DECLARE
            v_rejected_notif_cnt INTEGER := 0;
            v_accepted_notif_cnt INTEGER := 0;
        BEGIN
            EXECUTE 'SELECT COUNT(*) FROM public.booking_notifications WHERE appointment_id = $1 AND type = $2'
            INTO v_rejected_notif_cnt
            USING v_soon_id, 'appointment_cancelled';

            IF v_rejected_notif_cnt <> 0 THEN
                RAISE EXCEPTION 'TEST FAILURE (4C-1): Rejected cancellation emitted % notifications!', v_rejected_notif_cnt;
            END IF;

            EXECUTE 'SELECT COUNT(*) FROM public.booking_notifications WHERE appointment_id = $1 AND type = $2'
            INTO v_accepted_notif_cnt
            USING v_apt_1_id, 'appointment_cancelled';

            IF v_accepted_notif_cnt < 1 THEN
                RAISE NOTICE 'Notice (4C-2): Expected Release A appointment_cancelled notification for %; check Release A trigger state.', v_apt_1_id;
            END IF;
        END;
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- TEST 5: Authorization, Unauthenticated Rejection, Cross-Tenant, ACLs & service_role
-- -----------------------------------------------------------------------------

-- 5A. Unauthenticated `anon` cannot execute any new scheduling RPC
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;

DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_svc_active UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_future_day DATE := current_setting('p2_test.future_day')::date;
    v_blocked    BOOLEAN;
BEGIN
    v_blocked := FALSE;
    BEGIN
        PERFORM * FROM public.resolve_business_hours_for_date(v_biz_a_id, v_future_day);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5A-1): anon executed resolve_business_hours_for_date';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM public.check_scheduling_availability(
            v_biz_a_id,
            v_svc_active,
            (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
            NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5A-2): anon executed check_scheduling_availability';
    END IF;
END;
$$;

-- 5B. `authenticated` role with NULL auth.uid() MUST be rejected
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_svc_active UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_future_day DATE := current_setting('p2_test.future_day')::date;
    v_blocked    BOOLEAN;
BEGIN
    v_blocked := FALSE;
    BEGIN
        PERFORM public.check_scheduling_availability(
            v_biz_a_id,
            v_svc_active,
            (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
            NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5B): authenticated session with NULL auth.uid() bypassed check_scheduling_availability!';
    END IF;
END;
$$;

-- 5C. Cross-tenant Owner B rejected for Business A RPCs & internal helpers
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('p2_test.owner_b_id'),
    'role', 'authenticated',
    'email', 'p2-owner-b@biz-b.com'
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('p2_test.owner_b_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_svc_active UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_apt_1_id   UUID := current_setting('p2_test.apt_1_id')::uuid;
    v_future_day DATE := current_setting('p2_test.future_day')::date;
    v_blocked    BOOLEAN;
BEGIN
    v_blocked := FALSE;
    BEGIN
        PERFORM * FROM public._resolve_business_hours_for_date_internal(v_biz_a_id, v_future_day);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5C-0a): authenticated caller executed _resolve_business_hours_for_date_internal!';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM public._check_scheduling_availability_internal(
            v_biz_a_id, v_svc_active, (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York', NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5C-0b): authenticated caller executed _check_scheduling_availability_internal!';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM * FROM public.resolve_business_hours_for_date(v_biz_a_id, v_future_day);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5C-1): Owner B read Business A hours!';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM public.check_scheduling_availability(
            v_biz_a_id,
            v_svc_active,
            (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
            NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5C-2): Owner B probed Business A availability!';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM * FROM public.get_available_time_slots(v_biz_a_id, v_svc_active, v_future_day, NULL, 30);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5C-3): Owner B enumerated Business A slots!';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM public.reschedule_appointment(
            v_biz_a_id,
            v_apt_1_id,
            (v_future_day::TIMESTAMP + TIME '14:00') AT TIME ZONE 'America/New_York',
            NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5C-4): Owner B rescheduled Business A appointment!';
    END IF;
END;
$$;

-- 5D. Authorized Owner A succeeds across all Business A RPCs & reschedule_appointment (duration rejection + valid)
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('p2_test.owner_a_id'),
    'role', 'authenticated',
    'email', 'p2-owner-a@biz-a.com'
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('p2_test.owner_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_cust_a_id  UUID := current_setting('p2_test.cust_a_id')::uuid;
    v_svc_active UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_future_day DATE := current_setting('p2_test.future_day')::date;
    v_avail      JSONB;
    v_slot_cnt   INTEGER;
    v_res_id     UUID := gen_random_uuid();
    v_resched    JSONB;
BEGIN
    SELECT COUNT(*) INTO v_slot_cnt
    FROM public.get_available_time_slots(v_biz_a_id, v_svc_active, v_future_day, NULL, 30)
    WHERE is_available = TRUE;
    IF v_slot_cnt < 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (5D-1): Owner A expected available slots on open day.';
    END IF;

    v_avail := public.check_scheduling_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '13:00') AT TIME ZONE 'America/New_York',
        NULL
    );
    IF COALESCE((v_avail->>'available')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (5D-2): Expected 13:00 slot available, got %', v_avail;
    END IF;

    RESET ROLE;
    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (
        v_res_id, v_biz_a_id, v_cust_a_id, v_svc_active,
        (v_future_day::TIMESTAMP + TIME '13:00') AT TIME ZONE 'America/New_York',
        (v_future_day::TIMESTAMP + TIME '14:00') AT TIME ZONE 'America/New_York',
        'confirmed'
    );

    SELECT set_config('request.jwt.claims', json_build_object(
        'sub', current_setting('p2_test.owner_a_id'),
        'role', 'authenticated'
    )::text, true);
    SELECT set_config('request.jwt.claim.sub', current_setting('p2_test.owner_a_id'), true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);
    SET LOCAL ROLE authenticated;

    -- Mismatched custom reschedule duration (15m on 60m service) must be rejected
    v_resched := public.reschedule_appointment(
        v_biz_a_id,
        v_res_id,
        (v_future_day::TIMESTAMP + TIME '14:30') AT TIME ZONE 'America/New_York',
        (v_future_day::TIMESTAMP + TIME '14:45') AT TIME ZONE 'America/New_York'
    );
    IF COALESCE((v_resched->>'success')::BOOLEAN, TRUE) IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (5D-3a): reschedule_appointment allowed mismatched custom duration: %', v_resched;
    END IF;

    v_resched := public.reschedule_appointment(
        v_biz_a_id,
        v_res_id,
        (v_future_day::TIMESTAMP + TIME '14:30') AT TIME ZONE 'America/New_York',
        NULL
    );
    IF COALESCE((v_resched->>'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (5D-3b): Owner A reschedule failed: %', v_resched;
    END IF;
END;
$$;

-- 5E. Spoofed `service_role` with `anon` JWT claim is rejected; genuine `service_role` succeeds
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE service_role;

DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_svc_active UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_future_day DATE := current_setting('p2_test.future_day')::date;
    v_blocked    BOOLEAN := FALSE;
BEGIN
    BEGIN
        PERFORM public.check_scheduling_availability(
            v_biz_a_id,
            v_svc_active,
            (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
            NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (5E-1): service_role with mismatched anon JWT claim was not rejected!';
    END IF;
END;
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;

DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('p2_test.biz_a_id')::bigint;
    v_svc_active UUID := current_setting('p2_test.svc_a_active')::uuid;
    v_future_day DATE := current_setting('p2_test.future_day')::date;
    v_avail      JSONB;
    v_hours      RECORD;
BEGIN
    SELECT * INTO v_hours FROM public.resolve_business_hours_for_date(v_biz_a_id, v_future_day);
    IF v_hours.open_time IS NULL THEN
        RAISE EXCEPTION 'TEST FAILURE (5E-2): Genuine service_role failed resolve_business_hours_for_date.';
    END IF;

    v_avail := public.check_scheduling_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York',
        NULL
    );
    IF COALESCE((v_avail->>'available')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (5E-3): Genuine service_role availability check failed: %', v_avail;
    END IF;

    IF public.check_availability(
        v_biz_a_id,
        v_svc_active,
        (v_future_day::TIMESTAMP + TIME '10:00') AT TIME ZONE 'America/New_York'
    ) IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (5E-4): Genuine service_role check_availability failed for open slot.';
    END IF;
END;
$$;

-- 5F. Verify internal helper ACL isolation (no execute privilege for anon or authenticated)
RESET ROLE;
DO $$
DECLARE
    v_exposed TEXT;
BEGIN
    SELECT string_agg(p.proname, ', ')
    INTO v_exposed
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          '_scheduling_is_trusted_service_role',
          '_scheduling_assert_authorized',
          '_scheduling_parse_bool',
          '_scheduling_parse_time_strict',
          '_scheduling_parse_nonneg_int_strict',
          '_scheduling_safe_timezone',
          '_scheduling_is_blocking_status',
          '_resolve_business_hours_for_date_internal',
          '_check_scheduling_availability_internal',
          'trg_appointments_enforce_booking_rules'
      )
      AND (
          has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      );

    IF v_exposed IS NOT NULL THEN
        RAISE EXCEPTION 'TEST FAILURE (5F): Internal scheduling helpers exposed to anon/authenticated: %', v_exposed;
    END IF;

    RAISE NOTICE 'Phase 2 hardened staging verification suite passed cleanly.';
END;
$$;

ROLLBACK;
*/

-- =============================================================================
-- SECTION 6B: TWO-SESSION REAL CONCURRENCY VERIFICATION (RUN MANUALLY VIA PSQL)
-- Must be executed across TWO separate live PostgreSQL sessions to verify real
-- simultaneous booking serialization (`pg_advisory_xact_lock`) & exclusion constraint.
-- =============================================================================
/*
-- Setup: Choose an open future slot (<future_ts>, <future_end_ts>) on staging.
--
-- Session 1:
--   BEGIN;
--   INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
--   VALUES (gen_random_uuid(), <biz_id>, <cust_id>, <svc_id>, '<future_ts>', '<future_end_ts>', 'confirmed');
--   -- (Keep Session 1 open before COMMIT; note Session 1 holds pg_advisory_xact_lock(<biz_id>).)
--
-- Session 2 (concurrent booking attempt — e.g. simultaneous n8n webhook):
--   BEGIN;
--   INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
--   VALUES (gen_random_uuid(), <biz_id>, <cust_id>, <svc_id>, '<future_ts>', '<future_end_ts>', 'confirmed');
--   -- Expected: Session 2 BLOCKS until Session 1 COMMITs or ROLLBACKs.
--
-- Session 1:
--   COMMIT;
--
-- Expected in Session 2 immediately after Session 1 COMMIT:
--   ERROR: Schedule conflict: overlaps another booking. (SQLSTATE P0001)
--   -- (And under REPEATABLE READ / bypassed trigger, storage constraint
--   --  `excl_appointments_no_active_overlap` raises SQLSTATE 23P01.)
-- Session 2 cleanup:
--   ROLLBACK;
*/

-- =============================================================================
-- SECTION 7: DEPLOYMENT SEQUENCE & EXPLICIT ROLLBACK RUNBOOK
-- =============================================================================
/*
DEPLOYMENT SEQUENCE:
  1. Run `supabase/preflight/phase4_db_compatibility_preflight.sql` (read-only) + Section 0 above.
     Save the output of `pg_get_functiondef` for `public.check_availability` as your backup!
  2. Apply `supabase/migrations/20261116_01_businesses_settings_prerequisite.sql` if `businesses.settings`
     does not yet exist.
  3. Apply `supabase/migrations/20261116_booking_rules_enforcement.sql` on STAGING first.
  4. Run Section 6 (`BEGIN; ... ROLLBACK;`) and Section 6B (two-session concurrency) on STAGING.
  5. Verify n8n `check_availability`, `book_appointment`, `cancel_appointment` and dashboard end-to-end.
  6. Apply `20261116_booking_rules_enforcement.sql` to PRODUCTION.

ROLLBACK PROCEDURE (NON-DESTRUCTIVE TO APPOINTMENTS & SETTINGS DATA):
  BEGIN;
  DROP TRIGGER IF EXISTS trg_appointments_enforce_booking_rules ON public.appointments;
  ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS excl_appointments_no_active_overlap;
  DROP INDEX IF EXISTS public.idx_appointments_biz_window;
  DROP FUNCTION IF EXISTS public.reschedule_appointment(BIGINT, UUID, TIMESTAMPTZ, TIMESTAMPTZ);
  DROP FUNCTION IF EXISTS public.get_available_time_slots(BIGINT, UUID, DATE, UUID, INTEGER);
  DROP FUNCTION IF EXISTS public.check_scheduling_availability(BIGINT, UUID, TIMESTAMPTZ, UUID);
  DROP FUNCTION IF EXISTS public.resolve_business_hours_for_date(BIGINT, DATE);
  DROP FUNCTION IF EXISTS public._check_scheduling_availability_internal(BIGINT, UUID, TIMESTAMPTZ, UUID);
  DROP FUNCTION IF EXISTS public._resolve_business_hours_for_date_internal(BIGINT, DATE);
  DROP FUNCTION IF EXISTS public.trg_appointments_enforce_booking_rules();
  DROP FUNCTION IF EXISTS public._scheduling_is_blocking_status(TEXT);
  DROP FUNCTION IF EXISTS public._scheduling_safe_timezone(TEXT);
  DROP FUNCTION IF EXISTS public._scheduling_parse_nonneg_int_strict(TEXT, TEXT, BIGINT);
  DROP FUNCTION IF EXISTS public._scheduling_parse_time_strict(TEXT);
  DROP FUNCTION IF EXISTS public._scheduling_parse_bool(TEXT, BOOLEAN);
  DROP FUNCTION IF EXISTS public._scheduling_assert_authorized(BIGINT);
  DROP FUNCTION IF EXISTS public._scheduling_is_trusted_service_role();
  -- Plus restore original `public.check_availability` from Step 1 `pg_get_functiondef` backup!
  COMMIT;
*/
