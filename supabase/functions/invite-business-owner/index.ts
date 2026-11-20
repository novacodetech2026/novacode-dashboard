// Supabase Edge Function: invite-business-owner
// Deploy with: supabase functions deploy invite-business-owner
// Required secrets (server-side ONLY, never in frontend):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   APP_URL (optional, defaults to https://novacode-tech.ai.studio)

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_ROLES = new Set(['owner', 'admin', 'manager', 'staff']);
const INVITE_TTL_DAYS = 7;

type ActionType =
  | 'invite_owner'
  | 'assign_existing_user'
  | 'resend_invitation'
  | 'revoke_invitation';

interface RequestPayload {
  action?: ActionType;
  businessId?: number | string;
  email?: string;
  role?: 'owner' | 'admin' | 'manager' | 'staff';
  invitationId?: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeEmail(raw?: string): string {
  return (raw || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parsePositiveBigInt(val?: number | string): number | null {
  if (typeof val === 'number') {
    return Number.isSafeInteger(val) && val > 0 ? val : null;
  }
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    const parsed = Number(val.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

async function findAuthUserByEmail(supabaseAdmin: SupabaseClient, targetEmail: string) {
  let page = 1;
  const perPage = 200;

  while (page <= 25) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to query auth users: ${error.message}`);
    }
    const users = data?.users || [];
    const matched = users.find((u) => normalizeEmail(u.email) === targetEmail);
    if (matched) return matched;
    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

function isBusinessActive(biz: Record<string, unknown> | null | undefined): { active: boolean; reason?: string } {
  if (!biz) {
    return { active: false, reason: 'Target business does not exist.' };
  }
  if (typeof biz.deleted_at === 'string' && biz.deleted_at.trim() !== '') {
    return { active: false, reason: 'Target business is no longer active.' };
  }
  if (biz.is_active === false || biz.active === false) {
    return { active: false, reason: 'Target business is currently inactive.' };
  }
  if (typeof biz.status === 'string' && biz.status.trim() !== '') {
    const normalizedStatus = biz.status.trim().toLowerCase();
    if (!['active', 'enabled', 'live'].includes(normalizedStatus)) {
      return { active: false, reason: `Target business is not active (status: ${normalizedStatus}).` };
    }
  }
  return { active: true };
}

async function writeAuditLog(
  supabaseAdmin: SupabaseClient,
  params: {
    businessId: number | null;
    userId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert({
      business_id: params.businessId,
      user_id: params.userId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId || null,
      metadata: {
        ...(params.metadata || {}),
        actor_is_super_admin: true,
        source: 'edge_function:invite-business-owner',
      },
    });
    if (error) {
      // Non-blocking audit logging: ignore schema/constraint differences
    }
  } catch {
    // Non-blocking audit logging
  }
}

function buildInviteRedirectUrl(appUrl: string, businessId: number, invitationToken: string): string {
  const cleanOrigin = appUrl.replace(/\/+$/, '');
  return `${cleanOrigin}/accept-invite?business_id=${encodeURIComponent(String(businessId))}&token=${encodeURIComponent(invitationToken)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed. Use POST.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL') || 'https://novacode-tech.ai.studio';

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      { success: false, error: 'Server configuration incomplete: missing Supabase environment secrets.' },
      500
    );
  }

  // 1. Authenticate caller JWT & verify Super Admin status server-side via public.is_super_admin()
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ success: false, error: 'Missing Authorization Bearer token.' }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user: callerUser },
    error: callerUserError,
  } = await userClient.auth.getUser();

  if (callerUserError || !callerUser) {
    return jsonResponse(
      { success: false, error: callerUserError?.message || 'Invalid or expired authentication session.' },
      401
    );
  }

  const { data: isSuperAdminResult, error: superAdminError } = await userClient.rpc('is_super_admin');
  if (superAdminError) {
    return jsonResponse(
      { success: false, error: `Super Admin verification failed: ${superAdminError.message}` },
      403
    );
  }

  if (isSuperAdminResult !== true) {
    return jsonResponse(
      { success: false, error: 'Forbidden: Verified Super Admin authorization required.' },
      403
    );
  }

  // 2. Parse request body & initialize Admin client (service_role NEVER leaves this Edge Function)
  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON request payload.' }, 400);
  }

