import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { Appointment, Customer, Service, Tenant } from '../types';

const mockUseApp = vi.fn();

vi.mock('../context/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

import { SettingsServicesSection } from '../components/settings/SettingsServicesSection';
import { WeeklyHoursSection } from '../components/settings/WeeklyHoursSection';
import { ServicesView } from '../components/ServicesView';
import { AppointmentsView } from '../components/AppointmentsView';
import { NewAppointmentModal } from '../components/NewAppointmentModal';
import { AppointmentDetailDrawer } from '../components/AppointmentDetailDrawer';
import { CustomersView } from '../components/CustomersView';
import { getDateStringInTimezone } from '../utils/dateTime';

function buildBaseContext(overrides: Record<string, any> = {}) {
  const language: 'en' | 'es' = overrides.language || 'en';
  const tenant: Tenant = {
    id: '42',
    name: 'Salon Naomi',
    slug: 'salon-naomi',
    tagline: 'Hair & Beauty',
    category: 'salon',
    categoryLabelEn: 'Hair Salon',
    categoryLabelEs: 'Salón de Belleza',
    logo: '',
    timezone: 'America/New_York',
    defaultLanguage: 'en',
    currency: 'USD',
    currencySymbol: '$',
    phone: '+1 305-555-0190',
    email: 'hello@salonnaomi.com',
    address: '210 Ocean Dr, Miami Beach, FL',
    website: 'https://salonnaomi.com',
    isActive: true,
    settings: {
      operatingHours: {
        0: { open: '', close: '', isClosed: true },
        1: { open: '09:00', close: '18:00', isClosed: false },
        2: { open: '09:00', close: '18:00', isClosed: false },
        3: { open: '09:00', close: '18:00', isClosed: false },
        4: { open: '09:00', close: '18:00', isClosed: false },
        5: { open: '09:00', close: '18:00', isClosed: false },
        6: { open: '10:00', close: '15:00', isClosed: false },
      },
      operatingHoursMigrated: false,
      specialHours: [],
      cancellationBufferHours: 24,
      bufferBetweenAppointmentsMinutes: 15,
      locationTypes: ['in_business', 'at_home'],
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
    mode: 'supabase',
    currentUser: {
      id: 'owner-1',
      email: 'owner@salonnaomi.com',
      role: 'owner',
      isSuperAdmin: false,
      platformRole: 'owner',
      businessMemberships: [],
    },
    canViewPlatformAdmin: false,
    canManageBusinessSettings: true,
    canManageServices: true,
    canManageStaff: true,
    currentTenant: tenant,
    availableTenants: [tenant],
    setCurrentTenantId: vi.fn(),
    activeTab: 'overview',
    setActiveTab: vi.fn(),
    appointments: [] as Appointment[],
    customers: [] as Customer[],
    services: [] as Service[],
    activeServicesCount: (overrides.services || []).filter((s: Service) => s.active).length,
    staff: [],
    isLoadingLiveData: false,
    liveDataError: null,
    liveDataErrorType: null,
    reloadLiveAppointments: vi.fn(),
    addService: vi.fn().mockResolvedValue({ success: true }),
    updateService: vi.fn().mockResolvedValue({ success: true }),
    saveWeeklyBusinessHours: vi.fn().mockResolvedValue({ success: true }),
    addAppointment: vi.fn().mockResolvedValue({ success: true }),
    updateAppointmentStatus: vi.fn().mockResolvedValue({ success: true }),
    cancelAppointment: vi.fn().mockResolvedValue({ success: true }),
    rescheduleAppointment: vi.fn().mockResolvedValue({ success: true }),
    addCustomer: vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '42',
      name: 'Ana Perez',
      phone: '+1 555-0199',
      email: 'ana@example.com',
      preferredLanguage: 'es',
      totalAppointments: 0,
      lastInteractionAt: '',
      createdAt: '',
    }),
    updateCustomerNotes: vi.fn().mockResolvedValue({ success: true }),
    isBookingConflict: vi.fn().mockReturnValue(false),
    isNewBookingModalOpen: false,
    setIsNewBookingModalOpen: vi.fn(),
    selectedAppointmentForDetail: null,
    setSelectedAppointmentForDetail: vi.fn(),
    addToast: vi.fn(),
    ...overrides,
  };
}

