-- =============================================================================
-- NOVACODE TECH — BOOKING NOTIFICATIONS MODULE (RELEASE A — FINAL HARDENED SQL)
-- Migration: 20261114_booking_notifications_release_a.sql
--
-- REVIEW ONLY — DO NOT AUTO-EXECUTE AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- AUTOMATED RECOVERY SCHEDULES IN SECTION 9 ARE UNACTIVATED BLUEPRINTS ONLY.
--
-- VERIFIED PRODUCTION SCHEMA CONTRACT:
--   - public.businesses.id:               BIGINT
--   - public.appointments.id:             UUID
--   - public.appointments.business_id:    BIGINT
--   - public.appointments.customer_id:    UUID
--   - public.appointments.service_id:     UUID
--   - public.appointments.start_time:     TIMESTAMPTZ
--   - public.appointments.end_time:       TIMESTAMPTZ
--   - public.appointments.updated_at:     TIMESTAMPTZ
--   - public.appointments.status:         TEXT / ENUM IN ('pending','confirmed','completed','cancelled','no_show')
--   - public.customers.id:                UUID
--   - public.customers.full_name:         TEXT
--   - public.services.id:                 UUID
--   - public.services.name:               TEXT
--   - public.services.duration_minutes:   INTEGER
--   - public.business_members.is_active:  BOOLEAN (nullable)
--   - public.support_incidents:           verified columns + defaults + constraints
--   - public.support_notifications:       verified columns + defaults for V3 incident fan-out
--
-- DESIGN HIGHLIGHTS (RELEASE A ONLY):
--   1. Direct typed queries against verified production columns (zero JSONB hacks).
--   2. Strict lifecycle emission:
--        - appointment_confirmed:   INSERT confirmed OR UPDATE non-confirmed -> confirmed
--        - appointment_cancelled:   INSERT cancelled OR UPDATE non-cancelled -> cancelled
--        - appointment_rescheduled: UPDATE confirmed -> confirmed when start_time or end_time changes
--      Existing/historical confirmed/pending rows are untouched on migration install.
--      pending/completed/no_show transitions never emit booking notifications.
--   3. Collision-proof Event Identity & Duplicate-Free Idempotency:
--        - Dedicated monotonic sequence public.booking_notification_event_seq
--        - Keys formatted as 'apt:<appointment_uuid>:<event_type>:seq:<event_seq>'
--        - Guarantees successive reschedules (even A->B->A->B in the same txn) never collide,
--          while duplicate Realtime deliveries & failure-recovery replays share the exact same key.
--   4. Per-Authenticated-User Read Receipts (public.booking_notification_reads):
--        - Strictly isolated per user_id; Super Admin & inactive/NULL memberships blocked.
--   5. Non-Blocking Bookings + Multi-Layer Monitoring (Including Double-Failure Fallback):
--        - Primary insert runs in isolated subtransaction (SAVEPOINT).
--        - Failure capture writes to public.booking_notification_failures AND independently
--          escalates to public.support_incidents (even if inserting into
--          booking_notification_failures ALSO fails), with a third fallback directly to
--          public.support_notifications + structured Postgres alert log.
--        - Recoverable via bounded-retry public.recover_failed_booking_notifications(INT, INT)
--          with exponential backoff, 'abandoned' exhaustion escalation, and zero duplicates.
--        - Observable via public.get_booking_notification_health().
--   6. Preserves all existing booking RPCs (book_appointment, check_availability,
--      cancel_appointment, can_book_appointments), V3 Support System, customer data, and n8n.
--      Release B customer messaging is NOT activated in this migration.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Non-Destructive Pre-Flight Production Schema, Defaults & Dependency Checks
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_col_type TEXT;
    v_missing TEXT := '';
    v_unexpected_required TEXT;
    v_missing_defaults TEXT;