  const action: ActionType = payload.action || 'invite_owner';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // -------------------------------------------------------------------------
    // ACTION: REVOKE INVITATION
    // -------------------------------------------------------------------------
    if (action === 'revoke_invitation') {
      if (!payload.invitationId) {
        return jsonResponse({ success: false, error: 'invitationId is required to revoke an invitation.' }, 400);
      }

      const { data: inv, error: fetchErr } = await supabaseAdmin
        .from('business_invitations')
        .select('*')
        .eq('id', payload.invitationId)
        .maybeSingle();

      if (fetchErr || !inv) {
        return jsonResponse({ success: false, error: fetchErr?.message || 'Invitation not found.' }, 404);
      }

      if (inv.status === 'accepted') {
        return jsonResponse(
          {
            success: false,
            outcome: 'already_accepted',
            error: 'Accepted invitations cannot be revoked. Remove the user from business members instead.',
          },
          409
        );
      }

      const { data: updatedInv, error: updateErr } = await supabaseAdmin
        .from('business_invitations')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', inv.id)
        .select('*')
        .single();

      if (updateErr) {
        return jsonResponse({ success: false, error: updateErr.message }, 500);
      }

      await writeAuditLog(supabaseAdmin, {
        businessId: inv.business_id,
        userId: callerUser.id,
        action: 'revoke_business_invitation',
        entityType: 'business_invitations',
        entityId: inv.id,
        metadata: { email: inv.email, role: inv.role },
      });

      return jsonResponse({
        success: true,
        outcome: 'invitation_revoked',
        message: `Invitation for ${inv.email} has been revoked.`,
        invitation: updatedInv,
      });
    }

    // -------------------------------------------------------------------------
    // ACTION: RESEND INVITATION
    // -------------------------------------------------------------------------
    if (action === 'resend_invitation') {
      if (!payload.invitationId) {
        return jsonResponse({ success: false, error: 'invitationId is required to resend an invitation.' }, 400);
      }

      const { data: inv, error: fetchErr } = await supabaseAdmin
        .from('business_invitations')
        .select('*')
        .eq('id', payload.invitationId)
        .maybeSingle();

      if (fetchErr || !inv) {
        return jsonResponse({ success: false, error: fetchErr?.message || 'Invitation not found.' }, 404);
      }

      if (inv.status === 'accepted') {
        return jsonResponse(
          { success: false, outcome: 'already_accepted', error: 'This invitation has already been accepted.' },
          409
        );
      }

      if (inv.status === 'revoked') {
        return jsonResponse(
          { success: false, outcome: 'invitation_revoked', error: 'Revoked invitations cannot be resent. Create a new invitation.' },
          409
        );
      }

      const { data: biz, error: bizErr } = await supabaseAdmin
        .from('businesses')
        .select('*')
        .eq('id', inv.business_id)
        .maybeSingle();

      if (bizErr || !biz) {
        return jsonResponse({ success: false, error: 'Target business no longer exists.' }, 404);
      }

      const activeCheck = isBusinessActive(biz as Record<string, unknown>);
      if (!activeCheck.active) {
        return jsonResponse({ success: false, error: activeCheck.reason || 'Target business is inactive.' }, 409);
      }

      const normalizedEmail = normalizeEmail(inv.email);
      const existingAuthUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);

