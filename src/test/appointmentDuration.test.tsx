import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { translations } from '../i18n/translations';
import {
  calculateAppointmentDurationMinutes,
  getAppointmentDurationMinutes,
  formatAppointmentDuration,
  formatAppointmentTimeRange,
  getDateStringInTimezone,
} from '../utils/dateTime';
import { mapRowToAppointment } from '../services/supabase';
import { AppointmentDetailDrawer } from '../components/AppointmentDetailDrawer';
import { CalendarView } from '../components/CalendarView';
import { AppointmentsView } from '../components/AppointmentsView';
import { DashboardView } from '../components/DashboardView';
import { RescheduleModal } from '../components/RescheduleModal';
import { Appointment } from '../types';

const mockUseApp = vi.fn();
vi.mock('../context/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

function buildMockAppContext(overrides: Record<string, any> = {}) {
  const language: 'en' | 'es' = overrides.language || 'es';
  const tenant = {
    id: '42',
    name: 'Salon Naomi',
    slug: 'salon-naomi',
    tagline: 'Hair & Beauty',
    category: 'beauty_salon',
    categoryLabelEn: 'Beauty Salon',
    categoryLabelEs: 'Salón de Belleza',
    logo: '',
    timezone: 'America/New_York',
    defaultLanguage: 'es' as const,
    currency: 'USD',
    currencySymbol: '$',
    phone: '+1 555-0100',
    email: 'naomi@salonnaomi.com',
    address: '450 Madison Ave',
    website: 'https://salonnaomi.com',
    isActive: true,
    settings: {
      operatingHours: {
        0: { open: '10:00', close: '16:00', isClosed: true },
        1: { open: '09:00', close: '19:00', isClosed: false },
        2: { open: '09:00', close: '19:00', isClosed: false },
        3: { open: '09:00', close: '19:00', isClosed: false },
        4: { open: '09:00', close: '19:00', isClosed: false },
        5: { open: '09:00', close: '19:00', isClosed: false },
        6: { open: '10:00', close: '17:00', isClosed: false },
      },
      specialHours: [],
      cancellationBufferHours: 24,
      bufferBetweenAppointmentsMinutes: 0,
      aiAutomatedBooking: true,
      requireAtHomeAddress: false,
    },
    ...(overrides.currentTenant || {}),
  };

  return {
    language,
    setLanguage: vi.fn(),
    t: translations[language],
    theme: 'light',
    mode: 'supabase',
    currentTenant: tenant,
    appointments: overrides.appointments || [],
    services: overrides.services || [],
    staff: overrides.staff || [],
    customers: overrides.customers || [],
    conversations: [],
    businessNotifications: [],
    isLoadingLiveData: false,
    liveDataError: null,
    liveDataErrorType: null,
    reloadLiveAppointments: vi.fn(),
    setSelectedAppointmentForDetail: vi.fn(),
    setIsNewBookingModalOpen: vi.fn(),
    updateAppointmentStatus: vi.fn(),
    cancelAppointment: vi.fn().mockResolvedValue({ success: true }),
    rescheduleAppointment: vi.fn().mockResolvedValue({ success: true }),
    setActiveTab: vi.fn(),
    ...overrides,
  };
}

describe('Global Appointment Duration Calculation & Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies the real Salon Naomi appointment 1c7840e1-02aa-4933-9ecc-5b42e9d65e47 (11:00–11:45 in America/New_York = 45 min)', () => {
    const mapped = mapRowToAppointment(
      {
        id: '1c7840e1-02aa-4933-9ecc-5b42e9d65e47',
        business_id: 42,
        customer_id: 'cust-1',
        service_id: 'svc-45',
        start_time: '2026-11-18T16:00:00+00:00',
        end_time: '2026-11-18T16:45:00+00:00',
        status: 'confirmed',
        location_type: 'in_business',
        customers: { full_name: 'Sofía Mendoza', phone: '+15550199' },
        services: { name: 'Corte y Peinado', duration_minutes: 45 },
      },
      'America/New_York'
    );

    expect(mapped.date).toBe('2026-11-18');
    expect(mapped.startTime).toBe('11:00');
    expect(mapped.endTime).toBe('11:45');
    expect(mapped.durationMinutes).toBe(45);

    mockUseApp.mockReturnValue(buildMockAppContext({ appointments: [mapped] }));

    render(<AppointmentDetailDrawer appointment={mapped} onClose={vi.fn()} />);
    expect(screen.getByText('2026-11-18')).toBeInTheDocument();
    expect(screen.getByText('11:00 – 11:45 (45 min)')).toBeInTheDocument();
    expect(screen.queryByText(/60 min/i)).not.toBeInTheDocument();
  });

  it('never uses a 60-minute default or service duration to override start_time and end_time instants', () => {
    // Even if row.duration_minutes or services.duration_minutes says 60 or 90,
    // real duration is calculated strictly from start_time & end_time (30 min).
    const mapped = mapRowToAppointment(
      {
        id: 'apt-override-check',
        business_id: 42,
        start_time: '2026-11-18T15:00:00Z',
        end_time: '2026-11-18T15:30:00Z',
        duration_minutes: 60,
        status: 'confirmed',
        services: { name: 'Express Trim', duration_minutes: 90 },
      },
      'America/New_York'
    );

    expect(mapped.startTime).toBe('10:00');
    expect(mapped.endTime).toBe('10:30');
    expect(mapped.durationMinutes).toBe(30);

    // Even if an Appointment object carries a stale durationMinutes: 60 in memory,
    // shared UI components compute 45 min from startTime/endTime.
    const staleInMemoryAppointment: Appointment = {
      ...mapped,
      startTime: '11:00',
      endTime: '11:45',
      rawStartTime: '2026-11-18T16:00:00Z',
      rawEndTime: '2026-11-18T16:45:00Z',
      durationMinutes: 60,
    };

    expect(getAppointmentDurationMinutes(staleInMemoryAppointment)).toBe(45);

    mockUseApp.mockReturnValue(
      buildMockAppContext({
        appointments: [staleInMemoryAppointment],
      })
    );

    const { unmount } = render(<AppointmentsView />);
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(screen.queryByText('60 min')).not.toBeInTheDocument();
    unmount();

    render(
      <RescheduleModal
        appointment={staleInMemoryAppointment}
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/45 min/)).toBeInTheDocument();
    expect(screen.queryByText(/60 min/)).not.toBeInTheDocument();
  });

  it('handles Postgres space-separated timestamps, midnight crossings, and DST instant differences accurately', () => {
    expect(
      calculateAppointmentDurationMinutes(
        '2026-11-18 16:00:00+00',
        '2026-11-18 16:45:00+00'
      )
    ).toBe(45);

    // Midnight crossing: 23:30 to 00:30 next day = 60 min
    expect(
      calculateAppointmentDurationMinutes(
        '2026-11-18T23:30:00-05:00',
        '2026-11-19T00:30:00-05:00'
      )
    ).toBe(60);

    // US Spring-forward DST (2026-03-08 America/New_York): 01:30 EST (-05:00) to 03:15 EDT (-04:00) is 45 real minutes
    expect(
      calculateAppointmentDurationMinutes(
        '2026-03-08T01:30:00-05:00',
        '2026-03-08T03:15:00-04:00'
      )
    ).toBe(45);
  });

  it('displays "Duración no disponible" (and "Duration unavailable" in EN) when start_time or end_time is missing instead of inventing 60 min', () => {
    const missingEnd = mapRowToAppointment(
      {
        id: 'apt-missing-end',
        business_id: 42,
        start_time: '2026-11-18T16:00:00Z',
        end_time: null,
        status: 'confirmed',
      },
      'America/New_York'
    );

    expect(missingEnd.startTime).toBe('11:00');
    expect(missingEnd.endTime).toBe('');
    expect(missingEnd.durationMinutes).toBeNull();

    const missingStart = mapRowToAppointment(
      {
        id: 'apt-missing-start',
        business_id: 42,
        start_time: null,
        end_time: '2026-11-18T16:45:00Z',
        status: 'confirmed',
      },
      'America/New_York'
    );

    expect(missingStart.startTime).toBe('');
    expect(missingStart.endTime).toBe('11:45');
    expect(missingStart.durationMinutes).toBeNull();

    expect(formatAppointmentTimeRange(missingEnd)).toBe('11:00');
    expect(formatAppointmentDuration(missingEnd, translations.es.appointment)).toBe(
      'Duración no disponible'
    );
    expect(formatAppointmentDuration(missingStart, translations.en.appointment)).toBe(
      'Duration unavailable'
    );

    mockUseApp.mockReturnValue(
      buildMockAppContext({
        language: 'es',
        appointments: [missingEnd],
      })
    );

    const { unmount } = render(
      <AppointmentDetailDrawer appointment={missingEnd} onClose={vi.fn()} />
    );
    expect(screen.getByText('11:00 (Duración no disponible)')).toBeInTheDocument();
    expect(screen.queryByText(/60/)).not.toBeInTheDocument();
    unmount();

    render(<AppointmentsView />);
    expect(screen.getByText('Duración no disponible')).toBeInTheDocument();
    expect(screen.queryByText(/60 min/)).not.toBeInTheDocument();
  });

  it('displays calculated duration across DashboardView and CalendarView Day cards', () => {
    const todayStr = getDateStringInTimezone(new Date(), 'America/New_York');
    const todayApt: Appointment = {
      id: '1c7840e1-02aa-4933-9ecc-5b42e9d65e47',
      tenantId: '42',
      customerId: 'cust-1',
      customerName: 'Sofía Mendoza',
      customerPhone: '+15550199',
      customerLanguage: 'es',
      serviceId: 'svc-45',
      serviceName: 'Corte y Peinado',
      date: todayStr,
      startTime: '11:00',
      endTime: '11:45',
      durationMinutes: 60, // intentionally stale to prove views calculate from startTime/endTime
      price: 75,
      locationType: 'in_business',
      status: 'confirmed',
      source: 'manual_dashboard',
      createdAt: '2026-11-18T10:00:00Z',
    };

    const missingEndTodayApt: Appointment = {
      ...todayApt,
      id: 'apt-today-missing-end',
      customerName: 'Sin Fin',
      startTime: '13:00',
      endTime: '',
      durationMinutes: 60,
    };

    mockUseApp.mockReturnValue(
      buildMockAppContext({
        language: 'es',
        appointments: [todayApt, missingEndTodayApt],
      })
    );

    const { unmount } = render(<DashboardView />);
    expect(screen.getByText('45m')).toBeInTheDocument();
    expect(screen.getByText('Duración no disponible')).toBeInTheDocument();
    expect(screen.queryByText('60m')).not.toBeInTheDocument();
    unmount();

    render(<CalendarView />);
    fireEvent.click(screen.getByRole('button', { name: translations.es.calendar.day }));
    expect(screen.getByText(/Corte y Peinado \(45 min\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Corte y Peinado \(Duración no disponible\)/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/60 min/)).not.toBeInTheDocument();
  });
});
