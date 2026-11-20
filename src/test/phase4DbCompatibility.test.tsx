import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Tenant } from '../types';

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
  mapDatabaseBusinessToTenant,
  updateBusinessSettingsInSupabase,
  toggleBusinessActiveInSupabase,
  updateBusinessCommunicationChannelsInSupabase,
  fetchUserAccessProfile,
  getSupabaseClient,
} from '../services/supabase';

function configureMockClient(mockClient: any, suffix: string) {
  createClientState.mockClient = mockClient;
  localStorage.setItem(
    'novacode_supabase_config',
    JSON.stringify({
      url: `https://phase4-${suffix}.supabase.co`,
      anonKey: `anon-key-${suffix}`,
    })
  );
  getSupabaseClient(`https://phase4-${suffix}.supabase.co`, `anon-key-${suffix}`);
}

function makeLiveDbRow(overrides: Record<string, any> = {}) {
  return {
    id: 101,
    created_at: '2026-01-10T12:00:00.000Z',
    name: 'Novacode Wellness',
    business_type: 'massage_therapy',
    phone: '+1 305-555-0144',
    email: 'hello@wellness.example.com',
    timezone: 'America/New_York',
    is_active: true,
    settings: {
      tagline: 'Care & Aesthetics',
      description: 'Clinical wellness hub',
      logo: 'https://example.com/logo.png',
      defaultLanguage: 'es',
      currency: 'USD',
      currencySymbol: '$',
      address: '500 Brickell Ave, Miami, FL',
      website: 'https://wellness.example.com',
      cancellationBufferHours: 24,
      bufferBetweenAppointmentsMinutes: 15,
      specialHours: [
        {
          id: 'sh-1',
          date: '2026-12-25',
          label: 'Christmas Day',
          open: '09:00',
          close: '17:00',
          isClosed: true,
        },
      ],
      operatingHours: {
        1: { open: '06:00', close: '07:00', isClosed: false },
      },
    },
    ...overrides,
  };
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: '101',
    name: 'Novacode Wellness',
    slug: 'novacode-wellness',
    tagline: 'Care & Aesthetics',
    description: 'Clinical wellness hub',
    isActive: true,
    category: 'massage_therapy',
    categoryLabelEn: 'Massage Therapy',
    categoryLabelEs: 'Terapia de Masajes',
    logo: 'https://example.com/logo.png',
    timezone: 'America/New_York',
    defaultLanguage: 'es',
    currency: 'USD',
    currencySymbol: '$',
    phone: '+1 305-555-0144',
    email: 'hello@wellness.example.com',
    address: '500 Brickell Ave, Miami, FL',
    website: 'https://wellness.example.com',
    settings: {
      operatingHours: {
        0: { open: '10:00', close: '14:00', isClosed: true },
        1: { open: '09:00', close: '18:00', isClosed: false },
        2: { open: '09:00', close: '18:00', isClosed: false },
        3: { open: '09:00', close: '18:00', isClosed: false },
        4: { open: '09:00', close: '19:00', isClosed: false },
        5: { open: '09:00', close: '19:00', isClosed: false },
        6: { open: '10:00', close: '16:00', isClosed: false },
      },
      specialHours: [
        {
          id: 'sh-1',
          date: '2026-12-25',
          label: 'Christmas Day',
          open: '09:00',
          close: '17:00',
          isClosed: true,
        },
      ],
      cancellationBufferHours: 24,
      bufferBetweenAppointmentsMinutes: 15,
      aiAutomatedBooking: true,
      requireAtHomeAddress: true,
      categoryDetails: { groupId: 'beauty_wellness' },
    },
    ...overrides,
  };
}

