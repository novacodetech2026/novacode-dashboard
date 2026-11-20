-- =============================================================================
-- NOVACODE TECH — BUSINESS OWNER INVITATION & ONBOARDING MIGRATION (FINAL)
-- Compatible with BIGINT businesses.id / business_members.business_id.
-- Preserves all existing booking, availability, cancellation, n8n, business data,
-- and existing RLS policies without dropping existing policies or records.
-- Review carefully before executing in Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Pre-Flight Production Compatibility Checks (Non-Destructive)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_biz_id_type TEXT;
    v_bm_biz_id_type TEXT;
    v_bm_user_id_type TEXT;
    v_bm_role_type TEXT;
    v_bm_missing_defaults TEXT;
    v_audit_biz_id_type TEXT;
    v_audit_entity_id_type TEXT;
    v_audit_has_user_id BOOLEAN;
    v_audit_has_action BOOLEAN;
    v_audit_has_entity_type BOOLEAN;
    v_audit_has_metadata BOOLEAN;
BEGIN
    IF to_regclass('public.businesses') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.businesses table does not exist.';
    END IF;

    IF to_regclass('public.business_members') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.business_members table does not exist.';
    END IF;

    IF to_regprocedure('public.is_super_admin()') IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.is_super_admin() function does not exist.';
    END IF;

    SELECT data_type INTO v_biz_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'id';

    IF v_biz_id_type IS DISTINCT FROM 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.businesses.id is %, expected bigint.', COALESCE(v_biz_id_type, 'missing');
    END IF;

    SELECT data_type INTO v_bm_biz_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'business_id';

    IF v_bm_biz_id_type IS DISTINCT FROM 'bigint' THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.business_members.business_id is %, expected bigint.', COALESCE(v_bm_biz_id_type, 'missing');
    END IF;

    SELECT data_type INTO v_bm_user_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'user_id';

    IF v_bm_user_id_type IS DISTINCT FROM 'uuid' THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.business_members.user_id is %, expected uuid.', COALESCE(v_bm_user_id_type, 'missing');
    END IF;

    SELECT data_type INTO v_bm_role_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'role';

    IF v_bm_role_type IS NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.business_members.role column is missing.';
    END IF;

    SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
    INTO v_bm_missing_defaults
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_members'
      AND is_nullable = 'NO'
      AND column_default IS NULL
      AND COALESCE(is_identity, 'NO') = 'NO'
      AND COALESCE(is_generated, 'NEVER') = 'NEVER'
      AND column_name NOT IN ('business_id', 'user_id', 'role');

    IF v_bm_missing_defaults IS NOT NULL THEN
        RAISE EXCEPTION 'Pre-flight check failed: public.business_members has required NOT NULL column(s) without defaults: %.', v_bm_missing_defaults;
    END IF;

    -- Verify required Supabase roles exist
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION 'Pre-flight check failed: authenticated role does not exist.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'Pre-flight check failed: service_role does not exist.';
    END IF;

    -- Verify service_role has required read/write access on pre-existing referenced tables (read-only check)
    IF NOT has_table_privilege('service_role', 'public.businesses', 'SELECT') THEN
        RAISE EXCEPTION 'Pre-flight check failed: service_role lacks SELECT privilege on public.businesses.';
    END IF;

    IF NOT (
        has_table_privilege('service_role', 'public.business_members', 'SELECT')
        AND has_table_privilege('service_role', 'public.business_members', 'INSERT')
        AND has_table_privilege('service_role', 'public.business_members', 'UPDATE')
    ) THEN
        RAISE EXCEPTION 'Pre-flight check failed: service_role lacks SELECT/INSERT/UPDATE privilege on public.business_members.';
    END IF;

    -- Verify compatibility with existing public.audit_logs table (non-fatal diagnostic)
    IF to_regclass('public.audit_logs') IS NULL THEN
        RAISE NOTICE 'audit_logs check: public.audit_logs does not exist; invitation audit logging will be skipped.';
    ELSE
        SELECT data_type INTO v_audit_biz_id_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'business_id';

        SELECT data_type INTO v_audit_entity_id_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_id';

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'user_id'
        ) INTO v_audit_has_user_id;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'action'
        ) INTO v_audit_has_action;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_type'
        ) INTO v_audit_has_entity_type;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'metadata'
        ) INTO v_audit_has_metadata;

        IF v_audit_biz_id_type IS DISTINCT FROM 'bigint'
           OR NOT v_audit_has_user_id
           OR NOT v_audit_has_action
           OR NOT v_audit_has_entity_type THEN
            RAISE NOTICE 'audit_logs compatibility notice: schema differs from expected (business_id=%, user_id=%, action=%, entity_type=%, entity_id=%, metadata=%). Audit inserts will adapt or safely skip.',
                COALESCE(v_audit_biz_id_type, 'missing'),
                v_audit_has_user_id,
                v_audit_has_action,
                v_audit_has_entity_type,
                COALESCE(v_audit_entity_id_type, 'missing'),
                v_audit_has_metadata;
        ELSE
            RAISE NOTICE 'audit_logs compatibility verified: business_id=bigint, entity_id=%, metadata=%.',
                COALESCE(v_audit_entity_id_type, 'missing'),
                v_audit_has_metadata;
        END IF;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. Duplicate Membership Check & Safe Unique Index on business_members