      // If user already confirmed their account in Supabase Auth, assign membership directly instead of failing
      if (existingAuthUser && existingAuthUser.email_confirmed_at) {
        const { error: memberErr } = await supabaseAdmin
          .from('business_members')
          .upsert(
            {
              business_id: inv.business_id,
              user_id: existingAuthUser.id,
              role: inv.role,
            },
            { onConflict: 'business_id,user_id' }
          );

        if (memberErr) {
          return jsonResponse({ success: false, error: memberErr.message }, 500);
        }

        const { data: acceptedInv } = await supabaseAdmin
          .from('business_invitations')
          .update({
            status: 'accepted',
            accepted_at: new Date().toISOString(),
            target_user_id: existingAuthUser.id,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', inv.id)
          .select('*')
          .single();

        await writeAuditLog(supabaseAdmin, {
          businessId: inv.business_id,
          userId: callerUser.id,
          action: 'assign_confirmed_user_on_resend',
          entityType: 'business_members',
          entityId: existingAuthUser.id,
          metadata: { email: normalizedEmail, role: inv.role },
        });

        return jsonResponse({
          success: true,
          outcome: 'existing_user_assigned',
          message: `${normalizedEmail} already has an active account and was assigned directly as ${inv.role} to ${biz.name}.`,
          invitation: acceptedInv,
        });
      }

      // Check for another active pending row before resetting status to pending
      if (inv.status !== 'pending') {
        const { data: otherPending } = await supabaseAdmin
          .from('business_invitations')
          .select('id')
          .eq('business_id', inv.business_id)
          .ilike('email', normalizedEmail)
          .eq('status', 'pending')
          .neq('id', inv.id)
          .maybeSingle();

        if (otherPending) {
          return jsonResponse(
            {
              success: false,
              outcome: 'duplicate_pending_invitation',
              error: `Another active pending invitation already exists for ${normalizedEmail}.`,
            },
            409
          );
        }
      }

      const newToken = crypto.randomUUID();
      const newExpiry = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const redirectTo = buildInviteRedirectUrl(appUrl, inv.business_id, newToken);

      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo,
        data: {
          invited_business_id: inv.business_id,
          invited_business_name: biz.name,
          invited_role: inv.role,
          invitation_token: newToken,
        },
      });

      if (inviteErr) {
        const { data: failedInv } = await supabaseAdmin
          .from('business_invitations')
          .update({
            status: 'failed',
            last_error: inviteErr.message,
            target_user_id: existingAuthUser?.id || inv.target_user_id || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', inv.id)
          .select('*')
          .single();

        await writeAuditLog(supabaseAdmin, {
          businessId: inv.business_id,
          userId: callerUser.id,
          action: 'resend_invitation_failed',
          entityType: 'business_invitations',
          entityId: inv.id,
          metadata: { email: normalizedEmail, error: inviteErr.message },
        });

        return jsonResponse(
          {
            success: false,
            outcome: 'invite_failed',
            error: `Failed to resend invitation email: ${inviteErr.message}`,
            invitation: failedInv,
          },
          502
        );
      }

      const nowIso = new Date().toISOString();
      const { data: resentInv, error: updateResentErr } = await supabaseAdmin
        .from('business_invitations')
        .update({
          status: 'pending',
          invitation_token: newToken,
          expires_at: newExpiry,
          last_sent_at: nowIso,
          resend_count: (inv.resend_count || 0) + 1,
          last_error: null,
          target_user_id: inviteData?.user?.id || existingAuthUser?.id || inv.target_user_id || null,
          updated_at: nowIso,
        })
        .eq('id', inv.id)
        .select('*')
        .single();

      if (updateResentErr) {
        return jsonResponse({ success: false, error: updateResentErr.message }, 500);
      }

      await writeAuditLog(supabaseAdmin, {
        businessId: inv.business_id,
        userId: callerUser.id,
        action: 'resend_business_invitation',
        entityType: 'business_invitations',
        entityId: inv.id,
        metadata: { email: normalizedEmail, role: inv.role, resend_count: resentInv.resend_count },
      });

      return jsonResponse({
        success: true,
        outcome: 'invitation_resent',
        message: `Invitation resent to ${normalizedEmail} (valid for ${INVITE_TTL_DAYS} days).`,
        invitation: resentInv,
      });
    }

    // -------------------------------------------------------------------------
    // SHARED VALIDATION FOR invite_owner & assign_existing_user
    // -------------------------------------------------------------------------
    const bizId = parsePositiveBigInt(payload.businessId);
    if (!bizId) {
      return jsonResponse({ success: false, error: 'Valid positive BIGINT businessId is required.' }, 400);
    }

    const normalizedEmail = normalizeEmail(payload.email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return jsonResponse({ success: false, error: 'A valid email address is required.' }, 400);
    }

    const role = payload.role && VALID_ROLES.has(payload.role) ? payload.role : 'owner';

    const { data: biz, error: bizErr } = await supabaseAdmin
      .from('businesses')
      .select('*')
      .eq('id', bizId)
      .maybeSingle();

    if (bizErr || !biz) {
      return jsonResponse({ success: false, error: `Target business #${bizId} not found.` }, 404);
    }

    const activeCheck = isBusinessActive(biz as Record<string, unknown>);
    if (!activeCheck.active) {
      return jsonResponse({ success: false, error: activeCheck.reason || `Target business #${bizId} is inactive.` }, 409);
    }

    const existingAuthUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);

