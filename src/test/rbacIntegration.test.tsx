import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import App from '../App';
import { AppProvider, useApp } from '../context/AppContext';
import { isPrivilegedServiceRoleKey } from '../utils/security';
import { Tenant } from '../types';

// ---------------------------------------------------------------------------
// Mock network boundary in ../services/supabase while preserving real AppProvider
// ---------------------------------------------------------------------------

const supabaseMocks = vi.hoisted(() => ({
  getCurrentSupabaseSession: vi.fn(),
  onSupabaseAuthStateChange: vi.fn(),
  fetchUserAccessProfile: vi.fn(),
  verifyCurrentUserIsSuperAdmin: vi.fn(),
  testSupabaseConnection: vi.fn(),
  fetchLiveAppointmentsWithStatus: vi.fn(),
  fetchLiveCustomersWithStatus: vi.fn(),
  fetchLiveServicesWithStatus: vi.fn(),
  fetchActiveServicesCountInSupabase: vi.fn(),
  fetchSupportTicketsInSupabase: vi.fn(),
  fetchSupportNotificationsInSupabase: vi.fn(),
  fetchPlatformAggregateMetricsInSupabase: vi.fn(),
  fetchPlatformIncidentsInSupabase: vi.fn(),
  fetchBusinessInvitationsInSupabase: vi.fn(),
  fetchRecentAuditLogs: vi.fn(),
  fetchBusinessMembersForTenant: vi.fn(),
  assignBusinessMemberInSupabase: vi.fn(),
  fetchAppointmentByIdInSupabase: vi.fn(),
  fetchBookingNotificationsInSupabase: vi.fn(),
  markBookingNotificationReadInSupabase: vi.fn(),
  markAllBookingNotificationsReadInSupabase: vi.fn(),
  subscribeToAppointmentsRealtime: vi.fn(),
  subscribeToBookingNotificationsRealtime: vi.fn(),
  subscribeToPlatformAppointmentsCountRealtime: vi.fn(),
  subscribeToSupportSystemRealtime: vi.fn(),
  unsubscribeRealtimeChannel: vi.fn(),
  removeAllRealtimeChannels: vi.fn(),
}));

vi.mock('../services/supabase', async () => {
  const actual = await vi.importActual<typeof import('../services/supabase')>('../services/supabase');
  return {
    ...actual,
    getCurrentSupabaseSession: (...args: any[]) => supabaseMocks.getCurrentSupabaseSession(...args),
    onSupabaseAuthStateChange: (...args: any[]) => supabaseMocks.onSupabaseAuthStateChange(...args),
    fetchUserAccessProfile: (...args: any[]) => supabaseMocks.fetchUserAccessProfile(...args),
    verifyCurrentUserIsSuperAdmin: (...args: any[]) => supabaseMocks.verifyCurrentUserIsSuperAdmin(...args),
    testSupabaseConnection: (...args: any[]) => supabaseMocks.testSupabaseConnection(...args),
    fetchLiveAppointmentsWithStatus: (...args: any[]) => supabaseMocks.fetchLiveAppointmentsWithStatus(...args),
    fetchLiveCustomersWithStatus: (...args: any[]) => supabaseMocks.fetchLiveCustomersWithStatus(...args),
    fetchLiveServicesWithStatus: (...args: any[]) => supabaseMocks.fetchLiveServicesWithStatus(...args),
    fetchActiveServicesCountInSupabase: (...args: any[]) => supabaseMocks.fetchActiveServicesCountInSupabase(...args),
    fetchSupportTicketsInSupabase: (...args: any[]) => supabaseMocks.fetchSupportTicketsInSupabase(...args),
    fetchSupportNotificationsInSupabase: (...args: any[]) => supabaseMocks.fetchSupportNotificationsInSupabase(...args),
    fetchPlatformAggregateMetricsInSupabase: (...args: any[]) =>
      supabaseMocks.fetchPlatformAggregateMetricsInSupabase(...args),
    fetchPlatformIncidentsInSupabase: (...args: any[]) => supabaseMocks.fetchPlatformIncidentsInSupabase(...args),
    fetchBusinessInvitationsInSupabase: (...args: any[]) => supabaseMocks.fetchBusinessInvitationsInSupabase(...args),
    fetchRecentAuditLogs: (...args: any[]) => supabaseMocks.fetchRecentAuditLogs(...args),
    fetchBusinessMembersForTenant: (...args: any[]) => supabaseMocks.fetchBusinessMembersForTenant(...args),
    assignBusinessMemberInSupabase: (...args: any[]) => supabaseMocks.assignBusinessMemberInSupabase(...args),
    fetchAppointmentByIdInSupabase: (...args: any[]) => supabaseMocks.fetchAppointmentByIdInSupabase(...args),
    fetchBookingNotificationsInSupabase: (...args: any[]) => supabaseMocks.fetchBookingNotificationsInSupabase(...args),
    markBookingNotificationReadInSupabase: (...args: any[]) => supabaseMocks.markBookingNotificationReadInSupabase(...args),
    markAllBookingNotificationsReadInSupabase: (...args: any[]) =>
      supabaseMocks.markAllBookingNotificationsReadInSupabase(...args),
    subscribeToAppointmentsRealtime: (...args: any[]) => supabaseMocks.subscribeToAppointmentsRealtime(...args),
    subscribeToBookingNotificationsRealtime: (...args: any[]) =>
      supabaseMocks.subscribeToBookingNotificationsRealtime(...args),
    subscribeToPlatformAppointmentsCountRealtime: (...args: any[]) =>
      supabaseMocks.subscribeToPlatformAppointmentsCountRealtime(...args),
    subscribeToSupportSystemRealtime: (...args: any[]) => supabaseMocks.subscribeToSupportSystemRealtime(...args),
    unsubscribeRealtimeChannel: (...args: any[]) => supabaseMocks.unsubscribeRealtimeChannel(...args),
    removeAllRealtimeChannels: (...args: any[]) => supabaseMocks.removeAllRealtimeChannels(...args),
  };
});

