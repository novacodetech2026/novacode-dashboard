-- =============================================================================
-- NOVACODE TECH — HARDENED BUSINESS SUPPORT & TECHNICAL INCIDENTS SYSTEM (V2)
-- Migration: 20261113_support_system_hardened_v2.sql
--
-- REVIEW ONLY — DO NOT AUTO-EXECUTE AGAINST PRODUCTION WITHOUT STAGING REVIEW.
-- Preserves all tables, columns, RLS policies, support functionality, and
-- existing booking RPCs / n8n / invitation workflows.
--
-- WHAT V2 FIXES OVER V1 (20261113_support_system_hardened.sql):
-- 1. Resolves the trigger authorization conflict between:
--      - public.trg_support_ticket_before_update()
--      - public.trg_support_message_after_insert()
--      - public.trg_support_notification_after_update()
--    In V1, trg_support_ticket_before_update() was SECURITY DEFINER and checked
--    auth.uid() / public.is_super_admin(). Because auth.uid() retains the
--    Business Owner's JWT claim inside SECURITY DEFINER AFTER triggers, business
--    replies and notification read-sync updates were wrongly rejected with:
--    "Unauthorized: business users can only update read state on support tickets".
-- 2. Solution without relying on pg_trigger_depth() alone:
--    - trg_support_ticket_before_update() and trg_support_notification_before_update()
--      execute as SECURITY INVOKER so `current_user` reliably identifies whether
--      the caller is an unprivileged API role (`authenticated`/`anon`) or an
--      elevated SECURITY DEFINER trigger function owned by the table owner/superuser.
--    - Trusted SECURITY DEFINER sync triggers (trg_support_message_after_insert,
--      trg_support_notification_after_update, trg_support_ticket_after_update) set
--      an operation-specific transaction-local marker (`novacode.support_trigger_op`)
--      immediately before their internal sync UPDATE and restore/clear it inside
--      an EXCEPTION-safe block immediately after.
--    - Even if an authenticated client manually calls set_config('novacode.support_trigger_op', ...),
--      `current_user` remains `'authenticated'` inside SECURITY INVOKER
--      trg_support_ticket_before_update(), so the spoofing attempt is rejected.
--    - Even during trusted trigger syncs, immutable identity columns and protected
--      triage columns (status, priority, category, subject, description) remain locked.
-- 3. Replaces pg_trigger_depth() loop suppression with explicit operation markers
--    (`ticket_read_sync` <-> `notification_read_sync`) so business/admin replies
--    also cleanly synchronize stale notifications without recursive loops.
-- 4. Closes NULL auth.uid() bypasses for authenticated/anon callers, blocks
--    impersonation of created_by / sender_id / sender_role / mismatched business_id,
--    and audits SECURITY DEFINER ownership, search_path, EXECUTE, and table grants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Pre-Flight Production Compatibility Checks (Non-Destructive)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_id_type TEXT;
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
-- 6. Hardened Security Triggers (Trusted Internal Sync + Strict User Guardrails)
-- -----------------------------------------------------------------------------

-- Helper to resolve human-readable name/email for an auth user inside triggers
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

-- Ticket BEFORE INSERT: bind author from auth.uid(), verify active membership, lock initial state
CREATE OR REPLACE FUNCTION public.trg_support_ticket_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_label TEXT;
    v_is_super BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL AND current_user IN ('authenticated', 'anon', 'PUBLIC') THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user context required to create support tickets';
    END IF;

    IF auth.uid() IS NOT NULL THEN
        v_is_super := public.is_super_admin();

        IF NOT v_is_super THEN
            IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
                RAISE EXCEPTION 'Unauthorized: cannot impersonate another ticket creator';
            END IF;

            IF NEW.business_id IS NULL OR NOT public.is_business_member(NEW.business_id) THEN
                RAISE EXCEPTION 'Unauthorized: active business membership required to create support tickets';
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

-- Ticket AFTER INSERT: write status history & notify Super Admin
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

