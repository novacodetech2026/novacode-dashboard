-- =============================================================================
-- NOVACODE TECH — HARDENED BUSINESS SUPPORT & TECHNICAL INCIDENTS SYSTEM (V3)
-- Migration: 20261113_support_system_hardened_v3.sql
--
-- REVIEW ONLY — DO NOT AUTO-EXECUTE AGAINST PRODUCTION WITHOUT STAGING REVIEW.
-- Preserves all existing booking RPCs, customer records, business data,
-- onboarding/invitations, existing RLS policies on non-support tables, and
-- n8n workflows. Does not delete or modify V1 or V2 migration files.
--
-- WHAT V3 CORRECTS OVER V2 (20261113_support_system_hardened_v2.sql):
-- 1. Executable Staging Authorization Test Suite (Section 10):
--    - Rewrites all tests as pure top-level SQL statements with separated
--      `RESET ROLE` / `SET LOCAL ROLE authenticated` / `SET LOCAL ROLE anon`,
--      `BEGIN; ... ROLLBACK;`, and dual Supabase JWT claims (`request.jwt.claims`
--      + `request.jwt.claim.sub` / `request.jwt.claim.role`). Zero `SET LOCAL ROLE`
--      calls inside PL/pgSQL `DO` blocks.
--    - Eliminates broad `EXCEPTION WHEN OTHERS` handlers in negative tests.
--      Every negative test catches only the expected SQLSTATE (`raise_exception`,
--      `insufficient_privilege`, `check_violation`), verifies the error message,
--      and asserts `v_blocked` OUTSIDE the exception block so unexpected success
--      always fails the test.
--    - Adds coverage for inactive memberships (`bm.is_active = FALSE`), inactive
--      businesses, partial notification reads with newer unread notifications,
--      incident permissions, cross-tenant isolation, and unauthorized mutations.
-- 2. Partial Notification Read Sync Bug Fixed:
--    - `trg_support_notification_after_update()` no longer clears ticket unread
--      flags (`unread_by_admin` / `unread_by_business`) when another unread
--      notification (`is_read = FALSE`, including newer ones) still exists for
--      that ticket and target role.
-- 3. Active Membership & Active Business Enforcement:
--    - Role lookup in `trg_support_message_before_insert()` explicitly joins
--      `public.businesses` and requires `bm.is_active = TRUE` plus an active
--      business row.
--    - Introduces `public.support_is_active_business_member(BIGINT)` layering
--      `public.is_business_member(BIGINT)` + `bm.is_active = TRUE` + active
--      business validation across ticket/message/notification triggers & RLS.
-- 4. Exact Frontend Grants & Scoped RLS Policies:
--    - Splits broad `FOR ALL` RLS policies into explicit `FOR SELECT`,
--      `FOR INSERT`, and `FOR UPDATE` policies matching actual frontend queries
--      and least-privilege table/column grants (`UPDATE (is_read)` on
--      `support_notifications`, `UPDATE (status, resolved_at)` on
--      `support_incidents`, zero `DELETE` grants).
-- 5. Safe Existing-Project Migration & Ownership Audit:
--    - Pre-flight check verifies `public.business_members.is_active` exists.
--    - Function ownership alignment checks `pg_has_role(current_user, ..., 'MEMBER')`
--      before `ALTER FUNCTION ... OWNER TO ...` so managed Supabase SQL Editor
--      roles (`postgres`) never error if a table is owned by `supabase_admin`,
--      while still verifying every `SECURITY DEFINER` function has pinned
--      `search_path=` and table-owner or `rolsuper`/`rolbypassrls` privilege.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Pre-Flight Production Compatibility Checks (Non-Destructive)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_id_type TEXT;
    v_bm_is_active_type TEXT;