--    Checks for duplicates BEFORE creating the index; NEVER deletes records.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_unique_idx BOOLEAN := FALSE;
    v_duplicate_pairs INTEGER := 0;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_index ix
        JOIN pg_class tbl ON tbl.oid = ix.indrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname = 'public'
          AND tbl.relname = 'business_members'
          AND ix.indisunique = TRUE
          AND ix.indpred IS NULL
          AND ix.indnkeyatts = 2
          AND (
              SELECT array_agg(att.attname::TEXT ORDER BY att.attname::TEXT)
              FROM unnest(ix.indkey[0:ix.indnkeyatts - 1]) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
          ) = ARRAY['business_id', 'user_id']
    ) INTO v_has_unique_idx;

    IF NOT v_has_unique_idx THEN
        SELECT COUNT(*) INTO v_duplicate_pairs
        FROM (
            SELECT business_id, user_id
            FROM public.business_members
            GROUP BY business_id, user_id
            HAVING COUNT(*) > 1
        ) dupes;

        IF v_duplicate_pairs > 0 THEN
            RAISE EXCEPTION 'Migration aborted safely: found % duplicate (business_id, user_id) group(s) in public.business_members. No records were deleted. Inspect duplicates with: SELECT business_id, user_id, COUNT(*) FROM public.business_members GROUP BY business_id, user_id HAVING COUNT(*) > 1;',
                v_duplicate_pairs;
        END IF;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_business_members_unique_biz_user
            ON public.business_members (business_id, user_id);
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Create Business Invitations Tracking Table (BIGINT business_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    email TEXT NOT NULL CHECK (LENGTH(TRIM(email)) > 3),
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'manager', 'staff')),
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked', 'failed')),
    invitation_token UUID NOT NULL DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    last_sent_at TIMESTAMPTZ,
    resend_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate active pending invitations for the same (business_id, LOWER(email))
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_invitations_unique_pending
    ON public.business_invitations (business_id, LOWER(email))
    WHERE status = 'pending';

-- Enforce global uniqueness on invitation_token (check existing rows safely first)
DO $$
DECLARE
    v_has_unique_token_idx BOOLEAN := FALSE;
    v_duplicate_tokens INTEGER := 0;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_index ix
        JOIN pg_class tbl ON tbl.oid = ix.indrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname = 'public'
          AND tbl.relname = 'business_invitations'
          AND ix.indisunique = TRUE
          AND ix.indpred IS NULL
          AND ix.indnkeyatts = 1
          AND (
              SELECT array_agg(att.attname::TEXT)
              FROM unnest(ix.indkey[0:ix.indnkeyatts - 1]) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
          ) = ARRAY['invitation_token']
    ) INTO v_has_unique_token_idx;

    IF NOT v_has_unique_token_idx THEN
        SELECT COUNT(*) INTO v_duplicate_tokens
        FROM (
            SELECT invitation_token
            FROM public.business_invitations
            GROUP BY invitation_token
            HAVING COUNT(*) > 1
        ) dupes;

        IF v_duplicate_tokens > 0 THEN
            RAISE EXCEPTION 'Migration aborted safely: found % duplicate invitation_token value(s) in public.business_invitations. No records were deleted.',
                v_duplicate_tokens;
        END IF;

        DROP INDEX IF EXISTS public.idx_business_invitations_token;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_business_invitations_unique_token
            ON public.business_invitations (invitation_token);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_business_invitations_email_status
    ON public.business_invitations (LOWER(email), status);

