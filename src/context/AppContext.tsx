import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { 
  Language, 
  Tenant, 
  Customer, 
  Service, 
  Staff, 
  Appointment, 
  Conversation, 
  ChatMessage, 
  IntegrationStatus, 
  SupabaseConfig, 
  ToastMessage,
  AppointmentStatus,
  DataSourceMode,
  SupabaseUser,
  BusinessMember,
  PlatformRole,
  AuditLogEntry,
  BusinessInvitation,
  InviteOwnerResult,
  PlatformMetrics,
  BusinessNotification,
  SupportIncident,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketMessage,
  SupportTicketStatusHistoryEntry,
  SupportNotification,
  IncidentStatus,
  BusinessOwnerSummary,
  BusinessCommunicationChannels,
  BookingNotificationHealth,
  N8nIntegrationHealth,
  A2pApprovalStatus,
  BusinessMessagingConfig,
  BusinessSmsConsentSummary,
  BusinessHours,
  SpecialBusinessHours,
  LocationType,
  AiAssistantSettings,
} from '../types';
import { getCategoryOption, normalizeCategoryId } from '../data/businessCategories';
import { getCurrencySymbol, normalizeCurrencyCode } from '../utils/currency';
import { isValidIanaTimezone } from '../utils/timezone';
import { translations, TranslationSchema } from '../i18n/translations';
import { CORPORATE_PLATFORM_SHELL } from '../data/branding';
import { 
  SEED_TENANTS, 
  SEED_SERVICES, 
  SEED_STAFF, 
  SEED_CUSTOMERS, 
  SEED_APPOINTMENTS, 
  SEED_CONVERSATIONS, 
  SEED_MESSAGES, 
  INITIAL_INTEGRATION_STATUS 
} from '../data/seedData';
import { 
  getSupabaseClient,
  resetSupabaseClient,
  testSupabaseConnection,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  signOutUser,
  getCurrentSupabaseSession,
  onSupabaseAuthStateChange,
  sendPasswordResetEmail,
  updateUserPassword,
  isRecoveryUrl,
  processRecoveryUrlSession,
  isInvitationUrl,
  getInvitationUrlParams,
  processInvitationUrlSession,
  acceptBusinessInvitationInSupabase,
  fetchBusinessInvitationsInSupabase,
  invokeInviteOwnerEdgeFunction,
  normalizeSupabaseUrl,
  fetchUserAccessProfile,
  fetchBusinessMembersForTenant,
  assignBusinessMemberInSupabase,
  removeBusinessMemberInSupabase,
  createBusinessAsSuperAdminInSupabase,
  updateBusinessSettingsInSupabase,
  updateBusinessProfileInSupabase,
  saveWeeklyBusinessHoursInSupabase,
  sanitizeSpecialHoursPayload,
  normalizeLocationTypesList,
  toggleBusinessActiveInSupabase,
  createServiceInSupabase,
  updateServiceInSupabase,
  updateCustomerNotesInSupabase,
  recordAdminAuditLogInSupabase,
  toDbId,
  fetchRecentAuditLogs,
  fetchLiveAppointmentsWithStatus,
  fetchLiveCustomersWithStatus,
  fetchLiveServicesWithStatus,
  fetchActiveServicesCountInSupabase,
  fetchPlatformAggregateMetricsInSupabase,
  fetchPlatformIncidentsInSupabase,
  fetchPlatformIncidentByIdInSupabase,
  reportSupportIncidentInSupabase,
  updatePlatformIncidentStatusInSupabase,
  fetchSupportTicketsInSupabase,
  fetchSupportTicketByIdInSupabase,
  createSupportTicketInSupabase,
  fetchSupportTicketMessagesInSupabase,
  fetchSupportTicketStatusHistoryInSupabase,
  sendSupportTicketMessageInSupabase,
  updateSupportTicketStatusInSupabase,
  markSupportTicketReadInSupabase,
  fetchSupportNotificationsInSupabase,
  markSupportNotificationReadByIdInSupabase,
  markSupportNotificationsReadInSupabase,
  createCustomerInSupabase,
  createBookingWithSupabase,
  cancelAppointmentInSupabase,
  updateAppointmentStatusInSupabase,
  rescheduleAppointmentInSupabase,
  buildIsoTimestampInTimezone,
  fetchAppointmentByIdInSupabase,
  fetchBookingNotificationsInSupabase,
  markBookingNotificationReadInSupabase,
  markAllBookingNotificationsReadInSupabase,
  subscribeToAppointmentsRealtime,
  subscribeToBookingNotificationsRealtime,
  subscribeToPlatformAppointmentsCountRealtime,
  subscribeToSupportSystemRealtime,
  RealtimeAppointmentChange,
  unsubscribeRealtimeChannel,
  removeAllRealtimeChannels,
  verifyCurrentUserIsSuperAdmin,
  checkAvailabilityInSupabase,
  fetchPlatformBusinessOwnersInSupabase,
  fetchBookingNotificationHealthInSupabase,
  triggerBookingNotificationRecoveryInSupabase,
  checkN8nIntegrationHealthInSupabase,
  fetchPlatformMessagingConfigsInSupabase,
  fetchPlatformSmsConsentSummariesInSupabase,
  updateBusinessMessagingConfigInSupabase,
  updateBusinessCommunicationChannelsInSupabase,
} from '../services/supabase';
import {
  BusinessErrorCategory,
  canAccessTab,
  isPrivilegedServiceRoleKey,
  resolveTabFromPathname,
  sanitizeErrorForBusiness,
  validateSupportTicketInput,
} from '../utils/security';
import {
  parseTimeToMinutes,
  formatMinutesToTime,
  extractDateAndTimeInTimezone,
  getAppointmentDurationMinutes,
} from '../utils/dateTime';
import {
  validateBookingWindow,
  validateCancellationWindow,
  formatBookingValidationError,
  formatCancellationValidationError,
} from '../utils/scheduling';
import { isPublicComplianceRoute } from '../utils/publicRoutes';

interface AppContextType {
  // Localization & Theme
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationSchema;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Data Mode (Demo vs Live Supabase)
  mode: DataSourceMode;
  setMode: (mode: DataSourceMode) => void;
  toggleMode: () => void;