BEGIN
    SELECT data_type INTO v_biz_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'id';

    IF v_biz_id_type IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.businesses(id) does not exist.';
    END IF;

    IF v_biz_id_type <> 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight check failed: expected public.businesses.id to be BIGINT, found %.', v_biz_id_type;
    END IF;

    IF to_regclass('public.business_members') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.business_members table is required.';
    END IF;

    SELECT data_type INTO v_bm_is_active_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_members'
      AND column_name = 'is_active';

    IF v_bm_is_active_type IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.business_members.is_active BOOLEAN column is required (found %).',
            COALESCE(v_bm_is_active_type, 'missing');
    END IF;

    IF to_regprocedure('public.is_super_admin()') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.is_super_admin() function is required.';
    END IF;

    IF to_regprocedure('public.is_business_member(bigint)') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.is_business_member(bigint) function is required.';
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
-- 1. Business Support Tickets (Owned by Active Business Members, Triaged by Super Admin)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    category TEXT NOT NULL CHECK (
        category IN (
            'general_question',
            'technical_problem',
            'booking_calendar_issue',
            'ai_receptionist_issue',
            'customer_service_concern',
            'account_access_problem',
            'feature_request',
            'complaint',
            'other'
        )
    ),
    subject TEXT NOT NULL CHECK (LENGTH(TRIM(subject)) BETWEEN 3 AND 200),
    description TEXT NOT NULL CHECK (LENGTH(TRIM(description)) >= 5),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed')
    ),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unread_by_business BOOLEAN NOT NULL DEFAULT FALSE,
    unread_by_admin BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.business_support_tickets
    ADD COLUMN IF NOT EXISTS created_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_support_tickets_business_updated
    ON public.business_support_tickets (business_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_priority
    ON public.business_support_tickets (status, priority, last_message_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Support Ticket Messages (2-Way Business <-> Super Admin Thread)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.business_support_tickets(id) ON DELETE CASCADE,
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('business_owner', 'business_staff', 'super_admin')),
    sender_name TEXT,
    message TEXT NOT NULL CHECK (LENGTH(TRIM(message)) >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
    ON public.support_ticket_messages (ticket_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_support_messages_business_created
    ON public.support_ticket_messages (business_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Support Ticket Status History (Immutable Audit Trail)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_ticket_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.business_support_tickets(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    old_status TEXT,
    new_status TEXT NOT NULL CHECK (
        new_status IN ('open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_history_ticket
    ON public.support_ticket_status_history (ticket_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Technical Incidents (Strictly Super Admin Only; Written by Trusted Backend)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT REFERENCES public.businesses(id) ON DELETE SET NULL,
    business_name TEXT,
    reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'technical_error' CHECK (
        source IN ('business_report', 'technical_error', 'integration_failure', 'security_alert')
    ),
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
    ),
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'investigating', 'resolved')
    ),
    title TEXT NOT NULL CHECK (LENGTH(TRIM(title)) >= 1),
    description TEXT NOT NULL DEFAULT '',
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_incidents_status_severity
    ON public.support_incidents (status, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_incidents_business_created
    ON public.support_incidents (business_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Role- & Business-Separated Support Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT REFERENCES public.businesses(id) ON DELETE CASCADE,
    target_role TEXT NOT NULL CHECK (target_role IN ('business', 'super_admin')),
    ticket_id UUID REFERENCES public.business_support_tickets(id) ON DELETE CASCADE,
    incident_id UUID REFERENCES public.support_incidents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class tbl ON tbl.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname = 'public'
          AND tbl.relname = 'support_notifications'
          AND c.contype = 'f'
          AND EXISTS (
              SELECT 1
              FROM pg_attribute a
              WHERE a.attrelid = tbl.oid
                AND a.attnum = ANY(c.conkey)
                AND a.attname = 'incident_id'
          )
    ) THEN
        ALTER TABLE public.support_notifications
            ADD CONSTRAINT fk_support_notifications_incident_id
            FOREIGN KEY (incident_id)
            REFERENCES public.support_incidents(id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_support_notifications_target
    ON public.support_notifications (target_role, business_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_notifications_ticket
    ON public.support_notifications (ticket_id, target_role, is_read);

-- -----------------------------------------------------------------------------
-- 6. Hardened Security Helpers & Triggers
-- -----------------------------------------------------------------------------

-- Schema-adaptive active-business evaluator (supports is_active, active, status, deleted_at)
CREATE OR REPLACE FUNCTION public.support_is_business_row_active(p_biz_json JSONB)
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

-- Active membership + active business guard (preserves existing public.is_business_member(bigint))
CREATE OR REPLACE FUNCTION public.support_is_active_business_member(p_business_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_biz_json JSONB;
BEGIN
    IF v_uid IS NULL OR p_business_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF NOT public.is_business_member(p_business_id) THEN
        RETURN FALSE;
    END IF;

    SELECT to_jsonb(b)
    INTO v_biz_json
    FROM public.business_members bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE bm.business_id = p_business_id
      AND bm.user_id = v_uid
      AND bm.is_active = TRUE
    LIMIT 1;

    IF v_biz_json IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN public.support_is_business_row_active(v_biz_json);
END;
$$;

-- Internal helper to resolve human-readable name/email for an auth user inside triggers
CREATE OR REPLACE FUNCTION public.resolve_support_actor_label(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_label TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(
        NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(u.email), '')
    )
    INTO v_label
    FROM auth.users u
    WHERE u.id = p_user_id;

    RETURN v_label;
END;
$$;

-- Ticket BEFORE INSERT: bind author from auth.uid(), verify active membership & active business
CREATE OR REPLACE FUNCTION public.trg_support_ticket_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_label TEXT;
    v_is_super BOOLEAN := FALSE;
    v_effective_role TEXT;
    v_is_trusted_backend BOOLEAN := FALSE;
BEGIN
    v_effective_role := COALESCE(
        NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
        session_user
    );

    v_is_trusted_backend := (
        auth.uid() IS NULL
        AND v_effective_role NOT IN ('authenticated', 'anon', 'PUBLIC', 'authenticator')
        AND (
            v_effective_role = 'service_role'
            OR v_effective_role = (
                SELECT pg_get_userbyid(c.relowner)
                FROM pg_class c
                WHERE c.oid = 'public.business_support_tickets'::regclass
            )
            OR EXISTS (
                SELECT 1
                FROM pg_roles r
                WHERE r.rolname = v_effective_role
                  AND (r.rolsuper OR r.rolbypassrls)
            )
        )
    );

    IF auth.uid() IS NULL AND NOT v_is_trusted_backend THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user context required to create support tickets';
    END IF;

    IF auth.uid() IS NOT NULL THEN
        v_is_super := public.is_super_admin();

        IF NOT v_is_super THEN
            IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
                RAISE EXCEPTION 'Unauthorized: cannot impersonate another ticket creator';
            END IF;

            IF NEW.business_id IS NULL OR NOT public.support_is_active_business_member(NEW.business_id) THEN
                RAISE EXCEPTION 'Unauthorized: active business membership and active business required to create support tickets';
            END IF;

            NEW.status := 'open';
            NEW.unread_by_admin := TRUE;
            NEW.unread_by_business := FALSE;
        END IF;

        NEW.created_by := auth.uid();
        v_actor_label := public.resolve_support_actor_label(auth.uid());
        NEW.created_by_name := COALESCE(v_actor_label, 'Workspace Member');
    ELSE
        IF NEW.created_by IS NOT NULL AND NULLIF(TRIM(COALESCE(NEW.created_by_name, '')), '') IS NULL THEN
            NEW.created_by_name := public.resolve_support_actor_label(NEW.created_by);
        END IF;
    END IF;

    NEW.subject := TRIM(COALESCE(NEW.subject, ''));
    NEW.description := TRIM(COALESCE(NEW.description, ''));
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := NOW();
    NEW.last_message_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_before_insert ON public.business_support_tickets;
CREATE TRIGGER support_ticket_before_insert
    BEFORE INSERT ON public.business_support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_ticket_before_insert();

-- Ticket AFTER INSERT: write initial status history & notify Super Admin
CREATE OR REPLACE FUNCTION public.trg_support_ticket_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_biz_name TEXT;
BEGIN
    SELECT name INTO v_biz_name FROM public.businesses WHERE id = NEW.business_id;

    INSERT INTO public.support_ticket_status_history (ticket_id, changed_by, old_status, new_status)
    VALUES (NEW.id, NEW.created_by, NULL, NEW.status);

    INSERT INTO public.support_notifications (business_id, target_role, ticket_id, title, body)
    VALUES (
        NEW.business_id,
        'super_admin',
        NEW.id,
        'New Support Request · ' || COALESCE(v_biz_name, 'Business #' || NEW.business_id::TEXT),
        NEW.subject
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_after_insert ON public.business_support_tickets;
CREATE TRIGGER support_ticket_after_insert
    AFTER INSERT ON public.business_support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_ticket_after_insert();

-- Ticket BEFORE UPDATE (SECURITY INVOKER):
-- Preserves `current_user` so unprivileged API callers (`authenticated` / `anon`)
-- can never spoof `novacode.support_trigger_op`. Trusted internal syncs require:
--   1. Elevated non-API caller role (table owner or rolsuper/rolbypassrls)
--   2. Nested trigger execution (`pg_trigger_depth() >= 2`)
--   3. Valid `novacode.support_trigger_op` (`'message_sync'` or `'notification_read_sync'`)
CREATE OR REPLACE FUNCTION public.trg_support_ticket_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_trigger_op TEXT;
    v_is_privileged_trigger_caller BOOLEAN := FALSE;
    v_is_backend_session BOOLEAN := FALSE;
BEGIN
    -- Immutable identity and creation metadata
    NEW.id := OLD.id;
    NEW.business_id := OLD.business_id;
    NEW.created_by := OLD.created_by;
    NEW.created_by_name := OLD.created_by_name;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := NOW();

    v_trigger_op := NULLIF(current_setting('novacode.support_trigger_op', true), '');

    v_is_privileged_trigger_caller := (
        pg_trigger_depth() >= 2
        AND current_user NOT IN ('authenticated', 'anon', 'PUBLIC')
        AND (
            current_user = (
                SELECT pg_get_userbyid(c.relowner)
                FROM pg_class c
                WHERE c.oid = 'public.business_support_tickets'::regclass
            )
            OR EXISTS (
                SELECT 1
                FROM pg_roles r
                WHERE r.rolname = current_user
                  AND (r.rolsuper OR r.rolbypassrls)
            )
        )
    );

    IF v_is_privileged_trigger_caller AND v_trigger_op IN ('message_sync', 'notification_read_sync') THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR NEW.category IS DISTINCT FROM OLD.category
           OR NEW.subject IS DISTINCT FROM OLD.subject
           OR NEW.description IS DISTINCT FROM OLD.description THEN
            RAISE EXCEPTION 'Unauthorized internal trigger mutation on protected ticket fields';
        END IF;

        IF v_trigger_op = 'notification_read_sync'
           AND NEW.last_message_at IS DISTINCT FROM OLD.last_message_at THEN
            RAISE EXCEPTION 'Unauthorized internal trigger mutation on last_message_at during read sync';
        END IF;

        RETURN NEW;
    END IF;

    -- Direct trusted backend / service_role session (no end-user JWT)
    v_is_backend_session := (
        auth.uid() IS NULL
        AND (
            current_user = 'service_role'
            OR EXISTS (
                SELECT 1
                FROM pg_roles r
                WHERE r.rolname = current_user
                  AND (r.rolsuper OR r.rolbypassrls)
            )
        )
    );

    IF v_is_backend_session THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user context required';
    END IF;

    IF public.is_super_admin() THEN
        RETURN NEW;
    END IF;

    IF NOT public.support_is_active_business_member(OLD.business_id) THEN
        RAISE EXCEPTION 'Unauthorized: active business membership and active business required';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.priority IS DISTINCT FROM OLD.priority
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.unread_by_admin IS DISTINCT FROM OLD.unread_by_admin
       OR NEW.last_message_at IS DISTINCT FROM OLD.last_message_at THEN
        RAISE EXCEPTION 'Unauthorized: business users can only update read state on support tickets';
    END IF;

    IF NEW.unread_by_business IS DISTINCT FROM OLD.unread_by_business
       AND NEW.unread_by_business IS NOT FALSE THEN
        RAISE EXCEPTION 'Unauthorized: business users can only mark support tickets as read';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_before_update ON public.business_support_tickets;
CREATE TRIGGER support_ticket_before_update
    BEFORE UPDATE ON public.business_support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_ticket_before_update();

-- Ticket AFTER UPDATE: log status history, notify business on status change, sync notification read state
CREATE OR REPLACE FUNCTION public.trg_support_ticket_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_prev_op TEXT;
BEGIN
    v_prev_op := NULLIF(current_setting('novacode.support_trigger_op', true), '');

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO public.support_ticket_status_history (ticket_id, changed_by, old_status, new_status)
        VALUES (NEW.id, auth.uid(), OLD.status, NEW.status);

        INSERT INTO public.support_notifications (business_id, target_role, ticket_id, title, body)
        VALUES (
            NEW.business_id,
            'business',
            NEW.id,
            'Support Request Status Updated',
            NEW.subject || ' → ' || REPLACE(NEW.status, '_', ' ')
        );
    END IF;

    -- Prevent ping-pong loop when triggered by trg_support_notification_after_update()
    IF v_prev_op IS DISTINCT FROM 'notification_read_sync' THEN
        IF (OLD.unread_by_admin = TRUE AND NEW.unread_by_admin = FALSE)
           OR (OLD.unread_by_business = TRUE AND NEW.unread_by_business = FALSE) THEN
            PERFORM set_config('novacode.support_trigger_op', 'ticket_read_sync', true);
            BEGIN
                IF OLD.unread_by_admin = TRUE AND NEW.unread_by_admin = FALSE THEN
                    UPDATE public.support_notifications
                    SET is_read = TRUE
                    WHERE ticket_id = NEW.id
                      AND target_role = 'super_admin'
                      AND is_read = FALSE;
                END IF;

                IF OLD.unread_by_business = TRUE AND NEW.unread_by_business = FALSE THEN
                    UPDATE public.support_notifications
                    SET is_read = TRUE
                    WHERE ticket_id = NEW.id
                      AND target_role = 'business'
                      AND business_id = NEW.business_id
                      AND is_read = FALSE;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                PERFORM set_config('novacode.support_trigger_op', COALESCE(v_prev_op, ''), true);
                RAISE;
            END;
            PERFORM set_config('novacode.support_trigger_op', COALESCE(v_prev_op, ''), true);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_after_update ON public.business_support_tickets;
CREATE TRIGGER support_ticket_after_update
    AFTER UPDATE ON public.business_support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_ticket_after_update();

-- Message BEFORE INSERT: enforce closed-ticket lock, active membership + active business, server-derived sender
CREATE OR REPLACE FUNCTION public.trg_support_message_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_ticket_business_id BIGINT;
    v_ticket_status TEXT;
    v_member_role TEXT;
    v_biz_json JSONB;
    v_actor_label TEXT;
    v_is_super BOOLEAN := FALSE;
    v_effective_role TEXT;
    v_is_trusted_backend BOOLEAN := FALSE;
BEGIN
    v_effective_role := COALESCE(
        NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
        session_user
    );

    v_is_trusted_backend := (
        auth.uid() IS NULL
        AND v_effective_role NOT IN ('authenticated', 'anon', 'PUBLIC', 'authenticator')
        AND (
            v_effective_role = 'service_role'
            OR v_effective_role = (
                SELECT pg_get_userbyid(c.relowner)
                FROM pg_class c
                WHERE c.oid = 'public.business_support_tickets'::regclass
            )
            OR EXISTS (
                SELECT 1
                FROM pg_roles r
                WHERE r.rolname = v_effective_role
                  AND (r.rolsuper OR r.rolbypassrls)
            )
        )
    );

    IF auth.uid() IS NULL AND NOT v_is_trusted_backend THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user context required to reply to support tickets';
    END IF;

    SELECT business_id, status
    INTO v_ticket_business_id, v_ticket_status
    FROM public.business_support_tickets
    WHERE id = NEW.ticket_id
    FOR UPDATE;

    IF v_ticket_business_id IS NULL THEN
        RAISE EXCEPTION 'Target support ticket does not exist';
    END IF;

    IF v_ticket_status = 'closed' THEN
        RAISE EXCEPTION 'Cannot reply to a closed support ticket';
    END IF;

    IF NEW.business_id IS NOT NULL AND NEW.business_id IS DISTINCT FROM v_ticket_business_id THEN
        RAISE EXCEPTION 'Unauthorized: message business_id does not match target ticket';
    END IF;

    NEW.business_id := v_ticket_business_id;
    NEW.message := TRIM(COALESCE(NEW.message, ''));
    NEW.created_at := COALESCE(NEW.created_at, NOW());

    IF auth.uid() IS NOT NULL THEN
        v_is_super := public.is_super_admin();
        v_actor_label := public.resolve_support_actor_label(auth.uid());

        IF NOT v_is_super THEN
            IF NEW.sender_id IS NOT NULL AND NEW.sender_id IS DISTINCT FROM auth.uid() THEN
                RAISE EXCEPTION 'Unauthorized: cannot impersonate another message sender';
            END IF;

            IF NEW.sender_role = 'super_admin' THEN
                RAISE EXCEPTION 'Unauthorized: only verified Super Admins may post as super_admin';
            END IF;

            IF NOT public.is_business_member(v_ticket_business_id) THEN
                RAISE EXCEPTION 'Unauthorized: active business membership required to reply';
            END IF;

            -- Explicit active member role lookup + active business verification
            SELECT bm.role::TEXT, to_jsonb(b)
            INTO v_member_role, v_biz_json
            FROM public.business_members bm
            JOIN public.businesses b ON b.id = bm.business_id
            WHERE bm.business_id = v_ticket_business_id
              AND bm.user_id = auth.uid()
              AND bm.is_active = TRUE
            ORDER BY CASE
                WHEN bm.role::TEXT = 'owner' THEN 1
                WHEN bm.role::TEXT = 'admin' THEN 2
                ELSE 3
            END
            LIMIT 1;

            IF v_member_role IS NULL
               OR v_biz_json IS NULL
               OR NOT public.support_is_business_row_active(v_biz_json) THEN
                RAISE EXCEPTION 'Unauthorized: active business membership and active business required to reply';
            END IF;

            IF v_member_role IN ('owner', 'admin') THEN
                NEW.sender_role := 'business_owner';
            ELSE
                NEW.sender_role := 'business_staff';
            END IF;

            NEW.sender_name := COALESCE(v_actor_label, 'Business Member');
        ELSE
            NEW.sender_role := 'super_admin';
            NEW.sender_name := 'Novacode Tech Support';
        END IF;

        NEW.sender_id := auth.uid();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_message_before_insert ON public.support_ticket_messages;
CREATE TRIGGER support_message_before_insert
    BEFORE INSERT ON public.support_ticket_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_message_before_insert();

-- Message AFTER INSERT: update ticket unread counters & create role-targeted notification
CREATE OR REPLACE FUNCTION public.trg_support_message_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_subject TEXT;
    v_biz_name TEXT;
    v_prev_op TEXT;
    v_has_unread_for_sender BOOLEAN := FALSE;
BEGIN
    SELECT t.subject, b.name
    INTO v_subject, v_biz_name
    FROM public.business_support_tickets t
    JOIN public.businesses b ON b.id = t.business_id
    WHERE t.id = NEW.ticket_id;

    v_prev_op := NULLIF(current_setting('novacode.support_trigger_op', true), '');
    PERFORM set_config('novacode.support_trigger_op', 'message_sync', true);

    BEGIN
        IF NEW.sender_role = 'super_admin' THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.support_notifications sn
                WHERE sn.ticket_id = NEW.ticket_id
                  AND sn.target_role = 'super_admin'
                  AND sn.is_read = FALSE
            )
            INTO v_has_unread_for_sender;

            UPDATE public.business_support_tickets
            SET last_message_at = GREATEST(last_message_at, NEW.created_at),
                unread_by_business = TRUE,
                unread_by_admin = CASE
                    WHEN v_has_unread_for_sender THEN unread_by_admin
                    ELSE FALSE
                END,
                updated_at = NOW()
            WHERE id = NEW.ticket_id;

            INSERT INTO public.support_notifications (business_id, target_role, ticket_id, title, body)
            VALUES (
                NEW.business_id,
                'business',
                NEW.ticket_id,
                'Novacode Tech Support Reply',
                COALESCE(v_subject, 'Support Request') || ': ' || LEFT(NEW.message, 120)
            );
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM public.support_notifications sn
                WHERE sn.ticket_id = NEW.ticket_id
                  AND sn.target_role = 'business'
                  AND sn.business_id = NEW.business_id
                  AND sn.is_read = FALSE
            )
            INTO v_has_unread_for_sender;

            UPDATE public.business_support_tickets
            SET last_message_at = GREATEST(last_message_at, NEW.created_at),
                unread_by_admin = TRUE,
                unread_by_business = CASE
                    WHEN v_has_unread_for_sender THEN unread_by_business
                    ELSE FALSE
                END,
                updated_at = NOW()
            WHERE id = NEW.ticket_id;

            INSERT INTO public.support_notifications (business_id, target_role, ticket_id, title, body)
            VALUES (
                NEW.business_id,
                'super_admin',
                NEW.ticket_id,
                'Support Reply · ' || COALESCE(v_biz_name, 'Business #' || NEW.business_id::TEXT),
                COALESCE(v_subject, 'Support Request') || ': ' || LEFT(NEW.message, 120)
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('novacode.support_trigger_op', COALESCE(v_prev_op, ''), true);
        RAISE;
    END;

    PERFORM set_config('novacode.support_trigger_op', COALESCE(v_prev_op, ''), true);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_message_after_insert ON public.support_ticket_messages;
CREATE TRIGGER support_message_after_insert
    AFTER INSERT ON public.support_ticket_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_message_after_insert();

-- Notification BEFORE UPDATE (SECURITY INVOKER): restrict updates strictly to `is_read`
CREATE OR REPLACE FUNCTION public.trg_support_notification_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.target_role IS DISTINCT FROM OLD.target_role
       OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
       OR NEW.incident_id IS DISTINCT FROM OLD.incident_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Unauthorized: support_notifications updates are restricted to is_read only';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_notification_before_update ON public.support_notifications;
CREATE TRIGGER support_notification_before_update
    BEFORE UPDATE ON public.support_notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_notification_before_update();

-- Notification AFTER UPDATE (V3 FIX):
-- Only clears ticket unread flags (`unread_by_admin` / `unread_by_business`) when
-- NO other unread notifications (including newer ones) still exist for that
-- ticket and target role.
CREATE OR REPLACE FUNCTION public.trg_support_notification_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev_op TEXT;
    v_has_remaining_unread BOOLEAN := FALSE;
BEGIN
    v_prev_op := NULLIF(current_setting('novacode.support_trigger_op', true), '');

    IF v_prev_op IS DISTINCT FROM 'ticket_read_sync'
       AND OLD.is_read = FALSE
       AND NEW.is_read = TRUE
       AND NEW.ticket_id IS NOT NULL THEN

        -- Lock parent ticket row first so concurrent message inserts serialize before remaining-unread check
        PERFORM 1
        FROM public.business_support_tickets t
        WHERE t.id = NEW.ticket_id
        FOR UPDATE;

        SELECT EXISTS (
            SELECT 1
            FROM public.support_notifications sn
            WHERE sn.ticket_id = NEW.ticket_id
              AND sn.target_role = NEW.target_role
              AND (
                  NEW.target_role <> 'business'
                  OR sn.business_id = NEW.business_id
              )
              AND sn.is_read = FALSE
              AND sn.id <> NEW.id
        )
        INTO v_has_remaining_unread;

        IF NOT v_has_remaining_unread THEN
            PERFORM set_config('novacode.support_trigger_op', 'notification_read_sync', true);
            BEGIN
                IF NEW.target_role = 'super_admin' THEN
                    UPDATE public.business_support_tickets
                    SET unread_by_admin = FALSE,
                        updated_at = NOW()
                    WHERE id = NEW.ticket_id
                      AND unread_by_admin = TRUE;
                ELSIF NEW.target_role = 'business' THEN
                    UPDATE public.business_support_tickets
                    SET unread_by_business = FALSE,
                        updated_at = NOW()
                    WHERE id = NEW.ticket_id
                      AND business_id = NEW.business_id
                      AND unread_by_business = TRUE;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                PERFORM set_config('novacode.support_trigger_op', COALESCE(v_prev_op, ''), true);
                RAISE;
            END;
            PERFORM set_config('novacode.support_trigger_op', COALESCE(v_prev_op, ''), true);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_notification_after_update ON public.support_notifications;
CREATE TRIGGER support_notification_after_update
    AFTER UPDATE ON public.support_notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_notification_after_update();

-- Incident BEFORE/AFTER triggers: hydrate business_name, resolved_at, and notify Super Admin
CREATE OR REPLACE FUNCTION public.trg_support_incident_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    IF NEW.business_id IS NOT NULL AND NULLIF(TRIM(COALESCE(NEW.business_name, '')), '') IS NULL THEN
        SELECT name INTO NEW.business_name FROM public.businesses WHERE id = NEW.business_id;
    END IF;

    IF NEW.reported_by IS NULL AND auth.uid() IS NOT NULL THEN
        NEW.reported_by := auth.uid();
    END IF;

    IF NEW.status = 'resolved' AND NEW.resolved_at IS NULL THEN
        NEW.resolved_at := NOW();
    END IF;

    NEW.title := TRIM(COALESCE(NEW.title, ''));
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_incident_before_insert ON public.support_incidents;
CREATE TRIGGER support_incident_before_insert
    BEFORE INSERT ON public.support_incidents
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_incident_before_insert();

CREATE OR REPLACE FUNCTION public.trg_support_incident_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.id := OLD.id;
    NEW.business_id := OLD.business_id;
    NEW.business_name := OLD.business_name;
    NEW.reported_by := OLD.reported_by;
    NEW.source := OLD.source;
    NEW.severity := OLD.severity;
    NEW.title := OLD.title;
    NEW.description := OLD.description;
    NEW.error_code := OLD.error_code;
    NEW.created_at := OLD.created_at;

    IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
        NEW.resolved_at := COALESCE(NEW.resolved_at, NOW());
    ELSIF NEW.status <> 'resolved' THEN
        NEW.resolved_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_incident_before_update ON public.support_incidents;
CREATE TRIGGER support_incident_before_update
    BEFORE UPDATE ON public.support_incidents
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_incident_before_update();

CREATE OR REPLACE FUNCTION public.trg_support_incident_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.support_notifications (business_id, target_role, incident_id, title, body)
    VALUES (
        NEW.business_id,
        'super_admin',
        NEW.id,
        'Technical Incident (' || UPPER(NEW.severity) || ')',
        NEW.title
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_incident_after_insert ON public.support_incidents;
CREATE TRIGGER support_incident_after_insert
    AFTER INSERT ON public.support_incidents
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_incident_after_insert();

-- -----------------------------------------------------------------------------
-- 7. Function Ownership, EXECUTE Lockdown, search_path Audit & Table Grants
-- -----------------------------------------------------------------------------

-- RLS helper execute permissions
REVOKE ALL ON FUNCTION public.support_is_business_row_active(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_is_business_row_active(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.support_is_active_business_member(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_is_active_business_member(BIGINT) TO authenticated, service_role;

-- Internal helpers & trigger functions: never callable as RPCs by anon/authenticated
REVOKE ALL ON FUNCTION public.resolve_support_actor_label(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_support_actor_label(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.trg_support_ticket_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_ticket_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_ticket_before_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_ticket_after_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_message_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_message_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_notification_before_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_notification_after_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_incident_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_incident_before_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_support_incident_after_insert() FROM PUBLIC, anon, authenticated;

-- Audit SECURITY DEFINER functions safely across existing Supabase ownership models
DO $$
DECLARE
    v_fn RECORD;
    v_table_owner TEXT;
    v_fn_owner_privileged BOOLEAN := FALSE;
BEGIN
    SELECT pg_get_userbyid(relowner) INTO v_table_owner
    FROM pg_class
    WHERE oid = 'public.business_support_tickets'::regclass;

    FOR v_fn IN
        SELECT p.oid::regprocedure::text AS sig,
               pg_get_userbyid(p.proowner) AS fn_owner,
               p.proconfig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'support_is_active_business_member',
              'resolve_support_actor_label',
              'trg_support_ticket_before_insert',
              'trg_support_ticket_after_insert',
              'trg_support_ticket_after_update',
              'trg_support_message_before_insert',
              'trg_support_message_after_insert',
              'trg_support_notification_after_update',
              'trg_support_incident_before_insert',
              'trg_support_incident_after_insert'
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

-- Minimum table & column-level privileges matching actual frontend operations
REVOKE ALL ON TABLE public.business_support_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_ticket_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_ticket_status_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_incidents FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_support_tickets TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_ticket_messages TO authenticated;
GRANT SELECT ON TABLE public.support_ticket_status_history TO authenticated;
GRANT SELECT, UPDATE (is_read) ON TABLE public.support_notifications TO authenticated;
GRANT SELECT, UPDATE (status, resolved_at) ON TABLE public.support_incidents TO authenticated;

GRANT ALL ON TABLE public.business_support_tickets TO service_role;
GRANT ALL ON TABLE public.support_ticket_messages TO service_role;
GRANT ALL ON TABLE public.support_ticket_status_history TO service_role;
GRANT ALL ON TABLE public.support_notifications TO service_role;
GRANT ALL ON TABLE public.support_incidents TO service_role;

-- -----------------------------------------------------------------------------
-- 8. Strict Row-Level Security (RLS) Policies (Least-Privilege & Scoped)
-- -----------------------------------------------------------------------------
ALTER TABLE public.business_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_incidents ENABLE ROW LEVEL SECURITY;

-- business_support_tickets policies (explicit SELECT/INSERT/UPDATE; no DELETE)
DROP POLICY IF EXISTS "Super admin full access support_tickets" ON public.business_support_tickets;
DROP POLICY IF EXISTS "Super admin read support_tickets" ON public.business_support_tickets;
CREATE POLICY "Super admin read support_tickets" ON public.business_support_tickets
    FOR SELECT TO authenticated
    USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admin create support_tickets" ON public.business_support_tickets;
CREATE POLICY "Super admin create support_tickets" ON public.business_support_tickets
    FOR INSERT TO authenticated
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Super admin update support_tickets" ON public.business_support_tickets;
CREATE POLICY "Super admin update support_tickets" ON public.business_support_tickets
    FOR UPDATE TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Business members view own support_tickets" ON public.business_support_tickets;
CREATE POLICY "Business members view own support_tickets" ON public.business_support_tickets
    FOR SELECT TO authenticated
    USING (public.support_is_active_business_member(business_id));

DROP POLICY IF EXISTS "Business members create own support_tickets" ON public.business_support_tickets;
CREATE POLICY "Business members create own support_tickets" ON public.business_support_tickets
    FOR INSERT TO authenticated
    WITH CHECK (
        status = 'open'
        AND public.support_is_active_business_member(business_id)
    );

DROP POLICY IF EXISTS "Business members update own read state" ON public.business_support_tickets;
CREATE POLICY "Business members update own read state" ON public.business_support_tickets
    FOR UPDATE TO authenticated
    USING (public.support_is_active_business_member(business_id))
    WITH CHECK (public.support_is_active_business_member(business_id));

-- support_ticket_messages policies (explicit SELECT/INSERT; no UPDATE/DELETE)
DROP POLICY IF EXISTS "Super admin full access support_messages" ON public.support_ticket_messages;
DROP POLICY IF EXISTS "Super admin read support_messages" ON public.support_ticket_messages;
CREATE POLICY "Super admin read support_messages" ON public.support_ticket_messages
    FOR SELECT TO authenticated
    USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admin reply support_messages" ON public.support_ticket_messages;
CREATE POLICY "Super admin reply support_messages" ON public.support_ticket_messages
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_super_admin()
        AND EXISTS (
            SELECT 1
            FROM public.business_support_tickets t
            WHERE t.id = support_ticket_messages.ticket_id
              AND t.status <> 'closed'
        )
    );

DROP POLICY IF EXISTS "Business members view own support_messages" ON public.support_ticket_messages;
CREATE POLICY "Business members view own support_messages" ON public.support_ticket_messages
    FOR SELECT TO authenticated
    USING (public.support_is_active_business_member(business_id));

DROP POLICY IF EXISTS "Business members reply to own support_messages" ON public.support_ticket_messages;
CREATE POLICY "Business members reply to own support_messages" ON public.support_ticket_messages
    FOR INSERT TO authenticated
    WITH CHECK (
        sender_role <> 'super_admin'
        AND public.support_is_active_business_member(business_id)
        AND EXISTS (
            SELECT 1
            FROM public.business_support_tickets t
            WHERE t.id = support_ticket_messages.ticket_id
              AND t.business_id = support_ticket_messages.business_id
              AND t.status <> 'closed'
        )
    );

-- support_ticket_status_history policies (read-only audit trail)
DROP POLICY IF EXISTS "Super admin read support_history" ON public.support_ticket_status_history;
CREATE POLICY "Super admin read support_history" ON public.support_ticket_status_history
    FOR SELECT TO authenticated
    USING (public.is_super_admin());

DROP POLICY IF EXISTS "Business members read own support_history" ON public.support_ticket_status_history;
CREATE POLICY "Business members read own support_history" ON public.support_ticket_status_history
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.business_support_tickets t
            WHERE t.id = support_ticket_status_history.ticket_id
              AND public.support_is_active_business_member(t.business_id)
        )
    );

-- support_notifications policies (explicit SELECT/UPDATE matching GRANT SELECT, UPDATE (is_read))
DROP POLICY IF EXISTS "Super admin manage admin support_notifications" ON public.support_notifications;
DROP POLICY IF EXISTS "Super admin read admin support_notifications" ON public.support_notifications;
CREATE POLICY "Super admin read admin support_notifications" ON public.support_notifications
    FOR SELECT TO authenticated
    USING (public.is_super_admin() AND target_role = 'super_admin');

DROP POLICY IF EXISTS "Super admin mark admin notifications read" ON public.support_notifications;
CREATE POLICY "Super admin mark admin notifications read" ON public.support_notifications
    FOR UPDATE TO authenticated
    USING (public.is_super_admin() AND target_role = 'super_admin')
    WITH CHECK (public.is_super_admin() AND target_role = 'super_admin');

DROP POLICY IF EXISTS "Business members manage own business notifications" ON public.support_notifications;
CREATE POLICY "Business members manage own business notifications" ON public.support_notifications
    FOR SELECT TO authenticated
    USING (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND public.support_is_active_business_member(business_id)
    );

DROP POLICY IF EXISTS "Business members mark own notifications read" ON public.support_notifications;
CREATE POLICY "Business members mark own notifications read" ON public.support_notifications
    FOR UPDATE TO authenticated
    USING (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND public.support_is_active_business_member(business_id)
    )
    WITH CHECK (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND public.support_is_active_business_member(business_id)
    );

-- support_incidents policies (STRICTLY Super Admin SELECT/UPDATE; service_role inserts)
DROP POLICY IF EXISTS "Members view own business support incidents" ON public.support_incidents;
DROP POLICY IF EXISTS "Super admins manage support incidents" ON public.support_incidents;
DROP POLICY IF EXISTS "Super admins read support incidents" ON public.support_incidents;
CREATE POLICY "Super admins read support incidents" ON public.support_incidents
    FOR SELECT TO authenticated
    USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins update support incidents" ON public.support_incidents;
CREATE POLICY "Super admins update support incidents" ON public.support_incidents
    FOR UPDATE TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 9. Supabase Realtime Publication Configuration
-- -----------------------------------------------------------------------------
ALTER TABLE public.business_support_tickets REPLICA IDENTITY FULL;
ALTER TABLE public.support_ticket_messages REPLICA IDENTITY FULL;
ALTER TABLE public.support_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.support_incidents REPLICA IDENTITY FULL;

DO $$
DECLARE
    v_tbl TEXT;
    v_tables TEXT[] := ARRAY[
        'business_support_tickets',
        'support_ticket_messages',
        'support_notifications',
        'support_incidents'
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
-- 10. EXECUTABLE STAGING AUTHORIZATION TEST SUITE (EPHEMERAL TX: BEGIN .. ROLLBACK)
--
-- Kept inside a block comment so running the migration via `supabase db push` or
-- SQL Editor never writes test fixtures or rolls back DDL. To execute in staging
-- or local PostgreSQL AFTER applying the migration, copy the SQL inside /* ... */
-- and execute it as a privileged role (`postgres`); it runs top-level role
-- switches and ends with `ROLLBACK;`.
-- =============================================================================
/*
BEGIN;

-- -----------------------------------------------------------------------------
-- Fixture Setup (Privileged Migration Role; Rolled Back Completely at End)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_super_admin_id      UUID := '00000000-0000-4000-8000-000000000101';
    v_owner_a_id          UUID := '00000000-0000-4000-8000-000000000102';
    v_staff_a_id          UUID := '00000000-0000-4000-8000-000000000103';
    v_inactive_staff_a_id UUID := '00000000-0000-4000-8000-000000000104';
    v_owner_b_id          UUID := '00000000-0000-4000-8000-000000000105';
    v_owner_c_id          UUID := '00000000-0000-4000-8000-000000000106';
    v_biz_a_id            BIGINT;
    v_biz_b_id            BIGINT;
    v_biz_c_id            BIGINT;
    v_incident_a_id       UUID;
    v_has_biz_active_col  BOOLEAN := FALSE;
BEGIN
    INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    VALUES
        (v_super_admin_id,      'authenticated', 'authenticated', 'v3-test-superadmin@novacode.tech', NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Platform Admin"}'::jsonb),
        (v_owner_a_id,          'authenticated', 'authenticated', 'v3-test-owner-a@salonnaomi.com',  NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Naomi Owner"}'::jsonb),
        (v_staff_a_id,          'authenticated', 'authenticated', 'v3-test-staff-a@salonnaomi.com',  NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Stylist Staff"}'::jsonb),
        (v_inactive_staff_a_id, 'authenticated', 'authenticated', 'v3-test-inactive@salonnaomi.com', NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Former Member"}'::jsonb),
        (v_owner_b_id,          'authenticated', 'authenticated', 'v3-test-owner-b@otherbiz.com',    NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Other Owner"}'::jsonb),
        (v_owner_c_id,          'authenticated', 'authenticated', 'v3-test-owner-c@inactive.com',    NOW(), '{"provider":"email"}'::jsonb, '{"full_name":"Suspended Owner"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.platform_admins (user_id)
    VALUES (v_super_admin_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.businesses (name) VALUES ('__v3_test_salon_a__') RETURNING id INTO v_biz_a_id;
    INSERT INTO public.businesses (name) VALUES ('__v3_test_other_b__') RETURNING id INTO v_biz_b_id;
    INSERT INTO public.businesses (name) VALUES ('__v3_test_inactive_c__') RETURNING id INTO v_biz_c_id;

    -- Deactivate Business C using whichever status/active column exists on public.businesses
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'is_active'
    ) THEN
        EXECUTE 'UPDATE public.businesses SET is_active = FALSE WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'active'
    ) THEN
        EXECUTE 'UPDATE public.businesses SET active = FALSE WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'status'
    ) THEN
        EXECUTE 'UPDATE public.businesses SET status = ''inactive'' WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'deleted_at'
    ) THEN
        EXECUTE 'UPDATE public.businesses SET deleted_at = NOW() WHERE id = $1' USING v_biz_c_id;
        v_has_biz_active_col := TRUE;
    END IF;

    INSERT INTO public.business_members (business_id, user_id, role, is_active)
    VALUES
        (v_biz_a_id, v_owner_a_id,          'owner', TRUE),
        (v_biz_a_id, v_staff_a_id,          'staff', TRUE),
        (v_biz_a_id, v_inactive_staff_a_id, 'owner', FALSE),
        (v_biz_b_id, v_owner_b_id,          'owner', TRUE),
        (v_biz_c_id, v_owner_c_id,          'owner', TRUE);

    INSERT INTO public.support_incidents (business_id, source, severity, status, title, description, error_code)
    VALUES (
        v_biz_a_id,
        'integration_failure',
        'high',
        'open',
        '__v3_test_n8n_webhook_timeout__',
        'Simulated n8n webhook timeout for incident isolation test.',
        'N8N_504'
    )
    RETURNING id INTO v_incident_a_id;

    -- Store fixture IDs in transaction-local settings accessible across role switches
    PERFORM set_config('novacode_test.super_admin_id',      v_super_admin_id::text, true);
    PERFORM set_config('novacode_test.owner_a_id',          v_owner_a_id::text, true);
    PERFORM set_config('novacode_test.staff_a_id',          v_staff_a_id::text, true);
    PERFORM set_config('novacode_test.inactive_staff_a_id', v_inactive_staff_a_id::text, true);
    PERFORM set_config('novacode_test.owner_b_id',          v_owner_b_id::text, true);
    PERFORM set_config('novacode_test.owner_c_id',          v_owner_c_id::text, true);
    PERFORM set_config('novacode_test.biz_a_id',            v_biz_a_id::text, true);
    PERFORM set_config('novacode_test.biz_b_id',            v_biz_b_id::text, true);
    PERFORM set_config('novacode_test.biz_c_id',            v_biz_c_id::text, true);
    PERFORM set_config('novacode_test.incident_a_id',       v_incident_a_id::text, true);
    PERFORM set_config('novacode_test.has_biz_active_col',  v_has_biz_active_col::text, true);
END
$$;

-- -----------------------------------------------------------------------------
-- Test 1 & 2: Business Owner A creates ticket & sends reply (message_sync)
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.owner_a_id'),
    'role', 'authenticated',
    'email', 'v3-test-owner-a@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.owner_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_biz_a_id      BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_owner_a_id    UUID   := current_setting('novacode_test.owner_a_id')::uuid;
    v_ticket_a_id   UUID;
    v_status        TEXT;
    v_unread_admin  BOOLEAN;
    v_unread_biz    BOOLEAN;
    v_created_by    UUID;
    v_sender_role   TEXT;
    v_sender_id     UUID;
    v_history_cnt   INT;
BEGIN
    -- Attempt ticket insert claiming closed status; trigger must force status='open' or RLS/trigger lock it
    INSERT INTO public.business_support_tickets (business_id, category, subject, description, priority)
    VALUES (v_biz_a_id, 'technical_problem', 'Calendar slot overlap', 'Duplicate entries appear on Friday.', 'high')
    RETURNING id, status, unread_by_admin, unread_by_business, created_by
    INTO v_ticket_a_id, v_status, v_unread_admin, v_unread_biz, v_created_by;

    IF v_ticket_a_id IS NULL OR v_status <> 'open' OR v_unread_admin IS NOT TRUE OR v_unread_biz IS NOT FALSE OR v_created_by <> v_owner_a_id THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1): unexpected initial ticket state (status=%, unread_admin=%, unread_biz=%, created_by=%)',
            v_status, v_unread_admin, v_unread_biz, v_created_by;
    END IF;

    SELECT COUNT(*) INTO v_history_cnt
    FROM public.support_ticket_status_history
    WHERE ticket_id = v_ticket_a_id AND new_status = 'open';

    IF v_history_cnt <> 1 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 1): expected 1 status history row, got %', v_history_cnt;
    END IF;

    -- Owner A replies: trg_support_message_after_insert updates ticket unread_by_admin/last_message_at
    INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
    VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Follow-up screenshot details for Friday.')
    RETURNING sender_role, sender_id INTO v_sender_role, v_sender_id;

    IF v_sender_role <> 'business_owner' OR v_sender_id <> v_owner_a_id THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 2): expected business_owner/owner_a, got %/%', v_sender_role, v_sender_id;
    END IF;

    PERFORM set_config('novacode_test.ticket_a_id', v_ticket_a_id::text, true);
END
$$;

-- -----------------------------------------------------------------------------
-- Test 3: Super Admin partial notification read MUST NOT clear unread_by_admin
--         while newer unread notification N2 still exists
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.super_admin_id'),
    'role', 'authenticated',
    'email', 'v3-test-superadmin@novacode.tech',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.super_admin_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_ticket_a_id  UUID := current_setting('novacode_test.ticket_a_id')::uuid;
    v_notif_ids    UUID[];
    v_unread_admin BOOLEAN;
BEGIN
    SELECT array_agg(id ORDER BY created_at ASC, id ASC)
    INTO v_notif_ids
    FROM public.support_notifications
    WHERE ticket_id = v_ticket_a_id
      AND target_role = 'super_admin'
      AND is_read = FALSE;

    IF COALESCE(array_length(v_notif_ids, 1), 0) < 2 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3): expected >= 2 unread super_admin notifications, found %',
            COALESCE(array_length(v_notif_ids, 1), 0);
    END IF;

    -- Mark ONLY older notification N1 as read while newer N2 remains unread
    UPDATE public.support_notifications
    SET is_read = TRUE
    WHERE id = v_notif_ids[1];

    SELECT unread_by_admin INTO v_unread_admin
    FROM public.business_support_tickets
    WHERE id = v_ticket_a_id;

    IF v_unread_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3): marking older notification N1 read cleared unread_by_admin while N2 was still unread';
    END IF;

    -- Now mark remaining unread notification(s) as read -> unread_by_admin must clear
    UPDATE public.support_notifications
    SET is_read = TRUE
    WHERE ticket_id = v_ticket_a_id
      AND target_role = 'super_admin'
      AND is_read = FALSE;

    SELECT unread_by_admin INTO v_unread_admin
    FROM public.business_support_tickets
    WHERE id = v_ticket_a_id;

    IF v_unread_admin IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 3): clearing last unread super_admin notification failed to clear unread_by_admin';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 4A: Super Admin replies & updates status (creates multiple business notifs)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_ticket_a_id    UUID   := current_setting('novacode_test.ticket_a_id')::uuid;
    v_biz_a_id       BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_super_admin_id UUID   := current_setting('novacode_test.super_admin_id')::uuid;
    v_sender_role    TEXT;
    v_sender_id      UUID;
    v_unread_biz     BOOLEAN;
BEGIN
    INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
    VALUES (v_ticket_a_id, v_biz_a_id, 'super_admin', 'Investigating your Friday calendar sync.')
    RETURNING sender_role, sender_id INTO v_sender_role, v_sender_id;

    IF v_sender_role <> 'super_admin' OR v_sender_id <> v_super_admin_id THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4A): expected super_admin/super_admin_id, got %/%', v_sender_role, v_sender_id;
    END IF;

    UPDATE public.business_support_tickets
    SET status = 'in_progress'
    WHERE id = v_ticket_a_id;

    UPDATE public.business_support_tickets
    SET status = 'waiting_for_customer'
    WHERE id = v_ticket_a_id;

    SELECT unread_by_business INTO v_unread_biz
    FROM public.business_support_tickets
    WHERE id = v_ticket_a_id;

    IF v_unread_biz IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4A): expected unread_by_business = TRUE after Super Admin reply';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 4B: Business Owner A partial notification read vs opening ticket read sync
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.owner_a_id'),
    'role', 'authenticated',
    'email', 'v3-test-owner-a@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.owner_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_ticket_a_id      UUID := current_setting('novacode_test.ticket_a_id')::uuid;
    v_biz_notif_ids    UUID[];
    v_unread_biz       BOOLEAN;
    v_remaining_unread INT;
BEGIN
    SELECT array_agg(id ORDER BY created_at ASC, id ASC)
    INTO v_biz_notif_ids
    FROM public.support_notifications
    WHERE ticket_id = v_ticket_a_id
      AND target_role = 'business'
      AND is_read = FALSE;

    IF COALESCE(array_length(v_biz_notif_ids, 1), 0) < 2 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4B): expected >= 2 unread business notifications, found %',
            COALESCE(array_length(v_biz_notif_ids, 1), 0);
    END IF;

    -- Dismiss ONLY oldest notification while newer notifications remain unread
    UPDATE public.support_notifications
    SET is_read = TRUE
    WHERE id = v_biz_notif_ids[1];

    SELECT unread_by_business INTO v_unread_biz
    FROM public.business_support_tickets
    WHERE id = v_ticket_a_id;

    IF v_unread_biz IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4B): partial business notification read cleared unread_by_business prematurely';
    END IF;

    -- Owner opens ticket directly -> ticket_read_sync must mark all remaining business notifications read
    UPDATE public.business_support_tickets
    SET unread_by_business = FALSE
    WHERE id = v_ticket_a_id;

    SELECT COUNT(*) INTO v_remaining_unread
    FROM public.support_notifications
    WHERE ticket_id = v_ticket_a_id
      AND target_role = 'business'
      AND is_read = FALSE;

    IF v_remaining_unread <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 4B): ticket_read_sync left % unread business notification(s)', v_remaining_unread;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 5: Business Staff A reply derives sender_role = 'business_staff'
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.staff_a_id'),
    'role', 'authenticated',
    'email', 'v3-test-staff-a@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.staff_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_ticket_a_id UUID   := current_setting('novacode_test.ticket_a_id')::uuid;
    v_biz_a_id    BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_staff_a_id  UUID   := current_setting('novacode_test.staff_a_id')::uuid;
    v_sender_role TEXT;
    v_sender_id   UUID;
BEGIN
    -- Staff claims sender_role='business_owner'; trigger must downgrade/derive 'business_staff'
    INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
    VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Staff member confirming slot overlap.')
    RETURNING sender_role, sender_id INTO v_sender_role, v_sender_id;

    IF v_sender_role <> 'business_staff' OR v_sender_id <> v_staff_a_id THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 5): expected business_staff/staff_a, got %/%', v_sender_role, v_sender_id;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 6A: Inactive Membership (bm.is_active = FALSE) MUST be blocked everywhere
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.inactive_staff_a_id'),
    'role', 'authenticated',
    'email', 'v3-test-inactive@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.inactive_staff_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_ticket_a_id UUID   := current_setting('novacode_test.ticket_a_id')::uuid;
    v_biz_a_id    BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_visible_cnt INT;
    v_rows        INT;
    v_blocked     BOOLEAN;
BEGIN
    SELECT COUNT(*) INTO v_visible_cnt FROM public.business_support_tickets WHERE id = v_ticket_a_id;
    IF v_visible_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 6A): inactive member viewed % ticket(s)', v_visible_cnt;
    END IF;

    UPDATE public.business_support_tickets SET unread_by_business = FALSE WHERE id = v_ticket_a_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 6A): inactive member updated % ticket row(s)', v_rows;
    END IF;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.business_support_tickets (business_id, category, subject, description)
        VALUES (v_biz_a_id, 'other', 'Inactive member ticket', 'Should fail because bm.is_active = FALSE.');
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 6A): inactive member created a support ticket';
    END IF;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Inactive member reply attempt');
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 6A): inactive member posted a support message';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 6B: Inactive Business (businesses deactivated) MUST be blocked
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.owner_c_id'),
    'role', 'authenticated',
    'email', 'v3-test-owner-c@inactive.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.owner_c_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_biz_c_id           BIGINT  := current_setting('novacode_test.biz_c_id')::bigint;
    v_has_biz_active_col BOOLEAN := current_setting('novacode_test.has_biz_active_col')::boolean;
    v_blocked            BOOLEAN;
BEGIN
    IF v_has_biz_active_col THEN
        v_blocked := FALSE;
        BEGIN
            INSERT INTO public.business_support_tickets (business_id, category, subject, description)
            VALUES (v_biz_c_id, 'other', 'Suspended business ticket', 'Should fail because business is inactive.');
        EXCEPTION
            WHEN insufficient_privilege, check_violation, raise_exception THEN
                v_blocked := TRUE;
        END;
        IF NOT v_blocked THEN
            RAISE EXCEPTION 'TEST FAILURE (Test 6B): inactive business owner created a support ticket';
        END IF;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 7: Cross-Tenant Isolation (Business Owner B cannot touch Business A)
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.owner_b_id'),
    'role', 'authenticated',
    'email', 'v3-test-owner-b@otherbiz.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.owner_b_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_ticket_a_id UUID   := current_setting('novacode_test.ticket_a_id')::uuid;
    v_biz_a_id    BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_biz_b_id    BIGINT := current_setting('novacode_test.biz_b_id')::bigint;
    v_cnt         INT;
    v_rows        INT;
    v_blocked     BOOLEAN;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.business_support_tickets WHERE id = v_ticket_a_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 7): cross-tenant leak on business_support_tickets (% rows)', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.support_ticket_messages WHERE ticket_id = v_ticket_a_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 7): cross-tenant leak on support_ticket_messages (% rows)', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.support_ticket_status_history WHERE ticket_id = v_ticket_a_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 7): cross-tenant leak on support_ticket_status_history (% rows)', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.support_notifications WHERE ticket_id = v_ticket_a_id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 7): cross-tenant leak on support_notifications (% rows)', v_cnt;
    END IF;

    UPDATE public.business_support_tickets SET unread_by_business = FALSE WHERE id = v_ticket_a_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 7): cross-tenant UPDATE affected % row(s)', v_rows;
    END IF;

    -- Cross-tenant reply claiming business_id = biz_a
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Cross-tenant reply A');
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 7): cross-tenant reply with biz_a succeeded';
    END IF;

    -- Cross-tenant reply claiming Owner B's own business_id = biz_b against Ticket A
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_b_id, 'business_owner', 'Cross-tenant ticket_id mismatch');
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 7): mismatched business_id reply to Ticket A succeeded';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 8 & 9A: Unauthorized Modifications, Spoofing & Business Incident Denial
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.owner_a_id'),
    'role', 'authenticated',
    'email', 'v3-test-owner-a@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.owner_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_ticket_a_id   UUID   := current_setting('novacode_test.ticket_a_id')::uuid;
    v_incident_a_id UUID   := current_setting('novacode_test.incident_a_id')::uuid;
    v_biz_a_id      BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_owner_b_id    UUID   := current_setting('novacode_test.owner_b_id')::uuid;
    v_notif_id      UUID;
    v_cnt           INT;
    v_rows          INT;
    v_err           TEXT;
    v_blocked       BOOLEAN;
BEGIN
    -- 1. Anti-spoofing: manual set_config('novacode.support_trigger_op') + protected update MUST fail
    v_blocked := FALSE;
    BEGIN
        PERFORM set_config('novacode.support_trigger_op', 'message_sync', true);
        UPDATE public.business_support_tickets
        SET status = 'closed', unread_by_admin = FALSE
        WHERE id = v_ticket_a_id;
    EXCEPTION
        WHEN raise_exception THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            IF v_err NOT LIKE 'Unauthorized%' THEN
                RAISE EXCEPTION 'TEST FAILURE (Test 8): unexpected error on GUC spoof: %', v_err;
            END IF;
            v_blocked := TRUE;
    END;
    PERFORM set_config('novacode.support_trigger_op', '', true);
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): Business Owner modified protected fields via GUC spoof';
    END IF;

    -- 2. Business Owner cannot set unread_by_business = TRUE or mutate priority
    v_blocked := FALSE;
    BEGIN
        UPDATE public.business_support_tickets SET unread_by_business = TRUE WHERE id = v_ticket_a_id;
    EXCEPTION
        WHEN raise_exception THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            IF v_err NOT LIKE 'Unauthorized%' THEN
                RAISE EXCEPTION 'TEST FAILURE (Test 8): unexpected error setting unread_by_business=TRUE: %', v_err;
            END IF;
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): Business Owner set unread_by_business = TRUE';
    END IF;

    -- 3. Role spoofing: sender_role = 'super_admin'
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'super_admin', 'Impersonating support');
    EXCEPTION
        WHEN raise_exception THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            IF v_err NOT LIKE 'Unauthorized%' THEN
                RAISE EXCEPTION 'TEST FAILURE (Test 8): unexpected error on super_admin spoof: %', v_err;
            END IF;
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): Business Owner posted as super_admin';
    END IF;

    -- 4. Sender impersonation: sender_id = owner_b
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, v_owner_b_id, 'business_owner', 'Impersonating user B');
    EXCEPTION
        WHEN raise_exception THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            IF v_err NOT LIKE 'Unauthorized%' THEN
                RAISE EXCEPTION 'TEST FAILURE (Test 8): unexpected error on sender_id spoof: %', v_err;
            END IF;
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): Business Owner spoofed sender_id';
    END IF;

    -- 5. Creator impersonation: created_by = owner_b
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.business_support_tickets (business_id, created_by, category, subject, description)
        VALUES (v_biz_a_id, v_owner_b_id, 'other', 'Creator spoof', 'Attempt to spoof created_by');
    EXCEPTION
        WHEN raise_exception THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            IF v_err NOT LIKE 'Unauthorized%' THEN
                RAISE EXCEPTION 'TEST FAILURE (Test 8): unexpected error on created_by spoof: %', v_err;
            END IF;
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): Business Owner spoofed created_by';
    END IF;

    -- 6. Column-level notification protection: cannot modify title
    SELECT id INTO v_notif_id
    FROM public.support_notifications
    WHERE ticket_id = v_ticket_a_id AND target_role = 'business'
    LIMIT 1;

    IF v_notif_id IS NULL THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): expected business notification row for column grant test';
    END IF;

    v_blocked := FALSE;
    BEGIN
        UPDATE public.support_notifications SET title = 'Tampered' WHERE id = v_notif_id;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): Business Owner updated support_notifications.title';
    END IF;

    -- 7. No DELETE privilege on business_support_tickets
    v_blocked := FALSE;
    BEGIN
        DELETE FROM public.business_support_tickets WHERE id = v_ticket_a_id;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 8): Business Owner deleted a support ticket';
    END IF;

    -- 8. Incident isolation (Test 9A): Business Owner cannot read, insert, or update support_incidents
    SELECT COUNT(*) INTO v_cnt FROM public.support_incidents;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9A): Business Owner read % support_incidents row(s)', v_cnt;
    END IF;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_incidents (business_id, source, severity, title)
        VALUES (v_biz_a_id, 'business_report', 'critical', 'Unauthorized incident insert');
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9A): Business Owner inserted into support_incidents';
    END IF;

    UPDATE public.support_incidents SET status = 'resolved' WHERE id = v_incident_a_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9A): Business Owner resolved % incident row(s)', v_rows;
    END IF;

    v_blocked := FALSE;
    BEGIN
        UPDATE public.support_incidents SET severity = 'low' WHERE id = v_incident_a_id;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9A): Business Owner modified support_incidents.severity';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 9B & 10A: Super Admin manages incidents, closes ticket, & closed lock
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.super_admin_id'),
    'role', 'authenticated',
    'email', 'v3-test-superadmin@novacode.tech',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.super_admin_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_incident_a_id UUID   := current_setting('novacode_test.incident_a_id')::uuid;
    v_ticket_a_id   UUID   := current_setting('novacode_test.ticket_a_id')::uuid;
    v_biz_a_id      BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_status        TEXT;
    v_resolved_at   TIMESTAMPTZ;
    v_blocked       BOOLEAN;
BEGIN
    SELECT status INTO v_status FROM public.support_incidents WHERE id = v_incident_a_id;
    IF v_status <> 'open' THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9B): expected open incident, got %', v_status;
    END IF;

    -- Super Admin can resolve incident via column-granted UPDATE (status, resolved_at)
    UPDATE public.support_incidents
    SET status = 'resolved'
    WHERE id = v_incident_a_id
    RETURNING status, resolved_at INTO v_status, v_resolved_at;

    IF v_status <> 'resolved' OR v_resolved_at IS NULL THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9B): Super Admin incident resolve failed (status=%, resolved_at=%)',
            v_status, v_resolved_at;
    END IF;

    -- Even Super Admin cannot mutate immutable incident severity or insert directly as authenticated
    v_blocked := FALSE;
    BEGIN
        UPDATE public.support_incidents SET severity = 'low' WHERE id = v_incident_a_id;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9B): authenticated Super Admin mutated support_incidents.severity';
    END IF;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_incidents (business_id, source, severity, title)
        VALUES (v_biz_a_id, 'technical_error', 'low', 'Direct insert test');
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 9B): authenticated Super Admin inserted directly into support_incidents';
    END IF;

    -- Close ticket A and verify Super Admin cannot reply to closed ticket
    UPDATE public.business_support_tickets SET status = 'closed' WHERE id = v_ticket_a_id;

    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'super_admin', 'Reply after close');
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 10A): Super Admin replied to closed ticket';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 10B: Owner A blocked from replying to closed ticket, can still mark read
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('novacode_test.owner_a_id'),
    'role', 'authenticated',
    'email', 'v3-test-owner-a@salonnaomi.com',
    'is_anonymous', false
)::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('novacode_test.owner_a_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_ticket_a_id UUID   := current_setting('novacode_test.ticket_a_id')::uuid;
    v_biz_a_id    BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_blocked     BOOLEAN;
BEGIN
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Owner reply after close');
    EXCEPTION
        WHEN insufficient_privilege, check_violation, raise_exception THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 10B): Business Owner replied to closed ticket';
    END IF;

    -- Reading/clearing unread_by_business on a closed ticket remains permitted
    UPDATE public.business_support_tickets
    SET unread_by_business = FALSE
    WHERE id = v_ticket_a_id;
END
$$;

-- -----------------------------------------------------------------------------
-- Test 10C: NULL auth.uid() & anon role rejected
-- -----------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_biz_a_id BIGINT := current_setting('novacode_test.biz_a_id')::bigint;
    v_err      TEXT;
    v_blocked  BOOLEAN;
BEGIN
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.business_support_tickets (business_id, category, subject, description)
        VALUES (v_biz_a_id, 'other', 'No UID ticket', 'Should fail without auth.uid().');
    EXCEPTION
        WHEN raise_exception THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            IF v_err NOT LIKE 'Unauthorized%' THEN
                RAISE EXCEPTION 'TEST FAILURE (Test 10C): unexpected error for NULL auth.uid(): %', v_err;
            END IF;
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 10C): NULL auth.uid() created support ticket';
    END IF;
END
$$;

RESET ROLE;
SET LOCAL ROLE anon;

DO $$
DECLARE
    v_cnt     INT;
    v_blocked BOOLEAN;
BEGIN
    v_blocked := FALSE;
    BEGIN
        SELECT COUNT(*) INTO v_cnt FROM public.business_support_tickets;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST FAILURE (Test 10C): anon role queried business_support_tickets (% rows)', v_cnt;
    END IF;
END
$$;

RESET ROLE;
ROLLBACK;
*/
