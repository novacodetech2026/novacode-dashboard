import { createClient, SupabaseClient, User, Session, RealtimeChannel } from '@supabase/supabase-js';
import {
  Tenant,
  BusinessHours,
  Customer,
  Service,
  Appointment,
  AppointmentStatus,
  BusinessMember,
  LocationType,
  Language,
  AuditLogEntry,
  BusinessInvitation,
  InviteOwnerResult,
  PlatformMetrics,
  SupportIncident,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketMessage,
  SupportTicketStatusHistoryEntry,
  SupportNotification,
  BusinessNotification,
  BookingNotificationEventType,
  IncidentSeverity,
  IncidentStatus,
  BusinessOwnerSummary,
  BusinessCommunicationChannels,
  BookingNotificationHealth,
  N8nIntegrationHealth,
  A2pApprovalStatus,
  BusinessMessagingConfig,
  BusinessSmsConsentSummary,
  SpecialBusinessHours,
} from '../types';
import { getCategoryOption, normalizeCategoryId } from '../data/businessCategories';
import {
  calculateAppointmentDurationMinutes,
  extractDateAndTimeInTimezone,
} from '../utils/dateTime';
import { isValidIanaTimezone } from '../utils/timezone';
import { getCurrencySymbol, normalizeCurrencyCode } from '../utils/currency';
import {
  sanitizeErrorForBusiness,
  BusinessErrorCategory,
  isPrivilegedServiceRoleKey,
} from '../utils/security';

let cachedClient: SupabaseClient | null = null;
let cachedUrl: string | null = null;
let cachedKey: string | null = null;

let hasWarnedEnvUrlPath = false;

export const PRODUCTION_APP_URL = 'https://novacode-tech.ai.studio';
export const RECOVERY_ROUTE_PATH = '/reset-password';
export const ACCEPT_INVITE_ROUTE_PATH = '/accept-invite';
export const PRODUCTION_RECOVERY_REDIRECT_URL = `${PRODUCTION_APP_URL}${RECOVERY_ROUTE_PATH}`;
export const PRODUCTION_INVITE_REDIRECT_URL = `${PRODUCTION_APP_URL}${ACCEPT_INVITE_ROUTE_PATH}`;
export const PRODUCTION_REDIRECT_URL = PRODUCTION_RECOVERY_REDIRECT_URL;

export interface NormalizedSupabaseUrl {
  url: string;
  isValid: boolean;
  hadExtraPath: boolean;
  originalPath?: string;
  error?: string;
}

/**
 * Ensures Supabase URL contains ONLY the base project origin (e.g. https://xyz.supabase.co)
 * without /auth/v1, /rest/v1, trailing slashes, or extra path segments.
 */
export function normalizeSupabaseUrl(rawUrl?: string | null): NormalizedSupabaseUrl {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { url: '', isValid: false, hadExtraPath: false, error: 'Supabase URL is empty.' };
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { url: '', isValid: false, hadExtraPath: false, error: 'Supabase URL must use HTTPS.' };
    }

    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    const hadExtraPath = Boolean(cleanPath) || Boolean(parsed.search) || Boolean(parsed.hash);

    return {
      url: parsed.origin,
      isValid: true,
      hadExtraPath,
      originalPath: cleanPath || undefined,
    };
  } catch {
    return { url: '', isValid: false, hadExtraPath: false, error: 'Invalid Supabase project URL format.' };
  }
}

export function getSupabaseEnvDiagnostic() {
  const rawEnvUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const hasEnvKey = Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);
  const normalized = normalizeSupabaseUrl(rawEnvUrl);
  return {
    hasEnvUrl: Boolean(rawEnvUrl),
    hasEnvKey,
    envUrlValid: normalized.isValid,
    envUrlHadExtraPath: normalized.hadExtraPath,
    normalizedEnvUrl: normalized.url,
  };
}

/**
 * Returns an initialized Supabase client using env vars or stored configuration.
 * Public publishable key only (never exposes service_role).
 */
export function getSupabaseClient(customUrl?: string, customKey?: string): SupabaseClient | null {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  let storedUrl = '';
  let storedKey = '';
  try {
    const raw = localStorage.getItem('novacode_supabase_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      storedUrl = parsed.url || '';
      storedKey = parsed.anonKey || '';
    }
  } catch {
    // Ignore storage parse error
  }

  const rawSelectedUrl = customUrl || envUrl || storedUrl;
  const finalKey = (customKey || envKey || storedKey || '').trim();

  if (!rawSelectedUrl || !finalKey || isPrivilegedServiceRoleKey(finalKey)) {
    if (isPrivilegedServiceRoleKey(finalKey)) {
      console.error('Security error: service_role keys are strictly prohibited in browser sessions.');
    }
    return null;
  }

  const normalized = normalizeSupabaseUrl(rawSelectedUrl);
  if (!normalized.isValid || !normalized.url) {
    console.warn('Invalid Supabase project URL configured:', normalized.error);
    return null;
  }

  if (normalized.hadExtraPath && !hasWarnedEnvUrlPath) {
    hasWarnedEnvUrlPath = true;
    console.warn(
      `Supabase URL contained an extra path ("${normalized.originalPath || ''}"). Normalized to base project URL "${normalized.url}" to prevent /auth/v1 path errors.`
    );
  }

  const finalUrl = normalized.url;

  if (cachedClient && cachedUrl === finalUrl && cachedKey === finalKey) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(finalUrl, finalKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    cachedUrl = finalUrl;
    cachedKey = finalKey;
    return cachedClient;
  } catch (e) {
    console.warn('Failed to initialize Supabase client:', e);
    return null;
  }
}

export function resetSupabaseClient(url: string, anonKey: string): SupabaseClient {
  const cleanKey = anonKey.trim();
  if (isPrivilegedServiceRoleKey(cleanKey)) {
    throw new Error('Privileged service_role keys are not allowed in browser sessions. Use only the public anon key.');
  }
  const normalized = normalizeSupabaseUrl(url);
  const cleanUrl = normalized.isValid ? normalized.url : url.trim();

  cachedClient = createClient(cleanUrl, cleanKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  cachedUrl = cleanUrl;
  cachedKey = cleanKey;
  return cachedClient;
}

// -----------------------------------------------------------------------------
// Connectivity & Health Check
// -----------------------------------------------------------------------------

export async function testSupabaseConnection(url: string, anonKey: string): Promise<{ success: boolean; message: string; normalizedUrl?: string; details?: any }> {
  if (isPrivilegedServiceRoleKey(anonKey)) {
    return {
      success: false,
      message: 'Security error: Privileged service_role keys must never be used in browser sessions. Provide only the public anon key.',
    };
  }
  const normalized = normalizeSupabaseUrl(url);
  if (!normalized.isValid || !normalized.url) {
    return { success: false, message: normalized.error || 'Invalid Supabase project URL.' };
  }

  try {
    const client = createClient(normalized.url, anonKey.trim(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    // Ping by checking businesses table count
    const { count, error } = await client.from('businesses').select('*', { count: 'exact', head: true });

    if (error) {
      // If table doesn't exist yet, it reached the server (404/PGRST116/42P01)
      if (error.code === 'PGRST116' || error.code === '42P01') {
        return { 
          success: true, 
          normalizedUrl: normalized.url,
          message: 'Connected to Supabase. Note: businesses table not found yet. Run the SQL schema to initialize.',
          details: { code: error.code } 
        };
      }
      // If unauthorized or network error
      if (error.message.includes('fetch') || error.message.includes('JWT') || error.message.includes('Invalid API key')) {
        return { success: false, message: error.message };
      }
    }

    return { 
      success: true, 
      normalizedUrl: normalized.url,
      message: 'Successfully reached Supabase API endpoint. Authentication valid.',
      details: { tableRecordCount: count }
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown network connection error';
    return { success: false, message };
  }
}

// -----------------------------------------------------------------------------
// Authentication Flow
// -----------------------------------------------------------------------------

export async function signInWithEmailPassword(email: string, password: string): Promise<{ user: User | null; session: Session | null; error: string | null }> {
  const client = getSupabaseClient();
  if (!client) {
    return { user: null, session: null, error: 'Supabase client is not configured. Please enter your project URL and Anon key in Settings.' };
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    return { user: null, session: null, error: error.message };
  }

  return { user: data.user, session: data.session, error: null };
}

export async function signUpWithEmailPassword(
  _email: string,
  _password: string,
  _businessName?: string
): Promise<{ user: User | null; session: Session | null; error: string | null }> {
  return {
    user: null,
    session: null,
    error: 'Public self-registration is disabled. Portal access requires an administrator invitation.',
  };
}

export async function signOutUser(): Promise<{ error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { error: null };
  const { error } = await client.auth.signOut();
  return { error: error ? error.message : null };
}

export async function getCurrentSupabaseSession(): Promise<{ user: User | null; session: Session | null }> {
  const client = getSupabaseClient();
  if (!client) return { user: null, session: null };
  const { data } = await client.auth.getSession();
  return { user: data.session?.user || null, session: data.session || null };
}

export function onSupabaseAuthStateChange(callback: (event: string, session: Session | null) => void) {
  const client = getSupabaseClient();
  if (!client) return { unsubscribe: () => {} };
  const { data: { subscription } } = client.auth.onAuthStateChange(callback);
  return { unsubscribe: () => subscription.unsubscribe() };
}

export async function sendPasswordResetEmail(email: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase client is not configured. Please enter your project URL and Anon key in Settings.',
    };
  }

  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: PRODUCTION_RECOVERY_REDIRECT_URL,
    });
    if (error) {
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to send password recovery email.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function updateUserPassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not configured.' };
  }

  try {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) {
      return {
        success: false,
        error: 'No active password recovery session found. Please request a new password reset email.',
      };
    }

    const { error } = await client.auth.updateUser({
      password: newPassword,
    });
    if (error) {
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to update password.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export function isRecoveryRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const normalizedPath = window.location.pathname.replace(/\/+$/, '');
  return normalizedPath === RECOVERY_ROUTE_PATH;
}

export function getRecoveryUrlError(): string | null {
  if (typeof window === 'undefined') return null;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
  const errorCode = hashParams.get('error_code') || searchParams.get('error_code') || hashParams.get('error') || searchParams.get('error');
  if (errorDesc) return errorDesc;
  if (errorCode) return `Recovery link error: ${errorCode}`;
  return null;
}

export function isRecoveryUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const typeParam = hashParams.get('type') || searchParams.get('type');
  return (
    isRecoveryRoute() ||
    typeParam === 'recovery' ||
    window.location.hash.includes('type=recovery') ||
    window.location.search.includes('type=recovery')
  );
}

export async function processRecoveryUrlSession(): Promise<{ hasRecoverySession: boolean; error?: string }> {
  const urlError = getRecoveryUrlError();
  if (urlError) {
    return { hasRecoverySession: false, error: urlError };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { hasRecoverySession: false };
  }

  if (typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search);
    const tokenHash = searchParams.get('token_hash');
    const typeParam = searchParams.get('type');

    if (tokenHash && typeParam === 'recovery') {
      const { data, error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      });
      if (error) {
        return { hasRecoverySession: false, error: sanitizeDatabaseError(error.message) };
      }
      if (data?.session) {
        return { hasRecoverySession: true };
      }
    }
  }

  const { data } = await client.auth.getSession();
  return { hasRecoverySession: Boolean(data.session) };
}

// -----------------------------------------------------------------------------
// Invited Business Owner Onboarding Detection & Verification
// -----------------------------------------------------------------------------

export function isInvitationRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const normalizedPath = window.location.pathname.replace(/\/+$/, '');
  return normalizedPath === ACCEPT_INVITE_ROUTE_PATH;
}

export function getInvitationUrlParams(): { businessId?: string; token?: string; type?: string } {
  if (typeof window === 'undefined') return {};
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);

  const businessId = searchParams.get('business_id') || hashParams.get('business_id') || undefined;
  const token = searchParams.get('token') || hashParams.get('token') || undefined;
  const type = hashParams.get('type') || searchParams.get('type') || undefined;

  return { businessId, token, type };
}

export function getInvitationUrlError(): string | null {
  if (typeof window === 'undefined') return null;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
  const errorCode =
    hashParams.get('error_code') ||
    searchParams.get('error_code') ||
    hashParams.get('error') ||
    searchParams.get('error');

  if (errorDesc) return errorDesc;
  if (errorCode) return `Invitation link error: ${errorCode}`;
  return null;
}

export function isInvitationUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const { type, token } = getInvitationUrlParams();
  return (
    isInvitationRoute() ||
    type === 'invite' ||
    Boolean(token && window.location.pathname.includes('accept-invite')) ||
    window.location.hash.includes('type=invite') ||
    window.location.search.includes('type=invite')
  );
}

export async function processInvitationUrlSession(): Promise<{
  hasInvitationSession: boolean;
  businessId?: string;
  token?: string;
  error?: string;
}> {
  const { businessId, token } = getInvitationUrlParams();
  const urlError = getInvitationUrlError();
  if (urlError) {
    return { hasInvitationSession: false, businessId, token, error: urlError };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { hasInvitationSession: false, businessId, token };
  }

  if (typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search);
    const tokenHash = searchParams.get('token_hash');
    const typeParam = searchParams.get('type');

    if (tokenHash && (typeParam === 'invite' || typeParam === 'signup' || typeParam === 'magiclink')) {
      const { data, error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: typeParam,
      });
      if (error) {
        return {
          hasInvitationSession: false,
          businessId,
          token,
          error: sanitizeDatabaseError(error.message),
        };
      }
      if (data?.session) {
        return { hasInvitationSession: true, businessId, token };
      }
    }
  }

  const { data } = await client.auth.getSession();
  return {
    hasInvitationSession: Boolean(data.session),
    businessId,
    token,
  };
}

// -----------------------------------------------------------------------------
// Platform Super Admin & Multi-Tenant Business Resolution (Server-Verified)
// -----------------------------------------------------------------------------

export interface UserAccessProfile {
  isSuperAdmin: boolean;
  superAdminCheckError?: string;
  membershipsError?: string;
  businessesError?: string;
  memberships: BusinessMember[];
  accessibleBusinesses: Tenant[];
}

/**
 * Resolves user authorization strictly from Supabase server functions & tables:
 * 1. Calls `supabase.rpc('is_super_admin')` using the authenticated user's session.
 *    NEVER grants Super Admin from email address or frontend state.
 *    If the RPC fails, captures `superAdminCheckError` rather than silently downgrading.
 * 2. Resolves assigned businesses from `public.business_members` (BIGINT business_id).
 * 3. When `isSuperAdmin === true`, queries all `businesses` (guarded by RLS `is_super_admin()`).
 */
export function toDbId(id: string | number): string | number {
  if (typeof id === 'number') return id;
  const trimmed = String(id).trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isSafeInteger(num)) return num;
  }
  return trimmed;
}

export async function verifyCurrentUserIsSuperAdmin(): Promise<{ isSuperAdmin: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { isSuperAdmin: false, error: 'Database client not initialized.' };
  try {
    const { data: sessionData, error: sessionErr } = await client.auth.getSession();
    if (sessionErr || !sessionData?.session) {
      return { isSuperAdmin: false, error: 'No active authenticated session.' };
    }
    const { data, error } = await client.rpc('is_super_admin');
    if (error) {
      return { isSuperAdmin: false, error: error.message };
    }
    return { isSuperAdmin: data === true };
  } catch (err: unknown) {
    return {
      isSuperAdmin: false,
      error: err instanceof Error ? err.message : 'Unable to verify Super Admin role.',
    };
  }
}

export async function fetchUserAccessProfile(userId: string): Promise<UserAccessProfile> {
  const client = getSupabaseClient();
  if (!client || !userId) {
    return { isSuperAdmin: false, memberships: [], accessibleBusinesses: [] };
  }

  try {
    // Ensure an active authenticated session exists before calling SECURITY DEFINER RPC
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session) {
      return {
        isSuperAdmin: false,
        superAdminCheckError: sessionError
          ? `Session verification failed before Super Admin check: ${sessionError.message}`
          : 'No active authenticated Supabase session found for role verification.',
        memberships: [],
        accessibleBusinesses: [],
      };
    }

    // 1. Authoritative server-side check via supabase.rpc('is_super_admin')
    let isSuperAdmin = false;
    let superAdminCheckError: string | undefined;

    const { data: rpcIsSuperAdmin, error: rpcError } = await client.rpc('is_super_admin');
    if (rpcError) {
      const codeSuffix = rpcError.code ? ` [${rpcError.code}]` : '';
      superAdminCheckError = `Super Admin check (rpc.is_super_admin) failed: ${rpcError.message}${codeSuffix}`;
    } else {
      isSuperAdmin = rpcIsSuperAdmin === true;
    }

    // 2. Fetch explicit active business_members assignments for this authenticated user
    let membershipsError: string | undefined;
    let { data: members, error: memberError } = await client
      .from('business_members')
      .select('id, user_id, business_id, role, is_active, created_at')
      .eq('user_id', userId);

    if (
      memberError &&
      (memberError.code === '42703' ||
        memberError.code === 'PGRST204' ||
        memberError.message?.toLowerCase().includes('is_active'))
    ) {
      const retryMembers = await client
        .from('business_members')
        .select('id, user_id, business_id, role, created_at')
        .eq('user_id', userId);
      members = retryMembers.data as any;
      memberError = retryMembers.error;
    }

    if (memberError) {
      membershipsError = `Membership lookup (business_members) failed: ${memberError.message}`;
    }
    const safeMembers = !memberError && members
      ? members.filter((m: any) => m?.is_active !== false)
      : [];

    // 3. Resolve accessible businesses strictly according to server-verified role & active status
    let businessesData: any[] = [];
    let businessesError: string | undefined;

    if (isSuperAdmin) {
      // Allowed strictly when rpc('is_super_admin') confirms Super Admin; RLS enforces is_super_admin()
      const { data: allBiz, error: bizErr } = await client
        .from('businesses')
        .select('*')
        .order('name', { ascending: true });
      if (bizErr) {
        const codeSuffix = bizErr.code ? ` [${bizErr.code}]` : '';
        businessesError = `Super Admin businesses query failed (verify businesses RLS policy for is_super_admin()): ${bizErr.message}${codeSuffix}`;
      } else if (allBiz) {
        businessesData = allBiz;
      }
    } else if (safeMembers.length > 0) {
      const businessIds = safeMembers.map(m => toDbId(m.business_id));
      const { data: memberBiz, error: memberBizErr } = await client
        .from('businesses')
        .select('*')
        .in('id', businessIds)
        .order('name', { ascending: true });
      if (memberBizErr) {
        businessesError = `Assigned businesses query failed: ${memberBizErr.message}`;
      } else if (memberBiz) {
        businessesData = memberBiz;
      }
    }

    const businessIdsForHours = businessesData
      .map(row => row?.id)
      .filter((id): id is string | number => id != null);
    const businessHoursMap = await fetchBusinessHoursMapInSupabase(businessIdsForHours);

    const businessMap = new Map<string, Tenant>();
    const mappedBusinesses = businessesData.map(row =>
      mapDatabaseBusinessToTenant(row, businessHoursMap.get(String(row.id)))
    );
    // Non-Super-Admin members cannot enter suspended/inactive businesses
    const accessibleBusinesses = isSuperAdmin
      ? mappedBusinesses
      : mappedBusinesses.filter(b => b.isActive !== false);

    for (const biz of accessibleBusinesses) {
      businessMap.set(biz.id, biz);
    }

    const memberships: BusinessMember[] = safeMembers
      .filter(m => isSuperAdmin || businessMap.has(String(m.business_id)))
      .map(m => {
        const normalizedBizId = String(m.business_id);
        return {
          id: m.id != null ? String(m.id) : undefined,
          userId: String(m.user_id),
          businessId: normalizedBizId,
          role: m.role || 'staff',
          business: businessMap.get(normalizedBizId),
          createdAt: m.created_at,
        };
      });

    return {
      isSuperAdmin,
      superAdminCheckError,
      membershipsError,
      businessesError,
      memberships,
      accessibleBusinesses,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unexpected error verifying Super Admin role.';
    return {
      isSuperAdmin: false,
      superAdminCheckError: `Super Admin check (rpc.is_super_admin) threw an error: ${msg}`,
      memberships: [],
      accessibleBusinesses: [],
    };
  }
}

export async function fetchUserBusinessMemberships(userId: string): Promise<BusinessMember[]> {
  const profile = await fetchUserAccessProfile(userId);
  return profile.memberships;
}

/**
 * Lists business members for an authorized business (Business Owner or Super Admin).
 */
export async function fetchBusinessMembersForTenant(businessId: string): Promise<BusinessMember[]> {
  const client = getSupabaseClient();
  if (!client || !businessId) return [];

  try {
    // Prefer secure SECURITY DEFINER RPC that joins member emails safely (supports BIGINT target_business_id)
    const { data: rpcData, error: rpcError } = await client.rpc('admin_list_business_members', {
      target_business_id: toDbId(businessId),
    });

    if (!rpcError && Array.isArray(rpcData)) {
      return rpcData.map((m: any) => ({
        id: m.id != null ? String(m.id) : undefined,
        userId: String(m.user_id),
        businessId: String(m.business_id),
        role: m.role || 'staff',
        userEmail: m.user_email || m.email || undefined,
        createdAt: m.created_at,
      }));
    }

    // Fallback to direct RLS-enforced select on business_members
    const { data, error } = await client
      .from('business_members')
      .select('id, user_id, business_id, role, created_at')
      .eq('business_id', toDbId(businessId));

    if (error || !data) return [];

    return data.map(m => ({
      id: m.id != null ? String(m.id) : undefined,
      userId: String(m.user_id),
      businessId: String(m.business_id),
      role: m.role || 'staff',
      createdAt: m.created_at,
    }));
  } catch (err) {
    console.warn('Failed to fetch business members:', err);
    return [];
  }
}

