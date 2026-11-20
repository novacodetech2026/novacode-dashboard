import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  resolvePublicRoute,
  isPublicComplianceRoute,
  buildPublicRouteHref,
  parsePublicBusinessQuery,
} from '../utils/publicRoutes';
import {
  buildSmsConsentDisclosure,
  normalizeAndValidatePhoneNumber,
  SMS_CONSENT_DISCLOSURE_VERSION,
  submitSmsConsentRegistration,
} from '../services/smsConsent';
import { PublicSmsConsentPage } from '../components/PublicSmsConsentPage';
import { PublicLegalPage } from '../components/PublicLegalPage';
import App from '../App';
import { handleRegisterSmsConsentRequest } from '../../supabase/functions/register-sms-consent/handler';

function createStatefulSupabaseAdminStub() {
  const usedTokenHashes = new Set<string>();
  const savedConsents: Array<Record<string, any>> = [];
  const businesses = [
    {
      id: 2,
      name: 'Harbor Dental Clinic',
      slug: 'harbor-dental',
      default_language: 'en',
      sms_opt_in_enabled: true,
      messaging_approved: false,
      disclosure_version: SMS_CONSENT_DISCLOSURE_VERSION,
    },
  ];

  const client = {
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: async () => {
            if (table === 'sms_turnstile_used_tokens' && col === 'token_hash') {
              const hit = usedTokenHashes.has(String(val));
              return { data: hit ? { token_hash: String(val) } : null, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
    rpc: async (fnName: string, params: Record<string, unknown> = {}) => {
      if (fnName === 'get_public_sms_consent_business') {
        const match = businesses.find((b) => b.id === params.p_business_id || b.slug === params.p_slug);
        return {
          data: match
            ? [
                {
                  business_id: match.id,
                  business_name: match.name,
                  business_slug: match.slug,
                  default_language: match.default_language,
                  sms_opt_in_enabled: match.sms_opt_in_enabled,
                  messaging_approved: match.messaging_approved,
                  disclosure_version: match.disclosure_version,
                },
              ]
            : [],
          error: null,
        };
      }

      if (fnName === 'submit_public_sms_consent') {
        const tokenHash = String(params.p_turnstile_token_hash || '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
          return { data: null, error: { message: 'TURNSTILE_REQUIRED: Verified Turnstile token digest is required.' } };
        }
        if (usedTokenHashes.has(tokenHash)) {
          return {
            data: null,
            error: { message: 'TURNSTILE_REUSED: Security verification token has already been used.' },
          };
        }
        usedTokenHashes.add(tokenHash);

        const biz = businesses.find((b) => b.id === params.p_business_id);
        if (!biz) {
          return { data: null, error: { message: 'BUSINESS_NOT_FOUND: Unavailable.' } };
        }

        const consentId = `consent-${savedConsents.length + 1}`;
        const consentTimestamp = '2026-11-15T20:20:00.000Z';
        const row = {
          consent_id: consentId,
          business_id: biz.id,
          business_name: biz.name,
          customer_name: params.p_customer_name ?? null,
          phone_number: params.p_phone_number,
          consent_given: params.p_consent_given,
          consent_timestamp: consentTimestamp,
          consent_disclosure_version: params.p_disclosure_version,
          consent_source: params.p_consent_source,
          turnstile_token_hash: tokenHash,
          messaging_approved: false,
        };
        savedConsents.push(row);

        return {
          data: {
            success: true,
            consent_id: consentId,
            business_id: biz.id,
            business_name: biz.name,
            phone_number: params.p_phone_number,
            consent_timestamp: consentTimestamp,
            consent_disclosure_version: params.p_disclosure_version,
            consent_source: params.p_consent_source,
            messaging_approved: false,
          },
          error: null,
        };
      }

      return { data: null, error: { message: `Unknown RPC ${fnName}` } };
    },
  };

  return { client, savedConsents, usedTokenHashes };
}

describe('Twilio A2P 10DLC SMS Consent Registration & Public Compliance Routes', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete (window as any).turnstile;
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete (window as any).turnstile;
  });

  it('resolves standalone public compliance routes and preserves multi-tenant query params', () => {
    expect(resolvePublicRoute('/sms-consent')).toBe('sms-consent');
    expect(resolvePublicRoute('/sms-consent/')).toBe('sms-consent');
    expect(resolvePublicRoute('/privacy-policy')).toBe('privacy-policy');
    expect(resolvePublicRoute('/terms-of-service')).toBe('terms-of-service');
    expect(resolvePublicRoute('/appointments')).toBeNull();

    expect(isPublicComplianceRoute('/sms-consent')).toBe(true);
    expect(isPublicComplianceRoute('/overview')).toBe(false);

    expect(parsePublicBusinessQuery('?business_id=42')).toEqual({
      businessId: '42',
      slug: null,
    });

    expect(buildPublicRouteHref('privacy-policy', { businessId: '42' })).toBe(
      '/privacy-policy?business_id=42'
    );
  });

  it('builds the exact required Twilio A2P 10DLC disclosure with the business name', () => {
    const text = buildSmsConsentDisclosure('Apex Modern Barber Studio');
    expect(text).toBe(
      'By checking this box, I agree to receive conversational and appointment-related SMS messages from Apex Modern Barber Studio, powered by Novacode Tech LLC, at the phone number provided. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is not a condition of purchase.'
    );
  });

  it('validates and normalizes US/Canada and international phone numbers while rejecting invalid inputs', () => {
    expect(normalizeAndValidatePhoneNumber('(555) 234-5678')).toEqual({
      valid: true,
      e164: '+15552345678',
      display: '+1 (555) 234-5678',
    });

    expect(normalizeAndValidatePhoneNumber('+44 20 7946 0958')).toEqual({
      valid: true,
      e164: '+442079460958',
      display: '+442079460958',
    });

    expect(normalizeAndValidatePhoneNumber('')).toMatchObject({ valid: false });
    expect(normalizeAndValidatePhoneNumber('abc-123-4567')).toMatchObject({ valid: false });
    expect(normalizeAndValidatePhoneNumber('12345')).toMatchObject({ valid: false });
    expect(normalizeAndValidatePhoneNumber('+10000000000')).toMatchObject({ valid: false });
  });

  it('renders /sms-consent via App without mounting dashboard sidebar or booking widgets', async () => {
    window.history.pushState({}, '', '/sms-consent?business_id=tenant-apex');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Apex Modern Barber Studio' })).toBeInTheDocument();
    });

    expect(screen.queryByText(/New Booking/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('link', { name: 'Terms of Service' }).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps SMS consent checkbox unchecked by default and blocks submission without explicit consent or valid phone', async () => {
    render(<PublicSmsConsentPage search="?business_id=tenant-serenity" />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Serenity Cove Wellness & Spa' })
      ).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    const exactDisclosure = buildSmsConsentDisclosure('Serenity Cove Wellness & Spa');
    expect(screen.getByText(exactDisclosure)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Submit SMS Consent/i }));

    await waitFor(() => {
      expect(screen.getByText('Phone number is required.')).toBeInTheDocument();
      expect(
        screen.getByText('Please check the consent box to confirm you agree to receive SMS messages.')
      ).toBeInTheDocument();
    });
  });

  it('enforces Turnstile completion in UI and persists verified consent through Edge Function without exposing secrets or auto-sending SMS', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');

    let capturedCallbacks: Record<string, (...args: any[]) => void> = {};
    const resetMock = vi.fn();
    (window as any).turnstile = {
      render: (_el: HTMLElement, options: Record<string, any>) => {
        capturedCallbacks = options;
        return 'widget-1';
      },
      reset: resetMock,
      remove: vi.fn(),
    };

    localStorage.setItem(
      'novacode_supabase_config',
      JSON.stringify({
        url: 'https://example-project.supabase.co',
        anonKey: 'public-anon-key-only',
      })
    );

    const db = createStatefulSupabaseAdminStub();
    const serverSecret = 'test-turnstile-secret-never-exposed';

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);

      if (urlStr === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        const params = new URLSearchParams(String(init?.body || ''));
        expect(params.get('secret')).toBe(serverSecret);
        expect(params.get('response')).toBe('valid-turnstile-token-12345');
        return new Response(
          JSON.stringify({
            success: true,
            challenge_ts: new Date().toISOString(),
            hostname: 'localhost',
            'error-codes': [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/functions/v1/register-sms-consent')) {
        const edgeReq = new Request(urlStr, {
          method: init?.method || 'GET',
          headers: init?.headers as HeadersInit,
          body: init?.body,
        });
        return handleRegisterSmsConsentRequest(edgeReq, {
          getEnv: (key) =>
            ({
              SUPABASE_URL: 'https://example-project.supabase.co',
              SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
              TURNSTILE_SECRET_KEY: serverSecret,
            }[key]),
          createAdminClient: () => db.client,
          fetchImpl: fetchMock as typeof fetch,
        });
      }

      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<PublicSmsConsentPage search="?business_id=2" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Harbor Dental Clinic' })).toBeInTheDocument();
      expect(screen.getByTestId('turnstile-widget-container')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Customer Name/i), {
      target: { value: 'Jordan Rivera' },
    });
    fireEvent.change(screen.getByLabelText(/Mobile Phone Number/i), {
      target: { value: '(555) 390-1122' },
    });
    fireEvent.click(screen.getByRole('checkbox'));

    await new Promise((r) => setTimeout(r, 550));

    // Attempt submit before Turnstile token is obtained -> blocked cleanly
    fireEvent.click(screen.getByRole('button', { name: /Submit SMS Consent/i }));
    await waitFor(() => {
      expect(
        screen.getByText('Please complete the verification challenge before submitting.')
      ).toBeInTheDocument();
    });
    expect(db.savedConsents).toHaveLength(0);

    // Simulate Turnstile token expiration callback -> shows expiry message
    act(() => {
      capturedCallbacks['expired-callback']?.();
    });
    await waitFor(() => {
      expect(
        screen.getByText('Security verification expired. Please complete the challenge again.')
      ).toBeInTheDocument();
    });

    // Simulate valid Turnstile challenge completion
    act(() => {
      capturedCallbacks.callback?.('valid-turnstile-token-12345');
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit SMS Consent/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'SMS Consent Recorded' })).toBeInTheDocument();
    });

    expect(db.savedConsents).toHaveLength(1);
    expect(db.savedConsents[0]).toMatchObject({
      business_id: 2,
      phone_number: '+15553901122',
      customer_name: 'Jordan Rivera',
      consent_source: 'web_form',
      consent_disclosure_version: SMS_CONSENT_DISCLOSURE_VERSION,
    });
    expect(screen.getByText('+15553901122')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Automated SMS messages remain inactive until this business completes messaging activation approval/i
      )
    ).toBeInTheDocument();
  });

  it('rejects missing, invalid, expired, and reused Turnstile tokens server-side and fails closed without TURNSTILE_SECRET_KEY', async () => {
    const serverSecret = 'cf-secret-server-only-value';
    const baseBody = (token: string | null | undefined, phone = '+15554440001') => ({
      businessId: '2',
      customerName: 'Morgan Lee',
      phoneNumber: phone,
      consentChecked: true,
      consentSource: 'web_form',
      disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION,
      formRenderedAtMs: Date.now() - 3000,
      turnstileToken: token,
    });

    // 1. Missing server TURNSTILE_SECRET_KEY fails closed (500), never exposes env names or secrets
    {
      const db = createStatefulSupabaseAdminStub();
      const siteverifyFetch = vi.fn();
      const res = await handleRegisterSmsConsentRequest(
        new Request('https://example.supabase.co/functions/v1/register-sms-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseBody('some-token-1234567890')),
        }),
        {
          getEnv: (k) =>
            ({
              SUPABASE_URL: 'https://example.supabase.co',
              SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
            }[k]),
          createAdminClient: () => db.client,
          fetchImpl: siteverifyFetch as typeof fetch,
        }
      );
      expect(res.status).toBe(500);
      const bodyText = await res.text();
      expect(bodyText).not.toContain('TURNSTILE_SECRET_KEY');
      expect(siteverifyFetch).not.toHaveBeenCalled();
      expect(db.savedConsents).toHaveLength(0);
    }

    // 2. Missing Turnstile token rejected (400)
    {
      const db = createStatefulSupabaseAdminStub();
      const siteverifyFetch = vi.fn();
      const res = await handleRegisterSmsConsentRequest(
        new Request('https://example.supabase.co/functions/v1/register-sms-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseBody('')),
        }),
        {
          getEnv: (k) =>
            ({
              SUPABASE_URL: 'https://example.supabase.co',
              SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
              TURNSTILE_SECRET_KEY: serverSecret,
            }[k]),
          createAdminClient: () => db.client,
          fetchImpl: siteverifyFetch as typeof fetch,
        }
      );
      expect(res.status).toBe(400);
      expect(siteverifyFetch).not.toHaveBeenCalled();
      expect(db.savedConsents).toHaveLength(0);
    }

    // 3. Invalid Turnstile token rejected by Cloudflare Siteverify (403)
    {
      const db = createStatefulSupabaseAdminStub();
      const siteverifyFetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
      const res = await handleRegisterSmsConsentRequest(
        new Request('https://example.supabase.co/functions/v1/register-sms-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseBody('forged-invalid-token-12345')),
        }),
        {
          getEnv: (k) =>
            ({
              SUPABASE_URL: 'https://example.supabase.co',
              SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
              TURNSTILE_SECRET_KEY: serverSecret,
            }[k]),
          createAdminClient: () => db.client,
          fetchImpl: siteverifyFetch as typeof fetch,
        }
      );
      expect(res.status).toBe(403);
      const bodyText = await res.text();
      expect(bodyText).not.toContain(serverSecret);
      expect(siteverifyFetch).toHaveBeenCalledTimes(1);
      expect(db.savedConsents).toHaveLength(0);
    }

    // 4. Expired Turnstile token rejected (both timeout-or-duplicate AND stale challenge_ts > 5 min)
    {
      const db = createStatefulSupabaseAdminStub();
      const expiredFetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            challenge_ts: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
      const res = await handleRegisterSmsConsentRequest(
        new Request('https://example.supabase.co/functions/v1/register-sms-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseBody('stale-expired-token-12345')),
        }),
        {
          getEnv: (k) =>
            ({
              SUPABASE_URL: 'https://example.supabase.co',
              SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
              TURNSTILE_SECRET_KEY: serverSecret,
            }[k]),
          createAdminClient: () => db.client,
          fetchImpl: expiredFetch as typeof fetch,
        }
      );
      expect(res.status).toBe(403);
      expect(db.savedConsents).toHaveLength(0);
    }

    // 5. Valid token persists once, and replay of the exact same token is rejected (403)
    {
      const db = createStatefulSupabaseAdminStub();
      const validSiteverifyFetch = vi.fn(async (_url, init?: RequestInit) => {
        const form = new URLSearchParams(String(init?.body || ''));
        expect(form.get('secret')).toBe(serverSecret);
        expect(form.get('remoteip')).toBe('203.0.113.42');
        expect(form.get('idempotency_key')).toBeTruthy();

        return new Response(
          JSON.stringify({
            success: true,
            challenge_ts: new Date().toISOString(),
            hostname: 'ais-dev.example.app',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const deps = {
        getEnv: (k: string) =>
          ({
            SUPABASE_URL: 'https://example.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
            TURNSTILE_SECRET_KEY: serverSecret,
            SMS_CONSENT_HASH_SALT: 'test-salt',
          }[k]),
        createAdminClient: () => db.client,
        fetchImpl: validSiteverifyFetch as typeof fetch,
      };

      const firstRes = await handleRegisterSmsConsentRequest(
        new Request('https://example.supabase.co/functions/v1/register-sms-consent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.42',
          },
          body: JSON.stringify(baseBody('single-use-valid-token-abc123', '+15554440001')),
        }),
        deps
      );
      expect(firstRes.status).toBe(200);
      const firstBodyText = await firstRes.text();
      expect(firstBodyText).not.toContain(serverSecret);
      expect(db.savedConsents).toHaveLength(1);
      expect(db.usedTokenHashes.size).toBe(1);

      // Attempt to reuse the exact same token -> rejected 403 before saving second row
      const replayRes = await handleRegisterSmsConsentRequest(
        new Request('https://example.supabase.co/functions/v1/register-sms-consent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.42',
          },
          body: JSON.stringify(baseBody('single-use-valid-token-abc123', '+15554440002')),
        }),
        deps
      );
      expect(replayRes.status).toBe(403);
      expect(db.savedConsents).toHaveLength(1);
    }
  });

  it('rejects honeypot spam and rapid duplicate bursts in preview mode', async () => {
    const spamAttempt = await submitSmsConsentRegistration({
      businessId: '1',
      businessName: 'Test Biz',
      phoneNumber: '+15552345678',
      consentChecked: true,
      honeypot: 'https://spam-bot.example',
      formRenderedAtMs: Date.now() - 5000,
    });
    expect(spamAttempt.success).toBe(false);

    const firstValid = await submitSmsConsentRegistration({
      businessId: '1',
      businessName: 'Test Biz',
      phoneNumber: '+15552345678',
      consentChecked: true,
      formRenderedAtMs: Date.now() - 5000,
    });
    expect(firstValid.success).toBe(true);

    const rapidRepeat = await submitSmsConsentRegistration({
      businessId: '1',
      businessName: 'Test Biz',
      phoneNumber: '+15552345678',
      consentChecked: true,
      formRenderedAtMs: Date.now() - 5000,
    });
    expect(rapidRepeat.success).toBe(false);
    expect(rapidRepeat.rateLimited).toBe(true);
  });

  it('renders Twilio A2P 10DLC compliant Privacy Policy and Terms of Service with configured Novacode Tech LLC contact email', () => {
    const { unmount } = render(<PublicLegalPage page="privacy-policy" search="?business_id=2" />);
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /No mobile information, phone numbers, or SMS opt-in consent records will be shared with, sold to, rented to, or disclosed to third parties or affiliates for marketing or promotional purposes/i
      )
    ).toBeInTheDocument();
    const privacyEmailLink = screen.getByRole('link', { name: 'info@novacodetech.com' });
    expect(privacyEmailLink).toHaveAttribute('href', 'mailto:info@novacodetech.com');
    unmount();

    render(<PublicLegalPage page="terms-of-service" search="?business_id=2" />);
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(
      screen.getByText(/Carriers are not liable for delayed, failed, or undelivered SMS messages/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Message frequency varies/i)).toBeInTheDocument();
    const termsEmailLink = screen.getByRole('link', { name: 'info@novacodetech.com' });
    expect(termsEmailLink).toHaveAttribute('href', 'mailto:info@novacodetech.com');
  });

  it('enforces Supabase migration security, single-use Turnstile replay lock, and never exposes TURNSTILE_SECRET_KEY in frontend code', () => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20261115_sms_consent_a2p.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.sms_consents');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.sms_turnstile_used_tokens');
    expect(sql).toContain('p_turnstile_token_hash TEXT');
    expect(sql).toContain('TURNSTILE_REUSED');
    expect(sql).toContain('auto_send_enabled = FALSE OR a2p_status = \'approved\'');
    expect(sql).toContain('REVOKE ALL ON TABLE public.sms_consents FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.sms_turnstile_used_tokens FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain(') TO service_role;');

    // Confirm TURNSTILE_SECRET_KEY is never referenced in any non-test frontend source file
    const srcFiles = [
      'src/services/smsConsent.ts',
      'src/components/PublicSmsConsentPage.tsx',
      'src/components/PublicLegalPage.tsx',
      'src/components/PublicLayout.tsx',
      'src/App.tsx',
    ];
    for (const rel of srcFiles) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      expect(content).not.toContain('TURNSTILE_SECRET_KEY');
    }
  });
});
