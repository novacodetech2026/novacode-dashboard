import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { SEED_APPOINTMENTS } from '../data/seedData';
import { escapeCsvCell } from '../utils/security';
import { Appointment, Customer, Service } from '../types';

const mockUseApp = vi.fn();
vi.mock('../context/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

const createClientState = vi.hoisted(() => ({
  mockClient: null as any,
}));

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return {
    ...actual,
    createClient: (...args: any[]) => {
      if (createClientState.mockClient) {
        return createClientState.mockClient;
      }
      return (actual.createClient as any)(...args);
    },
  };
});

import {
  normalizeAppointmentStatus,
  fetchLiveServicesWithStatus,
  createBookingWithSupabase,
  rescheduleAppointmentInSupabase,
  updateAppointmentStatusInSupabase,
  createCustomerInSupabase,
  signUpWithEmailPassword,
  fetchUserAccessProfile,
  getSupabaseClient,
} from '../services/supabase';
import { AppointmentsView } from '../components/AppointmentsView';
import { CalendarView } from '../components/CalendarView';
import { AppointmentDetailDrawer } from '../components/AppointmentDetailDrawer';
import { ServicesView } from '../components/ServicesView';
import { NewAppointmentModal } from '../components/NewAppointmentModal';
import { CustomersView } from '../components/CustomersView';
import { SuperAdminContextBanner } from '../components/SuperAdminContextBanner';
import { AuthModal } from '../components/AuthModal';

function buildMockContext(overrides: Record<string, any> = {}) {
  const language: 'en' | 'es' = overrides.language || 'en';
  const tenant = {
    id: '42',
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
    mode: 'demo',
    setMode: vi.fn(),
    currentUser: {
      id: 'user-owner-1',
      email: 'owner@demostudio.com',
      role: 'owner',
      isSuperAdmin: false,
      platformRole: 'owner',
      businessMemberships: [],
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
    signupWithSupabase: vi.fn().mockResolvedValue({ success: false, error: 'Disabled' }),
    requestPasswordReset: vi.fn().mockResolvedValue({ success: true }),
    completePasswordReset: vi.fn().mockResolvedValue({ success: true }),
    completeInvitationOnboarding: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue(undefined),
    currentTenant: tenant,
    availableTenants: [tenant],
    setCurrentTenantId: vi.fn(),
    activeTab: 'overview',
    setActiveTab: vi.fn(),
    appointments: [] as Appointment[],
    customers: [] as Customer[],
    services: [] as Service[],
    activeServicesCount: 0,
    staff: [],
    isLoadingLiveData: false,
    liveDataError: null,
    liveDataErrorType: null,
    reloadLiveAppointments: vi.fn(),
    addAppointment: vi.fn().mockResolvedValue({ success: true }),
    updateAppointmentStatus: vi.fn().mockResolvedValue(undefined),
    rescheduleAppointment: vi.fn().mockResolvedValue({ success: true }),
    cancelAppointment: vi.fn().mockResolvedValue({ success: true }),
    addCustomer: vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '42',
      name: 'Test Client',
      phone: '+15550001111',
      email: '',
      preferredLanguage: 'en',
      totalAppointments: 0,
      lastInteractionAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }),
    updateCustomerNotes: vi.fn(),
    addService: vi.fn().mockResolvedValue({ success: true }),
    updateService: vi.fn().mockResolvedValue({ success: true }),
    isBookingConflict: vi.fn().mockReturnValue(false),
    setIsNewBookingModalOpen: vi.fn(),
    setSelectedAppointmentForDetail: vi.fn(),
    addToast: vi.fn(),
    ...overrides,
  };
}

function configureFreshMockSupabase(mockClient: any, suffix: string) {
  createClientState.mockClient = mockClient;
  localStorage.setItem(
    'novacode_supabase_config',
    JSON.stringify({
      url: `https://phase1-${suffix}.supabase.co`,
      anonKey: `anon-key-${suffix}`,
    })
  );
  // Prime cached client for this test case
  getSupabaseClient(`https://phase1-${suffix}.supabase.co`, `anon-key-${suffix}`);
}

