import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { AppProvider, useApp } from '../context/AppContext';
import {
  buildBookingNotificationRealtimeSpec,
  mapRowToAppointment,
  mapRowToBookingNotification,
  BookingNotificationRealtimeCallbacks,
} from '../services/supabase';
import { Appointment, BusinessNotification, Tenant } from '../types';

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

const USER_OWNER_ID = '11111111-1111-4111-8111-111111111111';
const USER_STAFF_ID = '22222222-2222-4222-8222-222222222222';
const SUPER_ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const NOTIF_1_ID = 'aaaa1111-1111-4111-8111-111111111111';
const NOTIF_2_ID = 'bbbb2222-2222-4222-8222-222222222222';
const APT_1_ID = 'cccc1111-1111-4111-8111-111111111111';
const APT_2_ID = 'dddd2222-2222-4222-8222-222222222222';

const SALON_TENANT: Tenant = {
  id: '42',
  name: 'Salon Naomi',
  slug: 'salon-naomi',
  logo: '',
  tagline: 'Hair & Beauty Studio',
  description: 'Studio appointments',
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

const SECOND_TENANT: Tenant = {
  ...SALON_TENANT,
  id: '99',
  name: 'Dental Apex',
  slug: 'dental-apex',
  category: 'clinic',
};

const SAMPLE_APPOINTMENT: Appointment = {
  id: APT_1_ID,
  tenantId: '42',
  customerId: 'cust-elena',
  customerName: 'Elena Vance',
  customerPhone: '+1 305-555-0199',
  customerLanguage: 'en',
  serviceId: 'svc-blowout',
  serviceName: 'Signature Blowout',
  date: '2026-11-18',
  startTime: '14:30',
  endTime: '15:15',
  durationMinutes: 45,
  price: 65,
  locationType: 'in_business',
  status: 'confirmed',
  source: 'ai_whatsapp',
  notes: 'Confirmed via AI receptionist',
  createdAt: '2026-11-14T10:00:00Z',
};

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
  supabaseMocks.fetchLiveServicesWithStatus.mockResolvedValue({ items: [], error: null });
  supabaseMocks.fetchActiveServicesCountInSupabase.mockResolvedValue(0);
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
    totalBusinesses: 2,
    activeBusinesses: 2,
    totalCustomers: 10,
    totalAppointments: 20,
    systemHealth: 'healthy',
    healthDetail: 'Operational',
    lastCheckedAt: '2026-11-14T10:00:00Z',
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
  supabaseMocks.fetchBusinessMembersForTenant.mockResolvedValue([]);
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
});