-- -----------------------------------------------------------------------------
-- 3. Minimum Table Permissions & Row Level Security for business_invitations
--    - authenticated: SELECT only (strictly row-scoped via RLS; no direct writes)
--    - service_role: SELECT, INSERT, UPDATE only (for Edge Function; no DELETE)
--    - anon / PUBLIC: revoked completely
--    - Existing RLS policies on all other tables remain untouched
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.business_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.business_invitations FROM anon;
REVOKE ALL ON TABLE public.business_invitations FROM authenticated;
REVOKE ALL ON TABLE public.business_invitations FROM service_role;

GRANT SELECT ON TABLE public.business_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_invitations TO service_role;

ALTER TABLE public.business_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin full access business_invitations" ON public.business_invitations;
DROP POLICY IF EXISTS "Super admin read business_invitations" ON public.business_invitations;
CREATE POLICY "Super admin read business_invitations" ON public.business_invitations
    FOR SELECT
    TO authenticated
    USING (public.is_super_admin());

DROP POLICY IF EXISTS "Invited user read own invitation" ON public.business_invitations;
CREATE POLICY "Invited user read own invitation" ON public.business_invitations
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) = FALSE
        AND NULLIF(TRIM(COALESCE(auth.jwt()->>'email', '')), '') IS NOT NULL
        AND LOWER(TRIM(email)) = LOWER(TRIM(auth.jwt()->>'email'))
    );

