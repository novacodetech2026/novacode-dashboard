import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  Phone,
  User,
  Lock,
  Info,
  Loader2,
} from 'lucide-react';
import { PublicLayout } from './PublicLayout';
import {
  buildPublicRouteHref,
  parsePublicBusinessQuery,
} from '../utils/publicRoutes';
import {
  PublicSmsBusinessInfo,
  SMS_CONSENT_DISCLOSURE_VERSION,
  SmsConsentReceipt,
  buildSmsConsentDisclosure,
  normalizeAndValidatePhoneNumber,
  resolveSmsConsentBusiness,
  submitSmsConsentRegistration,
} from '../services/smsConsent';

interface PublicSmsConsentPageProps {
  search: string;
  onNavigate?: (href: string) => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export const PublicSmsConsentPage: React.FC<PublicSmsConsentPageProps> = ({
  search,
  onNavigate,
}) => {
  const { businessId: queryBusinessId, slug: querySlug } = parsePublicBusinessQuery(search);
  const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

  const [isLoadingBusiness, setIsLoadingBusiness] = useState(true);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<PublicSmsBusinessInfo | null>(null);
  const [availableBusinesses, setAvailableBusinesses] = useState<PublicSmsBusinessInfo[]>([]);

  const [customerName, setCustomerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [consentChecked, setConsentChecked] = useState(false); // Must remain unchecked by default
  const [honeypot, setHoneypot] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SmsConsentReceipt | null>(null);

  const formRenderedAtRef = useRef<number>(Date.now());
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    formRenderedAtRef.current = Date.now();
    setIsLoadingBusiness(true);
    setBusinessError(null);
    setReceipt(null);
    setConsentChecked(false);

    resolveSmsConsentBusiness({
      businessId: queryBusinessId,
      slug: querySlug,
    })
      .then((res) => {
        if (!active) return;
        setAvailableBusinesses(res.availableBusinesses);
        setSelectedBusiness(res.business);
        if (res.error) {
          setBusinessError(res.error);
        }
      })
      .catch(() => {
        if (!active) return;
        setBusinessError('Unable to load SMS registration details. Please refresh and try again.');
      })
      .finally(() => {
        if (active) setIsLoadingBusiness(false);
      });

    return () => {
      active = false;
    };
  }, [queryBusinessId, querySlug]);

  // Optional Cloudflare Turnstile integration when VITE_TURNSTILE_SITE_KEY is configured
  useEffect(() => {
    if (!turnstileSiteKey || !selectedBusiness || receipt) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    let cancelled = false;
    const renderWidget = () => {
      if (cancelled || !turnstileContainerRef.current || !window.turnstile) return;
      if (turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => {
          setTurnstileToken(token);
          setTurnstileError(null);
        },
        'expired-callback': () => {
          setTurnstileToken(null);
          setTurnstileError('Security verification expired. Please complete the challenge again.');
        },
        'error-callback': () => {
          setTurnstileToken(null);
          setTurnstileError('Security verification failed to load. Please retry the challenge.');
        },
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-novacode-turnstile="true"]'
      );
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.novacodeTurnstile = 'true';
        script.onload = renderWidget;
        document.head.appendChild(script);
      } else {
        existingScript.addEventListener('load', renderWidget, { once: true });
      }
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [turnstileSiteKey, selectedBusiness, receipt]);