describe('Booking Notifications Release A — Unit & Subscription Guards', () => {
  it('excludes Super Admin from buildBookingNotificationRealtimeSpec and requires valid BIGINT businessId + UUID userId', () => {
    expect(
      buildBookingNotificationRealtimeSpec({
        businessId: '42',
        userId: SUPER_ADMIN_ID,
        isSuperAdmin: true,
      })
    ).toBeNull();

    expect(
      buildBookingNotificationRealtimeSpec({
        businessId: '42',
        userId: 'not-a-uuid',
        isSuperAdmin: false,
      })
    ).toBeNull();

    expect(
      buildBookingNotificationRealtimeSpec({
        businessId: '',
        userId: USER_OWNER_ID,
        isSuperAdmin: false,
      })
    ).toBeNull();

    const spec = buildBookingNotificationRealtimeSpec({
      businessId: '42',
      userId: USER_OWNER_ID,
      isSuperAdmin: false,
    });

    expect(spec).not.toBeNull();
    expect(spec?.businessId).toBe(42);
    expect(spec?.userId).toBe(USER_OWNER_ID);
    expect(spec?.subscriptions).toEqual([
      {
        table: 'booking_notifications',
        event: 'INSERT',
        filter: 'business_id=eq.42',
      },
      {
        table: 'booking_notification_reads',
        event: 'INSERT',
        filter: `user_id=eq.${USER_OWNER_ID}`,
      },
    ]);
  });

  it('isolates read state per authenticated user in mapRowToBookingNotification and maps lifecycle events cleanly', () => {
    const confirmedRow = {
      id: NOTIF_1_ID,
      business_id: 42,
      appointment_id: APT_1_ID,
      event_type: 'appointment_confirmed',
      idempotency_key: `apt:${APT_1_ID}:appointment_confirmed:pending->confirmed`,
      customer_name: 'Elena Vance',
      service_name: 'Signature Blowout',
      appointment_date: '2026-11-18',
      appointment_start_time: '14:30',
      appointment_end_time: '15:15',
      appointment_status: 'confirmed',
      created_at: '2026-11-14T10:05:00Z',
      booking_notification_reads: [
        {
          user_id: USER_OWNER_ID,
          read_at: '2026-11-14T10:06:00Z',
        },
      ],
    };

    const ownerView = mapRowToBookingNotification(confirmedRow, USER_OWNER_ID);
    const staffView = mapRowToBookingNotification(confirmedRow, USER_STAFF_ID);

    expect(ownerView.read).toBe(true);
    expect(ownerView.readByUserId).toBe(USER_OWNER_ID);
    expect(ownerView.readAt).toBe('2026-11-14T10:06:00Z');

    // User B stays unread even after User A read the notification
    expect(staffView.read).toBe(false);
    expect(staffView.readByUserId).toBeUndefined();
    expect(staffView.customerName).toBe('Elena Vance');
    expect(staffView.serviceName).toBe('Signature Blowout');
    expect(staffView.appointmentDate).toBe('2026-11-18');
    expect(staffView.appointmentStartTime).toBe('14:30');
    expect(staffView.appointmentId).toBe(APT_1_ID);

    const cancelledView = mapRowToBookingNotification(
      {
        ...confirmedRow,
        id: NOTIF_2_ID,
        event_type: 'appointment_cancelled',
        appointment_status: 'cancelled',
        booking_notification_reads: [],
      },
      USER_STAFF_ID
    );
    expect(cancelledView.type).toBe('appointment_cancelled');
    expect(cancelledView.eventType).toBe('appointment_cancelled');
    expect(cancelledView.read).toBe(false);

    const rescheduledView = mapRowToBookingNotification(
      {
        ...confirmedRow,
        id: 'eeee3333-3333-4333-8333-333333333333',
        event_type: 'appointment_rescheduled',
        idempotency_key: `apt:${APT_1_ID}:appointment_rescheduled:seq:42`,
        appointment_date: '2026-11-18',
        appointment_start_time: '16:00',
        appointment_end_time: '16:45',
        appointment_status: 'confirmed',
        booking_notification_reads: [],
      },
      USER_STAFF_ID
    );
    expect(rescheduledView.type).toBe('appointment_updated');
    expect(rescheduledView.eventType).toBe('appointment_rescheduled');
    expect(rescheduledView.idempotencyKey).toBe(`apt:${APT_1_ID}:appointment_rescheduled:seq:42`);
  });

  it('hydrates verified production appointment columns cleanly (TIMESTAMPTZ, customers.full_name, services.name, duration_minutes)', () => {
    const mapped = mapRowToAppointment(
      {
        id: APT_1_ID,
        business_id: 42,
        customer_id: '77777777-7777-4777-8777-777777777777',
        service_id: '88888888-8888-4888-8888-888888888888',
        start_time: '2026-11-18T19:30:00Z',
        end_time: '2026-11-18T20:15:00Z',
        updated_at: '2026-11-18T15:00:00Z',
        status: 'confirmed',
        customers: { full_name: 'Elena Vance' },
        services: { name: 'Signature Blowout', duration_minutes: 45 },
      },
      'America/New_York'
    );

    expect(mapped.id).toBe(APT_1_ID);
    expect(mapped.tenantId).toBe('42');
    expect(mapped.customerName).toBe('Elena Vance');
    expect(mapped.serviceName).toBe('Signature Blowout');
    expect(mapped.date).toBe('2026-11-18');
    expect(mapped.startTime).toBe('14:30');
    expect(mapped.endTime).toBe('15:15');
    expect(mapped.status).toBe('confirmed');
  });
});

