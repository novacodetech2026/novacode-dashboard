import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import {
  canAccessTab,
  resolveTabFromPathname,
  sanitizeErrorForBusiness,
  containsInfrastructureTerms,
  validateSupportTicketInput,
} from '../utils/security';
import {
  shiftDateString,
  shiftMonthDateString,
  getCalendarMonthGrid,
  getWeekDates,
} from '../utils/dateTime';
import {
  mapRowToCustomer,
  mapRowToSupportTicket,
  createBookingWithSupabase,
  getSupabaseClient,
  buildSupportRealtimeSubscriptions,
  subscribeToSupportSystemRealtime,
  unsubscribeRealtimeChannel,
} from '../services/supabase';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CustomersView } from '../components/CustomersView';
import { CalendarView } from '../components/CalendarView';
import { AiAssistantView } from '../components/AiAssistantView';
import { DashboardView } from '../components/DashboardView';
import { HelpSupportView } from '../components/HelpSupportView';
import { TopHeader } from '../components/TopHeader';
import { AuthModal } from '../components/AuthModal';
import { SuperAdminView } from '../components/SuperAdminView';
import { SettingsView } from '../components/SettingsView';
import { Sidebar } from '../components/Sidebar';

// ---------------------------------------------------------------------------
// Shared Mock AppContext Factory
// ---------------------------------------------------------------------------