const SALON_NAOMI_TENANT: Tenant = {
  id: '42',
  name: 'Salon Naomi',
  slug: 'salon-naomi',
  logo: '',
  tagline: 'Hair & Beauty Studio',
  description: 'Full-service hair styling and beauty appointments.',
  category: 'salon',
  categoryLabelEn: 'Hair Salon',
  categoryLabelEs: 'Salón de Belleza',
  timezone: 'America/New_York',
  defaultLanguage: 'en',
  currency: 'USD',
  currencySymbol: '$',
  phone: '+1 305-555-0142',
  email: 'appointments@salonnaomi.com',
  address: '420 Collins Ave, Miami, FL',
  website: 'https://salonnaomi.com',
  isActive: true,
  settings: {
    operatingHours: {
      0: { open: '10:00', close: '16:00', isClosed: true },
      1: { open: '09:00', close: '18:00', isClosed: false },
      2: { open: '09:00', close: '18:00', isClosed: false },
      3: { open: '09:00', close: '18:00', isClosed: false },
      4: { open: '09:00', close: '18:00', isClosed: false },
      5: { open: '09:00', close: '19:00', isClosed: false },
      6: { open: '09:00', close: '17:00', isClosed: false },
    },
    specialHours: [],
    cancellationBufferHours: 24,
    bufferBetweenAppointmentsMinutes: 15,
    aiAutomatedBooking: true,
    requireAtHomeAddress: false,
  },
};