    // -------------------------------------------------------------------------
    // ACTION: ASSIGN EXISTING USER
    // -------------------------------------------------------------------------
    if (action === 'assign_existing_user') {
      if (!existingAuthUser) {
        return jsonResponse(
          {
            success: false,
            outcome: 'user_not_found',
            error: `No Supabase user exists for ${normalizedEmail}. Switch to "Invite by Email" to send an onboarding link.`,
          },
          404
        );
      }

      if (!existingAuthUser.email_confirmed_at) {
        return jsonResponse(
          {
            success: false,
            outcome: 'user_unconfirmed',
            error: `${normalizedEmail} has not completed password setup yet. Use "Invite by Email" or "Resend" so they can activate their credentials.`,
          },
          409
        );
      }

      const { data: existingMembership } = await supabaseAdmin
        .from('business_members')
        .select('id, role')
        .eq('business_id', bizId)
        .eq('user_id', existingAuthUser.id)
        .maybeSingle();

      if (existingMembership && existingMembership.role === role) {
        return jsonResponse(
          {
            success: false,
            outcome: 'already_member',
            error: `${normalizedEmail} is already assigned to ${biz.name} as ${role}.`,
          },
          409
        );
      }

      const { error: upsertErr } = await supabaseAdmin
        .from('business_members')
        .upsert(
          {
            business_id: bizId,
            user_id: existingAuthUser.id,
            role,
          },
          { onConflict: 'business_id,user_id' }
        );

      if (upsertErr) {
        return jsonResponse({ success: false, error: upsertErr.message }, 500);
      }

      // Close any open pending invitations for this (business_id, email)
      await supabaseAdmin
        .from('business_invitations')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          target_user_id: existingAuthUser.id,
          updated_at: new Date().toISOString(),
        })
        .eq('business_id', bizId)
        .ilike('email', normalizedEmail)
        .eq('status', 'pending');

      await writeAuditLog(supabaseAdmin, {
        businessId: bizId,
        userId: callerUser.id,
        action: existingMembership ? 'update_member_role' : 'assign_existing_user',
        entityType: 'business_members',
        entityId: existingAuthUser.id,
        metadata: { email: normalizedEmail, role },
      });

      return jsonResponse({
        success: true,
        outcome: 'existing_user_assigned',
        message: existingMembership
          ? `Updated ${normalizedEmail}'s role in ${biz.name} to ${role}.`
          : `Assigned existing user ${normalizedEmail} to ${biz.name} as ${role}.`,
      });
    }

    // -------------------------------------------------------------------------
    // ACTION: INVITE NEW OWNER / MEMBER BY EMAIL
    // -------------------------------------------------------------------------
    // Auto-expire overdue pending invitations for this (businessId, email)
    await supabaseAdmin
      .from('business_invitations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('business_id', bizId)
      .ilike('email', normalizedEmail)
      .eq('status', 'pending')
      .lte('expires_at', new Date().toISOString());

    // Prevent duplicate active pending invitation
    const { data: activePending } = await supabaseAdmin
      .from('business_invitations')
      .select('*')
      .eq('business_id', bizId)
      .ilike('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle();

    if (activePending) {
      return jsonResponse(
        {
          success: false,
          outcome: 'duplicate_pending_invitation',
          error: `An active pending invitation already exists for ${normalizedEmail} in ${biz.name}. Use Resend or Revoke from the invitations list.`,
          invitation: activePending,
        },
        409
      );
    }

    // Handle existing confirmed user cleanly without crashing inviteUserByEmail
    if (existingAuthUser && existingAuthUser.email_confirmed_at) {
      const { data: existingMembership } = await supabaseAdmin
        .from('business_members')
        .select('id, role')
        .eq('business_id', bizId)
        .eq('user_id', existingAuthUser.id)
        .maybeSingle();

      if (existingMembership && existingMembership.role === role) {
        return jsonResponse(
          {
            success: false,
            outcome: 'already_member',
            error: `${normalizedEmail} is already an active ${role} of ${biz.name}.`,
          },
          409
        );
      }

      const { error: upsertErr } = await supabaseAdmin
        .from('business_members')
        .upsert(
          {
            business_id: bizId,
            user_id: existingAuthUser.id,
            role,
          },
          { onConflict: 'business_id,user_id' }
        );

      if (upsertErr) {
        return jsonResponse({ success: false, error: upsertErr.message }, 500);
      }

      const nowIso = new Date().toISOString();
      const { data: acceptedRecord } = await supabaseAdmin
        .from('business_invitations')
        .insert({
          business_id: bizId,
          email: normalizedEmail,
          role,
          invited_by: callerUser.id,
          target_user_id: existingAuthUser.id,
          status: 'accepted',
          expires_at: nowIso,
          accepted_at: nowIso,
          last_sent_at: nowIso,
        })
        .select('*')
        .single();

      await writeAuditLog(supabaseAdmin, {
        businessId: bizId,
        userId: callerUser.id,
        action: 'assign_existing_user_via_invite',
        entityType: 'business_members',
        entityId: existingAuthUser.id,
        metadata: { email: normalizedEmail, role },
      });

      return jsonResponse({
        success: true,
        outcome: 'existing_user_assigned',
        message: `${normalizedEmail} already had a confirmed Novacode Tech account and has been granted ${role} access to ${biz.name} immediately.`,
        invitation: acceptedRecord,
      });
    }

    // Create pending invitation record BEFORE sending email (do NOT write business_members yet)
    const invToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: createdInv, error: insertInvErr } = await supabaseAdmin
      .from('business_invitations')
      .insert({
        business_id: bizId,
        email: normalizedEmail,
        role,
        invited_by: callerUser.id,
        target_user_id: existingAuthUser?.id || null,
        status: 'pending',
        invitation_token: invToken,
        expires_at: expiresAt,
      })
      .select('*')
      .single();

    if (insertInvErr || !createdInv) {
      return jsonResponse(
        {
          success: false,
          error: insertInvErr?.message || 'Failed to record business invitation.',
        },
        500
      );
    }

    const redirectTo = buildInviteRedirectUrl(appUrl, bizId, invToken);
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo,
      data: {
        invited_business_id: bizId,
        invited_business_name: biz.name,
        invited_role: role,
        invitation_token: invToken,
      },
    });

    if (inviteErr) {
      const { data: failedInv } = await supabaseAdmin
        .from('business_invitations')
        .update({
          status: 'failed',
          last_error: inviteErr.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', createdInv.id)
        .select('*')
        .single();

      await writeAuditLog(supabaseAdmin, {
        businessId: bizId,
        userId: callerUser.id,
        action: 'invite_owner_failed',
        entityType: 'business_invitations',
        entityId: createdInv.id,
        metadata: { email: normalizedEmail, role, error: inviteErr.message },
      });

      return jsonResponse(
        {
          success: false,
          outcome: 'invite_failed',
          error: `Invitation email failed to send: ${inviteErr.message}`,
          invitation: failedInv,
        },
        502
      );
    }

    const nowIso = new Date().toISOString();
    const { data: sentInv } = await supabaseAdmin
      .from('business_invitations')
      .update({
        target_user_id: inviteData?.user?.id || existingAuthUser?.id || null,
        last_sent_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', createdInv.id)
      .select('*')
      .single();

    await writeAuditLog(supabaseAdmin, {
      businessId: bizId,
      userId: callerUser.id,
      action: 'invite_business_owner',
      entityType: 'business_invitations',
      entityId: createdInv.id,
      metadata: { email: normalizedEmail, role, business_name: biz.name },
    });

    return jsonResponse({
      success: true,
      outcome: 'invitation_sent',
      message: `Invitation sent to ${normalizedEmail} for ${biz.name} (${role}).`,
      invitation: sentInv || createdInv,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unexpected Edge Function error.';
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