const mockUseApp = vi.fn();
vi.mock('../context/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

function buildMockContext(overrides: Record<string, any> = {}) {
  const language: 'en' | 'es' = overrides.language || 'en';
  const tenant = {
    id: '1',
    name: 'Novacode Demo Studio',
    slug: 'demo-studio',
    tagline: 'Wellness & Spa',
    category: 'spa',
    categoryLabelEn: 'Spa & Wellness',
    categoryLabelEs: 'Spa y Bienestar',
    timezone: 'America/New_York',
    defaultLanguage: 'en' as const,
    currency: 'USD',
    currencySymbol: '$',
    phone: '+1 555-0100',
    email: 'hello@demostudio.com',
    address: '123 Main St',
    website: 'https://demostudio.com',
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
      specialHours: [],
      cancellationBufferHours: 24,
      bufferBetweenAppointmentsMinutes: 15,
      aiAutomatedBooking: true,
      requireAtHomeAddress: true,
    },
    ...(overrides.currentTenant || {}),
  };

  return {
    language,
    setLanguage: vi.fn(),
    t: translations[language],
    theme: 'light',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    mode: 'demo',
    setMode: vi.fn(),
    toggleMode: vi.fn(),
    currentUser: {
      id: 'user-owner-1',
      email: 'owner@demostudio.com',
      role: 'owner',
      isSuperAdmin: false,
      effectiveRole: 'owner',
      businessIds: ['1'],
    },
    authSession: null,
    isAuthLoading: false,
    isAuthModalOpen: false,
    setIsAuthModalOpen: vi.fn(),
    isPasswordRecoveryMode: false,
    setIsPasswordRecoveryMode: vi.fn(),
    recoveryError: null,
    setRecoveryError: vi.fn(),
    isInvitationOnboardingMode: false,
    setIsInvitationOnboardingMode: vi.fn(),
    invitationError: null,
    setInvitationError: vi.fn(),
    hasNoBusinessMembership: false,
    authDiagnosticError: null,
    isSuperAdminCheckFailed: false,
    effectiveRole: 'owner',
    isSuperAdmin: false,
    canViewPlatformAdmin: false,
    canManageBusinessSettings: true,
    canManageServices: true,
    canManageStaff: true,
    loginWithSupabase: vi.fn().mockResolvedValue({ success: true }),
    signupWithSupabase: vi.fn().mockResolvedValue({ success: true }),
    requestPasswordReset: vi.fn().mockResolvedValue({ success: true }),
    completePasswordUpdate: vi.fn().mockResolvedValue({ success: true }),
    completeInvitationOnboarding: vi.fn().mockResolvedValue({ success: true }),
    refreshAccessProfile: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    liveMembers: [],
    reloadBusinessMembers: vi.fn().mockResolvedValue(undefined),
    assignBusinessMember: vi.fn().mockResolvedValue({ success: true }),
    removeBusinessMember: vi.fn().mockResolvedValue({ success: true }),
    businessInvitations: [],
    reloadBusinessInvitations: vi.fn().mockResolvedValue(undefined),
    inviteBusinessOwner: vi.fn().mockResolvedValue({ success: true }),
    assignExistingUserToBusiness: vi.fn().mockResolvedValue({ success: true }),
    resendBusinessInvitation: vi.fn().mockResolvedValue({ success: true }),
    revokeBusinessInvitation: vi.fn().mockResolvedValue({ success: true }),
    createBusinessAsSuperAdmin: vi.fn().mockResolvedValue({ success: true, businessId: '2' }),
    toggleBusinessActive: vi.fn().mockResolvedValue({ success: true }),
    auditLogs: [],
    reloadAuditLogs: vi.fn().mockResolvedValue(undefined),
    platformMetrics: {
      totalBusinesses: 2,
      activeBusinesses: 2,
      totalCustomers: 10,
      totalAppointments: 20,
      systemHealth: 'healthy',
      healthDetail: 'Operational',
      lastCheckedAt: new Date().toISOString(),
    },
    reloadPlatformMetrics: vi.fn().mockResolvedValue(undefined),
    platformIncidents: [],
    incidentsTableExists: true,
    platformIncidentsTotalCount: 0,
    hasMorePlatformIncidents: false,
    isLoadingMorePlatformIncidents: false,
    reloadPlatformIncidents: vi.fn().mockResolvedValue(undefined),
    loadMorePlatformIncidents: vi.fn().mockResolvedValue(undefined),
    updatePlatformIncidentStatus: vi.fn().mockResolvedValue({ success: true }),
    fetchAndSelectIncident: vi.fn().mockResolvedValue(null),
    capturedTechnicalIncidents: [],
    captureTechnicalIncident: vi.fn(),
    businessNotifications: [],
    markSingleBusinessNotificationRead: vi.fn().mockResolvedValue(undefined),
    markBusinessNotificationsRead: vi.fn(),
    openAppointmentFromNotification: vi.fn().mockResolvedValue(undefined),
    supportTickets: [],
    supportMessagesByTicket: {},
    supportStatusHistoryByTicket: {},
    supportTicketsTableExists: true,
    supportTicketsTotalCount: 0,
    hasMoreSupportTickets: false,
    isLoadingMoreSupportTickets: false,
    reloadSupportTickets: vi.fn().mockResolvedValue(undefined),
    loadMoreSupportTickets: vi.fn().mockResolvedValue(undefined),
    createSupportTicket: vi.fn().mockResolvedValue({ success: true }),
    loadTicketMessages: vi.fn().mockResolvedValue([]),
    loadTicketStatusHistory: vi.fn().mockResolvedValue([]),
    fetchAndSelectTicket: vi.fn().mockResolvedValue(null),
    sendTicketReply: vi.fn().mockResolvedValue({ success: true }),
    updateTicketStatus: vi.fn().mockResolvedValue({ success: true }),
    markTicketRead: vi.fn().mockResolvedValue(undefined),
    supportNotifications: [],
    markSingleSupportNotificationRead: vi.fn().mockResolvedValue(undefined),
    markSupportNotificationsRead: vi.fn().mockResolvedValue(undefined),
    pendingAdminTicketId: null,
    setPendingAdminTicketId: vi.fn(),
    pendingAdminIncidentId: null,
    setPendingAdminIncidentId: vi.fn(),
    currentTenant: tenant,
    availableTenants: [tenant],
    setCurrentTenantId: vi.fn(),
    updateTenantSettings: vi.fn().mockResolvedValue(undefined),
    saveBusinessProfile: vi.fn().mockResolvedValue({ success: true }),
    saveWeeklyBusinessHours: vi.fn().mockResolvedValue({ success: true }),
    saveSpecialHours: vi.fn().mockResolvedValue({ success: true }),
    saveBookingPolicies: vi.fn().mockResolvedValue({ success: true }),
    customers: [],
    services: [
      {
        id: 'svc-1',
        tenantId: '1',
        nameEn: 'Consultation',
        nameEs: 'Consulta',
        descriptionEn: 'Initial session',
        descriptionEs: 'Sesión inicial',
        durationMinutes: 60,
        price: 100,
        category: 'General',
        allowsInBusiness: true,
        allowsAtHome: true,
        active: true,
      },
    ],
    activeServicesCount: 1,
    staff: [],
    appointments: [],
    conversations: [],
    chatMessages: {},
    isLoadingLiveData: false,
    liveDataError: null,
    liveDataErrorType: null,
    reloadLiveAppointments: vi.fn().mockResolvedValue(undefined),
    addAppointment: vi.fn().mockResolvedValue({ success: true }),
    updateAppointmentStatus: vi.fn().mockResolvedValue({ success: true }),
    rescheduleAppointment: vi.fn().mockResolvedValue({ success: true }),
    cancelAppointment: vi.fn().mockResolvedValue({ success: true }),
    addCustomer: vi.fn().mockResolvedValue(undefined),
    updateCustomerNotes: vi.fn().mockResolvedValue({ success: true }),
    addService: vi.fn().mockResolvedValue({ success: true }),
    updateService: vi.fn().mockResolvedValue({ success: true }),
    isBookingConflict: vi.fn().mockReturnValue(false),
    takeOverConversation: vi.fn(),
    returnConversationToAi: vi.fn(),
    sendChatMessage: vi.fn(),
    activeConversationId: null,
    setActiveConversationId: vi.fn(),
    integrationStatus: { whatsappConnected: true, calendarSynced: true, aiActive: true },
    supabaseConfig: { url: '', anonKey: '', isConnected: false },
    updateSupabaseConfig: vi.fn().mockResolvedValue({ success: true }),
    disconnectSupabase: vi.fn(),
    toasts: [],
    addToast: vi.fn(),
    removeToast: vi.fn(),
    activeTab: 'overview',
    setActiveTab: vi.fn(),
    isSidebarCollapsed: false,
    setIsSidebarCollapsed: vi.fn(),
    isNewBookingModalOpen: false,
    setIsNewBookingModalOpen: vi.fn(),
    selectedAppointmentForDetail: null,
    setSelectedAppointmentForDetail: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Role-Based Access Control & Strict Super Admin Separation
// ---------------------------------------------------------------------------

describe('RBAC & Strict Super Admin Separation', () => {
  it('allows Super Admin on platform tabs and blocks Business Owners and Staff from /admin, /incidents, /infrastructure', () => {
    expect(canAccessTab('admin', 'super_admin')).toBe(true);
    expect(canAccessTab('incidents', 'super_admin')).toBe(true);
    expect(canAccessTab('infrastructure', 'super_admin')).toBe(true);

    expect(canAccessTab('admin', 'owner')).toBe(false);
    expect(canAccessTab('incidents', 'owner')).toBe(false);
    expect(canAccessTab('infrastructure', 'owner')).toBe(false);

    expect(canAccessTab('admin', 'staff')).toBe(false);
    expect(canAccessTab('settings', 'staff')).toBe(false);
    expect(canAccessTab('settings', 'owner')).toBe(true);
    expect(canAccessTab('support', 'owner')).toBe(true);
    expect(canAccessTab('support', 'staff')).toBe(true);
  });

  it('redirects direct URL path navigation (/admin, /incidents, /infrastructure, /settings) safely when unauthorized', () => {
    expect(
      resolveTabFromPathname(
        '/admin',
        { canViewPlatformAdmin: false, canManageBusinessSettings: true },
        'owner'
      )
    ).toBe('overview');

    expect(
      resolveTabFromPathname(
        '/infrastructure',
        { canViewPlatformAdmin: false, canManageBusinessSettings: true },
        'owner'
      )
    ).toBe('overview');

    expect(
      resolveTabFromPathname(
        '/settings',
        { canViewPlatformAdmin: false, canManageBusinessSettings: false },
        'staff'
      )
    ).toBe('overview');

    expect(
      resolveTabFromPathname(
        '/support',
        { canViewPlatformAdmin: false, canManageBusinessSettings: false },
        'staff'
      )
    ).toBe('support');

    expect(
      resolveTabFromPathname(
        '/admin',
        { canViewPlatformAdmin: true, canManageBusinessSettings: true },
        'super_admin'
      )
    ).toBe('admin');
  });

  it('renders Access Denied guard if SuperAdminView is ever mounted without canViewPlatformAdmin', () => {
    mockUseApp.mockReturnValue(buildMockContext({ canViewPlatformAdmin: false }));
    render(<SuperAdminView initialSection="businesses" />);
    expect(screen.getByText(translations.en.superAdmin.accessDeniedTitle)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Zero Technical Infrastructure Leakage on Business Dashboards
// ---------------------------------------------------------------------------

describe('Zero Technical Infrastructure Leakage on Business UI', () => {
  const FORBIDDEN_PATTERNS = [
    /supabase/i,
    /\bn8n\b/i,
    /\bgemini\b/i,
    /whatsapp cloud/i,
    /business_members/i,
    /platform_admins/i,
    /\bpg_?\w+/i,
    /demo mode/i,
    /\brpc\b/i,
    /\brls\b/i,
  ];

  it('contains zero technical infrastructure terms across Business Views & Header', () => {
    mockUseApp.mockReturnValue(
      buildMockContext({
        mode: 'supabase',
        supabaseConfig: { url: 'https://proj.supabase.co', anonKey: 'abc', isConnected: true },
        canViewPlatformAdmin: false,
      })
    );

    const { container: dash } = render(<DashboardView />);
    const { container: ai } = render(<AiAssistantView />);
    const { container: cust } = render(<CustomersView />);
    const { container: cal } = render(<CalendarView />);
    const { container: sup } = render(<HelpSupportView />);
    const { container: hdr } = render(<TopHeader onOpenMobileMenu={vi.fn()} />);
    const { container: auth } = render(<AuthModal isOpen={true} onClose={vi.fn()} />);

    const combinedText = [dash, ai, cust, cal, sup, hdr, auth]
      .map(el => el.textContent || '')
      .join('\n');

    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(combinedText).not.toMatch(pattern);
    }

    // Confirm AI Receptionist branding (not AI Assistant)
    expect(ai.textContent).toContain('AI Receptionist');
    expect(ai.textContent).not.toContain('AI Assistant');
  });

  it('sanitizes low-level SQL/RLS errors into safe business messages while retaining technical detail for Super Admin', () => {
    const sanitizedRls = sanitizeErrorForBusiness(
      { code: '42501', message: 'new row violates row-level security policy for table "customers"' },
      'en'
    );
    expect(sanitizedRls.errorType).toBe('permission');
    expect(containsInfrastructureTerms(sanitizedRls.userMessage)).toBe(false);
    expect(sanitizedRls.technicalDetail).toContain('42501');

    const sanitizedMissingTable = sanitizeErrorForBusiness(
      { code: '42P01', message: 'relation "public.support_tickets" does not exist' },
      'en'
    );
    expect(containsInfrastructureTerms(sanitizedMissingTable.userMessage)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. CustomersView Null-Safety, Empty/Error States & ErrorBoundary
// ---------------------------------------------------------------------------

describe('CustomersView Null-Safety & ErrorBoundary Resilience', () => {
  it('safely maps database customer rows with null/undefined fields without crashing', () => {
    const mapped = mapRowToCustomer({
      id: 'cust-1',
      business_id: 1,
      name: null,
      phone: null,
      email: null,
      total_appointments: null,
    });

    expect(mapped.name).toBe('Unnamed Customer');
    expect(mapped.phone).toBe('');
    expect(mapped.email).toBe('');
    expect(mapped.totalAppointments).toBe(0);
  });

  it('renders CustomersView safely even when customer records contain null fields and user types in search', () => {
    mockUseApp.mockReturnValue(
      buildMockContext({
        customers: [
          {
            id: 'cust-null',
            tenantId: '1',
            name: null as any,
            phone: null as any,
            email: null as any,
            preferredLanguage: 'en',
            totalAppointments: null as any,
            lastInteractionAt: new Date().toISOString(),
            notes: '',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'cust-valid',
            tenantId: '1',
            name: 'Camila Rojas',
            phone: '+1 555-2211',
            email: 'camila@example.com',
            preferredLanguage: 'es',
            totalAppointments: 3,
            lastInteractionAt: new Date().toISOString(),
            notes: 'VIP',
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );

    render(<CustomersView />);
    const searchInput = screen.getByPlaceholderText(translations.en.customers.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'Camila' } });
    expect(screen.getByText('Camila Rojas')).toBeInTheDocument();
  });

  it('shows exact clean empty state when no customers exist', () => {
    mockUseApp.mockReturnValue(buildMockContext({ customers: [] }));
    render(<CustomersView />);
    expect(screen.getByText('No customers yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Customers will appear here as they interact with your business.')
    ).toBeInTheDocument();
  });

  it('shows clean permission or connection retry state on live query errors', () => {
    const reloadSpy = vi.fn();
    mockUseApp.mockReturnValue(
      buildMockContext({
        mode: 'supabase',
        customers: [],
        liveDataError: 'Unable to load right now.',
        liveDataErrorType: 'connection',
        reloadLiveAppointments: reloadSpy,
      })
    );

    render(<CustomersView />);
    const retryBtn = screen.getByText('Retry');
    fireEvent.click(retryBtn);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('ErrorBoundary catches crashes gracefully without exposing stack traces and reports technical incident internally', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const captureSpy = vi.fn();

    const BrokenView: React.FC = () => {
      throw new Error('Synthetic TypeError in view render');
    };

    render(
      <ErrorBoundary viewKey="customers" language="en" onCaptureIncident={captureSpy}>
        <BrokenView />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this section right now");
    expect(screen.getByRole('alert').textContent).not.toContain('Synthetic TypeError');
    expect(captureSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 4. CalendarView Date Utilities, Views, Status Colors & Filter Visibility
// ---------------------------------------------------------------------------

describe('CalendarView Redesign & Timezone-Safe Date Utilities', () => {
  it('computes weekday-aligned Month grids and timezone-safe date shifts accurately', () => {
    expect(shiftDateString('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftMonthDateString('2026-01-31', 1)).toBe('2026-02-28');

    const week = getWeekDates('2026-11-11'); // Wednesday -> Sun Nov 8 .. Sat Nov 14
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-11-08');
    expect(week[6]).toBe('2026-11-14');

    const monthCells = getCalendarMonthGrid('2026-11-15');
    expect(monthCells.length % 7).toBe(0);
    expect(monthCells[0].dayOfWeek).toBe(0); // Sunday aligned
    expect(monthCells.some(c => c.dateStr === '2026-11-01' && c.isCurrentMonth)).toBe(true);
  });

  it('hides Staff and Online location filters when no real staff or online appointments exist', () => {
    mockUseApp.mockReturnValue(
      buildMockContext({
        staff: [],
        appointments: [
          {
            id: 'apt-1',
            tenantId: '1',
            customerId: 'c-1',
            customerName: 'Ana Lopez',
            customerPhone: '+15551112222',
            customerLanguage: 'es',
            serviceId: 'svc-1',
            serviceName: 'Consultation',
            date: '2026-11-13',
            startTime: '10:00',
            endTime: '11:00',
            durationMinutes: 60,
            price: 100,
            locationType: 'in_business',
            status: 'confirmed',
            source: 'manual_dashboard',
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );

    const { container } = render(<CalendarView />);
    expect(container.textContent).not.toContain('All Staff');
    expect(container.textContent).not.toContain('Online');
  });

  it('shows green confirmed badge and amber pending badge without auto-confirming pending', () => {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
      new Date()
    );

    mockUseApp.mockReturnValue(
      buildMockContext({
        appointments: [
          {
            id: 'apt-conf',
            tenantId: '1',
            customerId: 'c-1',
            customerName: 'Confirmed Client',
            customerPhone: '+15550001111',
            customerLanguage: 'en',
            serviceId: 'svc-1',
            serviceName: 'Consultation',
            date: todayStr,
            startTime: '10:00',
            endTime: '11:00',
            durationMinutes: 60,
            price: 100,
            locationType: 'in_business',
            status: 'confirmed',
            source: 'ai_assistant',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'apt-pend',
            tenantId: '1',
            customerId: 'c-2',
            customerName: 'Pending Client',
            customerPhone: '+15550002222',
            customerLanguage: 'en',
            serviceId: 'svc-1',
            serviceName: 'Consultation',
            date: todayStr,
            startTime: '12:00',
            endTime: '13:00',
            durationMinutes: 60,
            price: 100,
            locationType: 'in_business',
            status: 'pending',
            source: 'ai_assistant',
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );

    render(<CalendarView />);
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);

    // Switch to Week and Month modes cleanly without errors
    fireEvent.click(screen.getByText('Week'));
    fireEvent.click(screen.getByText('Month'));
    expect(screen.getByText('Sun')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Support System & Role/Business-Separated Notifications
// ---------------------------------------------------------------------------

describe('Support System & Notification Isolation', () => {
  it('allows business users to submit a support request via HelpSupportView', async () => {
    const createTicketSpy = vi.fn().mockResolvedValue({ success: true });
    mockUseApp.mockReturnValue(
      buildMockContext({
        createSupportTicket: createTicketSpy,
      })
    );

    render(<HelpSupportView />);
    fireEvent.click(screen.getAllByText('New Support Request')[0]);

    fireEvent.change(
      screen.getByPlaceholderText(translations.en.helpSupport.subjectPlaceholder),
      { target: { value: 'Calendar sync timing question' } }
    );
    fireEvent.change(
      screen.getByPlaceholderText(translations.en.helpSupport.descriptionPlaceholder),
      { target: { value: 'Slots in afternoon look shifted by one hour.' } }
    );

    fireEvent.click(screen.getByText(translations.en.helpSupport.submitBtn));

    await waitFor(() => {
      expect(createTicketSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Calendar sync timing question',
          description: 'Slots in afternoon look shifted by one hour.',
          category: 'general_question',
          priority: 'medium',
        })
      );
    });
  });

  it('strictly isolates TopHeader notifications between Super Admin and Business Owners', () => {
    // Business Owner #1 should only see business #1 support & pending alerts, never other businesses or platform alerts
    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: false,
        supportNotifications: [
          {
            id: 'sn-other-biz',
            targetRole: 'business',
            businessId: '999',
            ticketId: 'tk-999',
            title: 'Reply to Biz 999',
            body: 'Secret message for 999',
            isRead: false,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'sn-admin',
            targetRole: 'super_admin',
            businessId: '1',
            ticketId: 'tk-1',
            title: 'Admin Alert Only',
            body: 'New ticket raised',
            isRead: false,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'sn-biz-1',
            targetRole: 'business',
            businessId: '1',
            ticketId: 'tk-1',
            title: 'Support reply for Biz 1',
            body: 'We updated your configuration.',
            isRead: false,
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );

    const { rerender } = render(<TopHeader onOpenMobileMenu={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('Support reply for Biz 1')).toBeInTheDocument();
    expect(screen.queryByText('Reply to Biz 999')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin Alert Only')).not.toBeInTheDocument();

    // Super Admin should NEVER see pending customer appointments in notification dropdown
    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        appointments: [
          {
            id: 'apt-secret',
            tenantId: '1',
            customerId: 'c-secret',
            customerName: 'Private Customer Name',
            customerPhone: '+15559990000',
            customerLanguage: 'en',
            serviceId: 'svc-1',
            serviceName: 'Private Service',
            date: '2026-11-13',
            startTime: '10:00',
            endTime: '11:00',
            durationMinutes: 60,
            price: 100,
            locationType: 'in_business',
            status: 'pending',
            source: 'ai_whatsapp',
            createdAt: new Date().toISOString(),
          },
        ],
        supportNotifications: [
          {
            id: 'sn-admin-1',
            targetRole: 'super_admin',
            businessId: '1',
            ticketId: 'tk-1',
            title: 'New Support Ticket #NV-1001',
            body: 'Demo Studio requested help',
            isRead: false,
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );

    rerender(<TopHeader onOpenMobileMenu={vi.fn()} />);
    expect(screen.getByText('New Support Ticket #NV-1001')).toBeInTheDocument();
    expect(screen.queryByText(/Private Customer Name/)).not.toBeInTheDocument();
  });

  it('allows Super Admin to reply and update status on business support tickets', async () => {
    const sendReplySpy = vi.fn().mockResolvedValue({ success: true });
    const updateStatusSpy = vi.fn().mockResolvedValue({ success: true });
    const ticket = {
      id: 'tk-101-uuid-abcd',
      businessId: '1',
      businessName: 'Novacode Demo Studio',
      createdBy: 'owner@demostudio.com',
      category: 'technical_problem' as const,
      priority: 'high' as const,
      status: 'open' as const,
      subject: 'Cannot view afternoon slot',
      description: 'Afternoon slots are missing after 3pm.',
      lastMessageAt: new Date().toISOString(),
      unreadByAdmin: true,
      unreadByBusiness: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        supportTickets: [ticket],
        loadTicketMessages: vi.fn().mockResolvedValue([]),
        sendTicketReply: sendReplySpy,
        updateTicketStatus: updateStatusSpy,
      })
    );

    render(<SuperAdminView initialSection="support-center" />);
    fireEvent.click(screen.getByText('#tk-101-u'));

    const replyBox = screen.getByPlaceholderText(
      'Write an official reply from Novacode Tech Support...'
    );
    fireEvent.change(replyBox, { target: { value: 'Checking business hours for studio.' } });
    fireEvent.click(screen.getByText(translations.en.helpSupport.sendReplyBtn));

    await waitFor(() => {
      expect(sendReplySpy).toHaveBeenCalledWith(
        'tk-101-uuid-abcd',
        '1',
        'Checking business hours for studio.'
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Booking RPC Signature & Validation Guardrails
// ---------------------------------------------------------------------------

describe('Booking RPC Signature & Parameter Integrity', () => {
  it('rejects non-UUID customer IDs cleanly before calling book_appointment RPC', async () => {
    // Configure temporary Supabase client with valid URL/Key format in localStorage
    localStorage.setItem(
      'novacode_supabase_config',
      JSON.stringify({ url: 'https://testproject.supabase.co', anonKey: 'test-anon-key' })
    );
    const client = getSupabaseClient();
    expect(client).not.toBeNull();

    const invalidCustomerResult = await createBookingWithSupabase({
      businessId: '42',
      customerId: 'Ana Maria (+1555)', // NEVER allowed in p_customer_id
      customerName: 'Ana Maria',
      customerPhone: '+1555',
      customerLanguage: 'es',
      serviceId: '11111111-1111-4111-8111-111111111111',
      serviceName: 'Consultation',
      date: '2026-11-20',
      startTime: '14:00',
      endTime: '15:00',
      durationMinutes: 60,
      price: 100,
      locationType: 'in_business',
      timezone: 'America/New_York',
    });

    expect(invalidCustomerResult.success).toBe(false);
    expect(invalidCustomerResult.error).toContain('Invalid p_customer_id');

    localStorage.removeItem('novacode_supabase_config');
  });
});

// ---------------------------------------------------------------------------
// 7. Support System Hardening, Validation & UI Behavior (Mocked Unit Tests)
// ---------------------------------------------------------------------------

describe('Support System Hardening & UI Controls (Mocked Unit Tests)', () => {
  it('validates support ticket inputs against DB length/enum constraints and sanitizes PG 23514 errors', () => {
    expect(
      validateSupportTicketInput(
        { category: 'general_question', priority: 'medium', subject: 'Hi', description: 'Valid description' },
        'en'
      ).valid
    ).toBe(false);

    expect(
      validateSupportTicketInput(
        {
          category: 'general_question',
          priority: 'medium',
          subject: 'A'.repeat(201),
          description: 'Valid description',
        },
        'en'
      ).valid
    ).toBe(false);

    expect(
      validateSupportTicketInput(
        { category: 'general_question', priority: 'medium', subject: 'Valid Subject', description: 'abc' },
        'en'
      ).valid
    ).toBe(false);

    expect(
      validateSupportTicketInput(
        { category: 'invalid_cat', priority: 'medium', subject: 'Valid Subject', description: 'Valid details' },
        'en'
      ).valid
    ).toBe(false);

    expect(
      validateSupportTicketInput(
        { category: 'technical_problem', priority: 'high', subject: 'Booking issue', description: 'Details here' },
        'en'
      ).valid
    ).toBe(true);

    const sanitizedCheckErr = sanitizeErrorForBusiness(
      { code: '23514', message: 'new row for relation "business_support_tickets" violates check constraint' },
      'en'
    );
    expect(sanitizedCheckErr.errorType).toBe('validation');
    expect(containsInfrastructureTerms(sanitizedCheckErr.userMessage)).toBe(false);

    const sanitizedClosedErr = sanitizeErrorForBusiness(
      { code: 'P0001', message: 'Cannot reply to a closed support ticket' },
      'en'
    );
    expect(sanitizedClosedErr.errorType).toBe('validation');
    expect(sanitizedClosedErr.userMessage).toContain('closed');
  });

  it('prevents invalid length submission and duplicate double-submissions in HelpSupportView', async () => {
    let resolveSubmit!: (val: any) => void;
    const slowCreateSpy = vi.fn(
      () =>
        new Promise(resolve => {
          resolveSubmit = resolve;
        })
    );

    mockUseApp.mockReturnValue(
      buildMockContext({
        createSupportTicket: slowCreateSpy,
      })
    );

    render(<HelpSupportView />);
    fireEvent.click(screen.getAllByText('New Support Request')[0]);

    const subjectInput = screen.getByPlaceholderText(translations.en.helpSupport.subjectPlaceholder);
    const descInput = screen.getByPlaceholderText(translations.en.helpSupport.descriptionPlaceholder);
    const submitBtn = screen.getByText(translations.en.helpSupport.submitBtn);

    // Too-short subject & description blocked pre-submit
    fireEvent.change(subjectInput, { target: { value: 'Hi' } });
    fireEvent.change(descInput, { target: { value: '123' } });
    fireEvent.click(submitBtn);
    expect(slowCreateSpy).not.toHaveBeenCalled();

    // Valid input -> double rapid click triggers only once while in-flight
    fireEvent.change(subjectInput, { target: { value: 'Calendar timezone drift' } });
    fireEvent.change(descInput, { target: { value: 'Appointments appear shifted by 1 hour.' } });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(slowCreateSpy).toHaveBeenCalledTimes(1);
    resolveSubmit({ success: false, error: 'Test done' });
  });

  it('locks reply forms in both HelpSupportView and SuperAdminView when ticket status is closed', () => {
    const closedTicket = {
      id: '22222222-2222-4222-8222-222222222222',
      businessId: '1',
      businessName: 'Novacode Demo Studio',
      createdBy: '550e8400-e29b-41d4-a716-446655440000',
      createdByName: 'Camila Rojas',
      category: 'technical_problem' as const,
      priority: 'medium' as const,
      status: 'closed' as const,
      subject: 'Closed issue example',
      description: 'Resolved and locked.',
      lastMessageAt: new Date().toISOString(),
      unreadByAdmin: false,
      unreadByBusiness: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Business view hides reply input when closed
    mockUseApp.mockReturnValue(
      buildMockContext({
        supportTickets: [closedTicket],
      })
    );
    const { unmount } = render(<HelpSupportView />);
    expect(
      screen.getByText('This request is closed. Submit a new support request if you need additional assistance.')
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(translations.en.helpSupport.replyPlaceholder)
    ).not.toBeInTheDocument();
    unmount();

    // Super Admin view shows human-readable createdByName (never raw UUID) & locks reply form on closed ticket
    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        supportTickets: [closedTicket],
      })
    );
    render(<SuperAdminView initialSection="support-center" />);
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'closed' } });
    const checkbox = screen.getByLabelText('Unresolved only');
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByText('#22222222'));
    expect(screen.getByText(/Camila Rojas/)).toBeInTheDocument();
    expect(screen.queryByText(/550e8400-e29b-41d4-a716-446655440000/)).not.toBeInTheDocument();
    expect(
      screen.getByText('This support ticket is closed. Change the status above if you need to reopen it.')
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Write an official reply from Novacode Tech Support...')
    ).not.toBeInTheDocument();
  });

  it('uses accurate table names in SuperAdminView missing-table notice and supports incident status triage', () => {
    const updateIncidentSpy = vi.fn().mockResolvedValue({ success: true });
    mockUseApp.mockReturnValue(
      buildMockContext({
        mode: 'supabase',
        canViewPlatformAdmin: true,
        supportTicketsTableExists: false,
        platformIncidents: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            businessId: '1',
            businessName: 'Novacode Demo Studio',
            source: 'integration_failure',
            severity: 'high',
            status: 'open',
            title: 'n8n booking webhook 502',
            description: 'Upstream timeout on slot lock.',
            createdAt: new Date().toISOString(),
          },
        ],
        updatePlatformIncidentStatus: updateIncidentSpy,
      })
    );

    const { unmount } = render(<SuperAdminView initialSection="support-center" />);
    expect(
      screen.getByText('Backend business_support_tickets & support_ticket_messages tables not yet deployed')
    ).toBeInTheDocument();
    expect(screen.queryByText(/support_tickets & support_messages/)).not.toBeInTheDocument();
    unmount();

    render(<SuperAdminView initialSection="incidents" />);
    fireEvent.click(screen.getByRole('button', { name: 'Investigating' }));
    expect(updateIncidentSpy).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'investigating'
    );
  });

  it('keeps notification badge strictly equal to visible items and marks ticket notifications read on click / Clear All', () => {
    const markTicketReadSpy = vi.fn();
    const markSupportReadSpy = vi.fn();

    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        supportNotifications: [
          {
            id: 'sn-1',
            businessId: '1',
            targetRole: 'super_admin',
            ticketId: 'tk-sync-1',
            title: 'New Support Request · Studio A',
            body: 'Calendar slot question',
            isRead: false,
            createdAt: new Date().toISOString(),
          },
        ],
        supportTickets: [
          {
            id: 'tk-sync-1',
            businessId: '1',
            businessName: 'Studio A',
            category: 'general_question',
            subject: 'Calendar slot question',
            description: 'Desc...',
            priority: 'medium',
            status: 'open',
            lastMessageAt: new Date().toISOString(),
            unreadByAdmin: true,
            unreadByBusiness: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            // Unread ticket fallback with NO matching support_notifications row
            id: 'tk-sync-2',
            businessId: '2',
            businessName: 'Studio B',
            category: 'technical_problem',
            subject: 'Webhook delay alert',
            description: 'Desc...',
            priority: 'high',
            status: 'open',
            lastMessageAt: new Date().toISOString(),
            unreadByAdmin: true,
            unreadByBusiness: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        markTicketRead: markTicketReadSpy,
        markSupportNotificationsRead: markSupportReadSpy,
      })
    );

    render(<TopHeader onOpenMobileMenu={vi.fn()} />);
    // Badge must equal 2 (sn-1 + fallback tk-sync-2) and BOTH must render in dropdown
    const bellBtn = screen.getByLabelText('Notifications');
    expect(bellBtn).toHaveTextContent('2');
    fireEvent.click(bellBtn);

    expect(screen.getByText('New Support Request · Studio A')).toBeInTheDocument();
    expect(screen.getByText('Studio B: Webhook delay alert')).toBeInTheDocument();

    fireEvent.click(screen.getByText('New Support Request · Studio A'));
    expect(markTicketReadSpy).toHaveBeenCalledWith('tk-sync-1');
  });

  it('maps created_by_name on SupportTicket rows cleanly', () => {
    const mapped = mapRowToSupportTicket({
      id: 'tk-row-1',
      business_id: 7,
      created_by: '550e8400-e29b-41d4-a716-446655440000',
      created_by_name: 'Elena Martinez',
      category: 'booking_calendar_issue',
      subject: 'Slot check',
      description: 'Need help',
      priority: 'low',
      status: 'open',
      unread_by_business: false,
      unread_by_admin: true,
    });

    expect(mapped.businessId).toBe('7');
    expect(mapped.createdByName).toBe('Elena Martinez');
    expect(mapped.unreadByAdmin).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Support Realtime Scoping, Cleanup & Hardened SQL Contract Tests (Mocked / Static)
// ---------------------------------------------------------------------------

describe('Support Realtime Scoping & Hardened SQL Contract (Mocked / Static Analysis)', () => {
  it('scopes Business Realtime strictly to business_id, excludes support_incidents, and drops cross-business events', () => {
    const bizSpec = buildSupportRealtimeSubscriptions({ isSuperAdmin: false, businessId: '42' });
    expect(bizSpec).not.toBeNull();
    expect(bizSpec!.channelName).toBe('realtime:support:business:42');
    expect(bizSpec!.subscriptions.map(s => s.table)).toEqual([
      'business_support_tickets',
      'support_ticket_messages',
      'support_notifications',
    ]);
    // Business users MUST NEVER subscribe to support_incidents
    expect(bizSpec!.subscriptions.some(s => s.table === 'support_incidents')).toBe(false);
    expect(bizSpec!.subscriptions.every(s => s.filter === 'business_id=eq.42')).toBe(true);

    // Invalid businessId returns null
    expect(buildSupportRealtimeSubscriptions({ isSuperAdmin: false, businessId: 'not-a-bigint' })).toBeNull();

    // Super Admin spec subscribes to all 4 support tables including support_incidents
    const adminSpec = buildSupportRealtimeSubscriptions({ isSuperAdmin: true });
    expect(adminSpec!.channelName).toBe('realtime:support:super-admin');
    expect(adminSpec!.subscriptions.map(s => s.table)).toContain('support_incidents');
    expect(
      adminSpec!.subscriptions.find(s => s.table === 'support_notifications')?.filter
    ).toBe('target_role=eq.super_admin');
  });

  it('cleans up support Realtime channels cleanly on unmount/switch and filters unauthorized payloads', async () => {
    const handlers: Array<{ table: string; cb: (payload: any) => void }> = [];
    const mockChannel = {
      on: vi.fn((_type: string, cfg: { table: string }, cb: (payload: any) => void) => {
        handlers.push({ table: cfg.table, cb });
        return mockChannel;
      }),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn().mockResolvedValue('ok'),
    };
    const mockClient = {
      channel: vi.fn(() => mockChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };

    localStorage.setItem(
      'novacode_supabase_config',
      JSON.stringify({ url: 'https://testrealtime.supabase.co', anonKey: 'test-anon-key' })
    );
    const client = getSupabaseClient() as any;
    expect(client).not.toBeNull();
    const channelSpy = vi.spyOn(client, 'channel').mockImplementation(mockClient.channel);
    const removeChannelSpy = vi.spyOn(client, 'removeChannel').mockImplementation(mockClient.removeChannel);

    const onNotificationSpy = vi.fn();
    const channel = subscribeToSupportSystemRealtime(
      { isSuperAdmin: false, businessId: '42' },
      { onNotificationChange: onNotificationSpy }
    );

    expect(channel).toBe(mockChannel);
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);

    // Cross-business or super_admin notifications must be ignored even if delivered transiently
    const notifHandler = handlers.find(h => h.table === 'support_notifications')!.cb;
    notifHandler({
      eventType: 'INSERT',
      new: { id: 'n-leak-1', business_id: 99, target_role: 'business', title: 'Leak', body: '', is_read: false },
    });
    notifHandler({
      eventType: 'INSERT',
      new: { id: 'n-leak-2', business_id: 42, target_role: 'super_admin', title: 'Admin Only', body: '', is_read: false },
    });
    expect(onNotificationSpy).not.toHaveBeenCalled();

    // Scoped business #42 business notification passes through
    notifHandler({
      eventType: 'INSERT',
      new: { id: 'n-ok', business_id: 42, target_role: 'business', title: 'Reply', body: 'Hello', is_read: false },
    });
    expect(onNotificationSpy).toHaveBeenCalledTimes(1);

    // Cleanup removes channel cleanly
    await unsubscribeRealtimeChannel(channel);
    expect(removeChannelSpy).toHaveBeenCalledWith(mockChannel);

    channelSpy.mockRestore();
    removeChannelSpy.mockRestore();
    localStorage.removeItem('novacode_supabase_config');
  });

  it('verifies 20261113_support_system_hardened.sql enforces RBAC, membership, closed tickets, is_read grants, and Realtime', () => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20261113_support_system_hardened.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Active membership & BIGINT compatibility checks
    expect(sql).toContain('public.is_business_member(bigint)');
    expect(sql).toContain('public.is_business_member(NEW.business_id)');
    expect(sql).toContain('business_id BIGINT');

    // Closed-ticket lock in both trigger & RLS
    expect(sql).toContain("v_ticket_status = 'closed'");
    expect(sql).toContain("t.status <> 'closed'");

    // Prevent non-admin edits to protected ticket columns
    expect(sql).toContain('business users can only update read state on support tickets');

    // Restrict support_notifications updates strictly to is_read
    expect(sql).toContain('GRANT SELECT, UPDATE (is_read) ON TABLE public.support_notifications TO authenticated');
    expect(sql).toContain('support_notifications updates are restricted to is_read only');

    // Restrict support_incidents strictly to Super Admin (no member select/insert policy)
    expect(sql).toContain('DROP POLICY IF EXISTS "Members view own business support incidents" ON public.support_incidents');
    expect(sql).toContain('GRANT SELECT, UPDATE (status, resolved_at) ON TABLE public.support_incidents TO authenticated');
    expect(sql).toContain('USING (public.is_super_admin())');

    // Realtime publication setup for all 4 support tables
    expect(sql).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE');
    expect(sql).toContain("'business_support_tickets'");
    expect(sql).toContain("'support_ticket_messages'");
    expect(sql).toContain("'support_notifications'");
    expect(sql).toContain("'support_incidents'");
  });

  it('verifies 20261113_support_system_hardened_v2.sql resolves trigger authorization without pg_trigger_depth-only bypass', () => {
    const v2Path = path.resolve(process.cwd(), 'supabase/migrations/20261113_support_system_hardened_v2.sql');
    const sql = fs.readFileSync(v2Path, 'utf8');

    // Critical V2 fix: SECURITY INVOKER on BEFORE UPDATE guard triggers so current_user preserves caller identity
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_support_ticket_before_update\(\)[\s\S]*?SECURITY INVOKER/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_support_notification_before_update\(\)[\s\S]*?SECURITY INVOKER/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_support_incident_before_update\(\)[\s\S]*?SECURITY INVOKER/);

    // Trigger trust combines caller privilege (current_user != authenticated/anon + owner/bypassrls), pg_trigger_depth() >= 2, and operation GUC
    expect(sql).toContain("current_user NOT IN ('authenticated', 'anon', 'PUBLIC')");
    expect(sql).toContain('pg_trigger_depth() >= 2');
    expect(sql).toContain("novacode.support_trigger_op");
    expect(sql).toContain("'message_sync'");
    expect(sql).toContain("'notification_read_sync'");
    expect(sql).toContain("'ticket_read_sync'");

    // Blocks NULL auth.uid() & identity/role spoofing
    expect(sql).toContain("IF auth.uid() IS NULL AND current_user IN ('authenticated', 'anon', 'PUBLIC')");
    expect(sql).toContain('cannot impersonate another ticket creator');
    expect(sql).toContain('cannot impersonate another message sender');
    expect(sql).toContain('only verified Super Admins may post as super_admin');

    // Ownership, EXECUTE lockdown, and SECURITY DEFINER search_path audit
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.resolve_support_actor_label(UUID) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.trg_support_ticket_before_update() FROM PUBLIC, anon, authenticated');
    expect(sql).toContain("WHERE cfg LIKE 'search_path=%'");
    expect(sql).toContain('GRANT SELECT, UPDATE (is_read) ON TABLE public.support_notifications TO authenticated');
    expect(sql).toContain('GRANT SELECT, UPDATE (status, resolved_at) ON TABLE public.support_incidents TO authenticated');

    // Non-destructive staging authorization test suite included
    expect(sql).toContain('DATABASE-LEVEL AUTHORIZATION TEST SUITE');
    expect(sql).toContain('ROLLBACK;');
  });

  it('verifies 20261113_support_system_hardened_v3.sql enforces active membership/business, safe partial read sync, scoped RLS, and clean staging tests', () => {
    const v3Path = path.resolve(process.cwd(), 'supabase/migrations/20261113_support_system_hardened_v3.sql');
    const sql = fs.readFileSync(v3Path, 'utf8');

    // Active membership (bm.is_active = TRUE) + active business checks
    expect(sql).toContain('public.support_is_business_row_active(p_biz_json JSONB)');
    expect(sql).toContain('public.support_is_active_business_member(p_business_id BIGINT)');
    expect(sql).toContain('AND bm.is_active = TRUE');
    expect(sql).toContain('JOIN public.businesses b ON b.id = bm.business_id');
    expect(sql).toContain("public.business_members.is_active BOOLEAN column is required");

    // Partial notification read sync must NOT clear ticket unread flags if other unread notifications remain
    expect(sql).toContain('v_has_remaining_unread');
    expect(sql).toContain('AND sn.is_read = FALSE');
    expect(sql).toContain('AND sn.id <> NEW.id');
    expect(sql).toContain('IF NOT v_has_remaining_unread THEN');

    // Scoped least-privilege RLS policies matching frontend grants (no FOR ALL policies)
    expect(sql).toContain('CREATE POLICY "Super admin read support_tickets"');
    expect(sql).toContain('CREATE POLICY "Super admin create support_tickets"');
    expect(sql).toContain('CREATE POLICY "Super admin update support_tickets"');
    expect(sql).toContain('CREATE POLICY "Super admin read support_messages"');
    expect(sql).toContain('CREATE POLICY "Super admin reply support_messages"');
    expect(sql).toContain('CREATE POLICY "Super admin read admin support_notifications"');
    expect(sql).toContain('CREATE POLICY "Super admin mark admin notifications read"');
    expect(sql).toContain('CREATE POLICY "Super admins read support incidents"');
    expect(sql).toContain('CREATE POLICY "Super admins update support incidents"');
    expect(sql).toContain('pg_has_role(current_user, v_table_owner, \'MEMBER\')');

    // Staging authorization test suite verification
    const suiteStart = sql.indexOf('EXECUTABLE STAGING AUTHORIZATION TEST SUITE');
    expect(suiteStart).toBeGreaterThan(-1);
    const suiteSql = sql.slice(suiteStart);

    // No SET LOCAL ROLE inside DO blocks
    const doBlocks = suiteSql.match(/DO \$\$[\s\S]*?\$\$;/g) || [];
    expect(doBlocks.length).toBeGreaterThanOrEqual(8);
    for (const block of doBlocks) {
      expect(block).not.toMatch(/\bSET\s+LOCAL\s+ROLE\b/i);
      expect(block).not.toMatch(/\bEXCEPTION\s+WHEN\s+OTHERS\b/i);
    }

    // Separated top-level role switching & JWT simulation
    expect(suiteSql).toContain('BEGIN;');
    expect(suiteSql).toContain('ROLLBACK;');
    expect(suiteSql).toContain('SET LOCAL ROLE authenticated;');
    expect(suiteSql).toContain('SET LOCAL ROLE anon;');
    expect(suiteSql).toContain("request.jwt.claims");
    expect(suiteSql).toContain("request.jwt.claim.sub");
    expect(suiteSql).toContain('TEST FAILURE (Test 3): marking older notification N1 read cleared unread_by_admin');
    expect(suiteSql).toContain('TEST FAILURE (Test 6A): inactive member');
  });
});

// ---------------------------------------------------------------------------
// 7. Strict Business Settings & Non-Technical UI Isolation (RBAC)
// ---------------------------------------------------------------------------

describe('Strict Business Settings & Non-Technical UI Isolation (RBAC)', () => {
  const FORBIDDEN_INFRA_PATTERNS = [
    /supabase/i,
    /anon key/i,
    /service_role/i,
    /\bsql\b/i,
    /\brls\b/i,
    /demo mode/i,
    /disconnect/i,
    /project url/i,
    /is_super_admin/i,
    /test & connect/i,
  ];

  it('renders Salon Naomi Business Settings with strictly 6 business sections and zero infrastructure controls', () => {
    const setActiveTab = vi.fn();
    mockUseApp.mockReturnValue(
      buildMockContext({
        mode: 'supabase',
        isSuperAdmin: false,
        canViewPlatformAdmin: false,
        canManageBusinessSettings: true,
        canManageStaff: true,
        effectiveRole: 'owner',
        setActiveTab,
        currentTenant: {
          id: '42',
          name: 'Salon Naomi',
          slug: 'salon-naomi',
          tagline: 'Hair & Beauty Studio',
          category: 'salon',
        },
        liveMembers: [
          {
            id: 'mem-1',
            businessId: '42',
            userId: '11111111-2222-3333-4444-555555555555',
            userEmail: '',
            role: 'staff',
            createdAt: '2026-11-01T00:00:00Z',
          },
        ],
      })
    );

    const { container } = render(<SettingsView />);

    expect(screen.getByRole('heading', { name: 'Business Settings' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Manage your business profile, operating hours, services, team permissions, and preferences'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Business Profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operating Hours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Services' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Team & Staff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Business Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help & Support' })).toBeInTheDocument();

    for (const pattern of FORBIDDEN_INFRA_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }

    // Visit Operating Hours
    fireEvent.click(screen.getByRole('button', { name: 'Operating Hours' }));
    expect(screen.getByText('Weekly Operating Hours')).toBeInTheDocument();
    for (const pattern of FORBIDDEN_INFRA_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }

    // Visit Services tab
    fireEvent.click(screen.getByRole('button', { name: 'Services' }));
    expect(screen.getByText('Services Catalog')).toBeInTheDocument();
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Manage Full Services Catalog/i }));
    expect(setActiveTab).toHaveBeenCalledWith('services');

    // Visit Team & Staff tab -> never expose raw UUID, never show owner/admin option to Business Owner
    fireEvent.click(screen.getByRole('button', { name: 'Team & Staff' }));
    expect(screen.getByText('Team Member #1')).toBeInTheDocument();
    expect(container.textContent || '').not.toContain('11111111-2222-3333-4444-555555555555');
    expect(screen.queryByRole('option', { name: 'Business Owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
    for (const pattern of FORBIDDEN_INFRA_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }

    // Visit Business Preferences tab
    fireEvent.click(screen.getByRole('button', { name: 'Business Preferences' }));
    expect(screen.getByText('Business & Scheduling Preferences')).toBeInTheDocument();
    expect(screen.getByText(/Cancellation Notice Window/i)).toBeInTheDocument();
    expect(screen.getByText(/Buffer Between Appointments/i)).toBeInTheDocument();
    for (const pattern of FORBIDDEN_INFRA_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }

    // Visit Help & Support tab
    fireEvent.click(screen.getByRole('button', { name: 'Help & Support' }));
    expect(screen.getByText('Business Help & Support')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open Help & Support Center/i }));
    expect(setActiveTab).toHaveBeenCalledWith('support');
    for (const pattern of FORBIDDEN_INFRA_PATTERNS) {
      expect(container.textContent || '').not.toMatch(pattern);
    }
  });

  it('blocks Staff users from Business Settings UI and renders restricted notice', () => {
    mockUseApp.mockReturnValue(
      buildMockContext({
        mode: 'supabase',
        isSuperAdmin: false,
        canViewPlatformAdmin: false,
        canManageBusinessSettings: false,
        canManageStaff: false,
        effectiveRole: 'staff',
        currentUser: {
          id: 'staff-1',
          email: 'stylist@salonnaomi.com',
          role: 'staff',
          isSuperAdmin: false,
          effectiveRole: 'staff',
          businessIds: ['42'],
        },
      })
    );

    render(<SettingsView />);
    expect(screen.getByText('Staff Access')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Business Profile' })).not.toBeInTheDocument();
  });

  it('sanitizes TopHeader & Sidebar for Business Owners and hides Live/Demo toggle and raw RPC errors', () => {
    mockUseApp.mockReturnValue(
      buildMockContext({
        mode: 'supabase',
        isSuperAdmin: false,
        canViewPlatformAdmin: false,
        canManageBusinessSettings: true,
        effectiveRole: 'none',
        isSuperAdminCheckFailed: true,
        authDiagnosticError: 'Supabase is_super_admin RPC failed: permission denied',
        currentTenant: { id: '42', name: 'Salon Naomi' },
        currentUser: {
          id: 'owner-1',
          email: 'owner@salonnaomi.com',
          role: 'owner',
          isSuperAdmin: false,
          effectiveRole: 'none',
        },
      })
    );

    const { container } = render(
      <>
        <Sidebar isMobileOpen={false} setIsMobileOpen={vi.fn()} />
        <TopHeader onOpenMobileMenu={vi.fn()} />
      </>
    );

    const text = container.textContent || '';
    expect(screen.getAllByText('Access Pending').length).toBeGreaterThanOrEqual(1);
    expect(text).not.toContain('Role Check Error');
    expect(text).not.toContain('permission denied');
    expect(text).not.toContain('is_super_admin');
    expect(text).not.toContain('Platform Admin');
    expect(text).not.toContain('Infrastructure');
    expect(text).not.toContain('Data Mode');
    expect(text).not.toContain('Demo');
    expect(screen.queryByTitle('Open Platform Infrastructure')).not.toBeInTheDocument();
  });

  it('allows verified Super Admin to view Infrastructure and rejects service_role keys in the browser form', () => {
    const updateSupabaseConfig = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
    const addToast = vi.fn();
    mockUseApp.mockReturnValue(
      buildMockContext({
        mode: 'supabase',
        isSuperAdmin: true,
        canViewPlatformAdmin: true,
        canManageBusinessSettings: true,
        effectiveRole: 'super_admin',
        currentUser: {
          id: 'super-1',
          email: 'admin@novacode.tech',
          role: 'super_admin',
          isSuperAdmin: true,
          effectiveRole: 'super_admin',
        },
        updateSupabaseConfig,
        addToast,
      })
    );

    render(<SuperAdminView initialSection="infrastructure" />);
    expect(screen.getByText('Supabase Database & Multi-Tenant Backend')).toBeInTheDocument();
    expect(
      screen.getByText(/Never enter or store service_role keys in frontend code/i)
    ).toBeInTheDocument();

    const urlInput = screen.getByPlaceholderText('https://xyzcompany.supabase.co');
    const keyInput = screen.getByPlaceholderText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
    fireEvent.change(urlInput, { target: { value: 'https://demo.supabase.co' } });

    const serviceRolePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    const fakeServiceRoleJwt = `eyJhbGciOiJIUzI1NiJ9.${serviceRolePayload}.sig`;
    fireEvent.change(keyInput, { target: { value: fakeServiceRoleJwt } });

    fireEvent.click(screen.getByRole('button', { name: /Test & Connect Database/i }));
    expect(updateSupabaseConfig).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      'error',
      expect.any(String),
      expect.stringMatching(/service_role/i)
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Super Admin V3 Support Center, Incidents, Overview Summary & Deep Linking
// ---------------------------------------------------------------------------

describe('Super Admin V3 Support Center, Incidents & TopHeader Integration', () => {
  it('enforces route & tab access control for support-center and incidents across roles', () => {
    const adminFlags = { canViewPlatformAdmin: true, canManageBusinessSettings: true };
    const ownerFlags = { canViewPlatformAdmin: false, canManageBusinessSettings: true };

    expect(resolveTabFromPathname('/support-center', adminFlags, 'super_admin')).toBe('support-center');
    expect(resolveTabFromPathname('/incidents', adminFlags, 'super_admin')).toBe('incidents');
    expect(resolveTabFromPathname('/support-center', ownerFlags, 'owner')).toBe('overview');

    expect(canAccessTab('support-center', 'owner', ownerFlags)).toBe(false);
    expect(canAccessTab('support-center', 'staff', { canViewPlatformAdmin: false, canManageBusinessSettings: false })).toBe(false);
    expect(canAccessTab('incidents', 'owner', ownerFlags)).toBe(false);
    expect(canAccessTab('support-center', 'super_admin', adminFlags)).toBe(true);
    expect(canAccessTab('incidents', 'super_admin', adminFlags)).toBe(true);
  });

  it('renders Support & Incident Summary on Super Admin overview without exposing customer PII', () => {
    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        supportTickets: [
          {
            id: 'tk-ov-1',
            businessId: '1',
            businessName: 'Salon Naomi',
            category: 'technical_problem',
            priority: 'high',
            status: 'open',
            subject: 'Sync question',
            description: 'Details',
            lastMessageAt: '2026-11-13T10:00:00Z',
            unreadByAdmin: true,
            unreadByBusiness: false,
            createdAt: '2026-11-13T10:00:00Z',
            updatedAt: '2026-11-13T10:00:00Z',
          },
          {
            id: 'tk-ov-2',
            businessId: '1',
            businessName: 'Salon Naomi',
            category: 'general_question',
            priority: 'low',
            status: 'resolved',
            subject: 'Old question',
            description: 'Done',
            lastMessageAt: '2026-11-12T10:00:00Z',
            unreadByAdmin: false,
            unreadByBusiness: false,
            createdAt: '2026-11-12T10:00:00Z',
            updatedAt: '2026-11-12T10:00:00Z',
          },
        ],
        platformIncidents: [
          {
            id: 'inc-ov-1',
            businessId: '1',
            businessName: 'Salon Naomi',
            source: 'integration_failure',
            severity: 'high',
            status: 'open',
            title: 'Webhook timeout',
            description: 'Timeout',
            createdAt: '2026-11-13T11:00:00Z',
          },
        ],
        supportNotifications: [
          {
            id: 'sn-ov-1',
            businessId: '1',
            targetRole: 'super_admin',
            ticketId: 'tk-ov-1',
            title: 'New Support Request',
            body: 'Sync question',
            isRead: false,
            createdAt: '2026-11-13T10:00:00Z',
          },
        ],
        customers: [
          {
            id: 'cust-secret-1',
            name: 'Private Client Alice',
            phone: '+19998887777',
            email: 'alice@private.com',
            preferredLanguage: 'en',
            notes: '',
            totalAppointments: 3,
          },
        ],
      })
    );

    const { container } = render(<SuperAdminView initialSection="businesses" />);
    expect(screen.getByText('Support & Incident Summary')).toBeInTheDocument();
    expect(screen.getByText('Open Tickets')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Attention')).toBeInTheDocument();
    expect(screen.getByText('Unresolved Incidents')).toBeInTheDocument();
    expect(screen.getByText('Unread Alerts')).toBeInTheDocument();
    expect(container.textContent || '').not.toContain('Private Client Alice');
  });

  it('supports Support Center filtering, search, pagination, status history timeline, status updates, and reply double-submit guard', async () => {
    const loadMessagesSpy = vi.fn().mockResolvedValue([
      {
        id: 'msg-1',
        ticketId: 'tk-hist-1',
        businessId: '1',
        senderRole: 'owner',
        senderName: 'Naomi Owner',
        message: 'We need help with staff permissions.',
        createdAt: '2026-11-13T09:00:00Z',
      },
    ]);
    const loadHistorySpy = vi.fn().mockResolvedValue([]);
    const markReadSpy = vi.fn().mockResolvedValue(undefined);
    const updateStatusSpy = vi.fn().mockResolvedValue({ success: true });
    const loadMoreSpy = vi.fn().mockResolvedValue(undefined);

    let resolveReply!: (val: any) => void;
    const slowReplySpy = vi.fn(
      () =>
        new Promise(resolve => {
          resolveReply = resolve;
        })
    );

    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        supportTicketsTotalCount: 25,
        hasMoreSupportTickets: true,
        supportTickets: [
          {
            id: 'tk-hist-1',
            businessId: '1',
            businessName: 'Salon Naomi',
            createdByName: 'Naomi Owner',
            category: 'account_access',
            priority: 'urgent',
            status: 'open',
            subject: 'Staff login question',
            description: 'How do we invite a stylist?',
            lastMessageAt: '2026-11-13T09:00:00Z',
            unreadByAdmin: true,
            unreadByBusiness: false,
            createdAt: '2026-11-13T09:00:00Z',
            updatedAt: '2026-11-13T09:00:00Z',
          },
          {
            id: 'tk-hist-2',
            businessId: '1',
            businessName: 'Salon Naomi',
            createdByName: 'Naomi Owner',
            category: 'billing_subscription',
            priority: 'low',
            status: 'resolved',
            subject: 'Invoice copy',
            description: 'Resolved last week',
            lastMessageAt: '2026-11-10T09:00:00Z',
            unreadByAdmin: false,
            unreadByBusiness: false,
            createdAt: '2026-11-10T09:00:00Z',
            updatedAt: '2026-11-10T09:00:00Z',
          },
        ],
        supportStatusHistoryByTicket: {
          'tk-hist-1': [
            {
              id: 'sh-1',
              ticketId: 'tk-hist-1',
              changedBy: 'Support Lead',
              oldStatus: 'open',
              newStatus: 'in_progress',
              createdAt: '2026-11-13T09:15:00Z',
            },
          ],
        },
        loadTicketMessages: loadMessagesSpy,
        loadTicketStatusHistory: loadHistorySpy,
        markTicketRead: markReadSpy,
        updateTicketStatus: updateStatusSpy,
        sendTicketReply: slowReplySpy,
        loadMoreSupportTickets: loadMoreSpy,
      })
    );

    render(<SuperAdminView initialSection="support-center" />);

    // Load more button triggers server pagination
    fireEvent.click(screen.getByRole('button', { name: 'Load more tickets' }));
    expect(loadMoreSpy).toHaveBeenCalledTimes(1);

    // Search filters out non-matching tickets
    const searchInput = screen.getByPlaceholderText('Search subject, business, or ID...');
    fireEvent.change(searchInput, { target: { value: 'Staff login' } });
    fireEvent.click(screen.getByText('#tk-hist-'));

    await waitFor(() => {
      expect(markReadSpy).toHaveBeenCalledWith('tk-hist-1');
      expect(loadMessagesSpy).toHaveBeenCalledWith('tk-hist-1');
      expect(loadHistorySpy).toHaveBeenCalledWith('tk-hist-1');
    });

    // Status history timeline & initial message appear
    expect(screen.getByText('Status History')).toBeInTheDocument();
    expect(screen.getByText('We need help with staff permissions.')).toBeInTheDocument();
    expect(screen.getByText(/Support Lead/)).toBeInTheDocument();

    // Status update works
    fireEvent.change(screen.getByLabelText('Ticket status'), {
      target: { value: 'in_progress' },
    });
    await waitFor(() => {
      expect(updateStatusSpy).toHaveBeenCalledWith('tk-hist-1', 'in_progress');
    });

    // Double-submit guard on admin reply
    const replyBox = screen.getByPlaceholderText(
      'Write an official reply from Novacode Tech Support...'
    );
    fireEvent.change(replyBox, { target: { value: 'Go to Business Settings -> Team & Staff.' } });
    const sendBtn = screen.getByRole('button', { name: 'Send Reply' });
    fireEvent.click(sendBtn);
    fireEvent.click(sendBtn);
    expect(slowReplySpy).toHaveBeenCalledTimes(1);
    resolveReply({ success: true });
  });

  it('supports Incidents filtering, honest ingestion notice, detail modal, full status transitions, and load more', async () => {
    const updateIncidentSpy = vi.fn().mockResolvedValue({ success: true });
    const loadMoreIncidentsSpy = vi.fn().mockResolvedValue(undefined);

    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        platformIncidentsTotalCount: 30,
        hasMorePlatformIncidents: true,
        loadMorePlatformIncidents: loadMoreIncidentsSpy,
        updatePlatformIncidentStatus: updateIncidentSpy,
        platformIncidents: [
          {
            id: 'inc-detail-1',
            businessId: '1',
            businessName: 'Salon Naomi',
            source: 'integration_failure',
            severity: 'critical',
            status: 'resolved',
            title: 'WhatsApp delivery webhook timeout',
            description: 'Upstream 504 returned from gateway.',
            errorCode: 'HTTP_504',
            createdAt: '2026-11-13T10:00:00Z',
            resolvedAt: '2026-11-13T11:00:00Z',
          },
          {
            id: 'inc-detail-2',
            businessId: '2',
            businessName: 'Clinic Two',
            source: 'technical_error',
            severity: 'low',
            status: 'open',
            title: 'Minor UI warning',
            description: 'Non-fatal layout warning.',
            createdAt: '2026-11-13T08:00:00Z',
          },
        ],
      })
    );

    render(<SuperAdminView initialSection="incidents" />);

    // Honest ingestion notice displayed
    expect(
      screen.getByText(/Automated n8n or Supabase log ingestion requires configuring an n8n error workflow webhook/i)
    ).toBeInTheDocument();

    // Filter by severity=critical
    fireEvent.change(screen.getByLabelText('Incident severity filter'), {
      target: { value: 'critical' },
    });
    expect(screen.getByText('WhatsApp delivery webhook timeout')).toBeInTheDocument();
    expect(screen.queryByText('Minor UI warning')).not.toBeInTheDocument();

    // Open detail modal & reopen resolved incident to investigating
    fireEvent.click(screen.getByText('WhatsApp delivery webhook timeout'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain('HTTP_504');

    const modalButtons = dialog.querySelectorAll('button');
    const investigatingBtn = Array.from(modalButtons).find(
      b => b.textContent?.trim() === 'Investigating'
    )!;
    fireEvent.click(investigatingBtn);
    await waitFor(() => {
      expect(updateIncidentSpy).toHaveBeenCalledWith('inc-detail-1', 'investigating');
    });

    // Load more incidents triggers server pagination
    fireEvent.click(screen.getByRole('button', { name: 'Load more incidents' }));
    expect(loadMoreIncidentsSpy).toHaveBeenCalledTimes(1);
  });

  it('marks a single TopHeader notification read without clearing siblings and deep-links to exact ticket or incident', () => {
    const markSingleReadSpy = vi.fn();
    const markTicketReadSpy = vi.fn();
    const setPendingTicketSpy = vi.fn();
    const setPendingIncidentSpy = vi.fn();
    const setActiveTabSpy = vi.fn();

    mockUseApp.mockReturnValue(
      buildMockContext({
        canViewPlatformAdmin: true,
        supportNotifications: [
          {
            id: 'sn-single-1',
            businessId: '1',
            targetRole: 'super_admin',
            ticketId: 'tk-deep-1',
            title: 'Support Ticket · Studio One',
            body: 'Need urgent help',
            isRead: false,
            createdAt: '2026-11-13T10:00:00Z',
          },
          {
            id: 'sn-single-2',
            businessId: '2',
            targetRole: 'super_admin',
            incidentId: 'inc-deep-1',
            title: 'Incident Alert · Studio Two',
            body: '502 gateway error',
            isRead: false,
            createdAt: '2026-11-13T10:05:00Z',
          },
        ],
        markSingleSupportNotificationRead: markSingleReadSpy,
        markTicketRead: markTicketReadSpy,
        setPendingAdminTicketId: setPendingTicketSpy,
        setPendingAdminIncidentId: setPendingIncidentSpy,
        setActiveTab: setActiveTabSpy,
      })
    );

    render(<TopHeader onOpenMobileMenu={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Notifications'));

    // Mark single notification read without clearing siblings
    fireEvent.click(screen.getByLabelText('Mark read: Support Ticket · Studio One'));
    expect(markSingleReadSpy).toHaveBeenCalledWith('sn-single-1');
    expect(markSingleReadSpy).toHaveBeenCalledTimes(1);
    expect(setActiveTabSpy).not.toHaveBeenCalled();

    // Clicking ticket notification routes to support-center & sets pending ticket
    fireEvent.click(screen.getByText('Support Ticket · Studio One'));
    expect(markTicketReadSpy).toHaveBeenCalledWith('tk-deep-1');
    expect(setPendingTicketSpy).toHaveBeenCalledWith('tk-deep-1');
    expect(setActiveTabSpy).toHaveBeenCalledWith('support-center');

    // Re-open & click incident notification routes to incidents & sets pending incident
    fireEvent.click(screen.getByLabelText('Notifications'));
    fireEvent.click(screen.getByText('Incident Alert · Studio Two'));
    expect(markSingleReadSpy).toHaveBeenCalledWith('sn-single-2');
    expect(setPendingIncidentSpy).toHaveBeenCalledWith('inc-deep-1');
    expect(setActiveTabSpy).toHaveBeenCalledWith('incidents');
  });
});




