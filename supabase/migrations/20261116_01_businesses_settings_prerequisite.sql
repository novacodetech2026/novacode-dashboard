-- =============================================================================
-- NOVACODE TECH — PHASE 4: PRODUCTION DATABASE COMPATIBILITY PREREQUISITE
-- Migration: 20261116_01_businesses_settings_prerequisite.sql
--
-- PURPOSE:
--   Additively introduces `public.businesses.settings JSONB NOT NULL DEFAULT '{}'::JSONB`
--   required by `20261116_booking_rules_enforcement.sql` and frontend settings persistence,
--   without touching existing rows, columns, RLS policies, triggers, or RPCs.
--
-- CONFIRMED LIVE SCHEMA COMPATIBILITY:
--   - public.businesses currently has: id (BIGINT), created_at, name,
--     business_type, phone, email, timezone, is_active.
--   - public.businesses does NOT yet have a `settings` column.
--   - public.business_hours uses `is_open BOOLEAN` and remains the authoritative
--     source for weekly operating hours until an explicit per-business migration
--     sets `settings.operatingHoursMigrated = true`.
--
-- REVIEW ONLY — DO NOT AUTO-EXECUTE AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- SECTION 1: NON-DESTRUCTIVE PRE-FLIGHT CHECKS
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_col_type TEXT;
    v_has_bh_open BOOLEAN := FALSE;
    v_rls_enabled BOOLEAN := FALSE;
    v_has_biz_update_policy BOOLEAN := FALSE;
    v_has_bh_write_policy BOOLEAN := FALSE;
BEGIN
    IF to_regclass('public.businesses') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight failed: public.businesses table does not exist.';
    END IF;

    SELECT data_type
    INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'id';

    IF v_col_type IS DISTINCT FROM 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight failed: expected public.businesses.id BIGINT, found %.', COALESCE(v_col_type, 'missing');
    END IF;

    SELECT data_type
    INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'settings';

    IF v_col_type IS NOT NULL AND v_col_type IS DISTINCT FROM 'jsonb' THEN
        RAISE EXCEPTION 'Pre-flight failed: public.businesses.settings already exists with incompatible type % (expected jsonb).', v_col_type;
    END IF;

    IF to_regclass('public.business_hours') IS NOT NULL THEN
        SELECT data_type
        INTO v_col_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'business_hours'
          AND column_name = 'business_id';

        IF v_col_type IS DISTINCT FROM 'bigint' THEN
            RAISE EXCEPTION 'Pre-flight failed: expected public.business_hours.business_id BIGINT, found %.', COALESCE(v_col_type, 'missing');
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'business_hours'
              AND column_name IN ('is_open', 'is_closed')
        ) INTO v_has_bh_open;

        IF NOT v_has_bh_open THEN
            RAISE EXCEPTION 'Pre-flight failed: public.business_hours must contain is_open (or legacy is_closed).';
        END IF;
    END IF;

    -- Diagnostic notice only (preserves all existing RLS policies unchanged)
    SELECT c.relrowsecurity
    INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'businesses';

    IF v_rls_enabled THEN
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'businesses'
              AND cmd IN ('ALL', 'UPDATE')
        ) INTO v_has_biz_update_policy;

        IF NOT v_has_biz_update_policy THEN
            RAISE NOTICE 'RLS Diagnostic: public.businesses has RLS enabled without an UPDATE/ALL policy. Frontend settings saves by owners require an explicit UPDATE policy or authorized RPC.';
        END IF;
    END IF;

    IF to_regclass('public.business_hours') IS NOT NULL THEN
        SELECT c.relrowsecurity
        INTO v_rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'business_hours';

        IF v_rls_enabled THEN
            SELECT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = 'business_hours'
                  AND cmd IN ('ALL', 'INSERT', 'UPDATE')
            ) INTO v_has_bh_write_policy;

            IF NOT v_has_bh_write_policy THEN
                RAISE NOTICE 'RLS Diagnostic: public.business_hours has RLS enabled without INSERT/UPDATE/ALL policies. Frontend weekly hours sync by owners requires appropriate RLS.';
            END IF;
        END IF;
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 2: ADDITIVE `public.businesses.settings` COLUMN
-- -----------------------------------------------------------------------------
ALTER TABLE public.businesses
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Normalize if `settings` pre-existed without a default or nullable constraint
UPDATE public.businesses
SET settings = '{}'::JSONB
WHERE settings IS NULL;

ALTER TABLE public.businesses
    ALTER COLUMN settings SET DEFAULT '{}'::JSONB;

ALTER TABLE public.businesses
    ALTER COLUMN settings SET NOT NULL;

COMMENT ON COLUMN public.businesses.settings IS
    'Additive per-business JSONB configuration: specialHours (holidays & date overrides), bufferBetweenAppointmentsMinutes, cancellationBufferHours, operatingHours (fallback or post-migration when operatingHoursMigrated=true), profile metadata (tagline, description, logo, defaultLanguage, currencySymbol, address, website), aiAssistant, and communicationChannels. public.business_hours remains authoritative for weekly operating hours unless operatingHoursMigrated=true.';

COMMIT;

-- =============================================================================
-- ROLLBACK INSTRUCTIONS (MANUAL — ONLY RUN IF REVERTING THIS MIGRATION)
-- =============================================================================
/*
-- Option A (Non-destructive rollback — keeps stored settings intact if re-applying):
--   No action needed; an empty `'{}'::JSONB` column is inert when unused.
--
-- Option B (Full schema revert — WARNING: permanently drops `businesses.settings` data;
--   must NOT be run while `20261116_booking_rules_enforcement.sql` triggers/RPCs are active):
--   1. Ensure `20261116_booking_rules_enforcement.sql` objects are removed first if installed:
--        DROP TRIGGER IF EXISTS trg_appointments_enforce_booking_rules ON public.appointments;
--        DROP FUNCTION IF EXISTS public.reschedule_appointment(BIGINT, UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--        DROP FUNCTION IF EXISTS public.get_available_time_slots(BIGINT, UUID, DATE, UUID, INTEGER);
--        DROP FUNCTION IF EXISTS public.check_scheduling_availability(BIGINT, UUID, TIMESTAMPTZ, UUID);
--        DROP FUNCTION IF EXISTS public.resolve_business_hours_for_date(BIGINT, DATE);
--        DROP FUNCTION IF EXISTS public._resolve_business_hours_for_date_internal(BIGINT, DATE);
--        DROP FUNCTION IF EXISTS public.trg_appointments_enforce_booking_rules();
--        DROP FUNCTION IF EXISTS public._scheduling_assert_authorized(BIGINT);
--        DROP FUNCTION IF EXISTS public._scheduling_is_trusted_service_role();
--   2. Then drop the additive column:
--        BEGIN;
--        ALTER TABLE public.businesses DROP COLUMN IF EXISTS settings;
--        COMMIT;
*/
