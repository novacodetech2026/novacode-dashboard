import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { Appointment, Customer, Service, Staff, Tenant } from '../types';
import {
  resolveBusinessHoursForDate,
  generateBookingTimeSlots,
  validateBookingWindow,
  validateCancellationWindow,
  formatCancellationValidationError,
} from '../utils/scheduling';
import { sanitizeErrorForBusiness, containsInfrastructureTerms } from '../utils/security';

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
  checkAvailabilityInSupabase,
  rescheduleAppointmentInSupabase,
  getSupabaseClient,
} from '../services/supabase';
import { NewAppointmentModal } from '../components/NewAppointmentModal';
import { RescheduleModal } from '../components/RescheduleModal';
import { AppointmentDetailDrawer } from '../components/AppointmentDetailDrawer';

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: '42',
    name: 'Novacode Demo Studio',
    slug: 'demo-studio',
    tagline: 'Wellness & Spa',
    logo: '',
    category: 'spa',
    categoryLabelEn: 'Spa & Wellness',
    categoryLabelEs: 'Spa y Bienestar',
    timezone: 'America/New_York',
    defaultLanguage: 'en',
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
    ...overrides,
  };
}

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '42',
    customerId: '22222222-2222-4222-8222-222222222222',
    customerName: 'Alex Rivera',
    customerPhone: '+15550101',
    customerLanguage: 'en',
    serviceId: '33333333-3333-4333-8333-333333333333',
    serviceName: 'Facial Treatment',
    date: '2099-05-06',
    startTime: '10:00',
    endTime: '11:00',
    durationMinutes: 60,
    price: 95,
    status: 'confirmed',
    locationType: 'in_business',
    source: 'manual_dashboard',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: '42',
    nameEn: 'Facial Treatment',
    nameEs: 'Tratamiento Facial',
    descriptionEn: 'Relaxing facial',
    descriptionEs: 'Facial relajante',
    durationMinutes: 60,
    price: 95,
    category: 'Facial',
    active: true,
    allowsInBusiness: true,
    allowsAtHome: false,
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: '42',
    name: 'Alex Rivera',
    phone: '+15550101',
    email: 'alex@example.com',
    preferredLanguage: 'en',
    totalAppointments: 1,
    lastInteractionAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 'staff-1',
    tenantId: '42',
    name: 'Elena Gomez',
    roleEn: 'Specialist',
    roleEs: 'Especialista',
    email: 'elena@demostudio.com',
    phone: '+15550102',
    avatar: '',
    active: true,
    servicesProvided: ['33333333-3333-4333-8333-333333333333'],
    ...overrides,
  };
}

function buildMockContext(overrides: Record<string, any> = {}) {
  const language: 'en' | 'es' = overrides.language || 'en';
  const tenant = overrides.currentTenant || makeTenant();
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
    currentTenant: tenant,
    customers: [makeCustomer()],
    services: [makeService()],
    staff: [makeStaff()],
    appointments: [],
    addAppointment: vi.fn().mockResolvedValue({ success: true }),
    addCustomer: vi.fn().mockResolvedValue(makeCustomer()),
    isBookingConflict: vi.fn().mockReturnValue(false),
    rescheduleAppointment: vi.fn().mockResolvedValue({ success: true }),
    cancelAppointment: vi.fn().mockResolvedValue({ success: true }),
    updateAppointmentStatus: vi.fn().mockResolvedValue({ success: true }),
    selectedAppointmentForDetail: null,
    setSelectedAppointmentForDetail: vi.fn(),
    setActiveConversationId: vi.fn(),
    setActiveTab: vi.fn(),
    conversations: [],
    ...overrides,
  };
}

