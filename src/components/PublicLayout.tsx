import React from 'react';
import { MessageSquare, Shield, FileText } from 'lucide-react';
import {
  PublicComplianceRoute,
  buildPublicRouteHref,
} from '../utils/publicRoutes';

interface PublicLayoutProps {
  activeRoute: PublicComplianceRoute;
  businessId?: string | null;
  slug?: string | null;
  onNavigate?: (href: string) => void;
  children: React.ReactNode;
}

export const PublicLayout: React.FC<PublicLayoutProps> = ({
  activeRoute,
  businessId,
  slug,
  onNavigate,
  children,
}) => {
  const smsHref = buildPublicRouteHref('sms-consent', { businessId, slug });
  const privacyHref = buildPublicRouteHref('privacy-policy', { businessId, slug });
  const termsHref = buildPublicRouteHref('terms-of-service', { businessId, slug });

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onNavigate) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(href);
  };

  return (
    <div className="min-h-dvh lg:min-h-screen bg-[#F8FAFC] dark:bg-slate-950 text-[#0F172A] dark:text-slate-100 flex flex-col antialiased selection:bg-indigo-600 selection:text-white">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 min-h-16 py-2 lg:py-0 lg:h-16 flex items-center justify-between gap-3 sm:gap-4">
          <a
            href={smsHref}
            onClick={(e) => handleNavClick(e, smsHref)}
            className="flex items-center gap-2.5 min-w-0 min-h-[44px] lg:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg py-1"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-semibold tracking-tight text-slate-900 dark:text-white truncate">
                Novacode Tech LLC
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                SMS Messaging Compliance
              </span>
            </div>
          </a>

          <nav aria-label="Compliance navigation" className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
            <a
              href={smsHref}
              onClick={(e) => handleNavClick(e, smsHref)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] lg:min-h-[40px] rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                activeRoute === 'sms-consent'
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800'
              }`}
            >
              <span>SMS Consent</span>
            </a>
            <a
              href={privacyHref}
              onClick={(e) => handleNavClick(e, privacyHref)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] lg:min-h-[40px] rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                activeRoute === 'privacy-policy'
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800'
              }`}
            >
              <Shield className="w-3.5 h-3.5 hidden sm:inline shrink-0" />
              <span>Privacy Policy</span>
            </a>
            <a
              href={termsHref}
              onClick={(e) => handleNavClick(e, termsHref)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] lg:min-h-[40px] rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                activeRoute === 'terms-of-service'
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5 hidden sm:inline shrink-0" />
              <span>Terms of Service</span>
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        {children}
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <p className="leading-relaxed">Powered by Novacode Tech LLC. SMS consent is optional and not a condition of purchase.</p>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 shrink-0">
            <a
              href={smsHref}
              onClick={(e) => handleNavClick(e, smsHref)}
              className="inline-flex items-center min-h-[44px] lg:min-h-0 px-1 lg:px-0 hover:text-slate-900 dark:hover:text-white underline underline-offset-4 whitespace-nowrap"
            >
              SMS Consent
            </a>
            <a
              href={privacyHref}
              onClick={(e) => handleNavClick(e, privacyHref)}
              className="inline-flex items-center min-h-[44px] lg:min-h-0 px-1 lg:px-0 hover:text-slate-900 dark:hover:text-white underline underline-offset-4 whitespace-nowrap"
            >
              Privacy Policy
            </a>
            <a
              href={termsHref}
              onClick={(e) => handleNavClick(e, termsHref)}
              className="inline-flex items-center min-h-[44px] lg:min-h-0 px-1 lg:px-0 hover:text-slate-900 dark:hover:text-white underline underline-offset-4 whitespace-nowrap"
            >
              Terms of Service
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