BEGIN
    IF to_regclass('public.businesses') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.businesses table is required.';
    END IF;
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'id';
    IF v_col_type IS DISTINCT FROM 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight check failed: expected public.businesses.id BIGINT, found %.', COALESCE(v_col_type, 'missing');
    END IF;

    IF to_regclass('public.appointments') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.appointments table is required.';
    END IF;

    FOR v_col_type IN
        SELECT col
        FROM (VALUES
            ('id', 'uuid'),
            ('business_id', 'bigint'),
            ('customer_id', 'uuid'),
            ('service_id', 'uuid'),
            ('start_time', 'timestamp with time zone'),
            ('end_time', 'timestamp with time zone'),
            ('updated_at', 'timestamp with time zone')
        ) AS expected(col, expected_type)
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'appointments'
              AND c.column_name = expected.col
              AND c.data_type = expected.expected_type
        )
    LOOP
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'appointments.' || v_col_type;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'status'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'appointments.status';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'customers.id(uuid)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'full_name'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'customers.full_name';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'services.id(uuid)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'name'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'services.name';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'duration_minutes' AND data_type = 'integer'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'services.duration_minutes(integer)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'is_active' AND data_type = 'boolean'
    ) THEN
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'business_members.is_active(boolean)';
    END IF;

    -- Verify V3 support_incidents table, required columns, types, and defaults
    IF to_regclass('public.support_incidents') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.support_incidents table from V3 migration is required.';
    END IF;

    FOR v_col_type IN
        SELECT col
        FROM (VALUES
            ('id', 'uuid'),
            ('business_id', 'bigint'),
            ('source', 'text'),
            ('severity', 'text'),
            ('status', 'text'),
            ('title', 'text'),
            ('description', 'text'),
            ('error_code', 'text'),
            ('created_at', 'timestamp with time zone')
        ) AS expected(col, expected_type)
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'support_incidents'
              AND c.column_name = expected.col
              AND c.data_type = expected.expected_type
        )
    LOOP
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'support_incidents.' || v_col_type;
    END LOOP;

    -- Verify V3 support_notifications table (used by trg_support_incident_after_insert & Tier-3 fallback)
    IF to_regclass('public.support_notifications') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.support_notifications table from V3 migration is required.';
    END IF;

    FOR v_col_type IN
        SELECT col
        FROM (VALUES
            ('id', 'uuid'),
            ('business_id', 'bigint'),
            ('target_role', 'text'),
            ('incident_id', 'uuid'),
            ('title', 'text'),
            ('body', 'text'),
            ('is_read', 'boolean'),
            ('created_at', 'timestamp with time zone')
        ) AS expected(col, expected_type)
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'support_notifications'
              AND c.column_name = expected.col
              AND c.data_type = expected.expected_type
        )
    LOOP
        v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'support_notifications.' || v_col_type;
    END LOOP;

    IF v_missing <> '' THEN
        RAISE EXCEPTION 'Pre-flight check failed: missing or mismatched production columns: %', v_missing;
    END IF;

    -- Verify expected defaults on V3 support_incidents NOT NULL columns
    SELECT string_agg(c.column_name, ', ' ORDER BY c.ordinal_position)
    INTO v_missing_defaults
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'support_incidents'
      AND c.column_name IN ('id', 'source', 'severity', 'status', 'description', 'created_at')
      AND (c.column_default IS NULL OR c.is_nullable <> 'NO');

    IF v_missing_defaults IS NOT NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.support_incidents columns missing NOT NULL or DEFAULT: %', v_missing_defaults;
    END IF;

    -- Ensure NO unexpected NOT NULL columns without defaults exist on support_incidents
    -- (title is intentionally required without default and always supplied explicitly)
    SELECT string_agg(c.column_name || ' (' || c.data_type || ')', ', ' ORDER BY c.ordinal_position)
    INTO v_unexpected_required
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'support_incidents'
      AND c.is_nullable = 'NO'
      AND c.column_default IS NULL
      AND c.is_identity = 'NO'
      AND c.column_name NOT IN ('title');

    IF v_unexpected_required IS NOT NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.support_incidents has unpopulated required columns without defaults: %', v_unexpected_required;
    END IF;

    IF to_regprocedure('public.is_super_admin()') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.is_super_admin() is required.';
    END IF;

    IF to_regprocedure('public.support_is_active_business_member(bigint)') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.support_is_active_business_member(bigint) from V3 migration is required.';
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
-- 1. Monotonic Event Sequence & Tenant-Scoped Booking Notifications Table
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.booking_notification_event_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE IF NOT EXISTS public.booking_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_seq BIGINT NOT NULL UNIQUE DEFAULT nextval('public.booking_notification_event_seq'),
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'appointment_confirmed',
            'appointment_cancelled',
            'appointment_rescheduled'
        )
    ),
    idempotency_key TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL DEFAULT 'Customer',
    service_name TEXT NOT NULL DEFAULT 'Service',
    appointment_date TEXT,
    appointment_start_time TEXT,
    appointment_end_time TEXT,
    scheduled_start_at TIMESTAMPTZ,
    scheduled_end_at TIMESTAMPTZ,
    previous_start_at TIMESTAMPTZ,
    previous_end_at TIMESTAMPTZ,
    appointment_updated_at TIMESTAMPTZ,
    appointment_status TEXT NOT NULL CHECK (
        appointment_status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_notifications_biz_created
    ON public.booking_notifications (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_notifications_apt_created
    ON public.booking_notifications (appointment_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Per-Authenticated-User Read Receipts Table (Never Shared Across Users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_notification_reads (
    notification_id UUID NOT NULL REFERENCES public.booking_notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_notification_reads_user_biz
    ON public.booking_notification_reads (user_id, business_id, read_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Durable Booking Notification Failure Queue (Bounded Retries & Backoff)
-- -----------------------------------------------------------------------------
-- Stores NO routine customer PII (IDs + error telemetry only) and NO foreign keys
-- that could cause fallback error logging to abort during cascade/reference issues.
CREATE TABLE IF NOT EXISTS public.booking_notification_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_seq BIGINT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    business_id BIGINT NOT NULL,
    appointment_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'appointment_confirmed',
            'appointment_cancelled',
            'appointment_rescheduled'
        )
    ),
    appointment_status TEXT NOT NULL,
    scheduled_start_at TIMESTAMPTZ,
    scheduled_end_at TIMESTAMPTZ,
    previous_start_at TIMESTAMPTZ,
    previous_end_at TIMESTAMPTZ,
    appointment_updated_at TIMESTAMPTZ,
    error_sqlstate TEXT,
    error_message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recovered', 'abandoned')),
    attempt_count INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    recovered_notification_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recovered_at TIMESTAMPTZ
);

ALTER TABLE public.booking_notification_failures
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

ALTER TABLE public.booking_notification_failures
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.booking_notification_failures
    ADD COLUMN IF NOT EXISTS recovered_notification_id UUID;

CREATE INDEX IF NOT EXISTS idx_booking_notification_failures_retry
    ON public.booking_notification_failures (status, next_retry_at ASC, created_at ASC);

-- -----------------------------------------------------------------------------
-- 4. Read-Receipt Security Trigger (Server-Derived User & Business Ownership)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_booking_notification_reads_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_notif_business_id BIGINT;
    v_effective_role TEXT;
    v_is_trusted_backend BOOLEAN := FALSE;
BEGIN
    v_effective_role := COALESCE(
        NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
        session_user
    );

    v_is_trusted_backend := (
        v_uid IS NULL
        AND v_effective_role NOT IN ('authenticated', 'anon', 'PUBLIC', 'authenticator')
        AND (
            v_effective_role = 'service_role'
            OR v_effective_role = (
                SELECT pg_get_userbyid(c.relowner)
                FROM pg_class c
                WHERE c.oid = 'public.booking_notification_reads'::regclass
            )
            OR EXISTS (
                SELECT 1
                FROM pg_roles r
                WHERE r.rolname = v_effective_role
                  AND (r.rolsuper OR r.rolbypassrls)
            )
        )
    );

    IF v_uid IS NULL AND NOT v_is_trusted_backend THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user context required to mark booking notifications read';
    END IF;

    SELECT bn.business_id
    INTO v_notif_business_id
    FROM public.booking_notifications bn
    WHERE bn.id = NEW.notification_id;

    IF v_notif_business_id IS NULL THEN
        RAISE EXCEPTION 'Target booking notification does not exist';
    END IF;

    IF v_uid IS NOT NULL THEN
        IF public.is_super_admin() THEN
            RAISE EXCEPTION 'Forbidden: Super Admin accounts are excluded from routine booking notifications';
        END IF;

        IF NEW.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'Unauthorized: cannot mark booking notifications read on behalf of another user';
        END IF;

        IF NEW.business_id IS NOT NULL AND NEW.business_id IS DISTINCT FROM v_notif_business_id THEN
            RAISE EXCEPTION 'Unauthorized: notification read receipt business_id mismatch';
        END IF;

        -- V3 helper enforces bm.is_active = TRUE (rejecting FALSE and NULL) + active business
        IF NOT public.support_is_active_business_member(v_notif_business_id) THEN
            RAISE EXCEPTION 'Unauthorized: active business membership and active business required';
        END IF;

        NEW.user_id := v_uid;
    ELSIF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required for service-level notification read receipt inserts';
    END IF;

    NEW.business_id := v_notif_business_id;
    NEW.read_at := COALESCE(NEW.read_at, NOW());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_notification_reads_before_insert ON public.booking_notification_reads;
CREATE TRIGGER booking_notification_reads_before_insert
    BEFORE INSERT ON public.booking_notification_reads
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_booking_notification_reads_before_insert();

-- -----------------------------------------------------------------------------
-- 5. Internal Notification Hydrator, Multi-Layer Failure Monitor & Bounded Recovery
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._insert_booking_notification_payload(
    BIGINT, TEXT, BIGINT, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public._insert_booking_notification_payload(
    p_event_seq BIGINT,
    p_idempotency_key TEXT,
    p_business_id BIGINT,
    p_appointment_id UUID,
    p_customer_id UUID,
    p_service_id UUID,
    p_event_type TEXT,
    p_appointment_status TEXT,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_previous_start_at TIMESTAMPTZ,
    p_previous_end_at TIMESTAMPTZ,
    p_appointment_updated_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_biz_tz TEXT := 'UTC';
    v_raw_tz TEXT;
    v_customer_name TEXT;
    v_service_name TEXT;
    v_duration_minutes INTEGER := 60;
    v_resolved_end_at TIMESTAMPTZ;
    v_apt_date TEXT;
    v_apt_start_time TEXT;
    v_apt_end_time TEXT;
    v_notif_id UUID;
BEGIN
    SELECT NULLIF(TRIM(b.timezone), '')
    INTO v_raw_tz
    FROM public.businesses b
    WHERE b.id = p_business_id;

    IF v_raw_tz IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_timezone_names ptn WHERE ptn.name = v_raw_tz
    ) THEN
        v_biz_tz := v_raw_tz;
    END IF;

    IF p_customer_id IS NOT NULL THEN
        SELECT NULLIF(TRIM(c.full_name), '')
        INTO v_customer_name
        FROM public.customers c
        WHERE c.id = p_customer_id
          AND c.business_id = p_business_id;
    END IF;
    v_customer_name := COALESCE(v_customer_name, 'Customer');

    IF p_service_id IS NOT NULL THEN
        SELECT NULLIF(TRIM(s.name), ''),
               GREATEST(COALESCE(s.duration_minutes, 60), 1)
        INTO v_service_name, v_duration_minutes
        FROM public.services s
        WHERE s.id = p_service_id
          AND s.business_id = p_business_id;
    END IF;
    v_service_name := COALESCE(v_service_name, 'Service');
    v_duration_minutes := GREATEST(COALESCE(v_duration_minutes, 60), 1);

    IF p_start_time IS NOT NULL THEN
        v_resolved_end_at := COALESCE(
            p_end_time,
            p_start_time + make_interval(mins => v_duration_minutes)
        );
        v_apt_date := to_char(p_start_time AT TIME ZONE v_biz_tz, 'YYYY-MM-DD');
        v_apt_start_time := to_char(p_start_time AT TIME ZONE v_biz_tz, 'HH24:MI');
        v_apt_end_time := to_char(v_resolved_end_at AT TIME ZONE v_biz_tz, 'HH24:MI');
    ELSE
        v_resolved_end_at := p_end_time;
    END IF;

    INSERT INTO public.booking_notifications (
        event_seq,
        business_id,
        appointment_id,
        event_type,
        idempotency_key,
        customer_name,
        service_name,
        appointment_date,
        appointment_start_time,
        appointment_end_time,
        scheduled_start_at,
        scheduled_end_at,
        previous_start_at,
        previous_end_at,
        appointment_updated_at,
        appointment_status
    )
    VALUES (
        p_event_seq,
        p_business_id,
        p_appointment_id,
        p_event_type,
        p_idempotency_key,
        v_customer_name,
        v_service_name,
        v_apt_date,
        v_apt_start_time,
        v_apt_end_time,
        p_start_time,
        v_resolved_end_at,
        p_previous_start_at,
        p_previous_end_at,
        p_appointment_updated_at,
        p_appointment_status
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_notif_id;

    IF v_notif_id IS NULL THEN
        SELECT bn.id
        INTO v_notif_id
        FROM public.booking_notifications bn
        WHERE bn.idempotency_key = p_idempotency_key;
    END IF;

    RETURN v_notif_id;
END;
$$;

-- Non-blocking Appointments AFTER INSERT OR UPDATE Trigger with 3-Tier Failure Monitoring
CREATE OR REPLACE FUNCTION public.trg_appointments_emit_booking_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_status TEXT;
    v_old_status TEXT;
    v_event_type TEXT;
    v_event_seq BIGINT;
    v_idempotency_key TEXT;
    v_err_state TEXT;
    v_err_msg TEXT;
    v_dlq_recorded BOOLEAN := FALSE;
    v_dlq_err_state TEXT;
    v_dlq_err_msg TEXT;
    v_incident_recorded BOOLEAN := FALSE;
    v_inc_err_state TEXT;
    v_inc_err_msg TEXT;
    v_incident_title TEXT;
    v_incident_severity TEXT;
    v_incident_desc TEXT;
    v_incident_err_code TEXT;
BEGIN
    v_new_status := LOWER(TRIM(COALESCE(NEW.status::TEXT, '')));
    v_old_status := CASE
        WHEN TG_OP = 'UPDATE' THEN LOWER(TRIM(COALESCE(OLD.status::TEXT, '')))
        ELSE NULL
    END;

    -- Lifecycle transition rules (permitted production statuses:
    -- pending, confirmed, completed, cancelled, no_show):
    --   1. Confirmed notifications only when becoming 'confirmed'.
    --   2. Cancellation notifications on transitions to 'cancelled'.
    --   3. Rescheduling notifications when 'confirmed' changes start_time or end_time.
    IF v_new_status = 'confirmed'
       AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'confirmed') THEN
        v_event_type := 'appointment_confirmed';
    ELSIF v_new_status = 'cancelled'
       AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'cancelled') THEN
        v_event_type := 'appointment_cancelled';
    ELSIF TG_OP = 'UPDATE'
       AND v_old_status = 'confirmed'
       AND v_new_status = 'confirmed'
       AND (
           NEW.start_time IS DISTINCT FROM OLD.start_time
           OR NEW.end_time IS DISTINCT FROM OLD.end_time
       ) THEN
        v_event_type := 'appointment_rescheduled';
    ELSE
        RETURN NEW;
    END IF;

    -- Draw globally monotonic sequence token before subtransaction so successive
    -- reschedules always have distinct keys and failure recovery shares the exact key.
    v_event_seq := nextval('public.booking_notification_event_seq');
    v_idempotency_key := format('apt:%s:%s:seq:%s', NEW.id, v_event_type, v_event_seq);

    -- Tier 0 (Primary Delivery): Isolated subtransaction so booking never rolls back
    BEGIN
        PERFORM public._insert_booking_notification_payload(
            v_event_seq,
            v_idempotency_key,
            NEW.business_id,
            NEW.id,
            NEW.customer_id,
            NEW.service_id,
            v_event_type,
            v_new_status,
            NEW.start_time,
            NEW.end_time,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.start_time ELSE NULL END,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.end_time ELSE NULL END,
            NEW.updated_at
        );
        RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
        v_err_state := SQLSTATE;
        v_err_msg := SQLERRM;
    END;

    RAISE WARNING 'booking_notifications delivery failed for appointment % (key=%, SQLSTATE=%): %',
        NEW.id, v_idempotency_key, v_err_state, v_err_msg;

    -- Tier 1 (Dead-Letter Capture): Isolated subtransaction for bounded recovery queue
    BEGIN
        INSERT INTO public.booking_notification_failures (
            event_seq,
            idempotency_key,
            business_id,
            appointment_id,
            event_type,
            appointment_status,
            scheduled_start_at,
            scheduled_end_at,
            previous_start_at,
            previous_end_at,
            appointment_updated_at,
            error_sqlstate,
            error_message,
            status,
            attempt_count,
            max_attempts,
            next_retry_at
        )
        VALUES (
            v_event_seq,
            v_idempotency_key,
            NEW.business_id,
            NEW.id,
            v_event_type,
            v_new_status,
            NEW.start_time,
            NEW.end_time,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.start_time ELSE NULL END,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.end_time ELSE NULL END,
            NEW.updated_at,
            v_err_state,
            v_err_msg,
            'pending',
            1,
            5,
            NOW()
        )
        ON CONFLICT (idempotency_key) DO NOTHING;

        v_dlq_recorded := TRUE;
    EXCEPTION WHEN OTHERS THEN
        v_dlq_recorded := FALSE;
        v_dlq_err_state := SQLSTATE;
        v_dlq_err_msg := SQLERRM;
        RAISE WARNING 'booking_notification_failures insert failed (key=%, SQLSTATE=%): %',
            v_idempotency_key, v_dlq_err_state, v_dlq_err_msg;
    END;

    -- Tier 2 (Super Admin Alert Incident): Runs in an INDEPENDENT subtransaction so it
    -- ALWAYS fires even when Tier 1 (booking_notification_failures) ALSO failed.
    BEGIN
        IF v_dlq_recorded THEN
            v_incident_title := 'Booking notification delivery failure';
            v_incident_severity := 'high';
            v_incident_err_code := v_err_state;
            v_incident_desc := format(
                'Failed to emit in-app booking notification (%s) for appointment %s (%s). SQLSTATE=%s (%s). Queued in booking_notification_failures for bounded recovery.',
                v_idempotency_key,
                NEW.id,
                v_event_type,
                v_err_state,
                LEFT(COALESCE(v_err_msg, ''), 240)
            );
        ELSE
            v_incident_title := 'Booking notification failure & dead-letter queue failure';
            v_incident_severity := 'critical';
            v_incident_err_code := COALESCE(v_dlq_err_state, v_err_state);
            v_incident_desc := format(
                'DOUBLE FAILURE: booking notification delivery (%s) for appointment %s (%s) failed [%s: %s] AND dead-letter queue insert ALSO failed [%s: %s]. Manual replay required.',
                v_idempotency_key,
                NEW.id,
                v_event_type,
                v_err_state,
                LEFT(COALESCE(v_err_msg, ''), 180),
                v_dlq_err_state,
                LEFT(COALESCE(v_dlq_err_msg, ''), 180)
            );
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.support_incidents si
            WHERE si.business_id IS NOT DISTINCT FROM NEW.business_id
              AND si.status IN ('open', 'investigating')
              AND si.title = v_incident_title
        ) THEN
            INSERT INTO public.support_incidents (
                id,
                business_id,
                source,
                severity,
                status,
                title,
                description,
                error_code,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                NEW.business_id,
                'technical_error',
                v_incident_severity,
                'open',
                v_incident_title,
                v_incident_desc,
                v_incident_err_code,
                NOW()
            );
        END IF;

        v_incident_recorded := TRUE;
    EXCEPTION WHEN OTHERS THEN
        v_incident_recorded := FALSE;
        v_inc_err_state := SQLSTATE;
        v_inc_err_msg := SQLERRM;
    END;

    -- Tier 3 (Last-Resort Super Admin Notification + Structured Monitoring Log):
    -- Guarantees observability even under a triple failure (notification + DLQ + support_incidents).
    IF NOT v_incident_recorded THEN
        BEGIN
            INSERT INTO public.support_notifications (
                business_id,
                target_role,
                title,
                body,
                is_read,
                created_at
            )
            VALUES (
                NEW.business_id,
                'super_admin',
                'CRITICAL: Booking Notification Monitoring Failure',
                format(
                    'Notification (%s) and support_incidents failed for appointment %s. DLQ recorded=%s. Primary=%s; Incident=%s.',
                    v_idempotency_key,
                    NEW.id,
                    v_dlq_recorded,
                    v_err_state,
                    v_inc_err_state
                ),
                FALSE,
                NOW()
            );
        EXCEPTION WHEN OTHERS THEN
            -- Even if support_notifications also fails, fall through to structured Postgres log
            NULL;
        END;
    END IF;

    IF NOT v_dlq_recorded OR NOT v_incident_recorded THEN
        RAISE LOG '[NOVACODE_MONITOR:BOOKING_NOTIFICATION_FAILURE] payload=%',
            json_build_object(
                'event_seq', v_event_seq,
                'idempotency_key', v_idempotency_key,
                'business_id', NEW.business_id,
                'appointment_id', NEW.id,
                'event_type', v_event_type,
                'primary_sqlstate', v_err_state,
                'dlq_recorded', v_dlq_recorded,
                'dlq_sqlstate', v_dlq_err_state,
                'incident_recorded', v_incident_recorded,
                'incident_sqlstate', v_inc_err_state
            )::text;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_emit_booking_notification ON public.appointments;
CREATE TRIGGER appointments_emit_booking_notification
    AFTER INSERT OR UPDATE ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_appointments_emit_booking_notification();

-- Service-role / Super Admin bounded recovery function with backoff & exhaustion alerts
DROP FUNCTION IF EXISTS public.recover_failed_booking_notifications(INTEGER);
DROP FUNCTION IF EXISTS public.recover_failed_booking_notifications(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.recover_failed_booking_notifications(
    p_limit INTEGER DEFAULT 50,
    p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE (
    recovered_count INTEGER,
    rescheduled_count INTEGER,
    abandoned_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rec RECORD;
    v_apt_customer_id UUID;
    v_apt_service_id UUID;
    v_existing_notif_id UUID;
    v_notif_id UUID;
    v_effective_max INTEGER;
    v_next_attempt INTEGER;
    v_backoff_mins INTEGER;
    v_err_state TEXT;
    v_err_msg TEXT;
    v_recovered INTEGER := 0;
    v_rescheduled INTEGER := 0;
    v_abandoned INTEGER := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized: only service_role or Super Admin can invoke booking notification recovery';
    END IF;

    FOR v_rec IN
        SELECT f.*
        FROM public.booking_notification_failures f
        WHERE f.status = 'pending'
          AND f.next_retry_at <= NOW()
        ORDER BY f.next_retry_at ASC, f.created_at ASC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
        FOR UPDATE SKIP LOCKED
    LOOP
        v_effective_max := LEAST(GREATEST(COALESCE(p_max_attempts, v_rec.max_attempts, 5), 1), 20);

        BEGIN
            -- Duplicate-free guard: if already present by idempotency_key, reconcile cleanly
            SELECT bn.id
            INTO v_existing_notif_id
            FROM public.booking_notifications bn
            WHERE bn.idempotency_key = v_rec.idempotency_key;

            IF v_existing_notif_id IS NOT NULL THEN
                UPDATE public.booking_notification_failures
                SET status = 'recovered',
                    recovered_at = NOW(),
                    recovered_notification_id = v_existing_notif_id,
                    last_attempt_at = NOW(),
                    last_error = NULL
                WHERE id = v_rec.id;

                v_recovered := v_recovered + 1;
                CONTINUE;
            END IF;

            SELECT a.customer_id, a.service_id
            INTO v_apt_customer_id, v_apt_service_id
            FROM public.appointments a
            WHERE a.id = v_rec.appointment_id
              AND a.business_id = v_rec.business_id;

            IF NOT FOUND THEN
                UPDATE public.booking_notification_failures
                SET status = 'abandoned',
                    attempt_count = attempt_count + 1,
                    last_attempt_at = NOW(),
                    last_error = 'Target appointment no longer exists'
                WHERE id = v_rec.id;

                v_abandoned := v_abandoned + 1;
                CONTINUE;
            END IF;

            v_notif_id := public._insert_booking_notification_payload(
                v_rec.event_seq,
                v_rec.idempotency_key,
                v_rec.business_id,
                v_rec.appointment_id,
                v_apt_customer_id,
                v_apt_service_id,
                v_rec.event_type,
                v_rec.appointment_status,
                v_rec.scheduled_start_at,
                v_rec.scheduled_end_at,
                v_rec.previous_start_at,
                v_rec.previous_end_at,
                v_rec.appointment_updated_at
            );

            UPDATE public.booking_notification_failures
            SET status = 'recovered',
                attempt_count = attempt_count + 1,
                last_attempt_at = NOW(),
                recovered_at = NOW(),
                recovered_notification_id = v_notif_id,
                last_error = NULL
            WHERE id = v_rec.id;

            v_recovered := v_recovered + 1;
        EXCEPTION WHEN OTHERS THEN
            v_err_state := SQLSTATE;
            v_err_msg := SQLERRM;
            v_next_attempt := v_rec.attempt_count + 1;

            IF v_next_attempt >= v_effective_max THEN
                UPDATE public.booking_notification_failures
                SET status = 'abandoned',
                    attempt_count = v_next_attempt,
                    last_attempt_at = NOW(),
                    last_error = v_err_msg
                WHERE id = v_rec.id;

                -- Escalate bounded-retry exhaustion to Super Admin (isolated subtransaction)
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM public.support_incidents si
                        WHERE si.business_id IS NOT DISTINCT FROM v_rec.business_id
                          AND si.status IN ('open', 'investigating')
                          AND si.title = 'Booking notification recovery exhausted (abandoned)'
                    ) THEN
                        INSERT INTO public.support_incidents (
                            id,
                            business_id,
                            source,
                            severity,
                            status,
                            title,
                            description,
                            error_code,
                            created_at
                        )
                        VALUES (
                            gen_random_uuid(),
                            v_rec.business_id,
                            'technical_error',
                            'critical',
                            'open',
                            'Booking notification recovery exhausted (abandoned)',
                            format(
                                'Bounded retry limit (%s attempts) exhausted for notification %s (appointment %s). Last SQLSTATE=%s (%s).',
                                v_effective_max,
                                v_rec.idempotency_key,
                                v_rec.appointment_id,
                                v_err_state,
                                LEFT(COALESCE(v_err_msg, ''), 240)
                            ),
                            v_err_state,
                            NOW()
                        );
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    RAISE LOG '[NOVACODE_MONITOR:BOOKING_NOTIFICATION_ABANDONED] key=% sqlstate=%',
                        v_rec.idempotency_key, v_err_state;
                END;

                v_abandoned := v_abandoned + 1;
            ELSE
                -- Bounded exponential backoff: 1m, 2m, 4m, 8m, ..., capped at 60m
                v_backoff_mins := LEAST(POWER(2, LEAST(GREATEST(v_next_attempt - 1, 0), 6))::INTEGER, 60);

                UPDATE public.booking_notification_failures
                SET attempt_count = v_next_attempt,
                    last_attempt_at = NOW(),
                    next_retry_at = NOW() + make_interval(mins => v_backoff_mins),
                    last_error = v_err_msg
                WHERE id = v_rec.id;

                v_rescheduled := v_rescheduled + 1;
            END IF;
        END;
    END LOOP;

    recovered_count := v_recovered;
    rescheduled_count := v_rescheduled;
    abandoned_count := v_abandoned;
    RETURN NEXT;
END;
$$;

-- Super Admin & Monitoring Health RPC (Zero customer PII; aggregate observability)
CREATE OR REPLACE FUNCTION public.get_booking_notification_health()
RETURNS TABLE (
    pending_failures BIGINT,
    due_for_retry BIGINT,
    abandoned_failures BIGINT,
    recovered_24h BIGINT,
    oldest_pending_age_seconds NUMERIC,
    open_notification_incidents BIGINT,
    critical_double_failure_incidents BIGINT,
    latest_failure_at TIMESTAMPTZ,
    health_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pending BIGINT := 0;
    v_due BIGINT := 0;
    v_abandoned BIGINT := 0;
    v_recovered BIGINT := 0;
    v_oldest_age NUMERIC := 0;
    v_open_incidents BIGINT := 0;
    v_critical_incidents BIGINT := 0;
    v_latest TIMESTAMPTZ;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Forbidden: Super Admin access required for booking notification health';
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE status = 'pending'),
        COUNT(*) FILTER (WHERE status = 'pending' AND next_retry_at <= NOW()),
        COUNT(*) FILTER (WHERE status = 'abandoned'),
        COUNT(*) FILTER (WHERE status = 'recovered' AND recovered_at >= NOW() - INTERVAL '24 hours'),
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending'))), 0),
        MAX(created_at)
    INTO v_pending, v_due, v_abandoned, v_recovered, v_oldest_age, v_latest
    FROM public.booking_notification_failures;

    SELECT
        COUNT(*) FILTER (
            WHERE status IN ('open', 'investigating')
              AND title IN (
                  'Booking notification delivery failure',
                  'Booking notification failure & dead-letter queue failure',
                  'Booking notification recovery exhausted (abandoned)'
              )
        ),
        COUNT(*) FILTER (
            WHERE status IN ('open', 'investigating')
              AND title IN (
                  'Booking notification failure & dead-letter queue failure',
                  'Booking notification recovery exhausted (abandoned)'
              )
        )
    INTO v_open_incidents, v_critical_incidents
    FROM public.support_incidents;

    pending_failures := v_pending;
    due_for_retry := v_due;
    abandoned_failures := v_abandoned;
    recovered_24h := v_recovered;
    oldest_pending_age_seconds := ROUND(GREATEST(v_oldest_age, 0), 2);
    open_notification_incidents := v_open_incidents;
    critical_double_failure_incidents := v_critical_incidents;
    latest_failure_at := v_latest;
    health_status := CASE
        WHEN v_critical_incidents > 0 OR v_abandoned > 0 OR v_oldest_age > 900 THEN 'critical'
        WHEN v_pending > 0 OR v_open_incidents > 0 THEN 'degraded'
        ELSE 'healthy'
    END;
    RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Function Ownership, EXECUTE Lockdown, search_path Audit & Table Grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.trg_booking_notification_reads_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._insert_booking_notification_payload(
    BIGINT, TEXT, BIGINT, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_appointments_emit_booking_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_failed_booking_notifications(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_failed_booking_notifications(INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.get_booking_notification_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_notification_health() TO authenticated, service_role;

DO $$
DECLARE
    v_fn RECORD;
    v_table_owner TEXT;
    v_fn_owner_privileged BOOLEAN := FALSE;
BEGIN
    SELECT pg_get_userbyid(relowner) INTO v_table_owner
    FROM pg_class
    WHERE oid = 'public.booking_notifications'::regclass;

    FOR v_fn IN
        SELECT p.oid::regprocedure::text AS sig,
               pg_get_userbyid(p.proowner) AS fn_owner,
               p.proconfig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'trg_booking_notification_reads_before_insert',
              '_insert_booking_notification_payload',
              'trg_appointments_emit_booking_notification',
              'recover_failed_booking_notifications',
              'get_booking_notification_health'
          )
          AND p.prosecdef = TRUE
    LOOP
        IF v_fn.proconfig IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM unnest(v_fn.proconfig) cfg
               WHERE cfg LIKE 'search_path=%'
           ) THEN
            RAISE EXCEPTION 'Security audit failed: SECURITY DEFINER function % lacks pinned search_path', v_fn.sig;
        END IF;

        IF v_fn.fn_owner IS DISTINCT FROM v_table_owner THEN
            IF pg_has_role(current_user, v_table_owner, 'MEMBER') THEN
                EXECUTE format('ALTER FUNCTION %s OWNER TO %I', v_fn.sig, v_table_owner);
            ELSE
                SELECT COALESCE(r.rolsuper OR r.rolbypassrls, FALSE)
                INTO v_fn_owner_privileged
                FROM pg_roles r
                WHERE r.rolname = v_fn.fn_owner;

                IF NOT v_fn_owner_privileged THEN
                    RAISE EXCEPTION 'Security audit failed: SECURITY DEFINER function % owner (%) differs from table owner (%) and lacks BYPASSRLS',
                        v_fn.sig, v_fn.fn_owner, v_table_owner;
                END IF;
            END IF;
        END IF;
    END LOOP;
END
$$;

REVOKE ALL ON SEQUENCE public.booking_notification_event_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.booking_notification_event_seq TO service_role;

REVOKE ALL ON TABLE public.booking_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.booking_notification_reads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.booking_notification_failures FROM PUBLIC, anon, authenticated;

-- Least-privilege table grants:
-- - booking_notifications: read-only for active business members (RLS scoped)
-- - booking_notification_reads: per-user SELECT & INSERT only (trigger + RLS scoped)
-- - booking_notification_failures: read-only for verified Super Admins (RLS scoped)
GRANT SELECT ON TABLE public.booking_notifications TO authenticated;
GRANT SELECT, INSERT ON TABLE public.booking_notification_reads TO authenticated;
GRANT SELECT ON TABLE public.booking_notification_failures TO authenticated;

GRANT ALL ON TABLE public.booking_notifications TO service_role;
GRANT ALL ON TABLE public.booking_notification_reads TO service_role;
GRANT ALL ON TABLE public.booking_notification_failures TO service_role;

-- -----------------------------------------------------------------------------
-- 7. Strict Multi-Tenant RLS Policies (Super Admin Excluded from Bookings)
-- -----------------------------------------------------------------------------
ALTER TABLE public.booking_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_notification_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members view own booking notifications" ON public.booking_notifications;
CREATE POLICY "Business members view own booking notifications" ON public.booking_notifications
    FOR SELECT TO authenticated
    USING (
        NOT public.is_super_admin()
        AND public.support_is_active_business_member(business_id)
    );

DROP POLICY IF EXISTS "Users view own booking notification reads" ON public.booking_notification_reads;
CREATE POLICY "Users view own booking notification reads" ON public.booking_notification_reads
    FOR SELECT TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND user_id = auth.uid()
        AND NOT public.is_super_admin()
        AND public.support_is_active_business_member(business_id)
    );

DROP POLICY IF EXISTS "Users insert own booking notification reads" ON public.booking_notification_reads;
CREATE POLICY "Users insert own booking notification reads" ON public.booking_notification_reads
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND user_id = auth.uid()
        AND NOT public.is_super_admin()
        AND public.support_is_active_business_member(business_id)
    );

DROP POLICY IF EXISTS "Super admins view booking notification failures" ON public.booking_notification_failures;
CREATE POLICY "Super admins view booking notification failures" ON public.booking_notification_failures
    FOR SELECT TO authenticated
    USING (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 8. Supabase Realtime Publication Configuration
-- -----------------------------------------------------------------------------
ALTER TABLE public.booking_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.booking_notification_reads REPLICA IDENTITY FULL;

DO $$
DECLARE
    v_tbl TEXT;
    v_tables TEXT[] := ARRAY[
        'booking_notifications',
        'booking_notification_reads'
    ];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH v_tbl IN ARRAY v_tables LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = v_tbl
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tbl);
            END IF;
        END LOOP;
    END IF;
END
$$;

COMMIT;

-- =============================================================================
-- 9. UNACTIVATED AUTOMATED RECOVERY SCHEDULE DESIGN (DO NOT ACTIVATE YET)
--
-- Approve Release A production deployment first, verify pg_cron or n8n secret
-- readiness, and ONLY THEN activate ONE of the two options below.
--
-- -----------------------------------------------------------------------------
-- OPTION A: Supabase pg_cron (Database-Native Scheduled Recovery — UNACTIVATED)
-- -----------------------------------------------------------------------------
-- Step 1 (Check availability first; do NOT assume pg_cron is enabled):
--   SELECT name, default_version, installed_version
--   FROM pg_available_extensions
--   WHERE name = 'pg_cron';
--
-- Step 2 (After approval & confirming pg_cron extension exists):
--   SELECT cron.schedule(
--       'recover-booking-notifications-release-a',
--       '*/2 * * * *',
--       $$SELECT * FROM public.recover_failed_booking_notifications(50, 5);$$
--   );
--
-- Rollback / Disable command:
--   SELECT cron.unschedule('recover-booking-notifications-release-a');
--
-- -----------------------------------------------------------------------------
-- OPTION B: Existing n8n Infrastructure Workflow (Recommended if pg_cron disabled
--           or when external Slack/Email alerting on critical incidents is needed)
-- -----------------------------------------------------------------------------
-- Workflow Name: [Release A] Booking Notification Recovery & Health Monitor
-- Trigger Node:  Schedule Trigger -> Every 2 minutes (cron: */2 * * * *)
-- Node 1 (HTTP Request — Recovery Replay):
--   POST https://qgklruiwtsdjpbwmlgic.supabase.co/rest/v1/rpc/recover_failed_booking_notifications
--   Headers:
--     apikey:        <SUPABASE_SERVICE_ROLE_KEY>
--     Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
--     Content-Type:  application/json
--   Body:
--     { "p_limit": 50, "p_max_attempts": 5 }
-- Node 2 (HTTP Request — Health & Double-Failure Check):
--   POST https://qgklruiwtsdjpbwmlgic.supabase.co/rest/v1/rpc/get_booking_notification_health
--   Headers:
--     apikey:        <SUPABASE_SERVICE_ROLE_KEY>
--     Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
-- Node 3 (IF Alert Condition):
--   Trigger ops alert (Email / Slack / Webhook) if:
--     health_status === 'critical'
--     OR abandoned_failures > 0
--     OR critical_double_failure_incidents > 0
--     OR pending_failures >= 10
--   Note: Bounded by max_attempts=5 + exponential backoff (1m, 2m, 4m, 8m) and
--   ON CONFLICT (idempotency_key) DO NOTHING + FOR UPDATE SKIP LOCKED, so concurrent
--   n8n/pg_cron ticks CANNOT produce duplicate booking notifications.
-- =============================================================================

-- =============================================================================
-- 10. EXECUTABLE POSTGRESQL INTEGRATION TEST SUITE (COMMENTED — STAGING ONLY)
--
-- Kept inside a block comment so applying this migration never writes test rows.
-- Execute in staging or local PostgreSQL AFTER installing V3 + Release A as a
-- privileged role (`postgres`); uses top-level role switches & ends with ROLLBACK.
-- =============================================================================
/*
BEGIN;

-- -----------------------------------------------------------------------------
-- Fixture Setup (Privileged Role; Rolled Back Completely at End)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_super_admin_id      UUID := '00000000-0000-4000-8000-000000000201';
    v_owner_a_id          UUID := '00000000-0000-4000-8000-000000000202';
    v_staff_a_id          UUID := '00000000-0000-4000-8000-000000000203';
    v_inactive_staff_a_id UUID := '00000000-0000-4000-8000-000000000204';
    v_null_staff_a_id     UUID := '00000000-0000-4000-8000-000000000205';
    v_owner_b_id          UUID := '00000000-0000-4000-8000-000000000206';
    v_owner_c_id          UUID := '00000000-0000-4000-8000-000000000207';
    v_biz_a_id            BIGINT;
    v_biz_b_id            BIGINT;
    v_biz_c_id            BIGINT;
    v_cust_a_id           UUID;
    v_cust_b_id           UUID;
    v_svc_a_id            UUID;
    v_svc_b_id            UUID;
    v_has_biz_active_col  BOOLEAN := FALSE;
BEGIN
    INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    VALUES
        (v_super_admin_id,      'authenticated', 'authenticated', 'ra-test-superadmin@novacode.tech', NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Platform Admin"}'::jsonb),
        (v_owner_a_id,          'authenticated', 'authenticated', 'ra-test-owner-a@salonnaomi.com',  NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Naomi Owner"}'::jsonb),
        (v_staff_a_id,          'authenticated', 'authenticated', 'ra-test-staff-a@salonnaomi.com',  NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Stylist Staff"}'::jsonb),
        (v_inactive_staff_a_id, 'authenticated', 'authenticated', 'ra-test-inactive@salonnaomi.com', NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Former Staff"}'::jsonb),
        (v_null_staff_a_id,     'authenticated', 'authenticated', 'ra-test-null@salonnaomi.com',     NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Pending Invite"}'::jsonb),
        (v_owner_b_id,          'authenticated', 'authenticated', 'ra-test-owner-b@otherbiz.com',    NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Other Owner"}'::jsonb),
        (v_owner_c_id,          'authenticated', 'authenticated', 'ra-test-owner-c@inactive.com',    NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Suspended Owner"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.platform_admins (user_id)
    VALUES (v_super_admin_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.businesses (name, timezone) VALUES ('__ra_test_salon_a__', 'America/New_York') RETURNING id INTO v_biz_a_id;
    INSERT INTO public.businesses (name, timezone) VALUES ('__ra_test_other_b__', 'UTC') RETURNING id INTO v_biz_b_id;
    INSERT INTO public.businesses (name, timezone) VALUES ('__ra_test_inactive_c__', 'UTC') RETURNING id INTO v_biz_c_id;

    -- Deactivate Business C using whichever active/status column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='is_active') THEN
        EXECUTE 'UPDATE public.businesses SET is_active = FALSE WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='active') THEN
        EXECUTE 'UPDATE public.businesses SET active = FALSE WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='status') THEN
        EXECUTE 'UPDATE public.businesses SET status = ''inactive'' WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='deleted_at') THEN
        EXECUTE 'UPDATE public.businesses SET deleted_at = NOW() WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    END IF;

    INSERT INTO public.business_members (business_id, user_id, role, is_active)
    VALUES
        (v_biz_a_id, v_owner_a_id,          'owner', TRUE),
        (v_biz_a_id, v_staff_a_id,          'staff', TRUE),
        (v_biz_a_id, v_inactive_staff_a_id, 'staff', FALSE),
        (v_biz_a_id, v_null_staff_a_id,     'staff', NULL),
        (v_biz_b_id, v_owner_b_id,          'owner', TRUE),
        (v_biz_c_id, v_owner_c_id,          'owner', TRUE);

    INSERT INTO public.customers (id, business_id, full_name)
    VALUES (gen_random_uuid(), v_biz_a_id, 'Camila Rivera')
    RETURNING id INTO v_cust_a_id;

    INSERT INTO public.customers (id, business_id, full_name)
    VALUES (gen_random_uuid(), v_biz_b_id, 'Marcus Lee')
    RETURNING id INTO v_cust_b_id;

    INSERT INTO public.services (id, business_id, name, duration_minutes)
    VALUES (gen_random_uuid(), v_biz_a_id, 'Silk Press & Trim', 45)
    RETURNING id INTO v_svc_a_id;

    INSERT INTO public.services (id, business_id, name, duration_minutes)
    VALUES (gen_random_uuid(), v_biz_b_id, 'Classic Fade', 30)
    RETURNING id INTO v_svc_b_id;

    PERFORM set_config('ra_test.super_admin_id',      v_super_admin_id::text, true);
    PERFORM set_config('ra_test.owner_a_id',          v_owner_a_id::text, true);
    PERFORM set_config('ra_test.staff_a_id',          v_staff_a_id::text, true);
    PERFORM set_config('ra_test.inactive_staff_a_id', v_inactive_staff_a_id::text, true);
    PERFORM set_config('ra_test.null_staff_a_id',     v_null_staff_a_id::text, true);
    PERFORM set_config('ra_test.owner_b_id',          v_owner_b_id::text, true);
    PERFORM set_config('ra_test.owner_c_id',          v_owner_c_id::text, true);
    PERFORM set_config('ra_test.biz_a_id',            v_biz_a_id::text, true);
    PERFORM set_config('ra_test.biz_b_id',            v_biz_b_id::text, true);
    PERFORM set_config('ra_test.biz_c_id',            v_biz_c_id::text, true);
    PERFORM set_config('ra_test.cust_a_id',           v_cust_a_id::text, true);
    PERFORM set_config('ra_test.cust_b_id',           v_cust_b_id::text, true);
    PERFORM set_config('ra_test.svc_a_id',            v_svc_a_id::text, true);
    PERFORM set_config('ra_test.svc_b_id',            v_svc_b_id::text, true);
    PERFORM set_config('ra_test.has_biz_active_col',  v_has_biz_active_col::text, true);
END
$$;

-- -----------------------------------------------------------------------------
-- Test 1: Trigger Lifecycle & Collision-Free Sequential Rescheduling
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_a_id BIGINT := current_setting('ra_test.biz_a_id')::bigint;
    v_cust_a_id UUID := current_setting('ra_test.cust_a_id')::uuid;
    v_svc_a_id UUID := current_setting('ra_test.svc_a_id')::uuid;
    v_apt_1 UUID := gen_random_uuid();
    v_apt_2 UUID := gen_random_uuid();
    v_count INT;
    v_distinct_keys INT;
    v_rec RECORD;
BEGIN
    -- 1A. pending INSERT -> 0 notifications
    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (v_apt_1, v_biz_a_id, v_cust_a_id, v_svc_a_id, '2026-12-01 15:00:00+00'::timestamptz, '2026-12-01 15:45:00+00'::timestamptz, 'pending');

    SELECT COUNT(*) INTO v_count FROM public.booking_notifications WHERE appointment_id = v_apt_1;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1A): expected 0 notifications for pending insert, got %', v_count;
    END IF;

    -- 1B. pending -> confirmed -> 1 hydrated notification in America/New_York (UTC-5 in Dec -> 10:00..10:45)
    UPDATE public.appointments SET status = 'confirmed' WHERE id = v_apt_1;
    SELECT * INTO v_rec FROM public.booking_notifications WHERE appointment_id = v_apt_1 AND event_type = 'appointment_confirmed';
    IF v_rec.id IS NULL OR v_rec.customer_name <> 'Camila Rivera' OR v_rec.service_name <> 'Silk Press & Trim'
       OR v_rec.appointment_date <> '2026-12-01' OR v_rec.appointment_start_time <> '10:00' THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1B): hydrated notification mismatch (%)', row_to_json(v_rec);
    END IF;

    PERFORM set_config('ra_test.notif_1_id', v_rec.id::text, true);

    -- 1C. Non-schedule update on confirmed row -> 0 extra notifications
    UPDATE public.appointments SET updated_at = NOW() WHERE id = v_apt_1;
    SELECT COUNT(*) INTO v_count FROM public.booking_notifications WHERE appointment_id = v_apt_1;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1C): non-schedule update emitted extra notification (count=%)', v_count;
    END IF;

    -- 1D. Successive reschedules (A -> B -> A -> B inside same txn) produce 3 unique keys
    UPDATE public.appointments SET start_time = '2026-12-01 17:00:00+00'::timestamptz, end_time = '2026-12-01 17:45:00+00'::timestamptz WHERE id = v_apt_1;
    UPDATE public.appointments SET start_time = '2026-12-01 15:00:00+00'::timestamptz, end_time = '2026-12-01 15:45:00+00'::timestamptz WHERE id = v_apt_1;
    UPDATE public.appointments SET start_time = '2026-12-01 17:00:00+00'::timestamptz, end_time = '2026-12-01 17:45:00+00'::timestamptz WHERE id = v_apt_1;

    SELECT COUNT(*), COUNT(DISTINCT idempotency_key)
    INTO v_count, v_distinct_keys
    FROM public.booking_notifications
    WHERE appointment_id = v_apt_1 AND event_type = 'appointment_rescheduled';

    IF v_count <> 3 OR v_distinct_keys <> 3 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1D): expected 3 distinct reschedule notifications, got count=% keys=%', v_count, v_distinct_keys;
    END IF;

    -- 1E. confirmed -> completed emits 0 extra notifications
    UPDATE public.appointments SET status = 'completed' WHERE id = v_apt_1;
    SELECT COUNT(*) INTO v_count FROM public.booking_notifications WHERE appointment_id = v_apt_1;
    IF v_count <> 4 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1E): completed transition emitted extra notification (count=%)', v_count;
    END IF;

    -- 1F. Direct confirmed INSERT -> 1 confirmed notification; then confirmed -> cancelled -> 1 cancelled notification
    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (v_apt_2, v_biz_a_id, v_cust_a_id, v_svc_a_id, '2026-12-02 15:00:00+00'::timestamptz, '2026-12-02 15:45:00+00'::timestamptz, 'confirmed');
    UPDATE public.appointments SET status = 'cancelled' WHERE id = v_apt_2;

    SELECT COUNT(*) INTO v_count FROM public.booking_notifications WHERE appointment_id = v_apt_2 AND event_type = 'appointment_cancelled';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1F): expected 1 cancelled notification, got %', v_count;
    END IF;

    -- 1G. no_show transition -> 0 extra notifications
    UPDATE public.appointments SET status = 'no_show' WHERE id = v_apt_2;
    SELECT COUNT(*) INTO v_count FROM public.booking_notifications WHERE appointment_id = v_apt_2;
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1G): no_show transition emitted extra notification (count=%)', v_count;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 2: Per-User Read Receipts & Anti-Spoofing (Owner A vs Staff A)
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('ra_test.owner_a_id'),
    'role', 'authenticated',
    'email', 'ra-test-owner-a@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('ra_test.owner_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_notif_1_id UUID := current_setting('ra_test.notif_1_id')::uuid;
    v_staff_a_id UUID := current_setting('ra_test.staff_a_id')::uuid;
    v_biz_b_id   BIGINT := current_setting('ra_test.biz_b_id')::bigint;
    v_cnt        INT;
    v_blocked    BOOLEAN;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications;
    IF v_cnt < 5 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2A): Owner A expected >= 5 notifications, saw %', v_cnt;
    END IF;

    -- Owner A marks N1 read (server derives user_id and business_id)
    INSERT INTO public.booking_notification_reads (notification_id) VALUES (v_notif_1_id);

    SELECT COUNT(*) INTO v_cnt FROM public.booking_notification_reads WHERE notification_id = v_notif_1_id;
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2A): Owner A read receipt missing';
    END IF;

    -- Negative: Owner A cannot spoof Staff A user_id on read receipt
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.booking_notification_reads (notification_id, user_id) VALUES (v_notif_1_id, v_staff_a_id);
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2A): Owner A spoofed another user_id in booking_notification_reads';
    END IF;

    -- Negative: Owner A cannot spoof mismatched business_id
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.booking_notification_reads (notification_id, business_id) VALUES (v_notif_1_id, v_biz_b_id);
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2A): Owner A spoofed mismatched business_id';
    END IF;

    -- Negative: Owner A cannot DELETE or UPDATE booking_notifications directly
    v_blocked := FALSE;
    BEGIN
        DELETE FROM public.booking_notifications WHERE id = v_notif_1_id;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2A): Owner A deleted booking_notifications row';
    END IF;
END
$$;

-- Staff A checks independent unread state (must NOT inherit Owner A read receipt)
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('ra_test.staff_a_id'),
    'role', 'authenticated',
    'email', 'ra-test-staff-a@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('ra_test.staff_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_notif_1_id UUID := current_setting('ra_test.notif_1_id')::uuid;
    v_cnt        INT;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.booking_notification_reads WHERE notification_id = v_notif_1_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2B): Staff A inherited Owner A read receipt (found % rows)', v_cnt;
    END IF;

    INSERT INTO public.booking_notification_reads (notification_id) VALUES (v_notif_1_id);
    SELECT COUNT(*) INTO v_cnt FROM public.booking_notification_reads WHERE notification_id = v_notif_1_id;
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2B): Staff A independent read receipt failed';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 3: Tenant Isolation, Inactive/NULL Memberships & Super Admin Exclusion
-- -----------------------------------------------------------------------------
-- 3A. Owner B (different business) cannot see or mark Business A notifications
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('ra_test.owner_b_id'),
    'role', 'authenticated',
    'email', 'ra-test-owner-b@otherbiz.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('ra_test.owner_b_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_biz_a_id   BIGINT := current_setting('ra_test.biz_a_id')::bigint;
    v_notif_1_id UUID   := current_setting('ra_test.notif_1_id')::uuid;
    v_cnt        INT;
    v_blocked    BOOLEAN;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications WHERE business_id = v_biz_a_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3A): cross-tenant leak on booking_notifications (% rows)', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.booking_notification_failures;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3A): Owner B read booking_notification_failures (% rows)', v_cnt;
    END IF;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.booking_notification_reads (notification_id) VALUES (v_notif_1_id);
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3A): Owner B inserted read receipt for Business A notification';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM * FROM public.get_booking_notification_health();
    EXCEPTION
        WHEN insufficient_privilege, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3A): Owner B accessed get_booking_notification_health()';
    END IF;
END
$$;

-- 3B. Inactive member (is_active = FALSE) & NULL member (is_active IS NULL) blocked
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('ra_test.inactive_staff_a_id'),
    'role', 'authenticated',
    'email', 'ra-test-inactive@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('ra_test.inactive_staff_a_id'), true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_notif_1_id UUID := current_setting('ra_test.notif_1_id')::uuid;
    v_cnt INT;
    v_blocked BOOLEAN;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3B): inactive member saw % booking notifications', v_cnt;
    END IF;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.booking_notification_reads (notification_id) VALUES (v_notif_1_id);
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3B): inactive member inserted read receipt';
    END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('ra_test.null_staff_a_id'),
    'role', 'authenticated',
    'email', 'ra-test-null@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('ra_test.null_staff_a_id'), true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_cnt INT;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3B-NULL): is_active=NULL member saw % booking notifications', v_cnt;
    END IF;
END
$$;

-- 3C. Super Admin strictly excluded from routine booking notifications & read receipts
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('ra_test.super_admin_id'),
    'role', 'authenticated',
    'email', 'ra-test-superadmin@novacode.tech',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('ra_test.super_admin_id'), true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_notif_1_id UUID := current_setting('ra_test.notif_1_id')::uuid;
    v_cnt        INT;
    v_blocked    BOOLEAN;
    v_health     RECORD;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3C): Super Admin viewed % routine booking notifications', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.booking_notification_reads;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3C): Super Admin viewed % booking notification reads', v_cnt;
    END IF;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.booking_notification_reads (notification_id) VALUES (v_notif_1_id);
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3C): Super Admin inserted booking notification read receipt';
    END IF;

    -- Super Admin IS permitted to inspect health telemetry
    SELECT * INTO v_health FROM public.get_booking_notification_health();
    IF v_health.health_status IS NULL THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3C): Super Admin health RPC returned null';
    END IF;
END
$$;

-- 3D. Anonymous role & unauthenticated callers strictly blocked
RESET ROLE;
SET LOCAL ROLE anon;

DO $$
DECLARE
    v_cnt INT;
    v_blocked BOOLEAN;
BEGIN
    v_blocked := FALSE;
    BEGIN
        SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3D): anon queried booking_notifications (% rows)', v_cnt;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 4: Failure Capture, Double-Failure Monitoring, Bounded Retries & Replay
-- -----------------------------------------------------------------------------
RESET ROLE;

DO $$
DECLARE
    v_biz_a_id       BIGINT := current_setting('ra_test.biz_a_id')::bigint;
    v_cust_a_id      UUID   := current_setting('ra_test.cust_a_id')::uuid;
    v_svc_a_id       UUID   := current_setting('ra_test.svc_a_id')::uuid;
    v_fail_apt_id    UUID   := gen_random_uuid();
    v_rec_apt_id     UUID   := gen_random_uuid();
    v_dbl_apt_id     UUID   := gen_random_uuid();
    v_fail_key       TEXT;
    v_rec_key        TEXT;
    v_res            RECORD;
    v_health         RECORD;
    v_cnt            INT;
    v_status         TEXT;
    v_attempts       INT;
BEGIN
    -- Ephemeral fault-injection trigger helper inside rolled-back test transaction
    EXECUTE format($fn$
        CREATE OR REPLACE FUNCTION pg_temp.inject_notif_fault()
        RETURNS TRIGGER LANGUAGE plpgsql AS $t$
        BEGIN
            IF NEW.appointment_id IN (%L::uuid, %L::uuid, %L::uuid) THEN
                RAISE EXCEPTION 'Simulated primary notification storage outage';
            END IF;
            RETURN NEW;
        END;
        $t$;
    $fn$, v_fail_apt_id, v_rec_apt_id, v_dbl_apt_id);

    EXECUTE 'CREATE TRIGGER trg_ra_test_notif_fault BEFORE INSERT ON public.booking_notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.inject_notif_fault()';

    -- 4A. Confirmed booking succeeds even when notification insert fails -> Tier 1 + Tier 2 populated
    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (v_fail_apt_id, v_biz_a_id, v_cust_a_id, v_svc_a_id, '2026-12-03 15:00:00+00'::timestamptz, '2026-12-03 15:45:00+00'::timestamptz, 'confirmed');

    SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications WHERE appointment_id = v_fail_apt_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4A): expected 0 primary notifications while fault active, got %', v_cnt;
    END IF;

    SELECT idempotency_key, status, attempt_count
    INTO v_fail_key, v_status, v_attempts
    FROM public.booking_notification_failures
    WHERE appointment_id = v_fail_apt_id;

    IF v_fail_key IS NULL OR v_status <> 'pending' OR v_attempts <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4A): expected pending DLQ failure row (key=%, status=%, attempts=%)', v_fail_key, v_status, v_attempts;
    END IF;

    SELECT COUNT(*) INTO v_cnt
    FROM public.support_incidents
    WHERE business_id = v_biz_a_id
      AND source = 'technical_error'
      AND severity = 'high'
      AND status = 'open'
      AND title = 'Booking notification delivery failure';
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4A): expected 1 high support_incident, got %', v_cnt;
    END IF;

    -- 4B. Bounded retry backoff & exhaustion -> abandoned + critical incident
    SELECT * INTO v_res FROM public.recover_failed_booking_notifications(50, 3);
    IF v_res.recovered_count <> 0 OR v_res.rescheduled_count <> 1 OR v_res.abandoned_count <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4B): expected (0,1,0) on attempt 2, got (%)', row_to_json(v_res);
    END IF;

    -- Force next_retry_at due immediately -> attempt 3 hits max_attempts=3 -> abandoned
    UPDATE public.booking_notification_failures SET next_retry_at = NOW() - INTERVAL '1 second' WHERE appointment_id = v_fail_apt_id;
    SELECT * INTO v_res FROM public.recover_failed_booking_notifications(50, 3);
    IF v_res.abandoned_count <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4B): expected exhaustion -> abandoned_count=1, got (%)', row_to_json(v_res);
    END IF;

    SELECT status, attempt_count INTO v_status, v_attempts FROM public.booking_notification_failures WHERE appointment_id = v_fail_apt_id;
    IF v_status <> 'abandoned' OR v_attempts <> 3 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4B): expected abandoned at 3 attempts, got status=% attempts=%', v_status, v_attempts;
    END IF;

    SELECT COUNT(*) INTO v_cnt
    FROM public.support_incidents
    WHERE business_id = v_biz_a_id
      AND severity = 'critical'
      AND title = 'Booking notification recovery exhausted (abandoned)';
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4B): expected critical exhaustion incident, got %', v_cnt;
    END IF;

    -- 4C. Successful recovery & duplicate-free idempotency replay
    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (v_rec_apt_id, v_biz_a_id, v_cust_a_id, v_svc_a_id, '2026-12-04 15:00:00+00'::timestamptz, '2026-12-04 15:45:00+00'::timestamptz, 'confirmed');

    SELECT idempotency_key INTO v_rec_key FROM public.booking_notification_failures WHERE appointment_id = v_rec_apt_id;
    IF v_rec_key IS NULL THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4C): expected pending DLQ record for recoverable appointment';
    END IF;

    -- Clear simulated outage & run recovery twice -> exactly 1 notification, 0 duplicates
    DROP TRIGGER IF EXISTS trg_ra_test_notif_fault ON public.booking_notifications;
    SELECT * INTO v_res FROM public.recover_failed_booking_notifications(50, 5);
    IF v_res.recovered_count <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4C): expected recovered_count=1, got (%)', row_to_json(v_res);
    END IF;

    SELECT * INTO v_res FROM public.recover_failed_booking_notifications(50, 5);
    IF v_res.recovered_count <> 0 OR v_res.rescheduled_count <> 0 OR v_res.abandoned_count <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4C): second recovery run should be no-op, got (%)', row_to_json(v_res);
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.booking_notifications WHERE idempotency_key = v_rec_key;
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4C): expected exactly 1 recovered notification row, got %', v_cnt;
    END IF;

    -- 4D. Double-failure path: BOTH booking_notifications AND booking_notification_failures fail ->
    --     outer appointment STILL commits AND Tier-2 critical support_incident is recorded!
    EXECUTE 'CREATE TRIGGER trg_ra_test_notif_fault BEFORE INSERT ON public.booking_notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.inject_notif_fault()';
    EXECUTE format($fn$
        CREATE OR REPLACE FUNCTION pg_temp.inject_dlq_fault()
        RETURNS TRIGGER LANGUAGE plpgsql AS $t$
        BEGIN
            IF NEW.appointment_id = %L::uuid THEN
                RAISE EXCEPTION 'Simulated dead-letter queue outage';
            END IF;
            RETURN NEW;
        END;
        $t$;
    $fn$, v_dbl_apt_id);
    EXECUTE 'CREATE TRIGGER trg_ra_test_dlq_fault BEFORE INSERT ON public.booking_notification_failures FOR EACH ROW EXECUTE FUNCTION pg_temp.inject_dlq_fault()';

    INSERT INTO public.appointments (id, business_id, customer_id, service_id, start_time, end_time, status)
    VALUES (v_dbl_apt_id, v_biz_a_id, v_cust_a_id, v_svc_a_id, '2026-12-05 15:00:00+00'::timestamptz, '2026-12-05 15:45:00+00'::timestamptz, 'confirmed');

    SELECT COUNT(*) INTO v_cnt FROM public.booking_notification_failures WHERE appointment_id = v_dbl_apt_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4D): expected 0 DLQ rows during simulated DLQ fault, got %', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_cnt
    FROM public.support_incidents
    WHERE business_id = v_biz_a_id
      AND source = 'technical_error'
      AND severity = 'critical'
      AND status = 'open'
      AND title = 'Booking notification failure & dead-letter queue failure';
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4D): expected critical double-failure incident, got %', v_cnt;
    END IF;

    SELECT * INTO v_health FROM public.get_booking_notification_health();
    IF v_health.abandoned_failures < 1 OR v_health.critical_double_failure_incidents < 2 OR v_health.health_status <> 'critical' THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4D): health check did not surface critical state (%)', row_to_json(v_health);
    END IF;

    DROP TRIGGER IF EXISTS trg_ra_test_notif_fault ON public.booking_notifications;
    DROP TRIGGER IF EXISTS trg_ra_test_dlq_fault ON public.booking_notification_failures;
END
$$;

RESET ROLE;
ROLLBACK;
*/