  // Supabase Auth & Session & Recovery
  currentUser: SupabaseUser | null;
  authSession: any | null;
  isAuthLoading: boolean;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  isPasswordRecoveryMode: boolean;
  setIsPasswordRecoveryMode: (val: boolean) => void;
  recoveryError: string | null;
  setRecoveryError: (err: string | null) => void;
  isInvitationOnboardingMode: boolean;
  setIsInvitationOnboardingMode: (val: boolean) => void;
  invitationError: string | null;
  setInvitationError: (err: string | null) => void;
  hasNoBusinessMembership: boolean;
  authDiagnosticError: string | null;
  isSuperAdminCheckFailed: boolean;
  effectiveRole: PlatformRole;
  isSuperAdmin: boolean;
  canManageBusinessSettings: boolean;
  canManageServices: boolean;
  canManageStaff: boolean;
  canViewPlatformAdmin: boolean;
  refreshAccessProfile: () => Promise<void>;
  loginWithSupabase: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signupWithSupabase: (email: string, password: string, businessName?: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  completePasswordReset: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  completeInvitationOnboarding: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;

  // Multi-Tenant & RBAC Admin Management
  currentTenant: Tenant;
  availableTenants: Tenant[];
  setCurrentTenantId: (tenantId: string) => void;
  updateTenantSettings: (updatedTenant: Tenant) => Promise<void>;
  saveBusinessProfile: (input: {
    name: string;
    category: string;
    categoryLabelEn: string;
    categoryLabelEs: string;
    customCategoryName?: string;
    tagline?: string;
    description?: string;
    logo?: string;
    phone: string;
    email: string;
    address: string;
    website: string;
    instagram?: string;
    timezone: string;
    currency: string;
    locationTypes: LocationType[];
    bookingInstructions: string;
  }) => Promise<{ success: boolean; error?: string }>;
  saveWeeklyBusinessHours: (
    nextHours: Record<number, BusinessHours>
  ) => Promise<{ success: boolean; error?: string }>;
  saveSpecialHours: (
    nextSpecialHours: SpecialBusinessHours[]
  ) => Promise<{ success: boolean; error?: string }>;
  saveBookingPolicies: (input: {
    bufferBetweenAppointmentsMinutes: number;
    cancellationBufferHours: number;
    bookingInstructions: string;
    locationTypes: LocationType[];
    defaultLanguage?: Language;
    aiAssistant?: AiAssistantSettings;
  }) => Promise<{ success: boolean; error?: string }>;
  liveMembers: BusinessMember[];
  reloadBusinessMembers: (businessId?: string) => Promise<void>;
  businessInvitations: BusinessInvitation[];
  reloadBusinessInvitations: (businessId?: string) => Promise<void>;
  auditLogs: AuditLogEntry[];
  reloadAuditLogs: (businessId?: string) => Promise<void>;
  createBusinessAsSuperAdmin: (input: { name: string; category?: string; categoryLabelEn?: string; categoryLabelEs?: string; customCategoryName?: string; timezone?: string; defaultLanguage?: 'en' | 'es'; phone?: string; email?: string; address?: string; tagline?: string; description?: string; logo?: string; ownerEmail?: string; ownerRole?: 'owner' | 'admin' | 'manager' | 'staff' }) => Promise<{ success: boolean; businessId?: string; inviteResult?: InviteOwnerResult; error?: string }>;
  toggleBusinessActive: (businessId: string, nextActive: boolean) => Promise<{ success: boolean; error?: string }>;
  inviteBusinessOwner: (input: { businessId: string; email: string; role: 'owner' | 'admin' | 'manager' | 'staff' }) => Promise<InviteOwnerResult>;
  assignExistingUserToBusiness: (input: { businessId: string; email: string; role: 'owner' | 'admin' | 'manager' | 'staff' }) => Promise<InviteOwnerResult>;
  resendBusinessInvitation: (invitationId: string, filterBusinessId?: string) => Promise<InviteOwnerResult>;
  revokeBusinessInvitation: (invitationId: string, filterBusinessId?: string) => Promise<InviteOwnerResult>;
  assignBusinessMember: (businessId: string, email: string, role: 'owner' | 'admin' | 'manager' | 'staff') => Promise<{ success: boolean; error?: string }>;
  removeBusinessMember: (businessId: string, targetUserId: string) => Promise<{ success: boolean; error?: string }>;

  // Platform Metrics, Incidents & Role-Separated Notifications
  platformMetrics: PlatformMetrics;
  reloadPlatformMetrics: () => Promise<void>;
  businessOwnersByBizId: Record<string, BusinessOwnerSummary[]>;
  reloadBusinessOwners: () => Promise<void>;
  bookingNotificationHealth: BookingNotificationHealth;
  reloadBookingNotificationHealth: () => Promise<void>;
  triggerBookingNotificationRecovery: () => Promise<{
    success: boolean;
    requiresBackendWorker?: boolean;
    recoveredCount?: number;
    rescheduledCount?: number;
    abandonedCount?: number;
    message?: string;
    error?: string;
  }>;
  n8nIntegrationHealth: N8nIntegrationHealth;
  reloadN8nIntegrationHealth: () => Promise<void>;
  messagingConfigsByBizId: Record<string, BusinessMessagingConfig>;
  smsConsentSummariesByBizId: Record<string, BusinessSmsConsentSummary>;
  smsTablesStatus: { configsTableExists: boolean; consentsTableExists: boolean };
  reloadSmsA2pOverview: () => Promise<void>;
  updateBusinessMessagingConfig: (input: {
    businessId: string;
    a2pStatus: A2pApprovalStatus;
    smsOptInEnabled: boolean;
    autoSendEnabled: boolean;
    consentDisclosureVersion: string;
    campaignSid?: string;
    messagingServiceSid?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  updateBusinessCommunicationChannels: (
    businessId: string,
    nextChannels: BusinessCommunicationChannels
  ) => Promise<{ success: boolean; error?: string }>;
  platformIncidents: SupportIncident[];
  capturedTechnicalIncidents: SupportIncident[];
  captureTechnicalIncident: (input: {
    source?: SupportIncident['source'];
    severity?: SupportIncident['severity'];
    title: string;
    description: string;
    errorCode?: string;
    businessId?: string;
    businessName?: string;
  }) => void;
  incidentsTableExists: boolean;
  platformIncidentsTotalCount: number;
  hasMorePlatformIncidents: boolean;
  isLoadingMorePlatformIncidents: boolean;
  reloadPlatformIncidents: () => Promise<void>;
  loadMorePlatformIncidents: () => Promise<void>;
  updatePlatformIncidentStatus: (
    incidentId: string,
    status: IncidentStatus
  ) => Promise<{ success: boolean; error?: string }>;
  fetchAndSelectIncident: (incidentId: string) => Promise<SupportIncident | null>;
  activeServicesCount: number;
  businessNotifications: BusinessNotification[];
  markBusinessNotificationsRead: () => void;
  markSingleBusinessNotificationRead: (notificationId: string) => Promise<void>;
  openAppointmentFromNotification: (notification: BusinessNotification) => Promise<void>;
  clearBusinessNotification: (id: string) => void;

  // Business Help & Support Tickets (2-Way Business <-> Super Admin)
  supportTickets: SupportTicket[];
  supportMessagesByTicket: Record<string, SupportTicketMessage[]>;
  supportStatusHistoryByTicket: Record<string, SupportTicketStatusHistoryEntry[]>;
  supportTicketsTableExists: boolean;
  isLoadingSupportTickets: boolean;
  supportTicketsTotalCount: number;
  hasMoreSupportTickets: boolean;
  isLoadingMoreSupportTickets: boolean;
  reloadSupportTickets: () => Promise<void>;
  loadMoreSupportTickets: () => Promise<void>;
  createSupportTicket: (input: {
    category: SupportTicketCategory;
    subject: string;
    description: string;
    priority: SupportTicketPriority;
  }) => Promise<{ success: boolean; ticket?: SupportTicket; error?: string }>;
  loadTicketMessages: (ticketId: string) => Promise<SupportTicketMessage[]>;
  loadTicketStatusHistory: (ticketId: string) => Promise<SupportTicketStatusHistoryEntry[]>;
  fetchAndSelectTicket: (ticketId: string) => Promise<SupportTicket | null>;
  sendTicketReply: (
    ticketId: string,
    businessId: string,
    message: string
  ) => Promise<{ success: boolean; messageRecord?: SupportTicketMessage; error?: string }>;
  updateTicketStatus: (
    ticketId: string,
    status: SupportTicketStatus
  ) => Promise<{ success: boolean; error?: string }>;
  markTicketRead: (ticketId: string) => Promise<void>;
  supportNotifications: SupportNotification[];
  markSingleSupportNotificationRead: (notificationId: string) => Promise<void>;
  markSupportNotificationsRead: () => Promise<void>;
  pendingAdminTicketId: string | null;
  setPendingAdminTicketId: (id: string | null) => void;
  pendingAdminIncidentId: string | null;
  setPendingAdminIncidentId: (id: string | null) => void;

  // Data Collections (Scoped to current tenant)
  customers: Customer[];
  services: Service[];
  staff: Staff[];
  appointments: Appointment[];
  conversations: Conversation[];
  chatMessages: Record<string, ChatMessage[]>;
  isLoadingLiveData: boolean;
  liveDataError: string | null;
  liveDataErrorType: BusinessErrorCategory | null;
  reloadLiveAppointments: () => Promise<void>;

  // Operations
  addAppointment: (appData: Omit<Appointment, 'id' | 'createdAt' | 'tenantId'>) => Promise<{ success: boolean; error?: string; appointment?: Appointment }>;
  updateAppointmentStatus: (appointmentId: string, status: AppointmentStatus) => Promise<void>;
  rescheduleAppointment: (appointmentId: string, newDate: string, newStartTime: string) => Promise<{ success: boolean; error?: string }>;
  cancelAppointment: (appointmentId: string) => Promise<{ success: boolean; error?: string }>;
  addCustomer: (custData: Omit<Customer, 'id' | 'createdAt' | 'tenantId' | 'totalAppointments' | 'lastInteractionAt'>) => Promise<Customer>;
  updateCustomerNotes: (customerId: string, notes: string) => Promise<void>;
  addService: (svcData: Omit<Service, 'id' | 'tenantId'>) => Promise<{ success: boolean; error?: string }>;
  updateService: (service: Service) => Promise<{ success: boolean; error?: string }>;
  isBookingConflict: (date: string, startTime: string, durationMinutes: number, staffId?: string, excludeAppointmentId?: string) => boolean;

  // Conversations & AI
  takeOverConversation: (conversationId: string) => void;
  returnConversationToAi: (conversationId: string) => void;
  sendChatMessage: (conversationId: string, content: string, sender: 'customer' | 'ai' | 'staff') => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;

  // Integrations & Supabase Configuration
  integrationStatus: IntegrationStatus;
  supabaseConfig: SupabaseConfig;
  updateSupabaseConfig: (url: string, anonKey: string) => Promise<{ success: boolean; message: string }>;
  disconnectSupabase: () => void;

  // Toasts
  toasts: ToastMessage[];
  addToast: (type: ToastMessage['type'], title: string, message: string) => void;
  removeToast: (id: string) => void;

  // Navigation & UI States
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  isNewBookingModalOpen: boolean;
  setIsNewBookingModalOpen: (open: boolean) => void;
  selectedAppointmentForDetail: Appointment | null;
  setSelectedAppointmentForDetail: (app: Appointment | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 1. Language Resolution Hierarchy
  // Priority: 1. User preference -> 2. Business default -> 3. Browser language -> 4. English fallback
  const [userLangPref, setUserLangPref] = useState<Language | null>(() => {
    const saved = localStorage.getItem('novacode_user_lang');
    return (saved === 'en' || saved === 'es') ? saved : null;
  });

  // 2. Data Source Mode: 'demo' vs 'supabase'
  const [mode, setModeState] = useState<DataSourceMode>(() => {
    const saved = localStorage.getItem('novacode_mode');
    if (saved === 'demo' || saved === 'supabase') return saved;
    // If Supabase URL is present, default to supabase mode
    if (import.meta.env.VITE_SUPABASE_URL) return 'supabase';
    return 'demo';
  });
  const modeRef = useRef<DataSourceMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // 3. Supabase Auth & Password Recovery State
  const [authSession, setAuthSession] = useState<any | null>(null);
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
  const currentUserRef = useRef<SupabaseUser | null>(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isPasswordRecoveryMode, setIsPasswordRecoveryMode] = useState<boolean>(() => isRecoveryUrl());
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [isInvitationOnboardingMode, setIsInvitationOnboardingMode] = useState<boolean>(() => isInvitationUrl());
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const invitationContextRef = useRef<{ businessId?: string; token?: string }>(getInvitationUrlParams());
  const [hasNoBusinessMembership, setHasNoBusinessMembership] = useState<boolean>(false);
  const [authDiagnosticError, setAuthDiagnosticError] = useState<string | null>(null);
  const [isSuperAdminCheckFailed, setIsSuperAdminCheckFailed] = useState<boolean>(false);
  const isSuperAdminCheckFailedRef = useRef<boolean>(isSuperAdminCheckFailed);
  useEffect(() => {
    isSuperAdminCheckFailedRef.current = isSuperAdminCheckFailed;
  }, [isSuperAdminCheckFailed]);

  const setMode = (newMode: DataSourceMode) => {
    if (
      modeRef.current === 'supabase' &&
      currentUserRef.current &&
      !currentUserRef.current.isSuperAdmin &&
      newMode === 'demo'
    ) {
      return;
    }
    modeRef.current = newMode;
    setModeState(newMode);
    localStorage.setItem('novacode_mode', newMode);
    if (newMode === 'supabase') {
      getCurrentSupabaseSession()
        .then(async ({ session, user }) => {
          if (session && user) {
            setAuthSession(session);
            const access = await applyAuthenticatedUser(user);
            if (access.isSuperAdmin && activeTabRef.current === 'overview') {
              setActiveTabState('admin');
            }
          }
        })
        .catch(() => {});
    }
  };

  const toggleMode = () => {
    const next = mode === 'demo' ? 'supabase' : 'demo';
    setMode(next);
  };

  // 4. Supabase Connection Configuration (Always normalize to base project origin without /auth/v1)
  const [supabaseConfig, setSupabaseConfig] = useState<SupabaseConfig>(() => {
    const saved = localStorage.getItem('novacode_supabase_config');
    const rawEnvUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const envNorm = normalizeSupabaseUrl(rawEnvUrl);
    const envUrl = envNorm.isValid ? envNorm.url : '';
    const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const savedNorm = normalizeSupabaseUrl(parsed.url || '');
        const cleanSavedUrl = savedNorm.isValid ? savedNorm.url : '';
        return {
          url: cleanSavedUrl || envUrl,
          anonKey: parsed.anonKey || envKey,
          isConnected: parsed.isConnected ?? Boolean((cleanSavedUrl || envUrl) && (parsed.anonKey || envKey)),
          lastTestedAt: parsed.lastTestedAt,
        };
      } catch {
        // Fall through to env config
      }
    }
    return {
      url: envUrl,
      anonKey: envKey,
      isConnected: Boolean(envUrl && envKey),
    };
  });

  // 5. Tenants & Current Active Business (Demo vs Live)
  const [tenants, setTenants] = useState<Tenant[]>(() => {
    const saved = localStorage.getItem('novacode_tenants');
    return saved ? JSON.parse(saved) : SEED_TENANTS;
  });

  const [liveTenants, setLiveTenants] = useState<Tenant[]>([]);
  const liveTenantsRef = useRef<Tenant[]>(liveTenants);
  useEffect(() => {
    liveTenantsRef.current = liveTenants;
  }, [liveTenants]);

  const [currentTenantId, setCurrentTenantIdState] = useState<string>(() => {
    return localStorage.getItem('novacode_current_tenant_id') || 'tenant-serenity';
  });

  const availableTenants = useMemo(() => {
    if (mode === 'supabase') {
      return liveTenants;
    }
    return tenants;
  }, [mode, liveTenants, tenants]);

  const currentTenant = useMemo(() => {
    if (mode === 'supabase') {
      if (liveTenants.length > 0) {
        return liveTenants.find(t => t.id === currentTenantId) || liveTenants[0];
      }
      // Safe isolated corporate shell when unauthenticated or lacking business membership in live mode
      return CORPORATE_PLATFORM_SHELL;
    }
    return tenants.find(t => t.id === currentTenantId) || tenants[0] || SEED_TENANTS[0];
  }, [mode, liveTenants, tenants, currentTenantId]);

  // Derived Role & Access Control (Never inferred from email or elevated automatically)
  const isSuperAdmin = useMemo(() => {
    return mode === 'supabase' && !isSuperAdminCheckFailed && Boolean(currentUser?.isSuperAdmin);
  }, [mode, isSuperAdminCheckFailed, currentUser]);

  const effectiveRole: PlatformRole = useMemo(() => {
    if (mode !== 'supabase') {
      return 'owner'; // Sandbox preview mode
    }
    if (!currentUser) return 'none';
    if (isSuperAdminCheckFailed) {
      return 'none';
    }
    if (currentUser.isSuperAdmin || currentUser.platformRole === 'super_admin') {
      return 'super_admin';
    }

    const activeMembership = currentTenant.id
      ? currentUser.businessMemberships.find(m => m.businessId === currentTenant.id)
      : currentUser.businessMemberships[0];

    if (!activeMembership) return 'none';
    if (activeMembership.role === 'owner' || activeMembership.role === 'admin') {
      return 'owner';
    }
    return 'staff';
  }, [mode, currentUser, isSuperAdminCheckFailed, currentTenant.id]);

  const canManageBusinessSettings = effectiveRole === 'super_admin' || effectiveRole === 'owner';
  const canManageServices = effectiveRole === 'super_admin' || effectiveRole === 'owner';
  const canManageStaff = effectiveRole === 'super_admin' || effectiveRole === 'owner';
  const canViewPlatformAdmin = effectiveRole === 'super_admin';

  // Derived effective language
  const language: Language = useMemo(() => {
    if (userLangPref) return userLangPref;
    if (currentTenant?.defaultLanguage) return currentTenant.defaultLanguage;
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('es')) return 'es';
    return 'en';
  }, [userLangPref, currentTenant]);

  const languageRef = useRef<Language>(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const setLanguage = (lang: Language) => {
    setUserLangPref(lang);
    localStorage.setItem('novacode_user_lang', lang);
  };

  const t = translations[language] || translations.en;

  // 6. Theme Resolution (Light / Dark)
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('novacode_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('novacode_theme', theme);
  }, [theme]);

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  // 7. Data Collections (Demo & Live)
  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('novacode_customers');
    return saved ? JSON.parse(saved) : SEED_CUSTOMERS;
  });

  const [services, setServices] = useState<Service[]>(() => {
    const saved = localStorage.getItem('novacode_services');
    return saved ? JSON.parse(saved) : SEED_SERVICES;
  });

  const [staff, setStaff] = useState<Staff[]>(() => {
    const saved = localStorage.getItem('novacode_staff');
    return saved ? JSON.parse(saved) : SEED_STAFF;
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem('novacode_appointments');
    return saved ? JSON.parse(saved) : SEED_APPOINTMENTS;
  });

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = localStorage.getItem('novacode_conversations');
    return saved ? JSON.parse(saved) : SEED_CONVERSATIONS;
  });

  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>(() => {
    const saved = localStorage.getItem('novacode_chat_messages');
    return saved ? JSON.parse(saved) : SEED_MESSAGES;
  });

  const [integrationStatus] = useState<IntegrationStatus>(INITIAL_INTEGRATION_STATUS);
  const [isLoadingLiveData, setIsLoadingLiveData] = useState<boolean>(false);
  const [liveDataError, setLiveDataError] = useState<string | null>(null);
  const [liveDataErrorType, setLiveDataErrorType] = useState<BusinessErrorCategory | null>(null);

  // 8. Navigation & UI States (Synchronously Role-Guarded)
  const [activeTab, setActiveTabState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const clean = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
      if (clean === 'support' || clean === 'help-support') return 'support';
      if (['calendar', 'appointments', 'customers', 'services', 'messages', 'ai-assistant'].includes(clean)) {
        return clean;
      }
    }
    return 'overview';
  });
  const activeTabRef = useRef<string>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const setActiveTab = useCallback(
    (nextTab: string) => {
      if (!canAccessTab(nextTab, effectiveRole, { canViewPlatformAdmin, canManageBusinessSettings })) {
        setActiveTabState('overview');
        if (typeof window !== 'undefined' && window.location.pathname !== '/' && window.location.pathname !== '/overview') {
          window.history.replaceState({}, document.title, '/');
        }
        return;
      }
      setActiveTabState(nextTab);
    },
    [effectiveRole, canViewPlatformAdmin, canManageBusinessSettings]
  );

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isNewBookingModalOpen, setIsNewBookingModalOpen] = useState<boolean>(false);
  const [selectedAppointmentForDetail, setSelectedAppointmentForDetail] = useState<Appointment | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>('conv-carlos');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Toast Helpers
  const addToast = (type: ToastMessage['type'], title: string, message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Live Supabase Collections (Strictly isolated from Demo collections)
  const [liveAppointments, setLiveAppointments] = useState<Appointment[]>([]);
  const [liveCustomers, setLiveCustomers] = useState<Customer[]>([]);
  const [liveServices, setLiveServices] = useState<Service[]>([]);
  const [liveActiveServicesCount, setLiveActiveServicesCount] = useState<number | null>(null);
  const [liveMembers, setLiveMembers] = useState<BusinessMember[]>([]);
  const [businessInvitations, setBusinessInvitations] = useState<BusinessInvitation[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [platformIncidents, setPlatformIncidents] = useState<SupportIncident[]>([]);
  const [capturedTechnicalIncidents, setCapturedTechnicalIncidents] = useState<SupportIncident[]>([]);
  const [incidentsTableExists, setIncidentsTableExists] = useState<boolean>(false);
  const [platformIncidentsTotalCount, setPlatformIncidentsTotalCount] = useState<number>(0);
  const [hasMorePlatformIncidents, setHasMorePlatformIncidents] = useState<boolean>(false);
  const [isLoadingMorePlatformIncidents, setIsLoadingMorePlatformIncidents] = useState<boolean>(false);
  const [businessNotifications, setBusinessNotifications] = useState<BusinessNotification[]>([]);

  // Support System Collections (Live & Sandbox fallback)
  const [liveSupportTickets, setLiveSupportTickets] = useState<SupportTicket[]>([]);
  const [liveSupportMessages, setLiveSupportMessages] = useState<Record<string, SupportTicketMessage[]>>({});
  const [liveSupportStatusHistory, setLiveSupportStatusHistory] = useState<
    Record<string, SupportTicketStatusHistoryEntry[]>
  >({});
  const [demoSupportTickets, setDemoSupportTickets] = useState<SupportTicket[]>([]);
  const [demoSupportMessages, setDemoSupportMessages] = useState<Record<string, SupportTicketMessage[]>>({});
  const [demoSupportStatusHistory, setDemoSupportStatusHistory] = useState<
    Record<string, SupportTicketStatusHistoryEntry[]>
  >({});
  const [supportTicketsTableExists, setSupportTicketsTableExists] = useState<boolean>(true);
  const [isLoadingSupportTickets, setIsLoadingSupportTickets] = useState<boolean>(false);
  const [supportTicketsTotalCount, setSupportTicketsTotalCount] = useState<number>(0);
  const [hasMoreSupportTickets, setHasMoreSupportTickets] = useState<boolean>(false);
  const [isLoadingMoreSupportTickets, setIsLoadingMoreSupportTickets] = useState<boolean>(false);
  const [supportNotifications, setSupportNotifications] = useState<SupportNotification[]>([]);
  const [pendingAdminTicketId, setPendingAdminTicketId] = useState<string | null>(null);
  const [pendingAdminIncidentId, setPendingAdminIncidentId] = useState<string | null>(null);
  const isCreatingSupportTicketRef = useRef<boolean>(false);
  const recentReportedIncidentsRef = useRef<Map<string, number>>(new Map());
  const seenBookingNotificationKeysRef = useRef<Set<string>>(new Set());

  const [platformMetrics, setPlatformMetrics] = useState<PlatformMetrics>({
    totalBusinesses: 0,
    activeBusinesses: 0,
    suspendedBusinesses: 0,
    totalCustomers: null,
    totalAppointments: null,
    systemHealth: 'demo',
  });
  const [businessOwnersByBizId, setBusinessOwnersByBizId] = useState<Record<string, BusinessOwnerSummary[]>>({});
  const [bookingNotificationHealth, setBookingNotificationHealth] = useState<BookingNotificationHealth>({
    status: 'not_deployed',
    pendingFailures: 0,
    dueForRetry: 0,
    abandonedFailures: 0,
    recovered24h: 0,
    oldestPendingAgeSeconds: 0,
    openNotificationIncidents: 0,
    criticalDoubleFailureIncidents: 0,
    checkedAt: '',
    recoveryWorkerStatus: 'not_deployed',
  });
  const [n8nIntegrationHealth, setN8nIntegrationHealth] = useState<N8nIntegrationHealth>({
    status: 'not_verified',
    activeWorkflows: null,
    detail: '',
  });
  const [messagingConfigsByBizId, setMessagingConfigsByBizId] = useState<Record<string, BusinessMessagingConfig>>({});
  const [smsConsentSummariesByBizId, setSmsConsentSummariesByBizId] = useState<Record<string, BusinessSmsConsentSummary>>({});
  const [smsTablesStatus, setSmsTablesStatus] = useState<{
    configsTableExists: boolean;
    consentsTableExists: boolean;
  }>({ configsTableExists: true, consentsTableExists: true });

  const captureTechnicalIncident = useCallback(
    (input: {
      source?: SupportIncident['source'];
      severity?: SupportIncident['severity'];
      title: string;
      description: string;
      errorCode?: string;
      businessId?: string;
      businessName?: string;
    }) => {
      setCapturedTechnicalIncidents(prev => {
        const duplicate = prev.some(
          item => item.title === input.title && item.description === input.description && item.businessId === input.businessId
        );
        if (duplicate) return prev;
        const entry: SupportIncident = {
          id: `tech-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          businessId: input.businessId,
          businessName: input.businessName,
          source: input.source || 'technical_error',
          severity: input.severity || 'high',
          status: 'open',
          title: input.title,
          description: input.description,
          errorCode: input.errorCode,
          createdAt: new Date().toISOString(),
        };
        return [entry, ...prev.slice(0, 29)];
      });

      if (mode === 'supabase' && supabaseConfig.isConnected && currentUser?.id) {
        const dedupeKey = `${input.businessId || 'platform'}::${input.title}`;
        const now = Date.now();
        const lastSent = recentReportedIncidentsRef.current.get(dedupeKey) || 0;
        if (now - lastSent > 60_000) {
          recentReportedIncidentsRef.current.set(dedupeKey, now);
          reportSupportIncidentInSupabase({
            businessId: input.businessId,
            businessName: input.businessName,
            source: input.source || 'technical_error',
            severity: input.severity || 'high',
            title: input.title,
            description: input.description,
            errorCode: input.errorCode,
          }).catch(() => {});
        }
      }
    },
    [mode, supabaseConfig.isConnected, currentUser?.id]
  );

  // ---------------------------------------------------------------------------
  // Load Live Data from Supabase when in 'supabase' mode
  // ---------------------------------------------------------------------------
  const reloadLiveAppointments = useCallback(async () => {
    const hasAccess = Boolean(currentUser) && (Boolean(currentUser?.isSuperAdmin) || !hasNoBusinessMembership);
    if (mode !== 'supabase' || !currentTenant?.id || !hasAccess) {
      setLiveAppointments([]);
      setLiveCustomers([]);
      setLiveServices([]);
      setLiveActiveServicesCount(null);
      setLiveDataError(null);
      setLiveDataErrorType(null);
      return;
    }

    try {
      setIsLoadingLiveData(true);
      setLiveDataError(null);
      setLiveDataErrorType(null);
      const lang = languageRef.current;

      const [appsRes, custsRes, svcsRes, exactSvcCount] = await Promise.all([
        fetchLiveAppointmentsWithStatus(currentTenant.id, currentTenant.timezone, lang),
        fetchLiveCustomersWithStatus(currentTenant.id, lang),
        fetchLiveServicesWithStatus(currentTenant.id, lang),
        fetchActiveServicesCountInSupabase(currentTenant.id),
      ]);

      setLiveAppointments(appsRes?.items || []);
      setLiveCustomers(custsRes?.items || []);
      setLiveServices(svcsRes?.items || []);
      setLiveActiveServicesCount(exactSvcCount);

      const firstError = custsRes.error || appsRes.error || svcsRes.error;
      const firstErrorType = custsRes.errorType || appsRes.errorType || svcsRes.errorType || null;
      const firstTechnical = custsRes.technicalDetail || appsRes.technicalDetail || svcsRes.technicalDetail;

      if (firstError) {
        setLiveDataError(firstError);
        setLiveDataErrorType(firstErrorType);
        captureTechnicalIncident({
          source: 'technical_error',
          severity: firstErrorType === 'permission' ? 'high' : 'medium',
          title: 'Business data load error',
          description: firstTechnical || firstError,
          errorCode: firstErrorType?.toUpperCase(),
          businessId: currentTenant.id,
          businessName: currentTenant.name,
        });
      }
    } catch (e) {
      const sanitized = sanitizeErrorForBusiness(e, languageRef.current);
      setLiveDataError(sanitized.userMessage);
      setLiveDataErrorType(sanitized.errorType);
      captureTechnicalIncident({
        source: 'technical_error',
        severity: 'high',
        title: 'Unexpected data sync failure',
        description: sanitized.technicalDetail,
        businessId: currentTenant.id,
        businessName: currentTenant.name,
      });
    } finally {
      setIsLoadingLiveData(false);
    }
  }, [mode, currentTenant.id, currentTenant.name, currentTenant.timezone, currentUser, hasNoBusinessMembership, captureTechnicalIncident]);

  const reloadPlatformMetrics = useCallback(async () => {
    if (mode !== 'supabase') {
      setPlatformMetrics({
        totalBusinesses: tenants.length,
        activeBusinesses: tenants.filter(b => b.isActive !== false).length,
        suspendedBusinesses: tenants.filter(b => b.isActive === false).length,
        totalCustomers: customers.length,
        totalAppointments: appointments.length,
        systemHealth: 'demo',
        healthDetail: 'Interactive Preview',
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }
    if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
      return;
    }
    const metrics = await fetchPlatformAggregateMetricsInSupabase(liveTenants);
    setPlatformMetrics(metrics);
  }, [mode, currentUser?.isSuperAdmin, isSuperAdminCheckFailed, liveTenants, tenants, customers.length, appointments.length]);

  const reloadBusinessOwners = useCallback(async () => {
    if (mode !== 'supabase') {
      const demoOwners: Record<string, BusinessOwnerSummary[]> = {};
      for (const b of tenants) {
        if (b.email) {
          demoOwners[b.id] = [
            {
              businessId: b.id,
              userId: `demo-owner-${b.id}`,
              role: 'owner',
              userEmail: b.email,
            },
          ];
        }
      }
      setBusinessOwnersByBizId(demoOwners);
      return;
    }
    if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
      setBusinessOwnersByBizId({});
      return;
    }
    const owners = await fetchPlatformBusinessOwnersInSupabase(liveTenants);
    setBusinessOwnersByBizId(owners);
  }, [mode, currentUser?.isSuperAdmin, isSuperAdminCheckFailed, liveTenants, tenants]);

  const reloadBookingNotificationHealth = useCallback(async () => {
    if (mode !== 'supabase') {
      setBookingNotificationHealth({
        status: 'demo',
        pendingFailures: 0,
        dueForRetry: 0,
        abandonedFailures: 0,
        recovered24h: 0,
        oldestPendingAgeSeconds: 0,
        openNotificationIncidents: 0,
        criticalDoubleFailureIncidents: 0,
        checkedAt: new Date().toISOString(),
        recoveryWorkerStatus: 'demo',
      });
      return;
    }
    if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
      return;
    }
    const health = await fetchBookingNotificationHealthInSupabase();
    setBookingNotificationHealth(health);
  }, [mode, currentUser?.isSuperAdmin, isSuperAdminCheckFailed]);

  const triggerBookingNotificationRecovery = useCallback(async () => {
    if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
      return { success: false, error: 'Super Admin authorization required.' };
    }
    if (mode !== 'supabase') {
      return {
        success: false,
        requiresBackendWorker: true,
        error: 'Automated notification recovery runs in live Supabase via service_role cron or Edge Function.',
      };
    }
    const res = await triggerBookingNotificationRecoveryInSupabase();
    await reloadBookingNotificationHealth();
    if (res.success) {
      addToast(
        'success',
        language === 'es' ? 'Recuperación Ejecutada' : 'Notification Recovery Executed',
        res.message || `Recovered ${res.recoveredCount ?? 0} notification event(s).`
      );
    } else if (res.error) {
      addToast(
        res.requiresBackendWorker ? 'warning' : 'error',
        language === 'es' ? 'Trabajador de Recuperación Requerido' : 'Backend Worker Required',
        res.error
      );
    }
    return res;
  }, [mode, currentUser?.isSuperAdmin, isSuperAdminCheckFailed, reloadBookingNotificationHealth, language]);

  const reloadN8nIntegrationHealth = useCallback(async () => {
    if (mode !== 'supabase') {
      setN8nIntegrationHealth({
        status: 'demo',
        activeWorkflows: null,
        lastVerifiedAt: new Date().toISOString(),
        detail: 'Interactive sandbox — external n8n orchestration disabled.',
      });
      return;
    }
    if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
      setN8nIntegrationHealth({
        status: 'not_verified',
        activeWorkflows: null,
        detail: 'Super Admin verification required.',
      });
      return;
    }
    const health = await checkN8nIntegrationHealthInSupabase();
    setN8nIntegrationHealth(health);
  }, [mode, currentUser?.isSuperAdmin, isSuperAdminCheckFailed]);

  const reloadSmsA2pOverview = useCallback(async () => {
    if (mode !== 'supabase') {
      const demoConfigs: Record<string, BusinessMessagingConfig> = {};
      const demoSummaries: Record<string, BusinessSmsConsentSummary> = {};
      for (const b of tenants) {
        demoConfigs[b.id] = {
          businessId: b.id,
          a2pStatus: 'not_configured',
          smsOptInEnabled: true,
          autoSendEnabled: false,
          consentDisclosureVersion: 'v1.0',
          persistedInBackend: false,
        };
        demoSummaries[b.id] = {
          businessId: b.id,
          totalConsents: 0,
          optedInCount: 0,
          optedOutCount: 0,
          disclosureVersions: [],
          sources: [],
        };
      }
      setMessagingConfigsByBizId(prev => ({ ...demoConfigs, ...prev }));
      setSmsConsentSummariesByBizId(prev => ({ ...demoSummaries, ...prev }));
      setSmsTablesStatus({ configsTableExists: true, consentsTableExists: true });
      return;
    }
    if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
      setMessagingConfigsByBizId({});
      setSmsConsentSummariesByBizId({});
      return;
    }
    const [cfgRes, consentRes] = await Promise.all([
      fetchPlatformMessagingConfigsInSupabase(),
      fetchPlatformSmsConsentSummariesInSupabase(),
    ]);
    setMessagingConfigsByBizId(cfgRes.configs);
    setSmsConsentSummariesByBizId(consentRes.summaries);
    setSmsTablesStatus({
      configsTableExists: cfgRes.tableExists,
      consentsTableExists: consentRes.tableExists,
    });
  }, [mode, currentUser?.isSuperAdmin, isSuperAdminCheckFailed, tenants]);

  const reloadPlatformIncidents = useCallback(async () => {
    if (mode !== 'supabase' || !currentUser?.isSuperAdmin) {
      setPlatformIncidents([]);
      setIncidentsTableExists(false);
      setPlatformIncidentsTotalCount(0);
      setHasMorePlatformIncidents(false);
      return;
    }
    const res = await fetchPlatformIncidentsInSupabase({ limit: 50, offset: 0 });
    setPlatformIncidents(res.incidents);
    setIncidentsTableExists(res.tableExists);
    setPlatformIncidentsTotalCount(res.totalCount);
    setHasMorePlatformIncidents(res.hasMore);
  }, [mode, currentUser?.isSuperAdmin]);

  const loadMorePlatformIncidents = useCallback(async () => {
    if (
      mode !== 'supabase' ||
      !currentUser?.isSuperAdmin ||
      isLoadingMorePlatformIncidents ||
      !hasMorePlatformIncidents
    ) {
      return;
    }
    setIsLoadingMorePlatformIncidents(true);
    try {
      const res = await fetchPlatformIncidentsInSupabase({
        limit: 50,
        offset: platformIncidents.length,
      });
      setPlatformIncidents(prev => {
        const seen = new Set(prev.map(i => i.id));
        const next = [...prev];
        for (const inc of res.incidents) {
          if (!seen.has(inc.id)) {
            seen.add(inc.id);
            next.push(inc);
          }
        }
        return next;
      });
      setPlatformIncidentsTotalCount(res.totalCount);
      setHasMorePlatformIncidents(res.hasMore);
    } finally {
      setIsLoadingMorePlatformIncidents(false);
    }
  }, [
    mode,
    currentUser?.isSuperAdmin,
    isLoadingMorePlatformIncidents,
    hasMorePlatformIncidents,
    platformIncidents.length,
  ]);

  const fetchAndSelectIncident = useCallback(
    async (incidentId: string): Promise<SupportIncident | null> => {
      const existing = platformIncidents.find(inc => inc.id === incidentId);
      if (existing) return existing;
      if (mode !== 'supabase' || !currentUser?.isSuperAdmin) return null;
      const res = await fetchPlatformIncidentByIdInSupabase(incidentId);
      if (res.incident) {
        setPlatformIncidents(prev => {
          if (prev.some(inc => inc.id === res.incident!.id)) return prev;
          return [res.incident!, ...prev];
        });
        return res.incident;
      }
      return null;
    },
    [platformIncidents, mode, currentUser?.isSuperAdmin]
  );

  const updatePlatformIncidentStatus = useCallback(
    async (incidentId: string, status: IncidentStatus): Promise<{ success: boolean; error?: string }> => {
      if (!canViewPlatformAdmin) {
        return { success: false, error: 'Super Admin access required.' };
      }

      if (mode === 'supabase') {
        const res = await updatePlatformIncidentStatusInSupabase(incidentId, status);
        if (!res.success || !res.incident) {
          return { success: false, error: res.error || 'Unable to update incident status.' };
        }
        setPlatformIncidents(prev => prev.map(inc => (inc.id === incidentId ? res.incident! : inc)));
        addToast(
          'success',
          language === 'es' ? 'Incidente Actualizado' : 'Incident Updated',
          `${res.incident.title} → ${status}`
        );
        return { success: true };
      }

      const resolvedAt = status === 'resolved' ? new Date().toISOString() : undefined;
      setPlatformIncidents(prev =>
        prev.map(inc => (inc.id === incidentId ? { ...inc, status, resolvedAt } : inc))
      );
      setCapturedTechnicalIncidents(prev =>
        prev.map(inc => (inc.id === incidentId ? { ...inc, status, resolvedAt } : inc))
      );
      return { success: true };
    },
    [canViewPlatformAdmin, mode, language]
  );

  const reloadSupportTickets = useCallback(async () => {
    if (mode !== 'supabase') {
      setSupportTicketsTableExists(true);
      return;
    }
    if (!currentUser) {
      setLiveSupportTickets([]);
      setSupportTicketsTotalCount(0);
      setHasMoreSupportTickets(false);
      return;
    }

    const isSuper = Boolean(currentUser.isSuperAdmin);
    if (!isSuper && (!currentTenant?.id || hasNoBusinessMembership)) {
      setLiveSupportTickets([]);
      setSupportTicketsTotalCount(0);
      setHasMoreSupportTickets(false);
      return;
    }

    setIsLoadingSupportTickets(true);
    try {
      const [ticketRes, notifRes] = await Promise.all([
        fetchSupportTicketsInSupabase({
          businessId: isSuper ? undefined : currentTenant.id,
          limit: 50,
          offset: 0,
        }),
        fetchSupportNotificationsInSupabase({
          targetRole: isSuper ? 'super_admin' : 'business',
          businessId: isSuper ? undefined : currentTenant.id,
        }),
      ]);

      setSupportTicketsTableExists(ticketRes.tableExists);
      setLiveSupportTickets(ticketRes.tickets);
      setSupportTicketsTotalCount(ticketRes.totalCount);
      setHasMoreSupportTickets(ticketRes.hasMore);
      setSupportNotifications(notifRes.notifications);

      if (ticketRes.error && ticketRes.technicalDetail) {
        captureTechnicalIncident({
          source: 'technical_error',
          severity: 'medium',
          title: 'Support tickets fetch issue',
          description: ticketRes.technicalDetail,
          businessId: isSuper ? undefined : currentTenant.id,
        });
      }
    } finally {
      setIsLoadingSupportTickets(false);
    }
  }, [mode, currentUser, currentTenant.id, hasNoBusinessMembership, captureTechnicalIncident]);

  const loadMoreSupportTickets = useCallback(async () => {
    if (
      mode !== 'supabase' ||
      !currentUser ||
      isLoadingMoreSupportTickets ||
      !hasMoreSupportTickets
    ) {
      return;
    }
    const isSuper = Boolean(currentUser.isSuperAdmin);
    if (!isSuper && (!currentTenant?.id || hasNoBusinessMembership)) {
      return;
    }

    setIsLoadingMoreSupportTickets(true);
    try {
      const res = await fetchSupportTicketsInSupabase({
        businessId: isSuper ? undefined : currentTenant.id,
        limit: 50,
        offset: liveSupportTickets.length,
      });
      setLiveSupportTickets(prev => {
        const seen = new Set(prev.map(tkt => tkt.id));
        const next = [...prev];
        for (const tkt of res.tickets) {
          if (!seen.has(tkt.id)) {
            seen.add(tkt.id);
            next.push(tkt);
          }
        }
        return next;
      });
      setSupportTicketsTotalCount(res.totalCount);
      setHasMoreSupportTickets(res.hasMore);
    } finally {
      setIsLoadingMoreSupportTickets(false);
    }
  }, [
    mode,
    currentUser,
    currentTenant?.id,
    hasNoBusinessMembership,
    isLoadingMoreSupportTickets,
    hasMoreSupportTickets,
    liveSupportTickets.length,
  ]);

  const reloadBusinessMembers = useCallback(async (businessId?: string) => {
    const targetBizId = businessId || currentTenant.id;
    if (mode !== 'supabase' || !currentUser || !targetBizId || (!currentUser.isSuperAdmin && !canManageStaff)) {
      setLiveMembers([]);
      return;
    }
    const members = await fetchBusinessMembersForTenant(targetBizId);
    setLiveMembers(members);
  }, [mode, currentUser, currentTenant.id, canManageStaff]);

  const reloadBusinessInvitations = useCallback(async (businessId?: string) => {
    if (mode !== 'supabase' || !currentUser?.isSuperAdmin) {
      setBusinessInvitations([]);
      return;
    }
    const res = await fetchBusinessInvitationsInSupabase(businessId);
    if (!res.error) {
      setBusinessInvitations(res.invitations);
    }
  }, [mode, currentUser?.isSuperAdmin]);

  const reloadAuditLogs = useCallback(async (businessId?: string) => {
    if (mode !== 'supabase' || !currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
      setAuditLogs([]);
      return;
    }
    const logs = await fetchRecentAuditLogs(businessId);
    setAuditLogs(logs);
  }, [mode, currentUser?.isSuperAdmin, isSuperAdminCheckFailed]);

  const applyAuthenticatedUser = useCallback(async (user: any, _options?: { skipAutoAcceptInvites?: boolean }) => {
    const profile = await fetchUserAccessProfile(user.id);
    const resolvedBusinesses = profile.accessibleBusinesses;
    const rpcFailed = Boolean(profile.superAdminCheckError);

    const diagnostics: string[] = [];
    if (profile.superAdminCheckError) {
      diagnostics.push(profile.superAdminCheckError);
    }
    if (profile.isSuperAdmin && profile.businessesError) {
      diagnostics.push(profile.businessesError);
    } else if (!profile.isSuperAdmin && !rpcFailed && profile.membershipsError) {
      diagnostics.push(profile.membershipsError);
    } else if (!profile.isSuperAdmin && !rpcFailed && profile.businessesError) {
      diagnostics.push(profile.businessesError);
    }

    const diagnosticText = diagnostics.length > 0 ? diagnostics.join(' | ') : null;
    setAuthDiagnosticError(diagnosticText);
    setIsSuperAdminCheckFailed(rpcFailed);

    if (rpcFailed && profile.superAdminCheckError) {
      const currentLang = languageRef.current;
      const title =
        translations[currentLang]?.auth?.workspaceVerificationTitle ||
        'Workspace Verification Needed';
      const safeMessage =
        translations[currentLang]?.auth?.workspaceVerificationNotice ||
        sanitizeErrorForBusiness(profile.superAdminCheckError, currentLang).userMessage;
      const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      setToasts(prev => [
        ...prev,
        {
          id: toastId,
          type: 'error',
          title,
          message: safeMessage,
        },
      ]);
      setTimeout(() => {
        setToasts(prev => prev.filter(item => item.id !== toastId));
      }, 6000);
    }

    // Strict precedence: supabase.rpc('is_super_admin') === true ALWAYS overrides business_members roles.
    // Never silently assign 'staff' when the Super Admin RPC fails.
    const derivedPlatformRole: PlatformRole = profile.isSuperAdmin
      ? 'super_admin'
      : rpcFailed
      ? 'none'
      : profile.memberships.some(m => m.role === 'owner' || m.role === 'admin')
      ? 'owner'
      : profile.memberships.length > 0
      ? 'staff'
      : 'none';

    const resolvedDisplayRole = profile.isSuperAdmin
      ? 'super_admin'
      : rpcFailed
      ? 'none'
      : profile.memberships[0]?.role || 'none';

    const nextUser: SupabaseUser = {
      id: user.id,
      email: user.email || '',
      isSuperAdmin: profile.isSuperAdmin && !rpcFailed,
      platformRole: derivedPlatformRole,
      role: resolvedDisplayRole,
      businessMemberships: profile.memberships,
    };
    currentUserRef.current = nextUser;
    setCurrentUser(nextUser);

    if (profile.isSuperAdmin || (!rpcFailed && resolvedBusinesses.length > 0)) {
      setHasNoBusinessMembership(false);
      setLiveTenants(resolvedBusinesses);
      setCurrentTenantIdState(prev =>
        resolvedBusinesses.some(b => b.id === prev) ? prev : (resolvedBusinesses[0]?.id || '')
      );
    } else {
      setHasNoBusinessMembership(!rpcFailed);
      setLiveTenants([]);
      setLiveAppointments([]);
      setLiveCustomers([]);
      setLiveServices([]);
      setLiveMembers([]);
      setAuditLogs([]);
    }

    const canAdmin = derivedPlatformRole === 'super_admin' && !rpcFailed;
    const canManageBiz = derivedPlatformRole === 'super_admin' || derivedPlatformRole === 'owner';

    return {
      isSuperAdmin: canAdmin,
      rpcFailed,
      effectiveRole: derivedPlatformRole,
      canViewPlatformAdmin: canAdmin,
      canManageBusinessSettings: canManageBiz,
    };
  }, []);

  const refreshAccessProfile = useCallback(async () => {
    const { session, user } = await getCurrentSupabaseSession();
    const targetUser = user || (currentUser?.id ? { id: currentUser.id, email: currentUser.email } : null);
    if (!targetUser) return;
    if (session) setAuthSession(session);
    const access = await applyAuthenticatedUser(targetUser);
    if (access.isSuperAdmin && activeTabRef.current === 'overview') {
      setActiveTab('admin');
    }
  }, [currentUser?.id, currentUser?.email, applyAuthenticatedUser]);

  // Auth state listener & Password Recovery / Invitation Onboarding Detection
  useEffect(() => {
    const recoveryDetectedInUrl = isRecoveryUrl();
    const invitationDetectedInUrl = isInvitationUrl();
    if (invitationDetectedInUrl) {
      invitationContextRef.current = getInvitationUrlParams();
      setIsInvitationOnboardingMode(true);
      setIsAuthModalOpen(true);
    } else if (recoveryDetectedInUrl) {
      setIsPasswordRecoveryMode(true);
      setIsAuthModalOpen(true);
    }

    // Register listener BEFORE session initialization so PASSWORD_RECOVERY / invite SIGNED_IN is never missed
    const { unsubscribe } = onSupabaseAuthStateChange(async (event, session) => {
      setAuthSession(session);

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryError(null);
        setIsPasswordRecoveryMode(true);
        setIsAuthModalOpen(true);
      }

      const inviteActive = isInvitationUrl();
      if (session?.user) {
        const access = await applyAuthenticatedUser(session.user, {
          skipAutoAcceptInvites: inviteActive,
        });
        if (event === 'SIGNED_IN' && access.isSuperAdmin && activeTabRef.current === 'overview' && !inviteActive) {
          setActiveTab('admin');
        }
      } else {
        setCurrentUser(null);
        setLiveTenants([]);
        setLiveAppointments([]);
        setLiveCustomers([]);
        setLiveServices([]);
        setLiveActiveServicesCount(null);
        setLiveMembers([]);
        setBusinessInvitations([]);
        setAuditLogs([]);
        setPlatformIncidents([]);
        setPlatformIncidentsTotalCount(0);
        setHasMorePlatformIncidents(false);
        setIncidentsTableExists(false);
        setLiveSupportTickets([]);
        setLiveSupportMessages({});
        setLiveSupportStatusHistory({});
        setSupportTicketsTotalCount(0);
        setHasMoreSupportTickets(false);
        setSupportNotifications([]);
        seenBookingNotificationKeysRef.current.clear();
        setBusinessNotifications([]);
        setPendingAdminTicketId(null);
        setPendingAdminIncidentId(null);
        setBusinessOwnersByBizId({});
        setMessagingConfigsByBizId({});
        setSmsConsentSummariesByBizId({});
        setBookingNotificationHealth({
          status: 'not_deployed',
          pendingFailures: 0,
          dueForRetry: 0,
          abandonedFailures: 0,
          recovered24h: 0,
          oldestPendingAgeSeconds: 0,
          openNotificationIncidents: 0,
          criticalDoubleFailureIncidents: 0,
          checkedAt: new Date().toISOString(),
          recoveryWorkerStatus: 'not_deployed',
        });
        setN8nIntegrationHealth({
          status: 'not_verified',
          activeWorkflows: null,
          detail: 'Authentication required.',
        });
        setHasNoBusinessMembership(false);
        setAuthDiagnosticError(null);
        setIsSuperAdminCheckFailed(false);
      }
    });

    async function initAuth() {
      setIsAuthLoading(true);
      try {
        if (invitationDetectedInUrl) {
          const inviteCheck = await processInvitationUrlSession();
          if (inviteCheck.businessId || inviteCheck.token) {
            invitationContextRef.current = {
              businessId: inviteCheck.businessId,
              token: inviteCheck.token,
            };
          }
          if (inviteCheck.error) {
            setInvitationError(inviteCheck.error);
          }
        } else if (recoveryDetectedInUrl) {
          const recoveryCheck = await processRecoveryUrlSession();
          if (recoveryCheck.error) {
            setRecoveryError(recoveryCheck.error);
          }
        }

        const { session, user } = await getCurrentSupabaseSession();
        if (session && user) {
          setAuthSession(session);
          const access = await applyAuthenticatedUser(user, {
            skipAutoAcceptInvites: invitationDetectedInUrl,
          });
          if (
            typeof window !== 'undefined' &&
            !recoveryDetectedInUrl &&
            !invitationDetectedInUrl &&
            !isPublicComplianceRoute(window.location.pathname)
          ) {
            const resolvedTab = resolveTabFromPathname(
              window.location.pathname,
              {
                canViewPlatformAdmin: access.canViewPlatformAdmin,
                canManageBusinessSettings: access.canManageBusinessSettings,
              },
              access.effectiveRole
            );
            setActiveTabState(resolvedTab);
            if (
              resolvedTab === 'overview' &&
              window.location.pathname !== '/' &&
              window.location.pathname !== '/overview'
            ) {
              window.history.replaceState({}, document.title, '/');
            }
          }
          if (invitationDetectedInUrl) {
            setIsInvitationOnboardingMode(true);
            setIsAuthModalOpen(true);
          } else if (recoveryDetectedInUrl) {
            setIsPasswordRecoveryMode(true);
            setIsAuthModalOpen(true);
          }
        } else if (
          typeof window !== 'undefined' &&
          !recoveryDetectedInUrl &&
          !invitationDetectedInUrl &&
          !isPublicComplianceRoute(window.location.pathname)
        ) {
          const unauthRole: PlatformRole = modeRef.current === 'supabase' ? 'none' : 'owner';
          const canManageInUnauthMode = unauthRole === 'owner';
          const resolvedTab = resolveTabFromPathname(
            window.location.pathname,
            {
              canViewPlatformAdmin: false,
              canManageBusinessSettings: canManageInUnauthMode,
            },
            unauthRole
          );
          setActiveTabState(resolvedTab);
          if (
            resolvedTab === 'overview' &&
            window.location.pathname !== '/' &&
            window.location.pathname !== '/overview'
          ) {
            window.history.replaceState({}, document.title, '/');
          }
        }
      } catch (err) {
        console.warn('Error during session initialization:', err);
      } finally {
        setIsAuthLoading(false);
      }
    }

    initAuth();

    return () => {
      unsubscribe();
    };
  }, [applyAuthenticatedUser]);

  // Guard restricted tabs when role changes or URL pops (Staff cannot view Platform Admin, Incidents, Infrastructure, or Business Settings)
  useEffect(() => {
    if (typeof window !== 'undefined' && isPublicComplianceRoute(window.location.pathname)) {
      return;
    }
    if (!canAccessTab(activeTab, effectiveRole, { canViewPlatformAdmin, canManageBusinessSettings })) {
      setActiveTabState('overview');
      if (typeof window !== 'undefined' && window.location.pathname !== '/' && window.location.pathname !== '/overview') {
        window.history.replaceState({}, document.title, '/');
      }
    }
  }, [activeTab, effectiveRole, canViewPlatformAdmin, canManageBusinessSettings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      if (isPublicComplianceRoute(window.location.pathname)) return;
      const target = resolveTabFromPathname(
        window.location.pathname,
        { canViewPlatformAdmin, canManageBusinessSettings },
        effectiveRole
      );
      setActiveTabState(target);
      if (target === 'overview' && window.location.pathname !== '/' && window.location.pathname !== '/overview') {
        window.history.replaceState({}, document.title, '/');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [canViewPlatformAdmin, canManageBusinessSettings, effectiveRole]);

  const reloadBookingNotifications = useCallback(async () => {
    if (
      mode !== 'supabase' ||
      !supabaseConfig.isConnected ||
      !currentUser?.id ||
      currentUser.isSuperAdmin ||
      !currentTenant?.id ||
      hasNoBusinessMembership
    ) {
      if (mode === 'supabase') {
        seenBookingNotificationKeysRef.current.clear();
        setBusinessNotifications([]);
      }
      return;
    }

    const targetBusinessId = currentTenant.id;
    const res = await fetchBookingNotificationsInSupabase({
      businessId: targetBusinessId,
      userId: currentUser.id,
      limit: 50,
    });

    if (!res.tableExists) {
      return;
    }

    for (const item of res.notifications) {
      seenBookingNotificationKeysRef.current.add(item.id);
      if (item.idempotencyKey) {
        seenBookingNotificationKeysRef.current.add(item.idempotencyKey);
      }
    }

    setBusinessNotifications(prev => {
      const prevReadById = new Map<string, { readAt?: string; readByUserId?: string }>();
      for (const item of prev) {
        if (item.read) {
          prevReadById.set(item.id, { readAt: item.readAt, readByUserId: item.readByUserId });
        }
      }

      const seenIds = new Set<string>();
      const seenKeys = new Set<string>();
      const merged: BusinessNotification[] = [];

      for (const incoming of res.notifications) {
        if (seenIds.has(incoming.id)) continue;
        if (incoming.idempotencyKey && seenKeys.has(incoming.idempotencyKey)) continue;
        seenIds.add(incoming.id);
        if (incoming.idempotencyKey) seenKeys.add(incoming.idempotencyKey);

        const localRead = prevReadById.get(incoming.id);
        merged.push(
          localRead && !incoming.read
            ? {
                ...incoming,
                read: true,
                readAt: localRead.readAt,
                readByUserId: localRead.readByUserId || currentUser.id,
              }
            : incoming
        );
      }

      return merged;
    });
  }, [
    mode,
    supabaseConfig.isConnected,
    currentUser?.id,
    currentUser?.isSuperAdmin,
    currentTenant?.id,
    hasNoBusinessMembership,
  ]);

  // Reload appointments and manage realtime subscription per business
  useEffect(() => {
    const hasAccess = Boolean(currentUser) && (Boolean(currentUser?.isSuperAdmin) || !hasNoBusinessMembership);
    if (mode !== 'supabase' || !currentTenant?.id || !hasAccess) {
      return;
    }

    reloadLiveAppointments();

    const activeBusinessId = currentTenant.id;
    const isSuperAdminUser = Boolean(currentUser?.isSuperAdmin);
    let hadRealtimeDisconnect = false;

    const channel = subscribeToAppointmentsRealtime(
      activeBusinessId,
      (_change: RealtimeAppointmentChange) => {
        reloadLiveAppointments();

        // Super Admin never receives routine booking/cancellation notifications or toasts;
        // only aggregate platform metrics refresh quietly.
        if (isSuperAdminUser) {
          reloadPlatformMetrics();
        }
      },
      (status: string) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadRealtimeDisconnect = true;
        } else if (status === 'SUBSCRIBED' && hadRealtimeDisconnect) {
          hadRealtimeDisconnect = false;
          reloadLiveAppointments();
          if (isSuperAdminUser) {
            reloadPlatformMetrics();
          }
        }
      }
    );

    return () => {
      unsubscribeRealtimeChannel(channel);
    };
  }, [mode, currentTenant.id, currentUser, hasNoBusinessMembership, reloadLiveAppointments, reloadPlatformMetrics]);

  // Persistent per-user booking notifications & Realtime sync (strictly excluded for Super Admin)
  useEffect(() => {
    if (mode !== 'supabase') {
      return;
    }

    if (
      !supabaseConfig.isConnected ||
      !currentUser?.id ||
      currentUser.isSuperAdmin ||
      !currentTenant?.id ||
      hasNoBusinessMembership
    ) {
      seenBookingNotificationKeysRef.current.clear();
      setBusinessNotifications([]);
      return;
    }

    reloadBookingNotifications();

    let hadNotifDisconnect = false;
    const notifChannel = subscribeToBookingNotificationsRealtime(
      {
        businessId: currentTenant.id,
        userId: currentUser.id,
        isSuperAdmin: Boolean(currentUser.isSuperAdmin),
      },
      {
        onNotificationInsert: incoming => {
          if (incoming.businessId !== currentTenant.id) return;

          const alreadySeen =
            seenBookingNotificationKeysRef.current.has(incoming.id) ||
            Boolean(
              incoming.idempotencyKey &&
                seenBookingNotificationKeysRef.current.has(incoming.idempotencyKey)
            );
          if (alreadySeen) {
            return;
          }

          seenBookingNotificationKeysRef.current.add(incoming.id);
          if (incoming.idempotencyKey) {
            seenBookingNotificationKeysRef.current.add(incoming.idempotencyKey);
          }

          setBusinessNotifications(prev => {
            const exists = prev.some(
              n =>
                n.id === incoming.id ||
                (Boolean(incoming.idempotencyKey) &&
                  Boolean(n.idempotencyKey) &&
                  n.idempotencyKey === incoming.idempotencyKey)
            );
            if (exists) {
              return prev;
            }
            return [incoming, ...prev].slice(0, 50);
          });

          if (!incoming.read) {
            const currentLang = languageRef.current;
            const currentDict = translations[currentLang] || translations.en;
            const localizedTitle =
              incoming.eventType === 'appointment_cancelled'
                ? currentDict.dashboard.bookingCancelledTitle
                : incoming.eventType === 'appointment_rescheduled'
                ? currentDict.dashboard.bookingRescheduledTitle
                : currentDict.dashboard.bookingConfirmedTitle;
            addToast('info', localizedTitle, incoming.description);
          }
        },
        onReadInsert: receipt => {
          if (receipt.userId !== currentUser.id || receipt.businessId !== currentTenant.id) return;
          setBusinessNotifications(prev =>
            prev.map(n =>
              n.id === receipt.notificationId
                ? {
                    ...n,
                    read: true,
                    readAt: n.readAt || receipt.readAt,
                    readByUserId: receipt.userId,
                  }
                : n
            )
          );
        },
        onStatusChange: status => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            hadNotifDisconnect = true;
          } else if (status === 'SUBSCRIBED' && hadNotifDisconnect) {
            hadNotifDisconnect = false;
            reloadBookingNotifications();
          }
        },
      }
    );

    return () => {
      unsubscribeRealtimeChannel(notifChannel);
    };
  }, [
    mode,
    supabaseConfig.isConnected,
    currentUser?.id,
    currentUser?.isSuperAdmin,
    currentTenant.id,
    hasNoBusinessMembership,
    reloadBookingNotifications,
  ]);

  // Super Admin aggregate platform metrics, incidents, owners, notification health, & SMS/A2P overview
  useEffect(() => {
    if (mode !== 'supabase') {
      reloadPlatformMetrics();
      reloadBusinessOwners();
      reloadBookingNotificationHealth();
      reloadN8nIntegrationHealth();
      reloadSmsA2pOverview();
      return;
    }
    if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) return;

    reloadPlatformMetrics();
    reloadPlatformIncidents();
    reloadBusinessOwners();
    reloadBookingNotificationHealth();
    reloadN8nIntegrationHealth();
    reloadSmsA2pOverview();

    const platformChannel = subscribeToPlatformAppointmentsCountRealtime(() => {
      reloadPlatformMetrics();
    });

    return () => {
      unsubscribeRealtimeChannel(platformChannel);
    };
  }, [
    mode,
    currentUser?.isSuperAdmin,
    isSuperAdminCheckFailed,
    reloadPlatformMetrics,
    reloadPlatformIncidents,
    reloadBusinessOwners,
    reloadBookingNotificationHealth,
    reloadN8nIntegrationHealth,
    reloadSmsA2pOverview,
  ]);

  // Sync state to localStorage
  useEffect(() => {
    localStorage.setItem('novacode_tenants', JSON.stringify(tenants));
  }, [tenants]);

  useEffect(() => {
    localStorage.setItem('novacode_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem('novacode_services', JSON.stringify(services));
  }, [services]);

  useEffect(() => {
    localStorage.setItem('novacode_appointments', JSON.stringify(appointments));
  }, [appointments]);

  useEffect(() => {
    localStorage.setItem('novacode_conversations', JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem('novacode_chat_messages', JSON.stringify(chatMessages));
  }, [chatMessages]);

  useEffect(() => {
    localStorage.setItem('novacode_supabase_config', JSON.stringify(supabaseConfig));
  }, [supabaseConfig]);

  // Reload support tickets when user or active business changes
  useEffect(() => {
    reloadSupportTickets();
  }, [reloadSupportTickets]);

  // Scoped Realtime subscriptions for support tickets, replies, notifications & Super Admin incidents
  useEffect(() => {
    if (mode !== 'supabase' || !supabaseConfig.isConnected || !currentUser?.id) {
      return;
    }

    const isSuper = Boolean(currentUser.isSuperAdmin);
    if (!isSuper && (!currentTenant?.id || hasNoBusinessMembership)) {
      return;
    }

    const scopedBusinessId = isSuper ? undefined : currentTenant.id;
    const supportChannel = subscribeToSupportSystemRealtime(
      { isSuperAdmin: isSuper, businessId: scopedBusinessId },
      {
        onTicketChange: ({ eventType, ticket, oldId }) => {
          if (eventType === 'DELETE' && oldId) {
            setLiveSupportTickets(prev => prev.filter(tkt => tkt.id !== oldId));
            return;
          }
          if (!ticket) return;
          if (!isSuper && ticket.businessId !== scopedBusinessId) return;

          setLiveSupportTickets(prev => {
            const existing = prev.find(tkt => tkt.id === ticket.id);
            const matchedBizName = liveTenantsRef.current.find(b => b.id === ticket.businessId)?.name;
            const mergedTicket: SupportTicket = {
              ...ticket,
              businessName:
                ticket.businessName ||
                existing?.businessName ||
                matchedBizName ||
                (ticket.businessId === currentTenant.id ? currentTenant.name : undefined),
            };
            if (!existing) {
              setSupportTicketsTotalCount(c => c + 1);
              return [mergedTicket, ...prev];
            }
            const next = prev.map(tkt => (tkt.id === ticket.id ? mergedTicket : tkt));
            return next.sort(
              (a, b) =>
                new Date(b.lastMessageAt || b.updatedAt).getTime() -
                new Date(a.lastMessageAt || a.updatedAt).getTime()
            );
          });
        },
        onMessageInsert: message => {
          if (!isSuper && message.businessId !== scopedBusinessId) return;

          setLiveSupportMessages(prev => {
            const existing = prev[message.ticketId] || [];
            if (existing.some(m => m.id === message.id)) {
              return prev;
            }
            return {
              ...prev,
              [message.ticketId]: [...existing, message],
            };
          });

          setLiveSupportTickets(prev =>
            prev.map(tkt =>
              tkt.id === message.ticketId
                ? {
                    ...tkt,
                    lastMessageAt: message.createdAt,
                  }
                : tkt
            )
          );
        },
        onNotificationChange: ({ eventType, notification, oldId }) => {
          if (eventType === 'DELETE' && oldId) {
            setSupportNotifications(prev => prev.filter(n => n.id !== oldId));
            return;
          }
          if (!notification) return;

          if (notification.isRead) {
            setSupportNotifications(prev => prev.filter(n => n.id !== notification.id));
            return;
          }

          setSupportNotifications(prev => {
            const exists = prev.some(n => n.id === notification.id);
            if (exists) {
              return prev.map(n => (n.id === notification.id ? notification : n));
            }
            return [notification, ...prev.slice(0, 29)];
          });
        },
        onIncidentChange: ({ eventType, incident, oldId }) => {
          if (!isSuper) return;
          if (eventType === 'DELETE' && oldId) {
            setPlatformIncidents(prev => prev.filter(inc => inc.id !== oldId));
            return;
          }
          if (!incident) return;
          setPlatformIncidents(prev => {
            const exists = prev.some(inc => inc.id === incident.id);
            if (exists) {
              return prev.map(inc => (inc.id === incident.id ? incident : inc));
            }
            return [incident, ...prev.slice(0, 49)];
          });
        },
      }
    );

    return () => {
      unsubscribeRealtimeChannel(supportChannel);
    };
  }, [
    mode,
    supabaseConfig.isConnected,
    currentUser?.id,
    currentUser?.isSuperAdmin,
    currentTenant.id,
    currentTenant.name,
    hasNoBusinessMembership,
  ]);

  // Multi-tenant selection (clears stale business state immediately before loading next business)
  const setCurrentTenantId = (tenantId: string) => {
    setSelectedAppointmentForDetail(null);
    setLiveAppointments([]);
    setLiveCustomers([]);
    setLiveServices([]);
    setLiveSupportMessages({});
    if (mode === 'supabase') {
      seenBookingNotificationKeysRef.current.clear();
      setBusinessNotifications([]);
    }
    setLiveDataError(null);
    setLiveDataErrorType(null);
    setCurrentTenantIdState(tenantId);
    localStorage.setItem('novacode_current_tenant_id', tenantId);
    const targetTenant = availableTenants.find(t => t.id === tenantId);
    if (targetTenant) {
      addToast(
        'info', 
        language === 'es' ? 'Negocio Seleccionado' : 'Business Switched',
        `${targetTenant.name} (${targetTenant.timezone})`
      );
    }
  };

  const updateTenantSettings = async (updatedTenant: Tenant) => {
    if (mode === 'supabase') {
      if (!canManageBusinessSettings) {
        addToast(
          'error',
          language === 'es' ? 'Acceso Denegado' : 'Access Denied',
          language === 'es' ? 'Solo propietarios o súper administradores pueden editar esta configuración.' : 'Only Business Owners or Super Admins can modify business settings.'
        );
        return;
      }
      const res = await updateBusinessSettingsInSupabase(updatedTenant);
      if (!res.success) {
        addToast('error', language === 'es' ? 'Error al Guardar' : 'Save Failed', res.error || 'Unable to update business.');
        return;
      }
      setLiveTenants(prev => prev.map(t => t.id === updatedTenant.id ? updatedTenant : t));
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: updatedTenant.id,
          action: 'update_business_settings',
          entityType: 'businesses',
          entityId: updatedTenant.id,
          metadata: { business_name: updatedTenant.name, timezone: updatedTenant.timezone },
        });
      }
    } else {
      setTenants(prev => prev.map(t => t.id === updatedTenant.id ? updatedTenant : t));
    }
    addToast(
      'success',
      language === 'es' ? 'Configuración Guardada' : 'Settings Saved',
      language === 'es' ? 'Los datos de la empresa han sido actualizados.' : 'Company settings have been updated.'
    );
  };

  const saveBusinessProfile = async (input: {
    name: string;
    category: string;
    categoryLabelEn: string;
    categoryLabelEs: string;
    customCategoryName?: string;
    tagline?: string;
    description?: string;
    logo?: string;
    phone: string;
    email: string;
    address: string;
    website: string;
    instagram?: string;
    timezone: string;
    currency: string;
    locationTypes: LocationType[];
    bookingInstructions: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (mode === 'supabase' && !canManageBusinessSettings) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'Solo propietarios o súper administradores pueden editar el perfil del negocio.'
            : 'Only Business Owners or Super Admins can modify the business profile.',
      };
    }

    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return {
        success: false,
        error: language === 'es' ? 'El nombre del negocio es obligatorio.' : 'Business name is required.',
      };
    }
    if (!isValidIanaTimezone(input.timezone)) {
      return {
        success: false,
        error: language === 'es' ? 'Selecciona una zona horaria IANA válida.' : 'Please select a valid IANA timezone.',
      };
    }

    const validLocations = normalizeLocationTypesList(input.locationTypes, []);
    if (validLocations.length === 0) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'Selecciona al menos una modalidad de atención.'
            : 'Select at least one supported appointment location.',
      };
    }

    const normalizedCat = normalizeCategoryId(input.category);
    const catOpt = getCategoryOption(normalizedCat);
    const normalizedCurrency = normalizeCurrencyCode(input.currency, currentTenant.currency || 'USD');
    const resolvedSymbol = getCurrencySymbol(normalizedCurrency, currentTenant.currencySymbol || '$');

    const profilePayload: Record<string, any> = {
      name: trimmedName,
      business_type: normalizedCat,
      tagline: (input.tagline || '').trim(),
      description: (input.description || '').trim(),
      logo: (input.logo || '').trim(),
      phone: input.phone.trim(),
      email: input.email.trim(),
      address: input.address.trim(),
      website: input.website.trim(),
      instagram: (input.instagram || '').trim(),
      timezone: input.timezone.trim(),
      currency: normalizedCurrency,
      currencySymbol: resolvedSymbol,
      locationTypes: validLocations,
      bookingInstructions: input.bookingInstructions.trim(),
      categoryKey: normalizedCat,
      categoryLabelEn: input.categoryLabelEn || catOpt.labelEn,
      categoryLabelEs: input.categoryLabelEs || catOpt.labelEs,
      categoryDetails: {
        customName: normalizedCat === 'custom_business' ? input.customCategoryName?.trim() || undefined : undefined,
        groupId: catOpt.groupId,
      },
    };

    if (mode === 'supabase') {
      const res = await updateBusinessProfileInSupabase(currentTenant.id, profilePayload);
      if (!res.success) {
        addToast('error', language === 'es' ? 'Error al Guardar' : 'Save Failed', res.error || 'Unable to update business profile.');
        return res;
      }
    }

    const applyUpdate = (t: Tenant): Tenant =>
      t.id !== currentTenant.id
        ? t
        : {
            ...t,
            name: profilePayload.name,
            tagline: profilePayload.tagline,
            description: profilePayload.description,
            logo: profilePayload.logo,
            category: normalizedCat,
            categoryLabelEn: profilePayload.categoryLabelEn,
            categoryLabelEs: profilePayload.categoryLabelEs,
            timezone: profilePayload.timezone,
            currency: normalizedCurrency,
            currencySymbol: resolvedSymbol,
            phone: profilePayload.phone,
            email: profilePayload.email,
            address: profilePayload.address,
            website: profilePayload.website,
            instagram: profilePayload.instagram,
            settings: {
              ...t.settings,
              locationTypes: validLocations,
              bookingInstructions: profilePayload.bookingInstructions,
              categoryDetails: profilePayload.categoryDetails,
            },
          };

    if (mode === 'supabase') {
      setLiveTenants(prev => prev.map(applyUpdate));
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'update_business_profile',
          entityType: 'businesses',
          entityId: currentTenant.id,
          metadata: { business_name: profilePayload.name, timezone: profilePayload.timezone },
        });
      }
    } else {
      setTenants(prev => prev.map(applyUpdate));
    }

    addToast(
      'success',
      language === 'es' ? 'Perfil Actualizado' : 'Profile Saved',
      language === 'es' ? 'El perfil del negocio fue guardado.' : 'Business profile has been saved.'
    );
    return { success: true };
  };

  const saveWeeklyBusinessHours = async (
    nextHours: Record<number, BusinessHours>
  ): Promise<{ success: boolean; error?: string }> => {
    if (mode === 'supabase' && !canManageBusinessSettings) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'Solo propietarios o súper administradores pueden editar los horarios.'
            : 'Only Business Owners or Super Admins can modify operating hours.',
      };
    }

    const operatingHoursMigrated = Boolean(currentTenant.settings?.operatingHoursMigrated);

    if (mode === 'supabase') {
      const res = await saveWeeklyBusinessHoursInSupabase(currentTenant.id, nextHours, {
        operatingHoursMigrated,
      });
      if (!res.success) {
        addToast('error', language === 'es' ? 'Error al Guardar' : 'Save Failed', res.error || 'Unable to save operating hours.');
        return res;
      }
      setLiveTenants(prev =>
        prev.map(t =>
          t.id === currentTenant.id
            ? { ...t, settings: { ...t.settings, operatingHours: nextHours } }
            : t
        )
      );
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'update_business_hours',
          entityType: 'business_hours',
          entityId: currentTenant.id,
        });
      }
    } else {
      setTenants(prev =>
        prev.map(t =>
          t.id === currentTenant.id
            ? { ...t, settings: { ...t.settings, operatingHours: nextHours } }
            : t
        )
      );
    }

    addToast(
      'success',
      language === 'es' ? 'Horarios Guardados' : 'Operating Hours Saved',
      language === 'es' ? 'Los horarios semanales han sido actualizados.' : 'Weekly operating hours have been updated.'
    );
    return { success: true };
  };

  const saveSpecialHours = async (
    nextSpecialHours: SpecialBusinessHours[]
  ): Promise<{ success: boolean; error?: string }> => {
    if (mode === 'supabase' && !canManageBusinessSettings) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'Solo propietarios o súper administradores pueden editar horarios especiales.'
            : 'Only Business Owners or Super Admins can modify special hours.',
      };
    }

    const sanitizedResult = sanitizeSpecialHoursPayload(nextSpecialHours);
    if (sanitizedResult.ok === false) {
      return { success: false, error: sanitizedResult.error };
    }

    if (mode === 'supabase') {
      const res = await updateBusinessProfileInSupabase(currentTenant.id, {
        specialHours: sanitizedResult.items,
      });
      if (!res.success) {
        addToast('error', language === 'es' ? 'Error al Guardar' : 'Save Failed', res.error || 'Unable to save special hours.');
        return res;
      }
      setLiveTenants(prev =>
        prev.map(t =>
          t.id === currentTenant.id
            ? { ...t, settings: { ...t.settings, specialHours: sanitizedResult.items } }
            : t
        )
      );
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'update_special_hours',
          entityType: 'businesses',
          entityId: currentTenant.id,
          metadata: { count: sanitizedResult.items.length },
        });
      }
    } else {
      setTenants(prev =>
        prev.map(t =>
          t.id === currentTenant.id
            ? { ...t, settings: { ...t.settings, specialHours: sanitizedResult.items } }
            : t
        )
      );
    }

    addToast(
      'success',
      language === 'es' ? 'Horarios Especiales Guardados' : 'Special Hours Saved',
      language === 'es' ? 'Los días especiales y feriados han sido actualizados.' : 'Special hours and holidays have been saved.'
    );
    return { success: true };
  };

  const saveBookingPolicies = async (input: {
    bufferBetweenAppointmentsMinutes: number;
    cancellationBufferHours: number;
    bookingInstructions: string;
    locationTypes: LocationType[];
    defaultLanguage?: Language;
    aiAssistant?: AiAssistantSettings;
  }): Promise<{ success: boolean; error?: string }> => {
    if (mode === 'supabase' && !canManageBusinessSettings) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'Solo propietarios o súper administradores pueden editar las políticas de reserva.'
            : 'Only Business Owners or Super Admins can modify booking policies.',
      };
    }

    const bufferMin = Number(input.bufferBetweenAppointmentsMinutes);
    const cancelHrs = Number(input.cancellationBufferHours);
    if (!Number.isFinite(bufferMin) || !Number.isInteger(bufferMin) || bufferMin < 0) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'El tiempo de preparación entre citas debe ser un número entero mayor o igual a 0.'
            : 'Buffer between appointments must be a non-negative whole integer.',
      };
    }
    if (!Number.isFinite(cancelHrs) || !Number.isInteger(cancelHrs) || cancelHrs < 0) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'La ventana de cancelación debe ser un número entero mayor o igual a 0.'
            : 'Cancellation notice hours must be a non-negative whole integer.',
      };
    }

    const validLocations = normalizeLocationTypesList(input.locationTypes, []);
    if (validLocations.length === 0) {
      return {
        success: false,
        error:
          language === 'es'
            ? 'Selecciona al menos una modalidad de atención.'
            : 'Select at least one supported appointment location.',
      };
    }

    const payload: Record<string, any> = {
      bufferBetweenAppointmentsMinutes: bufferMin,
      cancellationBufferHours: cancelHrs,
      bookingInstructions: input.bookingInstructions.trim(),
      locationTypes: validLocations,
      ...(input.defaultLanguage ? { defaultLanguage: input.defaultLanguage } : {}),
      ...(input.aiAssistant ? { aiAssistant: input.aiAssistant } : {}),
    };

    if (mode === 'supabase') {
      const res = await updateBusinessProfileInSupabase(currentTenant.id, payload);
      if (!res.success) {
        addToast('error', language === 'es' ? 'Error al Guardar' : 'Save Failed', res.error || 'Unable to save booking policies.');
        return res;
      }
    }

    const applyUpdate = (t: Tenant): Tenant =>
      t.id !== currentTenant.id
        ? t
        : {
            ...t,
            defaultLanguage: input.defaultLanguage ?? t.defaultLanguage,
            settings: {
              ...t.settings,
              bufferBetweenAppointmentsMinutes: bufferMin,
              cancellationBufferHours: cancelHrs,
              bookingInstructions: payload.bookingInstructions,
              locationTypes: validLocations,
              ...(input.aiAssistant ? { aiAssistant: input.aiAssistant } : {}),
            },
          };

    if (mode === 'supabase') {
      setLiveTenants(prev => prev.map(applyUpdate));
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'update_booking_policies',
          entityType: 'businesses',
          entityId: currentTenant.id,
        });
      }
    } else {
      setTenants(prev => prev.map(applyUpdate));
    }

    addToast(
      'success',
      language === 'es' ? 'Políticas Guardadas' : 'Policies Saved',
      language === 'es' ? 'Las políticas de reserva han sido actualizadas.' : 'Booking policies have been saved.'
    );
    return { success: true };
  };

  const createBusinessAsSuperAdmin = async (input: {
    name: string;
    category?: string;
    categoryLabelEn?: string;
    categoryLabelEs?: string;
    customCategoryName?: string;
    timezone?: string;
    defaultLanguage?: 'en' | 'es';
    phone?: string;
    email?: string;
    address?: string;
    tagline?: string;
    description?: string;
    logo?: string;
    ownerEmail?: string;
    ownerRole?: 'owner' | 'admin' | 'manager' | 'staff';
  }): Promise<{ success: boolean; businessId?: string; inviteResult?: InviteOwnerResult; error?: string }> => {
    if (mode !== 'supabase' || !isSuperAdmin) {
      return { success: false, error: 'Super Admin authorization required.' };
    }
    const res = await createBusinessAsSuperAdminInSupabase(input);
    if (!res.success || !res.business) {
      return { success: false, error: res.error };
    }

    let inviteResult: InviteOwnerResult | undefined;
    const trimmedOwnerEmail = input.ownerEmail?.trim();
    if (trimmedOwnerEmail) {
      inviteResult = await invokeInviteOwnerEdgeFunction({
        action: 'invite_owner',
        businessId: res.business.id,
        email: trimmedOwnerEmail,
        role: input.ownerRole || 'owner',
      });
    }

    await refreshAccessProfile();
    await reloadBusinessInvitations(res.business.id);
    addToast(
      'success',
      language === 'es' ? 'Negocio Creado' : 'Business Created',
      res.business.name
    );

    if (inviteResult) {
      if (inviteResult.success) {
        addToast(
          'success',
          language === 'es' ? 'Invitación Procesada' : 'Owner Invitation Processed',
          inviteResult.message || trimmedOwnerEmail!
        );
      } else {
        addToast(
          'warning',
          language === 'es' ? 'Negocio creado, invitación fallida' : 'Business Created — Invite Failed',
          inviteResult.error || 'Could not send owner invitation.'
        );
      }
    }

    return { success: true, businessId: res.business.id, inviteResult };
  };

  const toggleBusinessActive = async (
    businessId: string,
    nextActive: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    if (mode === 'supabase') {
      if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
        return { success: false, error: 'Super Admin authorization required.' };
      }
      const serverCheck = await verifyCurrentUserIsSuperAdmin();
      if (!serverCheck.isSuperAdmin) {
        return { success: false, error: serverCheck.error || 'Server Super Admin verification failed.' };
      }
      const target = liveTenants.find(t => t.id === businessId);
      if (!target) {
        return { success: false, error: 'Target business not found.' };
      }
      const res = await toggleBusinessActiveInSupabase(target, nextActive);
      if (!res.success) {
        addToast('error', t.common.error, res.error || 'Failed to update business status.');
        return res;
      }
      setLiveTenants(prev =>
        prev.map(t =>
          t.id === businessId
            ? { ...t, isActive: nextActive, settings: { ...t.settings, isSuspended: !nextActive } }
            : t
        )
      );
      await reloadAuditLogs(businessId);
      addToast(
        nextActive ? 'success' : 'warning',
        nextActive
          ? (language === 'es' ? 'Negocio Activado' : 'Business Activated')
          : (language === 'es' ? 'Negocio Suspendido' : 'Business Suspended'),
        target.name
      );
      return { success: true };
    }

    if (!currentUser?.isSuperAdmin && modeRef.current !== 'demo') {
      return { success: false, error: 'Super Admin authorization required.' };
    }

    setTenants(prev =>
      prev.map(t =>
        t.id === businessId
          ? { ...t, isActive: nextActive, settings: { ...t.settings, isSuspended: !nextActive } }
          : t
      )
    );
    return { success: true };
  };

  const updateBusinessMessagingConfig = useCallback(
    async (input: {
      businessId: string;
      a2pStatus: A2pApprovalStatus;
      smsOptInEnabled: boolean;
      autoSendEnabled: boolean;
      consentDisclosureVersion: string;
      campaignSid?: string;
      messagingServiceSid?: string;
    }): Promise<{ success: boolean; error?: string }> => {
      if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
        return { success: false, error: 'Super Admin authorization required.' };
      }
      const targetBiz = (mode === 'supabase' ? liveTenants : tenants).find(b => b.id === input.businessId);
      if (!targetBiz) {
        return { success: false, error: 'Business workspace not found.' };
      }
      const optedInCount = smsConsentSummariesByBizId[input.businessId]?.optedInCount || 0;

      if (mode !== 'supabase') {
        if (input.autoSendEnabled) {
          if (targetBiz.isActive === false) {
            return { success: false, error: 'Cannot enable outbound auto-send for a suspended business.' };
          }
          if (input.a2pStatus !== 'approved') {
            return { success: false, error: 'A2P 10DLC status must be Approved before enabling automated outbound SMS.' };
          }
          if (!input.smsOptInEnabled) {
            return { success: false, error: 'SMS opt-in must be enabled before enabling automated outbound SMS.' };
          }
          if (!input.campaignSid?.trim() || !input.messagingServiceSid?.trim()) {
            return { success: false, error: 'Campaign SID and Messaging Service SID are required before enabling automated outbound SMS.' };
          }
          if (optedInCount <= 0) {
            return { success: false, error: 'At least one opted-in customer consent record is required before enabling outbound SMS.' };
          }
        }
        const nextCfg: BusinessMessagingConfig = {
          businessId: input.businessId,
          a2pStatus: input.a2pStatus,
          smsOptInEnabled: input.smsOptInEnabled,
          autoSendEnabled: input.autoSendEnabled,
          consentDisclosureVersion: input.consentDisclosureVersion || 'v1.0',
          campaignSid: input.campaignSid?.trim() || undefined,
          messagingServiceSid: input.messagingServiceSid?.trim() || undefined,
          approvedAt: input.a2pStatus === 'approved' ? new Date().toISOString() : undefined,
          updatedAt: new Date().toISOString(),
          persistedInBackend: false,
        };
        setMessagingConfigsByBizId(prev => ({ ...prev, [input.businessId]: nextCfg }));
        return { success: true };
      }

      const res = await updateBusinessMessagingConfigInSupabase({
        businessId: input.businessId,
        businessIsActive: targetBiz.isActive !== false,
        a2pStatus: input.a2pStatus,
        smsOptInEnabled: input.smsOptInEnabled,
        autoSendEnabled: input.autoSendEnabled,
        consentDisclosureVersion: input.consentDisclosureVersion,
        campaignSid: input.campaignSid,
        messagingServiceSid: input.messagingServiceSid,
        optedInConsentCount: optedInCount,
      });
      if (res.success && res.config) {
        setMessagingConfigsByBizId(prev => ({ ...prev, [input.businessId]: res.config! }));
        await reloadAuditLogs(input.businessId);
        addToast(
          'success',
          language === 'es' ? 'Configuración SMS / A2P Guardada' : 'SMS / A2P Configuration Saved',
          targetBiz.name
        );
      } else if (res.error) {
        addToast('error', t.common.error, res.error);
      }
      return { success: res.success, error: res.error };
    },
    [
      currentUser?.isSuperAdmin,
      isSuperAdminCheckFailed,
      mode,
      liveTenants,
      tenants,
      smsConsentSummariesByBizId,
      reloadAuditLogs,
      language,
    ]
  );

  const updateBusinessCommunicationChannels = useCallback(
    async (
      businessId: string,
      nextChannels: BusinessCommunicationChannels
    ): Promise<{ success: boolean; error?: string }> => {
      if (!currentUser?.isSuperAdmin || isSuperAdminCheckFailed) {
        return { success: false, error: 'Super Admin authorization required.' };
      }
      const targetBiz = (mode === 'supabase' ? liveTenants : tenants).find(b => b.id === businessId);
      if (!targetBiz) {
        return { success: false, error: 'Business workspace not found.' };
      }

      if (mode !== 'supabase') {
        const nowIso = new Date().toISOString();
        const sanitizedDemo: BusinessCommunicationChannels = {
          whatsapp: {
            provider: nextChannels.whatsapp.provider || 'whatsapp_cloud',
            displayPhoneNumber: nextChannels.whatsapp.displayPhoneNumber?.trim() || undefined,
            businessAccountLabel: nextChannels.whatsapp.businessAccountLabel?.trim() || undefined,
            notes: nextChannels.whatsapp.notes?.trim() || undefined,
            status:
              targetBiz.isActive === false
                ? 'suspended'
                : nextChannels.whatsapp.displayPhoneNumber?.trim() ||
                  nextChannels.whatsapp.businessAccountLabel?.trim()
                ? 'pending_backend'
                : 'not_configured',
            verifiedByBackend: false,
            lastCheckedAt: nowIso,
          },
          sms: {
            provider: nextChannels.sms.provider || 'twilio_a2p',
            fromPhoneNumber: nextChannels.sms.fromPhoneNumber?.trim() || undefined,
            status:
              targetBiz.isActive === false
                ? 'suspended'
                : nextChannels.sms.fromPhoneNumber?.trim()
                ? 'pending_backend'
                : 'not_configured',
            verifiedByBackend: false,
            lastCheckedAt: nowIso,
          },
          webChat: {
            enabled: Boolean(nextChannels.webChat.enabled),
            widgetPublicId: nextChannels.webChat.widgetPublicId?.trim() || undefined,
            allowedOrigins: nextChannels.webChat.allowedOrigins?.filter(Boolean) || undefined,
            status:
              targetBiz.isActive === false
                ? 'suspended'
                : nextChannels.webChat.enabled || nextChannels.webChat.widgetPublicId?.trim()
                ? 'pending_backend'
                : 'not_configured',
            verifiedByBackend: false,
            lastCheckedAt: nowIso,
          },
        };
        setTenants(prev =>
          prev.map(b =>
            b.id === businessId
              ? { ...b, settings: { ...b.settings, communicationChannels: sanitizedDemo } }
              : b
          )
        );
        return { success: true };
      }

      const res = await updateBusinessCommunicationChannelsInSupabase(targetBiz, nextChannels);
      if (res.success && res.channels) {
        setLiveTenants(prev =>
          prev.map(b =>
            b.id === businessId
              ? { ...b, settings: { ...b.settings, communicationChannels: res.channels } }
              : b
          )
        );
        await reloadAuditLogs(businessId);
        addToast(
          'success',
          language === 'es' ? 'Canales Actualizados' : 'Channels Updated',
          targetBiz.name
        );
      } else if (res.error) {
        addToast('error', t.common.error, res.error);
      }
      return { success: res.success, error: res.error };
    },
    [currentUser?.isSuperAdmin, isSuperAdminCheckFailed, mode, liveTenants, tenants, reloadAuditLogs, language]
  );

  const inviteBusinessOwner = async (input: {
    businessId: string;
    email: string;
    role: 'owner' | 'admin' | 'manager' | 'staff';
  }): Promise<InviteOwnerResult> => {
    if (mode !== 'supabase' || !isSuperAdmin) {
      return { success: false, error: 'Super Admin authorization required.' };
    }
    const res = await invokeInviteOwnerEdgeFunction({
      action: 'invite_owner',
      businessId: input.businessId,
      email: input.email,
      role: input.role,
    });
    await Promise.all([
      reloadBusinessInvitations(input.businessId),
      reloadBusinessMembers(input.businessId),
      reloadBusinessOwners(),
      reloadAuditLogs(input.businessId),
    ]);
    if (res.success) {
      addToast(
        'success',
        language === 'es' ? 'Invitación Enviada' : 'Invitation Processed',
        res.message || input.email
      );
    }
    return res;
  };

  const assignExistingUserToBusiness = async (input: {
    businessId: string;
    email: string;
    role: 'owner' | 'admin' | 'manager' | 'staff';
  }): Promise<InviteOwnerResult> => {
    if (mode !== 'supabase' || !isSuperAdmin) {
      return { success: false, error: 'Super Admin authorization required.' };
    }
    const res = await invokeInviteOwnerEdgeFunction({
      action: 'assign_existing_user',
      businessId: input.businessId,
      email: input.email,
      role: input.role,
    });
    await Promise.all([
      reloadBusinessInvitations(input.businessId),
      reloadBusinessMembers(input.businessId),
      reloadBusinessOwners(),
      reloadAuditLogs(input.businessId),
    ]);
    if (res.success) {
      addToast(
        'success',
        language === 'es' ? 'Usuario Asignado' : 'Existing User Assigned',
        res.message || input.email
      );
    }
    return res;
  };

  const resendBusinessInvitation = async (
    invitationId: string,
    filterBusinessId?: string
  ): Promise<InviteOwnerResult> => {
    if (mode !== 'supabase' || !isSuperAdmin) {
      return { success: false, error: 'Super Admin authorization required.' };
    }
    const res = await invokeInviteOwnerEdgeFunction({
      action: 'resend_invitation',
      invitationId,
    });
    await Promise.all([
      reloadBusinessInvitations(filterBusinessId),
      reloadBusinessMembers(filterBusinessId),
      reloadAuditLogs(filterBusinessId),
    ]);
    if (res.success) {
      addToast(
        'success',
        language === 'es' ? 'Invitación Reenviada' : 'Invitation Resent',
        res.message || 'Invitation link refreshed and sent.'
      );
    }
    return res;
  };

  const revokeBusinessInvitation = async (
    invitationId: string,
    filterBusinessId?: string
  ): Promise<InviteOwnerResult> => {
    if (mode !== 'supabase' || !isSuperAdmin) {
      return { success: false, error: 'Super Admin authorization required.' };
    }
    const res = await invokeInviteOwnerEdgeFunction({
      action: 'revoke_invitation',
      invitationId,
    });
    await Promise.all([
      reloadBusinessInvitations(filterBusinessId),
      reloadAuditLogs(filterBusinessId),
    ]);
    if (res.success) {
      addToast(
        'info',
        language === 'es' ? 'Invitación Revocada' : 'Invitation Revoked',
        res.message || 'Invitation revoked.'
      );
    }
    return res;
  };

  const assignBusinessMember = async (
    businessId: string,
    email: string,
    role: 'owner' | 'admin' | 'manager' | 'staff'
  ) => {
    if (mode !== 'supabase' || !canManageStaff) {
      return { success: false, error: 'Insufficient permissions to assign members.' };
    }
    if ((role === 'owner' || role === 'admin') && !isSuperAdmin) {
      return { success: false, error: 'Only Super Admins can assign owner or admin roles.' };
    }
    const res = await assignBusinessMemberInSupabase(businessId, email, role);
    if (res.success) {
      await reloadBusinessMembers(businessId);
      if (isSuperAdmin) await reloadBusinessOwners();
      addToast(
        'success',
        language === 'es' ? 'Miembro Asignado' : 'Member Assigned',
        `${email} (${role})`
      );
    }
    return res;
  };

  const removeBusinessMember = async (businessId: string, targetUserId: string) => {
    if (mode !== 'supabase' || !canManageStaff) {
      return { success: false, error: 'Insufficient permissions to remove members.' };
    }
    const res = await removeBusinessMemberInSupabase(businessId, targetUserId);
    if (res.success) {
      await reloadBusinessMembers(businessId);
      if (isSuperAdmin) await reloadBusinessOwners();
      addToast(
        'info',
        language === 'es' ? 'Miembro Eliminado' : 'Member Removed',
        language === 'es' ? 'Acceso actualizado.' : 'Business access updated.'
      );
    }
    return res;
  };

  // Filtered lists strictly isolated by DataSourceMode (Demo vs Live Supabase)
  const tenantCustomers = useMemo(() => {
    if (mode === 'supabase') {
      if (!currentUser || hasNoBusinessMembership || !currentTenant.id) return [];
      return liveCustomers;
    }
    return customers.filter(c => c.tenantId === currentTenant.id);
  }, [mode, currentUser, hasNoBusinessMembership, currentTenant.id, liveCustomers, customers]);

  const tenantServices = useMemo(() => {
    if (mode === 'supabase') {
      if (!currentUser || hasNoBusinessMembership || !currentTenant.id) return [];
      return liveServices;
    }
    return services.filter(s => s.tenantId === currentTenant.id);
  }, [mode, currentUser, hasNoBusinessMembership, currentTenant.id, liveServices, services]);

  const activeServicesCount = useMemo(() => {
    if (mode === 'supabase') {
      if (!currentUser || hasNoBusinessMembership || !currentTenant.id) return 0;
      if (liveServices.length > 0) {
        return liveServices.filter(s => s.active).length;
      }
      return liveActiveServicesCount ?? 0;
    }
    return services.filter(s => s.tenantId === currentTenant.id && s.active).length;
  }, [mode, currentUser, hasNoBusinessMembership, currentTenant.id, liveServices, liveActiveServicesCount, services]);

  const markSingleSupportNotificationRead = useCallback(
    async (notificationId: string) => {
      const targetNotif = supportNotifications.find(n => n.id === notificationId);
      if (mode === 'supabase') {
        await markSupportNotificationReadByIdInSupabase(notificationId);
      }

      const remaining = supportNotifications.filter(n => n.id !== notificationId);
      setSupportNotifications(remaining);

      if (targetNotif?.ticketId) {
        const hasRemainingForTicket = remaining.some(
          n =>
            !n.isRead &&
            n.ticketId === targetNotif.ticketId &&
            n.targetRole === targetNotif.targetRole
        );
        if (!hasRemainingForTicket) {
          const updateFn = (list: SupportTicket[]) =>
            list.map(tkt =>
              tkt.id === targetNotif.ticketId
                ? {
                    ...tkt,
                    unreadByAdmin:
                      targetNotif.targetRole === 'super_admin' ? false : tkt.unreadByAdmin,
                    unreadByBusiness:
                      targetNotif.targetRole === 'business' ? false : tkt.unreadByBusiness,
                  }
                : tkt
            );
          if (mode === 'supabase') {
            setLiveSupportTickets(updateFn);
          } else {
            setDemoSupportTickets(updateFn);
          }
        }
      }
    },
    [mode, supportNotifications]
  );

  const markSupportNotificationsRead = useCallback(async () => {
    if (mode === 'supabase') {
      await markSupportNotificationsReadInSupabase({
        targetRole: canViewPlatformAdmin ? 'super_admin' : 'business',
        businessId: canViewPlatformAdmin ? undefined : currentTenant.id,
      });
      setLiveSupportTickets(prev =>
        prev.map(tkt => {
          if (canViewPlatformAdmin) {
            return { ...tkt, unreadByAdmin: false };
          }
          return tkt.businessId === currentTenant.id ? { ...tkt, unreadByBusiness: false } : tkt;
        })
      );
    } else {
      setDemoSupportTickets(prev =>
        prev.map(tkt => {
          if (canViewPlatformAdmin) {
            return { ...tkt, unreadByAdmin: false };
          }
          return tkt.businessId === currentTenant.id ? { ...tkt, unreadByBusiness: false } : tkt;
        })
      );
    }
    setSupportNotifications(prev =>
      prev.filter(n =>
        canViewPlatformAdmin
          ? n.targetRole !== 'super_admin'
          : !(n.targetRole === 'business' && n.businessId === currentTenant.id)
      )
    );
  }, [mode, canViewPlatformAdmin, currentTenant.id]);

  const markSingleBusinessNotificationRead = useCallback(
    async (notificationId: string) => {
      const nowIso = new Date().toISOString();
      setBusinessNotifications(prev =>
        prev.map(n =>
          n.id === notificationId
            ? {
                ...n,
                read: true,
                readAt: n.readAt || nowIso,
                readByUserId: currentUser?.id,
              }
            : n
        )
      );

      if (mode === 'supabase' && currentUser?.id && !currentUser.isSuperAdmin && currentTenant.id) {
        await markBookingNotificationReadInSupabase({
          notificationId,
          businessId: currentTenant.id,
          userId: currentUser.id,
        });
      }
    },
    [mode, currentUser?.id, currentUser?.isSuperAdmin, currentTenant.id]
  );

  const markBusinessNotificationsRead = useCallback(() => {
    const unreadIds = businessNotifications
      .filter(n => n.businessId === currentTenant.id && !n.read)
      .map(n => n.id);
    const nowIso = new Date().toISOString();

    setBusinessNotifications(prev =>
      prev.map(n =>
        n.businessId === currentTenant.id
          ? {
              ...n,
              read: true,
              readAt: n.readAt || nowIso,
              readByUserId: currentUser?.id,
            }
          : n
      )
    );

    if (
      mode === 'supabase' &&
      currentUser?.id &&
      !currentUser.isSuperAdmin &&
      currentTenant.id &&
      unreadIds.length > 0
    ) {
      markAllBookingNotificationsReadInSupabase({
        notificationIds: unreadIds,
        businessId: currentTenant.id,
        userId: currentUser.id,
      }).catch(() => {});
    }

    markSupportNotificationsRead();
  }, [
    businessNotifications,
    currentTenant.id,
    mode,
    currentUser?.id,
    currentUser?.isSuperAdmin,
    markSupportNotificationsRead,
  ]);

  const clearBusinessNotification = useCallback((id: string) => {
    setBusinessNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Unified Support Tickets Workflow (2-Way Business <-> Super Admin)
  const supportTickets = useMemo(() => {
    if (mode === 'supabase') {
      if (canViewPlatformAdmin) return liveSupportTickets;
      return liveSupportTickets.filter(tkt => tkt.businessId === currentTenant.id);
    }
    if (canViewPlatformAdmin) return demoSupportTickets;
    return demoSupportTickets.filter(tkt => tkt.businessId === currentTenant.id);
  }, [mode, canViewPlatformAdmin, liveSupportTickets, demoSupportTickets, currentTenant.id]);

  const supportMessagesByTicket = useMemo(() => {
    return mode === 'supabase' ? liveSupportMessages : demoSupportMessages;
  }, [mode, liveSupportMessages, demoSupportMessages]);

  const supportStatusHistoryByTicket = useMemo(() => {
    return mode === 'supabase' ? liveSupportStatusHistory : demoSupportStatusHistory;
  }, [mode, liveSupportStatusHistory, demoSupportStatusHistory]);

  const createSupportTicket = useCallback(
    async (input: {
      category: SupportTicketCategory;
      subject: string;
      description: string;
      priority: SupportTicketPriority;
    }): Promise<{ success: boolean; ticket?: SupportTicket; error?: string }> => {
      if (isCreatingSupportTicketRef.current) {
        return {
          success: false,
          error:
            language === 'es'
              ? 'Tu solicitud ya se está enviando. Espera un momento.'
              : 'Your request is already being submitted. Please wait.',
        };
      }

      if (!currentTenant.id) {
        return {
          success: false,
          error:
            language === 'es'
              ? 'Selecciona un negocio antes de enviar una solicitud.'
              : 'Please select a business before submitting a request.',
        };
      }

      const validation = validateSupportTicketInput(input, language);
      if (!validation.valid || !validation.normalized) {
        return {
          success: false,
          error: validation.error || 'Please check the support request fields.',
        };
      }

      isCreatingSupportTicketRef.current = true;
      try {
        if (mode === 'supabase') {
          const res = await createSupportTicketInSupabase({
            businessId: currentTenant.id,
            category: validation.normalized.category,
            subject: validation.normalized.subject,
            description: validation.normalized.description,
            priority: validation.normalized.priority,
            senderName: currentUser?.email,
          });
          if (!res.success || !res.ticket) {
            return { success: false, error: res.error || 'Unable to submit request.' };
          }
          setLiveSupportTickets(prev => {
            if (prev.some(tkt => tkt.id === res.ticket!.id)) return prev;
            return [res.ticket!, ...prev];
          });
          addToast(
            'success',
            language === 'es' ? 'Solicitud Enviada' : 'Support Request Submitted',
            res.ticket.subject
          );
          return { success: true, ticket: res.ticket };
        }

        const nowIso = new Date().toISOString();
        const newTicket: SupportTicket = {
          id: `tkt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          businessId: currentTenant.id,
          businessName: currentTenant.name,
          createdBy: currentUser?.id || 'demo-user',
          createdByName: currentUser?.email || currentTenant.name,
          category: validation.normalized.category,
          subject: validation.normalized.subject,
          description: validation.normalized.description,
          priority: validation.normalized.priority,
          status: 'open',
          lastMessageAt: nowIso,
          unreadByBusiness: false,
          unreadByAdmin: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        setDemoSupportTickets(prev => [newTicket, ...prev]);
        setSupportNotifications(prev => [
          {
            id: `snotif-${Date.now()}`,
            businessId: currentTenant.id,
            targetRole: 'super_admin',
            ticketId: newTicket.id,
            title: `New Support Request · ${currentTenant.name}`,
            body: newTicket.subject,
            isRead: false,
            createdAt: nowIso,
          },
          ...prev,
        ]);
        addToast(
          'success',
          language === 'es' ? 'Solicitud Enviada' : 'Support Request Submitted',
          newTicket.subject
        );
        return { success: true, ticket: newTicket };
      } finally {
        isCreatingSupportTicketRef.current = false;
      }
    },
    [mode, currentTenant.id, currentTenant.name, currentUser?.id, currentUser?.email, language]
  );

  const loadTicketMessages = useCallback(
    async (ticketId: string): Promise<SupportTicketMessage[]> => {
      if (mode === 'supabase') {
        const res = await fetchSupportTicketMessagesInSupabase(ticketId);
        setLiveSupportMessages(prev => ({
          ...prev,
          [ticketId]: res.messages,
        }));
        return res.messages;
      }
      return demoSupportMessages[ticketId] || [];
    },
    [mode, demoSupportMessages]
  );

  const loadTicketStatusHistory = useCallback(
    async (ticketId: string): Promise<SupportTicketStatusHistoryEntry[]> => {
      if (mode === 'supabase') {
        const res = await fetchSupportTicketStatusHistoryInSupabase(ticketId);
        setLiveSupportStatusHistory(prev => ({
          ...prev,
          [ticketId]: res.history,
        }));
        return res.history;
      }
      return demoSupportStatusHistory[ticketId] || [];
    },
    [mode, demoSupportStatusHistory]
  );

  const fetchAndSelectTicket = useCallback(
    async (ticketId: string): Promise<SupportTicket | null> => {
      const sourceList = mode === 'supabase' ? liveSupportTickets : demoSupportTickets;
      const existing = sourceList.find(tkt => tkt.id === ticketId);
      if (existing) return existing;
      if (mode !== 'supabase') return null;

      const res = await fetchSupportTicketByIdInSupabase(ticketId);
      if (res.ticket) {
        setLiveSupportTickets(prev => {
          if (prev.some(tkt => tkt.id === res.ticket!.id)) return prev;
          return [res.ticket!, ...prev];
        });
        return res.ticket;
      }
      return null;
    },
    [mode, liveSupportTickets, demoSupportTickets]
  );

  const sendTicketReply = useCallback(
    async (
      ticketId: string,
      businessId: string,
      message: string
    ): Promise<{ success: boolean; messageRecord?: SupportTicketMessage; error?: string }> => {
      const trimmed = message.trim();
      if (!trimmed) {
        return {
          success: false,
          error: language === 'es' ? 'El mensaje no puede estar vacío.' : 'Message cannot be empty.',
        };
      }

      const targetTicket = (mode === 'supabase' ? liveSupportTickets : demoSupportTickets).find(
        tkt => tkt.id === ticketId
      );
      if (targetTicket?.status === 'closed') {
        return {
          success: false,
          error:
            language === 'es'
              ? 'Esta solicitud está cerrada y ya no acepta respuestas.'
              : 'This support request is closed and can no longer receive replies.',
        };
      }

      const senderRole: SupportTicketMessage['senderRole'] = canViewPlatformAdmin
        ? 'super_admin'
        : canManageBusinessSettings
        ? 'business_owner'
        : 'business_staff';

      if (mode === 'supabase') {
        const res = await sendSupportTicketMessageInSupabase({
          ticketId,
          businessId,
          senderRole,
          senderName: canViewPlatformAdmin ? 'Novacode Tech Support' : currentUser?.email || currentTenant.name,
          message: trimmed,
        });
        if (!res.success || !res.messageRecord) {
          return { success: false, error: res.error || 'Unable to send reply.' };
        }
        setLiveSupportMessages(prev => {
          const existing = prev[ticketId] || [];
          if (existing.some(m => m.id === res.messageRecord!.id)) return prev;
          return {
            ...prev,
            [ticketId]: [...existing, res.messageRecord!],
          };
        });
        setLiveSupportTickets(prev =>
          prev.map(tkt =>
            tkt.id === ticketId
              ? {
                  ...tkt,
                  lastMessageAt: res.messageRecord!.createdAt,
                  unreadByBusiness: senderRole === 'super_admin',
                  unreadByAdmin: senderRole !== 'super_admin',
                }
              : tkt
          )
        );
        return { success: true, messageRecord: res.messageRecord };
      }

      const nowIso = new Date().toISOString();
      const msgRecord: SupportTicketMessage = {
        id: `tmsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ticketId,
        businessId,
        senderId: currentUser?.id || 'demo-user',
        senderRole,
        senderName: canViewPlatformAdmin ? 'Novacode Tech Support' : currentUser?.email || currentTenant.name,
        message: trimmed,
        createdAt: nowIso,
      };
      setDemoSupportMessages(prev => ({
        ...prev,
        [ticketId]: [...(prev[ticketId] || []), msgRecord],
      }));
      setDemoSupportTickets(prev =>
        prev.map(tkt =>
          tkt.id === ticketId
            ? {
                ...tkt,
                lastMessageAt: nowIso,
                unreadByBusiness: senderRole === 'super_admin',
                unreadByAdmin: senderRole !== 'super_admin',
              }
            : tkt
        )
      );

      if (senderRole === 'super_admin') {
        setSupportNotifications(prev => [
          {
            id: `snotif-rep-${Date.now()}`,
            businessId,
            targetRole: 'business',
            ticketId,
            title:
              language === 'es'
                ? 'Respuesta de Soporte Novacode Tech'
                : 'Novacode Tech Support Reply',
            body: trimmed.slice(0, 120),
            isRead: false,
            createdAt: nowIso,
          },
          ...prev,
        ]);
      } else {
        setSupportNotifications(prev => [
          {
            id: `snotif-rep-${Date.now()}`,
            businessId,
            targetRole: 'super_admin',
            ticketId,
            title: `Support Reply · ${currentTenant.name}`,
            body: trimmed.slice(0, 120),
            isRead: false,
            createdAt: nowIso,
          },
          ...prev,
        ]);
      }
      return { success: true, messageRecord: msgRecord };
    },
    [
      mode,
      liveSupportTickets,
      demoSupportTickets,
      canViewPlatformAdmin,
      canManageBusinessSettings,
      currentUser?.id,
      currentUser?.email,
      currentTenant.name,
      language,
    ]
  );

  const updateTicketStatus = useCallback(
    async (ticketId: string, status: SupportTicketStatus): Promise<{ success: boolean; error?: string }> => {
      if (!canViewPlatformAdmin) {
        return { success: false, error: 'Super Admin access required.' };
      }

      if (mode === 'supabase') {
        const res = await updateSupportTicketStatusInSupabase(ticketId, status);
        if (!res.success || !res.ticket) {
          return { success: false, error: res.error || 'Unable to update ticket status.' };
        }
        setLiveSupportTickets(prev => prev.map(tkt => (tkt.id === ticketId ? res.ticket! : tkt)));
        loadTicketStatusHistory(ticketId);
        addToast('success', language === 'es' ? 'Estado Actualizado' : 'Ticket Status Updated', status.replace(/_/g, ' '));
        return { success: true };
      }

      const nowIso = new Date().toISOString();
      let targetTicket: SupportTicket | undefined;
      let previousStatus: SupportTicketStatus | null = null;
      setDemoSupportTickets(prev =>
        prev.map(tkt => {
          if (tkt.id === ticketId) {
            previousStatus = tkt.status;
            targetTicket = { ...tkt, status, updatedAt: nowIso };
            return targetTicket;
          }
          return tkt;
        })
      );
      if (targetTicket) {
        setDemoSupportStatusHistory(prev => ({
          ...prev,
          [ticketId]: [
            ...(prev[ticketId] || []),
            {
              id: `thist-${Date.now()}`,
              ticketId,
              changedBy: currentUser?.id,
              oldStatus: previousStatus,
              newStatus: status,
              createdAt: nowIso,
            },
          ],
        }));
        setSupportNotifications(prev => [
          {
            id: `snotif-st-${Date.now()}`,
            businessId: targetTicket!.businessId,
            targetRole: 'business',
            ticketId,
            title:
              language === 'es'
                ? 'Actualización de Solicitud de Soporte'
                : 'Support Request Status Updated',
            body: `${targetTicket!.subject} → ${status.replace(/_/g, ' ')}`,
            isRead: false,
            createdAt: nowIso,
          },
          ...prev,
        ]);
      }
      return { success: true };
    },
    [canViewPlatformAdmin, mode, language, loadTicketStatusHistory, currentUser?.id]
  );

  const markTicketRead = useCallback(
    async (ticketId: string) => {
      const targetRole: 'super_admin' | 'business' = canViewPlatformAdmin ? 'super_admin' : 'business';
      if (mode === 'supabase') {
        await markSupportTicketReadInSupabase(ticketId, targetRole, currentTenant.id);
        setLiveSupportTickets(prev =>
          prev.map(tkt =>
            tkt.id === ticketId
              ? {
                  ...tkt,
                  unreadByAdmin: canViewPlatformAdmin ? false : tkt.unreadByAdmin,
                  unreadByBusiness: canViewPlatformAdmin ? tkt.unreadByBusiness : false,
                }
              : tkt
          )
        );
      } else {
        setDemoSupportTickets(prev =>
          prev.map(tkt =>
            tkt.id === ticketId
              ? {
                  ...tkt,
                  unreadByAdmin: canViewPlatformAdmin ? false : tkt.unreadByAdmin,
                  unreadByBusiness: canViewPlatformAdmin ? tkt.unreadByBusiness : false,
                }
              : tkt
          )
        );
      }

      setSupportNotifications(prev =>
        prev.filter(
          n => !(n.ticketId === ticketId && n.targetRole === targetRole)
        )
      );
      setBusinessNotifications(prev =>
        prev.map(n => (n.ticketId === ticketId ? { ...n, read: true } : n))
      );
    },
    [mode, canViewPlatformAdmin, currentTenant.id]
  );

  const tenantStaff = useMemo(() => {
    if (mode === 'supabase') {
      if (!currentUser || hasNoBusinessMembership || !currentTenant.id) return [];
      return [];
    }
    return staff.filter(st => st.tenantId === currentTenant.id && st.active);
  }, [mode, currentUser, hasNoBusinessMembership, currentTenant.id, staff]);

  const tenantAppointments = useMemo(() => {
    const resolveAppointmentSchedule = (apt: Appointment): Appointment => {
      const startParts = apt.rawStartTime
        ? extractDateAndTimeInTimezone(apt.rawStartTime, currentTenant.timezone)
        : {};
      const endParts = apt.rawEndTime
        ? extractDateAndTimeInTimezone(apt.rawEndTime, currentTenant.timezone)
        : {};
      const resolvedStartTime = startParts.time || apt.startTime;
      const resolvedEndTime = endParts.time || apt.endTime;
      const resolvedDate = startParts.date || apt.date || endParts.date || '';
      return {
        ...apt,
        date: resolvedDate,
        startTime: resolvedStartTime,
        endTime: resolvedEndTime,
        durationMinutes: getAppointmentDurationMinutes({
          startTime: resolvedStartTime,
          endTime: resolvedEndTime,
          rawStartTime: apt.rawStartTime,
          rawEndTime: apt.rawEndTime,
        }),
      };
    };

    if (mode === 'supabase') {
      if (!currentUser || hasNoBusinessMembership || !currentTenant.id) return [];
      return liveAppointments.map(apt => {
        const cust = apt.customerId ? liveCustomers.find(c => c.id === apt.customerId) : undefined;
        const svc = apt.serviceId ? liveServices.find(s => s.id === apt.serviceId) : undefined;
        const scheduled = resolveAppointmentSchedule(apt);
        return {
          ...scheduled,
          customerName: (scheduled.customerName && scheduled.customerName !== 'Customer') ? scheduled.customerName : (cust?.name || scheduled.customerName),
          customerPhone: scheduled.customerPhone || cust?.phone || '',
          customerLanguage: scheduled.customerLanguage || cust?.preferredLanguage || 'en',
          serviceName: (scheduled.serviceName && scheduled.serviceName !== 'Service')
            ? scheduled.serviceName
            : (svc ? (language === 'es' ? svc.nameEs : svc.nameEn) : scheduled.serviceName),
          price: scheduled.price || svc?.price || 0,
        };
      });
    }
    return appointments
      .filter(a => a.tenantId === currentTenant.id)
      .map(resolveAppointmentSchedule);
  }, [mode, currentUser, hasNoBusinessMembership, currentTenant.id, currentTenant.timezone, liveAppointments, liveCustomers, liveServices, language, appointments]);

  const tenantConversations = useMemo(() => {
    if (mode === 'supabase') {
      if (!currentUser || hasNoBusinessMembership || !currentTenant.id) return [];
      return [];
    }
    return conversations.filter(c => c.tenantId === currentTenant.id);
  }, [mode, currentUser, hasNoBusinessMembership, currentTenant.id, conversations]);

  // Conflict & Scheduling Rules Engine (operating hours, holidays, timezone, overlap, buffer)
  const isBookingConflict = (
    date: string,
    startTime: string,
    durationMinutes: number,
    staffId?: string,
    excludeAppointmentId?: string
  ): boolean => {
    const validation = validateBookingWindow({
      tenant: currentTenant,
      date,
      startTime,
      durationMinutes,
      appointments: tenantAppointments,
      staffId,
      excludeAppointmentId,
    });
    return !validation.valid;
  };

  // Demo-mode helper: emit deduplicated booking notifications ONLY on confirmed/cancelled/rescheduled events
  const emitDemoBookingNotification = useCallback(
    (
      apt: Appointment,
      eventType: 'appointment_confirmed' | 'appointment_cancelled' | 'appointment_rescheduled',
      dateOverride?: string,
      timeOverride?: string
    ) => {
      if (mode === 'supabase') return;
      const targetDate = dateOverride || apt.date;
      const targetTime = timeOverride || apt.startTime;
      const idempotencyKey = `demo:${apt.id}:${eventType}:${targetDate}:${targetTime}`;
      const dict = translations[language] || translations.en;
      const notifType: BusinessNotification['type'] =
        eventType === 'appointment_cancelled'
          ? 'appointment_cancelled'
          : eventType === 'appointment_rescheduled'
          ? 'appointment_updated'
          : 'appointment_confirmed';
      const title =
        eventType === 'appointment_cancelled'
          ? dict.dashboard.bookingCancelledTitle
          : eventType === 'appointment_rescheduled'
          ? dict.dashboard.bookingRescheduledTitle
          : dict.dashboard.bookingConfirmedTitle;
      const description = `${apt.customerName} · ${apt.serviceName} (${targetDate} @ ${targetTime})`;

      setBusinessNotifications(prev => {
        if (prev.some(n => n.idempotencyKey === idempotencyKey)) {
          return prev;
        }
        const entry: BusinessNotification = {
          id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          businessId: apt.tenantId,
          type: notifType,
          eventType,
          idempotencyKey,
          title,
          description,
          appointmentId: apt.id,
          customerName: apt.customerName,
          serviceName: apt.serviceName,
          appointmentDate: targetDate,
          appointmentStartTime: targetTime,
          appointmentEndTime: apt.endTime,
          appointmentStatus: apt.status,
          createdAt: new Date().toISOString(),
          read: false,
        };
        return [entry, ...prev].slice(0, 50);
      });
    },
    [mode, language]
  );

  // ---------------------------------------------------------------------------
  // Add Appointment (Authorized Supabase Booking RPC in live mode, local in demo mode)
  // ---------------------------------------------------------------------------
  const addAppointment = async (appData: Omit<Appointment, 'id' | 'createdAt' | 'tenantId'>) => {
    const targetService = tenantServices.find(s => s.id === appData.serviceId);
    if (targetService && !targetService.active) {
      return {
        success: false,
        error: translations[language].services.inactiveBookError,
      };
    }

    const resolvedBookingDuration =
      getAppointmentDurationMinutes(appData) ?? appData.durationMinutes ?? targetService?.durationMinutes ?? 0;

    const scheduleCheck = validateBookingWindow({
      tenant: currentTenant,
      date: appData.date,
      startTime: appData.startTime,
      durationMinutes: resolvedBookingDuration,
      appointments: tenantAppointments,
      staffId: appData.staffId,
      service: targetService,
    });

    if (!scheduleCheck.valid) {
      return {
        success: false,
        error: formatBookingValidationError(scheduleCheck, language),
      };
    }

    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentUser || hasNoBusinessMembership || !currentTenant.id) {
        return {
          success: false,
          error: language === 'es'
            ? 'Debes iniciar sesión con un negocio autorizado para agendar citas.'
            : 'You must be signed in to an authorized business to create bookings.',
        };
      }

      const res = await createBookingWithSupabase({
        businessId: currentTenant.id,
        customerId: appData.customerId,
        customerName: appData.customerName,
        customerPhone: appData.customerPhone,
        customerLanguage: appData.customerLanguage,
        serviceId: appData.serviceId,
        serviceName: appData.serviceName,
        staffId: appData.staffId,
        staffName: appData.staffName,
        date: appData.date,
        startTime: appData.startTime,
        endTime: appData.endTime,
        durationMinutes: resolvedBookingDuration,
        price: appData.price,
        locationType: appData.locationType,
        address: appData.address,
        notes: appData.notes,
        source: appData.source,
        timezone: currentTenant.timezone,
      });

      if (res.success && res.appointment) {
        setLiveAppointments(prev => [res.appointment!, ...prev]);
        reloadLiveAppointments();
        addToast(
          'success',
          language === 'es' ? 'Cita Agendada' : 'Appointment Scheduled',
          `${res.appointment.customerName} · ${res.appointment.serviceName}`
        );
        return { success: true, appointment: res.appointment };
      } else {
        const sanitized = sanitizeErrorForBusiness(res.error || 'Booking failed.', language);
        captureTechnicalIncident({
          source: 'technical_error',
          severity: 'medium',
          title: 'Booking creation failed',
          description: sanitized.technicalDetail,
          businessId: currentTenant.id,
          businessName: currentTenant.name,
        });
        return { success: false, error: sanitized.userMessage };
      }
    }

    // Demo Mode local save
    const newAppointment: Appointment = {
      ...appData,
      id: `apt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      tenantId: currentTenant.id,
      createdAt: new Date().toISOString(),
    };

    setAppointments(prev => [newAppointment, ...prev]);

    setCustomers(prev => prev.map(c => {
      if (c.id === appData.customerId) {
        return {
          ...c,
          totalAppointments: (c.totalAppointments || 0) + 1,
          lastInteractionAt: new Date().toISOString(),
        };
      }
      return c;
    }));

    if (newAppointment.status === 'confirmed') {
      emitDemoBookingNotification(newAppointment, 'appointment_confirmed');
    }

    addToast(
      'success',
      language === 'es' ? 'Cita Agendada' : 'Appointment Booked',
      `${newAppointment.customerName} · ${newAppointment.serviceName}`
    );

    return { success: true, appointment: newAppointment };
  };

  // Update Status
  const updateAppointmentStatus = async (appointmentId: string, status: AppointmentStatus) => {
    const sourceList = mode === 'supabase' ? liveAppointments : appointments;
    const targetApt = sourceList.find(a => a.id === appointmentId);

    if (targetApt && targetApt.tenantId && targetApt.tenantId !== currentTenant.id) {
      addToast('error', t.common.error, 'Cross-tenant access denied.');
      return;
    }

    if (status === 'cancelled' && targetApt) {
      const cancelCheck = validateCancellationWindow(targetApt, currentTenant);
      if (!cancelCheck.allowed) {
        addToast('error', t.common.error, formatCancellationValidationError(cancelCheck, language));
        return;
      }
    }

    if (
      targetApt &&
      (targetApt.status === 'cancelled' || targetApt.status === 'no_show') &&
      (status === 'confirmed' || status === 'pending')
    ) {
      const targetService = tenantServices.find(s => s.id === targetApt.serviceId);
      const reopenCheck = validateBookingWindow({
        tenant: currentTenant,
        date: targetApt.date,
        startTime: targetApt.startTime,
        durationMinutes: getAppointmentDurationMinutes(targetApt) ?? 0,
        appointments: tenantAppointments,
        staffId: targetApt.staffId,
        excludeAppointmentId: targetApt.id,
        service: targetService,
      });
      if (!reopenCheck.valid) {
        addToast('error', t.common.error, formatBookingValidationError(reopenCheck, language));
        return;
      }
    }

    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentUser || hasNoBusinessMembership || !currentTenant.id) {
        addToast(
          'error',
          t.common.error,
          language === 'es'
            ? 'Debes iniciar sesión con un negocio autorizado.'
            : 'You must be signed in to an authorized business.'
        );
        return;
      }

      const res = status === 'cancelled'
        ? await cancelAppointmentInSupabase(currentTenant.id, appointmentId)
        : await updateAppointmentStatusInSupabase(appointmentId, status, currentTenant.id);
      if (!res.success) {
        const sanitized = sanitizeErrorForBusiness(res.error || 'Failed to update appointment status.', language);
        captureTechnicalIncident({
          source: 'technical_error',
          severity: 'medium',
          title: 'Appointment status update failed',
          description: sanitized.technicalDetail,
          businessId: currentTenant.id,
          businessName: currentTenant.name,
        });
        addToast('error', t.common.error, sanitized.userMessage);
        return;
      }
      setLiveAppointments(prev => prev.map(a => a.id === appointmentId ? { ...a, status } : a));
      if (isSuperAdmin && currentTenant.id) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: status === 'cancelled' ? 'cancel_appointment' : 'update_appointment_status',
          entityType: 'appointments',
          entityId: appointmentId,
          metadata: { status },
        });
      }
    } else {
      const targetDemo = appointments.find(a => a.id === appointmentId);
      setAppointments(prev => prev.map(a => a.id === appointmentId ? { ...a, status } : a));
      if (targetDemo && targetDemo.status !== status) {
        if (status === 'confirmed') {
          emitDemoBookingNotification({ ...targetDemo, status }, 'appointment_confirmed');
        } else if (status === 'cancelled') {
          emitDemoBookingNotification({ ...targetDemo, status }, 'appointment_cancelled');
        }
      }
    }

    if (selectedAppointmentForDetail && selectedAppointmentForDetail.id === appointmentId) {
      setSelectedAppointmentForDetail(prev => prev ? { ...prev, status } : null);
    }

    const statusMapEn: Record<AppointmentStatus, string> = {
      pending: 'Pending',
      confirmed: 'Confirmed',
      completed: 'Completed',
      cancelled: 'Cancelled',
      no_show: 'No-Show',
    };
    const statusMapEs: Record<AppointmentStatus, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No asistió',
    };

    addToast(
      'info',
      language === 'es' ? 'Estado Actualizado' : 'Status Updated',
      `${language === 'es' ? statusMapEs[status] : statusMapEn[status]}`
    );
  };

  // Reschedule (preserves existing appointment status rather than auto-confirming pending bookings)
  const rescheduleAppointment = async (appointmentId: string, newDate: string, newStartTime: string) => {
    const sourceList = mode === 'supabase' ? liveAppointments : appointments;
    const target = sourceList.find(a => a.id === appointmentId);
    if (!target) return { success: false, error: 'Appointment not found' };
    if (target.tenantId && target.tenantId !== currentTenant.id) {
      return { success: false, error: 'Cross-tenant appointment reschedule is not permitted.' };
    }
    if (target.status === 'cancelled' || target.status === 'completed') {
      return {
        success: false,
        error:
          language === 'es'
            ? 'No se puede reprogramar una cita cancelada o completada.'
            : 'Cancelled or completed appointments cannot be rescheduled.',
      };
    }

    const targetDuration = getAppointmentDurationMinutes(target);
    if (targetDuration === null || targetDuration <= 0) {
      return {
        success: false,
        error: translations[language].appointment.durationUnavailable,
      };
    }

    const targetService = tenantServices.find(s => s.id === target.serviceId);
    const scheduleCheck = validateBookingWindow({
      tenant: currentTenant,
      date: newDate,
      startTime: newStartTime,
      durationMinutes: targetDuration,
      appointments: tenantAppointments,
      staffId: target.staffId,
      excludeAppointmentId: appointmentId,
      service: targetService,
    });

    if (!scheduleCheck.valid) {
      return {
        success: false,
        error: formatBookingValidationError(scheduleCheck, language),
      };
    }

    const startMins = parseTimeToMinutes(newStartTime);
    const endMins = startMins + targetDuration;
    const newEndTime = formatMinutesToTime(endMins);
    const preservedStatus = target.status;
    const updatedRawStart = buildIsoTimestampInTimezone(newDate, newStartTime, currentTenant.timezone);
    const updatedRawEnd = buildIsoTimestampInTimezone(newDate, newEndTime, currentTenant.timezone);

    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentUser || hasNoBusinessMembership || !currentTenant.id) {
        return {
          success: false,
          error: language === 'es'
            ? 'Debes iniciar sesión con un negocio autorizado para reprogramar citas.'
            : 'You must be signed in to an authorized business to reschedule appointments.',
        };
      }

      if (target.serviceId) {
        const availability = await checkAvailabilityInSupabase({
          businessId: currentTenant.id,
          serviceId: target.serviceId,
          date: newDate,
          startTime: newStartTime,
          timezone: currentTenant.timezone,
          excludeAppointmentId: appointmentId,
        });
        if (!availability.available) {
          const sanitizedAvail = sanitizeErrorForBusiness(
            availability.error || availability.reason || 'Selected time slot is unavailable.',
            language
          );
          return { success: false, error: sanitizedAvail.userMessage };
        }
      }

      const res = await rescheduleAppointmentInSupabase(
        appointmentId,
        newDate,
        newStartTime,
        newEndTime,
        currentTenant.timezone,
        preservedStatus,
        currentTenant.id
      );
      if (!res.success) {
        const sanitized = sanitizeErrorForBusiness(res.error || 'Failed to reschedule appointment.', language);
        return { success: false, error: sanitized.userMessage };
      }
      setLiveAppointments(prev => prev.map(a =>
        a.id === appointmentId
          ? {
              ...a,
              date: newDate,
              startTime: newStartTime,
              endTime: newEndTime,
              rawStartTime: updatedRawStart,
              rawEndTime: updatedRawEnd,
              durationMinutes: targetDuration,
              status: preservedStatus,
            }
          : a
      ));
      if (isSuperAdmin && currentTenant.id) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'reschedule_appointment',
          entityType: 'appointments',
          entityId: appointmentId,
          metadata: { date: newDate, start_time: newStartTime, end_time: newEndTime, status: preservedStatus },
        });
      }
    } else {
      setAppointments(prev => prev.map(a =>
        a.id === appointmentId
          ? {
              ...a,
              date: newDate,
              startTime: newStartTime,
              endTime: newEndTime,
              rawStartTime: undefined,
              rawEndTime: undefined,
              durationMinutes: targetDuration,
              status: preservedStatus,
            }
          : a
      ));
      if (preservedStatus === 'confirmed') {
        emitDemoBookingNotification(
          { ...target, date: newDate, startTime: newStartTime, endTime: newEndTime },
          'appointment_rescheduled',
          newDate,
          newStartTime
        );
      }
    }

    if (selectedAppointmentForDetail && selectedAppointmentForDetail.id === appointmentId) {
      setSelectedAppointmentForDetail(prev => prev ? {
        ...prev,
        date: newDate,
        startTime: newStartTime,
        endTime: newEndTime,
        rawStartTime: mode === 'supabase' ? updatedRawStart : undefined,
        rawEndTime: mode === 'supabase' ? updatedRawEnd : undefined,
        durationMinutes: targetDuration,
        status: preservedStatus,
      } : null);
    }

    addToast(
      'success',
      language === 'es' ? 'Cita Reprogramada' : 'Appointment Rescheduled',
      `${target.customerName} · ${newDate} @ ${newStartTime}`
    );

    return { success: true };
  };

  const openAppointmentFromNotification = useCallback(
    async (notification: BusinessNotification) => {
      await markSingleBusinessNotificationRead(notification.id);

      if (!notification.appointmentId) {
        setActiveTab('appointments');
        return;
      }

      let found = tenantAppointments.find(a => a.id === notification.appointmentId) || null;
      if (!found && mode === 'supabase' && currentTenant.id) {
        const res = await fetchAppointmentByIdInSupabase(
          currentTenant.id,
          notification.appointmentId,
          currentTenant.timezone
        );
        if (res.appointment) {
          const cust = res.appointment.customerId
            ? liveCustomers.find(c => c.id === res.appointment!.customerId)
            : undefined;
          const svc = res.appointment.serviceId
            ? liveServices.find(s => s.id === res.appointment!.serviceId)
            : undefined;
          found = {
            ...res.appointment,
            customerName:
              res.appointment.customerName !== 'Customer'
                ? res.appointment.customerName
                : cust?.name || notification.customerName || res.appointment.customerName,
            customerPhone: res.appointment.customerPhone || cust?.phone || '',
            customerLanguage: res.appointment.customerLanguage || cust?.preferredLanguage || 'en',
            serviceName:
              res.appointment.serviceName !== 'Service'
                ? res.appointment.serviceName
                : svc
                ? language === 'es'
                  ? svc.nameEs
                  : svc.nameEn
                : notification.serviceName || res.appointment.serviceName,
            durationMinutes: getAppointmentDurationMinutes(res.appointment),
            price: res.appointment.price || svc?.price || 0,
          };
        }
      }

      setActiveTab('appointments');
      if (found) {
        setSelectedAppointmentForDetail(found);
      } else if (mode === 'supabase') {
        reloadLiveAppointments();
      }
    },
    [
      markSingleBusinessNotificationRead,
      tenantAppointments,
      mode,
      currentTenant.id,
      currentTenant.timezone,
      liveCustomers,
      liveServices,
      language,
      setActiveTab,
      reloadLiveAppointments,
    ]
  );

  // Cancel Appointment (enforces cancellationBufferHours and uses cancel_appointment(BIGINT, UUID) RPC in Live mode)
  const cancelAppointment = async (appointmentId: string): Promise<{ success: boolean; error?: string }> => {
    const sourceList = mode === 'supabase' ? liveAppointments : appointments;
    const target = sourceList.find(a => a.id === appointmentId);

    if (target) {
      if (target.tenantId && target.tenantId !== currentTenant.id) {
        const errMsg = 'Cross-tenant appointment cancellation is not permitted.';
        addToast('error', t.common.error, errMsg);
        return { success: false, error: errMsg };
      }
      const cancelCheck = validateCancellationWindow(target, currentTenant);
      if (!cancelCheck.allowed) {
        const errMsg = formatCancellationValidationError(cancelCheck, language);
        addToast('error', t.common.error, errMsg);
        return { success: false, error: errMsg };
      }
    }

    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentUser || hasNoBusinessMembership || !currentTenant.id) {
        const errMsg = language === 'es'
          ? 'Debes iniciar sesión con un negocio autorizado para cancelar citas.'
          : 'You must be signed in to an authorized business to cancel appointments.';
        addToast('error', t.common.error, errMsg);
        return { success: false, error: errMsg };
      }

      const res = await cancelAppointmentInSupabase(currentTenant.id, appointmentId);
      if (!res.success) {
        const sanitized = sanitizeErrorForBusiness(res.error || 'Failed to cancel appointment.', language);
        captureTechnicalIncident({
          source: 'technical_error',
          severity: 'medium',
          title: 'Appointment cancellation failed',
          description: sanitized.technicalDetail,
          businessId: currentTenant.id,
          businessName: currentTenant.name,
        });
        addToast('error', t.common.error, sanitized.userMessage);
        return { success: false, error: sanitized.userMessage };
      }
      setLiveAppointments(prev => prev.map(a => a.id === appointmentId ? { ...a, status: 'cancelled' } : a));
      if (isSuperAdmin && currentTenant.id) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'cancel_appointment',
          entityType: 'appointments',
          entityId: appointmentId,
          metadata: { status: 'cancelled' },
        });
      }
      if (selectedAppointmentForDetail && selectedAppointmentForDetail.id === appointmentId) {
        setSelectedAppointmentForDetail(null);
      }
      addToast(
        'info',
        language === 'es' ? 'Cita Cancelada' : 'Appointment Cancelled',
        language === 'es' ? 'La cita ha sido cancelada.' : 'The appointment has been cancelled.'
      );
      return { success: true };
    }

    await updateAppointmentStatus(appointmentId, 'cancelled');
    if (selectedAppointmentForDetail && selectedAppointmentForDetail.id === appointmentId) {
      setSelectedAppointmentForDetail(null);
    }
    return { success: true };
  };

  // Add Customer (strictly persists to backend in live mode; never fabricates placeholder UUIDs)
  const addCustomer = async (custData: Omit<Customer, 'id' | 'createdAt' | 'tenantId' | 'totalAppointments' | 'lastInteractionAt'>) => {
    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentUser || hasNoBusinessMembership || !currentTenant.id) {
        const errMsg = language === 'es'
          ? 'Debes iniciar sesión con un negocio asignado para crear clientes.'
          : 'You must be signed in to an authorized business to create customers.';
        addToast('error', t.common.error, errMsg);
        throw new Error(errMsg);
      }

      const res = await createCustomerInSupabase(currentTenant.id, custData);
      if (!res.success || !res.customer) {
        const sanitized = sanitizeErrorForBusiness(res.error || 'Failed to create customer.', language);
        captureTechnicalIncident({
          source: 'technical_error',
          severity: 'medium',
          title: 'Customer creation failed',
          description: sanitized.technicalDetail,
          businessId: currentTenant.id,
          businessName: currentTenant.name,
        });
        addToast('error', t.common.error, sanitized.userMessage);
        throw new Error(sanitized.userMessage);
      }

      setLiveCustomers(prev => [res.customer!, ...prev]);
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'create_customer',
          entityType: 'customers',
          entityId: res.customer.id,
          metadata: { name: res.customer.name },
        });
      }
      addToast('success', language === 'es' ? 'Cliente Registrado' : 'Customer Added', res.customer.name);
      return res.customer;
    }

    const newCust: Customer = {
      ...custData,
      email: (custData.email || '').trim(),
      id: `cust-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      tenantId: currentTenant.id,
      totalAppointments: 0,
      createdAt: new Date().toISOString(),
      lastInteractionAt: new Date().toISOString(),
    };

    setCustomers(prev => [newCust, ...prev]);
    addToast(
      'success',
      language === 'es' ? 'Cliente Registrado' : 'Customer Added',
      newCust.name
    );

    return newCust;
  };

  const updateCustomerNotes = async (customerId: string, notes: string) => {
    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentUser || hasNoBusinessMembership || !currentTenant.id) {
        addToast(
          'error',
          t.common.error,
          language === 'es'
            ? 'Debes iniciar sesión con un negocio autorizado para editar clientes.'
            : 'You must be signed in to an authorized business to update customers.'
        );
        return;
      }
      const res = await updateCustomerNotesInSupabase(currentTenant.id, customerId, notes);
      if (!res.success) {
        addToast('error', t.common.error, res.error || 'Failed to save customer notes.');
        return;
      }
      setLiveCustomers(prev => prev.map(c => c.id === customerId ? { ...c, notes } : c));
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'update_customer_notes',
          entityType: 'customers',
          entityId: customerId,
        });
      }
    } else {
      setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, notes } : c));
    }
    addToast(
      'info',
      language === 'es' ? 'Notas Actualizadas' : 'Notes Saved',
      language === 'es' ? 'El perfil del cliente ha sido actualizado.' : 'Customer profile notes saved.'
    );
  };

  // Add / Update Services (Business Owner or Super Admin)
  const addService = async (svcData: Omit<Service, 'id' | 'tenantId'>): Promise<{ success: boolean; error?: string }> => {
    if (!canManageServices) {
      return { success: false, error: 'Insufficient permissions to manage services.' };
    }

    const resolvedSvcData: Omit<Service, 'id' | 'tenantId'> = {
      ...svcData,
      currency: normalizeCurrencyCode(svcData.currency, currentTenant.currency || 'USD'),
    };

    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentTenant.id) {
        return { success: false, error: 'No active Supabase business selected.' };
      }
      const res = await createServiceInSupabase(currentTenant.id, resolvedSvcData);
      if (!res.success || !res.service) {
        return { success: false, error: res.error || 'Failed to create service.' };
      }
      setLiveServices(prev => [...prev, res.service!]);
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'create_service',
          entityType: 'services',
          entityId: res.service.id,
          metadata: { name_en: res.service.nameEn, price: res.service.price, currency: res.service.currency },
        });
      }
      addToast('success', t.common.success, res.service.nameEn);
      return { success: true };
    }

    const newService: Service = {
      ...resolvedSvcData,
      id: `svc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      tenantId: currentTenant.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setServices(prev => [...prev, newService]);
    addToast('success', t.common.success, language === 'es' ? newService.nameEs : newService.nameEn);
    return { success: true };
  };

  const updateService = async (updatedService: Service): Promise<{ success: boolean; error?: string }> => {
    if (!canManageServices) {
      return { success: false, error: 'Insufficient permissions to update services.' };
    }

    const resolvedService: Service = {
      ...updatedService,
      tenantId: updatedService.tenantId || currentTenant.id,
      currency: normalizeCurrencyCode(updatedService.currency, currentTenant.currency || 'USD'),
      updatedAt: new Date().toISOString(),
    };

    if (mode === 'supabase') {
      if (!supabaseConfig.isConnected || !currentTenant.id) {
        return { success: false, error: 'No active Supabase business selected.' };
      }
      const res = await updateServiceInSupabase({ ...resolvedService, tenantId: currentTenant.id });
      if (!res.success || !res.service) {
        return { success: false, error: res.error || 'Failed to update service.' };
      }
      setLiveServices(prev => prev.map(s => s.id === res.service!.id ? res.service! : s));
      if (isSuperAdmin) {
        await recordAdminAuditLogInSupabase({
          businessId: currentTenant.id,
          action: 'update_service',
          entityType: 'services',
          entityId: res.service.id,
          metadata: {
            name_en: res.service.nameEn,
            price: res.service.price,
            currency: res.service.currency,
            active: res.service.active,
          },
        });
      }
      addToast('success', t.common.success, res.service.nameEn);
      return { success: true };
    }

    setServices(prev => prev.map(s => s.id === resolvedService.id ? resolvedService : s));
    addToast('success', t.common.success, language === 'es' ? resolvedService.nameEs : resolvedService.nameEn);
    return { success: true };
  };

  // Conversations & AI Handover
  const takeOverConversation = (conversationId: string) => {
    setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, isAiHandled: false } : c));
    addToast(
      'info',
      language === 'es' ? 'Control Manual Activado' : 'Staff Handover Active',
      language === 'es' ? 'Has tomado el control manual de esta conversación.' : 'You have taken manual control of this chat.'
    );
  };

  const returnConversationToAi = (conversationId: string) => {
    setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, isAiHandled: true } : c));
    addToast(
      'success',
      language === 'es' ? 'Recepcionista IA Reanudada' : 'AI Receptionist Resumed',
      language === 'es' ? 'La Recepcionista IA responderá los próximos mensajes.' : 'The AI Receptionist will handle upcoming messages.'
    );
  };

  const sendChatMessage = (conversationId: string, content: string, sender: 'customer' | 'ai' | 'staff') => {
    const conv = conversations.find(c => c.id === conversationId);
    if (!conv) return;

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      conversationId,
      sender,
      content,
      language: conv.customerLanguage,
      status: 'sent',
      timestamp: new Date().toISOString(),
    };

    setChatMessages(prev => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), newMsg],
    }));

    setConversations(prev => prev.map(c => {
      if (c.id === conversationId) {
        return {
          ...c,
          lastMessageSnippet: content,
          lastMessageAt: newMsg.timestamp,
          unreadCount: 0,
        };
      }
      return c;
    }));
  };

  // ---------------------------------------------------------------------------
  // Auth & Password Recovery Methods
  // ---------------------------------------------------------------------------
  const loginWithSupabase = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const res = await signInWithEmailPassword(email, password);
    if (res.error) {
      return { success: false, error: sanitizeErrorForBusiness(res.error, language).userMessage };
    }

    if (res.user) {
      const access = await applyAuthenticatedUser(res.user);
      setMode('supabase');
      setActiveTabState(access.isSuperAdmin ? 'admin' : 'overview');
      addToast(
        'success',
        language === 'es' ? 'Sesión Iniciada' : 'Signed In',
        res.user.email || 'Welcome back'
      );
      return { success: true };
    }

    return { success: false, error: 'User not returned.' };
  };

  const signupWithSupabase = async (email: string, password: string, businessName?: string): Promise<{ success: boolean; error?: string }> => {
    const res = await signUpWithEmailPassword(email, password, businessName);
    return {
      success: false,
      error: res.error || (language === 'es'
        ? 'El registro público está deshabilitado. El acceso requiere invitación de un administrador.'
        : 'Public self-registration is disabled. Access requires an administrator invitation.'),
    };
  };

  const requestPasswordReset = async (email: string): Promise<{ success: boolean; error?: string }> => {
    const res = await sendPasswordResetEmail(email);
    if (res.success) {
      addToast(
        'success',
        language === 'es' ? 'Correo de Recuperación Enviado' : 'Recovery Email Sent',
        language === 'es'
          ? 'Revisa tu correo electrónico para restablecer tu contraseña.'
          : 'Check your email inbox to reset your password.'
      );
    }
    return res;
  };

  const completePasswordReset = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    const res = await updateUserPassword(newPassword);
    if (res.success) {
      // Clean /reset-password route, hash, and query params after password update
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, document.title, '/');
      }
      await removeAllRealtimeChannels();
      await signOutUser();
      setCurrentUser(null);
      setAuthSession(null);
      setRecoveryError(null);
      setIsPasswordRecoveryMode(false);
      addToast(
        'success',
        language === 'es' ? 'Contraseña Actualizada' : 'Password Updated',
        t.auth.passwordUpdatedSuccess
      );
    }
    return res;
  };

  const completeInvitationOnboarding = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    const { businessId, token } = invitationContextRef.current;

    // 1. Update credentials first via authenticated invite session
    const pwdRes = await updateUserPassword(newPassword);
    if (!pwdRes.success) {
      return { success: false, error: pwdRes.error || 'Unable to set account password.' };
    }

    // 2. Bind membership server-side (verifies email match, expiry, token, and prevents duplicates)
    const acceptRes = await acceptBusinessInvitationInSupabase(businessId, token);
    if (!acceptRes.success) {
      return { success: false, error: acceptRes.error || 'Unable to activate business membership.' };
    }

    // 3. Refresh authenticated profile and route directly into the assigned business
    const { session, user } = await getCurrentSupabaseSession();
    if (session && user) {
      setAuthSession(session);
      await applyAuthenticatedUser(user, { skipAutoAcceptInvites: true });
      setMode('supabase');
      if (acceptRes.primaryBusinessId) {
        setCurrentTenantIdState(acceptRes.primaryBusinessId);
        localStorage.setItem('novacode_current_tenant_id', acceptRes.primaryBusinessId);
      }
      setActiveTab('overview');
    }

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, document.title, '/');
    }
    invitationContextRef.current = {};
    setInvitationError(null);
    setIsInvitationOnboardingMode(false);

    addToast(
      'success',
      language === 'es' ? 'Cuenta Activada' : 'Account Activated',
      t.auth.inviteActivatedSuccess
    );

    return { success: true };
  };

  const logout = async () => {
    await removeAllRealtimeChannels();
    await signOutUser();
    currentUserRef.current = null;
    setCurrentUser(null);
    setAuthSession(null);
    setLiveTenants([]);
    setLiveAppointments([]);
    setLiveCustomers([]);
    setLiveServices([]);
    setLiveActiveServicesCount(null);
    setLiveMembers([]);
    setBusinessInvitations([]);
    setAuditLogs([]);
    setPlatformIncidents([]);
    setPlatformIncidentsTotalCount(0);
    setHasMorePlatformIncidents(false);
    setCapturedTechnicalIncidents([]);
    setIncidentsTableExists(false);
    setLiveSupportTickets([]);
    setLiveSupportMessages({});
    setLiveSupportStatusHistory({});
    setSupportTicketsTotalCount(0);
    setHasMoreSupportTickets(false);
    setSupportNotifications([]);
    seenBookingNotificationKeysRef.current.clear();
    setBusinessNotifications([]);
    setPendingAdminTicketId(null);
    setPendingAdminIncidentId(null);
    setBusinessOwnersByBizId({});
    setMessagingConfigsByBizId({});
    setSmsConsentSummariesByBizId({});
    setBookingNotificationHealth({
      status: 'demo',
      pendingFailures: 0,
      dueForRetry: 0,
      abandonedFailures: 0,
      recovered24h: 0,
      oldestPendingAgeSeconds: 0,
      openNotificationIncidents: 0,
      criticalDoubleFailureIncidents: 0,
      checkedAt: new Date().toISOString(),
      recoveryWorkerStatus: 'demo',
    });
    setN8nIntegrationHealth({
      status: 'demo',
      activeWorkflows: null,
      detail: 'Signed out.',
    });
    setLiveDataError(null);
    setLiveDataErrorType(null);
    setHasNoBusinessMembership(false);
    setAuthDiagnosticError(null);
    setIsSuperAdminCheckFailed(false);
    setRecoveryError(null);
    setIsPasswordRecoveryMode(false);
    setInvitationError(null);
    setIsInvitationOnboardingMode(false);
    setActiveTabState('overview');
    modeRef.current = 'demo';
    setModeState('demo');
    localStorage.setItem('novacode_mode', 'demo');
    addToast(
      'info',
      language === 'es' ? 'Sesión Cerrada' : 'Signed Out',
      language === 'es' ? 'Has cerrado sesión exitosamente.' : 'You have been safely signed out.'
    );
  };

  // Platform Infrastructure Configuration Management (Super Admin only)
  const updateSupabaseConfig = async (url: string, anonKey: string): Promise<{ success: boolean; message: string }> => {
    if (isPrivilegedServiceRoleKey(anonKey)) {
      const msg =
        language === 'es'
          ? 'Error de seguridad: Las claves service_role nunca deben usarse en el navegador.'
          : 'Security error: Privileged service_role keys are strictly forbidden in browser sessions.';
      addToast('error', t.common.error, msg);
      return { success: false, message: msg };
    }

    if (
      !currentUserRef.current ||
      !currentUserRef.current.isSuperAdmin ||
      isSuperAdminCheckFailedRef.current
    ) {
      const msg =
        language === 'es'
          ? 'Solo Súper Administradores verificados pueden modificar la infraestructura.'
          : 'Only verified Super Admins can modify platform infrastructure.';
      addToast('error', t.common.error, msg);
      return { success: false, message: msg };
    }

    const serverVerified = await verifyCurrentUserIsSuperAdmin();
    if (!serverVerified.isSuperAdmin) {
      const msg =
        language === 'es'
          ? 'Verificación de Súper Administrador requerida.'
          : 'Server Super Admin verification failed.';
      addToast('error', t.common.error, msg);
      return { success: false, message: msg };
    }

    const normalized = normalizeSupabaseUrl(url);
    if (!normalized.isValid || !normalized.url) {
      const msg = normalized.error || 'Invalid Supabase project URL.';
      addToast('error', language === 'es' ? 'URL Inválida' : 'Invalid URL', msg);
      return { success: false, message: msg };
    }

    const cleanUrl = normalized.url;
    const cleanKey = anonKey.trim();
    resetSupabaseClient(cleanUrl, cleanKey);
    const testResult = await testSupabaseConnection(cleanUrl, cleanKey);

    if (testResult.success) {
      setSupabaseConfig({
        url: testResult.normalizedUrl || cleanUrl,
        anonKey: cleanKey,
        isConnected: true,
        lastTestedAt: new Date().toISOString(),
      });
      setMode('supabase');
      addToast(
        'success',
        language === 'es' ? 'Conexión Exitosa' : 'Backend Connected',
        testResult.message
      );
      return { success: true, message: testResult.message };
    } else {
      setSupabaseConfig(prev => ({
        ...prev,
        url: cleanUrl,
        anonKey: cleanKey,
        isConnected: false,
      }));
      addToast(
        'error',
        language === 'es' ? 'Error de Conexión' : 'Connection Failed',
        testResult.message
      );
      return { success: false, message: testResult.message };
    }
  };

  const disconnectSupabase = () => {
    if (!canViewPlatformAdmin) {
      return;
    }
    setSupabaseConfig({
      url: '',
      anonKey: '',
      isConnected: false,
    });
    modeRef.current = 'demo';
    setModeState('demo');
    localStorage.setItem('novacode_mode', 'demo');
    addToast(
      'info',
      language === 'es' ? 'Vista Previa Activa' : 'Preview Sandbox Restored',
      language === 'es' ? 'Conexión en vivo desconectada.' : 'Live backend connection closed.'
    );
  };

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        t,
        theme,
        setTheme,
        toggleTheme,

        mode,
        setMode,
        toggleMode,

        currentUser,
        authSession,
        isAuthLoading,
        isAuthModalOpen,
        setIsAuthModalOpen,
        isPasswordRecoveryMode,
        setIsPasswordRecoveryMode,
        recoveryError,
        setRecoveryError,
        isInvitationOnboardingMode,
        setIsInvitationOnboardingMode,
        invitationError,
        setInvitationError,
        hasNoBusinessMembership,
        authDiagnosticError,
        isSuperAdminCheckFailed,
        effectiveRole,
        isSuperAdmin,
        canManageBusinessSettings,
        canManageServices,
        canManageStaff,
        canViewPlatformAdmin,
        refreshAccessProfile,
        loginWithSupabase,
        signupWithSupabase,
        requestPasswordReset,
        completePasswordReset,
        completeInvitationOnboarding,
        logout,

        currentTenant,
        availableTenants,
        setCurrentTenantId,
        updateTenantSettings,
        saveBusinessProfile,
        saveWeeklyBusinessHours,
        saveSpecialHours,
        saveBookingPolicies,
        liveMembers,
        reloadBusinessMembers,
        businessInvitations,
        reloadBusinessInvitations,
        auditLogs,
        reloadAuditLogs,
        createBusinessAsSuperAdmin,
        toggleBusinessActive,
        inviteBusinessOwner,
        assignExistingUserToBusiness,
        resendBusinessInvitation,
        revokeBusinessInvitation,
        assignBusinessMember,
        removeBusinessMember,

        platformMetrics,
        reloadPlatformMetrics,
        businessOwnersByBizId,
        reloadBusinessOwners,
        bookingNotificationHealth,
        reloadBookingNotificationHealth,
        triggerBookingNotificationRecovery,
        n8nIntegrationHealth,
        reloadN8nIntegrationHealth,
        messagingConfigsByBizId,
        smsConsentSummariesByBizId,
        smsTablesStatus,
        reloadSmsA2pOverview,
        updateBusinessMessagingConfig,
        updateBusinessCommunicationChannels,
        platformIncidents,
        capturedTechnicalIncidents,
        captureTechnicalIncident,
        incidentsTableExists,
        platformIncidentsTotalCount,
        hasMorePlatformIncidents,
        isLoadingMorePlatformIncidents,
        reloadPlatformIncidents,
        loadMorePlatformIncidents,
        updatePlatformIncidentStatus,
        fetchAndSelectIncident,
        activeServicesCount,
        businessNotifications,
        markBusinessNotificationsRead,
        markSingleBusinessNotificationRead,
        openAppointmentFromNotification,
        clearBusinessNotification,

        supportTickets,
        supportMessagesByTicket,
        supportStatusHistoryByTicket,
        supportTicketsTableExists,
        isLoadingSupportTickets,
        supportTicketsTotalCount,
        hasMoreSupportTickets,
        isLoadingMoreSupportTickets,
        reloadSupportTickets,
        loadMoreSupportTickets,
        createSupportTicket,
        loadTicketMessages,
        loadTicketStatusHistory,
        fetchAndSelectTicket,
        sendTicketReply,
        updateTicketStatus,
        markTicketRead,
        supportNotifications,
        markSingleSupportNotificationRead,
        markSupportNotificationsRead,
        pendingAdminTicketId,
        setPendingAdminTicketId,
        pendingAdminIncidentId,
        setPendingAdminIncidentId,

        customers: tenantCustomers,
        services: tenantServices,
        staff: tenantStaff,
        appointments: tenantAppointments,
        conversations: tenantConversations,
        chatMessages,
        isLoadingLiveData,
        liveDataError,
        liveDataErrorType,
        reloadLiveAppointments,

        addAppointment,
        updateAppointmentStatus,
        rescheduleAppointment,
        cancelAppointment,
        addCustomer,
        updateCustomerNotes,
        addService,
        updateService,
        isBookingConflict,

        takeOverConversation,
        returnConversationToAi,
        sendChatMessage,
        activeConversationId,
        setActiveConversationId,

        integrationStatus,
        supabaseConfig,
        updateSupabaseConfig,
        disconnectSupabase,

        toasts,
        addToast,
        removeToast,

        activeTab,
        setActiveTab,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        isNewBookingModalOpen,
        setIsNewBookingModalOpen,
        selectedAppointmentForDetail,
        setSelectedAppointmentForDetail,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
