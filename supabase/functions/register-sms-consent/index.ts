// Supabase Edge Function: register-sms-consent
// Deploy with: supabase functions deploy register-sms-consent --no-verify-jwt
//
// Required server-side secrets (NEVER expose in VITE_ vars, client code, logs, or responses):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   TURNSTILE_SECRET_KEY          (Cloudflare Turnstile Secret Key)
//
// Optional server-side secrets:
//   SMS_CONSENT_HASH_SALT         (Random secret string used to hash IPs & Turnstile tokens)
//   TURNSTILE_ALLOWED_HOSTNAMES   (Comma-separated allowlist of hostnames if strict host pinning is desired)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleRegisterSmsConsentRequest } from './handler.ts';

Deno.serve((req: Request) =>
  handleRegisterSmsConsentRequest(req, {
    getEnv: (name: string) => Deno.env.get(name),
    createAdminClient: (url: string, serviceRoleKey: string) =>
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as any,
  })
);