-- -----------------------------------------------------------------------------
-- 4. Super Admin RPC: List Invitations (Auto-expiring overdue pending records)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_business_invitations(
    target_business_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    business_id BIGINT,
    business_name TEXT,
    email TEXT,
    role TEXT,
    status TEXT,
    expires_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    last_sent_at TIMESTAMPTZ,
    resend_count INTEGER,
    last_error TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Super Admin access required';
    END IF;

    -- Auto-mark overdue pending invitations as expired
    UPDATE public.business_invitations bi
    SET status = 'expired',
        updated_at = NOW()
    WHERE bi.status = 'pending'
      AND bi.expires_at <= NOW()
      AND (target_business_id IS NULL OR bi.business_id = target_business_id);

    RETURN QUERY
    SELECT
        bi.id,
        bi.business_id,
        b.name::TEXT AS business_name,
        bi.email,
        bi.role,
        bi.status,
        bi.expires_at,
        bi.accepted_at,
        bi.last_sent_at,
        bi.resend_count,
        bi.last_error,
        bi.created_at
    FROM public.business_invitations bi
    JOIN public.businesses b ON b.id = bi.business_id
    WHERE (target_business_id IS NULL OR bi.business_id = target_business_id)
    ORDER BY bi.created_at DESC
    LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_business_invitations(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_business_invitations(BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_business_invitations(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_business_invitations(BIGINT) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Invited User Onboarding RPC: Accept Invitation & Bind Membership Safely
--    - Strictly requires a valid non-null p_invitation_token (no auto-accept)
--    - Requires verified email ownership (auth.users.email_confirmed_at IS NOT NULL)
--    - Verifies target business exists and is active before creating membership
--    - Consumes pending invitation token atomically; tokens can NEVER be reused
--    - Never overwrites, escalates, or modifies existing business_members roles
--    - Isolates audit logging so audit failures never abort the invitation flow
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_business_invitation(
    p_business_id BIGINT DEFAULT NULL,
    p_invitation_token UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    caller_uid UUID := auth.uid();
    caller_email TEXT;
    caller_email_confirmed_at TIMESTAMPTZ;
    inv RECORD;
    v_biz_json JSONB;
    v_biz_status TEXT;
    v_consumed_rows INTEGER := 0;
    v_existing_role TEXT;
    v_membership_created BOOLEAN := FALSE;
    v_effective_role TEXT;
    v_bm_role_data_type TEXT;
    v_bm_role_udt_schema TEXT;
    v_bm_role_udt_name TEXT;
    v_audit_biz_type TEXT;
    v_audit_entity_type TEXT;
    v_audit_has_user_id BOOLEAN := FALSE;
    v_audit_has_action BOOLEAN := FALSE;
    v_audit_has_entity_type BOOLEAN := FALSE;
    v_audit_has_metadata BOOLEAN := FALSE;
BEGIN
    IF caller_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to accept a business invitation';
    END IF;

    IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
        RAISE EXCEPTION 'Anonymous sessions cannot accept business invitations';
    END IF;

    IF p_invitation_token IS NULL THEN
        RAISE EXCEPTION 'A valid invitation token is required to accept a business invitation';
    END IF;

    SELECT u.email, u.email_confirmed_at
    INTO caller_email, caller_email_confirmed_at
    FROM auth.users u
    WHERE u.id = caller_uid;

    IF caller_email IS NULL OR TRIM(caller_email) = '' THEN
        RAISE EXCEPTION 'Authenticated account does not have an email address';
    END IF;

    IF caller_email_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Verified email ownership is required before accepting a business invitation';
    END IF;

    -- Lock and load the invitation strictly by token
    SELECT * INTO inv
    FROM public.business_invitations
    WHERE invitation_token = p_invitation_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation token is invalid or does not exist';
    END IF;

    IF p_business_id IS NOT NULL AND inv.business_id <> p_business_id THEN
        RAISE EXCEPTION 'Security check failed: Invitation token does not match the target business';
    END IF;

    IF LOWER(TRIM(inv.email)) <> LOWER(TRIM(caller_email)) THEN
        RAISE EXCEPTION 'Security check failed: This invitation was issued for a different email address';
    END IF;

    IF inv.target_user_id IS NOT NULL AND inv.target_user_id <> caller_uid THEN
        RAISE EXCEPTION 'Security check failed: This invitation is bound to a different user account';
    END IF;

    IF inv.role NOT IN ('owner', 'admin', 'manager', 'staff') THEN
        RAISE EXCEPTION 'Security check failed: Invitation contains an unsupported role';
    END IF;

    IF inv.status = 'accepted' THEN
        RAISE EXCEPTION 'This invitation token has already been used and cannot be reused';
    END IF;

    IF inv.status = 'revoked' THEN
        RAISE EXCEPTION 'This invitation has been revoked by a platform administrator';
    END IF;

    IF inv.status = 'failed' THEN
        RAISE EXCEPTION 'This invitation failed to send. Ask your platform administrator to resend it.';
    END IF;

    IF inv.status = 'expired' OR inv.expires_at <= NOW() THEN
        UPDATE public.business_invitations
        SET status = 'expired',
            updated_at = NOW()
        WHERE id = inv.id
          AND status = 'pending';
        RAISE EXCEPTION 'This invitation link has expired. Ask your platform administrator to resend the invitation.';
    END IF;

    IF inv.status <> 'pending' THEN
        RAISE EXCEPTION 'Invitation is not in a pending state';
    END IF;

    -- Verify target business exists and is active (schema-adaptive across is_active/active/status/deleted_at)
    SELECT to_jsonb(b) INTO v_biz_json
    FROM public.businesses b
    WHERE b.id = inv.business_id;

    IF v_biz_json IS NULL THEN
        RAISE EXCEPTION 'Target business does not exist';
    END IF;

    IF (v_biz_json ? 'deleted_at') AND NULLIF(TRIM(COALESCE(v_biz_json->>'deleted_at', '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'Target business is no longer active';
    END IF;

    IF (v_biz_json ? 'is_active') AND COALESCE((v_biz_json->>'is_active')::boolean, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Target business is currently inactive';
    END IF;

    IF (v_biz_json ? 'active') AND COALESCE((v_biz_json->>'active')::boolean, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Target business is currently inactive';
    END IF;

    IF (v_biz_json ? 'status') THEN
        v_biz_status := LOWER(TRIM(COALESCE(v_biz_json->>'status', '')));
        IF v_biz_status <> '' AND v_biz_status NOT IN ('active', 'enabled', 'live') THEN
            RAISE EXCEPTION 'Target business is not active (status: %)', v_biz_status;
        END IF;
    END IF;

    -- Atomically consume the invitation token before creating membership (single-use guarantee)
    UPDATE public.business_invitations
    SET status = 'accepted',
        accepted_at = NOW(),
        target_user_id = caller_uid,
        updated_at = NOW()
    WHERE id = inv.id
      AND status = 'pending'
      AND invitation_token = p_invitation_token
      AND expires_at > NOW();

    GET DIAGNOSTICS v_consumed_rows = ROW_COUNT;
    IF v_consumed_rows <> 1 THEN
        RAISE EXCEPTION 'This invitation token has already been used or expired';
    END IF;

    -- Check existing membership first; NEVER overwrite, escalate, or modify an existing membership role
    SELECT bm.role::TEXT INTO v_existing_role
    FROM public.business_members bm
    WHERE bm.business_id = inv.business_id
      AND bm.user_id = caller_uid
    FOR UPDATE;

    IF v_existing_role IS NULL THEN
        SELECT data_type, udt_schema, udt_name
        INTO v_bm_role_data_type, v_bm_role_udt_schema, v_bm_role_udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'business_members'
          AND column_name = 'role';

        IF v_bm_role_data_type = 'USER-DEFINED' AND v_bm_role_udt_name IS NOT NULL THEN
            EXECUTE format(
                'INSERT INTO public.business_members (business_id, user_id, role) VALUES ($1, $2, $3::%I.%I) ON CONFLICT (business_id, user_id) DO NOTHING',
                COALESCE(v_bm_role_udt_schema, 'public'),
                v_bm_role_udt_name
            )
            USING inv.business_id, caller_uid, inv.role;
        ELSE
            INSERT INTO public.business_members (business_id, user_id, role)
            VALUES (inv.business_id, caller_uid, inv.role)
            ON CONFLICT (business_id, user_id) DO NOTHING;
        END IF;

        v_membership_created := TRUE;
        v_effective_role := inv.role;
    ELSE
        v_membership_created := FALSE;
        v_effective_role := v_existing_role;
    END IF;

    -- Isolated non-blocking audit log subtransaction: failures here NEVER compromise invitation acceptance
    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        BEGIN
            SELECT data_type INTO v_audit_biz_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'business_id';

            SELECT data_type INTO v_audit_entity_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_id';

            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'user_id'
            ) INTO v_audit_has_user_id;

            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'action'
            ) INTO v_audit_has_action;

            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_type'
            ) INTO v_audit_has_entity_type;

            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'metadata'
            ) INTO v_audit_has_metadata;

            IF v_audit_biz_type = 'bigint' AND v_audit_has_user_id AND v_audit_has_action AND v_audit_has_entity_type THEN
                IF v_audit_has_metadata AND v_audit_entity_type = 'uuid' THEN
                    EXECUTE 'INSERT INTO public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)'
                    USING inv.business_id, caller_uid, 'accept_business_invitation', 'business_invitations', inv.id,
                          jsonb_build_object(
                              'email', caller_email,
                              'invited_role', inv.role,
                              'effective_role', v_effective_role,
                              'membership_created', v_membership_created
                          );
                ELSIF v_audit_has_metadata THEN
                    EXECUTE 'INSERT INTO public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)'
                    USING inv.business_id, caller_uid, 'accept_business_invitation', 'business_invitations', inv.id::TEXT,
                          jsonb_build_object(
                              'email', caller_email,
                              'invited_role', inv.role,
                              'effective_role', v_effective_role,
                              'membership_created', v_membership_created
                          );
                ELSIF v_audit_entity_type = 'uuid' THEN
                    EXECUTE 'INSERT INTO public.audit_logs (business_id, user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)'
                    USING inv.business_id, caller_uid, 'accept_business_invitation', 'business_invitations', inv.id;
                ELSE
                    EXECUTE 'INSERT INTO public.audit_logs (business_id, user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)'
                    USING inv.business_id, caller_uid, 'accept_business_invitation', 'business_invitations', inv.id::TEXT;
                END IF;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Invitation audit log skipped due to non-fatal error: %', SQLERRM;
        END;
    END IF;

    RETURN jsonb_build_object(
        'accepted_count', 1,
        'business_ids', jsonb_build_array(inv.business_id),
        'primary_business_id', inv.business_id,
        'membership_created', v_membership_created,
        'role', v_effective_role
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_business_invitation(BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_business_invitation(BIGINT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.accept_business_invitation(BIGINT, UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.accept_business_invitation(BIGINT, UUID) TO authenticated;