describe('Phase 2 — Booking Rules & Scheduling Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientState.mockClient = null;
    localStorage.clear();
  });

  describe('1. Operating Hours, Special Hours, Holidays & Timezone Slot Generation', () => {
    it('resolves weekly operatingHours, closed days, and specialHours holiday/custom overrides', () => {
      const tenant = makeTenant({
        settings: {
          ...makeTenant().settings,
          specialHours: [
            { id: 'sh-1', date: '2099-05-06', open: '11:00', close: '14:00', isClosed: false, label: 'Reduced Day' },
            { id: 'sh-2', date: '2099-05-07', open: '09:00', close: '18:00', isClosed: true, label: 'Founders Holiday' },
          ],
        },
      });

      // Sunday 2099-05-03 is closed in weekly operatingHours
      expect(resolveBusinessHoursForDate(tenant, '2099-05-03').isClosed).toBe(true);

      // Wednesday 2099-05-06 uses custom specialHours
      const special = resolveBusinessHoursForDate(tenant, '2099-05-06');
      expect(special.isClosed).toBe(false);
      expect(special.isSpecialHours).toBe(true);
      expect(special.open).toBe('11:00');
      expect(special.close).toBe('14:00');
      expect(special.specialLabel).toBe('Reduced Day');

      // Thursday 2099-05-07 is a holiday closure
      const holiday = resolveBusinessHoursForDate(tenant, '2099-05-07');
      expect(holiday.isClosed).toBe(true);
      expect(holiday.isSpecialHours).toBe(true);
      expect(holiday.specialLabel).toBe('Founders Holiday');

      // Friday 2099-05-08 falls back to normal weekly hours 09:00 - 18:00
      const regular = resolveBusinessHoursForDate(tenant, '2099-05-08');
      expect(regular.isClosed).toBe(false);
      expect(regular.isSpecialHours).toBe(false);
      expect(regular.open).toBe('09:00');
      expect(regular.close).toBe('18:00');
    });

    it('dynamically generates slots within operating hours and excludes past slots per business timezone', () => {
      // 2026-06-15T16:15:00Z = 12:15 in America/New_York (EDT UTC-4) = 09:15 in America/Los_Angeles (PDT UTC-7)
      const now = new Date('2026-06-15T16:15:00.000Z');
      const nyTenant = makeTenant({ timezone: 'America/New_York' });
      const laTenant = makeTenant({ timezone: 'America/Los_Angeles' });

      const nySlots = generateBookingTimeSlots({
        tenant: nyTenant,
        date: '2026-06-15',
        durationMinutes: 60,
        appointments: [],
        now,
      });
      const laSlots = generateBookingTimeSlots({
        tenant: laTenant,
        date: '2026-06-15',
        durationMinutes: 60,
        appointments: [],
        now,
      });

      const ny10 = nySlots.slots.find(s => s.time === '10:00');
      const la10 = laSlots.slots.find(s => s.time === '10:00');
      expect(ny10?.status).toBe('past');
      expect(ny10?.isAvailable).toBe(false);
      expect(la10?.status).toBe('available');
      expect(la10?.isAvailable).toBe(true);

      // Operating hours end at 18:00, so 60-min service cannot start at 17:30
      expect(laSlots.slots.some(s => s.time === '17:00')).toBe(true);
      expect(laSlots.slots.some(s => s.time === '17:30')).toBe(false);
    });

    it('returns zero slots on closed holidays', () => {
      const tenant = makeTenant({
        settings: {
          ...makeTenant().settings,
          specialHours: [
            { id: 'sh-hol', date: '2099-05-06', open: '09:00', close: '18:00', isClosed: true, label: 'Holiday' },
          ],
        },
      });

      const result = generateBookingTimeSlots({
        tenant,
        date: '2099-05-06',
        durationMinutes: 60,
        appointments: [],
      });

      expect(result.effectiveHours.isClosed).toBe(true);
      expect(result.slots).toHaveLength(0);
    });
  });

  describe('2. Buffer Between Appointments, Overlap, & Inactive Service Enforcement', () => {
    it('enforces bufferBetweenAppointmentsMinutes before and after existing bookings', () => {
      const tenant = makeTenant(); // 15 min buffer, 09:00-18:00
      const existing = [
        makeAppointment({
          id: 'apt-existing',
          date: '2099-05-06',
          startTime: '11:00',
          endTime: '12:00',
          durationMinutes: 60,
          status: 'confirmed',
        }),
      ];

      // Overlap: 11:30 - 12:30
      const overlap = validateBookingWindow({
        tenant,
        date: '2099-05-06',
        startTime: '11:30',
        durationMinutes: 60,
        appointments: existing,
      });
      expect(overlap.valid).toBe(false);
      expect(overlap.reason).toBe('overlap_conflict');

      // Buffer conflict immediately after: 12:00 - 13:00 (requires 15m after 12:00)
      const bufferAfter = validateBookingWindow({
        tenant,
        date: '2099-05-06',
        startTime: '12:00',
        durationMinutes: 60,
        appointments: existing,
      });
      expect(bufferAfter.valid).toBe(false);
      expect(bufferAfter.reason).toBe('buffer_conflict');

      // Buffer conflict immediately before: 10:00 - 11:00 (ends at 11:00, <15m before 11:00)
      const bufferBefore = validateBookingWindow({
        tenant,
        date: '2099-05-06',
        startTime: '10:00',
        durationMinutes: 60,
        appointments: existing,
      });
      expect(bufferBefore.valid).toBe(false);
      expect(bufferBefore.reason).toBe('buffer_conflict');

      // Boundary valid: 12:15 - 13:15 passes exact 15-minute buffer
      const boundaryAfter = validateBookingWindow({
        tenant,
        date: '2099-05-06',
        startTime: '12:15',
        durationMinutes: 60,
        appointments: existing,
      });
      expect(boundaryAfter.valid).toBe(true);

      // Cancelled/no_show appointments do not block buffer or slot
      const cancelledExisting = [makeAppointment({ ...existing[0], status: 'cancelled' })];
      const cancelledSlot = validateBookingWindow({
        tenant,
        date: '2099-05-06',
        startTime: '11:00',
        durationMinutes: 60,
        appointments: cancelledExisting,
      });
      expect(cancelledSlot.valid).toBe(true);
    });

    it('blocks booking of inactive services and rescheduling onto another conflict while excluding self', () => {
      const tenant = makeTenant();
      const existing = [
        makeAppointment({ id: 'apt-1', date: '2099-05-06', startTime: '10:00', endTime: '11:00', status: 'confirmed' }),
      ];

      const inactiveResult = validateBookingWindow({
        tenant,
        date: '2099-05-06',
        startTime: '14:00',
        durationMinutes: 60,
        appointments: existing,
        service: makeService({ active: false }),
      });
      expect(inactiveResult.valid).toBe(false);
      expect(inactiveResult.reason).toBe('inactive_service');

      // Excluding self allows keeping/adjusting own window
      const selfExclude = validateBookingWindow({
        tenant,
        date: '2099-05-06',
        startTime: '10:00',
        durationMinutes: 60,
        appointments: existing,
        excludeAppointmentId: 'apt-1',
        service: makeService({ active: true }),
      });
      expect(selfExclude.valid).toBe(true);
    });
  });

  describe('3. Cancellation Buffer Enforcement (cancellationBufferHours)', () => {
    it('blocks cancellations inside cancellationBufferHours and allows outside window', () => {
      const tenant = makeTenant({
        timezone: 'America/New_York',
        settings: { ...makeTenant().settings, cancellationBufferHours: 24 },
      });

      // Fixed now: 2026-06-15 10:00 EDT (14:00Z)
      const now = new Date('2026-06-15T14:00:00.000Z');

      // 12 hours later -> inside 24h buffer -> blocked
      const tooClose = validateCancellationWindow(
        { date: '2026-06-15', startTime: '22:00', status: 'confirmed' },
        tenant,
        now
      );
      expect(tooClose.allowed).toBe(false);
      expect(tooClose.reason).toBe('within_cancellation_buffer');
      expect(tooClose.requiredHours).toBe(24);
      expect(formatCancellationValidationError(tooClose, 'en')).toContain('24 hours');
      expect(formatCancellationValidationError(tooClose, 'es')).toContain('24 horas');

      // 30 hours later -> outside 24h buffer -> allowed
      const allowed = validateCancellationWindow(
        { date: '2026-06-16', startTime: '16:00', status: 'confirmed' },
        tenant,
        now
      );
      expect(allowed.allowed).toBe(true);

      // Completed & already cancelled are never cancellable
      expect(
        validateCancellationWindow({ date: '2099-05-06', startTime: '10:00', status: 'completed' }, tenant, now).reason
      ).toBe('already_completed');
      expect(
        validateCancellationWindow({ date: '2099-05-06', startTime: '10:00', status: 'cancelled' }, tenant, now).reason
      ).toBe('already_cancelled');
    });
  });

  describe('4. Error Sanitization for Server-Side Scheduling Errors', () => {
    it('translates database scheduling trigger errors to clean bilingual copy without infra leaks', () => {
      const serverMessages = [
        { code: 'P0001', message: 'Inactive services cannot be booked.' },
        { code: 'P0001', message: 'Cancellation rejected: appointments must be cancelled at least 24 hours in advance.' },
        { code: 'P0001', message: 'Business is closed on 2099-05-07 (Founders Holiday).' },
        { code: 'P0001', message: 'Selected time is outside operating hours (09:00 to 18:00).' },
        { code: 'P0001', message: 'Appointments cannot be scheduled in the past.' },
        { code: 'P0001', message: 'Schedule conflict: required 15 minute buffer between appointments.' },
        { code: 'P0001', message: 'Schedule conflict: overlaps another booking.' },
      ];

      for (const raw of serverMessages) {
        const en = sanitizeErrorForBusiness(raw, 'en');
        const es = sanitizeErrorForBusiness(raw, 'es');
        expect(en.errorType).toBe('validation');
        expect(es.errorType).toBe('validation');
        expect(containsInfrastructureTerms(en.userMessage)).toBe(false);
        expect(containsInfrastructureTerms(es.userMessage)).toBe(false);
      }

      expect(sanitizeErrorForBusiness(serverMessages[1], 'en').userMessage).toContain('24 hours');
      expect(sanitizeErrorForBusiness(serverMessages[5], 'es').userMessage).toContain('15 min');
    });
  });

  describe('5. UI Components Integration (NewAppointmentModal, RescheduleModal, AppointmentDetailDrawer)', () => {
    it('renders dynamic slots from specialHours and blocks closed holiday dates in NewAppointmentModal', async () => {
      const tenant = makeTenant({
        settings: {
          ...makeTenant().settings,
          specialHours: [
            { id: 'sh-1', date: '2099-05-06', open: '11:00', close: '13:00', isClosed: false, label: 'Half Day' },
            { id: 'sh-2', date: '2099-05-07', open: '09:00', close: '18:00', isClosed: true, label: 'Holiday' },
          ],
        },
      });
      mockUseApp.mockReturnValue(buildMockContext({ currentTenant: tenant }));

      render(<NewAppointmentModal isOpen={true} onClose={vi.fn()} />);

      // Step 1 -> select client -> Next
      fireEvent.click(screen.getByText('Alex Rivera'));
      fireEvent.click(screen.getByText(translations.en.bookingModal.btnNext));

      // Step 2 -> select service -> Next
      fireEvent.click(screen.getByText('Facial Treatment'));
      fireEvent.click(screen.getByText(translations.en.bookingModal.btnNext));

      // Step 3 -> change date to 2099-05-06 (Half Day 11:00 - 13:00)
      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2099-05-06' } });

      expect(screen.getByText(/Half Day: 11:00/)).toBeInTheDocument();
      // 09:00 should NOT exist, 11:00 & 12:00 SHOULD exist
      expect(screen.queryByRole('button', { name: '09:00' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '11:00' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '12:00' })).toBeInTheDocument();

      // Switch to holiday 2099-05-07 -> closed holiday notice appears
      fireEvent.change(dateInput, { target: { value: '2099-05-07' } });
      expect(screen.getAllByText(/Closed for Holiday/).length).toBeGreaterThan(0);
    });

    it('enforces operating hours and shows dynamic slot buttons in RescheduleModal', async () => {
      const rescheduleAppointment = vi.fn().mockResolvedValue({ success: true });
      const tenant = makeTenant({
        settings: {
          ...makeTenant().settings,
          specialHours: [
            { id: 'sh-hol', date: '2099-05-07', open: '09:00', close: '18:00', isClosed: true, label: 'Holiday' },
          ],
        },
      });
      const existingOther = makeAppointment({
        id: 'other-apt',
        date: '2099-05-06',
        startTime: '12:00',
        endTime: '13:00',
      });
      const targetApt = makeAppointment({
        id: 'target-apt',
        date: '2099-05-06',
        startTime: '09:00',
        endTime: '10:00',
      });

      mockUseApp.mockReturnValue(
        buildMockContext({
          currentTenant: tenant,
          appointments: [targetApt, existingOther],
          rescheduleAppointment,
        })
      );

      render(<RescheduleModal appointment={targetApt} isOpen={true} onClose={vi.fn()} />);

      // 13:00 slot button is disabled because of 15-min buffer after 12:00-13:00 appointment
      const btn13 = screen.getByRole('button', { name: '13:00' });
      expect(btn13).toBeDisabled();

      // Manually entering 13:00 in time input and submitting should show buffer conflict error
      const timeInput = document.getElementById('reschedule-time') as HTMLInputElement;
      fireEvent.change(timeInput, { target: { value: '13:00' } });
      fireEvent.submit(timeInput.closest('form')!);

      expect(screen.getByText(/15 minutes are required between appointments/i)).toBeInTheDocument();
      expect(rescheduleAppointment).not.toHaveBeenCalled();

      // Clicking valid slot 14:00 and saving calls rescheduleAppointment
      const btn14 = screen.getByRole('button', { name: '14:00' });
      expect(btn14).not.toBeDisabled();
      fireEvent.click(btn14);
      fireEvent.submit(timeInput.closest('form')!);

      await waitFor(() => {
        expect(rescheduleAppointment).toHaveBeenCalledWith('target-apt', '2099-05-06', '14:00');
      });
    });

    it('surfaces cancellationBufferHours policy & inline error in AppointmentDetailDrawer', async () => {
      const cancelAppointment = vi.fn().mockResolvedValue({
        success: false,
        error: 'Cannot cancel: this business requires at least 24 hours advance notice before the appointment start time.',
      });
      const apt = makeAppointment({ status: 'confirmed' });
      const tenant = makeTenant();

      mockUseApp.mockReturnValue(
        buildMockContext({
          currentTenant: tenant,
          cancelAppointment,
        })
      );

      const onClose = vi.fn();
      render(<AppointmentDetailDrawer appointment={apt} onClose={onClose} />);

      fireEvent.click(screen.getByText(translations.en.appointment.cancelAction));
      expect(screen.getByText(/24h advance notice/)).toBeInTheDocument();

      fireEvent.click(screen.getByText(translations.en.appointment.confirmCancelButton));

      await waitFor(() => {
        expect(cancelAppointment).toHaveBeenCalledWith(apt.id);
        expect(screen.getByText(/at least 24 hours advance notice/)).toBeInTheDocument();
      });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('6. Supabase Scheduling RPCs & Safe Fallback', () => {
    function configureMockClient(mockClient: any, suffix: string) {
      createClientState.mockClient = mockClient;
      localStorage.setItem(
        'novacode_supabase_config',
        JSON.stringify({
          url: `https://phase2-${suffix}.supabase.co`,
          anonKey: `anon-key-${suffix}`,
        })
      );
      getSupabaseClient(`https://phase2-${suffix}.supabase.co`, `anon-key-${suffix}`);
    }

    it('layers check_scheduling_availability onto checkAvailabilityInSupabase and handles PGRST202 gracefully', async () => {
      const rpcMock = vi
        .fn()
        // Call 1: check_availability -> true
        .mockResolvedValueOnce({ data: true, error: null })
        // Call 2: check_scheduling_availability -> rejected due to 15-min buffer
        .mockResolvedValueOnce({
          data: { available: false, reason: 'Schedule conflict: required 15 minute buffer between appointments.' },
          error: null,
        });

      configureMockClient(
        {
          auth: {
            getSession: vi.fn(),
            onAuthStateChange: vi.fn(),
          },
          rpc: rpcMock,
        },
        'avail'
      );

      const blocked = await checkAvailabilityInSupabase({
        businessId: '42',
        serviceId: '33333333-3333-4333-8333-333333333333',
        date: '2099-05-06',
        startTime: '12:00',
        timezone: 'America/New_York',
      });

      expect(blocked.available).toBe(false);
      expect(blocked.error).toContain('15 minute buffer');

      // When rescheduling (excludeAppointmentId), calls check_scheduling_availability directly and handles PGRST202 fallback
      rpcMock
        .mockResolvedValueOnce({
          data: null,
          error: { code: 'PGRST202', message: 'Could not find the function public.check_scheduling_availability' },
        })
        .mockResolvedValueOnce({ data: true, error: null });

      const fallbackRes = await checkAvailabilityInSupabase({
        businessId: '42',
        serviceId: '33333333-3333-4333-8333-333333333333',
        date: '2099-05-06',
        startTime: '14:00',
        timezone: 'America/New_York',
        excludeAppointmentId: '11111111-1111-4111-8111-111111111111',
      });
      expect(fallbackRes.available).toBe(true);
    });

    it('uses reschedule_appointment RPC when available and preserves business_id scoping', async () => {
      const rpcMock = vi.fn().mockResolvedValueOnce({
        data: { success: true },
        error: null,
      });

      configureMockClient(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          rpc: rpcMock,
          from: vi.fn(),
        },
        'resched'
      );

      const ok = await rescheduleAppointmentInSupabase(
        '11111111-1111-4111-8111-111111111111',
        '2099-05-06',
        '14:00',
        '15:00',
        'America/New_York',
        'confirmed',
        '42'
      );
      expect(ok.success).toBe(true);
      expect(rpcMock).toHaveBeenCalledWith(
        'reschedule_appointment',
        expect.objectContaining({
          p_business_id: 42,
          p_appointment_id: '11111111-1111-4111-8111-111111111111',
        })
      );

      // Missing businessId must fail safely before any DB call
      const missingBiz = await rescheduleAppointmentInSupabase(
        '11111111-1111-4111-8111-111111111111',
        '2099-05-06',
        '14:00',
        '15:00',
        'America/New_York',
        'confirmed',
        ''
      );
      expect(missingBiz.success).toBe(false);
    });
  });

  describe('7. Migration Compatibility & Non-Overwriting Guarantees', () => {
    it('enforces rules via trigger, advisory lock + exclusion constraint, and in-place check_availability sync without overwriting book/cancel RPCs', () => {
      const migrationPath = path.resolve(
        process.cwd(),
        'supabase/migrations/20261116_booking_rules_enforcement.sql'
      );
      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Must include read-only pg_get_functiondef inspection comment
      expect(sql).toContain('pg_get_functiondef');

      // Must NOT replace existing book_appointment, cancel_appointment, or authorization helper RPCs
      expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.book_appointment/i);
      expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.cancel_appointment/i);
      expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.can_book_appointments/i);
      expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.can_check_availability/i);

      // check_availability MUST be synchronized cleanly in place preserving signature, BOOLEAN return & can_check_availability gate
      expect(sql).toContain('pg_catalog.pg_get_function_arguments(p.oid)');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.check_availability(%s) RETURNS BOOLEAN');
      expect(sql).toContain('_check_scheduling_availability_internal($1, $2, $3, NULL)');
      expect(sql).toContain('public.can_check_availability');

      // Must NOT leave the auth.uid() IS NULL bypass pattern in any RPC, and must use session_user (not SECURITY DEFINER current_user)
      expect(sql).not.toMatch(/IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT/i);
      expect(sql).toContain('session_user');
      expect(sql).not.toMatch(/COALESCE\([^)]*current_user\b/i);

      // Closed-by-default policy: strip comments/tests and verify no invented '09:00'/'18:00' fallbacks or runtime staff_id column assumptions
      const runtimeSql = sql
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--.*$/gm, '');
      expect(runtimeSql).not.toContain("'09:00'");
      expect(runtimeSql).not.toContain("'18:00'");
      expect(runtimeSql).not.toMatch(/\bstaff_id\b/i);

      // Must contain hardened auth helpers, strict parsers, internal hours/availability helpers, exclusion constraint & trigger protections
      expect(sql).toContain('_scheduling_is_trusted_service_role');
      expect(sql).toContain('_scheduling_assert_authorized');
      expect(sql).toContain('_scheduling_parse_bool');
      expect(sql).toContain('_scheduling_parse_time_strict');
      expect(sql).toContain('_scheduling_parse_nonneg_int_strict');
      expect(sql).toContain('_scheduling_safe_timezone');
      expect(sql).toContain('_scheduling_is_blocking_status');
      expect(sql).toContain('_resolve_business_hours_for_date_internal');
      expect(sql).toContain('_check_scheduling_availability_internal');
      expect(sql).toContain("v_bh_row ? 'is_open'");
      expect(sql).toContain('trg_appointments_enforce_booking_rules');
      expect(sql).toContain('pg_advisory_xact_lock(NEW.business_id)');
      expect(sql).toContain('pg_advisory_xact_lock(p_business_id)');
      expect(sql).toContain('excl_appointments_no_active_overlap');
      expect(sql).toContain('support_is_active_business_member');
      expect(sql).toContain('resolve_business_hours_for_date');
      expect(sql).toContain('check_scheduling_availability');
      expect(sql).toContain('get_available_time_slots');
      expect(sql).toContain('reschedule_appointment');
      expect(sql).toContain('Inactive services cannot be booked.');
      expect(sql).toContain('Custom durations are not supported.');
      expect(sql).toContain('Completed appointments cannot be reopened or changed to another status.');
      expect(sql).toContain('Cancellation rejected');

      // Safe strict time extraction (no LEFT(..., 5) truncation)
      expect(sql).not.toContain('GREATEST(\n        15,');
      expect(sql).not.toMatch(/LEFT\s*\(\s*COALESCE\([^)]*open_time/i);
      expect(sql).toContain('regexp_match(');

      // Preflight must validate verified production schema columns before applying
      expect(sql).toContain("('duration_minutes', 'integer')");
      expect(sql).toContain("('start_time', 'timestamp with time zone')");
      expect(sql).toContain("column_name = 'is_active'");
    });
  });
});