const FORBIDDEN_INFRA_UI_PATTERNS = [
  /supabase/i,
  /anon key/i,
  /service_role/i,
  /database schema/i,
  /\bsql\b/i,
  /\brls\b/i,
  /disconnect supabase/i,
  /test & connect/i,
  /data mode/i,
  /demo mode/i,
  /is_super_admin/i,
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('novacode_mode', 'supabase');
  localStorage.setItem(
    'novacode_supabase_config',
    JSON.stringify({
      url: 'https://novacode-prod.supabase.co',
      anonKey: 'public-anon-jwt-token',
      isConnected: true,
    })
  );
  window.history.replaceState({}, '', '/');

  supabaseMocks.onSupabaseAuthStateChange.mockReturnValue({ unsubscribe: vi.fn() });
  supabaseMocks.fetchLiveAppointmentsWithStatus.mockResolvedValue({ items: [], error: null });
  supabaseMocks.fetchLiveCustomersWithStatus.mockResolvedValue({ items: [], error: null });
  supabaseMocks.fetchLiveServicesWithStatus.mockResolvedValue({
    items: [
      {
        id: 'svc-naomi-1',
        tenantId: '42',
        nameEn: 'Signature Blowout',
        nameEs: 'Secado Signature',
        descriptionEn: 'Wash and blowout styling',
        descriptionEs: 'Lavado y secado',
        durationMinutes: 45,
        price: 65,
        category: 'Hair',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: true,
      },
    ],
    error: null,
  });
  supabaseMocks.fetchActiveServicesCountInSupabase.mockResolvedValue(1);
  supabaseMocks.fetchSupportTicketsInSupabase.mockResolvedValue({
    tickets: [],
    tableExists: true,
    error: null,
  });
  supabaseMocks.fetchSupportNotificationsInSupabase.mockResolvedValue({
    notifications: [],
    tableExists: true,
    error: null,
  });
  supabaseMocks.fetchPlatformAggregateMetricsInSupabase.mockResolvedValue({
    totalBusinesses: 3,
    activeBusinesses: 3,
    totalCustomers: 120,
    totalAppointments: 450,
    systemHealth: 'healthy',
    healthDetail: 'Operational',
    lastCheckedAt: '2026-11-13T18:00:00Z',
  });
  supabaseMocks.fetchPlatformIncidentsInSupabase.mockResolvedValue({
    incidents: [],
    tableExists: true,
  });
  supabaseMocks.fetchBusinessInvitationsInSupabase.mockResolvedValue({
    invitations: [],
    error: null,
  });
  supabaseMocks.fetchRecentAuditLogs.mockResolvedValue([]);
  supabaseMocks.fetchBusinessMembersForTenant.mockResolvedValue([
    {
      id: 'mem-owner-42',
      businessId: '42',
      userId: 'owner-naomi-id',
      userEmail: 'naomi@salonnaomi.com',
      role: 'owner',
      createdAt: '2026-11-01T00:00:00Z',
    },
  ]);
  supabaseMocks.fetchAppointmentByIdInSupabase.mockResolvedValue({ appointment: null });
  supabaseMocks.fetchBookingNotificationsInSupabase.mockResolvedValue({
    notifications: [],
    tableExists: true,
  });
  supabaseMocks.markBookingNotificationReadInSupabase.mockResolvedValue({ success: true });
  supabaseMocks.markAllBookingNotificationsReadInSupabase.mockResolvedValue({ success: true });
  supabaseMocks.subscribeToAppointmentsRealtime.mockReturnValue(null);
  supabaseMocks.subscribeToBookingNotificationsRealtime.mockReturnValue(null);
  supabaseMocks.subscribeToPlatformAppointmentsCountRealtime.mockReturnValue(null);
  supabaseMocks.subscribeToSupportSystemRealtime.mockReturnValue(null);
  supabaseMocks.unsubscribeRealtimeChannel.mockResolvedValue(undefined);
  supabaseMocks.removeAllRealtimeChannels.mockResolvedValue(undefined);
  supabaseMocks.verifyCurrentUserIsSuperAdmin.mockResolvedValue({ isSuperAdmin: false });
  supabaseMocks.testSupabaseConnection.mockResolvedValue({
    success: true,
    message: 'Connected',
    normalizedUrl: 'https://novacode-prod.supabase.co',
  });
});

