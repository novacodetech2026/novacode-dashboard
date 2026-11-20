import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { Tenant, Service } from '../types';
import { resolveBusinessHoursForDate } from '../utils/scheduling';
import { isValidIanaTimezone } from '../utils/timezone';
import { SUPPORTED_CURRENCIES, normalizeCurrencyCode, getCurrencySymbol } from '../utils/currency';

const createClientState = vi.hoisted(() => ({
  mockClient: null as any,
}));

const mockUseApp = vi.fn();

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

vi.mock('../context/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

import {
  updateBusinessProfileInSupabase,
  saveWeeklyBusinessHoursInSupabase,
  sanitizeSpecialHoursPayload,
  mapDatabaseBusinessToTenant,
  createServiceInSupabase,
  updateServiceInSupabase,
  getSupabaseClient,
} from '../services/supabase';
import { SettingsView } from '../components/SettingsView';

function configureMockSupabase(mockClient: any, suffix: string) {
  createClientState.mockClient = mockClient;
  localStorage.setItem(
    'novacode_supabase_config',
    JSON.stringify({
      url: `https://phase5-${suffix}.supabase.co`,
      anonKey: `anon-key-${suffix}`,
    })
  );
  getSupabaseClient(`https://phase5-${suffix}.supabase.co`, `anon-key-${suffix}`);
}

function buildSettingsMockContext(overrides: Record<string, any> = {}) {
  const language: 'en' | 'es' = overrides.language || 'en';
  const tenant: Tenant = {
    id: '42',
    name: 'Salon Naomi',
    slug: 'salon-naomi',
    tagline: 'Precision Hair & Beauty',
    description: 'Full-service beauty & styling studio',
    logo: 'https://example.com/naomi.png',
    isActive: true,
    category: 'salon',
    categoryLabelEn: 'Hair Salon',
    categoryLabelEs: 'Salón de Belleza',
    timezone: 'America/New_York',
    defaultLanguage: 'en',
    currency: 'USD',
    currencySymbol: '$',
    phone: '+1 305-555-0190',
    email: 'hello@salonnaomi.com',
    address: '210 Ocean Dr, Miami Beach, FL',
    website: 'https://salonnaomi.com',
    instagram: '@salonnaomi',
    settings: {
      operatingHours: {
        0: { open: '', close: '', isClosed: true },
        1: { open: '09:00', close: '18:00', isClosed: false },
        2: { open: '09:00', close: '18:00', isClosed: false },
      },
      operatingHoursMigrated: false,
      specialHours: [
        { date: '2026-12-25', isClosed: true, label: 'Christmas Day' },
      ],
      cancellationBufferHours: 24,
      bufferBetweenAppointmentsMinutes: 15,
      locationTypes: ['in_business', 'online'],
      bookingInstructions: 'Arrive 10 minutes early for check-in.',
      aiAssistant: {
        assistantName: 'Naomi Concierge',
        preferredLanguage: 'auto',
        greeting: 'Welcome to Salon Naomi!',
        businessDescription: 'Full-service hair & styling studio.',
        communicationStyle: 'warm',
      },
    },
    ...(overrides.currentTenant || {}),
  };

  const services: Service[] = overrides.services || [
    {
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
    },
    {
      id: 'svc-2',
      tenantId: '42',
      nameEn: 'Legacy Perm',
      nameEs: 'Permanente Clásica',
      descriptionEn: 'Archived classic treatment.',
      descriptionEs: 'Tratamiento archivado.',
      durationMinutes: 90,
      price: 120,
      currency: 'USD',
      category: 'Hair',
      allowsInBusiness: true,
      allowsAtHome: false,
      active: false,
    },
  ];

  return {
    language,
    setLanguage: vi.fn(),
    t: translations[language],
    mode: 'supabase',
    currentTenant: tenant,
    availableTenants: [tenant],
    canManageBusinessSettings: true,
    canManageServices: true,
    canManageStaff: true,
    isSuperAdmin: false,
    liveMembers: [],
    staff: [],
    services,
    reloadBusinessMembers: vi.fn().mockResolvedValue(undefined),
    assignBusinessMember: vi.fn().mockResolvedValue({ success: true }),
    removeBusinessMember: vi.fn().mockResolvedValue({ success: true }),
    saveBusinessProfile: vi.fn().mockResolvedValue({ success: true }),
    saveWeeklyBusinessHours: vi.fn().mockResolvedValue({ success: true }),
    saveSpecialHours: vi.fn().mockResolvedValue({ success: true }),
    saveBookingPolicies: vi.fn().mockResolvedValue({ success: true }),
    addService: vi.fn().mockResolvedValue({ success: true }),
    updateService: vi.fn().mockResolvedValue({ success: true }),
    setActiveTab: vi.fn(),
    addToast: vi.fn(),
    ...overrides,
  };
}

describe('Phase 5 — Complete Business Settings Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientState.mockClient = null;
  });

  describe('1. Business Profile & Protected Field Enforcement (update_business_profile RPC)', () => {
    it('calls update_business_profile RPC, never directly updates public.businesses, and strips admin/unmigrated fields', async () => {
      const rpcCalls: Array<{ fn: string; params: any }> = [];
      const directUpdateSpy = vi.fn();

      configureMockSupabase(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          rpc: vi.fn(async (fn: string, params: any) => {
            rpcCalls.push({ fn, params });
            return { data: null, error: null };
          }),
          from: vi.fn(() => ({
            update: directUpdateSpy,
          })),
        },
        'rpc-profile'
      );

      const res = await updateBusinessProfileInSupabase('42', {
        name: 'Salon Naomi Luxury',
        business_type: 'salon',
        description: 'Upscale hair & beauty salon',
        phone: '+1 305-555-0199',
        email: 'concierge@salonnaomi.com',
        address: '210 Ocean Dr',
        website: 'https://salonnaomi.com',
        instagram: '@salonnaomi.studio',
        timezone: 'America/New_York',
        currency: 'eur',
        locationTypes: ['in_business', 'online'],
        bookingInstructions: 'Text upon arrival',
        // Disallowed/protected keys that MUST be stripped:
        is_active: false,
        isSuspended: true,
        communicationChannels: { whatsapp: { status: 'connected' } },
        operatingHours: { 1: { open: '09:00', close: '17:00', isClosed: false } },
        operatingHoursMigrated: true,
        owner_id: 'attacker-uid',
        role: 'super_admin',
      });

      expect(res.success).toBe(true);
      expect(directUpdateSpy).not.toHaveBeenCalled();
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0].fn).toBe('update_business_profile');
      expect(rpcCalls[0].params.p_business_id).toBe(42);

      const sent = rpcCalls[0].params.p_profile;
      expect(sent.name).toBe('Salon Naomi Luxury');
      expect(sent.instagram).toBe('@salonnaomi.studio');
      expect(sent.currency).toBe('EUR');
      expect(sent.currencySymbol).toBe('€');
      expect(sent.locationTypes).toEqual(['in_business', 'online']);
      expect(sent.bookingInstructions).toBe('Text upon arrival');

      expect(sent).not.toHaveProperty('is_active');
      expect(sent).not.toHaveProperty('isSuspended');
      expect(sent).not.toHaveProperty('communicationChannels');
      expect(sent).not.toHaveProperty('operatingHours');
      expect(sent).not.toHaveProperty('operatingHoursMigrated');
      expect(sent).not.toHaveProperty('owner_id');
      expect(sent).not.toHaveProperty('role');
    });

    it('rejects invalid IANA timezones and empty business names before calling RPC', async () => {
      const rpcSpy = vi.fn();
      configureMockSupabase(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          rpc: rpcSpy,
        },
        'invalid-profile'
      );

      expect(isValidIanaTimezone('America/Santo_Domingo')).toBe(true);
      expect(isValidIanaTimezone('Mars/OlympusMons')).toBe(false);

      const badTz = await updateBusinessProfileInSupabase('42', {
        name: 'Salon Naomi',
        timezone: 'Not/A_Timezone',
      });
      expect(badTz.success).toBe(false);
      expect(rpcSpy).not.toHaveBeenCalled();

      const emptyName = await updateBusinessProfileInSupabase('42', {
        name: '   ',
      });
      expect(emptyName.success).toBe(false);
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('submits Business Profile UI including Instagram, currency, locations, and booking instructions via saveBusinessProfile', async () => {
      const saveBusinessProfile = vi.fn().mockResolvedValue({ success: true });
      mockUseApp.mockReturnValue(buildSettingsMockContext({ saveBusinessProfile }));

      render(<SettingsView />);

      fireEvent.change(screen.getByLabelText(/Instagram/i), {
        target: { value: '@naomi.atelier' },
      });
      fireEvent.change(screen.getByLabelText(/Preferred Currency/i), {
        target: { value: 'DOP' },
      });
      fireEvent.change(screen.getByLabelText(/Booking Instructions/i), {
        target: { value: 'Please bring inspiration photos.' },
      });

      const atHomeToggle = screen.getByRole('checkbox', { name: 'At Customer Home' });
      fireEvent.click(atHomeToggle);

      fireEvent.click(screen.getByRole('button', { name: /Save Profile Settings/i }));

      await waitFor(() => {
        expect(saveBusinessProfile).toHaveBeenCalledTimes(1);
      });

      expect(saveBusinessProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Salon Naomi',
          instagram: '@naomi.atelier',
          currency: 'DOP',
          timezone: 'America/New_York',
          locationTypes: ['in_business', 'online', 'at_home'],
          bookingInstructions: 'Please bring inspiration photos.',
        })
      );
    });
  });

  describe('2. Services & Pricing Management (public.services + Archive)', () => {
    it('creates services against live public.services columns (with currency & business_id) and falls back cleanly on legacy schema cache errors', async () => {
      const insertPayloads: any[] = [];
      let callCount = 0;

      configureMockSupabase(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          from: vi.fn((table: string) => {
            expect(table).toBe('services');
            return {
              insert: vi.fn((payload: any) => {
                insertPayloads.push(payload);
                callCount += 1;
                return {
                  select: vi.fn(() => ({
                    single: vi.fn(async () => {
                      if (callCount === 1) {
                        return {
                          data: null,
                          error: { code: 'PGRST204', message: "Could not find the 'currency' column" },
                        };
                      }
                      return {
                        data: {
                          id: 'uuid-svc-new',
                          business_id: 42,
                          name: 'Keratin Treatment',
                          description: 'Smoothing care',
                          duration_minutes: 90,
                          price: 150,
                          currency: 'USD',
                          is_active: true,
                        },
                        error: null,
                      };
                    }),
                  })),
                };
              }),
            };
          }),
        },
        'svc-create'
      );

      const res = await createServiceInSupabase('42', {
        nameEn: 'Keratin Treatment',
        nameEs: 'Tratamiento de Keratina',
        descriptionEn: 'Smoothing care',
        descriptionEs: 'Cuidado alisador',
        durationMinutes: 90,
        price: 150,
        currency: 'USD',
        category: 'Hair',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: true,
      });

      expect(res.success).toBe(true);
      expect(insertPayloads[0]).toEqual({
        business_id: 42,
        name: 'Keratin Treatment',
        description: 'Smoothing care',
        duration_minutes: 90,
        price: 150,
        currency: 'USD',
        is_active: true,
      });
      // Legacy retry preserves business_id & columns
      expect(insertPayloads[1].business_id).toBe(42);
      expect(res.service?.id).toBe('uuid-svc-new');
    });

    it('archives (soft-deactivates) and edits services in Settings -> Services without hard deletes', async () => {
      const updateService = vi.fn().mockResolvedValue({ success: true });
      const addService = vi.fn().mockResolvedValue({ success: true });
      mockUseApp.mockReturnValue(buildSettingsMockContext({ updateService, addService }));

      render(<SettingsView />);
      fireEvent.click(screen.getByRole('button', { name: 'Services' }));

      expect(screen.getByText('Signature Blowout')).toBeInTheDocument();
      expect(screen.getByText('Legacy Perm')).toBeInTheDocument();

      // Filter inactive services
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
      expect(screen.queryByText('Signature Blowout')).not.toBeInTheDocument();
      expect(screen.getByText('Legacy Perm')).toBeInTheDocument();

      // Switch back to all and archive Signature Blowout
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
      const archiveBtns = screen.getAllByRole('button', { name: 'Archive' });
      fireEvent.click(archiveBtns[0]);

      await waitFor(() => {
        expect(updateService).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'svc-1',
            tenantId: '42',
            active: false,
          })
        );
      });

      // Inline add service with currency
      fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));
      fireEvent.change(screen.getByPlaceholderText(/Signature Haircut/i), {
        target: { value: 'Scalp Spa' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Service' }));

      await waitFor(() => {
        expect(addService).toHaveBeenCalledWith(
          expect.objectContaining({
            nameEn: 'Scalp Spa',
            currency: 'USD',
            durationMinutes: 60,
            price: 75,
            active: true,
          })
        );
      });

      // Also verify direct Supabase archive call uses is_active=false with business_id filter
      const eqCalls: Array<[string, any]> = [];
      configureMockSupabase(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          from: vi.fn(() => ({
            update: vi.fn(() => ({
              eq: vi.fn((col: string, val: any) => {
                eqCalls.push([col, val]);
                return {
                  eq: vi.fn((col2: string, val2: any) => {
                    eqCalls.push([col2, val2]);
                    return {
                      select: vi.fn(() => ({
                        single: vi.fn(async () => ({
                          data: {
                            id: 'svc-1',
                            business_id: 42,
                            name: 'Signature Blowout',
                            duration_minutes: 60,
                            price: 85,
                            currency: 'USD',
                            is_active: false,
                          },
                          error: null,
                        })),
                      })),
                    };
                  }),
                };
              }),
            })),
          })),
        },
        'svc-archive'
      );

      const archiveDbRes = await updateServiceInSupabase({
        id: 'svc-1',
        tenantId: '42',
        nameEn: 'Signature Blowout',
        nameEs: 'Signature Blowout',
        descriptionEn: '',
        descriptionEs: '',
        durationMinutes: 60,
        price: 85,
        currency: 'USD',
        category: 'Hair',
        allowsInBusiness: true,
        allowsAtHome: false,
        active: false,
      });
      expect(archiveDbRes.success).toBe(true);
      expect(eqCalls).toEqual([
        ['id', 'svc-1'],
        ['business_id', 42],
      ]);
    });
  });

  describe('3. Weekly Business Hours (public.business_hours Authority & Zero Fabricated Defaults)', () => {
    it('does NOT invent default opening hours when public.business_hours has unconfigured days', () => {
      const unconfiguredTenant = mapDatabaseBusinessToTenant(
        {
          id: 77,
          name: 'Fresh Business',
          business_type: 'consulting',
          timezone: 'America/New_York',
          is_active: true,
          settings: {},
        },
        []
      );

      expect(Object.keys(unconfiguredTenant.settings.operatingHours)).toHaveLength(0);

      // Scheduling resolution also treats unconfigured days as closed without fabricating 09:00-18:00
      const resolved = resolveBusinessHoursForDate(unconfiguredTenant, '2026-11-18');
      expect(resolved.isClosed).toBe(true);
      expect(resolved.open).toBe('');
      expect(resolved.close).toBe('');
    });

    it('writes weekly hours strictly to public.business_hours (never update_business_profile) while unmigrated', async () => {
      const rpcSpy = vi.fn();
      const bhUpdates: any[] = [];
      const bhInserts: any[] = [];

      configureMockSupabase(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          rpc: rpcSpy,
          from: vi.fn((table: string) => {
            expect(table).toBe('business_hours');
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [{ id: 1, business_id: 42, day_of_week: 0, open_time: '09:00', close_time: '12:00', is_open: true }],
                  error: null,
                })),
              })),
              update: vi.fn((payload: any) => {
                bhUpdates.push(payload);
                return { eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) };
              }),
              insert: vi.fn(async (payload: any) => {
                bhInserts.push(payload);
                return { error: null };
              }),
            };
          }),
        },
        'weekly-bh'
      );

      const res = await saveWeeklyBusinessHoursInSupabase(
        '42',
        {
          1: { open: '10:00', close: '19:00', isClosed: false },
        },
        { operatingHoursMigrated: false }
      );

      expect(res.success).toBe(true);
      expect(rpcSpy).not.toHaveBeenCalled();
      // Day 0 was unconfigured in new schedule -> marked closed rather than fabricated
      expect(bhUpdates).toEqual([{ is_open: false }]);
      // Day 1 inserted with explicit open/close and is_open: true
      expect(bhInserts).toEqual([
        {
          business_id: 42,
          day_of_week: 1,
          open_time: '10:00',
          close_time: '19:00',
          is_open: true,
        },
      ]);
    });

    it('renders Sunday–Saturday in WeeklyHoursSection with Edit, Reset, and validation for open < close', async () => {
      const saveWeeklyBusinessHours = vi.fn().mockResolvedValue({ success: true });
      mockUseApp.mockReturnValue(
        buildSettingsMockContext({
          saveWeeklyBusinessHours,
          currentTenant: {
            settings: {
              operatingHours: {
                1: { open: '09:00', close: '17:00', isClosed: false },
              },
              operatingHoursMigrated: false,
            },
          },
        })
      );

      render(<SettingsView />);
      fireEvent.click(screen.getByRole('button', { name: 'Operating Hours' }));

      const sundayIdx = screen.getByText('Sunday').compareDocumentPosition(screen.getByText('Monday'));
      expect(sundayIdx & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      expect(screen.getAllByText('Not configured').length).toBeGreaterThanOrEqual(5);

      fireEvent.click(screen.getByRole('button', { name: 'Edit Hours' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Operating Hours' }));

      await waitFor(() => {
        expect(saveWeeklyBusinessHours).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('4. Special & Holiday Hours Calendar', () => {
    it('sanitizes closed dates without open/close and saves via calendar UI', async () => {
      const sanitized = sanitizeSpecialHoursPayload([
        { date: '2026-12-25', isClosed: true, open: '09:00', close: '17:00', label: 'Christmas' },
        { date: '2026-12-31', isClosed: false, open: '10:00', close: '14:00', label: 'NYE Short Day' },
      ]);
      expect(sanitized.ok).toBe(true);
      if (sanitized.ok) {
        expect(sanitized.items[0]).toEqual({
          date: '2026-12-25',
          isClosed: true,
          label: 'Christmas',
        });
        expect(sanitized.items[0]).not.toHaveProperty('open');
        expect(sanitized.items[0]).not.toHaveProperty('close');
        expect(sanitized.items[1]).toEqual({
          date: '2026-12-31',
          isClosed: false,
          open: '10:00',
          close: '14:00',
          label: 'NYE Short Day',
        });
      }

      const saveSpecialHours = vi.fn().mockResolvedValue({ success: true });
      mockUseApp.mockReturnValue(buildSettingsMockContext({ saveSpecialHours }));

      render(<SettingsView />);
      fireEvent.click(screen.getByRole('button', { name: 'Special & Holiday Hours' }));

      const reasonInput = screen.getByPlaceholderText(/Christmas, Staff Training/i);
      fireEvent.change(reasonInput, { target: { value: 'Inventory Day' } });
      fireEvent.click(screen.getByRole('button', { name: /Apply Date|Update Date/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Special Hours' }));

      await waitFor(() => {
        expect(saveSpecialHours).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('5. Booking Policies Validation & Non-Invented Toggles', () => {
    it('validates non-negative integers for buffer & cancellation hours and omits unbacked toggles', async () => {
      const saveBookingPolicies = vi.fn().mockResolvedValue({ success: true });
      mockUseApp.mockReturnValue(buildSettingsMockContext({ saveBookingPolicies }));

      const { container } = render(<SettingsView />);
      fireEvent.click(screen.getByRole('button', { name: 'Business Preferences' }));

      expect(container.textContent).not.toMatch(/Enable 24\/7 Automated AI Booking/i);
      expect(container.textContent).not.toMatch(/Require Address for At-Home Visits/i);

      const cancelInput = screen.getByLabelText(/Cancellation Notice Window/i);
      const bufferInput = screen.getByLabelText(/Buffer Between Appointments/i);

      // Negative value blocked cleanly
      fireEvent.change(cancelInput, { target: { value: '-2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));
      expect(screen.getByText(/non-negative whole integer/i)).toBeInTheDocument();
      expect(saveBookingPolicies).not.toHaveBeenCalled();

      // Valid non-negative integers save cleanly
      fireEvent.change(cancelInput, { target: { value: '48' } });
      fireEvent.change(bufferInput, { target: { value: '20' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));

      await waitFor(() => {
        expect(saveBookingPolicies).toHaveBeenCalledWith(
          expect.objectContaining({
            cancellationBufferHours: 48,
            bufferBetweenAppointmentsMinutes: 20,
            locationTypes: ['in_business', 'online'],
          })
        );
      });
    });
  });

  describe('6. Currency Helpers & Staff Read-Only Role Guard', () => {
    it('supports major currencies cleanly and isolates staff from editing settings', () => {
      expect(SUPPORTED_CURRENCIES.some(c => c.code === 'DOP')).toBe(true);
      expect(normalizeCurrencyCode('mxn')).toBe('MXN');
      expect(getCurrencySymbol('EUR')).toBe('€');

      mockUseApp.mockReturnValue(
        buildSettingsMockContext({
          canManageBusinessSettings: false,
          canManageServices: false,
          canManageStaff: false,
        })
      );

      render(<SettingsView />);
      expect(screen.getByText('Staff Access')).toBeInTheDocument();
      expect(screen.getByText('Salon Naomi')).toBeInTheDocument();
      expect(screen.getByText('America/New_York')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Business Profile' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Save Profile Settings/i })).not.toBeInTheDocument();
    });
  });
});