describe('Phase 1 — Critical Data Integrity & Security Regression Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientState.mockClient = null;
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // 1. Appointment Status Consistency
  // -------------------------------------------------------------------------
  describe('1. Appointment status consistency', () => {
    it('normalizes no_show accurately without coercing to pending, and drops invalid in_progress', () => {
      expect(normalizeAppointmentStatus('pending')).toBe('pending');
      expect(normalizeAppointmentStatus('confirmed')).toBe('confirmed');
      expect(normalizeAppointmentStatus('completed')).toBe('completed');
      expect(normalizeAppointmentStatus('cancelled')).toBe('cancelled');
      expect(normalizeAppointmentStatus('canceled')).toBe('cancelled');
      expect(normalizeAppointmentStatus('no_show')).toBe('no_show');
      expect(normalizeAppointmentStatus('no-show')).toBe('no_show');
      expect(normalizeAppointmentStatus('in_progress')).toBe('pending');
      expect(normalizeAppointmentStatus('in_progress')).not.toBe('in_progress');
    });

    it('contains zero in_progress statuses in seed appointments', () => {
      expect(SEED_APPOINTMENTS.some((a: any) => a.status === 'in_progress')).toBe(false);
    });

    it('renders No-Show instead of In Progress in AppointmentsView and CalendarView filters', () => {
      mockUseApp.mockReturnValue(
        buildMockContext({
          appointments: [
            {
              id: 'apt-ns-1',
              tenantId: '42',
              customerId: 'cust-1',
              customerName: 'Alex Rivera',
              customerPhone: '+15551112222',
              customerLanguage: 'en',
              serviceId: 'srv-1',
              serviceName: 'Facial',
              date: '2026-11-20',
              startTime: '10:00',
              endTime: '11:00',
              durationMinutes: 60,
              price: 100,
              locationType: 'in_business',
              status: 'no_show',
              source: 'manual_dashboard',
              createdAt: '2026-11-16T00:00:00Z',
            },
          ],
        })
      );

      const { container: aptContainer } = render(<AppointmentsView />);
      expect(aptContainer.textContent).toContain('No-Show');
      expect(aptContainer.textContent).not.toContain('In Progress');

      const { container: calContainer } = render(<CalendarView />);
      expect(calContainer.textContent).toContain('No-Show');
      expect(calContainer.textContent).not.toContain('In Progress');
    });

    it('allows marking a confirmed appointment as no_show and reactivating a no_show appointment', () => {
      const updateAppointmentStatus = vi.fn();
      const confirmedApt: Appointment = {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '42',
        customerId: '22222222-2222-4222-8222-222222222222',
        customerName: 'Taylor Brooks',
        customerPhone: '+15550009999',
        customerLanguage: 'en',
        serviceId: '33333333-3333-4333-8333-333333333333',
        serviceName: 'Deep Tissue',
        date: '2026-11-20',
        startTime: '14:00',
        endTime: '15:00',
        durationMinutes: 60,
        price: 120,
        locationType: 'in_business',
        status: 'confirmed',
        source: 'manual_dashboard',
        createdAt: '2026-11-16T00:00:00Z',
      };

      mockUseApp.mockReturnValue(buildMockContext({ updateAppointmentStatus }));

      const { rerender } = render(
        <AppointmentDetailDrawer appointment={confirmedApt} onClose={vi.fn()} />
      );
      fireEvent.click(screen.getByText('Mark No-Show'));
      expect(updateAppointmentStatus).toHaveBeenCalledWith(confirmedApt.id, 'no_show');

      rerender(
        <AppointmentDetailDrawer
          appointment={{ ...confirmedApt, status: 'no_show' }}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('No-Show')).toBeTruthy();
      fireEvent.click(screen.getByText('Reactivate'));
      expect(updateAppointmentStatus).toHaveBeenCalledWith(confirmedApt.id, 'confirmed');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Service Activation Lifecycle
  // -------------------------------------------------------------------------
  describe('2. Service activation visibility, filtering, reactivation, and booking guard', () => {
    it('fetchLiveServicesWithStatus fetches both active and inactive services without is_active=true filter', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn((col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return builder;
        }),
        then: (resolve: any) =>
          Promise.resolve({
            data: [
              { id: 'svc-1', business_id: 42, name_en: 'Active Facial', is_active: true, price: 90, duration_minutes: 60 },
              { id: 'svc-2', business_id: 42, name_en: 'Retired Scrub', is_active: false, price: 70, duration_minutes: 45 },
            ],
            error: null,
          }).then(resolve),
      };

      configureFreshMockSupabase(
        { from: vi.fn(() => builder) },
        'svc-fetch'
      );

      const res = await fetchLiveServicesWithStatus('42', 'en');
      expect(res.items).toHaveLength(2);
      expect(res.items.find(s => s.id === 'svc-2')?.active).toBe(false);
      expect(eqCalls).toEqual([['business_id', 42]]);
    });

    it('ServicesView shows Inactive indicator, filters inactive services, and lets owners reactivate', async () => {
      const updateService = vi.fn().mockResolvedValue({ success: true });
      const activeSvc: Service = {
        id: 'svc-a',
        tenantId: '42',
        nameEn: 'Active Massage',
        nameEs: 'Masaje Activo',
        descriptionEn: 'Available now',
        descriptionEs: 'Disponible ahora',
        durationMinutes: 60,
        price: 120,
        category: 'Massage',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: true,
      };
      const inactiveSvc: Service = {
        id: 'svc-b',
        tenantId: '42',
        nameEn: 'Seasonal Wrap',
        nameEs: 'Envoltura de Temporada',
        descriptionEn: 'Currently paused',
        descriptionEs: 'Actualmente pausado',
        durationMinutes: 45,
        price: 85,
        category: 'Spa',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: false,
      };

      mockUseApp.mockReturnValue(
        buildMockContext({
          services: [activeSvc, inactiveSvc],
          activeServicesCount: 1,
          canManageServices: true,
          updateService,
        })
      );

      render(<ServicesView />);

      expect(screen.getByText('Active Massage')).toBeTruthy();
      expect(screen.getByText('Seasonal Wrap')).toBeTruthy();
      expect(screen.getByText('Inactive')).toBeTruthy();

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
      expect(screen.queryByText('Active Massage')).toBeNull();
      expect(screen.getByText('Seasonal Wrap')).toBeTruthy();

      fireEvent.click(screen.getByText('Reactivate'));
      await waitFor(() => {
        expect(updateService).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'svc-b', active: true })
        );
      });
    });

    it('NewAppointmentModal hides inactive services from Step 2 booking selection', () => {
      mockUseApp.mockReturnValue(
        buildMockContext({
          customers: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: '42',
              name: 'Dana White',
              phone: '+15551112222',
              email: '',
              preferredLanguage: 'en',
              totalAppointments: 0,
              lastInteractionAt: '2026-11-16T00:00:00Z',
              createdAt: '2026-11-16T00:00:00Z',
            },
          ],
          services: [
            {
              id: 'srv-active',
              tenantId: '42',
              nameEn: 'Active Service',
              nameEs: 'Servicio Activo',
              descriptionEn: '',
              descriptionEs: '',
              durationMinutes: 60,
              price: 100,
              category: 'General',
              allowsInBusiness: true,
              allowsAtHome: false,
              active: true,
            },
            {
              id: 'srv-inactive',
              tenantId: '42',
              nameEn: 'Inactive Service',
              nameEs: 'Servicio Inactivo',
              descriptionEn: '',
              descriptionEs: '',
              durationMinutes: 60,
              price: 100,
              category: 'General',
              allowsInBusiness: true,
              allowsAtHome: false,
              active: false,
            },
          ],
        })
      );

      render(<NewAppointmentModal isOpen={true} onClose={vi.fn()} />);

      fireEvent.click(screen.getByText('Dana White'));
      fireEvent.click(screen.getByText('Next Step'));

      expect(screen.getByText('Active Service')).toBeTruthy();
      expect(screen.queryByText('Inactive Service')).toBeNull();
    });

    it('createBookingWithSupabase blocks inactive services before calling availability or booking RPCs', async () => {
      const rpcMock = vi.fn();
      const customerQuery: any = {
        select: vi.fn(() => customerQuery),
        eq: vi.fn(() => customerQuery),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: '11111111-1111-4111-8111-111111111111', business_id: 42 },
          error: null,
        }),
      };
      const serviceQuery: any = {
        select: vi.fn(() => serviceQuery),
        eq: vi.fn(() => serviceQuery),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: '22222222-2222-4222-8222-222222222222', business_id: 42, is_active: false },
          error: null,
        }),
      };

      configureFreshMockSupabase(
        {
          from: vi.fn((table: string) => (table === 'customers' ? customerQuery : serviceQuery)),
          rpc: rpcMock,
        },
        'inactive-book'
      );

      const res = await createBookingWithSupabase({
        businessId: '42',
        customerId: '11111111-1111-4111-8111-111111111111',
        customerName: 'Dana White',
        customerPhone: '+15551112222',
        customerLanguage: 'en',
        serviceId: '22222222-2222-4222-8222-222222222222',
        serviceName: 'Inactive Service',
        date: '2026-11-25',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        price: 100,
        locationType: 'in_business',
        timezone: 'America/New_York',
      });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/inactive services cannot be booked/i);
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Multi-Tenant Security
  // -------------------------------------------------------------------------
  describe('3. Multi-tenant scoping & frontend credential safety', () => {
    it('rescheduleAppointmentInSupabase enforces business_id on primary and fallback updates', async () => {
      const updateEqCalls: Array<Array<[string, unknown]>> = [];
      let callIndex = 0;

      const makeBuilder = () => {
        const calls: Array<[string, unknown]> = [];
        updateEqCalls.push(calls);
        const idx = callIndex++;
        const builder: any = {
          update: vi.fn(() => builder),
          eq: vi.fn((col: string, val: unknown) => {
            calls.push([col, val]);
            return builder;
          }),
          then: (resolve: any) =>
            Promise.resolve(
              idx === 0
                ? { error: { code: '42703', message: 'column "date" does not exist' } }
                : { error: null }
            ).then(resolve),
        };
        return builder;
      };

      configureFreshMockSupabase({ from: vi.fn(() => makeBuilder()) }, 'resched');

      const missingBiz = await rescheduleAppointmentInSupabase(
        '11111111-1111-4111-8111-111111111111',
        '2026-11-25',
        '11:00',
        '12:00',
        'America/New_York',
        'confirmed',
        ''
      );
      expect(missingBiz.success).toBe(false);
      expect(updateEqCalls).toHaveLength(0);

      const okRes = await rescheduleAppointmentInSupabase(
        '11111111-1111-4111-8111-111111111111',
        '2026-11-25',
        '11:00',
        '12:00',
        'America/New_York',
        'confirmed',
        '42'
      );
      expect(okRes.success).toBe(true);
      expect(updateEqCalls).toHaveLength(2);
      expect(updateEqCalls[0]).toContainEqual(['business_id', 42]);
      expect(updateEqCalls[1]).toContainEqual(['business_id', 42]);
    });

    it('updateAppointmentStatusInSupabase requires businessId and rejects invalid statuses', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const builder: any = {
        update: vi.fn(() => builder),
        eq: vi.fn((col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return builder;
        }),
        then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
      };

      configureFreshMockSupabase({ from: vi.fn(() => builder) }, 'status-upd');

      const invalidStatus = await updateAppointmentStatusInSupabase('apt-1', 'in_progress', '42');
      expect(invalidStatus.success).toBe(false);
      expect(eqCalls).toHaveLength(0);

      const missingBiz = await updateAppointmentStatusInSupabase('apt-1', 'no_show');
      expect(missingBiz.success).toBe(false);

      const ok = await updateAppointmentStatusInSupabase('apt-1', 'no_show', '42');
      expect(ok.success).toBe(true);
      expect(eqCalls).toContainEqual(['business_id', 42]);
    });

    it('contains zero service_role keys or secrets anywhere in src/', () => {
      const srcDir = path.resolve(process.cwd(), 'src');
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return entry.name === 'test' ? [] : walk(full);
          return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
        });

      for (const filePath of walk(srcDir)) {
        const content = fs.readFileSync(filePath, 'utf8');
        // Ensure no hardcoded service_role JWT or VITE_SUPABASE_SERVICE_ROLE_KEY exists
        expect(content).not.toMatch(/VITE_.*SERVICE_ROLE/i);
        expect(content).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[^'"]*service_role/i);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Data Integrity (Email Nullability & CSV Formula Neutralization)
  // -------------------------------------------------------------------------
  describe('4. Data integrity (no fake @example.com emails, CSV formula protection & URL cleanup)', () => {
    it('CustomersView does not fabricate @example.com when email is omitted, and createCustomerInSupabase sends null', async () => {
      const addCustomer = vi.fn().mockResolvedValue({ id: 'c1' });
      mockUseApp.mockReturnValue(buildMockContext({ addCustomer }));

      render(<CustomersView />);
      fireEvent.click(screen.getAllByText('Add Customer')[0]);
      fireEvent.change(screen.getByPlaceholderText('e.g. David Miller'), { target: { value: 'John Doe' } });
      fireEvent.change(screen.getByPlaceholderText('+1 (732) 555-0199'), { target: { value: '+15551234567' } });
      fireEvent.click(screen.getByText('Save Customer'));

      await waitFor(() => {
        expect(addCustomer).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'John Doe',
            phone: '+15551234567',
            email: '',
          })
        );
      });

      const insertedPayloads: any[] = [];
      const builder: any = {
        insert: vi.fn((payload: any) => {
          insertedPayloads.push(payload);
          return builder;
        }),
        select: vi.fn(() => builder),
        single: vi.fn().mockResolvedValue({
          data: { id: 'cust-new', business_id: 42, full_name: 'John Doe', phone: '+15551234567', email: null },
          error: null,
        }),
      };
      configureFreshMockSupabase({ from: vi.fn(() => builder) }, 'cust-null-email');

      await createCustomerInSupabase('42', {
        name: 'John Doe',
        phone: '+15551234567',
        email: '',
        preferredLanguage: 'en',
      });

      expect(insertedPayloads[0].email).toBeNull();
    });

    it('NewAppointmentModal does not fabricate @example.com when creating a customer without email', async () => {
      const addCustomer = vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '42',
        name: 'Elena Gomez',
        phone: '+15559990000',
        email: '',
        preferredLanguage: 'en',
        totalAppointments: 0,
        lastInteractionAt: '2026-11-16T00:00:00Z',
        createdAt: '2026-11-16T00:00:00Z',
      });

      mockUseApp.mockReturnValue(buildMockContext({ addCustomer }));
      render(<NewAppointmentModal isOpen={true} onClose={vi.fn()} />);

      fireEvent.click(screen.getByText('Create New Client'));
      fireEvent.change(screen.getByPlaceholderText('e.g. Maria Gonzalez'), { target: { value: 'Elena Gomez' } });
      fireEvent.change(screen.getByPlaceholderText('+1 (555) 000-0000'), { target: { value: '+15559990000' } });
      fireEvent.click(screen.getByText('Next Step'));

      await waitFor(() => {
        expect(addCustomer).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Elena Gomez',
            phone: '+15559990000',
            email: '',
          })
        );
      });
    });

    it('escapeCsvCell neutralizes spreadsheet formulas and AppointmentsView revokes object URLs', async () => {
      expect(escapeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
      expect(escapeCsvCell('+1555')).toBe('"\'+1555"');
      expect(escapeCsvCell('-10+2')).toBe('"\'-10+2"');
      expect(escapeCsvCell('@SUM(A1:A2)')).toBe('"\'@SUM(A1:A2)"');
      expect(escapeCsvCell('\t=1+1')).toBe('"\'\t=1+1"');
      expect(escapeCsvCell('Normal "Client", Jr.')).toBe('"Normal ""Client"", Jr."');

      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      const createSpy = vi.fn().mockReturnValue('blob:mock-csv-url');
      const revokeSpy = vi.fn();
      URL.createObjectURL = createSpy;
      URL.revokeObjectURL = revokeSpy;

      let capturedBlob: Blob | null = null;
      createSpy.mockImplementation((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:mock-csv-url';
      });

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      mockUseApp.mockReturnValue(
        buildMockContext({
          appointments: [
            {
              id: 'apt-csv-1',
              tenantId: '42',
              customerId: 'cust-1',
              customerName: '=HYPERLINK("http://evil.example","Click")',
              customerPhone: '+15551234567',
              customerLanguage: 'en',
              serviceId: 'srv-1',
              serviceName: '@FormulaService',
              date: '2026-11-20',
              startTime: '10:00',
              endTime: '11:00',
              durationMinutes: 60,
              price: 95,
              locationType: 'in_business',
              status: 'confirmed',
              source: 'manual_dashboard',
              createdAt: '2026-11-16T00:00:00Z',
            },
          ],
        })
      );

      render(<AppointmentsView />);
      fireEvent.click(screen.getByText('Export CSV'));

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-csv-url');
      expect(capturedBlob).not.toBeNull();
      const csvText = await capturedBlob!.text();
      expect(csvText).toContain('"\'=HYPERLINK(""http://evil.example"",""Click"")"');
      expect(csvText).toContain('"\'@FormulaService"');
      expect(csvText).toContain('"\'+15551234567"');

      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });
  });

  // -------------------------------------------------------------------------
  // 5. Super Admin Context Banner
  // -------------------------------------------------------------------------
  describe('5. Super Admin support-center context detection', () => {
    it('treats support-center as a platform admin route instead of a business dashboard view', () => {
      mockUseApp.mockReturnValue(
        buildMockContext({
          canViewPlatformAdmin: true,
          isSuperAdmin: true,
          activeTab: 'support-center',
          currentUser: {
            id: 'super-1',
            email: 'admin@novacodetech.com',
            isSuperAdmin: true,
            platformRole: 'super_admin',
            businessMemberships: [],
          },
          availableTenants: [
            { ...buildMockContext().currentTenant, id: '42', name: 'Serenity Cove' },
          ],
        })
      );

      render(<SuperAdminContextBanner />);
      const selector = screen.getByLabelText('Select Business') as HTMLSelectElement;
      expect(selector.value).toBe('__platform_admin__');
      expect(screen.queryByText('Return to Platform Administration')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Authentication & Inactive Membership / Business Hardening
  // -------------------------------------------------------------------------
  describe('6. Authentication & inactive membership/business isolation', () => {
    it('disables public self-signup UI in AuthModal while preserving invitation onboarding & password reset', () => {
      mockUseApp.mockReturnValue(buildMockContext());

      const { rerender } = render(<AuthModal isOpen={true} onClose={vi.fn()} />);
      expect(screen.queryByText('Create Account')).toBeNull();
      expect(screen.queryByText('Create Business Account')).toBeNull();
      expect(screen.getByText('Forgot Password?')).toBeTruthy();
      expect(screen.getByText(translations.en.auth.inviteOnlyNotice)).toBeTruthy();

      // Invitation onboarding (/accept-invite) remains fully available
      mockUseApp.mockReturnValue(
        buildMockContext({
          isInvitationOnboardingMode: true,
          authSession: { user: { id: 'u1', email: 'invited@company.com' } },
        })
      );
      rerender(<AuthModal isOpen={true} onClose={vi.fn()} />);
      expect(screen.getByText('Complete Your Business Owner Setup')).toBeTruthy();
      expect(screen.getByText('Set Password & Activate Access')).toBeTruthy();
    });

    it('signUpWithEmailPassword refuses public self-registration', async () => {
      const res = await signUpWithEmailPassword('attacker@evil.test', 'Secret123!', 'Rogue Biz');
      expect(res.user).toBeNull();
      expect(res.session).toBeNull();
      expect(res.error).toMatch(/disabled/i);
    });

    it('fetchUserAccessProfile filters out inactive business_members and suspended businesses for non-Super-Admin', async () => {
      const membersBuilder: any = {
        select: vi.fn(() => membersBuilder),
        eq: vi.fn().mockResolvedValue({
          data: [
            { id: 'm1', user_id: 'u-1', business_id: 10, role: 'owner', is_active: false },
            { id: 'm2', user_id: 'u-1', business_id: 20, role: 'owner', is_active: true },
            { id: 'm3', user_id: 'u-1', business_id: 30, role: 'staff', is_active: true },
          ],
          error: null,
        }),
      };

      const businessesBuilder: any = {
        select: vi.fn(() => businessesBuilder),
        in: vi.fn(() => businessesBuilder),
        order: vi.fn().mockResolvedValue({
          data: [
            { id: 20, name: 'Suspended Biz', is_active: false },
            { id: 30, name: 'Active Biz', is_active: true },
          ],
          error: null,
        }),
      };

      configureFreshMockSupabase(
        {
          auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u-1' } } }, error: null }),
          },
          rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
          from: vi.fn((table: string) =>
            table === 'business_members' ? membersBuilder : businessesBuilder
          ),
        },
        'access-filter'
      );

      const profile = await fetchUserAccessProfile('u-1');
      expect(profile.isSuperAdmin).toBe(false);
      expect(profile.accessibleBusinesses.map(b => b.id)).toEqual(['30']);
      expect(profile.memberships.map(m => m.businessId)).toEqual(['30']);
    });
  });
});