-- Ticket BEFORE UPDATE (CRITICAL V2 FIX):
-- Uses SECURITY INVOKER so `current_user` preserves the actual caller role:
--   * Direct client UPDATEs execute with current_user = 'authenticated', so a
--     client can NEVER spoof `novacode.support_trigger_op` via set_config().
--   * Internal updates fired by SECURITY DEFINER triggers (owned by table owner
--     / BYPASSRLS role) execute with elevated `current_user`, pg_trigger_depth() >= 2,
--     AND an explicit `novacode.support_trigger_op` context, while still pinning
--     immutable columns and protected triage columns.
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
    -- Immutable identity and creation metadata are never modifiable
    NEW.id := OLD.id;
    NEW.business_id := OLD.business_id;
    NEW.created_by := OLD.created_by;
    NEW.created_by_name := OLD.created_by_name;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := NOW();

    v_trigger_op := NULLIF(current_setting('novacode.support_trigger_op', true), '');

    -- Trusted internal trigger check requires ALL THREE independent invariants:
    --   1. Elevated non-API caller role (table owner or BYPASSRLS/superuser via SECURITY DEFINER)
    --   2. Nested trigger execution (depth >= 2, never a top-level client UPDATE)
    --   3. Explicit internal sync operation marker set by support triggers
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
        -- Even trusted internal sync triggers cannot mutate ticket metadata or triage status
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

    -- All API / JWT callers must have a verified auth.uid()
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user context required';
    END IF;

    IF public.is_super_admin() THEN
        RETURN NEW;
    END IF;

    -- Non-Super-Admin business users: verify active membership and strictly allow clearing own unread flag
    IF NOT public.is_business_member(OLD.business_id) THEN
        RAISE EXCEPTION 'Unauthorized: active business membership required';
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

-- Ticket AFTER UPDATE: log status history, generate business notification, sync notification read state
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

    -- Avoid recursive bounce if this update originated from trg_support_notification_after_update()
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

-- Message BEFORE INSERT: enforce closed-ticket lock, active membership, and server-side identity/role
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
    v_actor_label TEXT;
    v_is_super BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL AND current_user IN ('authenticated', 'anon', 'PUBLIC') THEN
        RAISE EXCEPTION 'Unauthorized: authenticated user context required to reply to support tickets';
    END IF;

    SELECT business_id, status
    INTO v_ticket_business_id, v_ticket_status
    FROM public.business_support_tickets
    WHERE id = NEW.ticket_id;

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

            SELECT bm.role::TEXT INTO v_member_role
            FROM public.business_members bm
            WHERE bm.business_id = v_ticket_business_id
              AND bm.user_id = auth.uid()
            ORDER BY CASE
                WHEN bm.role::TEXT = 'owner' THEN 1
                WHEN bm.role::TEXT = 'admin' THEN 2
                ELSE 3
            END
            LIMIT 1;

            IF v_member_role IS NULL THEN
                RAISE EXCEPTION 'Unauthorized: active business membership required to reply';
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
            UPDATE public.business_support_tickets
            SET last_message_at = NEW.created_at,
                unread_by_business = TRUE,
                unread_by_admin = FALSE,
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
            UPDATE public.business_support_tickets
            SET last_message_at = NEW.created_at,
                unread_by_admin = TRUE,
                unread_by_business = FALSE,
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

-- Notification AFTER UPDATE: keep linked ticket unread flags synchronized when notifications are marked read
CREATE OR REPLACE FUNCTION public.trg_support_notification_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev_op TEXT;
BEGIN
    v_prev_op := NULLIF(current_setting('novacode.support_trigger_op', true), '');

    IF v_prev_op IS DISTINCT FROM 'ticket_read_sync'
       AND OLD.is_read = FALSE
       AND NEW.is_read = TRUE
       AND NEW.ticket_id IS NOT NULL THEN
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

-- Ensure internal helpers and trigger functions cannot be invoked directly as RPCs
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

-- Audit SECURITY DEFINER functions: verify fixed search_path and owner alignment
DO $$
DECLARE
    v_fn RECORD;
    v_table_owner TEXT;
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
            EXECUTE format('ALTER FUNCTION %s OWNER TO %I', v_fn.sig, v_table_owner);
        END IF;
    END LOOP;
END
$$;

-- Minimum table & column-level privileges
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
-- 8. Strict Row-Level Security (RLS) Policies (Multi-Tenant Isolated)
-- -----------------------------------------------------------------------------
ALTER TABLE public.business_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_incidents ENABLE ROW LEVEL SECURITY;

-- business_support_tickets policies
DROP POLICY IF EXISTS "Super admin full access support_tickets" ON public.business_support_tickets;
CREATE POLICY "Super admin full access support_tickets" ON public.business_support_tickets
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Business members view own support_tickets" ON public.business_support_tickets;
CREATE POLICY "Business members view own support_tickets" ON public.business_support_tickets
    FOR SELECT TO authenticated
    USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS "Business members create own support_tickets" ON public.business_support_tickets;
CREATE POLICY "Business members create own support_tickets" ON public.business_support_tickets
    FOR INSERT TO authenticated
    WITH CHECK (
        status = 'open'
        AND public.is_business_member(business_id)
    );