  const effectiveBusinessId = selectedBusiness?.id || queryBusinessId;
  const effectiveSlug = selectedBusiness?.slug || querySlug;
  const privacyHref = buildPublicRouteHref('privacy-policy', {
    businessId: effectiveBusinessId,
    slug: effectiveSlug,
  });
  const termsHref = buildPublicRouteHref('terms-of-service', {
    businessId: effectiveBusinessId,
    slug: effectiveSlug,
  });

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onNavigate) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(href);
  };

  const handleSelectBusiness = (bizId: string) => {
    const found = availableBusinesses.find((b) => b.id === bizId) || null;
    setSelectedBusiness(found);
    setBusinessError(null);
    setFormError(null);
    setConsentChecked(false);
    setReceipt(null);
    if (found && onNavigate) {
      onNavigate(buildPublicRouteHref('sms-consent', { businessId: found.id }));
    }
  };

  const handlePhoneBlur = () => {
    if (!phoneNumber.trim()) {
      setPhoneError(null);
      return;
    }
    const validation = normalizeAndValidatePhoneNumber(phoneNumber);
    setPhoneError(validation.valid ? null : validation.error || 'Invalid phone number.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !selectedBusiness) return;

    setFormError(null);
    setPhoneError(null);
    setConsentError(null);

    const phoneValidation = normalizeAndValidatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      setPhoneError(phoneValidation.error || 'Please enter a valid phone number.');
    }

    if (!consentChecked) {
      setConsentError('Please check the consent box to confirm you agree to receive SMS messages.');
    }

    if (!phoneValidation.valid || !consentChecked) {
      return;
    }

    if (turnstileSiteKey && !turnstileToken) {
      setTurnstileError('Please complete the verification challenge before submitting.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitSmsConsentRegistration({
        businessId: selectedBusiness.id,
        businessName: selectedBusiness.name,
        customerName: customerName.trim() || undefined,
        phoneNumber,
        consentChecked,
        consentSource: 'web_form',
        honeypot,
        formRenderedAtMs: formRenderedAtRef.current,
        turnstileToken,
      });

      if (!result.success || !result.receipt) {
        setFormError(result.error || 'Unable to save your SMS consent registration.');
        setTurnstileToken(null);
        if (turnstileWidgetIdRef.current && window.turnstile) {
          window.turnstile.reset(turnstileWidgetIdRef.current);
        }
        return;
      }

      // Clear single-use token from client memory immediately upon acceptance
      setTurnstileToken(null);
      setReceipt(result.receipt);
    } catch {
      setFormError('An unexpected error occurred while saving your consent. Please try again.');
      setTurnstileToken(null);
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterAnother = () => {
    setReceipt(null);
    setCustomerName('');
    setPhoneNumber('');
    setConsentChecked(false);
    setTurnstileToken(null);
    setTurnstileError(null);
    setFormError(null);
    setPhoneError(null);
    setConsentError(null);
    formRenderedAtRef.current = Date.now();
  };

  const disclosureText = selectedBusiness
    ? buildSmsConsentDisclosure(selectedBusiness.name)
    : buildSmsConsentDisclosure('Participating Business');

  return (
    <PublicLayout
      activeRoute="sms-consent"
      businessId={effectiveBusinessId}
      slug={effectiveSlug}
      onNavigate={onNavigate}
    >
      <div className="max-w-xl mx-auto">
        {isLoadingBusiness ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center gap-3 shadow-xs">
            <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Loading SMS registration details...
            </p>
          </div>
        ) : businessError && !selectedBusiness ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 shadow-xs">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
                  SMS Consent Registration Unavailable
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{businessError}</p>
              </div>
            </div>
          </div>
        ) : !selectedBusiness && availableBusinesses.length > 1 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 shadow-xs space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
                Select Business for SMS Registration
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                Choose the business you wish to opt in to for conversational and appointment-related SMS messages.
              </p>
            </div>
            <div className="space-y-2">
              {availableBusinesses.map((biz) => (
                <button
                  key={biz.id}
                  type="button"
                  onClick={() => handleSelectBusiness(biz.id)}
                  className="w-full min-h-[48px] px-4 py-3 text-left rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 transition-colors flex items-center justify-between gap-3"
                >
                  <span className="font-medium text-slate-900 dark:text-white truncate">{biz.name}</span>
                  <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 shrink-0">
                    Continue
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : receipt ? (
          <section
            aria-labelledby="sms-consent-confirmed-heading"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 shadow-xs space-y-5 sm:space-y-6"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1
                  id="sms-consent-confirmed-heading"
                  className="text-xl font-semibold text-slate-900 dark:text-white"
                >
                  SMS Consent Recorded
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  Your messaging preference for{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {receipt.businessName}
                  </span>{' '}
                  has been saved.
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 p-4 text-sm">
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Business</dt>
                <dd className="font-medium text-slate-900 dark:text-white mt-0.5">
                  {receipt.businessName}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Phone Number</dt>
                <dd className="font-mono text-slate-900 dark:text-white mt-0.5">
                  {receipt.phoneNumber}
                </dd>
              </div>
              {receipt.customerName && (
                <div>
                  <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Name</dt>
                  <dd className="text-slate-900 dark:text-white mt-0.5">{receipt.customerName}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Consent Timestamp
                </dt>
                <dd className="text-slate-900 dark:text-white mt-0.5">
                  {new Date(receipt.consentTimestamp).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Disclosure Version
                </dt>
                <dd className="font-mono text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                  {receipt.consentDisclosureVersion}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Consent Source
                </dt>
                <dd className="font-mono text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                  {receipt.consentSource}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Confirmation Reference
                </dt>
                <dd className="font-mono text-xs text-slate-700 dark:text-slate-300 break-all mt-0.5">
                  {receipt.consentId}
                </dd>
              </div>
            </dl>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
              <p>
                {receipt.messagingApproved
                  ? 'You can reply STOP at any time to opt out or HELP for assistance.'
                  : 'Your opt-in consent is safely stored. Automated SMS messages remain inactive until this business completes messaging activation approval.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={handleRegisterAnother}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Register another phone number
              </button>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <a
                  href={privacyHref}
                  onClick={(e) => handleLinkClick(e, privacyHref)}
                  className="inline-flex items-center min-h-[44px] lg:min-h-0 underline underline-offset-4 hover:text-slate-900 dark:hover:text-white"
                >
                  Privacy Policy
                </a>
                <a
                  href={termsHref}
                  onClick={(e) => handleLinkClick(e, termsHref)}
                  className="inline-flex items-center min-h-[44px] lg:min-h-0 underline underline-offset-4 hover:text-slate-900 dark:hover:text-white"
                >
                  Terms of Service
                </a>
              </div>
            </div>
          </section>
        ) : (
          selectedBusiness && (
            <section
              aria-labelledby="sms-consent-heading"
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 shadow-xs space-y-5 sm:space-y-6"
            >
              {/* Business Identification Header */}
              <div className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-4 sm:pb-5">
                <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  <Building2 className="w-4 h-4 shrink-0" />
                  <span>SMS Messaging Registration</span>
                </div>
                <h1
                  id="sms-consent-heading"
                  className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white"
                >
                  {selectedBusiness.name}
                </h1>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Opt in to receive conversational and appointment-related SMS updates from{' '}
                  <span className="font-medium text-slate-900 dark:text-white">
                    {selectedBusiness.name}
                  </span>
                  , powered by Novacode Tech LLC.
                </p>
                {availableBusinesses.length > 1 && !queryBusinessId && !querySlug && (
                  <div className="pt-2">
                    <label
                      htmlFor="business-switcher"
                      className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
                    >
                      Participating Business
                    </label>
                    <select
                      id="business-switcher"
                      value={selectedBusiness.id}
                      onChange={(e) => handleSelectBusiness(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base lg:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {availableBusinesses.map((biz) => (
                        <option key={biz.id} value={biz.id}>
                          {biz.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {!selectedBusiness.messagingApproved && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3.5 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                  <Info className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                  <p>
                    Consent preferences are recorded securely now. Outbound SMS messages are only
                    sent once this business&apos;s messaging configuration is approved and active.
                  </p>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 p-3.5 flex items-start gap-2.5 text-sm text-rose-800 dark:text-rose-200"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                {/* Honeypot anti-bot trap (hidden from legitimate users & screen readers) */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '-9999px',
                    width: '1px',
                    height: '1px',
                    overflow: 'hidden',
                  }}
                >
                  <label htmlFor="sms-company-website">Website</label>
                  <input
                    id="sms-company-website"
                    name="companyWebsite"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                {/* Optional Customer Name */}
                <div>
                  <label
                    htmlFor="sms-customer-name"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                  >
                    Customer Name{' '}
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                      (optional)
                    </span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="sms-customer-name"
                      name="customerName"
                      type="text"
                      maxLength={120}
                      autoComplete="name"
                      placeholder="Your full name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base lg:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Required Phone Number */}
                <div>
                  <label
                    htmlFor="sms-phone-number"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                  >
                    Mobile Phone Number <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="sms-phone-number"
                      name="phoneNumber"
                      type="tel"
                      required
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+1 (555) 234-5678"
                      value={phoneNumber}
                      onChange={(e) => {
                        setPhoneNumber(e.target.value);
                        if (phoneError) setPhoneError(null);
                      }}
                      onBlur={handlePhoneBlur}
                      aria-invalid={Boolean(phoneError)}
                      aria-describedby={phoneError ? 'sms-phone-error' : 'sms-phone-help'}
                      className={`w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl border bg-white dark:bg-slate-950 text-base lg:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                        phoneError
                          ? 'border-rose-500 focus:ring-rose-500 focus:border-rose-500'
                          : 'border-slate-300 dark:border-slate-700 focus:ring-indigo-500 focus:border-indigo-500'
                      }`}
                    />
                  </div>
                  {phoneError ? (
                    <p id="sms-phone-error" role="alert" className="text-xs text-rose-600 dark:text-rose-400 mt-1.5">
                      {phoneError}
                    </p>
                  ) : (
                    <p id="sms-phone-help" className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                      Enter a valid 10-digit US/Canada number or international number with country code.
                    </p>
                  )}
                </div>

                {/* Explicit SMS Consent Checkbox & Verbatim A2P 10DLC Disclosure */}
                <div
                  className={`rounded-xl border p-4 transition-colors ${
                    consentError
                      ? 'border-rose-400 bg-rose-50/40 dark:border-rose-800 dark:bg-rose-950/30'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40'
                  }`}
                >
                  <label
                    htmlFor="sms-consent-checkbox"
                    className="flex items-start gap-3 min-h-[44px] cursor-pointer"
                  >
                    <input
                      id="sms-consent-checkbox"
                      name="smsConsent"
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(e) => {
                        setConsentChecked(e.target.checked);
                        if (e.target.checked && consentError) setConsentError(null);
                      }}
                      aria-invalid={Boolean(consentError)}
                      aria-describedby={consentError ? 'sms-consent-error' : undefined}
                      className="mt-0.5 h-5 w-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 shrink-0 cursor-pointer"
                    />
                    <span className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                      {disclosureText}
                    </span>
                  </label>
                  {consentError && (
                    <p id="sms-consent-error" role="alert" className="text-xs text-rose-600 dark:text-rose-400 mt-2 pl-8">
                      {consentError}
                    </p>
                  )}
                </div>

                {/* Cloudflare Turnstile CAPTCHA container */}
                {turnstileSiteKey && (
                  <div className="space-y-1.5">
                    <div
                      ref={turnstileContainerRef}
                      data-testid="turnstile-widget-container"
                      className="min-h-[65px]"
                    />
                    {turnstileError && (
                      <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                        {turnstileError}
                      </p>
                    )}
                  </div>
                )}

                {/* Legal Links */}
                <p className="text-xs sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Review our{' '}
                  <a
                    href={privacyHref}
                    onClick={(e) => handleLinkClick(e, privacyHref)}
                    className="inline-flex items-center min-h-[44px] sm:min-h-0 font-medium text-indigo-600 dark:text-indigo-400 underline underline-offset-4 hover:text-indigo-700"
                  >
                    Privacy Policy
                  </a>{' '}
                  and{' '}
                  <a
                    href={termsHref}
                    onClick={(e) => handleLinkClick(e, termsHref)}
                    className="inline-flex items-center min-h-[44px] sm:min-h-0 font-medium text-indigo-600 dark:text-indigo-400 underline underline-offset-4 hover:text-indigo-700"
                  >
                    Terms of Service
                  </a>{' '}
                  for full details on SMS data handling, opt-out rights, and carrier terms.
                </p>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full min-h-[46px] px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-xs transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting Consent...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>Submit SMS Consent</span>
                    </>
                  )}
                </button>

                <p className="text-xs lg:text-[11px] text-center text-slate-400 dark:text-slate-500">
                  Disclosure version {selectedBusiness.disclosureVersion || SMS_CONSENT_DISCLOSURE_VERSION}
                </p>
              </form>
            </section>
          )
        )}
      </div>
    </PublicLayout>
  );
};
