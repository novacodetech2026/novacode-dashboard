import React from 'react';
import { ArrowLeft, Shield, FileText } from 'lucide-react';
import { PublicLayout } from './PublicLayout';
import {
  buildPublicRouteHref,
  parsePublicBusinessQuery,
} from '../utils/publicRoutes';
import { SMS_CONSENT_DISCLOSURE_VERSION } from '../services/smsConsent';

interface PublicLegalPageProps {
  page: 'privacy-policy' | 'terms-of-service';
  search: string;
  onNavigate?: (href: string) => void;
}

export const PublicLegalPage: React.FC<PublicLegalPageProps> = ({
  page,
  search,
  onNavigate,
}) => {
  const { businessId, slug } = parsePublicBusinessQuery(search);
  const contactEmail = (
    import.meta.env.VITE_PUBLIC_CONTACT_EMAIL || 'info@novacodetech.com'
  ).trim();
  const backToConsentHref = buildPublicRouteHref('sms-consent', { businessId, slug });
  const privacyHref = buildPublicRouteHref('privacy-policy', { businessId, slug });
  const termsHref = buildPublicRouteHref('terms-of-service', { businessId, slug });

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onNavigate) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(href);
  };

  return (
    <PublicLayout
      activeRoute={page}
      businessId={businessId}
      slug={slug}
      onNavigate={onNavigate}
    >
      <article className="max-w-3xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-10 shadow-xs space-y-6 sm:space-y-8">
        <div>
          <a
            href={backToConsentHref}
            onClick={(e) => handleLinkClick(e, backToConsentHref)}
            className="inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-0 text-sm lg:text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 mb-3 sm:mb-4"
          >
            <ArrowLeft className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
            <span>Back to SMS Consent Registration</span>
          </a>

          <div className="flex items-center gap-2.5">
            {page === 'privacy-policy' ? (
              <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            ) : (
              <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            )}
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {page === 'privacy-policy' ? 'Privacy Policy' : 'Terms of Service'}
            </h1>
          </div>

          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
            Novacode Tech LLC — SMS Messaging &amp; Platform Disclosures (Policy Version{' '}
            {SMS_CONSENT_DISCLOSURE_VERSION})
          </p>
        </div>

        {page === 'privacy-policy' ? (
          <div className="space-y-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                1. Overview &amp; Multi-Tenant Relationship
              </h2>
              <p>
                Novacode Tech LLC provides business automation, appointment scheduling, and customer
                messaging software used by independent participating businesses. When you submit an
                SMS consent form for a participating business, your consent record is scoped strictly
                to that specific business and stored securely on the Novacode Tech LLC platform on
                behalf of that business.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                2. Information Collected for SMS Consent
              </h2>
              <p>When you voluntarily complete our SMS consent registration form, we collect:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your mobile phone number (required to record and honor your SMS preference).</li>
                <li>Your name (optional, if provided by you).</li>
                <li>
                  Compliance audit details: the business identifier, timestamp of consent, disclosure
                  version, consent source (such as web form), and technical anti-abuse signals
                  (hashed IP metadata and browser user-agent string) used solely to prevent spam and
                  verify opt-in integrity.
                </li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                3. No Sharing of Mobile Opt-In Data for Marketing
              </h2>
              <p className="font-medium text-slate-900 dark:text-white">
                No mobile information, phone numbers, or SMS opt-in consent records will be shared
                with, sold to, rented to, or disclosed to third parties or affiliates for marketing
                or promotional purposes.
              </p>
              <p>
                Information collected through the SMS consent form is used strictly to document your
                explicit opt-in choice and, once the participating business&apos;s messaging
                configuration is approved and active, to deliver the conversational and
                appointment-related messages you requested. Access may be provided to telecommunications
                and cloud infrastructure subprocessors strictly as required to store consent audit
                logs, enforce security controls, and transmit authorized SMS messages.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                4. Opt-Out Rights (STOP) &amp; Assistance (HELP)
              </h2>
              <p>
                SMS consent is completely voluntary and is not a condition of purchase. You may opt
                out of SMS messages from a participating business at any time by replying{' '}
                <span className="font-semibold text-slate-900 dark:text-white">STOP</span> to any
                SMS message received, or by contacting the participating business directly. You may
                reply <span className="font-semibold text-slate-900 dark:text-white">HELP</span> for
                messaging assistance.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                5. Security &amp; Data Retention
              </h2>
              <p>
                Novacode Tech LLC enforces tenant-isolated access controls, encrypted transport, and
                server-side rate limiting so unauthorized users cannot view or query customer consent
                records. Consent audit records are retained as required to honor opt-in/opt-out
                preferences and comply with telecommunications compliance rules.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                6. Questions &amp; Requests
              </h2>
              <p>
                For questions regarding messages from a participating business, or to request updates
                or removal of your contact details, please contact that participating business directly
                using the official contact details provided by the business, or submit an inquiry
                through that business&apos;s support channel.
                {contactEmail && (
                  <>
                    {' '}
                    You may also contact Novacode Tech LLC at{' '}
                    <a
                      href={`mailto:${contactEmail}`}
                      className="text-indigo-600 dark:text-indigo-400 underline underline-offset-4"
                    >
                      {contactEmail}
                    </a>
                    .
                  </>
                )}{' '}
                Review our{' '}
                <a
                  href={termsHref}
                  onClick={(e) => handleLinkClick(e, termsHref)}
                  className="text-indigo-600 dark:text-indigo-400 underline underline-offset-4"
                >
                  Terms of Service
                </a>{' '}
                for SMS program terms.
              </p>
            </section>
          </div>
        ) : (
          <div className="space-y-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                1. SMS Program Description
              </h2>
              <p>
                By submitting the SMS consent form and checking the consent checkbox, you agree to
                receive conversational and appointment-related SMS text messages (such as appointment
                confirmations, reminders, rescheduling notices, and customer support replies) from the
                identified participating business, powered by Novacode Tech LLC.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                2. Voluntary Consent &amp; Messaging Activation
              </h2>
              <p>
                Providing SMS consent is optional and is never a condition of purchasing any goods or
                services. Submitting the consent form records your opt-in preference for the selected
                business. Outbound SMS messages are not sent automatically and will only be delivered
                once the participating business&apos;s messaging registration is approved and active.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                3. Message Frequency &amp; Carrier Charges
              </h2>
              <p>
                Message frequency varies based on your appointment activity and customer support
                conversations with the participating business. Standard message and data rates from
                your mobile wireless carrier may apply.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                4. Opt-Out (STOP) &amp; Customer Assistance (HELP)
              </h2>
              <p>
                You may cancel SMS communications at any time by replying{' '}
                <span className="font-semibold text-slate-900 dark:text-white">STOP</span> to any
                SMS message sent through the program. After sending STOP, your number will be opted
                out from further messages from that business. For assistance, reply{' '}
                <span className="font-semibold text-slate-900 dark:text-white">HELP</span> or
                contact the participating business directly using their official customer contact
                information
                {contactEmail ? (
                  <>
                    {' '}
                    or reach Novacode Tech LLC at{' '}
                    <a
                      href={`mailto:${contactEmail}`}
                      className="text-indigo-600 dark:text-indigo-400 underline underline-offset-4"
                    >
                      {contactEmail}
                    </a>
                    .
                  </>
                ) : (
                  '.'
                )}
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                5. Supported Carriers &amp; Carrier Disclaimer
              </h2>
              <p>
                Wireless carriers are not liable for delayed, failed, or undelivered SMS messages.
                Delivery depends on effective transmission by your mobile network operator and
                compatible device coverage.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                6. Acceptable Use &amp; Privacy
              </h2>
              <p>
                You agree to provide only a mobile phone number that you own or are authorized to
                register. Automated spam submissions, abuse, or registering third-party phone
                numbers without authorization is prohibited. For details on how opt-in data is
                protected and stored, review our{' '}
                <a
                  href={privacyHref}
                  onClick={(e) => handleLinkClick(e, privacyHref)}
                  className="text-indigo-600 dark:text-indigo-400 underline underline-offset-4"
                >
                  Privacy Policy
                </a>
                .
              </p>
            </section>
          </div>
        )}
      </article>
    </PublicLayout>
  );
};