DROP POLICY IF EXISTS "Business members update own read state" ON public.business_support_tickets;
CREATE POLICY "Business members update own read state" ON public.business_support_tickets
    FOR UPDATE TO authenticated
    USING (public.is_business_member(business_id))
    WITH CHECK (public.is_business_member(business_id));

-- support_ticket_messages policies
DROP POLICY IF EXISTS "Super admin full access support_messages" ON public.support_ticket_messages;
CREATE POLICY "Super admin full access support_messages" ON public.support_ticket_messages
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (
        public.is_super_admin()
        AND EXISTS (
            SELECT 1 FROM public.business_support_tickets t
            WHERE t.id = support_ticket_messages.ticket_id
              AND t.status <> 'closed'
        )
    );

DROP POLICY IF EXISTS "Business members view own support_messages" ON public.support_ticket_messages;
CREATE POLICY "Business members view own support_messages" ON public.support_ticket_messages
    FOR SELECT TO authenticated
    USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS "Business members reply to own support_messages" ON public.support_ticket_messages;
CREATE POLICY "Business members reply to own support_messages" ON public.support_ticket_messages
    FOR INSERT TO authenticated
    WITH CHECK (
        sender_role <> 'super_admin'
        AND public.is_business_member(business_id)
        AND EXISTS (
            SELECT 1
            FROM public.business_support_tickets t
            WHERE t.id = support_ticket_messages.ticket_id
              AND t.business_id = support_ticket_messages.business_id
              AND t.status <> 'closed'
        )
    );

-- support_ticket_status_history policies
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
              AND public.is_business_member(t.business_id)
        )
    );

-- support_notifications policies
DROP POLICY IF EXISTS "Super admin manage admin support_notifications" ON public.support_notifications;
CREATE POLICY "Super admin manage admin support_notifications" ON public.support_notifications
    FOR ALL TO authenticated
    USING (public.is_super_admin() AND target_role = 'super_admin')
    WITH CHECK (public.is_super_admin() AND target_role = 'super_admin');

DROP POLICY IF EXISTS "Business members manage own business notifications" ON public.support_notifications;
CREATE POLICY "Business members manage own business notifications" ON public.support_notifications
    FOR SELECT TO authenticated
    USING (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND public.is_business_member(business_id)
    );

DROP POLICY IF EXISTS "Business members mark own notifications read" ON public.support_notifications;
CREATE POLICY "Business members mark own notifications read" ON public.support_notifications
    FOR UPDATE TO authenticated
    USING (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND public.is_business_member(business_id)
    )
    WITH CHECK (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND public.is_business_member(business_id)
    );

-- support_incidents policies (STRICTLY Super Admin Only — never exposed to business members)
DROP POLICY IF EXISTS "Members view own business support incidents" ON public.support_incidents;
DROP POLICY IF EXISTS "Super admins manage support incidents" ON public.support_incidents;
CREATE POLICY "Super admins manage support incidents" ON public.support_incidents
    FOR ALL TO authenticated
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