describe('Full Rendered Application RBAC Verification (Real AppProvider + App)', () => {
  it('Persona 1 — Business Owner (Salon Naomi): renders clean Business Settings, hides header/sidebar infra badges, and blocks /infrastructure URL & state manipulation', async () => {
    window.history.replaceState({}, '', '/infrastructure');

    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'owner-token' },
      user: { id: 'owner-naomi-id', email: 'naomi@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [
        {
          id: 'mem-owner-42',
          businessId: '42',
          userId: 'owner-naomi-id',
          userEmail: 'naomi@salonnaomi.com',
          role: 'owner',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
      accessibleBusinesses: [SALON_NAOMI_TENANT],
    });

    const { container } = render(<App />);

    // Wait for Salon Naomi session to resolve; /infrastructure must redirect to Overview & clean URL to '/'
    await waitFor(() => {
      expect(screen.getAllByText('Salon Naomi').length).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });

    // Platform Admin, Support Center, Support & Incidents, Infrastructure, and Live/Demo badges must NOT exist
    expect(screen.queryByText('Platform Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Support Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Infrastructure')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Open Platform Infrastructure')).not.toBeInTheDocument();
    expect(screen.getAllByText('Business Owner').length).toBeGreaterThanOrEqual(1);

    // Navigate to Salon Naomi -> Business Settings via Sidebar
    const settingsNavButtons = screen.getAllByRole('button', { name: /^Business Settings$/i });
    fireEvent.click(settingsNavButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Business Settings' })).toBeInTheDocument();
    });

    // Verify all 6 business sections exist inside <main> SettingsView and Salon Naomi data is loaded
    const mainView = within(container.querySelector('main')!);
    expect(mainView.getByDisplayValue('Salon Naomi')).toBeInTheDocument();
    expect(mainView.getByRole('button', { name: 'Business Profile' })).toBeInTheDocument();
    expect(mainView.getByRole('button', { name: 'Operating Hours' })).toBeInTheDocument();
    expect(mainView.getByRole('button', { name: 'Services' })).toBeInTheDocument();
    expect(mainView.getByRole('button', { name: 'Team & Staff' })).toBeInTheDocument();
    expect(mainView.getByRole('button', { name: 'Business Preferences' })).toBeInTheDocument();
    expect(mainView.getByRole('button', { name: 'Help & Support' })).toBeInTheDocument();

    // Verify Services section inside Salon Naomi Business Settings shows Salon Naomi's live service
    fireEvent.click(mainView.getByRole('button', { name: 'Services' }));
    expect(await mainView.findByText('Signature Blowout')).toBeInTheDocument();

    // Verify zero infrastructure strings anywhere in the rendered application DOM
    for (const pattern of FORBIDDEN_INFRA_UI_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }

    // Attempt browser popstate manipulation to /admin, /support-center, /incidents and /infrastructure
    act(() => {
      window.history.pushState({}, '', '/support-center');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
    expect(screen.queryByText('Supabase Database & Multi-Tenant Backend')).not.toBeInTheDocument();

    act(() => {
      window.history.pushState({}, '', '/admin');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
    expect(screen.queryByText('Supabase Database & Multi-Tenant Backend')).not.toBeInTheDocument();
  });

  it('Persona 1b — Business Owner Context Guards: blocks setMode("demo"), updateSupabaseConfig, disconnectSupabase, and owner privilege escalation', async () => {
    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'owner-token' },
      user: { id: 'owner-naomi-id', email: 'naomi@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [
        {
          id: 'mem-owner-42',
          businessId: '42',
          userId: 'owner-naomi-id',
          userEmail: 'naomi@salonnaomi.com',
          role: 'owner',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
      accessibleBusinesses: [SALON_NAOMI_TENANT],
    });

    let capturedCtx: ReturnType<typeof useApp> | null = null;
    const ContextProbe: React.FC = () => {
      const ctx = useApp();
      useEffect(() => {
        capturedCtx = ctx;
      }, [ctx]);
      return <div data-testid="probe-mode">{ctx.mode}:{ctx.activeTab}:{String(ctx.supabaseConfig.isConnected)}</div>;
    };

    render(
      <AppProvider>
        <ContextProbe />
      </AppProvider>
    );

    await waitFor(() => {
      expect(capturedCtx?.currentUser?.email).toBe('naomi@salonnaomi.com');
    });

    // Attempt switching mode to demo -> blocked for authenticated Business Owner
    act(() => {
      capturedCtx!.setMode('demo');
      capturedCtx!.setActiveTab('infrastructure');
      capturedCtx!.disconnectSupabase();
    });

    expect(capturedCtx!.mode).toBe('supabase');
    expect(capturedCtx!.activeTab).toBe('overview');
    expect(capturedCtx!.supabaseConfig.isConnected).toBe(true);

    // Attempt calling updateSupabaseConfig -> blocked
    let configRes: { success: boolean; message: string } | undefined;
    await act(async () => {
      configRes = await capturedCtx!.updateSupabaseConfig('https://evil.supabase.co', 'anon-key');
    });
    expect(configRes?.success).toBe(false);
    expect(supabaseMocks.testSupabaseConnection).not.toHaveBeenCalled();

    // Attempt privilege escalation to 'owner' via assignBusinessMember -> blocked
    let roleEscalationRes: { success: boolean; error?: string } | undefined;
    await act(async () => {
      roleEscalationRes = await capturedCtx!.assignBusinessMember('42', 'attacker@example.com', 'owner');
    });
    expect(roleEscalationRes?.success).toBe(false);
    expect(supabaseMocks.assignBusinessMemberInSupabase).not.toHaveBeenCalled();
  });

  it('Persona 1c — Diagnostic Sanitization: hides raw RPC/SQL errors from non-Super-Admin banners and toasts', async () => {
    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'owner-token' },
      user: { id: 'owner-naomi-id', email: 'naomi@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [],
      accessibleBusinesses: [],
      superAdminCheckError: 'Super Admin check (rpc.is_super_admin) failed: PGRST202 function not found in schema',
    });

    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Workspace Verification Needed').length).toBeGreaterThanOrEqual(1);
    });

    const text = container.textContent || '';
    expect(text).not.toContain('rpc.is_super_admin');
    expect(text).not.toContain('PGRST202');
    expect(text).not.toContain('Super Admin check');
  });

  it('Persona 2 — Staff (Salon Naomi): blocks /settings, /admin, and /infrastructure and hides Settings & Infrastructure navigation', async () => {
    window.history.replaceState({}, '', '/settings');

    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'staff-token' },
      user: { id: 'staff-naomi-id', email: 'stylist@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [
        {
          id: 'mem-staff-42',
          businessId: '42',
          userId: 'staff-naomi-id',
          userEmail: 'stylist@salonnaomi.com',
          role: 'staff',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
      accessibleBusinesses: [SALON_NAOMI_TENANT],
    });

    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Staff Member').length).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });

    expect(screen.queryByRole('heading', { name: 'Business Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Business Settings$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Platform Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Support Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Infrastructure')).not.toBeInTheDocument();

    for (const pattern of FORBIDDEN_INFRA_UI_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }
  });

  it('Persona 3 — Unauthenticated User: cleans direct /infrastructure URL to "/", blocks Settings & Admin, and exposes zero infrastructure UI', async () => {
    window.history.replaceState({}, '', '/infrastructure');

    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: null,
      user: null,
    });

    const { container } = render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });

    expect(screen.getAllByRole('button', { name: /Sign In/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('heading', { name: 'Business Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Business Settings$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Platform Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Infrastructure')).not.toBeInTheDocument();

    for (const pattern of FORBIDDEN_INFRA_UI_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }
  });

  it('Persona 4 — Verified Super Admin: accesses Platform Administration -> Infrastructure via is_super_admin() and still rejects service_role keys', async () => {
    window.history.replaceState({}, '', '/infrastructure');

    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'super-admin-token' },
      user: { id: 'super-admin-id', email: 'novacodetechllc@gmail.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: true,
      memberships: [],
      accessibleBusinesses: [SALON_NAOMI_TENANT],
    });
    supabaseMocks.verifyCurrentUserIsSuperAdmin.mockResolvedValue({ isSuperAdmin: true });

    render(<App />);

    // Verified Super Admin lands directly on Platform Administration -> Infrastructure
    expect(await screen.findByText('Supabase Database & Multi-Tenant Backend')).toBeInTheDocument();
    expect(screen.getByText('SQL Migrations & RLS Schema Review')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/infrastructure');

    // Verify service_role key detection blocks both literal and JWT-encoded service_role keys
    const serviceRolePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    const serviceRoleJwt = `eyJhbGciOiJIUzI1NiJ9.${serviceRolePayload}.signature`;
    expect(isPrivilegedServiceRoleKey(serviceRoleJwt)).toBe(true);
    expect(isPrivilegedServiceRoleKey('sbp_service_role_secret_123')).toBe(true);

    const keyInput = screen.getByPlaceholderText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
    fireEvent.change(keyInput, { target: { value: serviceRoleJwt } });
    fireEvent.click(screen.getByRole('button', { name: /Test & Connect Database/i }));

    // Connection test must NOT be called with a privileged service_role key
    expect(supabaseMocks.testSupabaseConnection).not.toHaveBeenCalled();
  });
});
