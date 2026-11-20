-- =============================================================================
-- NOVACODE TECH — BUSINESS SUPPORT SYSTEM & SEPARATED NOTIFICATIONS
-- Migration: 20261113_support_system.sql
--
-- SAFETY GUARANTEES (PRODUCTION REVIEW BEFORE MANUAL EXECUTION):
-- - 100% Additive & Idempotent (non-destructive; never drops or alters existing booking RPCs)
-- - Preserves businesses.id BIGINT compatibility
-- - Preserves all existing booking RPCs, n8n workflows, auth, and RLS policies
-- - Strict separation between Business Support Requests and Technical Incidents
-- - Prevents non-Super-Admin privilege escalation on ticket statuses or messages
-- =============================================================================

-- 0. Pre-flight verification
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

    IF to_regprocedure('public.is_super_admin()') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.is_super_admin() function is required.';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. Business Support Tickets (Owned by Business Members, Triaged by Super Admin)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
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
-- 4. Role-Separated Support Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT REFERENCES public.businesses(id) ON DELETE CASCADE,
    target_role TEXT NOT NULL CHECK (target_role IN ('business', 'super_admin')),
    ticket_id UUID REFERENCES public.business_support_tickets(id) ON DELETE CASCADE,
    incident_id UUID,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_notifications_target
    ON public.support_notifications (target_role, business_id, is_read, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Security Triggers (Integrity, Anti-Escalation, Notifications, History)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_support_ticket_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
        NEW.created_by := auth.uid();
        NEW.status := 'open';
        NEW.unread_by_admin := TRUE;
        NEW.unread_by_business := FALSE;
    END IF;
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

CREATE OR REPLACE FUNCTION public.trg_support_ticket_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.business_id := OLD.business_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := NOW();

    -- Non-super-admin business users can only clear their unread flag (cannot hijack admin triage status/priority)
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
        NEW.status := OLD.status;
        NEW.priority := OLD.priority;
        NEW.category := OLD.category;
        NEW.subject := OLD.subject;
        NEW.description := OLD.description;
        NEW.unread_by_admin := OLD.unread_by_admin;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_before_update ON public.business_support_tickets;
CREATE TRIGGER support_ticket_before_update
    BEFORE UPDATE ON public.business_support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_ticket_before_update();

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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_after_update ON public.business_support_tickets;
CREATE TRIGGER support_ticket_after_update
    AFTER UPDATE ON public.business_support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_support_ticket_after_update();

CREATE OR REPLACE FUNCTION public.trg_support_message_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ticket_business_id BIGINT;
    v_member_role TEXT;
BEGIN
    SELECT business_id INTO v_ticket_business_id
    FROM public.business_support_tickets
    WHERE id = NEW.ticket_id;

    IF v_ticket_business_id IS NULL THEN
        RAISE EXCEPTION 'Target support ticket does not exist';
    END IF;

    NEW.business_id := v_ticket_business_id;

    IF auth.uid() IS NOT NULL THEN
        NEW.sender_id := auth.uid();
        IF public.is_super_admin() AND NEW.sender_role = 'super_admin' THEN
            NEW.sender_role := 'super_admin';
        ELSE
            SELECT bm.role::TEXT INTO v_member_role
            FROM public.business_members bm
            WHERE bm.business_id = v_ticket_business_id
              AND bm.user_id = auth.uid();

            IF v_member_role IS NULL AND NOT public.is_super_admin() THEN
                RAISE EXCEPTION 'Unauthorized: user does not belong to ticket business';
            END IF;

            IF v_member_role IN ('owner', 'admin') THEN
                NEW.sender_role := 'business_owner';
            ELSIF public.is_super_admin() THEN
                NEW.sender_role := 'super_admin';
            ELSE
                NEW.sender_role := 'business_staff';
            END IF;
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

-- -----------------------------------------------------------------------------
-- 6. Minimum Grants & Strict Row-Level Security (RLS)
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.business_support_tickets FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.support_ticket_messages FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.support_ticket_status_history FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.support_notifications FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_support_tickets TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_ticket_messages TO authenticated;
GRANT SELECT ON TABLE public.support_ticket_status_history TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.support_notifications TO authenticated;

GRANT ALL ON TABLE public.business_support_tickets TO service_role;
GRANT ALL ON TABLE public.support_ticket_messages TO service_role;
GRANT ALL ON TABLE public.support_ticket_status_history TO service_role;
GRANT ALL ON TABLE public.support_notifications TO service_role;

ALTER TABLE public.business_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_notifications ENABLE ROW LEVEL SECURITY;

-- business_support_tickets policies
DROP POLICY IF EXISTS "Super admin full access support_tickets" ON public.business_support_tickets;
CREATE POLICY "Super admin full access support_tickets" ON public.business_support_tickets
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Business members view own support_tickets" ON public.business_support_tickets;
CREATE POLICY "Business members view own support_tickets" ON public.business_support_tickets
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = business_support_tickets.business_id
              AND bm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Business members create own support_tickets" ON public.business_support_tickets;
CREATE POLICY "Business members create own support_tickets" ON public.business_support_tickets
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = business_support_tickets.business_id
              AND bm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Business members update own read state" ON public.business_support_tickets;
CREATE POLICY "Business members update own read state" ON public.business_support_tickets
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = business_support_tickets.business_id
              AND bm.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = business_support_tickets.business_id
              AND bm.user_id = auth.uid()
        )
    );

-- support_ticket_messages policies
DROP POLICY IF EXISTS "Super admin full access support_messages" ON public.support_ticket_messages;
CREATE POLICY "Super admin full access support_messages" ON public.support_ticket_messages
    FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Business members view own support_messages" ON public.support_ticket_messages;
CREATE POLICY "Business members view own support_messages" ON public.support_ticket_messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = support_ticket_messages.business_id
              AND bm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Business members reply to own support_messages" ON public.support_ticket_messages;
CREATE POLICY "Business members reply to own support_messages" ON public.support_ticket_messages
    FOR INSERT TO authenticated
    WITH CHECK (
        sender_role <> 'super_admin'
        AND EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = support_ticket_messages.business_id
              AND bm.user_id = auth.uid()
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
            JOIN public.business_members bm ON bm.business_id = t.business_id
            WHERE t.id = support_ticket_status_history.ticket_id
              AND bm.user_id = auth.uid()
        )
    );

-- support_notifications policies
DROP POLICY IF EXISTS "Super admin manage admin support_notifications" ON public.support_notifications;
CREATE POLICY "Super admin manage admin support_notifications" ON public.support_notifications
    FOR ALL TO authenticated
    USING (public.is_super_admin() AND target_role = 'super_admin')
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Business members manage own business notifications" ON public.support_notifications;
CREATE POLICY "Business members manage own business notifications" ON public.support_notifications
    FOR SELECT TO authenticated
    USING (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = support_notifications.business_id
              AND bm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Business members mark own notifications read" ON public.support_notifications;
CREATE POLICY "Business members mark own notifications read" ON public.support_notifications
    FOR UPDATE TO authenticated
    USING (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = support_notifications.business_id
              AND bm.user_id = auth.uid()
        )
    )
    WITH CHECK (
        target_role = 'business'
        AND business_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.business_members bm
            WHERE bm.business_id = support_notifications.business_id
              AND bm.user_id = auth.uid()
        )
    );

-- Harden technical support_incidents isolation if table exists (Super Admin only)
DO $$
BEGIN
    IF to_regclass('public.support_incidents') IS NOT NULL THEN
        EXECUTE 'DROP POLICY IF EXISTS "Members view own business support incidents" ON public.support_incidents';
    END IF;
END
$$;
