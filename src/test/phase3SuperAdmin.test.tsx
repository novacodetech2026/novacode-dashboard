import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { SuperAdminView } from '../components/SuperAdminView';
import { containsInfrastructureTerms } from '../utils/security';

const mockUseApp = vi.fn();
vi.mock('../context/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

function buildSuperAdminMockContext(overrides: Record<string, any> = {}) {
  const language: 'en' | 'es' = overrides.language || 'en';
  const bizActive = {
    id: '101',
    name: 'Serenity Wellness Clinic',
    slug: 'serenity-wellness',
    tagline: 'Holistic Care',
    category: 'wellness',
    categoryLabelEn: 'Wellness & Clinic',
    categoryLabelEs: 'Bienestar y Clínica',
    timezone: 'America/New_York',
    defaultLanguage: 'en' as const,
    currency: 'USD',
    currencySymbol: '$',
    phone: '+1 555-0101',
    email: 'contact@serenity.test',
    address: '100 Health Way',
    isActive: true,
    settings: {
      operatingHours: {
        0: { open: '10:00', close: '16:00', isClosed: true },
        1: { open: '09:00', close: '18:00', isClosed: false },
        2: { open: '09:00', close: '18:00', isClosed: false },
        3: { open: '09:00', close: '18:00', isClosed: false },
        4: { open: '09:00', close: '18:00', isClosed: false },
        5: { open: '09:00', close: '18:00', isClosed: false },
        6: { open: '10:00', close: '15:00', isClosed: false },
      },
      cancellationBufferHours: 24,
      bufferBetweenAppointmentsMinutes: 15,
      aiAutomatedBooking: true,
      requireAtHomeAddress: false,
      communicationChannels: {
        whatsapp: {
          status: 'pending_backend',
          provider: 'whatsapp_cloud',
          displayPhoneNumber: '+1 555-0101',
          businessAccountLabel: 'Serenity WABA',
          verifiedByBackend: false,
        },
        sms: {
          status: 'not_configured',
          provider: 'twilio_a2p',
          verifiedByBackend: false,
        },
        webChat: {
          status: 'not_configured',
          enabled: false,
          verifiedByBackend: false,
        },
      },
    },
  };

  const bizSuspended = {
    id: '202',
    name: 'Apex Dental Group',
    slug: 'apex-dental',
    tagline: 'Modern Dentistry',
    category: 'dental',
    categoryLabelEn: 'Dental Clinic',
    categoryLabelEs: 'Clínica Dental',
    timezone: 'America/Chicago',
    defaultLanguage: 'es' as const,
    currency: 'USD',
    currencySymbol: '$',
    phone: '+1 555-0202',
    email: 'frontdesk@apexdental.test',
    address: '200 Smile Blvd',
    isActive: false,
    settings: {
      ...bizActive.settings,
      isSuspended: true,
      communicationChannels: undefined,
    },
  };

  return {
    language,
    setLanguage: vi.fn(),
    t: translations[language],
    theme: 'light',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    mode: 'supabase',
    setMode: vi.fn(),
    toggleMode: vi.fn(),
    currentUser: {
      id: 'sa-user-1',
      email: 'admin@novacodetech.test',
      isSuperAdmin: true,
      platformRole: 'super_admin',
      businessMemberships: [],
    },
    isSuperAdmin: true,
    isSuperAdminCheckFailed: false,
    canViewPlatformAdmin: true,
    canManageBusinessSettings: true,
    currentTenant: bizActive,
    availableTenants: [bizActive, bizSuspended],
    setCurrentTenantId: vi.fn(),
    setActiveTab: vi.fn(),
    platformMetrics: {
      totalBusinesses: 2,
      activeBusinesses: 1,
      suspendedBusinesses: 1,
      totalCustomers: 148,
      totalAppointments: 412,
      systemHealth: 'healthy',
      healthDetail: 'Supabase Auth & RLS Active',
      lastCheckedAt: '2026-11-16T10:00:00Z',
    },
    reloadPlatformMetrics: vi.fn().mockResolvedValue(undefined),
    businessOwnersByBizId: {
      '101': [
        {
          businessId: '101',
          userId: 'owner-uuid-101',
          role: 'owner',
          userEmail: 'owner@serenity.test',
          assignedAt: '2026-11-01T12:00:00Z',
        },
      ],
    },
    reloadBusinessOwners: vi.fn().mockResolvedValue(undefined),
    bookingNotificationHealth: {
      status: 'degraded',
      pendingFailures: 3,
      dueForRetry: 2,
      abandonedFailures: 1,
      recovered24h: 7,
      oldestPendingAgeSeconds: 180,
      openNotificationIncidents: 1,
      criticalDoubleFailureIncidents: 0,
      checkedAt: '2026-11-16T10:05:00Z',
      detail: '2 failed notification jobs ready for bounded worker retry.',
      recoveryWorkerStatus: 'edge_function_ready',
    },
    reloadBookingNotificationHealth: vi.fn().mockResolvedValue(undefined),
    triggerBookingNotificationRecovery: vi.fn().mockResolvedValue({
      success: false,
      requiresBackendWorker: true,
      error: 'Recovery must be executed by a backend service_role worker (pg_cron / Edge Function / n8n).',
    }),
    n8nIntegrationHealth: {
      status: 'not_verified',
      activeWorkflows: null,
      detail: 'No verified backend n8n health endpoint detected; live connectivity is never simulated.',
    },
    reloadN8nIntegrationHealth: vi.fn().mockResolvedValue(undefined),
    messagingConfigsByBizId: {
      '101': {
        businessId: '101',
        a2pStatus: 'approved',
        smsOptInEnabled: true,
        autoSendEnabled: false,
        consentDisclosureVersion: 'v1.0',
        campaignSid: 'CM1234567890abcdef',
        messagingServiceSid: 'MG1234567890abcdef',
        persistedInBackend: true,
      },
      '202': {
        businessId: '202',
        a2pStatus: 'pending_approval',
        smsOptInEnabled: true,
        autoSendEnabled: false,
        consentDisclosureVersion: 'v1.0',
        persistedInBackend: false,
      },
    },
    smsConsentSummariesByBizId: {
      '101': {
        businessId: '101',
        totalConsents: 14,
        optedInCount: 12,
        optedOutCount: 2,
        latestConsentAt: '2026-11-15T18:00:00Z',
        disclosureVersions: ['v1.0'],
        sources: ['public_web_form'],
      },
      '202': {
        businessId: '202',
        totalConsents: 0,
        optedInCount: 0,
        optedOutCount: 0,
        disclosureVersions: [],
        sources: [],
      },
    },
    smsTablesStatus: { configsTableExists: true, consentsTableExists: true },
    reloadSmsA2pOverview: vi.fn().mockResolvedValue(undefined),
    updateBusinessMessagingConfig: vi.fn().mockResolvedValue({ success: true }),
    updateBusinessCommunicationChannels: vi.fn().mockResolvedValue({ success: true }),
    platformIncidents: [
      {
        id: 'inc-1',
        businessId: '101',
        businessName: 'Serenity Wellness Clinic',
        source: 'technical_error',
        severity: 'high',
        status: 'open',
        title: 'Notification delivery retry pending',
        description: 'Retry scheduled within bounded cap.',
        createdAt: '2026-11-16T09:00:00Z',
      },
    ],
    incidentsTableExists: true,
    platformIncidentsTotalCount: 1,
    hasMorePlatformIncidents: false,
    isLoadingMorePlatformIncidents: false,
    reloadPlatformIncidents: vi.fn().mockResolvedValue(undefined),
    loadMorePlatformIncidents: vi.fn().mockResolvedValue(undefined),
    updatePlatformIncidentStatus: vi.fn().mockResolvedValue({ success: true }),
    fetchAndSelectIncident: vi.fn().mockResolvedValue(null),
    capturedTechnicalIncidents: [],
    supportTickets: [],
    supportMessagesByTicket: {},
    supportStatusHistoryByTicket: {},
    supportTicketsTableExists: true,
    supportTicketsTotalCount: 0,
    hasMoreSupportTickets: false,
    isLoadingMoreSupportTickets: false,
    reloadSupportTickets: vi.fn().mockResolvedValue(undefined),
    loadMoreSupportTickets: vi.fn().mockResolvedValue(undefined),
    loadTicketMessages: vi.fn().mockResolvedValue([]),
    loadTicketStatusHistory: vi.fn().mockResolvedValue([]),
    fetchAndSelectTicket: vi.fn().mockResolvedValue(null),
    sendTicketReply: vi.fn().mockResolvedValue({ success: true }),
    updateTicketStatus: vi.fn().mockResolvedValue({ success: true }),
    markTicketRead: vi.fn().mockResolvedValue(undefined),
    supportNotifications: [],
    pendingAdminTicketId: null,
    setPendingAdminTicketId: vi.fn(),
    pendingAdminIncidentId: null,
    setPendingAdminIncidentId: vi.fn(),
    authDiagnosticError: null,
    liveMembers: [],
    reloadBusinessMembers: vi.fn().mockResolvedValue(undefined),
    businessInvitations: [],
    reloadBusinessInvitations: vi.fn().mockResolvedValue(undefined),
    auditLogs: [],
    reloadAuditLogs: vi.fn().mockResolvedValue(undefined),
    createBusinessAsSuperAdmin: vi.fn().mockResolvedValue({ success: true, businessId: '303' }),
    toggleBusinessActive: vi.fn().mockResolvedValue({ success: true }),
    inviteBusinessOwner: vi.fn().mockResolvedValue({ success: true }),
    assignExistingUserToBusiness: vi.fn().mockResolvedValue({ success: true }),
    resendBusinessInvitation: vi.fn().mockResolvedValue({ success: true }),
    revokeBusinessInvitation: vi.fn().mockResolvedValue({ success: true }),
    removeBusinessMember: vi.fn().mockResolvedValue({ success: true }),
    supabaseConfig: { url: 'https://project.supabase.co', anonKey: 'anon-key', isConnected: true },
    updateSupabaseConfig: vi.fn().mockResolvedValue({ success: true }),
    disconnectSupabase: vi.fn(),
    addToast: vi.fn(),
    // Deliberately include private customer/appointment data on context object to ensure SuperAdminView never renders it
    customers: [
      {
        id: 'cust-secret-1',
        tenantId: '101',
        name: 'Private Patient Maria Rodriguez',
        phone: '+1-555-999-8888',
        email: 'maria@private.test',
        preferredLanguage: 'es',
        totalAppointments: 3,
        createdAt: '2026-10-01T00:00:00Z',
        lastInteractionAt: '2026-11-15T00:00:00Z',
      },
    ],
    businessNotifications: [
      {
        id: 'bn-secret-1',
        businessId: '101',
        type: 'appointment_confirmed',
        title: 'Confirmed: Private Patient Maria Rodriguez',
        description: 'Routine booking notification that Super Admin must never see',
        customerName: 'Private Patient Maria Rodriguez',
        createdAt: '2026-11-16T08:00:00Z',
        read: false,
      },
    ],
    ...overrides,
  };
}

describe('Phase 3 — Super Admin Completion & Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies access to non-Super Admin users in both English and Spanish', () => {
    mockUseApp.mockReturnValue(
      buildSuperAdminMockContext({
        canViewPlatformAdmin: false,
        isSuperAdmin: false,
        language: 'en',
      })
    );
    const { rerender } = render(<SuperAdminView />);
    expect(screen.getByText(translations.en.superAdmin.accessDeniedTitle)).toBeInTheDocument();

    mockUseApp.mockReturnValue(
      buildSuperAdminMockContext({
        canViewPlatformAdmin: false,
        isSuperAdmin: false,
        language: 'es',
      })
    );
    rerender(<SuperAdminView />);
    expect(screen.getByText(translations.es.superAdmin.accessDeniedTitle)).toBeInTheDocument();
  });

  it('renders Global Overview KPIs including active vs suspended businesses and hides customer PII / booking notifications', () => {
    const ctx = buildSuperAdminMockContext();
    mockUseApp.mockReturnValue(ctx);
    render(<SuperAdminView />);

    expect(screen.getByText('148')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText(/1 Suspended/i)).toBeInTheDocument();

    // Never expose individual customer names, phone PII, or routine appointment notifications
    expect(screen.queryByText(/Private Patient Maria Rodriguez/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+1-555-999-8888/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Routine booking notification/i)).not.toBeInTheDocument();

    // Clicking the Suspended shortcut filters list to suspended businesses only
    fireEvent.click(screen.getByRole('button', { name: /1 Suspended/i }));
    expect(screen.getByText('Apex Dental Group')).toBeInTheDocument();
    expect(screen.queryByText('Serenity Wellness Clinic')).not.toBeInTheDocument();
  });

  it('displays assigned owners inline and in the details drawer, and routes unassigned businesses to Invite Owner', () => {
    const ctx = buildSuperAdminMockContext();
    mockUseApp.mockReturnValue(ctx);
    render(<SuperAdminView />);

    // Table shows assigned owner email for Serenity and unassigned warning + quick button for Apex
    expect(screen.getByText('owner@serenity.test')).toBeInTheDocument();
    expect(screen.getByText(translations.en.superAdmin.noOwnerAssigned)).toBeInTheDocument();

    // Open details drawer for Serenity Wellness Clinic
    const detailButtons = screen.getAllByTitle('View details');
    fireEvent.click(detailButtons[0]);
    expect(screen.getAllByText('owner@serenity.test').length).toBeGreaterThanOrEqual(1);

    // Quick Invite Owner navigates to invitations tab
    fireEvent.click(screen.getByRole('button', { name: translations.en.superAdmin.inviteOwnerQuick }));
    expect(screen.getByText(translations.en.superAdmin.membersManagementTitle)).toBeInTheDocument();
  });

  it('requires explicit confirmation before suspending or activating a business and blocks unauthorized toggles', async () => {
    const ctx = buildSuperAdminMockContext();
    mockUseApp.mockReturnValue(ctx);
    render(<SuperAdminView />);

    const suspendBtn = screen.getByRole('button', { name: /Suspend Serenity Wellness Clinic/i });
    fireEvent.click(suspendBtn);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(translations.en.superAdmin.confirmToggleTitleSuspend)).toBeInTheDocument();
    expect(ctx.toggleBusinessActive).not.toHaveBeenCalled();

    // Cancel closes dialog without mutating
    fireEvent.click(within(dialog).getByRole('button', { name: translations.en.common.cancel }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(ctx.toggleBusinessActive).not.toHaveBeenCalled();

    // Confirm triggers toggleBusinessActive
    fireEvent.click(suspendBtn);
    const confirmDialog = screen.getByRole('dialog');
    fireEvent.click(
      within(confirmDialog).getByRole('button', { name: translations.en.superAdmin.confirmSuspendBtn })
    );
    await waitFor(() => {
      expect(ctx.toggleBusinessActive).toHaveBeenCalledWith('101', false);
    });

    // If isSuperAdminCheckFailed is true, toggle is refused cleanly with error toast
    const failedCtx = buildSuperAdminMockContext({ isSuperAdminCheckFailed: true });
    mockUseApp.mockReturnValue(failedCtx);
    render(<SuperAdminView />);
    const guardedBtn = screen.getAllByRole('button', { name: /Suspend Serenity Wellness Clinic/i })[1];
    fireEvent.click(guardedBtn);
    expect(failedCtx.addToast).toHaveBeenCalledWith(
      'error',
      translations.en.common.error,
      translations.en.superAdmin.accessDeniedDesc
    );
    expect(failedCtx.toggleBusinessActive).not.toHaveBeenCalled();
  });

  it('renders Communication Channels without credential inputs or fake active connections', async () => {
    const ctx = buildSuperAdminMockContext();
    mockUseApp.mockReturnValue(ctx);
    render(<SuperAdminView initialSection="channels" />);

    expect(screen.getByText(translations.en.superAdmin.channelsTitle)).toBeInTheDocument();
    expect(screen.getByText(translations.en.superAdmin.whatsappChannelLabel)).toBeInTheDocument();
    expect(screen.getByText(translations.en.superAdmin.smsChannelLabel)).toBeInTheDocument();
    expect(screen.getByText(translations.en.superAdmin.webChatChannelLabel)).toBeInTheDocument();

    // Never display simulated WhatsApp or WebChat connections as Connected when verifiedByBackend is false
    expect(screen.queryByText(translations.en.superAdmin.channelConnected)).not.toBeInTheDocument();
    expect(screen.getByText(translations.en.superAdmin.channelPendingBackend)).toBeInTheDocument();

    // Zero password/token/secret inputs exposed in the channels panel
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    expect(screen.queryByText(/TWILIO_AUTH_TOKEN|WHATSAPP_ACCESS_TOKEN|SERVICE_ROLE/i)).not.toBeInTheDocument();

    // Submitting saves non-secret channel metadata
    fireEvent.click(screen.getByRole('button', { name: /Save Channel Metadata/i }));
    await waitFor(() => {
      expect(ctx.updateBusinessCommunicationChannels).toHaveBeenCalledWith(
        '101',
        expect.objectContaining({
          whatsapp: expect.objectContaining({
            displayPhoneNumber: '+1 555-0101',
            businessAccountLabel: 'Serenity WABA',
            verifiedByBackend: false,
          }),
        })
      );
    });
  });

  it('enforces SMS / A2P outbound consent guards, shows aggregate counts without PII, and copies public opt-in links', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const ctx = buildSuperAdminMockContext();
    mockUseApp.mockReturnValue(ctx);
    render(<SuperAdminView initialSection="sms-a2p" />);

    expect(screen.getByText(translations.en.superAdmin.smsA2pTitle)).toBeInTheDocument();
    // Aggregate counts visible without patient names or phone numbers
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText(/Maria Rodriguez/i)).not.toBeInTheDocument();

    // Copy public SMS consent link for business #101
    const copyButtons = screen.getAllByRole('button', {
      name: translations.en.superAdmin.copyConsentLink,
    });
    fireEvent.click(copyButtons[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/sms-consent?business_id=101'));

    // Business #101 satisfies all prerequisites -> Auto-send checkbox is enabled and can be saved
    const autoSendCheckbox = screen.getByLabelText(/Enable Automated Outbound SMS/i) as HTMLInputElement;
    expect(autoSendCheckbox.disabled).toBe(false);
    fireEvent.click(autoSendCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Save SMS \/ A2P Policy/i }));
    await waitFor(() => {
      expect(ctx.updateBusinessMessagingConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: '101',
          a2pStatus: 'approved',
          autoSendEnabled: true,
        })
      );
    });

    // Switching to suspended business #202 with 0 consents blocks auto-send checkbox
    const bizSelect = screen.getAllByLabelText(translations.en.superAdmin.selectBusinessLabel)[0];
    fireEvent.change(bizSelect, { target: { value: '202' } });
    expect((screen.getByLabelText(/Enable Automated Outbound SMS/i) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(translations.en.superAdmin.autoSendBlockedNotice)).toBeInTheDocument();
  });

  it('displays real booking notification health, bounded recovery notice, and honest n8n unverified state', async () => {
    const ctx = buildSuperAdminMockContext();
    mockUseApp.mockReturnValue(ctx);
    render(<SuperAdminView initialSection="monitoring" />);

    expect(screen.getByText(translations.en.superAdmin.monitoringTitle)).toBeInTheDocument();
    expect(screen.getByText('degraded')).toBeInTheDocument();
    expect(screen.getByText(/edge_function_ready/)).toBeInTheDocument();
    expect(screen.getByText(translations.en.superAdmin.n8nNotVerifiedBadge)).toBeInTheDocument();
    expect(screen.queryByText(translations.en.superAdmin.n8nVerifiedBadge)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: translations.en.superAdmin.notificationRecoveryBtn })
    );
    await waitFor(() => {
      expect(ctx.triggerBookingNotificationRecovery).toHaveBeenCalled();
    });
    expect(
      screen.getByText(/Recovery must be executed by a backend service_role worker/i)
    ).toBeInTheDocument();
  });

  it('maintains Spanish translations and keeps infrastructure terminology isolated to Super Admin only', () => {
    const ctx = buildSuperAdminMockContext({ language: 'es' });
    mockUseApp.mockReturnValue(ctx);
    render(<SuperAdminView initialSection="sms-a2p" />);

    expect(screen.getByText(translations.es.superAdmin.smsA2pTitle)).toBeInTheDocument();
    const bizSelectEs = screen.getAllByLabelText(translations.es.superAdmin.selectBusinessLabel)[0];
    fireEvent.change(bizSelectEs, { target: { value: '202' } });
    expect(screen.getByText(translations.es.superAdmin.autoSendBlockedNotice)).toBeInTheDocument();

    // Verify business-facing copy in EN and ES never leaks n8n / supabase / rpc / rls
    expect(containsInfrastructureTerms(translations.en.dashboard.subtitle)).toBe(false);
    expect(containsInfrastructureTerms(translations.es.dashboard.subtitle)).toBe(false);
    expect(containsInfrastructureTerms(translations.en.helpSupport.subtitle)).toBe(false);
    expect(containsInfrastructureTerms(translations.es.helpSupport.subtitle)).toBe(false);
  });
});