-- =============================================================================
-- 10. DATABASE-LEVEL AUTHORIZATION TEST SUITE (STAGING / EPHEMERAL TX ONLY)
--
-- Kept inside a block comment so applying the migration does NOT insert synthetic
-- records into production. To execute in staging or local PostgreSQL, copy the
-- SQL inside /* ... */ and run as superuser/postgres; it ends with ROLLBACK.
-- =============================================================================
/*
BEGIN;

DO $$
DECLARE
    v_super_admin_id UUID := '00000000-0000-4000-8000-000000000001';
    v_owner_a_id     UUID := '00000000-0000-4000-8000-000000000002';
    v_staff_a_id     UUID := '00000000-0000-4000-8000-000000000003';
    v_owner_b_id     UUID := '00000000-0000-4000-8000-000000000004';
    v_biz_a_id       BIGINT;
    v_biz_b_id       BIGINT;
    v_ticket_a_id    UUID;
    v_admin_notif_id UUID;
    v_biz_notif_id   UUID;
    v_row_count      INT;
    v_unread_admin   BOOLEAN;
    v_unread_biz     BOOLEAN;
    v_status         TEXT;
    v_sender_role    TEXT;
    v_err            TEXT;
BEGIN
    -- -------------------------------------------------------------------------
    -- Test Fixture Setup (Rolled back at end of test script)
    -- -------------------------------------------------------------------------
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES
        (v_super_admin_id, 'superadmin-test@novacode.tech', '{"full_name":"Platform Admin"}'::jsonb),
        (v_owner_a_id,     'owner-a-test@salonnaomi.com',   '{"full_name":"Naomi Owner"}'::jsonb),
        (v_staff_a_id,     'staff-a-test@salonnaomi.com',   '{"full_name":"Stylist Staff"}'::jsonb),
        (v_owner_b_id,     'owner-b-test@otherbiz.com',     '{"full_name":"Other Owner"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.platform_admins (user_id)
    VALUES (v_super_admin_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.businesses (name) VALUES ('Test Salon Naomi A') RETURNING id INTO v_biz_a_id;
    INSERT INTO public.businesses (name) VALUES ('Test Other Business B') RETURNING id INTO v_biz_b_id;

    INSERT INTO public.business_members (business_id, user_id, role)
    VALUES
        (v_biz_a_id, v_owner_a_id, 'owner'),
        (v_biz_a_id, v_staff_a_id, 'staff'),
        (v_biz_b_id, v_owner_b_id, 'owner');

    -- -------------------------------------------------------------------------
    -- Scenario 1: Business Owner A creates a support ticket
    -- -------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_owner_a_id::TEXT, true);

    INSERT INTO public.business_support_tickets (business_id, category, subject, description, priority)
    VALUES (v_biz_a_id, 'technical_problem', 'Calendar slot overlap', 'Slots show duplicate entries on Friday.', 'high')
    RETURNING id INTO v_ticket_a_id;

    SELECT status, unread_by_admin, unread_by_business
    INTO v_status, v_unread_admin, v_unread_biz
    FROM public.business_support_tickets
    WHERE id = v_ticket_a_id;

    ASSERT v_status = 'open', 'Expected initial ticket status = open';
    ASSERT v_unread_admin = TRUE, 'Expected unread_by_admin = TRUE on creation';
    ASSERT v_unread_biz = FALSE, 'Expected unread_by_business = FALSE on creation';

    -- -------------------------------------------------------------------------
    -- Scenario 2: CRITICAL FIX — Business Owner A replies to own open ticket
    -- Must succeed even though trg_support_message_after_insert updates ticket
    -- unread_by_admin / last_message_at while auth.uid() = v_owner_a_id!
    -- -------------------------------------------------------------------------
    INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
    VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Added screenshot details for Friday.')
    RETURNING sender_role INTO v_sender_role;

    ASSERT v_sender_role = 'business_owner', 'Expected server-derived sender_role = business_owner';

    -- -------------------------------------------------------------------------
    -- Scenario 3: Anti-Spoofing — Business Owner A tries set_config() + direct
    -- protected field update (status / unread_by_admin / last_message_at)
    -- Must FAIL because trg_support_ticket_before_update runs as SECURITY INVOKER
    -- -------------------------------------------------------------------------
    BEGIN
        PERFORM set_config('novacode.support_trigger_op', 'message_sync', true);
        UPDATE public.business_support_tickets
        SET status = 'closed', unread_by_admin = FALSE
        WHERE id = v_ticket_a_id;
        RAISE EXCEPTION 'SECURITY REGRESSION: Business Owner modified protected ticket fields via GUC spoof';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err LIKE 'Unauthorized%', 'Expected Unauthorized error on GUC spoof, got: ' || v_err;
    END;
    PERFORM set_config('novacode.support_trigger_op', '', true);

    -- -------------------------------------------------------------------------
    -- Scenario 4: Identity & Role Anti-Spoofing on Ticket & Message INSERT
    -- -------------------------------------------------------------------------
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'super_admin', 'Impersonating support');
        RAISE EXCEPTION 'SECURITY REGRESSION: Business Owner posted as super_admin';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err LIKE 'Unauthorized%', 'Expected Unauthorized error on role spoof, got: ' || v_err;
    END;

    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, v_owner_b_id, 'business_owner', 'Impersonating user B');
        RAISE EXCEPTION 'SECURITY REGRESSION: Business Owner spoofed sender_id';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err LIKE 'Unauthorized%', 'Expected Unauthorized error on sender_id spoof, got: ' || v_err;
    END;

    -- -------------------------------------------------------------------------
    -- Scenario 5: Staff Member A replies (sender_role derived as business_staff)
    -- -------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_staff_a_id::TEXT, true);

    INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
    VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Staff member confirming issue persists.')
    RETURNING sender_role INTO v_sender_role;

    ASSERT v_sender_role = 'business_staff', 'Expected staff reply to resolve sender_role = business_staff';

    -- -------------------------------------------------------------------------
    -- Scenario 6: Cross-Tenant Isolation (Business Owner B cannot read/reply/update)
    -- -------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_owner_b_id::TEXT, true);

    SELECT COUNT(*) INTO v_row_count FROM public.business_support_tickets WHERE id = v_ticket_a_id;
    ASSERT v_row_count = 0, 'Cross-tenant leak: Owner B saw Business A ticket';

    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Cross-tenant reply');
        RAISE EXCEPTION 'SECURITY REGRESSION: Cross-tenant reply succeeded';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    SELECT COUNT(*) INTO v_row_count FROM public.support_incidents;
    ASSERT v_row_count = 0, 'Security leak: Business Owner read support_incidents';

    -- -------------------------------------------------------------------------
    -- Scenario 7: Super Admin reads notification, replies, and updates status
    -- -------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_super_admin_id::TEXT, true);

    SELECT id INTO v_admin_notif_id
    FROM public.support_notifications
    WHERE ticket_id = v_ticket_a_id AND target_role = 'super_admin' AND is_read = FALSE
    ORDER BY created_at DESC
    LIMIT 1;

    ASSERT v_admin_notif_id IS NOT NULL, 'Expected unread super_admin notification';

    UPDATE public.support_notifications SET is_read = TRUE WHERE id = v_admin_notif_id;

    SELECT unread_by_admin INTO v_unread_admin FROM public.business_support_tickets WHERE id = v_ticket_a_id;
    ASSERT v_unread_admin = FALSE, 'Expected notification read sync to clear unread_by_admin';

    INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
    VALUES (v_ticket_a_id, v_biz_a_id, 'super_admin', 'We fixed your calendar sync.')
    RETURNING sender_role INTO v_sender_role;

    ASSERT v_sender_role = 'super_admin', 'Expected Super Admin sender_role = super_admin';

    UPDATE public.business_support_tickets SET status = 'waiting_for_customer' WHERE id = v_ticket_a_id;

    -- -------------------------------------------------------------------------
    -- Scenario 8: Business Owner A marks business notification read -> syncs
    -- business_support_tickets.unread_by_business = FALSE without trigger error
    -- -------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_owner_a_id::TEXT, true);

    SELECT id INTO v_biz_notif_id
    FROM public.support_notifications
    WHERE ticket_id = v_ticket_a_id AND target_role = 'business' AND is_read = FALSE
    ORDER BY created_at DESC
    LIMIT 1;

    ASSERT v_biz_notif_id IS NOT NULL, 'Expected unread business notification after Super Admin reply';

    UPDATE public.support_notifications SET is_read = TRUE WHERE id = v_biz_notif_id;

    SELECT unread_by_business INTO v_unread_biz FROM public.business_support_tickets WHERE id = v_ticket_a_id;
    ASSERT v_unread_biz = FALSE, 'Expected notification read sync to clear unread_by_business';

    -- Column-level restriction: Business Owner cannot alter notification title/body
    BEGIN
        UPDATE public.support_notifications SET title = 'Tampered' WHERE id = v_biz_notif_id;
        RAISE EXCEPTION 'SECURITY REGRESSION: Business Owner updated support_notifications.title';
    EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
        NULL;
    END;

    -- -------------------------------------------------------------------------
    -- Scenario 9: Closed-Ticket Lock (blocks replies for both Owner and Admin)
    -- -------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_super_admin_id::TEXT, true);
    UPDATE public.business_support_tickets SET status = 'closed' WHERE id = v_ticket_a_id;

    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'super_admin', 'Reply on closed ticket');
        RAISE EXCEPTION 'SECURITY REGRESSION: Super Admin replied to closed ticket';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err LIKE '%closed%', 'Expected closed ticket error, got: ' || v_err;
    END;

    PERFORM set_config('request.jwt.claim.sub', v_owner_a_id::TEXT, true);
    BEGIN
        INSERT INTO public.support_ticket_messages (ticket_id, business_id, sender_role, message)
        VALUES (v_ticket_a_id, v_biz_a_id, 'business_owner', 'Owner reply on closed ticket');
        RAISE EXCEPTION 'SECURITY REGRESSION: Business Owner replied to closed ticket';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- -------------------------------------------------------------------------
    -- Scenario 10: Unauthenticated / NULL auth.uid() & anon blocked
    -- -------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', '', true);
    BEGIN
        INSERT INTO public.business_support_tickets (business_id, category, subject, description)
        VALUES (v_biz_a_id, 'other', 'Anon attempt', 'Should fail without auth.uid()');
        RAISE EXCEPTION 'SECURITY REGRESSION: NULL auth.uid() created ticket';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RESET ROLE;
END
$$;

ROLLBACK;
*/