describe('Phase 4 — Production Database Compatibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createClientState.mockClient = null;
  });

  describe('1. Live Schema Mapping (public.businesses + public.business_hours)', () => {
    it('hydrates Tenant profile and extended settings from live businesses columns + settings JSONB', () => {
      const row = makeLiveDbRow();
      const tenant = mapDatabaseBusinessToTenant(row);

      expect(tenant.id).toBe('101');
      expect(tenant.name).toBe('Novacode Wellness');
      expect(tenant.category).toBe('massage_therapy');
      expect(tenant.timezone).toBe('America/New_York');
      expect(tenant.phone).toBe('+1 305-555-0144');
      expect(tenant.email).toBe('hello@wellness.example.com');
      expect(tenant.isActive).toBe(true);
      expect(tenant.tagline).toBe('Care & Aesthetics');
      expect(tenant.description).toBe('Clinical wellness hub');
      expect(tenant.logo).toBe('https://example.com/logo.png');
      expect(tenant.defaultLanguage).toBe('es');
      expect(tenant.currencySymbol).toBe('$');
      expect(tenant.address).toBe('500 Brickell Ave, Miami, FL');
      expect(tenant.website).toBe('https://wellness.example.com');
      expect(tenant.settings.cancellationBufferHours).toBe(24);
      expect(tenant.settings.bufferBetweenAppointmentsMinutes).toBe(15);
      expect(tenant.settings.specialHours).toHaveLength(1);
    });

    it('uses public.business_hours (is_open) as authoritative weekly hours until operatingHoursMigrated=true', () => {
      const row = makeLiveDbRow();
      const bhRows = [
        { business_id: 101, day_of_week: 1, open_time: '09:00:00', close_time: '17:30:00', is_open: true },
        { business_id: 101, day_of_week: 0, open_time: '10:00:00', close_time: '14:00:00', is_open: false },
      ];

      const tenant = mapDatabaseBusinessToTenant(row, bhRows);

      expect(tenant.settings.operatingHours[1]).toEqual({
        open: '09:00',
        close: '17:30',
        isClosed: false,
      });
      expect(tenant.settings.operatingHours[0].isClosed).toBe(true);
      expect(tenant.settings.operatingHours[3].isClosed).toBe(true);

      const migratedRow = makeLiveDbRow({
        settings: {
          ...row.settings,
          operatingHoursMigrated: true,
        },
      });
      const migratedTenant = mapDatabaseBusinessToTenant(migratedRow, bhRows);
      expect(migratedTenant.settings.operatingHoursMigrated).toBe(true);
      expect(migratedTenant.settings.operatingHours[1]).toEqual({
        open: '06:00',
        close: '07:00',
        isClosed: false,
      });
    });
  });

  describe('2. Live-Compatible Mutations & business_hours Sync', () => {
    it('updateBusinessSettingsInSupabase uses update_business_profile RPC (no direct businesses update) and syncs public.business_hours', async () => {
      const capturedRpcCalls: Array<{ fn: string; params: any }> = [];
      const capturedBhUpdates: any[] = [];
      const capturedBhInserts: any[] = [];
      const businessesTableUpdateSpy = vi.fn();

      configureMockClient(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          rpc: vi.fn(async (fn: string, params: any) => {
            capturedRpcCalls.push({ fn, params });
            return { data: null, error: null };
          }),
          from: vi.fn((table: string) => {
            if (table === 'businesses') {
              return {
                update: businessesTableUpdateSpy,
              };
            }
            if (table === 'business_hours') {
              return {
                select: vi.fn(() => ({
                  eq: vi.fn(async () => ({
                    data: [
                      { id: 10, business_id: 101, day_of_week: 1, open_time: '08:00', close_time: '16:00', is_open: true },
                    ],
                    error: null,
                  })),
                })),
                update: vi.fn((payload: any) => {
                  capturedBhUpdates.push(payload);
                  return {
                    eq: vi.fn(() => ({
                      eq: vi.fn(async () => ({ error: null })),
                    })),
                  };
                }),
                insert: vi.fn(async (payload: any) => {
                  capturedBhInserts.push(payload);
                  return { error: null };
                }),
              };
            }
            throw new Error(`Unexpected table: ${table}`);
          }),
        },
        'save-1'
      );

      const result = await updateBusinessSettingsInSupabase(makeTenant());

      expect(result.success).toBe(true);
      expect(businessesTableUpdateSpy).not.toHaveBeenCalled();
      expect(capturedRpcCalls).toHaveLength(1);
      expect(capturedRpcCalls[0].fn).toBe('update_business_profile');
      expect(capturedRpcCalls[0].params.p_business_id).toBe(101);

      const rpcProfile = capturedRpcCalls[0].params.p_profile;
      expect(rpcProfile.name).toBe('Novacode Wellness');
      expect(rpcProfile.business_type).toBe('massage_therapy');
      expect(rpcProfile.timezone).toBe('America/New_York');
      expect(rpcProfile.tagline).toBe('Care & Aesthetics');
      expect(rpcProfile.address).toBe('500 Brickell Ave, Miami, FL');
      expect(rpcProfile.specialHours).toHaveLength(1);
      expect(rpcProfile.specialHours[0]).toEqual({
        date: '2026-12-25',
        isClosed: true,
        label: 'Christmas Day',
      });
      expect(rpcProfile.cancellationBufferHours).toBe(24);
      expect(rpcProfile.bufferBetweenAppointmentsMinutes).toBe(15);
      expect(rpcProfile).not.toHaveProperty('operatingHours');
      expect(rpcProfile).not.toHaveProperty('is_active');
      expect(rpcProfile).not.toHaveProperty('isSuspended');
      expect(rpcProfile).not.toHaveProperty('communicationChannels');
      expect(rpcProfile).not.toHaveProperty('updated_at');

      // Day 1 updated in place, remaining 6 days inserted using is_open
      expect(capturedBhUpdates).toHaveLength(1);
      expect(capturedBhUpdates[0]).toEqual({
        open_time: '09:00',
        close_time: '18:00',
        is_open: true,
      });
      expect(capturedBhInserts).toHaveLength(6);
      const sundayInsert = capturedBhInserts.find(r => r.day_of_week === 0);
      expect(sundayInsert).toMatchObject({
        business_id: 101,
        day_of_week: 0,
        open_time: '10:00',
        close_time: '14:00',
        is_open: false,
      });
    });

    it('surfaces an explicit actionable error when prerequisite businesses.settings column is missing', async () => {
      configureMockClient(
        {
          auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
          rpc: vi.fn(async () => ({
            data: null,
            error: {
              code: 'PGRST204',
              message: "Could not find the 'settings' column of 'businesses' in the schema cache",
            },
          })),
        },
        'missing-settings'
      );

      const result = await updateBusinessSettingsInSupabase(makeTenant());

      expect(result.success).toBe(false);
      expect(result.error).toContain('20261116_01_businesses_settings_prerequisite.sql');
    });

    it('toggleBusinessActiveInSupabase and updateBusinessCommunicationChannelsInSupabase never write updated_at', async () => {
      const bizPayloads: any[] = [];
      configureMockClient(
        {
          auth: {
            getSession: vi.fn(async () => ({ data: { session: { user: { id: 'sa-1' } } }, error: null })),
            onAuthStateChange: vi.fn(),
          },
          rpc: vi.fn(async (fn: string) => ({ data: fn === 'is_super_admin' ? true : null, error: null })),
          from: vi.fn(() => ({
            update: vi.fn((payload: any) => {
              bizPayloads.push(payload);
              return {
                eq: vi.fn(async () => ({ error: null })),
              };
            }),
          })),
        },
        'toggle-channels'
      );

      const tenant = makeTenant();

      const toggleRes = await toggleBusinessActiveInSupabase(tenant, false);
      expect(toggleRes.success).toBe(true);

      const channelRes = await updateBusinessCommunicationChannelsInSupabase(tenant, {
        whatsapp: { status: 'not_configured', verifiedByBackend: false },
        sms: { status: 'pending_backend', fromPhoneNumber: '+13055550199', verifiedByBackend: false },
        webChat: { status: 'not_configured', enabled: false, verifiedByBackend: false },
      });
      expect(channelRes.success).toBe(true);

      expect(bizPayloads).toHaveLength(2);
      for (const payload of bizPayloads) {
        expect(payload).not.toHaveProperty('updated_at');
      }
      expect(bizPayloads[0]).toHaveProperty('is_active', false);
      expect(bizPayloads[1].settings.communicationChannels.sms.fromPhoneNumber).toBe('+13055550199');
    });

    it('fetchUserAccessProfile loads public.business_hours alongside public.businesses', async () => {
      configureMockClient(
        {
          auth: {
            getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })),
            onAuthStateChange: vi.fn(),
          },
          rpc: vi.fn(async () => ({ data: false, error: null })),
          from: vi.fn((table: string) => {
            if (table === 'business_members') {
              return {
                select: vi.fn(() => ({
                  eq: vi.fn(async () => ({
                    data: [{ id: 1, user_id: 'user-1', business_id: 101, role: 'owner', is_active: true }],
                    error: null,
                  })),
                })),
              };
            }
            if (table === 'businesses') {
              return {
                select: vi.fn(() => ({
                  in: vi.fn(() => ({
                    order: vi.fn(async () => ({
                      data: [makeLiveDbRow()],
                      error: null,
                    })),
                  })),
                })),
              };
            }
            if (table === 'business_hours') {
              return {
                select: vi.fn(() => ({
                  in: vi.fn(async () => ({
                    data: [
                      { business_id: 101, day_of_week: 2, open_time: '11:00:00', close_time: '15:00:00', is_open: true },
                    ],
                    error: null,
                  })),
                })),
              };
            }
            throw new Error(`Unexpected table: ${table}`);
          }),
        },
        'profile-bh'
      );

      const profile = await fetchUserAccessProfile('user-1');

      expect(profile.accessibleBusinesses).toHaveLength(1);
      expect(profile.accessibleBusinesses[0].settings.operatingHours[2]).toEqual({
        open: '11:00',
        close: '15:00',
        isClosed: false,
      });
    });
  });

  describe('3. SQL Migration & Preflight Guarantees', () => {
    it('prerequisite migration adds businesses.settings JSONB safely without dropping RLS or data', () => {
      const prereqPath = path.resolve(
        process.cwd(),
        'supabase/migrations/20261116_01_businesses_settings_prerequisite.sql'
      );
      const sql = fs.readFileSync(prereqPath, 'utf8');
      const executableSql = sql
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--.*$/gm, '');

      expect(executableSql).toContain('ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT');
      expect(executableSql).toContain("v_col_type IS DISTINCT FROM 'bigint'");
      expect(executableSql).not.toMatch(/\bDROP\s+POLICY\b/i);
      expect(executableSql).not.toMatch(/\bDROP\s+TRIGGER\b/i);
      expect(executableSql).not.toMatch(/\bTRUNCATE\b/i);
    });

    it('Phase 2 migration enforces businesses.settings prerequisite and public.business_hours weekly authority', () => {
      const p2Path = path.resolve(
        process.cwd(),
        'supabase/migrations/20261116_booking_rules_enforcement.sql'
      );
      const sql = fs.readFileSync(p2Path, 'utf8');

      expect(sql).toContain('20261116_01_businesses_settings_prerequisite.sql');
      expect(sql).toContain("column_name = 'settings'");
      expect(sql).toContain('v_operating_hours_migrated');
      expect(sql).toContain("v_bh_row ? 'is_open'");

      // Ensure specialHours precedes public.business_hours which precedes JSONB operatingHours
      const specialIdx = sql.indexOf("v_settings->'specialHours'");
      const bhIdx = sql.indexOf('IF v_bh_any THEN');
      const jsonWeeklyIdx = sql.indexOf("v_settings->'operatingHours'->(v_dow::TEXT)");
      expect(specialIdx).toBeGreaterThan(-1);
      expect(bhIdx).toBeGreaterThan(specialIdx);
      expect(jsonWeeklyIdx).toBeGreaterThan(bhIdx);
    });

    it('preflight SQL script contains strictly read-only SELECT statements', () => {
      const preflightPath = path.resolve(
        process.cwd(),
        'supabase/preflight/phase4_db_compatibility_preflight.sql'
      );
      const sql = fs.readFileSync(preflightPath, 'utf8');
      const stripped = sql
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--.*$/gm, '');

      expect(stripped).toContain('information_schema.columns');
      expect(stripped).toContain('pg_get_functiondef');
      expect(stripped).toContain('pg_policies');
      expect(stripped).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    });
  });
});