export async function assignBusinessMemberInSupabase(
  businessId: string,
  email: string,
  role: 'owner' | 'admin' | 'manager' | 'staff'
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  try {
    const { error } = await client.rpc('admin_assign_business_member', {
      target_business_id: toDbId(businessId),
      target_email: email.trim().toLowerCase(),
      target_role: role,
    });
    if (error) {
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to assign business member.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function removeBusinessMemberInSupabase(
  businessId: string,
  targetUserId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  try {
    const { error } = await client.rpc('admin_remove_business_member', {
      target_business_id: toDbId(businessId),
      target_user_id: targetUserId,
    });
    if (error) {
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to remove business member.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function createBusinessAsSuperAdminInSupabase(input: {
  name: string;
  category?: string;
  categoryLabelEn?: string;
  categoryLabelEs?: string;
  customCategoryName?: string;
  timezone?: string;
  defaultLanguage?: 'en' | 'es';
  phone?: string;
  email?: string;
  address?: string;
  tagline?: string;
  description?: string;
  logo?: string;
}): Promise<{ success: boolean; business?: Tenant; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  try {
    const normalizedCat = normalizeCategoryId(input.category);
    const { data, error } = await client.rpc('admin_create_business', {
      p_name: input.name.trim(),
      p_category: normalizedCat || 'spa',
      p_timezone: input.timezone || 'America/New_York',
      p_default_language: input.defaultLanguage || 'en',
      p_phone: input.phone || '',
      p_email: input.email || '',
      p_address: input.address || '',
    });

    if (error) {
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }
    if (!data) {
      return { success: false, error: 'Business creation returned no record.' };
    }

    let createdTenant = mapDatabaseBusinessToTenant(data);
    const hasExtraMeta = Boolean(
      input.tagline ||
        input.description ||
        input.logo ||
        input.address ||
        input.defaultLanguage ||
        input.customCategoryName ||
        input.categoryLabelEn ||
        input.categoryLabelEs
    );

    if (hasExtraMeta) {
      const catOpt = getCategoryOption(normalizedCat);
      const enrichedTenant: Tenant = {
        ...createdTenant,
        category: normalizedCat,
        categoryLabelEn: input.categoryLabelEn || catOpt.labelEn,
        categoryLabelEs: input.categoryLabelEs || catOpt.labelEs,
        defaultLanguage: input.defaultLanguage || createdTenant.defaultLanguage,
        address: input.address?.trim() || createdTenant.address,
        tagline: input.tagline?.trim() || createdTenant.tagline,
        description: input.description?.trim() || createdTenant.description,
        logo: input.logo?.trim() || createdTenant.logo,
        settings: {
          ...createdTenant.settings,
          categoryDetails: {
            customName: input.customCategoryName?.trim() || undefined,
            groupId: catOpt.groupId,
          },
        },
      };
      const updateRes = await updateBusinessSettingsInSupabase(enrichedTenant);
      if (updateRes.success) {
        createdTenant = enrichedTenant;
      }
    }

    return { success: true, business: createdTenant };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to create business.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

// -----------------------------------------------------------------------------
// Business Owner Invitation & Onboarding API (Edge Function + RPCs)
// -----------------------------------------------------------------------------

function mapRowToBusinessInvitation(row: any): BusinessInvitation {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    businessName: row.business_name || undefined,
    email: String(row.email || ''),
    role: row.role || 'owner',
    status: row.status || 'pending',
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at || undefined,
    lastSentAt: row.last_sent_at || undefined,
    resendCount: Number(row.resend_count) || 0,
    lastError: row.last_error || undefined,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

export async function fetchBusinessInvitationsInSupabase(
  businessId?: string
): Promise<{ invitations: BusinessInvitation[]; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { invitations: [], error: 'Supabase client is not connected.' };
  }

  try {
    const { data, error } = await client.rpc('admin_list_business_invitations', {
      target_business_id: businessId ? toBigIntId(businessId) : null,
    });

    if (error) {
      return { invitations: [], error: formatSupabaseError(error, 'Unable to load business invitations.') };
    }

    return {
      invitations: Array.isArray(data) ? data.map(mapRowToBusinessInvitation) : [],
    };
  } catch (err: unknown) {
    return {
      invitations: [],
      error: formatSupabaseError(err, 'Unexpected error fetching business invitations.'),
    };
  }
}

export async function acceptBusinessInvitationInSupabase(
  businessId?: string,
  invitationToken?: string
): Promise<{
  success: boolean;
  acceptedCount: number;
  primaryBusinessId?: string;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, acceptedCount: 0, error: 'Supabase client is not connected.' };
  }

  try {
    const bizIdNum = businessId ? toBigIntId(businessId) : null;
    const cleanToken = invitationToken && isValidUuid(invitationToken) ? invitationToken.trim() : null;

    if (!cleanToken) {
      return {
        success: false,
        acceptedCount: 0,
        error: 'A valid invitation token is required to accept a business invitation.',
      };
    }

    const { data, error } = await client.rpc('accept_business_invitation', {
      p_business_id: bizIdNum,
      p_invitation_token: cleanToken,
    });

    if (error) {
      return {
        success: false,
        acceptedCount: 0,
        error: formatSupabaseError(error, 'Failed to accept business invitation.'),
      };
    }

    const acceptedCount = Number((data as any)?.accepted_count || 0);
    const primaryBiz = (data as any)?.primary_business_id;
    return {
      success: true,
      acceptedCount,
      primaryBusinessId: primaryBiz != null ? String(primaryBiz) : undefined,
    };
  } catch (err: unknown) {
    return {
      success: false,
      acceptedCount: 0,
      error: formatSupabaseError(err, 'Unexpected error accepting business invitation.'),
    };
  }
}

export async function invokeInviteOwnerEdgeFunction(payload: {
  action: 'invite_owner' | 'assign_existing_user' | 'resend_invitation' | 'revoke_invitation';
  businessId?: string;
  email?: string;
  role?: 'owner' | 'admin' | 'manager' | 'staff';
  invitationId?: string;
}): Promise<InviteOwnerResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not connected.' };
  }

  try {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) {
      return { success: false, error: 'Active Super Admin session is required.' };
    }

    const requestBody: Record<string, unknown> = {
      action: payload.action,
    };
    if (payload.businessId) {
      const bizIdNum = toBigIntId(payload.businessId);
      if (!bizIdNum) {
        return { success: false, error: `Invalid business ID (${payload.businessId}): expected a positive BIGINT.` };
      }
      requestBody.businessId = bizIdNum;
    }
    if (payload.email) requestBody.email = payload.email.trim().toLowerCase();
    if (payload.role) requestBody.role = payload.role;
    if (payload.invitationId) requestBody.invitationId = payload.invitationId;

    const { data, error } = await client.functions.invoke('invite-business-owner', {
      body: requestBody,
    });

    if (error) {
      // Extract structured JSON error payload from FunctionsHttpError context when available
      const ctx = (error as any)?.context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const parsedBody = await ctx.json();
          if (parsedBody && typeof parsedBody === 'object') {
            return {
              success: false,
              outcome: parsedBody.outcome,
              error: parsedBody.error || error.message,
              invitation: parsedBody.invitation ? mapRowToBusinessInvitation(parsedBody.invitation) : undefined,
            };
          }
        } catch {
          // Fall through to generic error message
        }
      }

      return {
        success: false,
        error: sanitizeDatabaseError(error.message || 'Edge Function invite-business-owner request failed.'),
      };
    }

    if (!data || data.success === false) {
      return {
        success: false,
        outcome: data?.outcome,
        error: data?.error || 'Edge Function returned an unsuccessful response.',
        invitation: data?.invitation ? mapRowToBusinessInvitation(data.invitation) : undefined,
      };
    }

    return {
      success: true,
      outcome: data.outcome,
      message: data.message,
      invitation: data.invitation ? mapRowToBusinessInvitation(data.invitation) : undefined,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to invoke invite-business-owner Edge Function.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

const ALLOWED_LOCATION_TYPES: LocationType[] = ['in_business', 'at_home', 'online'];
const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeLocationTypesList(raw: unknown, fallback: LocationType[] = ['in_business']): LocationType[] {
  if (!Array.isArray(raw)) return fallback;
  const filtered = raw.filter(
    (item): item is LocationType =>
      typeof item === 'string' && (ALLOWED_LOCATION_TYPES as string[]).includes(item)
  );
  const unique = Array.from(new Set(filtered));
  return unique.length > 0 ? unique : fallback;
}

export function sanitizeSpecialHoursPayload(
  raw: unknown
): { ok: true; items: SpecialBusinessHours[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Special hours must be a valid list of dates.' };
  }

  const byDate = new Map<string, SpecialBusinessHours>();
  for (const entry of raw) {
    const date = typeof entry?.date === 'string' ? entry.date.trim() : '';
    if (!ISO_DATE_REGEX.test(date)) {
      return { ok: false, error: 'Each special hour entry must include a valid YYYY-MM-DD date.' };
    }
    const label = typeof entry?.label === 'string' ? entry.label.trim() : '';
    const isClosed = Boolean(entry?.isClosed);

    if (isClosed) {
      byDate.set(date, {
        date,
        isClosed: true,
        ...(label ? { label } : {}),
      });
    } else {
      const open = normalizeTimeHHMM(entry?.open, '');
      const close = normalizeTimeHHMM(entry?.close, '');
      if (!HHMM_REGEX.test(open) || !HHMM_REGEX.test(close) || open >= close) {
        return {
          ok: false,
          error: `Special hours for ${date} must have a valid opening time earlier than the closing time.`,
        };
      }
      byDate.set(date, {
        date,
        isClosed: false,
        open,
        close,
        ...(label ? { label } : {}),
      });
    }
  }

  const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, items: sorted };
}

const OWNER_PROFILE_ALLOWED_KEYS = new Set([
  'name',
  'business_type',
  'description',
  'tagline',
  'logo',
  'slug',
  'phone',
  'email',
  'address',
  'website',
  'instagram',
  'timezone',
  'currency',
  'currencySymbol',
  'defaultLanguage',
  'locationTypes',
  'bookingInstructions',
  'categoryKey',
  'categoryLabelEn',
  'categoryLabelEs',
  'categoryDetails',
  'specialHours',
  'bufferBetweenAppointmentsMinutes',
  'cancellationBufferHours',
  'aiAssistant',
]);

/**
 * Updates business profile, special hours, and booking policies strictly via the
 * server-side RPC `update_business_profile(p_business_id bigint, p_profile jsonb)`.
 * Never performs a direct `.from('businesses').update(...)` and strips any
 * administrative/status fields (`is_active`, `isSuspended`, `communicationChannels`, etc.).
 */
export async function updateBusinessProfileInSupabase(
  businessId: string | number,
  profilePayload: Record<string, any>,
  options?: { operatingHoursMigrated?: boolean }
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  const dbBizId = toBigIntId(businessId) ?? toDbId(businessId);
  if (dbBizId == null || dbBizId === '') {
    return { success: false, error: 'Invalid business ID.' };
  }

  try {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(profilePayload || {})) {
      if (key === 'operatingHours') {
        if (options?.operatingHoursMigrated === true && value && typeof value === 'object') {
          const cleanedHours: Record<number, BusinessHours> = {};
          for (let dow = 0; dow <= 6; dow += 1) {
            const rawDay = value[dow];
            if (!rawDay || typeof rawDay !== 'object') continue;
            const isClosed = Boolean(rawDay.isClosed);
            if (isClosed) {
              cleanedHours[dow] = { open: '', close: '', isClosed: true };
            } else {
              const open = normalizeTimeHHMM(rawDay.open, '');
              const close = normalizeTimeHHMM(rawDay.close, '');
              if (!HHMM_REGEX.test(open) || !HHMM_REGEX.test(close) || open >= close) {
                return {
                  success: false,
                  error: 'Each open weekday must have a valid opening time earlier than its closing time.',
                };
              }
              cleanedHours[dow] = { open, close, isClosed: false };
            }
          }
          sanitized.operatingHours = cleanedHours;
        }
        continue;
      }

      if (!OWNER_PROFILE_ALLOWED_KEYS.has(key) || value === undefined) {
        continue;
      }

      if (key === 'name') {
        const trimmedName = typeof value === 'string' ? value.trim() : '';
        if (!trimmedName) {
          return { success: false, error: 'Business name is required.' };
        }
        sanitized.name = trimmedName;
      } else if (key === 'business_type') {
        const normalizedCat = normalizeCategoryId(String(value || 'general_service'));
        sanitized.business_type = normalizedCat;
      } else if (key === 'timezone') {
        const tz = typeof value === 'string' ? value.trim() : '';
        if (!isValidIanaTimezone(tz)) {
          return { success: false, error: 'Please select a valid IANA timezone.' };
        }
        sanitized.timezone = tz;
      } else if (key === 'currency') {
        const code = normalizeCurrencyCode(String(value || ''), '');
        if (!code) {
          return { success: false, error: 'Please select a valid 3-letter currency code.' };
        }
        sanitized.currency = code;
        if (sanitized.currencySymbol === undefined && profilePayload.currencySymbol === undefined) {
          sanitized.currencySymbol = getCurrencySymbol(code);
        }
      } else if (key === 'defaultLanguage') {
        sanitized.defaultLanguage = value === 'es' ? 'es' : 'en';
      } else if (key === 'locationTypes') {
        if (!Array.isArray(value)) {
          return { success: false, error: 'At least one supported appointment location must be selected.' };
        }
        const filtered = value.filter(
          (item): item is LocationType =>
            typeof item === 'string' && (ALLOWED_LOCATION_TYPES as string[]).includes(item)
        );
        const unique = Array.from(new Set(filtered));
        if (unique.length === 0) {
          return { success: false, error: 'At least one supported appointment location must be selected.' };
        }
        sanitized.locationTypes = unique;
      } else if (key === 'specialHours') {
        const shResult = sanitizeSpecialHoursPayload(value);
        if (shResult.ok === false) {
          return { success: false, error: shResult.error };
        }
        sanitized.specialHours = shResult.items;
      } else if (key === 'bufferBetweenAppointmentsMinutes') {
        const num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
          return {
            success: false,
            error: 'Buffer between appointments must be a non-negative integer.',
          };
        }
        sanitized.bufferBetweenAppointmentsMinutes = num;
      } else if (key === 'cancellationBufferHours') {
        const num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
          return {
            success: false,
            error: 'Cancellation notice window must be a non-negative integer.',
          };
        }
        sanitized.cancellationBufferHours = num;
      } else if (typeof value === 'string') {
        sanitized[key] = value.trim();
      } else {
        sanitized[key] = value;
      }
    }

    const { error } = await client.rpc('update_business_profile', {
      p_business_id: dbBizId,
      p_profile: sanitized,
    });

    if (error) {
      const msgLower = (error.message || '').toLowerCase();
      if (
        (error.code === '42703' || error.code === 'PGRST204') &&
        msgLower.includes('settings')
      ) {
        return {
          success: false,
          error:
            'Database column businesses.settings is missing. Run prerequisite migration 20261116_01_businesses_settings_prerequisite.sql before saving business settings.',
        };
      }
      if (error.code === 'PGRST202' || msgLower.includes('update_business_profile')) {
        return {
          success: false,
          error:
            'Supabase RPC update_business_profile(p_business_id bigint, p_profile jsonb) is not deployed or inaccessible for this role.',
        };
      }
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to save business profile.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

/**
 * Persists weekly business hours cleanly:
 * - While `!operatingHoursMigrated` (default): writes strictly to `public.business_hours`
 *   and NEVER writes `businesses.settings.operatingHours` or invents default open hours.
 * - When `operatingHoursMigrated === true`: persists through `update_business_profile` RPC.
 */
export async function saveWeeklyBusinessHoursInSupabase(
  businessId: string | number,
  operatingHours: Record<number, BusinessHours>,
  options?: { operatingHoursMigrated?: boolean }
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  const dbBizId = toBigIntId(businessId) ?? toDbId(businessId);
  if (dbBizId == null || dbBizId === '') {
    return { success: false, error: 'Invalid business ID.' };
  }

  for (let dow = 0; dow <= 6; dow += 1) {
    const day = operatingHours?.[dow];
    if (!day || day.isClosed) continue;
    const open = normalizeTimeHHMM(day.open, '');
    const close = normalizeTimeHHMM(day.close, '');
    if (!HHMM_REGEX.test(open) || !HHMM_REGEX.test(close) || open >= close) {
      return {
        success: false,
        error: 'Each open day must have a valid opening time earlier than its closing time.',
      };
    }
  }

  if (options?.operatingHoursMigrated === true) {
    return updateBusinessProfileInSupabase(
      dbBizId,
      { operatingHours },
      { operatingHoursMigrated: true }
    );
  }

  return syncBusinessHoursInSupabase(client, dbBizId, operatingHours);
}

export async function updateBusinessSettingsInSupabase(tenant: Tenant): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  try {
    const dbBizId = toBigIntId(tenant.id) ?? toDbId(tenant.id);
    if (dbBizId == null || dbBizId === '') {
      return { success: false, error: 'Invalid business ID.' };
    }

    const normalizedCat = normalizeCategoryId(tenant.category);
    const catOpt = getCategoryOption(normalizedCat);
    const normalizedCurrency = normalizeCurrencyCode(tenant.currency, 'USD');
    const operatingHoursMigrated = Boolean(tenant.settings?.operatingHoursMigrated);

    const profilePayload: Record<string, any> = {
      name: tenant.name,
      business_type: normalizedCat,
      tagline: tenant.tagline ?? '',
      description: tenant.description ?? '',
      logo: tenant.logo ?? '',
      slug: tenant.slug || undefined,
      defaultLanguage: tenant.defaultLanguage === 'es' ? 'es' : 'en',
      currency: normalizedCurrency,
      currencySymbol: tenant.currencySymbol || getCurrencySymbol(normalizedCurrency),
      phone: tenant.phone ?? '',
      email: tenant.email ?? '',
      address: tenant.address ?? '',
      website: tenant.website ?? '',
      instagram: tenant.instagram ?? '',
      timezone: tenant.timezone,
      locationTypes: normalizeLocationTypesList(tenant.settings?.locationTypes, ['in_business']),
      bookingInstructions: tenant.settings?.bookingInstructions ?? '',
      categoryKey: normalizedCat,
      categoryLabelEn: tenant.categoryLabelEn || catOpt.labelEn,
      categoryLabelEs: tenant.categoryLabelEs || catOpt.labelEs,
      categoryDetails: {
        ...tenant.settings?.categoryDetails,
        groupId: catOpt.groupId,
      },
      specialHours: Array.isArray(tenant.settings?.specialHours) ? tenant.settings.specialHours : [],
      cancellationBufferHours: Math.max(0, Math.floor(Number(tenant.settings?.cancellationBufferHours) || 0)),
      bufferBetweenAppointmentsMinutes: Math.max(
        0,
        Math.floor(Number(tenant.settings?.bufferBetweenAppointmentsMinutes) || 0)
      ),
      ...(tenant.settings?.aiAssistant ? { aiAssistant: tenant.settings.aiAssistant } : {}),
    };

    if (operatingHoursMigrated && tenant.settings?.operatingHours) {
      profilePayload.operatingHours = tenant.settings.operatingHours;
    }

    const rpcRes = await updateBusinessProfileInSupabase(dbBizId, profilePayload, {
      operatingHoursMigrated,
    });
    if (!rpcRes.success) {
      return rpcRes;
    }

    if (
      !operatingHoursMigrated &&
      tenant.settings?.operatingHours &&
      Object.keys(tenant.settings.operatingHours).length > 0
    ) {
      const bhSyncResult = await saveWeeklyBusinessHoursInSupabase(
        dbBizId,
        tenant.settings.operatingHours,
        { operatingHoursMigrated: false }
      );
      if (!bhSyncResult.success) {
        return bhSyncResult;
      }
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to save business settings.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function toggleBusinessActiveInSupabase(
  tenant: Tenant,
  nextActive: boolean
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  try {
    const dbBizId = toDbId(tenant.id);
    const nextSettings = {
      ...tenant.settings,
      isSuspended: !nextActive,
    };

    const { error } = await client
      .from('businesses')
      .update({
        is_active: nextActive,
        settings: nextSettings,
      })
      .eq('id', dbBizId);

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if ((error.code === '42703' || error.code === 'PGRST204') && msg.includes('settings')) {
        const { error: activeOnlyErr } = await client
          .from('businesses')
          .update({
            is_active: nextActive,
          })
          .eq('id', dbBizId);

        if (activeOnlyErr) {
          return { success: false, error: sanitizeDatabaseError(activeOnlyErr.message) };
        }
      } else if (msg.includes('is_active') || error.code === '42703' || error.code === 'PGRST204') {
        const { error: fallbackErr } = await client
          .from('businesses')
          .update({
            settings: nextSettings,
          })
          .eq('id', dbBizId);

        if (fallbackErr) {
          return { success: false, error: sanitizeDatabaseError(fallbackErr.message) };
        }
      } else {
        return { success: false, error: sanitizeDatabaseError(error.message) };
      }
    }

    await recordAdminAuditLogInSupabase({
      businessId: tenant.id,
      action: nextActive ? 'activate_business' : 'suspend_business',
      entityType: 'businesses',
      entityId: tenant.id,
      metadata: { business_name: tenant.name, is_active: nextActive },
    });

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to update business status.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function createServiceInSupabase(
  businessId: string,
  svc: Omit<Service, 'id' | 'tenantId'>,
  preferredLang: Language = 'en'
): Promise<{ success: boolean; service?: Service; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  const bizIdValue = toBigIntId(businessId) ?? toDbId(businessId);
  if (bizIdValue == null || bizIdValue === '') {
    return { success: false, error: 'Valid business_id is required to create a service.' };
  }

  const resolvedName = (
    preferredLang === 'es'
      ? svc.nameEs || svc.nameEn
      : svc.nameEn || svc.nameEs || ''
  ).trim();
  if (!resolvedName) {
    return { success: false, error: 'Service name is required.' };
  }
  const durationMinutes = Number(svc.durationMinutes);
  if (!Number.isFinite(durationMinutes) || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
    return { success: false, error: 'Service duration must be an integer between 5 and 1440 minutes.' };
  }
  const price = Number(svc.price);
  if (!Number.isFinite(price) || price < 0) {
    return { success: false, error: 'Service price must be a valid non-negative number.' };
  }

  const resolvedDescription = (
    preferredLang === 'es'
      ? svc.descriptionEs || svc.descriptionEn || ''
      : svc.descriptionEn || svc.descriptionEs || ''
  ).trim();
  const normalizedCurrency = normalizeCurrencyCode(svc.currency, 'USD');

  try {
    // Primary write targeting live public.services schema:
    // (id UUID, business_id BIGINT, name, description, duration_minutes, price, currency, is_active, created_at, updated_at)
    const livePayload = {
      business_id: bizIdValue,
      name: resolvedName,
      description: resolvedDescription,
      name_en: svc.nameEn || resolvedName,
      name_es: svc.nameEs || resolvedName,
      description_en: svc.descriptionEn ?? resolvedDescription,
      description_es: svc.descriptionEs ?? resolvedDescription,
      duration_minutes: durationMinutes,
      price,
      currency: normalizedCurrency,
      is_active: svc.active !== false,
    };

    let { data, error } = await client
      .from('services')
      .insert(livePayload)
      .select()
      .single();

    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      const legacyPayload = {
        business_id: bizIdValue,
        name_en: svc.nameEn || resolvedName,
        name_es: svc.nameEs || resolvedName,
        description_en: svc.descriptionEn ?? resolvedDescription,
        description_es: svc.descriptionEs ?? resolvedDescription,
        duration_minutes: durationMinutes,
        price,
        category: svc.category || 'General',
        allows_in_business: svc.allowsInBusiness !== false,
        allows_at_home: Boolean(svc.allowsAtHome),
      };
      const retry = await client
        .from('services')
        .insert({ ...legacyPayload, is_active: svc.active !== false })
        .select()
        .single();
      data = retry.data;
      error = retry.error;

      if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.toLowerCase().includes('is_active'))) {
        const retryActive = await client
          .from('services')
          .insert({ ...legacyPayload, active: svc.active !== false })
          .select()
          .single();
        data = retryActive.data;
        error = retryActive.error;
      }
    }

    if (error || !data) {
      return { success: false, error: sanitizeDatabaseError(error?.message || 'Unable to create service.') };
    }
    return { success: true, service: mapRowToService(data) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to create service.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function updateServiceInSupabase(
  service: Service,
  preferredLang: Language = 'en'
): Promise<{ success: boolean; service?: Service; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  const bizIdValue = toBigIntId(service.tenantId) ?? toDbId(service.tenantId);
  if (!service.id || bizIdValue == null || bizIdValue === '') {
    return { success: false, error: 'Service ID and business_id are required.' };
  }

  const resolvedName = (
    preferredLang === 'es'
      ? service.nameEs || service.nameEn
      : service.nameEn || service.nameEs || ''
  ).trim();
  if (!resolvedName) {
    return { success: false, error: 'Service name is required.' };
  }
  const durationMinutes = Number(service.durationMinutes);
  if (!Number.isFinite(durationMinutes) || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
    return { success: false, error: 'Service duration must be an integer between 5 and 1440 minutes.' };
  }
  const price = Number(service.price);
  if (!Number.isFinite(price) || price < 0) {
    return { success: false, error: 'Service price must be a valid non-negative number.' };
  }

  const resolvedDescription = (
    preferredLang === 'es'
      ? service.descriptionEs ?? service.descriptionEn ?? ''
      : service.descriptionEn ?? service.descriptionEs ?? ''
  ).trim();
  const normalizedCurrency = normalizeCurrencyCode(service.currency, 'USD');

  try {
    const baseLivePayload = {
      name: resolvedName,
      description: resolvedDescription,
      name_en: service.nameEn || resolvedName,
      name_es: service.nameEs || resolvedName,
      description_en: service.descriptionEn ?? resolvedDescription,
      description_es: service.descriptionEs ?? resolvedDescription,
      duration_minutes: durationMinutes,
      price,
      currency: normalizedCurrency,
      is_active: Boolean(service.active),
    };

    let { data, error } = await client
      .from('services')
      .update({
        ...baseLivePayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', toDbId(service.id))
      .eq('business_id', bizIdValue)
      .select()
      .single();

    if (
      error &&
      (error.code === '42703' || error.code === 'PGRST204') &&
      error.message?.toLowerCase().includes('updated_at')
    ) {
      const retryNoUpdatedAt = await client
        .from('services')
        .update(baseLivePayload)
        .eq('id', toDbId(service.id))
        .eq('business_id', bizIdValue)
        .select()
        .single();
      data = retryNoUpdatedAt.data;
      error = retryNoUpdatedAt.error;
    }

    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      const legacyPayload = {
        name_en: service.nameEn || resolvedName,
        name_es: service.nameEs || resolvedName,
        description_en: service.descriptionEn ?? resolvedDescription,
        description_es: service.descriptionEs ?? resolvedDescription,
        duration_minutes: durationMinutes,
        price,
        category: service.category || 'General',
        allows_in_business: service.allowsInBusiness !== false,
        allows_at_home: Boolean(service.allowsAtHome),
      };
      const retry = await client
        .from('services')
        .update({ ...legacyPayload, is_active: Boolean(service.active) })
        .eq('id', toDbId(service.id))
        .eq('business_id', bizIdValue)
        .select()
        .single();
      data = retry.data;
      error = retry.error;

      if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.toLowerCase().includes('is_active'))) {
        const retryActive = await client
          .from('services')
          .update({ ...legacyPayload, active: Boolean(service.active) })
          .eq('id', toDbId(service.id))
          .eq('business_id', bizIdValue)
          .select()
          .single();
        data = retryActive.data;
        error = retryActive.error;
      }
    }

    if (error || !data) {
      return { success: false, error: sanitizeDatabaseError(error?.message || 'Unable to update service.') };
    }
    return { success: true, service: mapRowToService(data) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to update service.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function updateCustomerNotesInSupabase(
  businessId: string,
  customerId: string,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  try {
    const { error } = await client
      .from('customers')
      .update({ notes })
      .eq('id', toDbId(customerId))
      .eq('business_id', toDbId(businessId));

    if (error) {
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to update customer notes.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export async function recordAdminAuditLogInSupabase(params: {
  businessId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client.rpc('admin_log_action', {
      p_business_id: params.businessId ? toDbId(params.businessId) : null,
      p_action: params.action,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId || null,
      p_metadata: params.metadata || {},
    });
  } catch {
    // Non-blocking audit helper if RPC is not deployed yet
  }
}

export async function fetchRecentAuditLogs(businessId?: string): Promise<AuditLogEntry[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    let query = client
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    if (businessId) {
      query = query.eq('business_id', toDbId(businessId));
    }

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((row: any) => ({
      id: String(row.id),
      businessId: row.business_id != null ? String(row.business_id) : undefined,
      userId: row.user_id != null ? String(row.user_id) : undefined,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id != null ? String(row.entity_id) : undefined,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  } catch (err) {
    console.warn('Failed to fetch audit logs:', err);
    return [];
  }
}

const WEEKDAY_NAME_KEYS: Record<number, string[]> = {
  0: ['0', 'sunday', 'sun'],
  1: ['1', 'monday', 'mon'],
  2: ['2', 'tuesday', 'tue'],
  3: ['3', 'wednesday', 'wed'],
  4: ['4', 'thursday', 'thu'],
  5: ['5', 'friday', 'fri'],
  6: ['6', 'saturday', 'sat'],
};

function normalizeTimeHHMM(raw: unknown, fallback: string): string {
  const str = typeof raw === 'string' ? raw.trim() : '';
  const match = str.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hNum = Number(match[1]);
  const mNum = Number(match[2]);
  if (!Number.isInteger(hNum) || !Number.isInteger(mNum) || hNum < 0 || hNum > 23 || mNum < 0 || mNum > 59) {
    return fallback;
  }
  const h = String(hNum).padStart(2, '0');
  const m = String(mNum).padStart(2, '0');
  return `${h}:${m}`;
}

function resolveMigratedOperatingHoursRecord(rawHours: any): Record<number, BusinessHours> {
  const result: Record<number, BusinessHours> = {};
  const src = rawHours && typeof rawHours === 'object' ? rawHours : null;
  if (!src) return result;

  for (let dow = 0; dow <= 6; dow += 1) {
    let entry: any = null;
    for (const key of WEEKDAY_NAME_KEYS[dow]) {
      if (src[key] && typeof src[key] === 'object') {
        entry = src[key];
        break;
      }
    }
    if (!entry) continue;

    const isClosed = Boolean(entry.isClosed);
    result[dow] = {
      open: normalizeTimeHHMM(entry.open, ''),
      close: normalizeTimeHHMM(entry.close, ''),
      isClosed,
    };
  }
  return result;
}

function resolveOperatingHoursFromBusinessHoursRows(rows: any[]): Record<number, BusinessHours> {
  // Match SQL _resolve_business_hours_for_date_internal: when a business has
  // configured rows in public.business_hours, omitted weekdays default to closed
  // without inventing default opening hours.
  const result: Record<number, BusinessHours> = {
    0: { open: '', close: '', isClosed: true },
    1: { open: '', close: '', isClosed: true },
    2: { open: '', close: '', isClosed: true },
    3: { open: '', close: '', isClosed: true },
    4: { open: '', close: '', isClosed: true },
    5: { open: '', close: '', isClosed: true },
    6: { open: '', close: '', isClosed: true },
  };

  for (const row of rows) {
    const dow = Number(row?.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;

    const open = normalizeTimeHHMM(row?.open_time ?? row?.open, '');
    const close = normalizeTimeHHMM(row?.close_time ?? row?.close, '');
    const isClosed =
      typeof row?.is_open === 'boolean'
        ? !row.is_open
        : typeof row?.is_closed === 'boolean'
        ? row.is_closed
        : true;

    result[dow] = { open, close, isClosed };
  }

  return result;
}

export async function fetchBusinessHoursMapInSupabase(
  businessIds: Array<string | number>
): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  const client = getSupabaseClient();
  if (!client || !Array.isArray(businessIds) || businessIds.length === 0) {
    return map;
  }

  const dbIds = Array.from(
    new Set(
      businessIds
        .map(id => toBigIntId(id))
        .filter((id): id is number => id !== null)
    )
  );
  if (dbIds.length === 0) return map;

  try {
    const { data, error } = await client
      .from('business_hours')
      .select('*')
      .in('business_id', dbIds);

    if (error || !Array.isArray(data)) {
      return map;
    }

    for (const row of data) {
      if (row?.business_id == null) continue;
      const key = String(row.business_id);
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    }
  } catch (err) {
    console.warn('Failed to fetch public.business_hours:', err);
  }

  return map;
}

async function syncBusinessHoursInSupabase(
  client: SupabaseClient,
  dbBizId: string | number,
  operatingHours: Record<number, BusinessHours>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: existingRows, error: selectErr } = await client
      .from('business_hours')
      .select('*')
      .eq('business_id', dbBizId);

    if (selectErr) {
      const msgLower = (selectErr.message || '').toLowerCase();
      if (
        selectErr.code === '42P01' ||
        selectErr.code === 'PGRST205' ||
        msgLower.includes('does not exist')
      ) {
        return { success: true };
      }
      return { success: false, error: sanitizeDatabaseError(selectErr.message) };
    }

    const rows = Array.isArray(existingRows) ? existingRows : [];
    const usesIsClosed =
      rows.length > 0 && !('is_open' in rows[0]) && 'is_closed' in rows[0];
    const rowByDow = new Map<number, any>();
    for (const row of rows) {
      const dow = Number(row?.day_of_week);
      if (Number.isInteger(dow) && dow >= 0 && dow <= 6) {
        rowByDow.set(dow, row);
      }
    }

    for (let dow = 0; dow <= 6; dow += 1) {
      const dayHours = operatingHours?.[dow];
      const existing = rowByDow.get(dow);

      if (!dayHours) {
        if (existing) {
          const closedPayload: Record<string, any> = {
            ...(usesIsClosed ? { is_closed: true } : { is_open: false }),
          };
          let closeQuery = client.from('business_hours').update(closedPayload);
          if (existing.id != null) {
            closeQuery = closeQuery.eq('id', existing.id).eq('business_id', dbBizId);
          } else {
            closeQuery = closeQuery.eq('business_id', dbBizId).eq('day_of_week', dow);
          }
          const { error: closeErr } = await closeQuery;
          if (closeErr) {
            return { success: false, error: sanitizeDatabaseError(closeErr.message) };
          }
        }
        continue;
      }

      const isClosed = Boolean(dayHours.isClosed);
      const openTime = normalizeTimeHHMM(dayHours.open, isClosed ? '00:00' : '');
      const closeTime = normalizeTimeHHMM(dayHours.close, isClosed ? '00:00' : '');
      if (!isClosed && (!openTime || !closeTime || openTime >= closeTime)) {
        return {
          success: false,
          error: 'Each open weekday must have a valid opening time earlier than its closing time.',
        };
      }

      const payload: Record<string, any> = {
        open_time: openTime || '00:00',
        close_time: closeTime || '00:00',
        ...(usesIsClosed ? { is_closed: isClosed } : { is_open: !isClosed }),
      };

      if (existing) {
        let updateQuery = client.from('business_hours').update(payload);
        if (existing.id != null) {
          updateQuery = updateQuery.eq('id', existing.id).eq('business_id', dbBizId);
        } else {
          updateQuery = updateQuery.eq('business_id', dbBizId).eq('day_of_week', dow);
        }
        const { error: updateErr } = await updateQuery;
        if (updateErr) {
          return { success: false, error: sanitizeDatabaseError(updateErr.message) };
        }
      } else {
        const { error: insertErr } = await client.from('business_hours').insert({
          business_id: dbBizId,
          day_of_week: dow,
          ...payload,
        });
        if (insertErr) {
          return { success: false, error: sanitizeDatabaseError(insertErr.message) };
        }
      }
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to sync public.business_hours.';
    return { success: false, error: sanitizeDatabaseError(msg) };
  }
}

export function mapDatabaseBusinessToTenant(row: any, businessHoursRows?: any[]): Tenant {
  const normalizedId = row?.id != null ? String(row.id) : '';
  const rawSettings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  const rawCategory = rawSettings.categoryKey || row.business_type || row.category || 'spa';
  const normalizedCat = normalizeCategoryId(rawCategory);
  const catOpt = getCategoryOption(normalizedCat);
  const customCatName = rawSettings?.categoryDetails?.customName;

  const isSuspendedFromSettings = Boolean(rawSettings.isSuspended);
  const resolvedIsActive =
    typeof row.is_active === 'boolean'
      ? row.is_active
      : typeof row.active === 'boolean'
      ? row.active
      : typeof row.status === 'string'
      ? row.status !== 'suspended' && row.status !== 'inactive'
      : !isSuspendedFromSettings;

  const operatingHoursMigrated = Boolean(rawSettings.operatingHoursMigrated);
  const resolvedOperatingHours = operatingHoursMigrated
    ? resolveMigratedOperatingHoursRecord(rawSettings.operatingHours)
    : Array.isArray(businessHoursRows) && businessHoursRows.length > 0
    ? resolveOperatingHoursFromBusinessHoursRows(businessHoursRows)
    : {};

  const resolvedDefaultLang =
    (row.default_language ?? rawSettings.defaultLanguage) === 'es' ? 'es' : 'en';

  const resolvedCurrency = normalizeCurrencyCode(row.currency ?? rawSettings.currency, 'USD');
  const resolvedCurrencySymbol =
    row.currency_symbol ?? rawSettings.currencySymbol ?? getCurrencySymbol(resolvedCurrency);

  const normalizedSpecialHours: SpecialBusinessHours[] = Array.isArray(rawSettings.specialHours)
    ? rawSettings.specialHours
        .filter((sh: any) => sh && typeof sh.date === 'string' && ISO_DATE_REGEX.test(sh.date))
        .map((sh: any) => {
          const isClosed = Boolean(sh.isClosed);
          const label = typeof sh.label === 'string' && sh.label.trim() ? sh.label.trim() : undefined;
          if (isClosed) {
            return {
              ...(sh.id ? { id: String(sh.id) } : {}),
              date: sh.date,
              isClosed: true,
              ...(label ? { label } : {}),
            };
          }
          return {
            ...(sh.id ? { id: String(sh.id) } : {}),
            date: sh.date,
            isClosed: false,
            open: normalizeTimeHHMM(sh.open, ''),
            close: normalizeTimeHHMM(sh.close, ''),
            ...(label ? { label } : {}),
          };
        })
    : [];

  return {
    id: normalizedId,
    name: row.name || 'My Business',
    slug: row.slug || rawSettings.slug || normalizedId,
    tagline: row.tagline ?? rawSettings.tagline ?? '',
    description: row.description ?? rawSettings.description ?? '',
    isActive: resolvedIsActive,
    category: normalizedCat,
    categoryLabelEn: customCatName || row.category_label_en || rawSettings.categoryLabelEn || catOpt.labelEn,
    categoryLabelEs: customCatName || row.category_label_es || rawSettings.categoryLabelEs || catOpt.labelEs,
    logo: row.logo ?? rawSettings.logo ?? '',
    timezone: row.timezone || 'America/New_York',
    defaultLanguage: resolvedDefaultLang,
    currency: resolvedCurrency,
    currencySymbol: resolvedCurrencySymbol,
    phone: row.phone || '',
    email: row.email || '',
    address: row.address ?? rawSettings.address ?? '',
    website: row.website ?? rawSettings.website ?? '',
    instagram: row.instagram ?? rawSettings.instagram ?? '',
    settings: {
      operatingHours: resolvedOperatingHours,
      ...(operatingHoursMigrated ? { operatingHoursMigrated: true } : {}),
      specialHours: normalizedSpecialHours,
      cancellationBufferHours: Math.max(0, Math.floor(Number(rawSettings.cancellationBufferHours ?? 24) || 0)),
      bufferBetweenAppointmentsMinutes: Math.max(
        0,
        Math.floor(Number(rawSettings.bufferBetweenAppointmentsMinutes ?? 15) || 0)
      ),
      locationTypes: normalizeLocationTypesList(rawSettings.locationTypes, ['in_business']),
      bookingInstructions:
        typeof rawSettings.bookingInstructions === 'string' ? rawSettings.bookingInstructions : '',
      categoryDetails: rawSettings.categoryDetails || { groupId: catOpt.groupId },
      aiAssistant: rawSettings.aiAssistant,
      communicationChannels: rawSettings.communicationChannels,
      isSuspended: !resolvedIsActive,
    },
  };
}

// -----------------------------------------------------------------------------
// Live Database Queries (Scoped by business_id with RLS)
// -----------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value?: string | null): boolean {
  return Boolean(value && UUID_REGEX.test(value.trim()));
}

export function toBigIntId(id: string | number | undefined | null): number | null {
  if (typeof id === 'number') {
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

export interface SupabaseRpcErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function formatSupabaseError(error: SupabaseRpcErrorLike | unknown, fallback = 'Supabase request failed.'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error && !('code' in error)) {
    return error.message || fallback;
  }

  const err = error as SupabaseRpcErrorLike;
  const parts: string[] = [];
  if (err.code) parts.push(`[${err.code}]`);
  if (err.message) parts.push(err.message);
  if (err.details) parts.push(`Details: ${err.details}`);
  if (err.hint) parts.push(`Hint: ${err.hint}`);

  return parts.length > 0 ? parts.join(' — ') : fallback;
}

/**
 * Converts a wall-clock YYYY-MM-DD + HH:MM in the business timezone into a UTC ISO-8601 TIMESTAMPTZ string.
 */
export function buildIsoTimestampInTimezone(dateStr: string, timeStr: string, timeZone?: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;

  if (!year || !month || !day) {
    return new Date(`${dateStr}T${timeStr}:00`).toISOString();
  }

  if (!timeZone) {
    return new Date(`${dateStr}T${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}:00`).toISOString();
  }

  try {
    const utcGuess = Date.UTC(year, month - 1, day, safeHour, safeMinute, 0);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    const getOffsetMs = (utcMs: number): number => {
      const parts = formatter.formatToParts(new Date(utcMs));
      const map: Record<string, number> = {};
      for (const p of parts) {
        if (p.type !== 'literal') {
          map[p.type] = Number(p.value);
        }
      }
      const h = map.hour === 24 ? 0 : (map.hour ?? 0);
      const tzAsUtc = Date.UTC(map.year, (map.month ?? 1) - 1, map.day ?? 1, h, map.minute ?? 0, map.second ?? 0);
      return tzAsUtc - utcMs;
    };

    const offset1 = getOffsetMs(utcGuess);
    const target1 = utcGuess - offset1;
    const offset2 = getOffsetMs(target1);
    return new Date(utcGuess - offset2).toISOString();
  } catch {
    return new Date(`${dateStr}T${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}:00`).toISOString();
  }
}


export interface LiveQueryResult<T> {
  items: T[];
  error?: string;
  errorType?: BusinessErrorCategory;
  technicalDetail?: string;
}

export async function fetchLiveAppointmentsWithStatus(
  businessId: string,
  timeZone?: string,
  lang: 'en' | 'es' = 'en'
): Promise<LiveQueryResult<Appointment>> {
  const client = getSupabaseClient();
  if (!client) {
    const sanitized = sanitizeErrorForBusiness('Database client not connected', lang);
    return { items: [], error: sanitized.userMessage, errorType: sanitized.errorType, technicalDetail: sanitized.technicalDetail };
  }

  try {
    let { data, error } = await client
      .from('appointments')
      .select('*')
      .eq('business_id', toDbId(businessId))
      .order('date', { ascending: false });

    if (error && (error.code === '42703' || error.message?.toLowerCase().includes('date'))) {
      const retry = await client
        .from('appointments')
        .select('*')
        .eq('business_id', toDbId(businessId))
        .order('start_time', { ascending: false });
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      const sanitized = sanitizeErrorForBusiness(error, lang);
      return {
        items: [],
        error: sanitized.userMessage,
        errorType: sanitized.errorType,
        technicalDetail: sanitized.technicalDetail,
      };
    }

    return { items: (data || []).map(row => mapRowToAppointment(row, timeZone)) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err, lang);
    return {
      items: [],
      error: sanitized.userMessage,
      errorType: sanitized.errorType,
      technicalDetail: sanitized.technicalDetail,
    };
  }
}

export async function fetchLiveAppointments(businessId: string, timeZone?: string): Promise<Appointment[]> {
  const res = await fetchLiveAppointmentsWithStatus(businessId, timeZone);
  return res.items;
}

export async function fetchLiveCustomersWithStatus(
  businessId: string,
  lang: 'en' | 'es' = 'en'
): Promise<LiveQueryResult<Customer>> {
  const client = getSupabaseClient();
  if (!client) {
    const sanitized = sanitizeErrorForBusiness('Database client not connected', lang);
    return { items: [], error: sanitized.userMessage, errorType: sanitized.errorType, technicalDetail: sanitized.technicalDetail };
  }

  try {
    const { data, error } = await client
      .from('customers')
      .select('*')
      .eq('business_id', toDbId(businessId))
      .order('created_at', { ascending: false });

    if (error) {
      const sanitized = sanitizeErrorForBusiness(error, lang);
      return {
        items: [],
        error: sanitized.userMessage,
        errorType: sanitized.errorType,
        technicalDetail: sanitized.technicalDetail,
      };
    }

    return { items: (data || []).map(mapRowToCustomer) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err, lang);
    return {
      items: [],
      error: sanitized.userMessage,
      errorType: sanitized.errorType,
      technicalDetail: sanitized.technicalDetail,
    };
  }
}

export async function fetchLiveCustomers(businessId: string): Promise<Customer[]> {
  const res = await fetchLiveCustomersWithStatus(businessId);
  return res.items;
}

export async function fetchLiveServicesWithStatus(
  businessId: string,
  lang: 'en' | 'es' = 'en'
): Promise<LiveQueryResult<Service>> {
  const client = getSupabaseClient();
  if (!client) {
    const sanitized = sanitizeErrorForBusiness('Database client not connected', lang);
    return { items: [], error: sanitized.userMessage, errorType: sanitized.errorType, technicalDetail: sanitized.technicalDetail };
  }

  try {
    const bizIdValue = toBigIntId(businessId) ?? toDbId(businessId);
    const { data, error } = await client
      .from('services')
      .select('*')
      .eq('business_id', bizIdValue);

    if (error) {
      const sanitized = sanitizeErrorForBusiness(error, lang);
      return {
        items: [],
        error: sanitized.userMessage,
        errorType: sanitized.errorType,
        technicalDetail: sanitized.technicalDetail,
      };
    }

    return { items: (data || []).map(mapRowToService) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err, lang);
    return {
      items: [],
      error: sanitized.userMessage,
      errorType: sanitized.errorType,
      technicalDetail: sanitized.technicalDetail,
    };
  }
}

export async function fetchLiveServices(businessId: string): Promise<Service[]> {
  const res = await fetchLiveServicesWithStatus(businessId);
  return res.items;
}

export async function fetchActiveServicesCountInSupabase(businessId: string): Promise<number | null> {
  const client = getSupabaseClient();
  if (!client || !businessId) return null;

  try {
    const bizIdValue = toBigIntId(businessId) ?? toDbId(businessId);
    let { count, error } = await client
      .from('services')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', bizIdValue)
      .eq('is_active', true);

    if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.toLowerCase().includes('is_active'))) {
      const retry = await client
        .from('services')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', bizIdValue)
        .eq('active', true);
      count = retry.count;
      error = retry.error;
    }

    if (error) return null;
    return typeof count === 'number' ? count : 0;
  } catch {
    return null;
  }
}

export async function fetchPlatformAggregateMetricsInSupabase(businesses: Tenant[]): Promise<PlatformMetrics> {
  const totalBusinesses = businesses.length;
  const activeBusinesses = businesses.filter(b => b.isActive !== false).length;
  const suspendedBusinesses = businesses.filter(b => b.isActive === false).length;
  const client = getSupabaseClient();

  if (!client) {
    return {
      totalBusinesses,
      activeBusinesses,
      suspendedBusinesses,
      totalCustomers: null,
      totalAppointments: null,
      systemHealth: 'offline',
      healthDetail: 'Supabase client not configured.',
      lastCheckedAt: new Date().toISOString(),
    };
  }

  try {
    const [custRes, aptRes] = await Promise.all([
      client.from('customers').select('*', { count: 'exact', head: true }),
      client.from('appointments').select('*', { count: 'exact', head: true }),
    ]);

    const errors: string[] = [];
    if (custRes.error) errors.push(`customers: ${custRes.error.message}`);
    if (aptRes.error) errors.push(`appointments: ${aptRes.error.message}`);

    return {
      totalBusinesses,
      activeBusinesses,
      suspendedBusinesses,
      totalCustomers: !custRes.error && typeof custRes.count === 'number' ? custRes.count : null,
      totalAppointments: !aptRes.error && typeof aptRes.count === 'number' ? aptRes.count : null,
      systemHealth: errors.length > 0 ? 'degraded' : 'healthy',
      healthDetail: errors.length > 0 ? errors.join(' | ') : 'Supabase Auth & RLS operational',
      lastCheckedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to reach Supabase platform metrics.';
    return {
      totalBusinesses,
      activeBusinesses,
      suspendedBusinesses,
      totalCustomers: null,
      totalAppointments: null,
      systemHealth: 'offline',
      healthDetail: msg,
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

export function mapRowToSupportIncident(row: any): SupportIncident {
  return {
    id: String(row?.id || ''),
    businessId: row?.business_id != null ? String(row.business_id) : undefined,
    businessName: typeof row?.business_name === 'string' && row.business_name ? row.business_name : undefined,
    reportedBy: row?.reported_by != null ? String(row.reported_by) : undefined,
    source: (row?.source || 'technical_error') as SupportIncident['source'],
    severity: (row?.severity || 'medium') as SupportIncident['severity'],
    status: (row?.status || 'open') as SupportIncident['status'],
    title: typeof row?.title === 'string' && row.title ? row.title : 'Incident Report',
    description: typeof row?.description === 'string' ? row.description : '',
    errorCode: typeof row?.error_code === 'string' && row.error_code ? row.error_code : undefined,
    createdAt: row?.created_at || new Date().toISOString(),
    resolvedAt: typeof row?.resolved_at === 'string' && row.resolved_at ? row.resolved_at : undefined,
  };
}

export async function fetchPlatformIncidentsInSupabase(options?: {
  status?: IncidentStatus | 'all';
  severity?: IncidentSeverity | 'all';
  businessId?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  incidents: SupportIncident[];
  tableExists: boolean;
  totalCount: number;
  hasMore: boolean;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      incidents: [],
      tableExists: false,
      totalCount: 0,
      hasMore: false,
      error: 'Supabase client is not connected.',
    };
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  try {
    let query = client
      .from('support_incidents')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status);
    }
    if (options?.severity && options.severity !== 'all') {
      query = query.eq('severity', options.severity);
    }
    if (options?.businessId && options.businessId !== 'all') {
      const bizIdNum = toBigIntId(options.businessId);
      if (bizIdNum) {
        query = query.eq('business_id', bizIdNum);
      }
    }

    const { data, error, count } = await query;

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        msg.includes('could not find the table') ||
        msg.includes('does not exist')
      ) {
        return { incidents: [], tableExists: false, totalCount: 0, hasMore: false };
      }
      return {
        incidents: [],
        tableExists: true,
        totalCount: 0,
        hasMore: false,
        error: formatSupabaseError(error, 'Unable to load support incidents.'),
      };
    }

    const mapped: SupportIncident[] = (data || []).map(mapRowToSupportIncident);
    const totalCount = typeof count === 'number' ? count : offset + mapped.length;
    const hasMore =
      typeof count === 'number' ? offset + mapped.length < count : mapped.length === limit;

    return { incidents: mapped, tableExists: true, totalCount, hasMore };
  } catch (err: unknown) {
    return {
      incidents: [],
      tableExists: false,
      totalCount: 0,
      hasMore: false,
      error: formatSupabaseError(err, 'Unexpected error loading support incidents.'),
    };
  }
}

export async function fetchPlatformIncidentByIdInSupabase(incidentId: string): Promise<{
  incident: SupportIncident | null;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(incidentId)) {
    return { incident: null };
  }

  try {
    const { data, error } = await client
      .from('support_incidents')
      .select('*')
      .eq('id', incidentId)
      .maybeSingle();

    if (error || !data) {
      return {
        incident: null,
        error: error ? formatSupabaseError(error, 'Unable to load incident details.') : undefined,
      };
    }

    return { incident: mapRowToSupportIncident(data) };
  } catch (err: unknown) {
    return {
      incident: null,
      error: formatSupabaseError(err, 'Unable to load incident details.'),
    };
  }
}

export async function reportSupportIncidentInSupabase(input: {
  businessId?: string;
  businessName?: string;
  source?: SupportIncident['source'];
  severity?: SupportIncident['severity'];
  title: string;
  description: string;
  errorCode?: string;
}): Promise<{ success: boolean; incidentId?: string; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not connected.' };
  }

  try {
    const { data, error } = await client.functions.invoke('report-support-incident', {
      body: {
        businessId: input.businessId ? toBigIntId(input.businessId) : null,
        businessName: input.businessName || null,
        source: input.source || 'technical_error',
        severity: input.severity || 'high',
        title: input.title,
        description: input.description,
        errorCode: input.errorCode || null,
      },
    });

    if (error) {
      return { success: false, error: error.message || 'Unable to invoke incident reporter.' };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Incident could not be recorded.' };
    }

    return {
      success: true,
      incidentId: data.incidentId ? String(data.incidentId) : undefined,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to record technical incident.',
    };
  }
}

export async function updatePlatformIncidentStatusInSupabase(
  incidentId: string,
  status: IncidentStatus
): Promise<{ success: boolean; incident?: SupportIncident; error?: string }> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(incidentId)) {
    return { success: false, error: 'Invalid incident reference.' };
  }

  try {
    const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
    const { data, error } = await client
      .from('support_incidents')
      .update({ status, resolved_at: resolvedAt })
      .eq('id', incidentId)
      .select('*')
      .single();

    if (error || !data) {
      return {
        success: false,
        error: formatSupabaseError(error, 'Unable to update incident status.'),
      };
    }

    return {
      success: true,
      incident: mapRowToSupportIncident(data),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: formatSupabaseError(err, 'Unable to update incident status.'),
    };
  }
}

// -----------------------------------------------------------------------------
// Booking RPC & Insertion (Respecting existing PostgreSQL functions)
// -----------------------------------------------------------------------------

export interface BookingPayload {
  businessId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerLanguage: 'en' | 'es';
  serviceId: string;
  serviceName: string;
  staffId?: string;
  staffName?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  durationMinutes: number;
  price: number;
  locationType: LocationType;
  address?: string;
  notes?: string;
  source?: string;
  timezone?: string;
}

// -----------------------------------------------------------------------------
// Booking RPC (Authorized RPC ONLY — No direct table insert fallback)
// -----------------------------------------------------------------------------

const inFlightBookingKeys = new Set<string>();

export function sanitizeDatabaseError(rawError?: string | null, lang: 'en' | 'es' = 'en'): string {
  return sanitizeErrorForBusiness(rawError, lang).userMessage;
}

export async function createCustomerInSupabase(
  businessId: string,
  custData: {
    name: string;
    phone: string;
    email?: string;
    preferredLanguage: 'en' | 'es';
    address?: string;
    notes?: string;
  }
): Promise<{ success: boolean; customer?: Customer; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not connected.' };
  }

  const businessIdNum = toBigIntId(businessId);
  if (!businessIdNum) {
    return { success: false, error: `Invalid business ID (${businessId}): expected a positive BIGINT.` };
  }

  try {
    const { data, error } = await client
      .from('customers')
      .insert({
        business_id: businessIdNum,
        name: custData.name.trim(),
        phone: custData.phone.trim(),
        email: custData.email?.trim() || null,
        preferred_language: custData.preferredLanguage,
        address: custData.address?.trim() || null,
        notes: custData.notes?.trim() || null,
      })
      .select()
      .single();

    if (error || !data) {
      return {
        success: false,
        error: formatSupabaseError(error, 'Failed to create customer record in Supabase.'),
      };
    }

    const mapped = mapRowToCustomer(data);
    if (!isValidUuid(mapped.id)) {
      return {
        success: false,
        error: `Created customer returned invalid UUID id: ${mapped.id}`,
      };
    }

    return { success: true, customer: mapped };
  } catch (err: unknown) {
    return {
      success: false,
      error: formatSupabaseError(err, 'Unexpected error creating customer in Supabase.'),
    };
  }
}

export async function checkAvailabilityInSupabase(params: {
  businessId: string;
  serviceId: string;
  date: string;
  startTime: string;
  timezone?: string;
  excludeAppointmentId?: string;
}): Promise<{ available: boolean; error?: string; reason?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { available: false, error: 'Supabase client is not connected.' };
  }

  const businessIdNum = toBigIntId(params.businessId);
  if (!businessIdNum) {
    return { available: false, error: `Invalid business ID (${params.businessId}): expected a positive BIGINT.` };
  }

  if (!isValidUuid(params.serviceId)) {
    return { available: false, error: `Invalid service ID (${params.serviceId}): expected a valid UUID.` };
  }

  const startTimeIso = buildIsoTimestampInTimezone(params.date, params.startTime, params.timezone);

  try {
    // When rescheduling (excludeAppointmentId) or when deployed, check_scheduling_availability
    // evaluates operatingHours, specialHours, active service, and bufferBetweenAppointmentsMinutes.
    if (typeof client.rpc === 'function' && params.excludeAppointmentId && isValidUuid(params.excludeAppointmentId)) {
      const schedRes = await client.rpc('check_scheduling_availability', {
        p_business_id: businessIdNum,
        p_service_id: params.serviceId.trim(),
        p_start_time: startTimeIso,
        p_exclude_appointment_id: params.excludeAppointmentId.trim(),
      });

      if (!schedRes.error && schedRes.data && typeof schedRes.data === 'object') {
        const available = Boolean((schedRes.data as any).available);
        const reason = typeof (schedRes.data as any).reason === 'string' ? (schedRes.data as any).reason : undefined;
        return {
          available,
          reason,
          error: !available && reason ? reason : undefined,
        };
      }
      // Fall through if check_scheduling_availability has not been deployed yet (PGRST202)
      if (
        schedRes.error &&
        schedRes.error.code !== 'PGRST202' &&
        !schedRes.error.message?.includes('Could not find the function')
      ) {
        return {
          available: false,
          error: formatSupabaseError(schedRes.error, 'Availability check failed.'),
        };
      }
    }

    let { data, error } = await client.rpc('check_availability', {
      p_business_id: businessIdNum,
      p_service_id: params.serviceId.trim(),
      p_start_time: startTimeIso,
    });

    // If PostgreSQL signature uses unprefixed parameter names, retry once on PGRST202
    if (error && (error.code === 'PGRST202' || error.message?.includes('Could not find the function'))) {
      const retry = await client.rpc('check_availability', {
        business_id: businessIdNum,
        service_id: params.serviceId.trim(),
        start_time: startTimeIso,
      });
      if (!retry.error) {
        data = retry.data;
        error = null;
      } else {
        error = retry.error;
      }
    }

    if (error) {
      return {
        available: false,
        error: formatSupabaseError(error, 'Availability check RPC failed.'),
      };
    }

    if (data !== true) {
      return { available: false };
    }

    // Layer additive scheduling rules check when deployed (non-breaking if PGRST202)
    if (typeof client.rpc === 'function' && !params.excludeAppointmentId) {
      const schedRes = await client.rpc('check_scheduling_availability', {
        p_business_id: businessIdNum,
        p_service_id: params.serviceId.trim(),
        p_start_time: startTimeIso,
        p_exclude_appointment_id: null,
      });

      if (!schedRes.error && schedRes.data && typeof schedRes.data === 'object') {
        const available = Boolean((schedRes.data as any).available);
        const reason = typeof (schedRes.data as any).reason === 'string' ? (schedRes.data as any).reason : undefined;
        if (!available) {
          return { available: false, reason, error: reason };
        }
      }
    }

    return { available: true };
  } catch (err: unknown) {
    return {
      available: false,
      error: formatSupabaseError(err, 'Availability check RPC execution error.'),
    };
  }
}

export async function createBookingWithSupabase(payload: BookingPayload): Promise<{ success: boolean; appointment?: Appointment; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not connected.' };
  }

  const businessIdNum = toBigIntId(payload.businessId);
  if (!businessIdNum) {
    return { success: false, error: `Invalid p_business_id (${payload.businessId}): expected a positive BIGINT.` };
  }

  // Strictly enforce UUID for p_customer_id (never accept name, phone, email, or placeholder IDs)
  if (!isValidUuid(payload.customerId)) {
    return {
      success: false,
      error: `Invalid p_customer_id ("${payload.customerId || ''}"): must be an existing customer UUID from Supabase.`,
    };
  }

  if (!isValidUuid(payload.serviceId)) {
    return {
      success: false,
      error: `Invalid p_service_id ("${payload.serviceId || ''}"): must be a valid service UUID.`,
    };
  }

  if (!payload.date || !payload.startTime) {
    return { success: false, error: 'Appointment date and start time are required.' };
  }

  // Prevent duplicate concurrent submissions for the exact same slot
  const dedupeKey = `${businessIdNum}|${payload.customerId}|${payload.serviceId}|${payload.date}|${payload.startTime}`;
  if (inFlightBookingKeys.has(dedupeKey)) {
    return { success: false, error: 'Booking request is already in progress. Please wait.' };
  }

  inFlightBookingKeys.add(dedupeKey);

  try {
    // 1. Ensure the customer exists in public.customers for this business before attempting to book
    const { data: existingCustomer, error: customerLookupError } = await client
      .from('customers')
      .select('id, business_id')
      .eq('id', payload.customerId.trim())
      .eq('business_id', businessIdNum)
      .maybeSingle();

    if (customerLookupError) {
      return {
        success: false,
        error: formatSupabaseError(customerLookupError, 'Failed to verify customer record before booking.'),
      };
    }

    if (!existingCustomer) {
      return {
        success: false,
        error: `Customer UUID ${payload.customerId} does not exist for business #${businessIdNum}. Save or select a valid customer before booking.`,
      };
    }

    // 1b. Verify service exists for this business and is active before booking
    const { data: existingService, error: serviceLookupError } = await client
      .from('services')
      .select('id, business_id, is_active, active')
      .eq('id', payload.serviceId.trim())
      .eq('business_id', businessIdNum)
      .maybeSingle();

    let resolvedService = existingService;
    let resolvedServiceError = serviceLookupError;
    if (
      resolvedServiceError &&
      (resolvedServiceError.code === '42703' ||
        resolvedServiceError.code === 'PGRST204' ||
        resolvedServiceError.message?.toLowerCase().includes('is_active') ||
        resolvedServiceError.message?.toLowerCase().includes('active'))
    ) {
      const retrySvc = await client
        .from('services')
        .select('*')
        .eq('id', payload.serviceId.trim())
        .eq('business_id', businessIdNum)
        .maybeSingle();
      resolvedService = retrySvc.data;
      resolvedServiceError = retrySvc.error;
    }

    if (resolvedServiceError) {
      return {
        success: false,
        error: formatSupabaseError(resolvedServiceError, 'Failed to verify service status before booking.'),
      };
    }

    if (!resolvedService) {
      return {
        success: false,
        error: `Service UUID ${payload.serviceId} does not exist for business #${businessIdNum}.`,
      };
    }

    const isServiceActive =
      typeof (resolvedService as any).is_active === 'boolean'
        ? (resolvedService as any).is_active
        : (resolvedService as any).active !== undefined
        ? (resolvedService as any).active !== false
        : true;

    if (!isServiceActive) {
      return {
        success: false,
        error: 'Inactive services cannot be booked. Please reactivate the service before scheduling.',
      };
    }

    // 2. Check availability via existing RPC before booking
    const availability = await checkAvailabilityInSupabase({
      businessId: String(businessIdNum),
      serviceId: payload.serviceId,
      date: payload.date,
      startTime: payload.startTime,
      timezone: payload.timezone,
    });

    if (availability.error) {
      return { success: false, error: availability.error };
    }

    if (!availability.available) {
      return {
        success: false,
        error: 'Selected time slot is unavailable according to Supabase check_availability.',
      };
    }

    // 3. Call production public.book_appointment with exact parameter names & types (RETURNS UUID)
    const startTimeIso = buildIsoTimestampInTimezone(payload.date, payload.startTime, payload.timezone);
    const locationAddress = payload.locationType === 'at_home' ? (payload.address?.trim() || null) : null;
    const notesText = payload.notes?.trim() || null;

    const { data: rpcUuid, error: rpcError } = await client.rpc('book_appointment', {
      p_business_id: businessIdNum,
      p_customer_id: payload.customerId.trim(),
      p_service_id: payload.serviceId.trim(),
      p_start_time: startTimeIso,
      p_location_type: payload.locationType,
      p_location_address: locationAddress,
      p_notes: notesText,
    });

    if (rpcError) {
      return {
        success: false,
        error: formatSupabaseError(rpcError, 'book_appointment RPC failed.'),
      };
    }

    const createdId = typeof rpcUuid === 'string'
      ? rpcUuid
      : (rpcUuid && typeof rpcUuid === 'object' && 'id' in (rpcUuid as any) ? String((rpcUuid as any).id) : String(rpcUuid || ''));

    if (!createdId || !isValidUuid(createdId)) {
      return {
        success: false,
        error: `book_appointment did not return a valid appointment UUID (received: ${JSON.stringify(rpcUuid)}).`,
      };
    }

    // 4. Hydrate the newly created appointment row using the returned UUID
    const { data: createdRow } = await client
      .from('appointments')
      .select('*')
      .eq('id', createdId)
      .eq('business_id', businessIdNum)
      .maybeSingle();

    if (createdRow) {
      const mapped = mapRowToAppointment(createdRow, payload.timezone);
      return {
        success: true,
        appointment: {
          ...mapped,
          customerName: mapped.customerName !== 'Customer' ? mapped.customerName : payload.customerName,
          customerPhone: mapped.customerPhone || payload.customerPhone,
          customerLanguage: mapped.customerLanguage || payload.customerLanguage,
          serviceName: mapped.serviceName !== 'Service' ? mapped.serviceName : payload.serviceName,
          price: mapped.price || payload.price,
        },
      };
    }

    const startTimeIsoFallback = buildIsoTimestampInTimezone(payload.date, payload.startTime, payload.timezone);
    const endTimeIsoFallback = payload.endTime
      ? buildIsoTimestampInTimezone(payload.date, payload.endTime, payload.timezone)
      : undefined;

    // Preserve authoritative server status; if immediate SELECT is deferred, default to 'pending' until fetched
    return {
      success: true,
      appointment: {
        id: createdId,
        tenantId: String(businessIdNum),
        customerId: payload.customerId.trim(),
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerLanguage: payload.customerLanguage,
        serviceId: payload.serviceId.trim(),
        serviceName: payload.serviceName,
        staffId: payload.staffId,
        staffName: payload.staffName,
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        rawStartTime: startTimeIsoFallback,
        rawEndTime: endTimeIsoFallback,
        durationMinutes: calculateAppointmentDurationMinutes(payload.startTime, payload.endTime),
        price: payload.price,
        locationType: payload.locationType,
        address: locationAddress || undefined,
        status: 'pending',
        notes: notesText || undefined,
        source: (payload.source as Appointment['source']) || 'manual_dashboard',
        createdAt: new Date().toISOString(),
      },
    };
  } catch (err: unknown) {
    return { success: false, error: formatSupabaseError(err, 'Booking RPC execution error.') };
  } finally {
    inFlightBookingKeys.delete(dedupeKey);
  }
}

export async function cancelAppointmentInSupabase(
  businessId: string,
  appointmentId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  const businessIdNum = toBigIntId(businessId);
  if (!businessIdNum) {
    return { success: false, error: `Invalid business ID (${businessId}): expected a positive BIGINT.` };
  }
  if (!isValidUuid(appointmentId)) {
    return { success: false, error: `Invalid appointment ID (${appointmentId}): expected a valid UUID.` };
  }

  try {
    let { data, error } = await client.rpc('cancel_appointment', {
      p_business_id: businessIdNum,
      p_appointment_id: appointmentId.trim(),
    });

    if (error && (error.code === 'PGRST202' || error.message?.includes('Could not find the function'))) {
      const retry = await client.rpc('cancel_appointment', {
        business_id: businessIdNum,
        appointment_id: appointmentId.trim(),
      });
      if (!retry.error) {
        data = retry.data;
        error = null;
      } else {
        error = retry.error;
      }
    }

    if (error) {
      return { success: false, error: formatSupabaseError(error, 'cancel_appointment RPC failed.') };
    }

    if (data === false) {
      return {
        success: false,
        error: 'cancel_appointment returned false (appointment may not exist or cannot be cancelled).',
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: formatSupabaseError(err, 'cancel_appointment RPC execution error.') };
  }
}

const VALID_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
];

export async function updateAppointmentStatusInSupabase(
  appointmentId: string,
  status: string,
  businessId?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  const businessIdNum = toBigIntId(businessId);
  if (!businessIdNum) {
    return { success: false, error: 'Invalid or missing business_id for appointment status update.' };
  }

  if (!VALID_APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return { success: false, error: `Invalid appointment status: ${status}` };
  }

  let { error } = await client
    .from('appointments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', toDbId(appointmentId))
    .eq('business_id', businessIdNum);

  if (error && (error.code === '42703' || error.message?.toLowerCase().includes('updated_at'))) {
    const retry = await client
      .from('appointments')
      .update({ status })
      .eq('id', toDbId(appointmentId))
      .eq('business_id', businessIdNum);
    error = retry.error;
  }

  if (error) {
    return { success: false, error: formatSupabaseError(error, 'Failed to update appointment status.') };
  }
  return { success: true };
}

export async function rescheduleAppointmentInSupabase(
  appointmentId: string,
  newDate: string,
  newStartTime: string,
  newEndTime: string,
  timeZone?: string,
  preserveStatus?: AppointmentStatus,
  businessId?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client is not connected.' };

  const businessIdNum = toBigIntId(businessId);
  if (!businessIdNum) {
    return { success: false, error: 'Invalid or missing business_id for appointment reschedule.' };
  }
  if (!isValidUuid(appointmentId)) {
    return { success: false, error: 'Invalid appointment ID for reschedule.' };
  }

  const startTimeIso = buildIsoTimestampInTimezone(newDate, newStartTime, timeZone);
  const endTimeIso = buildIsoTimestampInTimezone(newDate, newEndTime, timeZone);

  if (typeof client.rpc === 'function') {
    const { data: rpcData, error: rpcError } = await client.rpc('reschedule_appointment', {
      p_business_id: businessIdNum,
      p_appointment_id: appointmentId.trim(),
      p_new_start_time: startTimeIso,
      p_new_end_time: endTimeIso,
    });

    if (!rpcError) {
      if (rpcData && typeof rpcData === 'object' && (rpcData as any).success === false) {
        return {
          success: false,
          error: (rpcData as any).error || 'Failed to reschedule appointment.',
        };
      }
      return { success: true };
    }

    const isMissingRpc =
      rpcError.code === 'PGRST202' ||
      rpcError.message?.includes('Could not find the function');
    if (!isMissingRpc) {
      return {
        success: false,
        error: formatSupabaseError(rpcError, 'Failed to reschedule appointment.'),
      };
    }
  }

  const safeStatus =
    preserveStatus && VALID_APPOINTMENT_STATUSES.includes(preserveStatus)
      ? preserveStatus
      : undefined;
  const statusFields = safeStatus ? { status: safeStatus } : {};

  let { error } = await client
    .from('appointments')
    .update({
      date: newDate,
      start_time: newStartTime,
      end_time: newEndTime,
      ...statusFields,
      updated_at: new Date().toISOString(),
    })
    .eq('id', toDbId(appointmentId))
    .eq('business_id', businessIdNum);

  if (error && (error.code === '42703' || error.code === '22007' || error.message?.toLowerCase().includes('timestamptz') || error.message?.toLowerCase().includes('date'))) {
    const retry = await client
      .from('appointments')
      .update({
        start_time: startTimeIso,
        end_time: endTimeIso,
        ...statusFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', toDbId(appointmentId))
      .eq('business_id', businessIdNum);
    error = retry.error;
  }

  if (error) {
    return { success: false, error: formatSupabaseError(error, 'Failed to reschedule appointment.') };
  }
  return { success: true };
}

// -----------------------------------------------------------------------------
// Realtime Updates Subscription & Cleanup
// -----------------------------------------------------------------------------

export interface RealtimeAppointmentChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  businessId: string;
  appointmentId?: string;
  newStatus?: string;
  oldStatus?: string;
}

export function subscribeToAppointmentsRealtime(
  businessId: string,
  onUpdate: (change: RealtimeAppointmentChange) => void,
  onStatusChange?: (status: string) => void
): RealtimeChannel | null {
  const client = getSupabaseClient();
  if (!client || !businessId) return null;

  try {
    const channel = client
      .channel(`realtime:appointments:${businessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `business_id=eq.${businessId}`,
        },
        (payload: any) => {
          const newRow = payload?.new as Record<string, any> | undefined;
          const oldRow = payload?.old as Record<string, any> | undefined;
          onUpdate({
            eventType: payload?.eventType || 'UPDATE',
            businessId,
            appointmentId: newRow?.id ? String(newRow.id) : oldRow?.id ? String(oldRow.id) : undefined,
            newStatus: newRow?.status ? String(newRow.status) : undefined,
            oldStatus: oldRow?.status ? String(oldRow.status) : undefined,
          });
        }
      )
      .subscribe((status: string) => {
        onStatusChange?.(String(status));
      });

    return channel;
  } catch (err) {
    console.warn('Realtime subscription error:', err);
    return null;
  }
}

/**
 * Super Admin-only aggregate metrics listener (head-count refresh only).
 * Never surfaces individual customer names or routine booking notifications.
 */
export function subscribeToPlatformAppointmentsCountRealtime(onAggregateChange: () => void): RealtimeChannel | null {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const channel = client
      .channel('realtime:platform:appointments-aggregate')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
        },
        () => {
          onAggregateChange();
        }
      )
      .subscribe();

    return channel;
  } catch (err) {
    console.warn('Platform aggregate realtime subscription error:', err);
    return null;
  }
}

export async function unsubscribeRealtimeChannel(channel: RealtimeChannel | null): Promise<void> {
  if (!channel) return;
  const client = getSupabaseClient();
  try {
    if (client) {
      await client.removeChannel(channel);
    } else {
      await channel.unsubscribe();
    }
  } catch (err) {
    console.warn('Error cleaning up realtime channel:', err);
  }
}

export async function removeAllRealtimeChannels(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.removeAllChannels();
  } catch (err) {
    console.warn('Error removing all realtime channels:', err);
  }
}

export interface SupportRealtimeSubscriptionSpec {
  channelName: string;
  subscriptions: Array<{
    table:
      | 'business_support_tickets'
      | 'support_ticket_messages'
      | 'support_notifications'
      | 'support_incidents';
    event: '*' | 'INSERT' | 'UPDATE';
    filter?: string;
  }>;
}

export function buildSupportRealtimeSubscriptions(options: {
  isSuperAdmin: boolean;
  businessId?: string;
}): SupportRealtimeSubscriptionSpec | null {
  if (options.isSuperAdmin) {
    return {
      channelName: 'realtime:support:super-admin',
      subscriptions: [
        { table: 'business_support_tickets', event: '*' },
        { table: 'support_ticket_messages', event: 'INSERT' },
        { table: 'support_notifications', event: '*', filter: 'target_role=eq.super_admin' },
        { table: 'support_incidents', event: '*' },
      ],
    };
  }

  const bizIdNum = options.businessId ? toBigIntId(options.businessId) : null;
  if (!bizIdNum) {
    return null;
  }

  return {
    channelName: `realtime:support:business:${bizIdNum}`,
    subscriptions: [
      { table: 'business_support_tickets', event: '*', filter: `business_id=eq.${bizIdNum}` },
      { table: 'support_ticket_messages', event: 'INSERT', filter: `business_id=eq.${bizIdNum}` },
      { table: 'support_notifications', event: '*', filter: `business_id=eq.${bizIdNum}` },
    ],
  };
}

export interface SupportRealtimeCallbacks {
  onTicketChange?: (payload: { eventType: string; ticket?: SupportTicket; oldId?: string }) => void;
  onMessageInsert?: (message: SupportTicketMessage) => void;
  onNotificationChange?: (payload: {
    eventType: string;
    notification?: SupportNotification;
    oldId?: string;
  }) => void;
  onIncidentChange?: (payload: {
    eventType: string;
    incident?: SupportIncident;
    oldId?: string;
  }) => void;
}

export function subscribeToSupportSystemRealtime(
  options: { isSuperAdmin: boolean; businessId?: string },
  callbacks: SupportRealtimeCallbacks
): RealtimeChannel | null {
  const client = getSupabaseClient();
  const spec = buildSupportRealtimeSubscriptions(options);
  if (!client || !spec) return null;

  try {
    let channel = client.channel(spec.channelName);

    for (const sub of spec.subscriptions) {
      const pgConfig: {
        event: '*' | 'INSERT' | 'UPDATE';
        schema: 'public';
        table: string;
        filter?: string;
      } = {
        event: sub.event,
        schema: 'public',
        table: sub.table,
      };
      if (sub.filter) {
        pgConfig.filter = sub.filter;
      }

      channel = channel.on('postgres_changes', pgConfig as any, (payload: any) => {
        const eventType = String(payload?.eventType || 'UPDATE');
        const newRow = payload?.new as Record<string, any> | undefined;
        const oldRow = payload?.old as Record<string, any> | undefined;

        if (sub.table === 'business_support_tickets') {
          callbacks.onTicketChange?.({
            eventType,
            ticket: newRow && newRow.id ? mapRowToSupportTicket(newRow) : undefined,
            oldId: oldRow?.id ? String(oldRow.id) : undefined,
          });
        } else if (sub.table === 'support_ticket_messages') {
          if (newRow && newRow.id) {
            callbacks.onMessageInsert?.(mapRowToSupportMessage(newRow));
          }
        } else if (sub.table === 'support_notifications') {
          const notif = newRow && newRow.id ? mapRowToSupportNotification(newRow) : undefined;
          // Enforce role & tenant guard on client even before UI filtering
          if (notif) {
            if (options.isSuperAdmin && notif.targetRole !== 'super_admin') return;
            if (
              !options.isSuperAdmin &&
              (notif.targetRole !== 'business' ||
                !options.businessId ||
                notif.businessId !== String(options.businessId))
            ) {
              return;
            }
          }
          callbacks.onNotificationChange?.({
            eventType,
            notification: notif,
            oldId: oldRow?.id ? String(oldRow.id) : undefined,
          });
        } else if (sub.table === 'support_incidents' && options.isSuperAdmin) {
          callbacks.onIncidentChange?.({
            eventType,
            incident: newRow && newRow.id ? mapRowToSupportIncident(newRow) : undefined,
            oldId: oldRow?.id ? String(oldRow.id) : undefined,
          });
        }
      });
    }

    channel.subscribe();
    return channel;
  } catch (err) {
    console.warn('Support realtime subscription error:', err);
    return null;
  }
}

function isMissingTableError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

export function mapRowToSupportTicket(row: any): SupportTicket {
  const bizRel = Array.isArray(row?.businesses) ? row.businesses[0] : row?.businesses;
  return {
    id: String(row?.id || ''),
    businessId: row?.business_id != null ? String(row.business_id) : '',
    businessName: typeof bizRel?.name === 'string' ? bizRel.name : (typeof row?.business_name === 'string' ? row.business_name : undefined),
    createdBy: row?.created_by != null ? String(row.created_by) : undefined,
    createdByName:
      typeof row?.created_by_name === 'string' && row.created_by_name.trim()
        ? row.created_by_name.trim()
        : undefined,
    category: (row?.category || 'general_question') as SupportTicketCategory,
    subject: typeof row?.subject === 'string' ? row.subject : 'Support Request',
    description: typeof row?.description === 'string' ? row.description : '',
    priority: (row?.priority || 'medium') as SupportTicketPriority,
    status: (row?.status || 'open') as SupportTicketStatus,
    lastMessageAt: row?.last_message_at || row?.updated_at || row?.created_at || new Date().toISOString(),
    unreadByBusiness: Boolean(row?.unread_by_business),
    unreadByAdmin: Boolean(row?.unread_by_admin),
    createdAt: row?.created_at || new Date().toISOString(),
    updatedAt: row?.updated_at || row?.created_at || new Date().toISOString(),
  };
}

export function mapRowToSupportMessage(row: any): SupportTicketMessage {
  return {
    id: String(row?.id || ''),
    ticketId: String(row?.ticket_id || ''),
    businessId: row?.business_id != null ? String(row.business_id) : '',
    senderId: row?.sender_id != null ? String(row.sender_id) : undefined,
    senderRole: (row?.sender_role || 'business_owner') as SupportTicketMessage['senderRole'],
    senderName: typeof row?.sender_name === 'string' ? row.sender_name : undefined,
    message: typeof row?.message === 'string' ? row.message : '',
    createdAt: row?.created_at || new Date().toISOString(),
  };
}

export function mapRowToSupportNotification(row: any): SupportNotification {
  return {
    id: String(row?.id || ''),
    businessId: row?.business_id != null ? String(row.business_id) : undefined,
    targetRole: row?.target_role === 'super_admin' ? 'super_admin' : 'business',
    ticketId: row?.ticket_id != null ? String(row.ticket_id) : undefined,
    incidentId: row?.incident_id != null ? String(row.incident_id) : undefined,
    title: String(row?.title || ''),
    body: String(row?.body || ''),
    isRead: Boolean(row?.is_read),
    createdAt: row?.created_at || new Date().toISOString(),
  };
}

export function mapRowToSupportTicketStatusHistory(row: any): SupportTicketStatusHistoryEntry {
  return {
    id: String(row?.id || ''),
    ticketId: String(row?.ticket_id || ''),
    changedBy: row?.changed_by != null ? String(row.changed_by) : undefined,
    oldStatus:
      typeof row?.old_status === 'string' && row.old_status
        ? (row.old_status as SupportTicketStatus)
        : null,
    newStatus: (row?.new_status || 'open') as SupportTicketStatus,
    createdAt: row?.created_at || new Date().toISOString(),
  };
}

export async function fetchSupportTicketsInSupabase(options?: {
  businessId?: string;
  status?: SupportTicketStatus | 'all';
  priority?: SupportTicketPriority | 'all';
  category?: SupportTicketCategory | 'all';
  limit?: number;
  offset?: number;
}): Promise<{
  tickets: SupportTicket[];
  tableExists: boolean;
  totalCount: number;
  hasMore: boolean;
  error?: string;
  technicalDetail?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      tickets: [],
      tableExists: false,
      totalCount: 0,
      hasMore: false,
      error: 'Connection unavailable.',
    };
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  try {
    let query = client
      .from('business_support_tickets')
      .select('*, businesses(name)', { count: 'exact' })
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (options?.businessId && options.businessId !== 'all') {
      const bizIdNum = toBigIntId(options.businessId);
      if (!bizIdNum) {
        return { tickets: [], tableExists: true, totalCount: 0, hasMore: false };
      }
      query = query.eq('business_id', bizIdNum);
    }

    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status);
    }
    if (options?.priority && options.priority !== 'all') {
      query = query.eq('priority', options.priority);
    }
    if (options?.category && options.category !== 'all') {
      query = query.eq('category', options.category);
    }

    const { data, error, count } = await query;

    if (error) {
      if (isMissingTableError(error)) {
        return { tickets: [], tableExists: false, totalCount: 0, hasMore: false };
      }
      const sanitized = sanitizeErrorForBusiness(error);
      return {
        tickets: [],
        tableExists: true,
        totalCount: 0,
        hasMore: false,
        error: sanitized.userMessage,
        technicalDetail: sanitized.technicalDetail,
      };
    }

    const mapped = (data || []).map(mapRowToSupportTicket);
    const totalCount = typeof count === 'number' ? count : offset + mapped.length;
    const hasMore =
      typeof count === 'number' ? offset + mapped.length < count : mapped.length === limit;

    return {
      tickets: mapped,
      tableExists: true,
      totalCount,
      hasMore,
    };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err);
    return {
      tickets: [],
      tableExists: false,
      totalCount: 0,
      hasMore: false,
      error: sanitized.userMessage,
      technicalDetail: sanitized.technicalDetail,
    };
  }
}

export async function fetchSupportTicketByIdInSupabase(ticketId: string): Promise<{
  ticket: SupportTicket | null;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(ticketId)) {
    return { ticket: null };
  }

  try {
    const { data, error } = await client
      .from('business_support_tickets')
      .select('*, businesses(name)')
      .eq('id', ticketId)
      .maybeSingle();

    if (error || !data) {
      return {
        ticket: null,
        error: error ? formatSupabaseError(error, 'Unable to load support ticket.') : undefined,
      };
    }

    return { ticket: mapRowToSupportTicket(data) };
  } catch (err) {
    return {
      ticket: null,
      error: formatSupabaseError(err, 'Unable to load support ticket.'),
    };
  }
}

export async function fetchSupportTicketStatusHistoryInSupabase(ticketId: string): Promise<{
  history: SupportTicketStatusHistoryEntry[];
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(ticketId)) {
    return { history: [] };
  }

  try {
    const { data, error } = await client
      .from('support_ticket_status_history')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingTableError(error)) return { history: [] };
      const sanitized = sanitizeErrorForBusiness(error);
      return { history: [], error: sanitized.userMessage };
    }

    return { history: (data || []).map(mapRowToSupportTicketStatusHistory) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err);
    return { history: [], error: sanitized.userMessage };
  }
}

export async function createSupportTicketInSupabase(input: {
  businessId: string;
  category: SupportTicketCategory;
  subject: string;
  description: string;
  priority: SupportTicketPriority;
  senderName?: string;
}): Promise<{ success: boolean; ticket?: SupportTicket; error?: string; technicalDetail?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Unable to submit right now.' };

  const businessIdNum = toBigIntId(input.businessId);
  if (!businessIdNum) {
    return { success: false, error: 'Please select an active business first.' };
  }

  try {
    const { data, error } = await client
      .from('business_support_tickets')
      .insert({
        business_id: businessIdNum,
        category: input.category,
        subject: input.subject.trim(),
        description: input.description.trim(),
        priority: input.priority,
      })
      .select('*, businesses(name)')
      .single();

    if (error || !data) {
      const sanitized = sanitizeErrorForBusiness(error);
      return { success: false, error: sanitized.userMessage, technicalDetail: sanitized.technicalDetail };
    }

    return { success: true, ticket: mapRowToSupportTicket(data) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err);
    return { success: false, error: sanitized.userMessage, technicalDetail: sanitized.technicalDetail };
  }
}

export async function fetchSupportTicketMessagesInSupabase(ticketId: string): Promise<{
  messages: SupportTicketMessage[];
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(ticketId)) {
    return { messages: [] };
  }

  try {
    const { data, error } = await client
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingTableError(error)) return { messages: [] };
      const sanitized = sanitizeErrorForBusiness(error);
      return { messages: [], error: sanitized.userMessage };
    }

    return { messages: (data || []).map(mapRowToSupportMessage) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err);
    return { messages: [], error: sanitized.userMessage };
  }
}

export async function sendSupportTicketMessageInSupabase(input: {
  ticketId: string;
  businessId: string;
  senderRole: 'business_owner' | 'business_staff' | 'super_admin';
  senderName?: string;
  message: string;
}): Promise<{ success: boolean; messageRecord?: SupportTicketMessage; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Connection unavailable.' };

  const businessIdNum = toBigIntId(input.businessId);
  if (!businessIdNum || !isValidUuid(input.ticketId)) {
    return { success: false, error: 'Invalid support request reference.' };
  }

  try {
    const { data, error } = await client
      .from('support_ticket_messages')
      .insert({
        ticket_id: input.ticketId,
        business_id: businessIdNum,
        sender_role: input.senderRole,
        sender_name: input.senderName || null,
        message: input.message.trim(),
      })
      .select('*')
      .single();

    if (error || !data) {
      const sanitized = sanitizeErrorForBusiness(error);
      return { success: false, error: sanitized.userMessage };
    }

    return { success: true, messageRecord: mapRowToSupportMessage(data) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err);
    return { success: false, error: sanitized.userMessage };
  }
}

export async function updateSupportTicketStatusInSupabase(
  ticketId: string,
  status: SupportTicketStatus
): Promise<{ success: boolean; ticket?: SupportTicket; error?: string }> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(ticketId)) {
    return { success: false, error: 'Invalid support request.' };
  }

  try {
    const { data, error } = await client
      .from('business_support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', ticketId)
      .select('*, businesses(name)')
      .single();

    if (error || !data) {
      const sanitized = sanitizeErrorForBusiness(error);
      return { success: false, error: sanitized.userMessage };
    }

    return { success: true, ticket: mapRowToSupportTicket(data) };
  } catch (err) {
    const sanitized = sanitizeErrorForBusiness(err);
    return { success: false, error: sanitized.userMessage };
  }
}

export async function markSupportTicketReadInSupabase(
  ticketId: string,
  viewerRole: 'business' | 'super_admin',
  businessId?: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(ticketId)) return;

  try {
    const updatePatch =
      viewerRole === 'super_admin'
        ? { unread_by_admin: false }
        : { unread_by_business: false };
    await client
      .from('business_support_tickets')
      .update(updatePatch)
      .eq('id', ticketId);

    // Explicitly synchronize matching support_notifications for both hardened triggers & older schemas
    let notifQuery = client
      .from('support_notifications')
      .update({ is_read: true })
      .eq('ticket_id', ticketId)
      .eq('target_role', viewerRole)
      .eq('is_read', false);

    if (viewerRole === 'business' && businessId) {
      const bizIdNum = toBigIntId(businessId);
      if (bizIdNum) {
        notifQuery = notifQuery.eq('business_id', bizIdNum);
      }
    }

    await notifQuery;
  } catch {
    // Non-blocking read receipt
  }
}

export async function fetchSupportNotificationsInSupabase(options: {
  targetRole: 'business' | 'super_admin';
  businessId?: string;
}): Promise<{ notifications: SupportNotification[]; tableExists: boolean }> {
  const client = getSupabaseClient();
  if (!client) return { notifications: [], tableExists: false };

  try {
    let query = client
      .from('support_notifications')
      .select('*')
      .eq('target_role', options.targetRole)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (options.targetRole === 'business') {
      const bizIdNum = options.businessId ? toBigIntId(options.businessId) : null;
      if (!bizIdNum) return { notifications: [], tableExists: true };
      query = query.eq('business_id', bizIdNum);
    }

    const { data, error } = await query;
    if (error) {
      return { notifications: [], tableExists: !isMissingTableError(error) };
    }

    return {
      tableExists: true,
      notifications: (data || []).map(mapRowToSupportNotification),
    };
  } catch {
    return { notifications: [], tableExists: false };
  }
}

export async function markSupportNotificationReadByIdInSupabase(
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client || !isValidUuid(notificationId)) {
    return { success: false, error: 'Invalid notification reference.' };
  }

  try {
    const { error } = await client
      .from('support_notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('is_read', false);

    if (error) {
      return { success: false, error: formatSupabaseError(error, 'Unable to mark notification read.') };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: formatSupabaseError(err, 'Unable to mark notification read.') };
  }
}

export async function markSupportNotificationsReadInSupabase(options: {
  targetRole: 'business' | 'super_admin';
  businessId?: string;
  ticketId?: string;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    let query = client
      .from('support_notifications')
      .update({ is_read: true })
      .eq('target_role', options.targetRole)
      .eq('is_read', false);

    if (options.ticketId && isValidUuid(options.ticketId)) {
      query = query.eq('ticket_id', options.ticketId);
    }

    let bizIdNum: number | null = null;
    if (options.targetRole === 'business') {
      bizIdNum = options.businessId ? toBigIntId(options.businessId) : null;
      if (!bizIdNum) return;
      query = query.eq('business_id', bizIdNum);
    }

    await query;

    // Keep linked ticket unread flag aligned if clearing all notifications for a ticket or role
    if (options.ticketId && isValidUuid(options.ticketId)) {
      await client
        .from('business_support_tickets')
        .update(
          options.targetRole === 'super_admin'
            ? { unread_by_admin: false }
            : { unread_by_business: false }
        )
        .eq('id', options.ticketId);
    } else if (options.targetRole === 'super_admin') {
      await client
        .from('business_support_tickets')
        .update({ unread_by_admin: false })
        .eq('unread_by_admin', true);
    } else if (bizIdNum) {
      await client
        .from('business_support_tickets')
        .update({ unread_by_business: false })
        .eq('business_id', bizIdNum)
        .eq('unread_by_business', true);
    }
  } catch {
    // Non-blocking
  }
}

// -----------------------------------------------------------------------------
// Release A: Persistent Booking Notifications & Per-User Read State
// -----------------------------------------------------------------------------

function normalizeBookingNotificationEventType(rawEvent?: string | null): BookingNotificationEventType {
  if (rawEvent === 'appointment_cancelled') return 'appointment_cancelled';
  if (rawEvent === 'appointment_rescheduled') return 'appointment_rescheduled';
  return 'appointment_confirmed';
}

export function mapRowToBookingNotification(
  row: any,
  currentUserId?: string
): BusinessNotification {
  const eventType = normalizeBookingNotificationEventType(row?.event_type);
  const type: BusinessNotification['type'] =
    eventType === 'appointment_cancelled'
      ? 'appointment_cancelled'
      : eventType === 'appointment_rescheduled'
      ? 'appointment_updated'
      : 'appointment_confirmed';

  const customerName =
    typeof row?.customer_name === 'string' && row.customer_name.trim()
      ? row.customer_name.trim()
      : 'Customer';
  const serviceName =
    typeof row?.service_name === 'string' && row.service_name.trim()
      ? row.service_name.trim()
      : 'Service';
  const appointmentDate =
    typeof row?.appointment_date === 'string' && row.appointment_date.trim()
      ? row.appointment_date.trim()
      : undefined;
  const appointmentStartTime =
    typeof row?.appointment_start_time === 'string' && row.appointment_start_time.trim()
      ? row.appointment_start_time.trim()
      : undefined;
  const appointmentEndTime =
    typeof row?.appointment_end_time === 'string' && row.appointment_end_time.trim()
      ? row.appointment_end_time.trim()
      : undefined;

  const rawReads = Array.isArray(row?.booking_notification_reads)
    ? row.booking_notification_reads
    : row?.booking_notification_reads && typeof row.booking_notification_reads === 'object'
    ? [row.booking_notification_reads]
    : [];

  const matchedRead = currentUserId
    ? rawReads.find((r: any) => !r?.user_id || String(r.user_id) === String(currentUserId))
    : rawReads[0];

  const isRead = Boolean(matchedRead);
  const title =
    eventType === 'appointment_cancelled'
      ? 'Booking Cancelled'
      : eventType === 'appointment_rescheduled'
      ? 'Booking Rescheduled'
      : 'Booking Confirmed';

  const scheduleLabel = appointmentDate
    ? appointmentStartTime
      ? `${appointmentDate} @ ${appointmentStartTime}`
      : appointmentDate
    : appointmentStartTime || '';

  const description = scheduleLabel
    ? `${customerName} · ${serviceName} (${scheduleLabel})`
    : `${customerName} · ${serviceName}`;

  return {
    id: String(row?.id || ''),
    businessId: row?.business_id != null ? String(row.business_id) : '',
    type,
    eventType,
    idempotencyKey:
      typeof row?.idempotency_key === 'string' && row.idempotency_key
        ? row.idempotency_key
        : undefined,
    title,
    description,
    appointmentId: row?.appointment_id != null ? String(row.appointment_id) : undefined,
    customerName,
    serviceName,
    appointmentDate,
    appointmentStartTime,
    appointmentEndTime,
    appointmentStatus: row?.appointment_status
      ? normalizeAppointmentStatus(row.appointment_status)
      : undefined,
    createdAt: row?.created_at || new Date().toISOString(),
    read: isRead,
    readAt: matchedRead?.read_at ? String(matchedRead.read_at) : undefined,
    readByUserId: matchedRead?.user_id
      ? String(matchedRead.user_id)
      : isRead && currentUserId
      ? currentUserId
      : undefined,
  };
}

export async function fetchAppointmentByIdInSupabase(
  businessId: string,
  appointmentId: string,
  timeZone?: string
): Promise<{ appointment: Appointment | null; error?: string }> {
  const client = getSupabaseClient();
  const bizIdNum = toBigIntId(businessId);
  if (!client || !bizIdNum || !isValidUuid(appointmentId)) {
    return { appointment: null };
  }

  try {
    const { data, error } = await client
      .from('appointments')
      .select('*')
      .eq('id', appointmentId.trim())
      .eq('business_id', bizIdNum)
      .maybeSingle();

    if (error || !data) {
      return {
        appointment: null,
        error: error ? formatSupabaseError(error, 'Unable to load appointment details.') : undefined,
      };
    }

    return { appointment: mapRowToAppointment(data, timeZone) };
  } catch (err: unknown) {
    return {
      appointment: null,
      error: formatSupabaseError(err, 'Unable to load appointment details.'),
    };
  }
}

export async function fetchBookingNotificationsInSupabase(options: {
  businessId: string;
  userId?: string;
  limit?: number;
}): Promise<{
  notifications: BusinessNotification[];
  tableExists: boolean;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) return { notifications: [], tableExists: false };

  const bizIdNum = toBigIntId(options.businessId);
  if (!bizIdNum) {
    return { notifications: [], tableExists: true };
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  try {
    const { data, error } = await client
      .from('booking_notifications')
      .select('*, booking_notification_reads(read_at, user_id)')
      .eq('business_id', bizIdNum)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingTableError(error)) {
        return { notifications: [], tableExists: false };
      }
      return {
        notifications: [],
        tableExists: true,
        error: formatSupabaseError(error, 'Unable to load booking notifications.'),
      };
    }

    return {
      tableExists: true,
      notifications: (data || []).map(row => mapRowToBookingNotification(row, options.userId)),
    };
  } catch (err: unknown) {
    return {
      notifications: [],
      tableExists: false,
      error: formatSupabaseError(err, 'Unable to load booking notifications.'),
    };
  }
}

export async function markBookingNotificationReadInSupabase(options: {
  notificationId: string;
  businessId: string;
  userId: string;
}): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  const bizIdNum = toBigIntId(options.businessId);
  if (
    !client ||
    !bizIdNum ||
    !isValidUuid(options.notificationId) ||
    !isValidUuid(options.userId)
  ) {
    return { success: false, error: 'Invalid booking notification reference.' };
  }

  try {
    const { error } = await client
      .from('booking_notification_reads')
      .upsert(
        {
          notification_id: options.notificationId.trim(),
          user_id: options.userId.trim(),
          business_id: bizIdNum,
        },
        { onConflict: 'notification_id,user_id', ignoreDuplicates: true }
      );

    if (error) {
      if (isMissingTableError(error)) return { success: true };
      return {
        success: false,
        error: formatSupabaseError(error, 'Unable to mark booking notification read.'),
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: formatSupabaseError(err, 'Unable to mark booking notification read.'),
    };
  }
}

export async function markAllBookingNotificationsReadInSupabase(options: {
  notificationIds: string[];
  businessId: string;
  userId: string;
}): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  const bizIdNum = toBigIntId(options.businessId);
  if (!client || !bizIdNum || !isValidUuid(options.userId)) {
    return { success: false };
  }

  const validIds = Array.from(
    new Set(
      (options.notificationIds || [])
        .map(id => String(id || '').trim())
        .filter(id => isValidUuid(id))
    )
  );

  if (validIds.length === 0) {
    return { success: true };
  }

  try {
    const rows = validIds.map(notificationId => ({
      notification_id: notificationId,
      user_id: options.userId.trim(),
      business_id: bizIdNum,
    }));

    const { error } = await client
      .from('booking_notification_reads')
      .upsert(rows, { onConflict: 'notification_id,user_id', ignoreDuplicates: true });

    if (error) {
      if (isMissingTableError(error)) return { success: true };
      return {
        success: false,
        error: formatSupabaseError(error, 'Unable to mark booking notifications read.'),
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: formatSupabaseError(err, 'Unable to mark booking notifications read.'),
    };
  }
}

export interface BookingNotificationRealtimeSpec {
  channelName: string;
  businessId: number;
  userId: string;
  subscriptions: Array<{
    table: 'booking_notifications' | 'booking_notification_reads';
    event: 'INSERT';
    filter: string;
  }>;
}

export function buildBookingNotificationRealtimeSpec(options: {
  businessId?: string;
  userId?: string;
  isSuperAdmin: boolean;
}): BookingNotificationRealtimeSpec | null {
  // Hard guard: Super Admin never subscribes to routine booking notifications
  if (options.isSuperAdmin) {
    return null;
  }

  const bizIdNum = options.businessId ? toBigIntId(options.businessId) : null;
  if (!bizIdNum || !options.userId || !isValidUuid(options.userId)) {
    return null;
  }

  const cleanUserId = options.userId.trim();
  return {
    channelName: `realtime:booking-notifications:${bizIdNum}:${cleanUserId}`,
    businessId: bizIdNum,
    userId: cleanUserId,
    subscriptions: [
      {
        table: 'booking_notifications',
        event: 'INSERT',
        filter: `business_id=eq.${bizIdNum}`,
      },
      {
        table: 'booking_notification_reads',
        event: 'INSERT',
        filter: `user_id=eq.${cleanUserId}`,
      },
    ],
  };
}

export interface BookingNotificationRealtimeCallbacks {
  onNotificationInsert?: (notification: BusinessNotification) => void;
  onReadInsert?: (receipt: { notificationId: string; userId: string; businessId: string; readAt: string }) => void;
  onStatusChange?: (status: string) => void;
}

export function subscribeToBookingNotificationsRealtime(
  options: { businessId?: string; userId?: string; isSuperAdmin: boolean },
  callbacks: BookingNotificationRealtimeCallbacks
): RealtimeChannel | null {
  const client = getSupabaseClient();
  const spec = buildBookingNotificationRealtimeSpec(options);
  if (!client || !spec) return null;

  try {
    let channel = client.channel(spec.channelName);

    for (const sub of spec.subscriptions) {
      channel = channel.on(
        'postgres_changes',
        {
          event: sub.event,
          schema: 'public',
          table: sub.table,
          filter: sub.filter,
        } as any,
        (payload: any) => {
          const newRow = payload?.new as Record<string, any> | undefined;
          if (!newRow) return;

          if (sub.table === 'booking_notifications') {
            if (!newRow.id || String(newRow.business_id) !== String(spec.businessId)) {
              return;
            }
            callbacks.onNotificationInsert?.(mapRowToBookingNotification(newRow, spec.userId));
          } else if (sub.table === 'booking_notification_reads') {
            if (
              !newRow.notification_id ||
              String(newRow.user_id) !== spec.userId ||
              String(newRow.business_id) !== String(spec.businessId)
            ) {
              return;
            }
            callbacks.onReadInsert?.({
              notificationId: String(newRow.notification_id),
              userId: String(newRow.user_id),
              businessId: String(newRow.business_id),
              readAt: newRow.read_at ? String(newRow.read_at) : new Date().toISOString(),
            });
          }
        }
      );
    }

    channel.subscribe((status: string) => {
      callbacks.onStatusChange?.(String(status));
    });
    return channel;
  } catch (err) {
    console.warn('Booking notification realtime subscription error:', err);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Mappers (Database rows to typed App entities — Null-Safe)
// -----------------------------------------------------------------------------

export function normalizeAppointmentStatus(rawStatus?: string | null): AppointmentStatus {
  const normalized = String(rawStatus || 'pending').toLowerCase().trim();
  if (
    normalized === 'pending' ||
    normalized === 'confirmed' ||
    normalized === 'completed' ||
    normalized === 'cancelled' ||
    normalized === 'no_show'
  ) {
    return normalized;
  }
  if (normalized === 'canceled') return 'cancelled';
  if (normalized === 'no-show' || normalized === 'no show' || normalized === 'noshow') return 'no_show';
  return 'pending';
}

export function mapRowToAppointment(row: any, timeZone?: string): Appointment {
  const rawStartTime =
    typeof row?.start_time === 'string' && row.start_time.trim() ? row.start_time.trim() : undefined;
  const rawEndTime =
    typeof row?.end_time === 'string' && row.end_time.trim() ? row.end_time.trim() : undefined;

  const startParts = extractDateAndTimeInTimezone(rawStartTime, timeZone);
  const endParts = extractDateAndTimeInTimezone(rawEndTime, timeZone);

  const resolvedStartTime = startParts.time || '';
  const resolvedEndTime = endParts.time || '';
  const durationMinutes = calculateAppointmentDurationMinutes(
    rawStartTime ?? resolvedStartTime,
    rawEndTime ?? resolvedEndTime
  );

  const rawLocation = String(row?.location_type || '').toLowerCase();
  const locationType: LocationType =
    rawLocation === 'at_home' ? 'at_home' : rawLocation === 'online' ? 'online' : 'in_business';

  const resolvedPrice = Number(row?.price ?? row?.total_price ?? 0);

  return {
    id: String(row?.id ?? ''),
    tenantId: String(row?.business_id ?? row?.tenant_id ?? ''),
    customerId: row?.customer_id != null ? String(row.customer_id) : '',
    customerName:
      (typeof row?.customer_name === 'string' && row.customer_name.trim()) ||
      (typeof row?.customers?.full_name === 'string' && row.customers.full_name.trim()) ||
      (typeof row?.customers?.name === 'string' && row.customers.name.trim()) ||
      'Customer',
    customerPhone:
      (typeof row?.customer_phone === 'string' && row.customer_phone) ||
      (typeof row?.customers?.phone === 'string' && row.customers.phone) ||
      '',
    customerLanguage: (row?.customer_language || row?.customers?.preferred_language) === 'es' ? 'es' : 'en',
    serviceId: row?.service_id != null ? String(row.service_id) : '',
    serviceName:
      (typeof row?.service_name === 'string' && row.service_name.trim()) ||
      (typeof row?.services?.name_en === 'string' && row.services.name_en.trim()) ||
      (typeof row?.services?.name === 'string' && row.services.name.trim()) ||
      'Service',
    staffId: row?.staff_id != null ? String(row.staff_id) : undefined,
    staffName: row?.staff_name || row?.staff?.name || undefined,
    date: startParts.date || row?.date || endParts.date || '',
    startTime: resolvedStartTime,
    endTime: resolvedEndTime,
    rawStartTime,
    rawEndTime,
    durationMinutes,
    price: Number.isFinite(resolvedPrice) ? resolvedPrice : 0,
    locationType,
    address: row?.location_address ?? row?.address ?? undefined,
    status: normalizeAppointmentStatus(row?.status),
    notes: typeof row?.notes === 'string' ? row.notes : undefined,
    source: row?.source || 'manual_dashboard',
    createdAt: row?.created_at || new Date().toISOString(),
  };
}

export function mapRowToCustomer(row: any): Customer {
  const safeName =
    (typeof row?.name === 'string' && row.name.trim()) ||
    (typeof row?.full_name === 'string' && row.full_name.trim()) ||
    'Unnamed Customer';
  const safePhone =
    (typeof row?.phone === 'string' && row.phone) ||
    (typeof row?.phone_number === 'string' && row.phone_number) ||
    '';
  const safeEmail = typeof row?.email === 'string' ? row.email : '';
  const rawTotal = Number(row?.total_appointments);

  return {
    id: String(row?.id ?? ''),
    tenantId: String(row?.business_id ?? row?.tenant_id ?? ''),
    name: safeName,
    phone: safePhone,
    email: safeEmail,
    preferredLanguage: row?.preferred_language === 'es' ? 'es' : 'en',
    address: typeof row?.address === 'string' ? row.address : undefined,
    notes: typeof row?.notes === 'string' ? row.notes : undefined,
    totalAppointments: Number.isFinite(rawTotal) ? rawTotal : 0,
    lastInteractionAt: row?.last_interaction_at || row?.created_at || new Date().toISOString(),
    createdAt: row?.created_at || new Date().toISOString(),
  };
}

export function mapRowToService(row: any): Service {
  const isActiveResolved =
    typeof row?.is_active === 'boolean'
      ? row.is_active
      : row?.active !== undefined
      ? row.active !== false
      : true;

  const rawPrice = Number(row?.price);

  return {
    id: String(row?.id ?? ''),
    tenantId: String(row?.business_id ?? row?.tenant_id ?? ''),
    nameEn: row?.name_en || row?.name || '',
    nameEs: row?.name_es || row?.name || row?.name_en || '',
    descriptionEn: row?.description_en || row?.description || '',
    descriptionEs: row?.description_es || row?.description || row?.description_en || '',
    durationMinutes: Number(row?.duration_minutes ?? row?.duration) || 60,
    price: Number.isFinite(rawPrice) ? rawPrice : 0,
    currency: typeof row?.currency === 'string' && row.currency.trim() ? row.currency.trim().toUpperCase() : undefined,
    category: row?.category || 'General',
    allowsInBusiness: row?.allows_in_business !== false,
    allowsAtHome: Boolean(row?.allows_at_home),
    active: isActiveResolved,
    createdAt: typeof row?.created_at === 'string' ? row.created_at : undefined,
    updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : undefined,
  };
}

// =============================================================================
// PHASE 3: SUPER ADMIN PLATFORM OPERATIONS (OWNERS, CHANNELS, MONITORING, A2P)
// =============================================================================

export async function fetchPlatformBusinessOwnersInSupabase(
  businesses: Tenant[]
): Promise<Record<string, BusinessOwnerSummary[]>> {
  const client = getSupabaseClient();
  if (!client || businesses.length === 0) return {};

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) return {};

  try {
    let { data: memberRows, error: memberErr } = await client
      .from('business_members')
      .select('id, user_id, business_id, role, is_active, created_at')
      .in('role', ['owner', 'admin']);

    if (
      memberErr &&
      (memberErr.code === '42703' ||
        memberErr.code === 'PGRST204' ||
        memberErr.message?.toLowerCase().includes('is_active'))
    ) {
      const retry = await client
        .from('business_members')
        .select('id, user_id, business_id, role, created_at')
        .in('role', ['owner', 'admin']);
      memberRows = retry.data as any;
      memberErr = retry.error;
    }

    if (memberErr || !Array.isArray(memberRows)) {
      return {};
    }

    const activeOwnerRows = memberRows.filter((r: any) => r?.is_active !== false);
    const bizIdsWithOwners = Array.from(
      new Set(activeOwnerRows.map((r: any) => String(r.business_id)))
    );

    const emailByBizAndUser = new Map<string, string>();
    for (let i = 0; i < bizIdsWithOwners.length; i += 5) {
      const batch = bizIdsWithOwners.slice(i, i + 5);
      await Promise.all(
        batch.map(async bizId => {
          try {
            const { data: rpcMembers, error: rpcErr } = await client.rpc(
              'admin_list_business_members',
              { target_business_id: toDbId(bizId) }
            );
            if (!rpcErr && Array.isArray(rpcMembers)) {
              for (const m of rpcMembers) {
                const email = m?.user_email || m?.email;
                if (m?.user_id && typeof email === 'string' && email.trim()) {
                  emailByBizAndUser.set(`${bizId}::${String(m.user_id)}`, email.trim());
                }
              }
            }
          } catch {
            // Optional enrichment fallback
          }
        })
      );
    }

    const result: Record<string, BusinessOwnerSummary[]> = {};
    for (const row of activeOwnerRows) {
      const bizId = String(row.business_id);
      const userId = String(row.user_id);
      const role: 'owner' | 'admin' = row.role === 'admin' ? 'admin' : 'owner';
      const userEmail = emailByBizAndUser.get(`${bizId}::${userId}`);
      if (!result[bizId]) result[bizId] = [];
      if (!result[bizId].some(existing => existing.userId === userId)) {
        result[bizId].push({
          businessId: bizId,
          userId,
          userEmail,
          role,
          assignedAt: row.created_at || undefined,
        });
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function fetchBookingNotificationHealthInSupabase(): Promise<BookingNotificationHealth> {
  const checkedAt = new Date().toISOString();
  const client = getSupabaseClient();
  if (!client) {
    return {
      status: 'error',
      pendingFailures: null,
      dueForRetry: null,
      abandonedFailures: null,
      recovered24h: null,
      oldestPendingAgeSeconds: null,
      openNotificationIncidents: null,
      criticalDoubleFailureIncidents: null,
      checkedAt,
      detail: 'Supabase client is not connected.',
      recoveryWorkerStatus: 'not_deployed',
    };
  }

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) {
    return {
      status: 'error',
      pendingFailures: null,
      dueForRetry: null,
      abandonedFailures: null,
      recovered24h: null,
      oldestPendingAgeSeconds: null,
      openNotificationIncidents: null,
      criticalDoubleFailureIncidents: null,
      checkedAt,
      detail: authCheck.error || 'Super Admin authorization required.',
      recoveryWorkerStatus: 'not_deployed',
    };
  }

  try {
    const { data, error } = await client.rpc('get_booking_notification_health');
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (
        error.code === 'PGRST202' ||
        error.code === '42883' ||
        msg.includes('could not find the function') ||
        msg.includes('does not exist')
      ) {
        return {
          status: 'not_deployed',
          pendingFailures: null,
          dueForRetry: null,
          abandonedFailures: null,
          recovered24h: null,
          oldestPendingAgeSeconds: null,
          openNotificationIncidents: null,
          criticalDoubleFailureIncidents: null,
          checkedAt,
          detail: 'get_booking_notification_health RPC is not deployed on this database.',
          recoveryWorkerStatus: 'not_deployed',
        };
      }
      return {
        status: 'error',
        pendingFailures: null,
        dueForRetry: null,
        abandonedFailures: null,
        recovered24h: null,
        oldestPendingAgeSeconds: null,
        openNotificationIncidents: null,
        criticalDoubleFailureIncidents: null,
        checkedAt,
        detail: error.message,
        recoveryWorkerStatus: 'not_deployed',
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return {
        status: 'error',
        pendingFailures: null,
        dueForRetry: null,
        abandonedFailures: null,
        recovered24h: null,
        oldestPendingAgeSeconds: null,
        openNotificationIncidents: null,
        criticalDoubleFailureIncidents: null,
        checkedAt,
        detail: 'Empty health response returned by database.',
        recoveryWorkerStatus: 'not_deployed',
      };
    }

    const rawHealth = String((row as any).health_status || '').toLowerCase();
    const mappedStatus =
      rawHealth === 'critical'
        ? 'critical'
        : rawHealth === 'degraded'
        ? 'degraded'
        : 'healthy';

    return {
      status: mappedStatus,
      pendingFailures: Number((row as any).pending_failures) || 0,
      dueForRetry: Number((row as any).due_for_retry) || 0,
      abandonedFailures: Number((row as any).abandoned_failures) || 0,
      recovered24h: Number((row as any).recovered_24h) || 0,
      oldestPendingAgeSeconds: Number((row as any).oldest_pending_age_seconds) || 0,
      openNotificationIncidents: Number((row as any).open_notification_incidents) || 0,
      criticalDoubleFailureIncidents: Number((row as any).critical_double_failure_incidents) || 0,
      latestFailureAt: (row as any).latest_failure_at || null,
      checkedAt,
      recoveryWorkerStatus: 'service_role_scheduled',
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      pendingFailures: null,
      dueForRetry: null,
      abandonedFailures: null,
      recovered24h: null,
      oldestPendingAgeSeconds: null,
      openNotificationIncidents: null,
      criticalDoubleFailureIncidents: null,
      checkedAt,
      detail: err instanceof Error ? err.message : 'Unable to fetch booking notification health.',
      recoveryWorkerStatus: 'not_deployed',
    };
  }
}

export async function triggerBookingNotificationRecoveryInSupabase(): Promise<{
  success: boolean;
  requiresBackendWorker?: boolean;
  recoveredCount?: number;
  rescheduledCount?: number;
  abandonedCount?: number;
  message?: string;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not connected.' };
  }

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) {
    return { success: false, error: authCheck.error || 'Super Admin authorization required.' };
  }

  try {
    const { data, error } = await client.functions.invoke('recover-booking-notifications', {
      body: { limit: 50, maxAttempts: 5 },
    });

    if (error) {
      return {
        success: false,
        requiresBackendWorker: true,
        error:
          'Recovery worker Edge Function (recover-booking-notifications) is not deployed or unreachable. recover_failed_booking_notifications is restricted to service_role (pg_cron / n8n / backend worker).',
      };
    }

    if (!data || data.success === false) {
      return {
        success: false,
        requiresBackendWorker: Boolean(data?.requiresBackendWorker),
        error: data?.error || 'Booking notification recovery worker failed.',
      };
    }

    return {
      success: true,
      recoveredCount: Number(data.recoveredCount ?? data.recovered_count ?? 0),
      rescheduledCount: Number(data.rescheduledCount ?? data.rescheduled_count ?? 0),
      abandonedCount: Number(data.abandonedCount ?? data.abandoned_count ?? 0),
      message: data.message,
    };
  } catch {
    return {
      success: false,
      requiresBackendWorker: true,
      error:
        'Recovery worker requires a service_role scheduler (Supabase pg_cron, n8n, or recover-booking-notifications Edge Function).',
    };
  }
}

export async function checkN8nIntegrationHealthInSupabase(): Promise<N8nIntegrationHealth> {
  const nowIso = new Date().toISOString();
  const client = getSupabaseClient();
  if (!client) {
    return {
      status: 'not_verified',
      activeWorkflows: null,
      detail: 'Supabase client is not connected.',
    };
  }

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) {
    return {
      status: 'not_verified',
      activeWorkflows: null,
      detail: 'Super Admin authorization required.',
    };
  }

  try {
    const { data, error } = await client.functions.invoke('n8n-health', {
      body: {},
    });

    if (error || !data) {
      return {
        status: 'not_verified',
        activeWorkflows: null,
        detail: 'No verified server-side n8n health check endpoint is deployed yet.',
      };
    }

    if ((data.status === 'verified_connected' || data.status === 'healthy') && data.verified === true) {
      return {
        status: 'verified_connected',
        activeWorkflows: typeof data.activeWorkflows === 'number' ? data.activeWorkflows : null,
        lastVerifiedAt: nowIso,
        detail: typeof data.detail === 'string' ? data.detail : 'Verified via backend health check.',
      };
    }

    if (data.status === 'error' || data.status === 'degraded' || data.status === 'unreachable') {
      return {
        status: 'error',
        activeWorkflows: null,
        lastVerifiedAt: nowIso,
        detail: typeof data.detail === 'string' ? data.detail : 'Workflow orchestration check reported an issue.',
      };
    }

    return {
      status: 'not_verified',
      activeWorkflows: null,
      detail: typeof data.detail === 'string' ? data.detail : 'n8n health could not be verified by backend.',
    };
  } catch {
    return {
      status: 'not_verified',
      activeWorkflows: null,
      detail: 'No verified server-side n8n health check endpoint is deployed yet.',
    };
  }
}

export async function fetchPlatformMessagingConfigsInSupabase(): Promise<{
  configs: Record<string, BusinessMessagingConfig>;
  tableExists: boolean;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { configs: {}, tableExists: false, error: 'Supabase client is not connected.' };
  }

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) {
    return { configs: {}, tableExists: true, error: 'Super Admin authorization required.' };
  }

  try {
    const { data, error } = await client
      .from('business_messaging_configs')
      .select('business_id, a2p_status, sms_opt_in_enabled, auto_send_enabled, consent_disclosure_version, campaign_sid, messaging_service_sid, approved_at, updated_at');

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (error.code === '42P01' || error.code === 'PGRST205' || msg.includes('does not exist')) {
        return { configs: {}, tableExists: false };
      }
      return { configs: {}, tableExists: true, error: error.message };
    }

    const configs: Record<string, BusinessMessagingConfig> = {};
    for (const row of data || []) {
      const businessId = String((row as any).business_id);
      configs[businessId] = {
        businessId,
        a2pStatus: ((row as any).a2p_status || 'not_configured') as A2pApprovalStatus,
        smsOptInEnabled: (row as any).sms_opt_in_enabled !== false,
        autoSendEnabled: Boolean((row as any).auto_send_enabled),
        consentDisclosureVersion: (row as any).consent_disclosure_version || 'v1.0',
        campaignSid: (row as any).campaign_sid || undefined,
        messagingServiceSid: (row as any).messaging_service_sid || undefined,
        approvedAt: (row as any).approved_at || undefined,
        updatedAt: (row as any).updated_at || undefined,
        persistedInBackend: true,
      };
    }

    return { configs, tableExists: true };
  } catch (err: unknown) {
    return {
      configs: {},
      tableExists: true,
      error: err instanceof Error ? err.message : 'Unable to fetch messaging configurations.',
    };
  }
}

export async function fetchPlatformSmsConsentSummariesInSupabase(): Promise<{
  summaries: Record<string, BusinessSmsConsentSummary>;
  tableExists: boolean;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { summaries: {}, tableExists: false, error: 'Supabase client is not connected.' };
  }

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) {
    return { summaries: {}, tableExists: true, error: 'Super Admin authorization required.' };
  }

  try {
    // Strictly select aggregate metadata only — NEVER select customer_name or phone_number PII in Super Admin console
    const { data, error } = await client
      .from('sms_consents')
      .select('id, business_id, status, consent_source, consent_timestamp, consent_disclosure_version')
      .order('consent_timestamp', { ascending: false });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (error.code === '42P01' || error.code === 'PGRST205' || msg.includes('does not exist')) {
        return { summaries: {}, tableExists: false };
      }
      return { summaries: {}, tableExists: true, error: error.message };
    }

    const summaries: Record<string, BusinessSmsConsentSummary> = {};
    for (const row of data || []) {
      const businessId = String((row as any).business_id);
      if (!summaries[businessId]) {
        summaries[businessId] = {
          businessId,
          totalConsents: 0,
          optedInCount: 0,
          optedOutCount: 0,
          latestConsentAt: undefined,
          disclosureVersions: [],
          sources: [],
        };
      }
      const entry = summaries[businessId];
      entry.totalConsents += 1;
      if ((row as any).status === 'opted_out') {
        entry.optedOutCount += 1;
      } else if ((row as any).status === 'opted_in') {
        entry.optedInCount += 1;
      }
      if (!entry.latestConsentAt && (row as any).consent_timestamp) {
        entry.latestConsentAt = (row as any).consent_timestamp;
      }
      const dv = (row as any).consent_disclosure_version;
      if (typeof dv === 'string' && dv && !entry.disclosureVersions.includes(dv)) {
        entry.disclosureVersions.push(dv);
      }
      const src = (row as any).consent_source;
      if (typeof src === 'string' && src && !entry.sources.includes(src)) {
        entry.sources.push(src);
      }
    }

    return { summaries, tableExists: true };
  } catch (err: unknown) {
    return {
      summaries: {},
      tableExists: true,
      error: err instanceof Error ? err.message : 'Unable to fetch SMS consent aggregates.',
    };
  }
}

export async function updateBusinessMessagingConfigInSupabase(input: {
  businessId: string;
  businessIsActive: boolean;
  a2pStatus: A2pApprovalStatus;
  smsOptInEnabled: boolean;
  autoSendEnabled: boolean;
  consentDisclosureVersion: string;
  campaignSid?: string;
  messagingServiceSid?: string;
  optedInConsentCount: number;
}): Promise<{ success: boolean; config?: BusinessMessagingConfig; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not connected.' };
  }

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) {
    return { success: false, error: authCheck.error || 'Super Admin authorization required.' };
  }

  const trimmedCampaignSid = input.campaignSid?.trim() || '';
  const trimmedServiceSid = input.messagingServiceSid?.trim() || '';

  if (input.autoSendEnabled) {
    if (!input.businessIsActive) {
      return { success: false, error: 'Cannot enable outbound auto-send for a suspended business.' };
    }
    if (input.a2pStatus !== 'approved') {
      return { success: false, error: 'A2P 10DLC status must be Approved before enabling automated outbound SMS.' };
    }
    if (!input.smsOptInEnabled) {
      return { success: false, error: 'SMS opt-in registration must be enabled before automated outbound SMS.' };
    }
    if (!trimmedCampaignSid || !trimmedServiceSid) {
      return { success: false, error: 'Both Twilio Campaign SID and Messaging Service SID are required before enabling outbound SMS.' };
    }
    if (input.optedInConsentCount <= 0) {
      return { success: false, error: 'At least one verified opt-in consent record is required before enabling outbound SMS.' };
    }
  }

  try {
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      business_id: toDbId(input.businessId),
      a2p_status: input.a2pStatus,
      sms_opt_in_enabled: input.smsOptInEnabled,
      auto_send_enabled: input.autoSendEnabled,
      consent_disclosure_version: input.consentDisclosureVersion.trim() || 'v1.0',
      campaign_sid: trimmedCampaignSid || null,
      messaging_service_sid: trimmedServiceSid || null,
      approved_at: input.a2pStatus === 'approved' ? nowIso : null,
      updated_at: nowIso,
    };

    const { data, error } = await client
      .from('business_messaging_configs')
      .upsert(payload, { onConflict: 'business_id' })
      .select()
      .single();

    if (error || !data) {
      return {
        success: false,
        error: sanitizeDatabaseError(error?.message || 'Unable to save business messaging config.'),
      };
    }

    await recordAdminAuditLogInSupabase({
      businessId: input.businessId,
      action: 'update_sms_a2p_config',
      entityType: 'business_messaging_configs',
      entityId: input.businessId,
      metadata: {
        a2p_status: input.a2pStatus,
        sms_opt_in_enabled: input.smsOptInEnabled,
        auto_send_enabled: input.autoSendEnabled,
      },
    });

    return {
      success: true,
      config: {
        businessId: String((data as any).business_id),
        a2pStatus: (data as any).a2p_status,
        smsOptInEnabled: (data as any).sms_opt_in_enabled !== false,
        autoSendEnabled: Boolean((data as any).auto_send_enabled),
        consentDisclosureVersion: (data as any).consent_disclosure_version || 'v1.0',
        campaignSid: (data as any).campaign_sid || undefined,
        messagingServiceSid: (data as any).messaging_service_sid || undefined,
        approvedAt: (data as any).approved_at || undefined,
        updatedAt: (data as any).updated_at || nowIso,
        persistedInBackend: true,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: sanitizeDatabaseError(err instanceof Error ? err.message : 'Unable to save SMS configuration.'),
    };
  }
}

export async function updateBusinessCommunicationChannelsInSupabase(
  tenant: Tenant,
  nextChannels: BusinessCommunicationChannels
): Promise<{ success: boolean; channels?: BusinessCommunicationChannels; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client is not connected.' };
  }

  const authCheck = await verifyCurrentUserIsSuperAdmin();
  if (!authCheck.isSuperAdmin) {
    return { success: false, error: authCheck.error || 'Super Admin authorization required.' };
  }

  const isBizActive = tenant.isActive !== false;
  const nowIso = new Date().toISOString();

  // Never allow secret tokens or fake 'connected' backend states in frontend metadata
  const sanitizedChannels: BusinessCommunicationChannels = {
    whatsapp: {
      status: !isBizActive
        ? 'suspended'
        : nextChannels.whatsapp.displayPhoneNumber?.trim() || nextChannels.whatsapp.businessAccountLabel?.trim()
        ? 'pending_backend'
        : 'not_configured',
      provider: nextChannels.whatsapp.provider || 'whatsapp_cloud',
      displayPhoneNumber: nextChannels.whatsapp.displayPhoneNumber?.trim() || undefined,
      businessAccountLabel: nextChannels.whatsapp.businessAccountLabel?.trim() || undefined,
      verifiedByBackend: false,
      lastCheckedAt: nowIso,
      notes: nextChannels.whatsapp.notes?.trim() || undefined,
    },
    sms: {
      status: !isBizActive
        ? 'suspended'
        : nextChannels.sms.verifiedByBackend
        ? 'connected'
        : nextChannels.sms.fromPhoneNumber?.trim()
        ? 'pending_backend'
        : 'not_configured',
      provider: 'twilio_a2p',
      fromPhoneNumber: nextChannels.sms.fromPhoneNumber?.trim() || undefined,
      verifiedByBackend: Boolean(nextChannels.sms.verifiedByBackend),
      lastCheckedAt: nowIso,
    },
    webChat: {
      status: !isBizActive
        ? 'suspended'
        : nextChannels.webChat.enabled && nextChannels.webChat.widgetPublicId?.trim()
        ? 'pending_backend'
        : 'not_configured',
      enabled: Boolean(nextChannels.webChat.enabled),
      widgetPublicId: nextChannels.webChat.widgetPublicId?.trim() || undefined,
      allowedOrigins: Array.isArray(nextChannels.webChat.allowedOrigins)
        ? nextChannels.webChat.allowedOrigins.map(o => o.trim()).filter(Boolean)
        : undefined,
      verifiedByBackend: false,
      lastCheckedAt: nowIso,
    },
  };

  try {
    const dbBizId = toDbId(tenant.id);
    const nextSettings = {
      ...tenant.settings,
      communicationChannels: sanitizedChannels,
    };

    const { error } = await client
      .from('businesses')
      .update({
        settings: nextSettings,
      })
      .eq('id', dbBizId);

    if (error) {
      const msgLower = (error.message || '').toLowerCase();
      if ((error.code === '42703' || error.code === 'PGRST204') && msgLower.includes('settings')) {
        return {
          success: false,
          error:
            'Database column businesses.settings is missing. Run prerequisite migration 20261116_01_businesses_settings_prerequisite.sql before saving channel settings.',
        };
      }
      return { success: false, error: sanitizeDatabaseError(error.message) };
    }

    await recordAdminAuditLogInSupabase({
      businessId: tenant.id,
      action: 'update_communication_channels',
      entityType: 'businesses',
      entityId: tenant.id,
      metadata: {
        whatsapp_status: sanitizedChannels.whatsapp.status,
        sms_status: sanitizedChannels.sms.status,
        web_chat_status: sanitizedChannels.webChat.status,
      },
    });

    return { success: true, channels: sanitizedChannels };
  } catch (err: unknown) {
    return {
      success: false,
      error: sanitizeDatabaseError(err instanceof Error ? err.message : 'Unable to save channel settings.'),
    };
  }
}

/**
 * Multi-Tenant PostgreSQL Schema matching Novacode Tech database tables:
 * - businesses
 * - business_members
 * - customers
 * - services
 * - appointments
 * - business_hours
 * - service_availability
 * - locations
 * - messages
 * - audit_logs
 * With Row-Level Security (RLS) policies and booking RPC functions.
 */
export const SUPABASE_SQL_SCHEMA = `-- =============================================================================
-- NOVACODE TECH — MULTI-TENANT SAAS DATABASE SCHEMA & RLS
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Businesses Table (Tenants)
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    tagline TEXT,
    logo TEXT,
    category TEXT DEFAULT 'general',
    default_language TEXT DEFAULT 'en' CHECK (default_language IN ('en', 'es')),
    timezone TEXT DEFAULT 'America/New_York',
    currency_symbol TEXT DEFAULT '$',
    phone TEXT,
    email TEXT,
    address TEXT,
    website TEXT,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Business Members Table (User Roles & Multi-tenant Membership)
CREATE TABLE IF NOT EXISTS public.business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'admin', 'manager', 'staff')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, user_id)
);

-- 3. Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    preferred_language TEXT DEFAULT 'en' CHECK (preferred_language IN ('en', 'es')),
    address TEXT,
    notes TEXT,
    total_appointments INTEGER DEFAULT 0,
    last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Services Table
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name_en TEXT NOT NULL,
    name_es TEXT NOT NULL,
    description_en TEXT,
    description_es TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    category TEXT DEFAULT 'General',
    allows_in_business BOOLEAN DEFAULT TRUE,
    allows_at_home BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Appointments Table
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_language TEXT DEFAULT 'en',
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    service_name TEXT NOT NULL,
    staff_id UUID,
    staff_name TEXT,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    location_type TEXT NOT NULL DEFAULT 'in_business' CHECK (location_type IN ('in_business', 'at_home')),
    address TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual_dashboard' CHECK (source IN ('ai_whatsapp', 'ai_sms', 'manual_dashboard', 'online_widget')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Business Hours Table
CREATE TABLE IF NOT EXISTS public.business_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time TIME NOT NULL DEFAULT '09:00',
    close_time TIME NOT NULL DEFAULT '19:00',
    is_closed BOOLEAN DEFAULT FALSE,
    UNIQUE(business_id, day_of_week)
);

-- 7. Service Availability Table
CREATE TABLE IF NOT EXISTS public.service_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    is_available BOOLEAN DEFAULT TRUE
);

-- 8. Locations Table
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT,
    is_primary BOOLEAN DEFAULT TRUE
);

-- 9. Messages Table (Chat/AI log)
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    sender TEXT NOT NULL CHECK (sender IN ('customer', 'ai', 'staff')),
    content TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    channel TEXT DEFAULT 'whatsapp',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Audit Logs Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper security function: Check membership
CREATE OR REPLACE FUNCTION public.is_member_of(biz_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.business_members
        WHERE business_id = biz_id AND user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS: Businesses (Members can read their businesses)
CREATE POLICY "Members view businesses" ON public.businesses
    FOR SELECT USING (public.is_member_of(id));

-- RLS: Business Members (Members can view their own membership rows)
CREATE POLICY "View memberships" ON public.business_members
    FOR SELECT USING (user_id = auth.uid() OR public.is_member_of(business_id));

-- RLS: Appointments (Members can manage their business appointments)
CREATE POLICY "Manage appointments" ON public.appointments
    FOR ALL USING (public.is_member_of(business_id))
    WITH CHECK (public.is_member_of(business_id));

-- RLS: Customers (Members can manage their business customers)
CREATE POLICY "Manage customers" ON public.customers
    FOR ALL USING (public.is_member_of(business_id))
    WITH CHECK (public.is_member_of(business_id));

-- RLS: Services (Members can manage their services)
CREATE POLICY "Manage services" ON public.services
    FOR ALL USING (public.is_member_of(business_id))
    WITH CHECK (public.is_member_of(business_id));

-- =============================================================================
-- BOOKING RPC FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.book_appointment(booking_data JSONB)
RETURNS JSONB AS $$
DECLARE
    new_apt_id UUID;
    result JSONB;
BEGIN
    INSERT INTO public.appointments (
        business_id,
        customer_id,
        customer_name,
        customer_phone,
        customer_language,
        service_id,
        service_name,
        staff_id,
        staff_name,
        date,
        start_time,
        end_time,
        duration_minutes,
        price,
        location_type,
        address,
        status,
        notes,
        source
    ) VALUES (
        (booking_data->>'business_id')::UUID,
        NULLIF(booking_data->>'customer_id', '')::UUID,
        booking_data->>'customer_name',
        booking_data->>'customer_phone',
        COALESCE(booking_data->>'customer_language', 'en'),
        NULLIF(booking_data->>'service_id', '')::UUID,
        booking_data->>'service_name',
        NULLIF(booking_data->>'staff_id', '')::UUID,
        booking_data->>'staff_name',
        (booking_data->>'date')::DATE,
        (booking_data->>'start_time')::TIME,
        (booking_data->>'end_time')::TIME,
        COALESCE((booking_data->>'duration_minutes')::INTEGER, 60),
        COALESCE((booking_data->>'price')::NUMERIC, 0.00),
        COALESCE(booking_data->>'location_type', 'in_business'),
        booking_data->>'address',
        'confirmed',
        booking_data->>'notes',
        COALESCE(booking_data->>'source', 'manual_dashboard')
    )
    RETURNING id INTO new_apt_id;

    SELECT jsonb_build_object(
        'id', new_apt_id,
        'business_id', booking_data->>'business_id',
        'customer_name', booking_data->>'customer_name',
        'service_name', booking_data->>'service_name',
        'date', booking_data->>'date',
        'start_time', booking_data->>'start_time',
        'status', 'confirmed'
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
`;

/**
 * Non-destructive RBAC & Super Admin Migration SQL (For Review Only — do not auto-execute).
 * Preserves existing business_members table and adds server-side platform_admins + role-scoped RLS & RPCs.
 */
export const SUPABASE_RBAC_MIGRATION_SQL = `-- =============================================================================
-- NOVACODE TECH — RBAC & SUPER ADMIN SECURITY MIGRATION (NON-DESTRUCTIVE)
-- Review carefully before running in Supabase SQL Editor.
-- =============================================================================

-- 1. Separate Platform-Level Super Admin Authorization Table
-- Super Admins are NEVER inferred from email or frontend state.
-- Only a database administrator / service_role can insert into platform_admins.
CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Users may ONLY check their own active platform_admin record (no client writes allowed)
DROP POLICY IF EXISTS "Read own platform admin status" ON public.platform_admins;
CREATE POLICY "Read own platform admin status" ON public.platform_admins
    FOR SELECT USING (user_id = auth.uid());

-- 2. Server-Side Security Helper Functions (SECURITY DEFINER with explicit search_path)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.platform_admins
        WHERE user_id = auth.uid()
          AND is_active = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.is_member_of(biz_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_super_admin()
        OR EXISTS (
            SELECT 1
            FROM public.business_members
            WHERE business_id = biz_id
              AND user_id = auth.uid()
        );
$$;

CREATE OR REPLACE FUNCTION public.is_business_owner(biz_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_super_admin()
        OR EXISTS (
            SELECT 1
            FROM public.business_members
            WHERE business_id = biz_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'admin')
        );
$$;

-- 3. Role-Scoped RLS Policies (Super Admin vs Business Owner vs Staff)

-- Businesses: Members/Super Admins can view; Owners/Super Admins can update; only Super Admins can create/delete
DROP POLICY IF EXISTS "Members view businesses" ON public.businesses;
CREATE POLICY "Members view businesses" ON public.businesses
    FOR SELECT USING (public.is_member_of(id));

DROP POLICY IF EXISTS "Owners update own businesses" ON public.businesses;
CREATE POLICY "Owners update own businesses" ON public.businesses
    FOR UPDATE USING (public.is_business_owner(id))
    WITH CHECK (public.is_business_owner(id));

DROP POLICY IF EXISTS "Super admins create businesses" ON public.businesses;
CREATE POLICY "Super admins create businesses" ON public.businesses
    FOR INSERT WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins delete businesses" ON public.businesses;
CREATE POLICY "Super admins delete businesses" ON public.businesses
    FOR DELETE USING (public.is_super_admin());

-- Business Members: Own rows or Owner/Super Admin of business can view; writes via secure RPCs or Owner/Super Admin RLS
DROP POLICY IF EXISTS "View memberships" ON public.business_members;
CREATE POLICY "View memberships" ON public.business_members
    FOR SELECT USING (user_id = auth.uid() OR public.is_business_owner(business_id));

DROP POLICY IF EXISTS "Super admins manage all memberships" ON public.business_members;
CREATE POLICY "Super admins manage all memberships" ON public.business_members
    FOR ALL USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Owners manage business staff" ON public.business_members;
CREATE POLICY "Owners manage business staff" ON public.business_members
    FOR ALL USING (public.is_business_owner(business_id) AND role IN ('manager', 'staff'))
    WITH CHECK (public.is_business_owner(business_id) AND role IN ('manager', 'staff'));

-- Services: Staff can read; only Business Owners & Super Admins can create/edit/delete
DROP POLICY IF EXISTS "Manage services" ON public.services;
DROP POLICY IF EXISTS "Members view services" ON public.services;
CREATE POLICY "Members view services" ON public.services
    FOR SELECT USING (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Owners manage services" ON public.services;
CREATE POLICY "Owners manage services" ON public.services
    FOR ALL USING (public.is_business_owner(business_id))
    WITH CHECK (public.is_business_owner(business_id));

-- Appointments: Members (Staff & Owners) can read/insert/update within business; Owners/Super Admins can delete
DROP POLICY IF EXISTS "Manage appointments" ON public.appointments;
DROP POLICY IF EXISTS "Members access appointments" ON public.appointments;
CREATE POLICY "Members access appointments" ON public.appointments
    FOR SELECT USING (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Members create update appointments" ON public.appointments;
CREATE POLICY "Members create update appointments" ON public.appointments
    FOR INSERT WITH CHECK (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Members update appointments" ON public.appointments;
CREATE POLICY "Members update appointments" ON public.appointments
    FOR UPDATE USING (public.is_member_of(business_id))
    WITH CHECK (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Owners delete appointments" ON public.appointments;
CREATE POLICY "Owners delete appointments" ON public.appointments
    FOR DELETE USING (public.is_business_owner(business_id));

-- Customers: Members can read/insert/update within business; Owners/Super Admins can delete
DROP POLICY IF EXISTS "Manage customers" ON public.customers;
DROP POLICY IF EXISTS "Members view customers" ON public.customers;
CREATE POLICY "Members view customers" ON public.customers
    FOR SELECT USING (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Members insert update customers" ON public.customers;
CREATE POLICY "Members insert update customers" ON public.customers
    FOR INSERT WITH CHECK (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Members update customers" ON public.customers;
CREATE POLICY "Members update customers" ON public.customers
    FOR UPDATE USING (public.is_member_of(business_id))
    WITH CHECK (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Owners delete customers" ON public.customers;
CREATE POLICY "Owners delete customers" ON public.customers
    FOR DELETE USING (public.is_business_owner(business_id));

-- Business Hours, Locations, Messages, Audit Logs
DROP POLICY IF EXISTS "Members view business hours" ON public.business_hours;
CREATE POLICY "Members view business hours" ON public.business_hours
    FOR SELECT USING (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Owners manage business hours" ON public.business_hours;
CREATE POLICY "Owners manage business hours" ON public.business_hours
    FOR ALL USING (public.is_business_owner(business_id))
    WITH CHECK (public.is_business_owner(business_id));

DROP POLICY IF EXISTS "Members view locations" ON public.locations;
CREATE POLICY "Members view locations" ON public.locations
    FOR SELECT USING (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Owners manage locations" ON public.locations;
CREATE POLICY "Owners manage locations" ON public.locations
    FOR ALL USING (public.is_business_owner(business_id))
    WITH CHECK (public.is_business_owner(business_id));

DROP POLICY IF EXISTS "Members access messages" ON public.messages;
CREATE POLICY "Members access messages" ON public.messages
    FOR ALL USING (public.is_member_of(business_id))
    WITH CHECK (public.is_member_of(business_id));

DROP POLICY IF EXISTS "Owners and super admins view audit logs" ON public.audit_logs;
CREATE POLICY "Owners and super admins view audit logs" ON public.audit_logs
    FOR SELECT USING (public.is_super_admin() OR public.is_business_owner(business_id));

-- 4. Secure Server-Side Admin & Member Management RPCs
CREATE OR REPLACE FUNCTION public.admin_list_business_members(target_business_id UUID)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    business_id UUID,
    role TEXT,
    user_email TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.is_business_owner(target_business_id) THEN
        RAISE EXCEPTION 'Unauthorized: Business Owner or Super Admin access required';
    END IF;

    RETURN QUERY
    SELECT bm.id, bm.user_id, bm.business_id, bm.role, u.email::TEXT, bm.created_at
    FROM public.business_members bm
    JOIN auth.users u ON u.id = bm.user_id
    WHERE bm.business_id = target_business_id
    ORDER BY bm.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_business_member(
    target_business_id UUID,
    target_email TEXT,
    target_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    matched_user_id UUID;
BEGIN
    IF target_role NOT IN ('owner', 'admin', 'manager', 'staff') THEN
        RAISE EXCEPTION 'Invalid role specified';
    END IF;

    -- Only Super Admins may assign owners or admins; Business Owners may assign manager/staff
    IF target_role IN ('owner', 'admin') THEN
        IF NOT public.is_super_admin() THEN
            RAISE EXCEPTION 'Unauthorized: Only Super Admins may assign Business Owners';
        END IF;
    ELSE
        IF NOT public.is_business_owner(target_business_id) THEN
            RAISE EXCEPTION 'Unauthorized: Business Owner or Super Admin access required';
        END IF;
    END IF;

    SELECT id INTO matched_user_id
    FROM auth.users
    WHERE LOWER(email) = LOWER(TRIM(target_email))
    LIMIT 1;

    IF matched_user_id IS NULL THEN
        RAISE EXCEPTION 'No registered Supabase user found for that email address';
    END IF;

    INSERT INTO public.business_members (business_id, user_id, role)
    VALUES (target_business_id, matched_user_id, target_role)
    ON CONFLICT (business_id, user_id)
    DO UPDATE SET role = EXCLUDED.role;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_business_member(
    target_business_id UUID,
    target_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_current_role TEXT;
BEGIN
    SELECT role INTO target_current_role
    FROM public.business_members
    WHERE business_id = target_business_id AND user_id = target_user_id;

    IF target_current_role IN ('owner', 'admin') THEN
        IF NOT public.is_super_admin() THEN
            RAISE EXCEPTION 'Unauthorized: Only Super Admins may remove Business Owners';
        END IF;
    ELSE
        IF NOT public.is_business_owner(target_business_id) THEN
            RAISE EXCEPTION 'Unauthorized: Business Owner or Super Admin access required';
        END IF;
    END IF;

    DELETE FROM public.business_members
    WHERE business_id = target_business_id AND user_id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_business(
    p_name TEXT,
    p_category TEXT DEFAULT 'spa_wellness',
    p_timezone TEXT DEFAULT 'America/New_York',
    p_default_language TEXT DEFAULT 'en',
    p_phone TEXT DEFAULT '',
    p_email TEXT DEFAULT '',
    p_address TEXT DEFAULT ''
)
RETURNS public.businesses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_biz public.businesses;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Super Admin access required';
    END IF;

    INSERT INTO public.businesses (
        name, slug, category, timezone, default_language, phone, email, address
    ) VALUES (
        TRIM(p_name),
        LOWER(REGEXP_REPLACE(TRIM(p_name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || SUBSTR(gen_random_uuid()::TEXT, 1, 6),
        p_category,
        p_timezone,
        CASE WHEN p_default_language = 'es' THEN 'es' ELSE 'en' END,
        p_phone,
        p_email,
        p_address
    )
    RETURNING * INTO new_biz;

    RETURN new_biz;
END;
$$;

-- To explicitly grant Super Admin to a specific existing auth.users row (run manually by DB admin):
-- INSERT INTO public.platform_admins (user_id, notes) VALUES ('<AUTH_USER_UUID>', 'Initial platform super admin');
`;

/**
 * BIGINT-Compatible Additive Super Admin Migration SQL (For Review Only — do not auto-execute).
 * Designed for existing production databases where:
 * - public.platform_admins (user_id UUID, is_active BOOLEAN) already exists
 * - public.is_super_admin() SECURITY DEFINER already exists
 * - businesses.id and business_members.business_id are BIGINT
 * - Existing booking, availability, and authorization functions must be preserved untouched.
 */
export const SUPABASE_BIGINT_SUPERADMIN_MIGRATION_SQL = `-- =============================================================================
-- NOVACODE TECH — BIGINT SUPER ADMIN ADDITIVE MIGRATION (FOR REVIEW ONLY)
-- Preserves existing booking, availability, and authorization functions & policies.
-- Do NOT execute until verified against your live information_schema & pg_policies.
-- =============================================================================

-- 1. Ensure platform_admins allows a user to read ONLY their own row (no client writes)
DO $$
BEGIN
    IF to_regclass('public.platform_admins') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS "Super admin read own platform_admins row" ON public.platform_admins';
        EXECUTE 'CREATE POLICY "Super admin read own platform_admins row" ON public.platform_admins FOR SELECT USING (user_id = auth.uid())';
    END IF;
END
$$;

-- 2. Additive Super Admin Permissive RLS Policies (BIGINT-safe; never drops existing owner/staff/n8n policies)
DO $$
DECLARE
    tbl TEXT;
    target_tables TEXT[] := ARRAY[
        'businesses',
        'business_members',
        'appointments',
        'customers',
        'services',
        'business_hours',
        'service_availability',
        'locations',
        'messages',
        'audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        IF to_regclass('public.' || tbl) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS "Super admin full access %I" ON public.%I', tbl, tbl);
            EXECUTE format(
                'CREATE POLICY "Super admin full access %I" ON public.%I FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())',
                tbl,
                tbl
            );
        END IF;
    END LOOP;
END
$$;

-- 3. BIGINT-Typed Server-Side Audit Trail Helper
-- Records true Super Admin or Business Owner user_id (auth.uid()) without impersonation.
CREATE OR REPLACE FUNCTION public.admin_log_action(
    p_business_id BIGINT,
    p_action TEXT,
    p_entity_type TEXT,
    p_entity_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_authorized BOOLEAN := FALSE;
BEGIN
    IF public.is_super_admin() THEN
        is_authorized := TRUE;
    ELSIF p_business_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.business_members
            WHERE business_id = p_business_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'admin')
        ) INTO is_authorized;
    END IF;

    IF NOT is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Super Admin or Business Owner access required';
    END IF;

    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        INSERT INTO public.audit_logs (
            business_id,
            user_id,
            action,
            entity_type,
            entity_id,
            metadata
        ) VALUES (
            p_business_id,
            auth.uid(),
            p_action,
            p_entity_type,
            p_entity_id,
            COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('actor_is_super_admin', public.is_super_admin())
        );
    END IF;
END;
$$;

-- 4. BIGINT-Typed Server-Side Admin & Member Management RPCs
CREATE OR REPLACE FUNCTION public.admin_list_business_members(target_business_id BIGINT)
RETURNS TABLE (
    id TEXT,
    user_id UUID,
    business_id BIGINT,
    role TEXT,
    user_email TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    is_owner BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.business_members bm_check
        WHERE bm_check.business_id = target_business_id
          AND bm_check.user_id = auth.uid()
          AND bm_check.role IN ('owner', 'admin')
    ) INTO is_owner;

    IF NOT (public.is_super_admin() OR is_owner) THEN
        RAISE EXCEPTION 'Unauthorized: Business Owner or Super Admin access required';
    END IF;

    RETURN QUERY
    SELECT bm.id::TEXT, bm.user_id, bm.business_id, bm.role::TEXT, u.email::TEXT, bm.created_at
    FROM public.business_members bm
    JOIN auth.users u ON u.id = bm.user_id
    WHERE bm.business_id = target_business_id
    ORDER BY bm.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_business_member(
    target_business_id BIGINT,
    target_email TEXT,
    target_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    matched_user_id UUID;
    is_owner BOOLEAN := FALSE;
BEGIN
    IF target_role NOT IN ('owner', 'admin', 'manager', 'staff') THEN
        RAISE EXCEPTION 'Invalid role specified';
    END IF;

    IF target_role IN ('owner', 'admin') THEN
        IF NOT public.is_super_admin() THEN
            RAISE EXCEPTION 'Unauthorized: Only Super Admins may assign Business Owners';
        END IF;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM public.business_members
            WHERE business_id = target_business_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'admin')
        ) INTO is_owner;

        IF NOT (public.is_super_admin() OR is_owner) THEN
            RAISE EXCEPTION 'Unauthorized: Business Owner or Super Admin access required';
        END IF;
    END IF;

    SELECT u.id INTO matched_user_id
    FROM auth.users u
    WHERE LOWER(u.email) = LOWER(TRIM(target_email))
    LIMIT 1;

    IF matched_user_id IS NULL THEN
        RAISE EXCEPTION 'No registered Supabase user found for that email address';
    END IF;

    -- Assumes UNIQUE(business_id, user_id) exists on public.business_members
    INSERT INTO public.business_members (business_id, user_id, role)
    VALUES (target_business_id, matched_user_id, target_role)
    ON CONFLICT (business_id, user_id)
    DO UPDATE SET role = EXCLUDED.role;

    PERFORM public.admin_log_action(
        target_business_id,
        'assign_business_member',
        'business_members',
        matched_user_id::TEXT,
        jsonb_build_object('target_email', LOWER(TRIM(target_email)), 'assigned_role', target_role)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_business_member(
    target_business_id BIGINT,
    target_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_current_role TEXT;
    is_owner BOOLEAN := FALSE;
BEGIN
    SELECT role::TEXT INTO target_current_role
    FROM public.business_members
    WHERE business_id = target_business_id AND user_id = target_user_id;

    IF target_current_role IN ('owner', 'admin') THEN
        IF NOT public.is_super_admin() THEN
            RAISE EXCEPTION 'Unauthorized: Only Super Admins may remove Business Owners';
        END IF;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM public.business_members
            WHERE business_id = target_business_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'admin')
        ) INTO is_owner;

        IF NOT (public.is_super_admin() OR is_owner) THEN
            RAISE EXCEPTION 'Unauthorized: Business Owner or Super Admin access required';
        END IF;
    END IF;

    DELETE FROM public.business_members
    WHERE business_id = target_business_id AND user_id = target_user_id;

    PERFORM public.admin_log_action(
        target_business_id,
        'remove_business_member',
        'business_members',
        target_user_id::TEXT,
        jsonb_build_object('removed_role', COALESCE(target_current_role, 'unknown'))
    );
END;
$$;

-- Verify businesses columns (slug, category, timezone, default_language, phone, email, address) before deploying
CREATE OR REPLACE FUNCTION public.admin_create_business(
    p_name TEXT,
    p_category TEXT DEFAULT 'spa_wellness',
    p_timezone TEXT DEFAULT 'America/New_York',
    p_default_language TEXT DEFAULT 'en',
    p_phone TEXT DEFAULT '',
    p_email TEXT DEFAULT '',
    p_address TEXT DEFAULT ''
)
RETURNS public.businesses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_biz public.businesses;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Super Admin access required';
    END IF;

    INSERT INTO public.businesses (
        name, slug, category, timezone, default_language, phone, email, address
    ) VALUES (
        TRIM(p_name),
        LOWER(REGEXP_REPLACE(TRIM(p_name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || SUBSTR(gen_random_uuid()::TEXT, 1, 6),
        p_category,
        p_timezone,
        CASE WHEN p_default_language = 'es' THEN 'es' ELSE 'en' END,
        p_phone,
        p_email,
        p_address
    )
    RETURNING * INTO new_biz;

    PERFORM public.admin_log_action(
        new_biz.id,
        'create_business',
        'businesses',
        new_biz.id::TEXT,
        jsonb_build_object('name', new_biz.name)
    );

    RETURN new_biz;
END;
$$;
`;

/**
 * Additive Invitations & Onboarding Migration SQL (BIGINT-compatible, for review & execution in Supabase SQL Editor).
 */
export const SUPABASE_INVITATIONS_MIGRATION_SQL = `-- =============================================================================
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

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION 'Pre-flight check failed: authenticated role does not exist.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'Pre-flight check failed: service_role does not exist.';
    END IF;

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_invitations_unique_pending
    ON public.business_invitations (business_id, LOWER(email))
    WHERE status = 'pending';

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
`;

export const SUPABASE_BUSINESS_STATUS_SQL = `-- Optional Additive Migration: Business Status & Description Columns
-- Safe and idempotent; existing settings JSONB already stores fallback values.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
`;

export const SUPABASE_SUPPORT_INCIDENTS_SQL = `-- Optional Additive Migration: Technical Support Incidents Table (BIGINT business_id)
-- Strictly accessible by verified Super Admins ONLY. Never exposed to Business Owners/Staff.

CREATE TABLE IF NOT EXISTS public.support_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id BIGINT REFERENCES public.businesses(id) ON DELETE SET NULL,
  business_name TEXT,
  reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'technical_error'
    CHECK (source IN ('business_report', 'technical_error', 'integration_failure', 'security_alert')),
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.support_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view own business support incidents" ON public.support_incidents;
DROP POLICY IF EXISTS "Super admins manage support incidents" ON public.support_incidents;
CREATE POLICY "Super admins manage support incidents" ON public.support_incidents
  FOR ALL USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
`;

export const SUPABASE_SUPPORT_SYSTEM_SQL = `-- =============================================================================
-- NOVACODE TECH — HARDENED BUSINESS SUPPORT & TECHNICAL INCIDENTS SYSTEM
-- File: supabase/migrations/20261113_support_system_hardened.sql
-- Review carefully before executing manually in the Supabase SQL Editor.
-- Preserves all existing BIGINT schemas, booking RPCs, n8n workflows, and RLS.
-- =============================================================================

-- Includes full hardened DDL, triggers, minimum grants, RLS, and Realtime publication:
-- 1. public.business_support_tickets (business_id BIGINT, created_by_name, subject 3..200 chars, description >=5 chars)
-- 2. public.support_ticket_messages (closed-ticket lock, server-derived sender_id/role/name)
-- 3. public.support_ticket_status_history (status audit trail)
-- 4. public.support_incidents (strictly Super Admin accessible; service_role/Edge Function inserts)
-- 5. public.support_notifications (is_read-only updates, bidirectional ticket read sync)
-- 6. REPLICA IDENTITY FULL + supabase_realtime publication membership.
-- See /supabase/migrations/20261113_support_system_hardened.sql in repository for the complete script.

CREATE TABLE IF NOT EXISTS public.business_support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    category TEXT NOT NULL CHECK (
        category IN (
            'general_question','technical_problem','booking_calendar_issue',
            'ai_receptionist_issue','customer_service_concern','account_access_problem',
            'feature_request','complaint','other'
        )
    ),
    subject TEXT NOT NULL CHECK (LENGTH(TRIM(subject)) BETWEEN 3 AND 200),
    description TEXT NOT NULL CHECK (LENGTH(TRIM(description)) >= 5),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_for_customer','resolved','closed')),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unread_by_business BOOLEAN NOT NULL DEFAULT FALSE,
    unread_by_admin BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.business_support_tickets(id) ON DELETE CASCADE,
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('business_owner','business_staff','super_admin')),
    sender_name TEXT,
    message TEXT NOT NULL CHECK (LENGTH(TRIM(message)) >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.business_support_tickets(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    old_status TEXT,
    new_status TEXT NOT NULL CHECK (new_status IN ('open','in_progress','waiting_for_customer','resolved','closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT REFERENCES public.businesses(id) ON DELETE SET NULL,
    business_name TEXT,
    reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'technical_error'
      CHECK (source IN ('business_report', 'technical_error', 'integration_failure', 'security_alert')),
    severity TEXT NOT NULL DEFAULT 'medium'
      CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'investigating', 'resolved')),
    title TEXT NOT NULL CHECK (LENGTH(TRIM(title)) >= 1),
    description TEXT NOT NULL DEFAULT '',
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.support_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id BIGINT REFERENCES public.businesses(id) ON DELETE CASCADE,
    target_role TEXT NOT NULL CHECK (target_role IN ('business','super_admin')),
    ticket_id UUID REFERENCES public.business_support_tickets(id) ON DELETE CASCADE,
    incident_id UUID REFERENCES public.support_incidents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
