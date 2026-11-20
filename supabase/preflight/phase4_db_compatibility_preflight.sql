-- =============================================================================
-- NOVACODE TECH — PHASE 4: READ-ONLY PREFLIGHT VERIFICATION QUERIES
-- File: supabase/preflight/phase4_db_compatibility_preflight.sql
--
-- READ-ONLY DIAGNOSTIC SCRIPT — CONTAINS ONLY SELECT QUERIES.
-- Run in Supabase SQL Editor (production or staging) BEFORE applying:
--   1. supabase/migrations/20261116_01_businesses_settings_prerequisite.sql
--   2. supabase/migrations/20261116_booking_rules_enforcement.sql
-- =============================================================================

-- 1. Core Table Presence & Exact Column Schemas (businesses, business_hours, appointments, services)
SELECT
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
      'businesses',
      'business_hours',
      'appointments',
      'services',
      'customers',
      'business_members'
  )
ORDER BY c.table_name, c.ordinal_position;

-- 2. Required Prerequisite & Compatibility Dependency Check
SELECT
    to_regclass('public.businesses') IS NOT NULL AS has_businesses_table,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'settings'
    ) AS has_businesses_settings_column,
    (
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'settings'
    ) AS businesses_settings_type,
    to_regclass('public.business_hours') IS NOT NULL AS has_business_hours_table,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'business_hours' AND column_name = 'is_open'
    ) AS business_hours_has_is_open,
    to_regprocedure('public.is_super_admin()') IS NOT NULL AS has_is_super_admin_fn,
    to_regprocedure('public.support_is_active_business_member(bigint)') IS NOT NULL AS has_support_member_fn,
    to_regclass('public.platform_admins') IS NOT NULL AS has_platform_admins_table,
    to_regclass('public.booking_notifications') IS NOT NULL AS has_release_a_notifications,
    to_regclass('public.support_tickets') IS NOT NULL AS has_support_v3_tickets,
    to_regclass('public.sms_consents') IS NOT NULL AS has_sms_consents_table;

-- 3. Production Booking, Admin & Helper Function Inspection (Non-Destructive)
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
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
      'can_check_availability',
      'is_super_admin',
      'is_business_member',
      'support_is_active_business_member',
      'admin_create_business'
  )
ORDER BY p.proname;

-- 4. Existing Triggers on Core Tables (Verify Release A & Prevent Unintended Interactions)
SELECT
    c.relname AS table_name,
    t.tgname AS trigger_name,
    CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
    t.tgenabled AS enabled_mode,
    p.proname AS function_name,
    pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN ('businesses', 'business_hours', 'appointments', 'services')
ORDER BY c.relname, t.tgname;

-- 5. RLS Status & Existing Policies on Core Tables
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('businesses', 'business_hours', 'appointments', 'services', 'customers', 'business_members')
ORDER BY c.relname;

SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('businesses', 'business_hours', 'appointments', 'services')
ORDER BY tablename, cmd, policyname;

-- 6. Unique Constraints & Indexes on public.business_hours & public.businesses
SELECT
    t.relname AS table_name,
    i.relname AS index_name,
    ix.indisprimary AS is_primary,
    ix.indisunique AS is_unique,
    pg_get_indexdef(ix.indexrelid) AS index_definition
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('businesses', 'business_hours')
ORDER BY t.relname, i.relname;

-- 7. Read-Only Data Integrity & Weekly Hours Coverage Summary
SELECT
    COUNT(*) AS total_businesses,
    COUNT(*) FILTER (WHERE is_active IS TRUE) AS active_businesses,
    COUNT(*) FILTER (WHERE is_active IS FALSE) AS inactive_businesses,
    COUNT(*) FILTER (WHERE timezone IS NULL OR TRIM(timezone) = '') AS missing_timezone_count
FROM public.businesses;

SELECT
    b.id AS business_id,
    b.name,
    b.business_type,
    b.timezone,
    b.is_active,
    COUNT(bh.*) AS business_hours_row_count,
    COUNT(bh.*) FILTER (WHERE bh.is_open IS TRUE) AS open_days_count,
    COUNT(bh.*) FILTER (WHERE bh.is_open IS FALSE) AS closed_days_count,
    COUNT(bh.*) FILTER (WHERE bh.is_open IS TRUE AND bh.open_time >= bh.close_time) AS invalid_time_range_count
FROM public.businesses b
LEFT JOIN public.business_hours bh ON bh.business_id = b.id
GROUP BY b.id, b.name, b.business_type, b.timezone, b.is_active
ORDER BY b.id;

-- 8. Appointment Status Values Check (Phase 1 / Phase 2 Compatibility)
SELECT
    status::TEXT AS appointment_status,
    COUNT(*) AS total_rows
FROM public.appointments
GROUP BY status::TEXT
ORDER BY total_rows DESC;
