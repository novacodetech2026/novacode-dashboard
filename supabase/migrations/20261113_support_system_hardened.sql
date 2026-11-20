-- =============================================================================
-- NOVACODE TECH — HARDENED BUSINESS SUPPORT & TECHNICAL INCIDENTS SYSTEM
-- Migration: 20261113_support_system_hardened.sql
--
-- REVIEW ONLY — DO NOT AUTO-EXECUTE. Inspect in Supabase SQL Editor first.
--
-- EXPLICIT SCHEMA, FUNCTION & ROLE ASSUMPTIONS:
-- 1. public.businesses(id) exists and its column type is BIGINT.
-- 2. public.business_members(business_id BIGINT, user_id UUID, role ...) exists.
-- 3. public.platform_admins exists and backs public.is_super_admin().
-- 4. public.is_super_admin() SECURITY DEFINER already exists and returns BOOLEAN.
-- 5. public.is_business_member(BIGINT) SECURITY DEFINER already exists and
--    returns BOOLEAN (TRUE only when auth.uid() is an active member of the
--    given business_id).
-- 6. Supabase auth.users(id, email, raw_user_meta_data) and Postgres roles
--    `authenticated`, `anon`, `service_role` exist.
-- 7. Supabase Realtime publication `supabase_realtime` exists in managed
--    Supabase projects (handled idempotently if absent).
--
-- SAFETY GUARANTEES:
-- - 100% Additive & Idempotent (safe whether 20261113_support_system.sql was
--   previously applied or not).
-- - Zero modifications to existing booking RPCs (book_appointment,
--   check_availability, cancel_appointment, etc.), n8n workflows, onboarding/
--   invitation tables, or existing business/appointment RLS policies.
-- - Enforces active membership via public.is_business_member(bigint).
-- - Blocks replies to 'closed' tickets at both RLS and trigger levels.
-- - Resolves sender_id, sender_role, and human-readable names server-side.
-- - Restricts support_notifications updates strictly to `is_read` changes.
-- - Isolates public.support_incidents strictly to verified Super Admins.
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

-- Additive upgrade if table existed from earlier draft without created_by_name
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

-- Ensure FK exists on incident_id if support_notifications pre-existed without it
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
-- 6. Hardened Security Triggers (Integrity, Auth Identity, Sync, Audit)
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

REVOKE ALL ON FUNCTION public.resolve_support_actor_label(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_support_actor_label(UUID) TO service_role;

-- Ticket BEFORE INSERT: bind author from auth.uid(), verify active membership, lock initial state
CREATE OR REPLACE FUNCTION public.trg_support_ticket_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_label TEXT;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        v_actor_label := public.resolve_support_actor_label(auth.uid());
        NEW.created_by_name := COALESCE(v_actor_label, 'Workspace Member');

        IF NOT public.is_super_admin() THEN
            IF NOT public.is_business_member(NEW.business_id) THEN
                RAISE EXCEPTION 'Unauthorized: active business membership required to create support tickets';
            END IF;
            NEW.status := 'open';
            NEW.unread_by_admin := TRUE;
            NEW.unread_by_business := FALSE;
        END IF;
    ELSE
        IF NEW.created_by IS NOT NULL AND NULLIF(TRIM(COALESCE(NEW.created_by_name, '')), '') IS NULL THEN
            NEW.created_by_name := public.resolve_support_actor_label(NEW.created_by);
        END IF;
    END IF;

    NEW.subject := TRIM(NEW.subject);
    NEW.description := TRIM(NEW.description);
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

-- Ticket BEFORE UPDATE: protect immutable columns & reject non-admin edits to protected fields
CREATE OR REPLACE FUNCTION public.trg_support_ticket_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.id := OLD.id;
    NEW.business_id := OLD.business_id;
    NEW.created_by := OLD.created_by;
    NEW.created_by_name := OLD.created_by_name;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := NOW();

    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
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
SET search_path = public, pg_temp
AS $$
BEGIN
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

    IF pg_trigger_depth() < 2 THEN
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
BEGIN
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

    NEW.business_id := v_ticket_business_id;
    NEW.message := TRIM(NEW.message);

    IF auth.uid() IS NOT NULL THEN
        NEW.sender_id := auth.uid();
        v_actor_label := public.resolve_support_actor_label(auth.uid());

        IF public.is_super_admin() THEN
            NEW.sender_role := 'super_admin';
            NEW.sender_name := 'Novacode Tech Support';
        ELSE
            IF NOT public.is_business_member(v_ticket_business_id) THEN
                RAISE EXCEPTION 'Unauthorized: active business membership required to reply';
            END IF;

            SELECT bm.role::TEXT INTO v_member_role
            FROM public.business_members bm
            WHERE bm.business_id = v_ticket_business_id
              AND bm.user_id = auth.uid()
            LIMIT 1;

            IF v_member_role IN ('owner', 'admin') THEN
                NEW.sender_role := 'business_owner';
            ELSE
                NEW.sender_role := 'business_staff';
            END IF;

            NEW.sender_name := COALESCE(v_actor_label, 'Business Member');
        END IF;
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
BEGIN
    SELECT t.subject, b.name
    INTO v_subject, v_biz_name
    FROM public.business_support_tickets t
    JOIN public.businesses b ON b.id = t.business_id
    WHERE t.id = NEW.ticket_id;

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

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_message_after_insert ON public.support_ticket_messages;
CREATE TRIGGER support_message_after_insert
    AFTER INSERT ON public.support_ticket_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_message_after_insert();

-- Notification BEFORE UPDATE: restrict updates strictly to `is_read`
CREATE OR REPLACE FUNCTION public.trg_support_notification_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
    IF pg_trigger_depth() < 2
       AND OLD.is_read = FALSE
       AND NEW.is_read = TRUE
       AND NEW.ticket_id IS NOT NULL THEN
        IF NEW.target_role = 'super_admin' THEN
            UPDATE public.business_support_tickets
            SET unread_by_admin = FALSE
            WHERE id = NEW.ticket_id
              AND unread_by_admin = TRUE;
        ELSIF NEW.target_role = 'business' THEN
            UPDATE public.business_support_tickets
            SET unread_by_business = FALSE
            WHERE id = NEW.ticket_id
              AND business_id = NEW.business_id
              AND unread_by_business = TRUE;
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
SET search_path = public, pg_temp
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

    NEW.title := TRIM(NEW.title);
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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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
-- 7. Minimum Privileges & Column-Level Grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.business_support_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_ticket_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_ticket_status_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_incidents FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_support_tickets TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_ticket_messages TO authenticated;
GRANT SELECT ON TABLE public.support_ticket_status_history TO authenticated;
-- Restrict notification updates strictly to read-state column
GRANT SELECT, UPDATE (is_read) ON TABLE public.support_notifications TO authenticated;
-- Technical incidents: Super Admin can only SELECT and triage status/resolved_at; writes occur via trusted Edge Function / service_role
GRANT SELECT, UPDATE (status, resolved_at) ON TABLE public.support_incidents TO authenticated;

GRANT ALL ON TABLE public.business_support_tickets TO service_role;
GRANT ALL ON TABLE public.support_ticket_messages TO service_role;
GRANT ALL ON TABLE public.support_ticket_status_history TO service_role;
GRANT ALL ON TABLE public.support_notifications TO service_role;
GRANT ALL ON TABLE public.support_incidents TO service_role;

-- -----------------------------------------------------------------------------
-- 8. Strict Row-Level Security (RLS) Policies
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
-- 9. Supabase Realtime Publication Configuration (For Manual Review)
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
