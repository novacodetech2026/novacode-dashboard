/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { DashboardView } from './components/DashboardView';
import { CalendarView } from './components/CalendarView';
import { AppointmentsView } from './components/AppointmentsView';
import { CustomersView } from './components/CustomersView';
import { ServicesView } from './components/ServicesView';
import { MessagesView } from './components/MessagesView';
import { AiAssistantView } from './components/AiAssistantView';
import { SettingsView } from './components/SettingsView';
import { SuperAdminView } from './components/SuperAdminView';
import { HelpSupportView } from './components/HelpSupportView';
import { SuperAdminContextBanner } from './components/SuperAdminContextBanner';
import { AppointmentDetailDrawer } from './components/AppointmentDetailDrawer';
import { NewAppointmentModal } from './components/NewAppointmentModal';
import { AuthModal } from './components/AuthModal';
import { ToastContainer } from './components/ToastContainer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PublicSmsConsentPage } from './components/PublicSmsConsentPage';
import { PublicLegalPage } from './components/PublicLegalPage';
import { resolvePublicRoute } from './utils/publicRoutes';
import { sanitizeErrorForBusiness } from './utils/security';
import { MobileBottomNav } from './components/MobileBottomNav';
import {
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

const DashboardMain: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab, 
    isNewBookingModalOpen, 
    setIsNewBookingModalOpen, 
    isAuthModalOpen,
    setIsAuthModalOpen,
    selectedAppointmentForDetail, 
    setSelectedAppointmentForDetail,
    canViewPlatformAdmin,
    canManageBusinessSettings,
    currentTenant,
    language,
    mode,
    currentUser,
    authDiagnosticError,
    refreshAccessProfile,
    captureTechnicalIncident,
    t 
  } = useApp();

  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isRetryingRole, setIsRetryingRole] = useState(false);

  const handleRetryRoleCheck = async () => {
    setIsRetryingRole(true);
    try {
      await refreshAccessProfile();
    } finally {
      setIsRetryingRole(false);
    }
  };

  return (
    <div className="min-h-dvh lg:min-h-screen bg-[#F8FAFC] dark:bg-slate-950 text-[#0F172A] dark:text-slate-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white overflow-x-hidden">
      <div className="flex-1 flex w-full min-w-0">
        {/* Modern Collapsible Sidebar */}
        <Sidebar 
          isMobileOpen={isMobileNavOpen} 
          setIsMobileOpen={setIsMobileNavOpen}
        />

        {/* Main Viewport Container */}
        <div className="flex-1 flex flex-col min-w-0 pb-[calc(5.25rem+env(safe-area-inset-bottom))] lg:pb-0">
          {/* Top Bar Contract (1-line wordmark/breadcrumb, single-line controls, primary CTA) */}
          <TopHeader onOpenMobileMenu={() => setIsMobileNavOpen(true)} />

          {/* Prominent Super Admin Business Context & Return to Platform Administration Bar */}
          <SuperAdminContextBanner />

          {/* Diagnostic Error Banner when Super Admin RPC or Authorization Check Fails */}
          {mode === 'supabase' && currentUser && authDiagnosticError && (
            <div className="bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-900 px-4 lg:px-8 py-3">
              <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm lg:text-xs font-bold text-rose-900 dark:text-rose-200">
                      {canViewPlatformAdmin
                        ? t.auth.superAdminRpcFailedTitle
                        : t.auth.workspaceVerificationTitle}
                    </p>
                    <p className="text-sm lg:text-xs text-rose-700 dark:text-rose-300 font-mono break-words mt-0.5 leading-relaxed">
                      {canViewPlatformAdmin
                        ? authDiagnosticError
                        : sanitizeErrorForBusiness(authDiagnosticError, language).userMessage}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRetryRoleCheck}
                  disabled={isRetryingRole}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2 lg:px-3 lg:py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors shrink-0 self-start sm:self-auto"
                >
                  <RefreshCw className={`w-4 h-4 lg:w-3.5 lg:h-3.5 ${isRetryingRole ? 'animate-spin' : ''}`} />
                  <span>{t.auth.retryAuthCheck}</span>
                </button>
              </div>
            </div>
          )}

          {/* Dynamic Content Viewport */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto animate-in fade-in duration-200 min-w-0">
            <ErrorBoundary
              viewKey={activeTab}
              language={language}
              onReturnToOverview={() => setActiveTab('overview')}
              onCaptureIncident={(err, stack) =>
                captureTechnicalIncident({
                  source: 'technical_error',
                  severity: 'critical',
                  title: `View render error (${activeTab})`,
                  description: `${err.message}${stack ? `\n${stack.slice(0, 300)}` : ''}`,
                  businessId: currentTenant.id || undefined,
                  businessName: currentTenant.id ? currentTenant.name : undefined,
                })
              }
            >
              {canViewPlatformAdmin && activeTab === 'admin' && <SuperAdminView initialSection="businesses" />}
              {canViewPlatformAdmin && activeTab === 'support-center' && <SuperAdminView initialSection="support-center" />}
              {canViewPlatformAdmin && activeTab === 'incidents' && <SuperAdminView initialSection="incidents" />}
              {canViewPlatformAdmin && activeTab === 'infrastructure' && <SuperAdminView initialSection="infrastructure" />}
              {activeTab === 'overview' && <DashboardView />}
              {activeTab === 'calendar' && <CalendarView />}
              {activeTab === 'appointments' && <AppointmentsView />}
              {activeTab === 'customers' && <CustomersView />}
              {activeTab === 'services' && <ServicesView />}
              {activeTab === 'messages' && <MessagesView />}
              {activeTab === 'ai-assistant' && <AiAssistantView />}
              {activeTab === 'support' && <HelpSupportView />}
              {canManageBusinessSettings && activeTab === 'settings' && <SettingsView />}
            </ErrorBoundary>
          </main>

          <footer className="border-t border-slate-200/80 dark:border-slate-800/80 px-4 sm:px-6 lg:px-8 py-4 text-xs lg:text-[11px] text-slate-500 dark:text-slate-400">
            <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
              <span>© {new Date().getFullYear()} Novacode Tech LLC</span>
              <div className="flex items-center gap-4">
                <a
                  href="/privacy-policy"
                  onClick={e => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    window.history.pushState({}, '', '/privacy-policy');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="inline-flex items-center min-h-[44px] lg:min-h-0 px-1 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4"
                >
                  Privacy Policy
                </a>
                <a
                  href="/terms-of-service"
                  onClick={e => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    window.history.pushState({}, '', '/terms-of-service');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="inline-flex items-center min-h-[44px] lg:min-h-0 px-1 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4"
                >
                  Terms of Service
                </a>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {/* Appointment Detail Slide-Over Drawer */}
      <AppointmentDetailDrawer
        appointment={selectedAppointmentForDetail}
        onClose={() => setSelectedAppointmentForDetail(null)}
      />

      {/* 5-Step Intuitive Booking Wizard Modal */}
      <NewAppointmentModal
        isOpen={isNewBookingModalOpen}
        onClose={() => setIsNewBookingModalOpen(false)}
      />

      {/* Supabase Secure Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Toast Notification Container */}
      <ToastContainer />

      {/* Mobile Bottom Thumb Bar */}
      <MobileBottomNav />
    </div>
  );
};

export default function App() {
  const [locationState, setLocationState] = useState<{ pathname: string; search: string }>(() => ({
    pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
    search: typeof window !== 'undefined' ? window.location.search : '',
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      setLocationState({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigatePublic = useCallback((href: string) => {
    if (typeof window === 'undefined') return;
    const targetUrl = new URL(href, window.location.origin);
    window.history.pushState({}, '', `${targetUrl.pathname}${targetUrl.search}`);
    setLocationState({
      pathname: targetUrl.pathname,
      search: targetUrl.search,
    });
    window.scrollTo(0, 0);
  }, []);

  const publicRoute = resolvePublicRoute(locationState.pathname);

  if (publicRoute === 'sms-consent') {
    return (
      <PublicSmsConsentPage
        search={locationState.search}
        onNavigate={navigatePublic}
      />
    );
  }

  if (publicRoute === 'privacy-policy' || publicRoute === 'terms-of-service') {
    return (
      <PublicLegalPage
        page={publicRoute}
        search={locationState.search}
        onNavigate={navigatePublic}
      />
    );
  }

  return (
    <AppProvider>
      <DashboardMain />
    </AppProvider>
  );
}