describe('Post-Audit Regression Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Services Translation Preservation & Duplicate-Submit Locks', () => {
    it('SettingsServicesSection preserves English name & description when editing in Spanish', async () => {
      const updateService = vi.fn().mockResolvedValue({ success: true });
      const bilingualService: Service = {
        id: 'svc-1',
        tenantId: '42',
        nameEn: 'Signature Blowout',
        nameEs: 'Peinado Signature',
        descriptionEn: 'Wash and signature blowout styling.',
        descriptionEs: 'Lavado y peinado profesional.',
        durationMinutes: 60,
        price: 85,
        currency: 'USD',
        category: 'Hair',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: true,
      };

      mockUseApp.mockReturnValue(
        buildBaseContext({
          language: 'es',
          services: [bilingualService],
          updateService,
        })
      );

      render(<SettingsServicesSection />);
      fireEvent.click(screen.getByRole('button', { name: /Editar Peinado Signature/i }));

      const nameInput = screen.getByDisplayValue('Peinado Signature');
      fireEvent.change(nameInput, { target: { value: 'Peinado de Gala' } });

      fireEvent.click(screen.getByRole('button', { name: /Guardar Servicio/i }));

      await waitFor(() => {
        expect(updateService).toHaveBeenCalledTimes(1);
      });

      const savedArg = updateService.mock.calls[0][0] as Service;
      expect(savedArg.nameEs).toBe('Peinado de Gala');
      expect(savedArg.nameEn).toBe('Signature Blowout');
      expect(savedArg.descriptionEs).toBe('Lavado y peinado profesional.');
      expect(savedArg.descriptionEn).toBe('Wash and signature blowout styling.');
    });

    it('SettingsServicesSection blocks duplicate submit while save is in flight', async () => {
      let resolveSave!: (v: { success: boolean }) => void;
      const addService = vi.fn(
        () =>
          new Promise<{ success: boolean }>(resolve => {
            resolveSave = resolve;
          })
      );

      mockUseApp.mockReturnValue(
        buildBaseContext({
          language: 'en',
          services: [],
          addService,
        })
      );

      render(<SettingsServicesSection />);
      fireEvent.click(screen.getAllByRole('button', { name: /Add Service/i })[0]);

      fireEvent.change(screen.getByPlaceholderText(/Signature Haircut/i), {
        target: { value: 'Express Trim' },
      });

      const saveBtn = screen.getByRole('button', { name: /Save Service/i });
      fireEvent.click(saveBtn);
      fireEvent.click(saveBtn);

      expect(addService).toHaveBeenCalledTimes(1);
      resolveSave({ success: true });
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Save Service/i })).not.toBeInTheDocument();
      });
    });

    it('ServicesView allows Spanish-only service creation and preserves sibling translations on edit', async () => {
      const addService = vi.fn().mockResolvedValue({ success: true });
      const updateService = vi.fn().mockResolvedValue({ success: true });
      const existing: Service = {
        id: 'svc-2',
        tenantId: '42',
        nameEn: 'Keratin Treatment',
        nameEs: 'Tratamiento de Keratina',
        descriptionEn: 'Smoothing treatment',
        descriptionEs: 'Alisado nutritivo',
        durationMinutes: 90,
        price: 150,
        currency: 'USD',
        category: 'Hair',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: true,
      };

      mockUseApp.mockReturnValue(
        buildBaseContext({
          language: 'es',
          services: [existing],
          addService,
          updateService,
        })
      );

      render(<ServicesView />);

      // Edit existing service in Spanish only without overwriting English fields
      fireEvent.click(screen.getByRole('button', { name: /Editar/i }));
      const esInput = screen.getByDisplayValue('Tratamiento de Keratina');
      fireEvent.change(esInput, { target: { value: 'Keratina Orgánica' } });
      fireEvent.click(screen.getByRole('button', { name: /Guardar Servicio/i }));

      await waitFor(() => {
        expect(updateService).toHaveBeenCalledTimes(1);
      });
      const updated = updateService.mock.calls[0][0] as Service;
      expect(updated.nameEn).toBe('Keratin Treatment');
      expect(updated.nameEs).toBe('Keratina Orgánica');
      expect(updated.descriptionEn).toBe('Smoothing treatment');

      // Create Spanish-only service with English left blank
      fireEvent.click(screen.getByRole('button', { name: translations.es.services.addService }));
      fireEvent.change(screen.getByLabelText(translations.es.services.nameEs), {
        target: { value: 'Manicura Express' },
      });
      fireEvent.click(screen.getByRole('button', { name: translations.es.services.saveService }));

      await waitFor(() => {
        expect(addService).toHaveBeenCalledTimes(1);
      });
      const created = addService.mock.calls[0][0] as Omit<Service, 'id' | 'tenantId'>;
      expect(created.nameEs).toBe('Manicura Express');
      expect(created.nameEn).toBe('Manicura Express');
    });
  });

  describe('WeeklyHoursSection Validation & Concurrency Guards', () => {
    it('rejects copying Monday to weekdays if Monday open >= close', () => {
      const addToast = vi.fn();
      mockUseApp.mockReturnValue(
        buildBaseContext({
          language: 'en',
          addToast,
          currentTenant: {
            settings: {
              operatingHours: {
                1: { open: '18:00', close: '09:00', isClosed: false },
              },
              operatingHoursMigrated: false,
              specialHours: [],
              cancellationBufferHours: 24,
              bufferBetweenAppointmentsMinutes: 15,
            },
          },
        })
      );

      render(<WeeklyHoursSection />);
      fireEvent.click(screen.getByRole('button', { name: /Edit Hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /Copy Mon to Weekdays/i }));

      expect(screen.getByText(/Monday must have a valid opening time earlier than its closing time/i)).toBeInTheDocument();
      expect(addToast).not.toHaveBeenCalled();
    });
  });

  describe('AppointmentsView Loading, Error, Retry & Filtered-Empty States', () => {
    it('renders connection error with working Retry action', () => {
      const reloadLiveAppointments = vi.fn();
      mockUseApp.mockReturnValue(
        buildBaseContext({
          mode: 'supabase',
          liveDataError: 'Network timeout while loading appointments.',
          liveDataErrorType: 'connection',
          appointments: [],
          reloadLiveAppointments,
        })
      );

      render(<AppointmentsView />);
      expect(screen.getByText(/Unable to load appointments/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
      expect(reloadLiveAppointments).toHaveBeenCalledTimes(1);
    });

    it('renders filtered-empty state and clears filters when Clear Filters is clicked', () => {
      const apt: Appointment = {
        id: 'apt-1',
        tenantId: '42',
        customerId: 'cust-1',
        customerName: 'Laura Smith',
        customerPhone: '+15551112222',
        customerLanguage: 'en',
        serviceId: 'svc-1',
        serviceName: 'Haircut',
        date: '2026-11-24',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        price: 70,
        locationType: 'in_business',
        status: 'confirmed',
        source: 'manual_dashboard',
        createdAt: '',
      };

      mockUseApp.mockReturnValue(
        buildBaseContext({
          appointments: [apt],
        })
      );

      render(<AppointmentsView />);
      const searchInput = screen.getByPlaceholderText(/Search customer/i);
      fireEvent.change(searchInput, { target: { value: 'ZZZ-NO-MATCH' } });

      expect(screen.getByText(translations.en.appointmentsView.emptyTitle)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: translations.en.appointmentsView.clearFilters }));
      expect(screen.getByText('Laura Smith')).toBeInTheDocument();
    });
  });

  describe('NewAppointmentModal State Reset, Online Location & Double-Submit Lock', () => {
    it('resets wizard step and search fields when closed and reopened', () => {
      const customer: Customer = {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '42',
        name: 'Elena Gomez',
        phone: '+15551112222',
        email: 'elena@example.com',
        preferredLanguage: 'en',
        totalAppointments: 1,
        lastInteractionAt: '',
        createdAt: '',
      };

      const ctx = buildBaseContext({
        customers: [customer],
      });
      mockUseApp.mockReturnValue(ctx);

      const onClose = vi.fn();
      const { rerender } = render(<NewAppointmentModal isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Elena Gomez'));
      fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
      expect(screen.getByText(/Step 2 of 5/i)).toBeInTheDocument();

      rerender(<NewAppointmentModal isOpen={false} onClose={onClose} />);
      rerender(<NewAppointmentModal isOpen={true} onClose={onClose} />);

      expect(screen.getByText(/Step 1 of 5/i)).toBeInTheDocument();
    });

    it('supports Online location option when enabled in tenant settings and blocks double-confirm', async () => {
      const todayStr = getDateStringInTimezone(new Date(), 'America/New_York');
      let resolveBooking!: (v: { success: boolean }) => void;
      const addAppointment = vi.fn(
        (_payload: Partial<Appointment>) =>
          new Promise<{ success: boolean }>(resolve => {
            resolveBooking = resolve;
          })
      );

      const customer: Customer = {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '42',
        name: 'Carlos Ruiz',
        phone: '+15552223333',
        email: 'carlos@example.com',
        preferredLanguage: 'en',
        totalAppointments: 0,
        lastInteractionAt: '',
        createdAt: '',
      };

      const service: Service = {
        id: '22222222-2222-4222-8222-222222222222',
        tenantId: '42',
        nameEn: 'Virtual Style Consult',
        nameEs: 'Asesoría Virtual',
        descriptionEn: 'Online session',
        descriptionEs: 'Sesión en línea',
        durationMinutes: 45,
        price: 50,
        currency: 'USD',
        category: 'Consult',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: true,
      };

      mockUseApp.mockReturnValue(
        buildBaseContext({
          mode: 'demo',
          customers: [customer],
          services: [service],
          addAppointment,
          currentTenant: {
            settings: {
              operatingHours: {
                0: { open: '00:00', close: '23:59', isClosed: false },
                1: { open: '00:00', close: '23:59', isClosed: false },
                2: { open: '00:00', close: '23:59', isClosed: false },
                3: { open: '00:00', close: '23:59', isClosed: false },
                4: { open: '00:00', close: '23:59', isClosed: false },
                5: { open: '00:00', close: '23:59', isClosed: false },
                6: { open: '00:00', close: '23:59', isClosed: false },
              },
              specialHours: [],
              cancellationBufferHours: 24,
              bufferBetweenAppointmentsMinutes: 0,
              locationTypes: ['online'],
            },
          },
        })
      );

      const onClose = vi.fn();
      render(<NewAppointmentModal isOpen={true} onClose={onClose} />);

      // Step 1
      fireEvent.click(screen.getByText('Carlos Ruiz'));
      fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

      // Step 2
      fireEvent.click(screen.getByText('Virtual Style Consult'));
      fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

      // Step 3 (auto-selected slot for open 24h day, advance date tomorrow to ensure future slot exists)
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowStr = getDateStringInTimezone(tomorrow, 'America/New_York');
      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      if (dateInput && tomorrowStr !== todayStr) {
        fireEvent.change(dateInput, { target: { value: tomorrowStr } });
      }
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Next Step/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

      // Step 4: Online option must be visible and selected
      expect(screen.getByText(translations.en.settings.locationOnline)).toBeInTheDocument();
      expect(screen.queryByText(translations.en.bookingModal.atHomeOption)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

      // Step 5: Summary shows Online & double-confirm calls addAppointment once
      expect(screen.getByText(translations.en.settings.locationOnline)).toBeInTheDocument();
      const confirmBtn = screen.getByRole('button', { name: translations.en.bookingModal.btnConfirm });
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);

      expect(addAppointment).toHaveBeenCalledTimes(1);
      expect(addAppointment.mock.calls[0][0].locationType).toBe('online');

      resolveBooking({ success: true });
      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('AppointmentDetailDrawer Backend-Confirmed Status Handling', () => {
    it('displays returned error without closing when updateAppointmentStatus fails', async () => {
      const updateAppointmentStatus = vi.fn().mockResolvedValue({
        success: false,
        error: 'Database update failed.',
      });

      const apt: Appointment = {
        id: 'apt-99',
        tenantId: '42',
        customerId: 'cust-1',
        customerName: 'Sofia Marin',
        customerPhone: '+15553334444',
        customerLanguage: 'en',
        serviceId: 'svc-1',
        serviceName: 'Facial',
        date: '2026-11-24',
        startTime: '11:00',
        endTime: '11:45',
        durationMinutes: 45,
        price: 95,
        locationType: 'in_business',
        status: 'pending',
        source: 'manual_dashboard',
        createdAt: '',
      };

      mockUseApp.mockReturnValue(
        buildBaseContext({
          updateAppointmentStatus,
        })
      );

      render(
        <AppointmentDetailDrawer
          appointment={apt}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

      await waitFor(() => {
        expect(updateAppointmentStatus).toHaveBeenCalledWith('apt-99', 'confirmed');
        expect(screen.getByText('Database update failed.')).toBeInTheDocument();
      });
    });
  });

  describe('CustomersView Backend Confirmation & Validation', () => {
    it('does not update displayed customer notes if backend updateCustomerNotes fails', async () => {
      const updateCustomerNotes = vi.fn().mockResolvedValue({
        success: false,
        error: 'Unable to save customer notes right now.',
      });

      const customer: Customer = {
        id: 'cust-1',
        tenantId: '42',
        name: 'David Miller',
        phone: '+1 732-555-0199',
        email: 'david@example.com',
        preferredLanguage: 'en',
        notes: 'Original note',
        totalAppointments: 2,
        lastInteractionAt: '',
        createdAt: '',
      };

      mockUseApp.mockReturnValue(
        buildBaseContext({
          customers: [customer],
          updateCustomerNotes,
        })
      );

      render(<CustomersView />);
      fireEvent.click(screen.getByText('David Miller'));

      const textarea = screen.getByDisplayValue('Original note');
      fireEvent.change(textarea, { target: { value: 'New unsaved note' } });
      fireEvent.click(screen.getByRole('button', { name: /Save/i }));

      await waitFor(() => {
        expect(updateCustomerNotes).toHaveBeenCalledWith('cust-1', 'New unsaved note');
        expect(screen.getByText('Unable to save customer notes right now.')).toBeInTheDocument();
      });
      expect(screen.queryByText('Notes saved')).not.toBeInTheDocument();
    });

    it('shows inline validation error when submitting empty customer and prevents duplicate submits', async () => {
      let resolveCreate!: (val: Customer) => void;
      const addCustomer = vi.fn(
        () =>
          new Promise<Customer>(resolve => {
            resolveCreate = resolve;
          })
      );

      mockUseApp.mockReturnValue(
        buildBaseContext({
          customers: [],
          addCustomer,
        })
      );

      render(<CustomersView />);
      fireEvent.click(screen.getAllByRole('button', { name: /Add Customer/i })[0]);

      // Submit blank form
      fireEvent.click(screen.getByRole('button', { name: /Save Customer/i }));
      expect(screen.getByText(/Full name and phone are required/i)).toBeInTheDocument();
      expect(addCustomer).not.toHaveBeenCalled();

      // Fill required fields and double submit
      fireEvent.change(screen.getByPlaceholderText('e.g. David Miller'), {
        target: { value: 'Lucia Vega' },
      });
      fireEvent.change(screen.getByPlaceholderText('+1 (732) 555-0199'), {
        target: { value: '+1 555-999-0000' },
      });

      const submitBtn = screen.getByRole('button', { name: /Save Customer/i });
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      expect(addCustomer).toHaveBeenCalledTimes(1);
      resolveCreate({
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '42',
        name: 'Lucia Vega',
        phone: '+1 555-999-0000',
        email: '',
        preferredLanguage: 'en',
        totalAppointments: 0,
        lastInteractionAt: '',
        createdAt: '',
      });
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('e.g. David Miller')).not.toBeInTheDocument();
      });
    });
  });
});