describe('Booking Notifications Release A — Real AppProvider & TopHeader Integration', () => {
  it('renders booking notifications with customer/service/date/time, deduplicates Realtime repeats, ignores pending inserts, syncs cross-tab reads, and deep-links to AppointmentDetailDrawer', async () => {
    let notifCallbacks: BookingNotificationRealtimeCallbacks | null = null;
    let aptRealtimeCallback: ((change: any) => void) | null = null;

    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'owner-token' },
      user: { id: USER_OWNER_ID, email: 'naomi@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [
        {
          id: 'mem-owner-42',
          businessId: '42',
          userId: USER_OWNER_ID,
          userEmail: 'naomi@salonnaomi.com',
          role: 'owner',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
      accessibleBusinesses: [SALON_TENANT],
    });
    supabaseMocks.fetchAppointmentByIdInSupabase.mockResolvedValue({
      appointment: SAMPLE_APPOINTMENT,
    });
    supabaseMocks.fetchBookingNotificationsInSupabase.mockResolvedValue({
      tableExists: true,
      notifications: [
        {
          id: NOTIF_2_ID,
          businessId: '42',
          type: 'appointment_updated',
          eventType: 'appointment_rescheduled',
          idempotencyKey: `apt:${APT_2_ID}:rescheduled:v1`,
          title: 'Booking Rescheduled',
          description: 'Marcus Silva · Beard Trim (2026-11-19 @ 11:00)',
          appointmentId: APT_2_ID,
          customerName: 'Marcus Silva',
          serviceName: 'Beard Trim',
          appointmentDate: '2026-11-19',
          appointmentStartTime: '11:00',
          appointmentEndTime: '11:30',
          appointmentStatus: 'confirmed',
          createdAt: '2026-11-14T09:00:00Z',
          read: false,
        },
      ],
    });

    supabaseMocks.subscribeToAppointmentsRealtime.mockImplementation((_bizId, cb) => {
      aptRealtimeCallback = cb;
      return { topic: 'appointments' };
    });

    supabaseMocks.subscribeToBookingNotificationsRealtime.mockImplementation((_opts, cbs) => {
      notifCallbacks = cbs;
      return { topic: 'booking-notifications' };
    });

    render(<App />);

    // Wait for initial persisted notification load (unread count = 1)
    const bellBtn = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => {
      expect(bellBtn).toHaveTextContent('1');
    });

    // Pending appointment insert via Realtime must NOT create a client-side confirmed notification
    await act(async () => {
      aptRealtimeCallback?.({
        eventType: 'INSERT',
        newRow: {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          business_id: 42,
          status: 'pending',
        },
      });
    });
    expect(bellBtn).toHaveTextContent('1');

    // Deliver confirmed notification via booking_notifications Realtime twice (exact duplicate + same idempotencyKey)
    const liveConfirmedNotif: BusinessNotification = {
      id: NOTIF_1_ID,
      businessId: '42',
      type: 'appointment_confirmed',
      eventType: 'appointment_confirmed',
      idempotencyKey: `apt:${APT_1_ID}:confirmed:v1`,
      title: 'Booking Confirmed',
      description: 'Elena Vance · Signature Blowout (2026-11-18 @ 14:30)',
      appointmentId: APT_1_ID,
      customerName: 'Elena Vance',
      serviceName: 'Signature Blowout',
      appointmentDate: '2026-11-18',
      appointmentStartTime: '14:30',
      appointmentEndTime: '15:15',
      appointmentStatus: 'confirmed',
      createdAt: '2026-11-14T10:05:00Z',
      read: false,
    };

    await act(async () => {
      notifCallbacks?.onNotificationInsert?.(liveConfirmedNotif);
      notifCallbacks?.onNotificationInsert?.({
        ...liveConfirmedNotif,
        id: 'ffff9999-9999-4999-8999-999999999999', // duplicate idempotency key
      });
    });

    // Counter increments by 1 (from 1 -> 2), NOT 3
    await waitFor(() => {
      expect(bellBtn).toHaveTextContent('2');
    });

    // Cross-tab read receipt for User A marks NOTIF_2_ID read without clearing NOTIF_1_ID
    await act(async () => {
      notifCallbacks?.onReadInsert?.({
        notificationId: NOTIF_2_ID,
        userId: USER_OWNER_ID,
        businessId: '42',
        readAt: '2026-11-14T10:06:00Z',
      });
    });
    await waitFor(() => {
      expect(bellBtn).toHaveTextContent('1');
    });

    // Open Notifications dropdown & verify details (dropdown item + single toast = 2 matches total)
    fireEvent.click(bellBtn);
    const confirmedMatches = await screen.findAllByText('Booking Confirmed');
    expect(confirmedMatches).toHaveLength(2);
    expect(screen.getByText('Elena Vance · Signature Blowout')).toBeInTheDocument();
    expect(screen.getByText('2026-11-18 @ 14:30')).toBeInTheDocument();
    // Marcus Silva was marked read via cross-tab sync
    expect(screen.queryByText('Marcus Silva · Beard Trim')).not.toBeInTheDocument();

    // Clicking the notification marks ONLY this single notification read and deep-links to AppointmentDetailDrawer
    fireEvent.click(screen.getByText('Elena Vance · Signature Blowout'));

    await waitFor(() => {
      expect(supabaseMocks.markBookingNotificationReadInSupabase).toHaveBeenCalledWith({
        notificationId: NOTIF_1_ID,
        businessId: '42',
        userId: USER_OWNER_ID,
      });
    });
    expect(supabaseMocks.markAllBookingNotificationsReadInSupabase).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(supabaseMocks.fetchAppointmentByIdInSupabase).toHaveBeenCalledWith(
        '42',
        APT_1_ID,
        'America/New_York'
      );
    });

    // AppointmentDetailDrawer is open with Elena Vance's appointment details
    expect(await screen.findByText('Confirmed via AI receptionist')).toBeInTheDocument();

    // Reconnect reconciliation: CHANNEL_ERROR -> SUBSCRIBED triggers reloadBookingNotifications()
    const callsBeforeReconnect = supabaseMocks.fetchBookingNotificationsInSupabase.mock.calls.length;
    await act(async () => {
      notifCallbacks?.onStatusChange?.('CHANNEL_ERROR');
      notifCallbacks?.onStatusChange?.('SUBSCRIBED');
    });
    await waitFor(() => {
      expect(supabaseMocks.fetchBookingNotificationsInSupabase.mock.calls.length).toBeGreaterThan(
        callsBeforeReconnect
      );
    });
  });

  it('allows marking a single notification read via its inline button without opening the appointment drawer', async () => {
    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'owner-token' },
      user: { id: USER_OWNER_ID, email: 'naomi@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [
        {
          id: 'mem-owner-42',
          businessId: '42',
          userId: USER_OWNER_ID,
          userEmail: 'naomi@salonnaomi.com',
          role: 'owner',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
      accessibleBusinesses: [SALON_TENANT],
    });
    supabaseMocks.fetchBookingNotificationsInSupabase.mockResolvedValue({
      tableExists: true,
      notifications: [
        {
          id: NOTIF_1_ID,
          businessId: '42',
          type: 'appointment_confirmed',
          eventType: 'appointment_confirmed',
          idempotencyKey: `apt:${APT_1_ID}:confirmed:v1`,
          title: 'Booking Confirmed',
          description: 'Elena Vance · Signature Blowout (2026-11-18 @ 14:30)',
          appointmentId: APT_1_ID,
          customerName: 'Elena Vance',
          serviceName: 'Signature Blowout',
          appointmentDate: '2026-11-18',
          appointmentStartTime: '14:30',
          appointmentStatus: 'confirmed',
          createdAt: '2026-11-14T10:05:00Z',
          read: false,
        },
      ],
    });

    render(<App />);

    const bellBtn = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => {
      expect(bellBtn).toHaveTextContent('1');
    });

    fireEvent.click(bellBtn);
    const markReadBtn = await screen.findByRole('button', {
      name: /Mark read: Elena Vance · Signature Blowout/i,
    });
    fireEvent.click(markReadBtn);

    await waitFor(() => {
      expect(supabaseMocks.markBookingNotificationReadInSupabase).toHaveBeenCalledWith({
        notificationId: NOTIF_1_ID,
        businessId: '42',
        userId: USER_OWNER_ID,
      });
    });
    expect(supabaseMocks.fetchAppointmentByIdInSupabase).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(bellBtn).not.toHaveTextContent('1');
    });
  });

  it('clears previous tenant booking notifications cleanly when switching businesses', async () => {
    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'owner-token' },
      user: { id: USER_OWNER_ID, email: 'naomi@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [
        {
          id: 'mem-owner-42',
          businessId: '42',
          userId: USER_OWNER_ID,
          userEmail: 'naomi@salonnaomi.com',
          role: 'owner',
          createdAt: '2026-11-01T00:00:00Z',
        },
        {
          id: 'mem-owner-99',
          businessId: '99',
          userId: USER_OWNER_ID,
          userEmail: 'naomi@salonnaomi.com',
          role: 'owner',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
      accessibleBusinesses: [SALON_TENANT, SECOND_TENANT],
    });

    supabaseMocks.fetchBookingNotificationsInSupabase.mockImplementation(async ({ businessId }) => {
      if (businessId === '42') {
        return {
          tableExists: true,
          notifications: [
            {
              id: NOTIF_1_ID,
              businessId: '42',
              type: 'appointment_confirmed',
              eventType: 'appointment_confirmed',
              title: 'Booking Confirmed',
              description: 'Elena Vance · Signature Blowout (2026-11-18 @ 14:30)',
              appointmentId: APT_1_ID,
              customerName: 'Elena Vance',
              serviceName: 'Signature Blowout',
              appointmentDate: '2026-11-18',
              appointmentStartTime: '14:30',
              createdAt: '2026-11-14T10:05:00Z',
              read: false,
            },
          ],
        };
      }
      return { tableExists: true, notifications: [] };
    });

    const ctxHolder: { current: ReturnType<typeof useApp> | null } = { current: null };
    const Probe: React.FC = () => {
      const ctx = useApp();
      useEffect(() => {
        ctxHolder.current = ctx;
      }, [ctx]);
      return <div data-testid="notif-count">{ctx.businessNotifications.length}</div>;
    };

    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('notif-count')).toHaveTextContent('1');
    });

    await act(async () => {
      ctxHolder.current?.setCurrentTenantId('99');
    });

    await waitFor(() => {
      expect(screen.getByTestId('notif-count')).toHaveTextContent('0');
    });
    expect(ctxHolder.current?.businessNotifications).toEqual([]);
  });

  it('strictly excludes verified Super Admin from booking notifications fetch, Realtime subscription, and UI even when inspecting businesses', async () => {
    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'super-admin-token' },
      user: { id: SUPER_ADMIN_ID, email: 'novacodetechllc@gmail.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: true,
      memberships: [],
      accessibleBusinesses: [SALON_TENANT],
    });
    supabaseMocks.verifyCurrentUserIsSuperAdmin.mockResolvedValue({ isSuperAdmin: true });

    render(<App />);

    const adminLabels = await screen.findAllByText('Platform Admin');
    expect(adminLabels.length).toBeGreaterThanOrEqual(1);

    // Super Admin must never query or subscribe to routine booking notifications
    expect(supabaseMocks.fetchBookingNotificationsInSupabase).not.toHaveBeenCalled();
    expect(supabaseMocks.subscribeToBookingNotificationsRealtime).not.toHaveBeenCalled();

    const bellBtn = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(bellBtn);
    expect(await screen.findByText('Platform Alerts')).toBeInTheDocument();
    expect(screen.getByText('No active system alerts or failed integrations.')).toBeInTheDocument();
    expect(screen.queryByText(/Booking Confirmed/i)).not.toBeInTheDocument();
  });

  it('tracks full lifecycle events and successive reschedules with unique sequence keys while deduplicating exact replays', async () => {
    let notifCallbacks: BookingNotificationRealtimeCallbacks | null = null;
    let aptRealtimeCallback: ((change: any) => void) | null = null;

    supabaseMocks.getCurrentSupabaseSession.mockResolvedValue({
      session: { access_token: 'owner-token' },
      user: { id: USER_OWNER_ID, email: 'naomi@salonnaomi.com' },
    });
    supabaseMocks.fetchUserAccessProfile.mockResolvedValue({
      isSuperAdmin: false,
      memberships: [
        {
          id: 'mem-owner-42',
          businessId: '42',
          userId: USER_OWNER_ID,
          userEmail: 'naomi@salonnaomi.com',
          role: 'owner',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
      accessibleBusinesses: [SALON_TENANT],
    });

    supabaseMocks.subscribeToAppointmentsRealtime.mockImplementation((_bizId, cb) => {
      aptRealtimeCallback = cb;
      return { topic: 'appointments' };
    });
    supabaseMocks.subscribeToBookingNotificationsRealtime.mockImplementation((_opts, cbs) => {
      notifCallbacks = cbs;
      return { topic: 'booking-notifications' };
    });

    render(<App />);
    const bellBtn = await screen.findByRole('button', { name: 'Notifications' });

    // Non-notifying raw appointment changes (pending, completed, no_show) create zero booking notifications
    await act(async () => {
      aptRealtimeCallback?.({ eventType: 'INSERT', newRow: { id: APT_1_ID, business_id: 42, status: 'pending' } });
      aptRealtimeCallback?.({ eventType: 'UPDATE', newRow: { id: APT_1_ID, business_id: 42, status: 'completed' } });
      aptRealtimeCallback?.({ eventType: 'UPDATE', newRow: { id: APT_1_ID, business_id: 42, status: 'no_show' } });
    });
    expect(bellBtn).not.toHaveTextContent(/\d+/);

    // 1) pending -> confirmed (seq:1)
    // 2) confirmed reschedule 14:00 -> 15:00 (seq:2)
    // 3) confirmed reschedule back 15:00 -> 14:00 (seq:3)
    // 4) confirmed reschedule again 14:00 -> 15:00 (seq:4 - must NOT collide with seq:2)
    // 5) duplicate Realtime replay of seq:4 -> MUST be deduplicated
    // 6) confirmed -> cancelled (seq:5)
    await act(async () => {
      notifCallbacks?.onNotificationInsert?.({
        id: '1111aaaa-1111-4111-8111-111111111111',
        businessId: '42',
        type: 'appointment_confirmed',
        eventType: 'appointment_confirmed',
        idempotencyKey: `apt:${APT_1_ID}:appointment_confirmed:seq:1`,
        title: 'Booking Confirmed',
        description: 'Elena Vance · Signature Blowout (2026-11-18 @ 14:00)',
        appointmentId: APT_1_ID,
        customerName: 'Elena Vance',
        serviceName: 'Signature Blowout',
        appointmentDate: '2026-11-18',
        appointmentStartTime: '14:00',
        appointmentStatus: 'confirmed',
        createdAt: '2026-11-14T10:01:00Z',
        read: false,
      });

      notifCallbacks?.onNotificationInsert?.({
        id: '2222aaaa-2222-4222-8222-222222222222',
        businessId: '42',
        type: 'appointment_updated',
        eventType: 'appointment_rescheduled',
        idempotencyKey: `apt:${APT_1_ID}:appointment_rescheduled:seq:2`,
        title: 'Booking Rescheduled',
        description: 'Elena Vance · Signature Blowout (2026-11-18 @ 15:00)',
        appointmentId: APT_1_ID,
        customerName: 'Elena Vance',
        serviceName: 'Signature Blowout',
        appointmentDate: '2026-11-18',
        appointmentStartTime: '15:00',
        appointmentStatus: 'confirmed',
        createdAt: '2026-11-14T10:02:00Z',
        read: false,
      });

      notifCallbacks?.onNotificationInsert?.({
        id: '3333aaaa-3333-4333-8333-333333333333',
        businessId: '42',
        type: 'appointment_updated',
        eventType: 'appointment_rescheduled',
        idempotencyKey: `apt:${APT_1_ID}:appointment_rescheduled:seq:3`,
        title: 'Booking Rescheduled',
        description: 'Elena Vance · Signature Blowout (2026-11-18 @ 14:00)',
        appointmentId: APT_1_ID,
        customerName: 'Elena Vance',
        serviceName: 'Signature Blowout',
        appointmentDate: '2026-11-18',
        appointmentStartTime: '14:00',
        appointmentStatus: 'confirmed',
        createdAt: '2026-11-14T10:03:00Z',
        read: false,
      });

      const fourthEvent: BusinessNotification = {
        id: '4444aaaa-4444-4444-8444-444444444444',
        businessId: '42',
        type: 'appointment_updated',
        eventType: 'appointment_rescheduled',
        idempotencyKey: `apt:${APT_1_ID}:appointment_rescheduled:seq:4`,
        title: 'Booking Rescheduled',
        description: 'Elena Vance · Signature Blowout (2026-11-18 @ 15:00)',
        appointmentId: APT_1_ID,
        customerName: 'Elena Vance',
        serviceName: 'Signature Blowout',
        appointmentDate: '2026-11-18',
        appointmentStartTime: '15:00',
        appointmentStatus: 'confirmed',
        createdAt: '2026-11-14T10:04:00Z',
        read: false,
      };
      notifCallbacks?.onNotificationInsert?.(fourthEvent);
      // Duplicate Realtime replay of same event ID and same idempotencyKey
      notifCallbacks?.onNotificationInsert?.(fourthEvent);
      notifCallbacks?.onNotificationInsert?.({
        ...fourthEvent,
        id: '9999aaaa-9999-4999-8999-999999999999',
      });

      notifCallbacks?.onNotificationInsert?.({
        id: '5555aaaa-5555-4555-8555-555555555555',
        businessId: '42',
        type: 'appointment_cancelled',
        eventType: 'appointment_cancelled',
        idempotencyKey: `apt:${APT_1_ID}:appointment_cancelled:seq:5`,
        title: 'Booking Cancelled',
        description: 'Elena Vance · Signature Blowout (2026-11-18 @ 15:00)',
        appointmentId: APT_1_ID,
        customerName: 'Elena Vance',
        serviceName: 'Signature Blowout',
        appointmentDate: '2026-11-18',
        appointmentStartTime: '15:00',
        appointmentStatus: 'cancelled',
        createdAt: '2026-11-14T10:05:00Z',
        read: false,
      });
    });

    // Exactly 5 unique lifecycle notifications (1 confirmed + 3 distinct reschedules + 1 cancelled)
    await waitFor(() => {
      expect(bellBtn).toHaveTextContent('5');
    });

    fireEvent.click(bellBtn);
    expect(await screen.findAllByText('Booking Cancelled')).not.toHaveLength(0);
    expect(await screen.findAllByText('Booking Confirmed')).not.toHaveLength(0);
    expect(await screen.findAllByText('Booking Rescheduled')).not.toHaveLength(0);
  });
});
