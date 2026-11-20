import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  SUPABASE_SQL_SCHEMA,
  SUPABASE_BIGINT_SUPERADMIN_MIGRATION_SQL,
  SUPABASE_INVITATIONS_MIGRATION_SQL,
  SUPABASE_BUSINESS_STATUS_SQL,
  SUPABASE_SUPPORT_INCIDENTS_SQL,
  SUPABASE_SUPPORT_SYSTEM_SQL,
  normalizeSupabaseUrl,
} from '../services/supabase';
import { CreateBusinessWizard } from './CreateBusinessWizard';
import { WorkspaceAvatar } from './WorkspaceSwitcher';
import {
  BUSINESS_CATEGORIES,
  getCategoryDisplayLabel,
  normalizeCategoryId,
} from '../data/businessCategories';
import { formatTimezoneSummary } from '../utils/timezone';
import { isPrivilegedServiceRoleKey } from '../utils/security';
import { buildPublicRouteHref } from '../utils/publicRoutes';
import {
  Tenant,
  InvitationStatus,
  IncidentSeverity,
  IncidentStatus,
  IncidentSource,
  SupportIncident,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketMessage,
  SupportTicketStatusHistoryEntry,
  SupportNotification,
  A2pApprovalStatus,
  BusinessCommunicationChannels,
  ChannelConnectionState,
  BusinessOwnerSummary,
  BookingNotificationHealth,
  N8nIntegrationHealth,
  BusinessMessagingConfig,
  BusinessSmsConsentSummary,
} from '../types';
import {
  ShieldCheck,
  Building2,
  Users,
  CalendarDays,
  Plus,
  UserPlus,
  Trash2,
  ArrowUpRight,
  Copy,
  Check,
  Activity,
  Lock,
  RefreshCw,
  Mail,
  Send,
  RotateCcw,
  Ban,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  LayoutGrid,
  List,
  Eye,
  Power,
  Settings as SettingsIcon,
  ServerCog,
  Database,
  LifeBuoy,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Radio,
  Smartphone,
  Globe,
  BellRing,
  ExternalLink,
} from 'lucide-react';

interface SuperAdminViewProps {
  initialSection?:
    | 'businesses'
    | 'invitations'
    | 'channels'
    | 'sms-a2p'
    | 'support-center'
    | 'incidents'
    | 'monitoring'
    | 'activity'
    | 'infrastructure';
}

const EMPTY_BUSINESS_OWNERS: Record<string, BusinessOwnerSummary[]> = {};
const EMPTY_MESSAGING_CONFIGS: Record<string, BusinessMessagingConfig> = {};
const EMPTY_SMS_SUMMARIES: Record<string, BusinessSmsConsentSummary> = {};
const EMPTY_SUPPORT_HISTORY: Record<string, SupportTicketStatusHistoryEntry[]> = {};
const EMPTY_SUPPORT_NOTIFICATIONS: SupportNotification[] = [];
const DEFAULT_BOOKING_NOTIFICATION_HEALTH: BookingNotificationHealth = {
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
};
const DEFAULT_N8N_HEALTH: N8nIntegrationHealth = {
  status: 'not_verified',
  activeWorkflows: null,
  detail: '',
};
const DEFAULT_SMS_TABLES_STATUS = {
  configsTableExists: true,
  consentsTableExists: true,
};

export const SuperAdminView: React.FC<SuperAdminViewProps> = ({
  initialSection = 'businesses',
}) => {
  const {
    t,
    language,
    mode,
    setMode,
    canViewPlatformAdmin,
    isSuperAdmin = canViewPlatformAdmin,
    isSuperAdminCheckFailed = false,
    availableTenants,
    currentTenant,
    setCurrentTenantId,
    setActiveTab,
    platformMetrics,
    reloadPlatformMetrics,
    businessOwnersByBizId = EMPTY_BUSINESS_OWNERS,
    reloadBusinessOwners,
    bookingNotificationHealth = DEFAULT_BOOKING_NOTIFICATION_HEALTH,
    reloadBookingNotificationHealth,
    triggerBookingNotificationRecovery,
    n8nIntegrationHealth = DEFAULT_N8N_HEALTH,
    reloadN8nIntegrationHealth,
    messagingConfigsByBizId = EMPTY_MESSAGING_CONFIGS,
    smsConsentSummariesByBizId = EMPTY_SMS_SUMMARIES,
    smsTablesStatus = DEFAULT_SMS_TABLES_STATUS,
    reloadSmsA2pOverview,
    updateBusinessMessagingConfig,
    updateBusinessCommunicationChannels,
    platformIncidents,
    incidentsTableExists,
    platformIncidentsTotalCount,
    hasMorePlatformIncidents = false,
    isLoadingMorePlatformIncidents = false,
    reloadPlatformIncidents,
    loadMorePlatformIncidents,
    updatePlatformIncidentStatus,
    fetchAndSelectIncident,
    capturedTechnicalIncidents,
    supportTickets,
    supportMessagesByTicket,
    supportStatusHistoryByTicket = EMPTY_SUPPORT_HISTORY,
    supportTicketsTableExists,
    supportTicketsTotalCount,
    hasMoreSupportTickets = false,
    isLoadingMoreSupportTickets = false,
    reloadSupportTickets,
    loadMoreSupportTickets,
    loadTicketMessages,
    loadTicketStatusHistory,
    fetchAndSelectTicket,
    sendTicketReply,
    updateTicketStatus,
    markTicketRead,
    supportNotifications = EMPTY_SUPPORT_NOTIFICATIONS,
    pendingAdminTicketId,
    setPendingAdminTicketId,
    pendingAdminIncidentId,
    setPendingAdminIncidentId,
    authDiagnosticError,
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
    removeBusinessMember,
    supabaseConfig,
    updateSupabaseConfig,
    disconnectSupabase,
    addToast,
  } = useApp();

  const isEs = language === 'es';
  const [section, setSection] = useState<
    | 'businesses'
    | 'invitations'
    | 'channels'
    | 'sms-a2p'
    | 'support-center'
    | 'incidents'
    | 'monitoring'
    | 'activity'
    | 'infrastructure'
  >(initialSection);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  // Businesses Overview filters, sort, layout, pagination, wizard, drawer
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'id_desc' | 'id_asc'>('name_asc');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [detailTenant, setDetailTenant] = useState<Tenant | null>(null);
  const [togglingBizId, setTogglingBizId] = useState<string | null>(null);
  const [pendingStatusToggleBiz, setPendingStatusToggleBiz] = useState<Tenant | null>(null);

  // Selected business for invitations, channels, & SMS/A2P
  const [selectedBizId, setSelectedBizId] = useState<string>(currentTenant.id || availableTenants[0]?.id || '');
  const [memberActionMode, setMemberActionMode] = useState<'invite' | 'assign'>('invite');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'owner' | 'admin' | 'manager' | 'staff'>('owner');
  const [isSubmittingMemberAction, setIsSubmittingMemberAction] = useState(false);
  const [memberActionFeedback, setMemberActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [inviteScopeFilter, setInviteScopeFilter] = useState<'selected' | 'all'>('all');
  const [inviteStatusFilter, setInviteStatusFilter] = useState<'all' | InvitationStatus>('all');
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

  // Support Center state & filters
  const [ticketSearchQuery, setTicketSearchQuery] = useState('');
  const [ticketBusinessFilter, setTicketBusinessFilter] = useState<string>('all');
  const [ticketCategoryFilter, setTicketCategoryFilter] = useState<'all' | SupportTicketCategory>('all');
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState<'all' | SupportTicketPriority>('all');
  const [ticketStatusFilter, setTicketStatusFilter] = useState<'all' | SupportTicketStatus>('all');
  const [unresolvedTicketsOnly, setUnresolvedTicketsOnly] = useState<boolean>(true);
  const [unreadTicketsOnly, setUnreadTicketsOnly] = useState<boolean>(false);
  const [ticketPage, setTicketPage] = useState(1);
  const ticketPageSize = 15;
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [fetchedTicketFallback, setFetchedTicketFallback] = useState<SupportTicket | null>(null);
  const [adminMessagesByTicket, setAdminMessagesByTicket] = useState<
    Record<string, SupportTicketMessage[]>
  >({});
  const [adminReplyText, setAdminReplyText] = useState('');
  const [isSendingAdminReply, setIsSendingAdminReply] = useState(false);
  const [isUpdatingTicketStatus, setIsUpdatingTicketStatus] = useState(false);
  const [ticketActionFeedback, setTicketActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Incidents state & filters
  const [incidentSearchQuery, setIncidentSearchQuery] = useState('');
  const [incidentSourceFilter, setIncidentSourceFilter] = useState<'all' | IncidentSource>('all');
  const [incidentSeverityFilter, setIncidentSeverityFilter] = useState<'all' | IncidentSeverity>('all');
  const [incidentStatusFilter, setIncidentStatusFilter] = useState<'all' | IncidentStatus>('all');
  const [incidentBusinessFilter, setIncidentBusinessFilter] = useState<string>('all');
  const [selectedIncidentForDetail, setSelectedIncidentForDetail] = useState<SupportIncident | null>(null);
  const [updatingIncidentId, setUpdatingIncidentId] = useState<string | null>(null);
  const [incidentActionFeedback, setIncidentActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Platform Infrastructure (Super Admin Only)
  const [supabaseUrl, setSupabaseUrl] = useState(supabaseConfig.url);
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(supabaseConfig.anonKey);
  const [isConnecting, setIsConnecting] = useState(false);
  const [sqlViewTab, setSqlViewTab] = useState<
    'invitations' | 'support_system' | 'bigint' | 'status' | 'incidents' | 'schema'
  >('invitations');
  const [isCopiedSql, setIsCopiedSql] = useState(false);

  // Communication Channels draft state (metadata only — zero secrets)
  const [channelDraft, setChannelDraft] = useState<BusinessCommunicationChannels>({
    whatsapp: { status: 'not_configured', provider: 'whatsapp_cloud', verifiedByBackend: false },
    sms: { status: 'not_configured', provider: 'twilio_a2p', verifiedByBackend: false },
    webChat: { status: 'not_configured', enabled: false, verifiedByBackend: false },
  });
  const [allowedOriginsText, setAllowedOriginsText] = useState('');
  const [isSavingChannels, setIsSavingChannels] = useState(false);
  const [channelSaveFeedback, setChannelSaveFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // SMS / A2P Governance draft state
  const [smsA2pDraft, setSmsA2pDraft] = useState<{
    a2pStatus: A2pApprovalStatus;
    smsOptInEnabled: boolean;
    autoSendEnabled: boolean;
    consentDisclosureVersion: string;
    campaignSid: string;
    messagingServiceSid: string;
  }>({
    a2pStatus: 'not_configured',
    smsOptInEnabled: true,
    autoSendEnabled: false,
    consentDisclosureVersion: 'v1.0',
    campaignSid: '',
    messagingServiceSid: '',
  });
  const [isSavingSmsConfig, setIsSavingSmsConfig] = useState(false);
  const [smsConfigFeedback, setSmsConfigFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [copiedConsentBizId, setCopiedConsentBizId] = useState<string | null>(null);

  // System Monitoring recovery state
  const [isTriggeringRecovery, setIsTriggeringRecovery] = useState(false);
  const [recoveryFeedback, setRecoveryFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    setSupabaseUrl(supabaseConfig.url);
    setSupabaseAnonKey(supabaseConfig.anonKey);
  }, [supabaseConfig.url, supabaseConfig.anonKey]);

  useEffect(() => {
    if (!selectedBizId && (currentTenant.id || availableTenants[0]?.id)) {
      setSelectedBizId(currentTenant.id || availableTenants[0]?.id || '');
    }
  }, [currentTenant.id, availableTenants, selectedBizId]);

  useEffect(() => {
    const biz = availableTenants.find(b => b.id === selectedBizId);
    const existing = biz?.settings?.communicationChannels;
    const originsList = Array.isArray(existing?.webChat?.allowedOrigins)
      ? existing.webChat.allowedOrigins
      : [];
    setChannelDraft({
      whatsapp: {
        status: existing?.whatsapp?.status || 'not_configured',
        provider: existing?.whatsapp?.provider || 'whatsapp_cloud',
        displayPhoneNumber: existing?.whatsapp?.displayPhoneNumber || '',
        businessAccountLabel: existing?.whatsapp?.businessAccountLabel || '',
        verifiedByBackend: Boolean(existing?.whatsapp?.verifiedByBackend),
        lastCheckedAt: existing?.whatsapp?.lastCheckedAt,
        notes: existing?.whatsapp?.notes || '',
      },
      sms: {
        status: existing?.sms?.status || 'not_configured',
        provider: existing?.sms?.provider || 'twilio_a2p',
        fromPhoneNumber: existing?.sms?.fromPhoneNumber || '',
        verifiedByBackend: Boolean(existing?.sms?.verifiedByBackend),
        lastCheckedAt: existing?.sms?.lastCheckedAt,
      },
      webChat: {
        status: existing?.webChat?.status || 'not_configured',
        enabled: Boolean(existing?.webChat?.enabled),
        widgetPublicId: existing?.webChat?.widgetPublicId || '',
        allowedOrigins: originsList,
        verifiedByBackend: Boolean(existing?.webChat?.verifiedByBackend),
        lastCheckedAt: existing?.webChat?.lastCheckedAt,
      },
    });
    setAllowedOriginsText(originsList.join(', '));
    setChannelSaveFeedback(null);
  }, [selectedBizId, availableTenants]);

  useEffect(() => {
    const cfg = messagingConfigsByBizId[selectedBizId];
    setSmsA2pDraft({
      a2pStatus: cfg?.a2pStatus || 'not_configured',
      smsOptInEnabled: cfg?.smsOptInEnabled ?? true,
      autoSendEnabled: cfg?.autoSendEnabled ?? false,
      consentDisclosureVersion: cfg?.consentDisclosureVersion || 'v1.0',
      campaignSid: cfg?.campaignSid || '',
      messagingServiceSid: cfg?.messagingServiceSid || '',
    });
    setSmsConfigFeedback(null);
  }, [selectedBizId, messagingConfigsByBizId]);

  useEffect(() => {
    if (!canViewPlatformAdmin) return;
    const targetId = detailTenant?.id || selectedBizId;
    if (targetId) {
      reloadBusinessMembers(targetId);
      reloadAuditLogs(targetId);
    }
    reloadBusinessInvitations(inviteScopeFilter === 'selected' ? targetId || undefined : undefined);
  }, [
    canViewPlatformAdmin,
    selectedBizId,
    detailTenant?.id,
    inviteScopeFilter,
    reloadBusinessMembers,
    reloadAuditLogs,
    reloadBusinessInvitations,
  ]);

  // Filtered & sorted businesses
  const filteredBusinesses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = availableTenants.filter(biz => {
      const normalizedCat = normalizeCategoryId(biz.category);
      const catLabel = getCategoryDisplayLabel(
        biz.category,
        language,
        biz.categoryLabelEn,
        biz.categoryLabelEs,
        biz.settings?.categoryDetails?.customName
      ).toLowerCase();

      const matchesSearch =
        !q ||
        biz.name.toLowerCase().includes(q) ||
        biz.id.toLowerCase().includes(q) ||
        (biz.email || '').toLowerCase().includes(q) ||
        catLabel.includes(q);

      const matchesCat = categoryFilter === 'all' || normalizedCat === categoryFilter;
      const isBizActive = biz.isActive !== false;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && isBizActive) ||
        (statusFilter === 'suspended' && !isBizActive);

      return matchesSearch && matchesCat && matchesStatus;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (sortBy === 'name_desc') return b.name.localeCompare(a.name);
      const numA = Number(a.id) || 0;
      const numB = Number(b.id) || 0;
      if (sortBy === 'id_desc') return numB - numA;
      return numA - numB;
    });
  }, [availableTenants, searchQuery, categoryFilter, statusFilter, sortBy, language]);

  const totalPages = Math.max(1, Math.ceil(filteredBusinesses.length / pageSize));
  const paginatedBusinesses = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredBusinesses.slice(start, start + pageSize);
  }, [filteredBusinesses, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, statusFilter, sortBy]);

  const filteredInvitations = useMemo(() => {
    if (inviteStatusFilter === 'all') return businessInvitations;
    return businessInvitations.filter(inv => inv.status === inviteStatusFilter);
  }, [businessInvitations, inviteStatusFilter]);

  // Unique categories present for filter select
  const categoryOptionsForFilter = useMemo(() => {
    const presentIds = new Set(availableTenants.map(tnt => normalizeCategoryId(tnt.category)));
    return BUSINESS_CATEGORIES.filter(c => presentIds.has(c.id));
  }, [availableTenants]);

  const filteredIncidents = useMemo(() => {
    const q = incidentSearchQuery.trim().toLowerCase();
    return platformIncidents.filter(inc => {
      const matchesSearch =
        !q ||
        inc.title.toLowerCase().includes(q) ||
        inc.description.toLowerCase().includes(q) ||
        (inc.errorCode || '').toLowerCase().includes(q) ||
        (inc.businessName || '').toLowerCase().includes(q) ||
        inc.id.toLowerCase().includes(q);
      const matchesSource = incidentSourceFilter === 'all' || inc.source === incidentSourceFilter;
      const matchesSeverity = incidentSeverityFilter === 'all' || inc.severity === incidentSeverityFilter;
      const matchesStatus = incidentStatusFilter === 'all' || inc.status === incidentStatusFilter;
      const matchesBiz = incidentBusinessFilter === 'all' || inc.businessId === incidentBusinessFilter;
      return matchesSearch && matchesSource && matchesSeverity && matchesStatus && matchesBiz;
    });
  }, [
    platformIncidents,
    incidentSearchQuery,
    incidentSourceFilter,
    incidentSeverityFilter,
    incidentStatusFilter,
    incidentBusinessFilter,
  ]);

  const filteredSupportTickets = useMemo(() => {
    const q = ticketSearchQuery.trim().toLowerCase();
    return supportTickets.filter(tk => {
      const matchesSearch =
        !q ||
        tk.id.toLowerCase().includes(q) ||
        tk.subject.toLowerCase().includes(q) ||
        tk.description.toLowerCase().includes(q) ||
        (tk.businessName || '').toLowerCase().includes(q) ||
        (tk.createdByName || '').toLowerCase().includes(q);
      const matchesBiz = ticketBusinessFilter === 'all' || tk.businessId === ticketBusinessFilter;
      const matchesCat = ticketCategoryFilter === 'all' || tk.category === ticketCategoryFilter;
      const matchesPriority = ticketPriorityFilter === 'all' || tk.priority === ticketPriorityFilter;
      const matchesStatus = ticketStatusFilter === 'all' || tk.status === ticketStatusFilter;
      const matchesUnresolved =
        !unresolvedTicketsOnly || (tk.status !== 'resolved' && tk.status !== 'closed');
      const matchesUnread = !unreadTicketsOnly || tk.unreadByAdmin;
      return (
        matchesSearch &&
        matchesBiz &&
        matchesCat &&
        matchesPriority &&
        matchesStatus &&
        matchesUnresolved &&
        matchesUnread
      );
    });
  }, [
    supportTickets,
    ticketSearchQuery,
    ticketBusinessFilter,
    ticketCategoryFilter,
    ticketPriorityFilter,
    ticketStatusFilter,
    unresolvedTicketsOnly,
    unreadTicketsOnly,
  ]);

  const totalTicketPages = Math.max(1, Math.ceil(filteredSupportTickets.length / ticketPageSize));
  const paginatedSupportTickets = useMemo(() => {
    const start = (ticketPage - 1) * ticketPageSize;
    return filteredSupportTickets.slice(start, start + ticketPageSize);
  }, [filteredSupportTickets, ticketPage]);

  useEffect(() => {
    setTicketPage(1);
  }, [
    ticketSearchQuery,
    ticketBusinessFilter,
    ticketCategoryFilter,
    ticketPriorityFilter,
    ticketStatusFilter,
    unresolvedTicketsOnly,
    unreadTicketsOnly,
  ]);

  const selectedTicket = useMemo(() => {
    const inList = supportTickets.find(tk => tk.id === selectedTicketId);
    if (inList) return inList;
    if (fetchedTicketFallback && fetchedTicketFallback.id === selectedTicketId) {
      return fetchedTicketFallback;
    }
    return null;
  }, [supportTickets, selectedTicketId, fetchedTicketFallback]);

  useEffect(() => {
    if (!canViewPlatformAdmin || !pendingAdminTicketId) return;
    let active = true;
    setSection('support-center');
    setTicketSearchQuery('');
    setTicketBusinessFilter('all');
    setTicketStatusFilter('all');
    setUnresolvedTicketsOnly(false);
    setUnreadTicketsOnly(false);
    setSelectedTicketId(pendingAdminTicketId);
    if (fetchAndSelectTicket) {
      fetchAndSelectTicket(pendingAdminTicketId).then(found => {
        if (active && found) setFetchedTicketFallback(found);
      });
    }
    setPendingAdminTicketId?.(null);
    return () => {
      active = false;
    };
  }, [canViewPlatformAdmin, pendingAdminTicketId, fetchAndSelectTicket, setPendingAdminTicketId]);

  useEffect(() => {
    if (!canViewPlatformAdmin || !pendingAdminIncidentId) return;
    let active = true;
    setSection('incidents');
    const localFound = platformIncidents.find(i => i.id === pendingAdminIncidentId) || null;
    if (localFound) {
      setSelectedIncidentForDetail(localFound);
    } else if (fetchAndSelectIncident) {
      fetchAndSelectIncident(pendingAdminIncidentId).then(found => {
        if (active && found) setSelectedIncidentForDetail(found);
      });
    }
    setPendingAdminIncidentId?.(null);
    return () => {
      active = false;
    };
  }, [
    canViewPlatformAdmin,
    pendingAdminIncidentId,
    platformIncidents,
    fetchAndSelectIncident,
    setPendingAdminIncidentId,
  ]);

  useEffect(() => {
    if (section === 'support-center' && selectedTicketId) {
      let active = true;
      setTicketActionFeedback(null);
      loadTicketMessages(selectedTicketId).then(msgs => {
        if (!active) return;
        setAdminMessagesByTicket(prev => ({ ...prev, [selectedTicketId]: msgs }));
      });
      loadTicketStatusHistory?.(selectedTicketId);
      markTicketRead(selectedTicketId);
      return () => {
        active = false;
      };
    }
  }, [section, selectedTicketId, loadTicketMessages, loadTicketStatusHistory, markTicketRead]);

  if (!canViewPlatformAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-12 p-8 rounded-2xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 shadow-xs text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          {t.superAdmin.accessDeniedTitle}
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          {t.superAdmin.accessDeniedDesc}
        </p>
      </div>
    );
  }

  const activeBusinessesCount =
    platformMetrics.activeBusinesses ?? availableTenants.filter(b => b.isActive !== false).length;
  const suspendedBusinessesCount =
    platformMetrics.suspendedBusinesses ?? availableTenants.filter(b => b.isActive === false).length;
  const pendingInvitationsCount = businessInvitations.filter(i => i.status === 'pending').length;
  const failedInvitations = businessInvitations.filter(i => i.status === 'failed');
  const unresolvedTicketsCount = supportTickets.filter(
    tk => tk.status !== 'resolved' && tk.status !== 'closed'
  ).length;
  const awaitingAttentionTicketsCount = supportTickets.filter(tk => tk.unreadByAdmin).length;
  const unreadAdminAlertsCount = supportNotifications.filter(
    n => n.targetRole === 'super_admin' && !n.isRead
  ).length;
  const technicalIssuesCount =
    platformIncidents.filter(i => i.status !== 'resolved').length +
    failedInvitations.length +
    capturedTechnicalIncidents.length +
    (authDiagnosticError ? 1 : 0);

  const handleRequestToggleBusinessStatus = (biz: Tenant) => {
    if (!canViewPlatformAdmin || !isSuperAdmin || isSuperAdminCheckFailed) {
      addToast('error', t.common.error, t.superAdmin.accessDeniedDesc);
      return;
    }
    setPendingStatusToggleBiz(biz);
  };

  const handleConfirmToggleBusinessStatus = async () => {
    if (!pendingStatusToggleBiz) return;
    if (!canViewPlatformAdmin || !isSuperAdmin || isSuperAdminCheckFailed) {
      addToast('error', t.common.error, t.superAdmin.accessDeniedDesc);
      setPendingStatusToggleBiz(null);
      return;
    }
    const targetBiz = pendingStatusToggleBiz;
    const nextActive = targetBiz.isActive === false;
    setTogglingBizId(targetBiz.id);
    const res = await toggleBusinessActive(targetBiz.id, nextActive);
    setTogglingBizId(null);
    setPendingStatusToggleBiz(null);
    if (res.success && detailTenant?.id === targetBiz.id) {
      setDetailTenant(prev => (prev ? { ...prev, isActive: nextActive } : null));
    }
  };

  const buildSmsConsentUrl = (businessId: string): string => {
    const rel = buildPublicRouteHref('sms-consent', { businessId });
    if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
      return `${window.location.origin}${rel}`;
    }
    return rel;
  };

  const handleCopyConsentLink = async (businessId: string) => {
    const url = buildSmsConsentUrl(businessId);
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      // Clipboard may be restricted in headless test env; still reflect feedback cleanly
    }
    setCopiedConsentBizId(businessId);
    addToast('success', t.common.success, `${t.superAdmin.copiedConsentLink}: ${url}`);
    setTimeout(() => setCopiedConsentBizId(prev => (prev === businessId ? null : prev)), 2500);
  };

  const handleSaveChannels = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBizId || !updateBusinessCommunicationChannels) return;
    if (!canViewPlatformAdmin || !isSuperAdmin || isSuperAdminCheckFailed) {
      setChannelSaveFeedback({ type: 'error', text: t.superAdmin.accessDeniedDesc });
      return;
    }
    setIsSavingChannels(true);
    setChannelSaveFeedback(null);
    const res = await updateBusinessCommunicationChannels(selectedBizId, channelDraft);
    setIsSavingChannels(false);
    if (res.success) {
      setChannelSaveFeedback({
        type: 'success',
        text: isEs
          ? 'Metadatos de canales guardados. La verificación activa requiere el conector backend.'
          : 'Channel metadata saved. Active status requires backend verification.',
      });
    } else {
      setChannelSaveFeedback({
        type: 'error',
        text: res.error || 'Unable to save communication channels.',
      });
    }
  };

  const handleSaveSmsA2pConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBizId || !updateBusinessMessagingConfig) return;
    if (!canViewPlatformAdmin || !isSuperAdmin || isSuperAdminCheckFailed) {
      setSmsConfigFeedback({ type: 'error', text: t.superAdmin.accessDeniedDesc });
      return;
    }
    setIsSavingSmsConfig(true);
    setSmsConfigFeedback(null);
    const res = await updateBusinessMessagingConfig({
      businessId: selectedBizId,
      a2pStatus: smsA2pDraft.a2pStatus,
      smsOptInEnabled: smsA2pDraft.smsOptInEnabled,
      autoSendEnabled: smsA2pDraft.autoSendEnabled,
      consentDisclosureVersion: smsA2pDraft.consentDisclosureVersion,
      campaignSid: smsA2pDraft.campaignSid,
      messagingServiceSid: smsA2pDraft.messagingServiceSid,
    });
    setIsSavingSmsConfig(false);
    if (res.success) {
      setSmsConfigFeedback({
        type: 'success',
        text: isEs
          ? 'Configuración SMS / A2P actualizada correctamente.'
          : 'SMS / A2P configuration updated.',
      });
    } else {
      setSmsConfigFeedback({
        type: 'error',
        text: res.error || t.superAdmin.autoSendBlockedNotice,
      });
    }
  };

  const handleTriggerNotificationRecovery = async () => {
    if (!triggerBookingNotificationRecovery || isTriggeringRecovery) return;
    setIsTriggeringRecovery(true);
    setRecoveryFeedback(null);
    try {
      const res = await triggerBookingNotificationRecovery();
      if (res.success) {
        setRecoveryFeedback({
          type: 'success',
          text:
            res.message ||
            `Recovered: ${res.recoveredCount ?? 0}, Rescheduled: ${res.rescheduledCount ?? 0}, Abandoned: ${res.abandonedCount ?? 0}`,
        });
      } else {
        setRecoveryFeedback({
          type: res.requiresBackendWorker ? 'warning' : 'error',
          text: res.error || 'Unable to execute notification recovery.',
        });
      }
    } finally {
      setIsTriggeringRecovery(false);
    }
  };

  const handleMemberActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBizId || !memberEmail.trim()) return;
    setIsSubmittingMemberAction(true);
    setMemberActionFeedback(null);

    const res =
      memberActionMode === 'invite'
        ? await inviteBusinessOwner({
            businessId: selectedBizId,
            email: memberEmail.trim(),
            role: memberRole,
          })
        : await assignExistingUserToBusiness({
            businessId: selectedBizId,
            email: memberEmail.trim(),
            role: memberRole,
          });

    setIsSubmittingMemberAction(false);
    if (res.success) {
      setMemberEmail('');
      setMemberActionFeedback({
        type: 'success',
        text: res.message || t.common.success,
      });
    } else {
      const errMsg = res.error || 'Operation failed.';
      setMemberActionFeedback({
        type: 'error',
        text: errMsg,
      });
      addToast('error', t.common.error, errMsg);
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    setBusyInvitationId(invitationId);
    const filterBiz = inviteScopeFilter === 'selected' ? selectedBizId || undefined : undefined;
    const res = await resendBusinessInvitation(invitationId, filterBiz);
    setBusyInvitationId(null);
    if (!res.success && res.error) {
      addToast('error', t.common.error, res.error);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    setBusyInvitationId(invitationId);
    const filterBiz = inviteScopeFilter === 'selected' ? selectedBizId || undefined : undefined;
    const res = await revokeBusinessInvitation(invitationId, filterBiz);
    setBusyInvitationId(null);
    if (!res.success && res.error) {
      addToast('error', t.common.error, res.error);
    }
  };

  const handleRemoveMember = async (bizId: string, userId: string) => {
    const res = await removeBusinessMember(bizId, userId);
    if (res.success) {
      reloadAuditLogs(bizId);
    } else if (res.error) {
      addToast('error', t.common.error, res.error);
    }
  };

  const handleConnectSupabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) return;
    if (isPrivilegedServiceRoleKey(supabaseAnonKey)) {
      addToast('error', t.common.error, t.superAdmin.infrastructure.serviceRoleWarning);
      return;
    }
    const normalized = normalizeSupabaseUrl(supabaseUrl);
    const cleanUrl = normalized.isValid ? normalized.url : supabaseUrl.trim();
    if (normalized.isValid) setSupabaseUrl(cleanUrl);
    setIsConnecting(true);
    await updateSupabaseConfig(cleanUrl, supabaseAnonKey.trim());
    setIsConnecting(false);
  };

  const handleSendAdminReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || selectedTicket.status === 'closed' || !adminReplyText.trim() || isSendingAdminReply) {
      return;
    }
    setIsSendingAdminReply(true);
    setTicketActionFeedback(null);
    try {
      const res = await sendTicketReply(
        selectedTicket.id,
        selectedTicket.businessId,
        adminReplyText.trim()
      );
      if (res.success) {
        setAdminReplyText('');
        if (res.messageRecord) {
          setAdminMessagesByTicket(prev => {
            const existing = prev[selectedTicket.id] || [];
            if (existing.some(m => m.id === res.messageRecord!.id)) return prev;
            return {
              ...prev,
              [selectedTicket.id]: [...existing, res.messageRecord!],
            };
          });
        }
        setTicketActionFeedback({
          type: 'success',
          text: isEs ? 'Respuesta enviada correctamente.' : 'Support reply sent.',
        });
      } else if (res.error) {
        setTicketActionFeedback({ type: 'error', text: res.error });
        addToast('error', t.common.error, res.error);
      }
    } finally {
      setIsSendingAdminReply(false);
    }
  };

  const handleAdminTicketStatusChange = async (ticketId: string, nextStatus: SupportTicketStatus) => {
    if (isUpdatingTicketStatus) return;
    setIsUpdatingTicketStatus(true);
    setTicketActionFeedback(null);
    try {
      const res = await updateTicketStatus(ticketId, nextStatus);
      if (res.success) {
        setFetchedTicketFallback(prev =>
          prev && prev.id === ticketId ? { ...prev, status: nextStatus } : prev
        );
        setTicketActionFeedback({
          type: 'success',
          text: isEs ? 'Estado actualizado.' : 'Ticket status updated.',
        });
      } else if (res.error) {
        setTicketActionFeedback({ type: 'error', text: res.error });
        addToast('error', t.common.error, res.error);
      }
    } finally {
      setIsUpdatingTicketStatus(false);
    }
  };

  const handleIncidentStatusUpdate = async (incidentId: string, nextStatus: IncidentStatus) => {
    if (!updatePlatformIncidentStatus || updatingIncidentId) return;
    setUpdatingIncidentId(incidentId);
    setIncidentActionFeedback(null);
    try {
      const res = await updatePlatformIncidentStatus(incidentId, nextStatus);
      if (res.success) {
        setSelectedIncidentForDetail(prev =>
          prev && prev.id === incidentId
            ? {
                ...prev,
                status: nextStatus,
                resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : undefined,
              }
            : prev
        );
        setIncidentActionFeedback({
          type: 'success',
          text: isEs ? 'Estado del incidente actualizado.' : 'Incident status updated.',
        });
      } else if (res.error) {
        setIncidentActionFeedback({ type: 'error', text: res.error });
        addToast('error', t.common.error, res.error);
      }
    } finally {
      setUpdatingIncidentId(null);
    }
  };

  const formatSupportActor = (
    name?: string,
    rawCreatedBy?: string,
    fallback?: string
  ): string => {
    if (name && name.trim()) return name.trim();
    if (
      rawCreatedBy &&
      rawCreatedBy.trim() &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        rawCreatedBy.trim()
      )
    ) {
      return rawCreatedBy.trim();
    }
    return fallback || (isEs ? 'Miembro del Negocio' : 'Business Member');
  };

  const activeSqlText =
    sqlViewTab === 'invitations'
      ? SUPABASE_INVITATIONS_MIGRATION_SQL
      : sqlViewTab === 'support_system'
      ? SUPABASE_SUPPORT_SYSTEM_SQL
      : sqlViewTab === 'bigint'
      ? SUPABASE_BIGINT_SUPERADMIN_MIGRATION_SQL
      : sqlViewTab === 'status'
      ? SUPABASE_BUSINESS_STATUS_SQL
      : sqlViewTab === 'incidents'
      ? SUPABASE_SUPPORT_INCIDENTS_SQL
      : SUPABASE_SQL_SCHEMA;

  const handleCopySql = () => {
    navigator.clipboard.writeText(activeSqlText);
    setIsCopiedSql(true);
    addToast('success', t.common.success, t.superAdmin.infrastructure.sqlCopied);
    setTimeout(() => setIsCopiedSql(false), 3000);
  };

  const getInvitationStatusBadge = (status: string) => {
    if (status === 'accepted') {
      return {
        label: t.superAdmin.statusAccepted,
        className: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    }
    if (status === 'failed') {
      return {
        label: t.superAdmin.statusFailed,
        className: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
      };
    }
    if (status === 'expired') {
      return {
        label: t.superAdmin.statusExpired,
        className: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
      };
    }
    if (status === 'revoked') {
      return {
        label: t.superAdmin.statusRevoked,
        className: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
      };
    }
    return {
      label: t.superAdmin.statusPending,
      className: 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    };
  };

  const sectionTabs = [
    { id: 'businesses' as const, label: isEs ? 'Negocios' : 'Businesses', icon: Building2, count: availableTenants.length },
    { id: 'invitations' as const, label: isEs ? 'Invitaciones y Equipo' : 'Invitations & Access', icon: Mail, count: pendingInvitationsCount || undefined },
    { id: 'channels' as const, label: t.superAdmin.channelsTab, icon: Radio },
    { id: 'sms-a2p' as const, label: t.superAdmin.smsA2pTab, icon: Smartphone },
    { id: 'support-center' as const, label: t.nav.supportCenter, icon: LifeBuoy, count: unresolvedTicketsCount || undefined },
    { id: 'incidents' as const, label: t.nav.supportIncidents, icon: AlertTriangle, count: technicalIssuesCount || undefined },
    { id: 'monitoring' as const, label: t.superAdmin.monitoringTab, icon: BellRing },
    { id: 'activity' as const, label: isEs ? 'Auditoría' : 'Activity Logs', icon: Activity },
    { id: 'infrastructure' as const, label: isEs ? 'Infraestructura' : 'Infrastructure', icon: ServerCog },
  ];

  const healthLabel =
    platformMetrics.systemHealth === 'healthy'
      ? (isEs ? 'Operativo' : 'Operational')
      : platformMetrics.systemHealth === 'degraded'
      ? (isEs ? 'Degradado' : 'Degraded')
      : platformMetrics.systemHealth === 'offline'
      ? (isEs ? 'Sin Conexión' : 'Offline')
      : (isEs ? 'Modo Demo' : 'Demo Sandbox');

  const healthBadgeColor =
    platformMetrics.systemHealth === 'healthy'
      ? 'text-emerald-600 dark:text-emerald-400'
      : platformMetrics.systemHealth === 'degraded'
      ? 'text-amber-600 dark:text-amber-400'
      : platformMetrics.systemHealth === 'offline'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-indigo-600 dark:text-indigo-400';

  const getChannelStatusBadge = (state: ChannelConnectionState, verifiedByBackend?: boolean) => {
    if (state === 'connected' && verifiedByBackend) {
      return {
        label: t.superAdmin.channelConnected,
        className: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    }
    if (state === 'suspended') {
      return {
        label: t.superAdmin.channelSuspended,
        className: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
      };
    }
    if (state === 'pending_backend' || (state === 'connected' && !verifiedByBackend)) {
      return {
        label: t.superAdmin.channelPendingBackend,
        className: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      };
    }
    return {
      label: t.superAdmin.channelNotConfigured,
      className: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    };
  };

  return (
    <div className="space-y-6">
      {/* Header Console Bar */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t.auth.roleSuperAdmin}</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              {t.superAdmin.title}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t.superAdmin.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                reloadPlatformMetrics();
                reloadPlatformIncidents();
                reloadSupportTickets();
                reloadBusinessOwners?.();
                reloadBookingNotificationHealth?.();
                reloadN8nIntegrationHealth?.();
                reloadSmsA2pOverview?.();
                if (selectedBizId) {
                  reloadBusinessMembers(selectedBizId);
                  reloadAuditLogs(selectedBizId);
                }
                reloadBusinessInvitations(inviteScopeFilter === 'selected' ? selectedBizId || undefined : undefined);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
              <span>{t.common.refresh}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsWizardOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{isEs ? 'Nuevo Negocio' : 'New Business'}</span>
            </button>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl overflow-x-auto text-xs font-semibold">
          {sectionTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = section === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs ring-1 ring-slate-900/5 dark:ring-white/10'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[10px] font-mono tabular-nums">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Platform-Wide Aggregated KPIs (Zero individual customer names or single-business booking PII) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">{t.superAdmin.totalBusinesses}</span>
            <Building2 className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {platformMetrics.totalBusinesses || availableTenants.length}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            {isEs ? 'Negocios en plataforma' : 'Platform workspaces'}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">{t.superAdmin.activeBusinesses}</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {activeBusinessesCount}
            </span>
            <button
              type="button"
              onClick={() => {
                setSection('businesses');
                setStatusFilter('suspended');
              }}
              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                suspendedBusinessesCount > 0
                  ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              {suspendedBusinessesCount} {t.superAdmin.suspendedBusinesses}
            </button>
          </div>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium truncate">
            {isEs ? 'Habilitados / Suspendidos' : 'Operational vs Suspended'}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">{t.superAdmin.totalCustomers}</span>
            <Users className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {platformMetrics.totalCustomers !== null ? platformMetrics.totalCustomers : '—'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            {isEs ? 'Conteo agregado global' : 'Platform-wide aggregate'}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">{t.superAdmin.totalAppointments}</span>
            <CalendarDays className="w-4 h-4 text-violet-500" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {platformMetrics.totalAppointments !== null ? platformMetrics.totalAppointments : '—'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            {isEs ? 'Conteo agregado global' : 'Platform-wide aggregate'}
          </p>
        </div>

        <div className="col-span-2 lg:col-span-1 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">{t.superAdmin.systemHealth}</span>
            <Activity className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-lg font-extrabold tracking-tight ${healthBadgeColor}`}>
              {healthLabel}
            </span>
            <button
              type="button"
              onClick={() => setSection('monitoring')}
              className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
            >
              {t.superAdmin.monitoringTab} →
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate" title={platformMetrics.healthDetail}>
            {platformMetrics.healthDetail || (isEs ? 'Auth & RLS activos' : 'Supabase Auth & RLS')}
          </p>
        </div>
      </div>

      {/* TAB 1: BUSINESSES OVERVIEW */}
      {section === 'businesses' && (
        <div className="space-y-5">
          {/* Compact Real-Data Support & Incident Summary Strip (Zero customer PII / booking rows) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2.5 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <LifeBuoy className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {t.superAdmin.overviewSupportSummaryTitle}
                </h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800">
                  <span className="block text-[11px] text-slate-500 truncate">{t.superAdmin.openTicketsMetric}</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {unresolvedTicketsCount}
                  </span>
                </div>
                <div className="px-3 py-2 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/60">
                  <span className="block text-[11px] text-indigo-700 dark:text-indigo-300 truncate">{t.superAdmin.awaitingAttentionMetric}</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-indigo-700 dark:text-indigo-300">
                    {awaitingAttentionTicketsCount}
                  </span>
                </div>
                <div className="px-3 py-2 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/60">
                  <span className="block text-[11px] text-amber-800 dark:text-amber-300 truncate">{t.superAdmin.unresolvedIncidentsMetric}</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-amber-800 dark:text-amber-300">
                    {technicalIssuesCount}
                  </span>
                </div>
                <div className="px-3 py-2 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/60">
                  <span className="block text-[11px] text-rose-700 dark:text-rose-300 truncate">{t.superAdmin.unreadAdminAlertsMetric}</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-rose-700 dark:text-rose-300">
                    {unreadAdminAlertsCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSection('support-center')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200/80 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <LifeBuoy className="w-3.5 h-3.5" />
                <span>{t.nav.supportCenter}</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setSection('incidents')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200/80 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{t.nav.supportIncidents}</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          {/* Toolbar */}
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={isEs ? 'Buscar por nombre, ID o categoría...' : 'Search by name, ID, or category...'}
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todas las categorías' : 'All Categories'}</option>
                {categoryOptionsForFilter.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {isEs ? cat.labelEs : cat.labelEn}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todos los estados' : 'All Statuses'}</option>
                <option value="active">{isEs ? 'Activos' : 'Active'}</option>
                <option value="suspended">{isEs ? 'Suspendidos' : 'Suspended'}</option>
              </select>

              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="name_asc">{isEs ? 'Nombre (A–Z)' : 'Name (A–Z)'}</option>
                <option value="name_desc">{isEs ? 'Nombre (Z–A)' : 'Name (Z–A)'}</option>
                <option value="id_desc">{isEs ? 'ID (Recientes)' : 'ID (Newest)'}</option>
                <option value="id_asc">{isEs ? 'ID (Antiguos)' : 'ID (Oldest)'}</option>
              </select>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 self-start lg:self-auto">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Table view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'cards'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Card view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>

          {filteredBusinesses.length === 0 ? (
            <div className="py-14 px-6 text-center space-y-2">
              <Building2 className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {isEs ? 'No se encontraron negocios' : 'No businesses match your filters'}
              </p>
              <p className="text-xs text-slate-400">
                {isEs ? 'Ajusta los filtros o crea un nuevo negocio.' : 'Adjust search criteria or provision a new workspace.'}
              </p>
            </div>
          ) : viewMode === 'table' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-5">{isEs ? 'Negocio' : 'Business'}</th>
                    <th className="py-3 px-4">{t.superAdmin.assignedOwnersCol}</th>
                    <th className="py-3 px-4">{isEs ? 'Categoría' : 'Category'}</th>
                    <th className="py-3 px-4">{isEs ? 'Zona Horaria' : 'Timezone'}</th>
                    <th className="py-3 px-4">{isEs ? 'Estado' : 'Status'}</th>
                    <th className="py-3 px-5 text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {paginatedBusinesses.map(biz => {
                    const isSelectedContext = biz.id === currentTenant.id;
                    const isBizActive = biz.isActive !== false;
                    const catLabel = getCategoryDisplayLabel(
                      biz.category,
                      language,
                      biz.categoryLabelEn,
                      biz.categoryLabelEs,
                      biz.settings?.categoryDetails?.customName
                    );
                    const isBusyToggle = togglingBizId === biz.id;
                    const owners = businessOwnersByBizId[biz.id] || [];

                    return (
                      <tr
                        key={biz.id}
                        className={`transition-colors ${
                          isSelectedContext
                            ? 'bg-indigo-50/40 dark:bg-indigo-950/20'
                            : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3 min-w-0">
                            <WorkspaceAvatar tenant={biz} size="md" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {biz.name}
                                </span>
                                {isSelectedContext && (
                                  <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold whitespace-nowrap">
                                    {isEs ? 'En contexto' : 'Selected'}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-slate-400 truncate">
                                #{biz.id} · {biz.defaultLanguage.toUpperCase()} {biz.email ? `· ${biz.email}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {owners.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1 max-w-[220px]">
                              {owners.map(owner => (
                                <span
                                  key={owner.userId}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-mono truncate max-w-[200px]"
                                  title={`${owner.userEmail || owner.userId} (${owner.role})`}
                                >
                                  <span className="truncate">{owner.userEmail || owner.userId.slice(0, 8)}</span>
                                  <span className="text-[9px] uppercase text-indigo-600 dark:text-indigo-400 font-bold">
                                    {owner.role}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                {t.superAdmin.noOwnerAssigned}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBizId(biz.id);
                                  setMemberActionMode('invite');
                                  setMemberRole('owner');
                                  setSection('invitations');
                                }}
                                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                              >
                                {t.superAdmin.inviteOwnerQuick}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {catLabel}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {formatTimezoneSummary(biz.timezone)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                              isBizActive
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isBizActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {isBizActive ? (isEs ? 'Activo' : 'Active') : (isEs ? 'Suspendido' : 'Suspended')}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailTenant(biz)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                              title={isEs ? 'Ver detalles' : 'View details'}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCurrentTenantId(biz.id);
                                setSelectedBizId(biz.id);
                                setActiveTab('settings');
                              }}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                              title={isEs ? 'Configurar negocio' : 'Manage settings'}
                            >
                              <SettingsIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={isBusyToggle}
                              onClick={() => handleRequestToggleBusinessStatus(biz)}
                              className={`p-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                                isBizActive
                                  ? 'border-amber-200 dark:border-amber-800 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                                  : 'border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                              }`}
                              title={isBizActive ? (isEs ? 'Suspender negocio' : 'Suspend business') : (isEs ? 'Activar negocio' : 'Activate business')}
                              aria-label={isBizActive ? `Suspend ${biz.name}` : `Activate ${biz.name}`}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCurrentTenantId(biz.id);
                                setSelectedBizId(biz.id);
                                setActiveTab('overview');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
                            >
                              <span>{t.superAdmin.switchToBusiness}</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {paginatedBusinesses.map(biz => {
                const isSelectedContext = biz.id === currentTenant.id;
                const isBizActive = biz.isActive !== false;
                const catLabel = getCategoryDisplayLabel(
                  biz.category,
                  language,
                  biz.categoryLabelEn,
                  biz.categoryLabelEs,
                  biz.settings?.categoryDetails?.customName
                );
                const owners = businessOwnersByBizId[biz.id] || [];
                return (
                  <div
                    key={biz.id}
                    className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-4 ${
                      isSelectedContext
                        ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/30 dark:bg-indigo-950/20'
                        : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <WorkspaceAvatar tenant={biz} size="md" />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                            {biz.name}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">{catLabel}</p>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border shrink-0 ${
                          isBizActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        {isBizActive ? (isEs ? 'Activo' : 'Active') : (isEs ? 'Suspendido' : 'Suspended')}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-500 space-y-1">
                      <div>ID #{biz.id} · {biz.defaultLanguage.toUpperCase()}</div>
                      <div className="truncate">{formatTimezoneSummary(biz.timezone)}</div>
                      <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="font-sans text-slate-400">{t.superAdmin.assignedOwnersCol}:</span>
                        {owners.length > 0 ? (
                          owners.map(o => (
                            <span key={o.userId} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                              {o.userEmail || o.userId.slice(0, 8)}
                            </span>
                          ))
                        ) : (
                          <span className="font-sans text-amber-600 dark:text-amber-400">{t.superAdmin.noOwnerAssigned}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailTenant(biz)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {isEs ? 'Detalles' : 'Details'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRequestToggleBusinessStatus(biz)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {isBizActive ? (isEs ? 'Suspender' : 'Suspend') : (isEs ? 'Activar' : 'Activate')}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentTenantId(biz.id);
                          setSelectedBizId(biz.id);
                          setActiveTab('overview');
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold whitespace-nowrap"
                      >
                        <span>{t.superAdmin.switchToBusiness}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono tabular-nums">
                {isEs ? 'Página' : 'Page'} {currentPage} / {totalPages} ({filteredBusinesses.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      {/* TAB 2: INVITATIONS & TEAM ACCESS */}
      {section === 'invitations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Invite Owner / Assign Existing + Members */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t.superAdmin.membersManagementTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t.superAdmin.membersManagementDesc}
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                {t.superAdmin.selectBusinessLabel}
              </label>
              <select
                value={selectedBizId}
                onChange={e => {
                  setSelectedBizId(e.target.value);
                  setCurrentTenantId(e.target.value);
                  setMemberActionFeedback(null);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                {availableTenants.map(biz => (
                  <option key={biz.id} value={biz.id}>
                    {biz.name} (#{biz.id})
                  </option>
                ))}
              </select>
            </div>

            {/* Members */}
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {liveMembers.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  {t.superAdmin.noMembersFound}
                </p>
              ) : (
                liveMembers.map(m => (
                  <div
                    key={m.id || `${m.businessId}-${m.userId}`}
                    className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate font-mono">
                        {m.userEmail || m.userId}
                      </p>
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                        {m.role}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(selectedBizId, m.userId)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      title={t.superAdmin.removeMemberBtn}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Invite / Assign Form */}
            <form onSubmit={handleMemberActionSubmit} className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setMemberActionMode('invite');
                    setMemberActionFeedback(null);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    memberActionMode === 'invite'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Send className="w-3 h-3" />
                  <span>{t.superAdmin.inviteModeTab}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMemberActionMode('assign');
                    setMemberActionFeedback(null);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    memberActionMode === 'assign'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <UserPlus className="w-3 h-3" />
                  <span>{t.superAdmin.assignExistingTab}</span>
                </button>
              </div>

              {memberActionFeedback && (
                <div
                  className={`flex items-start gap-2 p-2.5 rounded-xl text-xs border ${
                    memberActionFeedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {memberActionFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{memberActionFeedback.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="email"
                  required
                  placeholder={
                    memberActionMode === 'invite'
                      ? t.superAdmin.inviteEmailPlaceholder
                      : t.superAdmin.memberEmailPlaceholder
                  }
                  value={memberEmail}
                  onChange={e => setMemberEmail(e.target.value)}
                  className="sm:col-span-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <select
                  value={memberRole}
                  onChange={e => setMemberRole(e.target.value as 'owner' | 'admin' | 'manager' | 'staff')}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  <option value="owner">{t.auth.roleOwner}</option>
                  <option value="admin">{t.auth.roleAdmin}</option>
                  <option value="manager">{t.auth.roleManager}</option>
                  <option value="staff">{t.auth.roleStaff}</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={isSubmittingMemberAction || !selectedBizId || !memberEmail.trim()}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-xs font-semibold transition-all"
              >
                {memberActionMode === 'invite' ? <Send className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                <span>
                  {isSubmittingMemberAction
                    ? t.common.loading
                    : memberActionMode === 'invite'
                    ? t.superAdmin.sendInviteBtn
                    : t.superAdmin.assignExistingBtn}
                </span>
              </button>
            </form>
          </div>

          {/* Right: Invitations Tracker */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-indigo-500" />
                  <span>{t.superAdmin.invitationsTitle}</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.superAdmin.invitationsDesc}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={inviteStatusFilter}
                  onChange={e => setInviteStatusFilter(e.target.value as 'all' | InvitationStatus)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                >
                  <option value="all">{t.common.all}</option>
                  <option value="pending">{t.superAdmin.statusPending}</option>
                  <option value="accepted">{t.superAdmin.statusAccepted}</option>
                  <option value="expired">{t.superAdmin.statusExpired}</option>
                  <option value="revoked">{t.superAdmin.statusRevoked}</option>
                  <option value="failed">{t.superAdmin.statusFailed}</option>
                </select>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setInviteScopeFilter('selected')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      inviteScopeFilter === 'selected'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {t.superAdmin.selectedBusinessOnly}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteScopeFilter('all')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      inviteScopeFilter === 'all'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {t.superAdmin.allBusinessesFilter}
                  </button>
                </div>
              </div>
            </div>

            {filteredInvitations.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                {t.superAdmin.noInvitationsFound}
              </p>
            ) : (
              <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                {filteredInvitations.map(inv => {
                  const badge = getInvitationStatusBadge(inv.status);
                  const isActionable = inv.status === 'pending' || inv.status === 'expired' || inv.status === 'failed';
                  const isBusy = busyInvitationId === inv.id;
                  return (
                    <div
                      key={inv.id}
                      className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold font-mono text-slate-900 dark:text-slate-100 truncate">
                            {inv.email}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                            {inv.role}
                          </span>
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${badge.className}`}>
                            {badge.label}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono tabular-nums">
                          {inv.businessName && (
                            <span>
                              {inv.businessName} (#{inv.businessId})
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {t.superAdmin.expiresLabel}: {new Date(inv.expiresAt).toLocaleDateString()}
                          </span>
                          {inv.resendCount > 0 && (
                            <span>
                              {t.superAdmin.resendsLabel}: {inv.resendCount}
                            </span>
                          )}
                        </div>

                        {inv.lastError && (
                          <p className="text-[11px] text-rose-600 dark:text-rose-400 font-mono break-words">
                            {inv.lastError}
                          </p>
                        )}
                      </div>

                      {isActionable && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleResendInvitation(inv.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-[11px] font-semibold transition-colors disabled:opacity-50"
                          >
                            <RotateCcw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                            <span>{t.superAdmin.resendInviteBtn}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRevokeInvitation(inv.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[11px] font-semibold transition-colors disabled:opacity-50"
                          >
                            <Ban className="w-3 h-3" />
                            <span>{t.superAdmin.revokeInviteBtn}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ACTIVITY & AUDIT LOGS */}
      {section === 'activity' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-500" />
                <span>{t.superAdmin.activityLogsTitle}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isEs
                  ? 'Registro inmutable de acciones administrativas, membresías y cambios de configuración.'
                  : 'Chronological audit trail of administrative changes, memberships, and status updates.'}
              </p>
            </div>

            <select
              value={selectedBizId}
              onChange={e => setSelectedBizId(e.target.value)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              {availableTenants.map(biz => (
                <option key={biz.id} value={biz.id}>
                  {biz.name} (#{biz.id})
                </option>
              ))}
            </select>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              {t.superAdmin.noLogsFound}
            </p>
          ) : (
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {auditLogs.map(log => (
                <div
                  key={log.id}
                  className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                        {log.action}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-mono">
                        {log.entityType}
                        {log.entityId ? ` · ${log.entityId}` : ''}
                      </span>
                    </div>
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <p className="text-[11px] text-slate-500 font-mono truncate">
                        {JSON.stringify(log.metadata)}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: DEDICATED SUPPORT CENTER (SUPER ADMIN ONLY) */}
      {section === 'support-center' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <LifeBuoy className="w-4 h-4 text-violet-500" />
                  <span>{t.superAdmin.supportCenterTitle}</span>
                  <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-mono tabular-nums">
                    {supportTicketsTotalCount ?? supportTickets.length}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.superAdmin.supportCenterSubtitle}
                </p>
              </div>

              <button
                type="button"
                onClick={() => reloadSupportTickets()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors self-start lg:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.common.refresh}</span>
              </button>
            </div>

            {mode === 'supabase' && !supportTicketsTableExists && (
              <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-amber-900 dark:text-amber-200">
                    {isEs
                      ? 'Tablas business_support_tickets y support_ticket_messages pendientes en backend'
                      : 'Backend business_support_tickets & support_ticket_messages tables not yet deployed'}
                  </p>
                  <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
                    {isEs
                      ? 'Ejecuta manualmente la migración 20261113_support_system_hardened_v3.sql en Supabase para persistir tickets entre sesiones.'
                      : 'Manually review and execute 20261113_support_system_hardened_v3.sql in Supabase SQL Editor to persist business support requests.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSection('infrastructure');
                      setSqlViewTab('support_system');
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300 hover:underline pt-0.5"
                  >
                    <span>
                      {isEs
                        ? 'Revisar 20261113_support_system_hardened.sql en Infraestructura'
                        : 'Review 20261113_support_system_hardened.sql in Infrastructure'}
                    </span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Search & Ticket Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2" />
                <input
                  type="text"
                  value={ticketSearchQuery}
                  onChange={e => setTicketSearchQuery(e.target.value)}
                  placeholder={isEs ? 'Buscar asunto, negocio o ID...' : 'Search subject, business, or ID...'}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <select
                aria-label={t.superAdmin.selectBusinessLabel}
                value={ticketBusinessFilter}
                onChange={e => setTicketBusinessFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{t.superAdmin.allBusinessesFilter}</option>
                {availableTenants.map(biz => (
                  <option key={biz.id} value={biz.id}>
                    {biz.name} (#{biz.id})
                  </option>
                ))}
              </select>

              <select
                aria-label="Category filter"
                value={ticketCategoryFilter}
                onChange={e => setTicketCategoryFilter(e.target.value as 'all' | SupportTicketCategory)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todas las categorías' : 'All Categories'}</option>
                {(Object.keys(t.helpSupport.categories) as SupportTicketCategory[]).map(cat => (
                  <option key={cat} value={cat}>
                    {t.helpSupport.categories[cat]}
                  </option>
                ))}
              </select>

              <select
                aria-label="Priority filter"
                value={ticketPriorityFilter}
                onChange={e => setTicketPriorityFilter(e.target.value as 'all' | SupportTicketPriority)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todas las prioridades' : 'All Priorities'}</option>
                {(Object.keys(t.helpSupport.priorities) as SupportTicketPriority[]).map(prio => (
                  <option key={prio} value={prio}>
                    {t.helpSupport.priorities[prio]}
                  </option>
                ))}
              </select>

              <select
                aria-label="Status filter"
                value={ticketStatusFilter}
                onChange={e => setTicketStatusFilter(e.target.value as 'all' | SupportTicketStatus)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todos los estados' : 'All Statuses'}</option>
                {(Object.keys(t.helpSupport.statuses) as SupportTicketStatus[]).map(st => (
                  <option key={st} value={st}>
                    {t.helpSupport.statuses[st]}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unresolvedTicketsOnly}
                  onChange={e => setUnresolvedTicketsOnly(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{isEs ? 'Solo sin resolver' : 'Unresolved only'}</span>
              </label>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unreadTicketsOnly}
                  onChange={e => setUnreadTicketsOnly(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{isEs ? 'Solo no leídos' : 'Unread only'}</span>
              </label>
            </div>

            {/* Master-detail Support Requests Inbox */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-5 space-y-2.5">
                <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                  {paginatedSupportTickets.length === 0 ? (
                    <div className="py-12 px-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-1.5">
                      <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto" />
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {isEs ? 'No hay solicitudes que coincidan' : 'No matching support requests'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {isEs
                          ? 'Las solicitudes enviadas por negocios aparecerán aquí.'
                          : 'Requests submitted by businesses will appear here.'}
                      </p>
                    </div>
                  ) : (
                    paginatedSupportTickets.map(tk => {
                      const isSelected = tk.id === selectedTicket?.id;
                      const prioClass =
                        tk.priority === 'urgent'
                          ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          : tk.priority === 'high'
                          ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
                      return (
                        <button
                          key={tk.id}
                          type="button"
                          onClick={() => setSelectedTicketId(tk.id)}
                          className={`w-full text-left p-4 rounded-xl border transition-all space-y-2 ${
                            isSelected
                              ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700'
                              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              #{tk.id.slice(0, 8)}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {tk.unreadByAdmin && (
                                <span
                                  aria-label={isEs ? 'No leído' : 'Unread'}
                                  className="w-2 h-2 rounded-full bg-indigo-600"
                                />
                              )}
                              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${prioClass}`}>
                                {t.helpSupport.priorities[tk.priority]}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                            {tk.subject}
                          </p>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="truncate font-medium">
                              {tk.businessName || `Business #${tk.businessId}`}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold">
                              {t.helpSupport.statuses[tk.status]}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-slate-400">
                            <span>{new Date(tk.createdAt).toLocaleDateString()}</span>
                            <span>
                              {isEs ? 'Últ. act.: ' : 'Updated: '}
                              {new Date(tk.lastMessageAt).toLocaleString()}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Pagination & Load More */}
                {(totalTicketPages > 1 || hasMoreSupportTickets) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                    {totalTicketPages > 1 ? (
                      <div className="flex items-center gap-1.5 text-slate-500 font-mono tabular-nums">
                        <button
                          type="button"
                          disabled={ticketPage <= 1}
                          onClick={() => setTicketPage(p => Math.max(1, p - 1))}
                          aria-label="Previous ticket page"
                          className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span>
                          {ticketPage} / {totalTicketPages}
                        </span>
                        <button
                          type="button"
                          disabled={ticketPage >= totalTicketPages}
                          onClick={() => setTicketPage(p => Math.min(totalTicketPages, p + 1))}
                          aria-label="Next ticket page"
                          className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                        {filteredSupportTickets.length} / {supportTicketsTotalCount ?? supportTickets.length}
                      </span>
                    )}

                    {hasMoreSupportTickets && (
                      <button
                        type="button"
                        disabled={isLoadingMoreSupportTickets}
                        onClick={() => loadMoreSupportTickets()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold hover:bg-indigo-100 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingMoreSupportTickets ? 'animate-spin' : ''}`} />
                        <span>{t.superAdmin.loadMoreTickets}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Ticket Thread + Status History */}
              <div className="lg:col-span-7 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-5 min-h-[420px] flex flex-col justify-between">
                {!selectedTicket ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-12 space-y-2">
                    <LifeBuoy className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {isEs
                        ? 'Selecciona una solicitud para ver el historial y responder'
                        : 'Select a support request to inspect the thread and respond'}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col h-full space-y-4">
                    {/* Thread header */}
                    <div className="pb-4 border-b border-slate-200/80 dark:border-slate-700/80 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              #{selectedTicket.id.slice(0, 8)}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                              {t.helpSupport.categories[selectedTicket.category]}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                              {t.helpSupport.priorities[selectedTicket.priority]}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                            {selectedTicket.subject}
                          </h3>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {selectedTicket.businessName || `Business #${selectedTicket.businessId}`} ·{' '}
                            {formatSupportActor(selectedTicket.createdByName, selectedTicket.createdBy)} ·{' '}
                            <span className="font-mono tabular-nums">
                              {new Date(selectedTicket.createdAt).toLocaleString()}
                            </span>
                          </p>
                        </div>

                        <select
                          aria-label="Ticket status"
                          disabled={isUpdatingTicketStatus}
                          value={selectedTicket.status}
                          onChange={e =>
                            handleAdminTicketStatusChange(
                              selectedTicket.id,
                              e.target.value as SupportTicketStatus
                            )
                          }
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 disabled:opacity-50"
                        >
                          {(Object.keys(t.helpSupport.statuses) as SupportTicketStatus[]).map(st => (
                            <option key={st} value={st}>
                              {t.helpSupport.statuses[st]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                        {selectedTicket.description}
                      </div>
                    </div>

                    {ticketActionFeedback && (
                      <div
                        className={`p-2.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                          ticketActionFeedback.type === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {ticketActionFeedback.type === 'success' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{ticketActionFeedback.text}</span>
                      </div>
                    )}

                    {/* Chronological Conversation Thread */}
                    <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                      {[...(
                        (supportMessagesByTicket && supportMessagesByTicket[selectedTicket.id]) ||
                        adminMessagesByTicket[selectedTicket.id] ||
                        []
                      )]
                        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                        .map(msg => {
                          const isSupportSender = msg.senderRole === 'super_admin';
                          return (
                            <div
                              key={msg.id}
                              className={`p-3 rounded-xl text-xs space-y-1 ${
                                isSupportSender
                                  ? 'bg-indigo-600 text-white ml-6'
                                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 mr-6'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px] opacity-85">
                                <span className="font-bold">
                                  {isSupportSender
                                    ? t.helpSupport.fromSupportBadge
                                    : `${
                                        msg.senderName ||
                                        formatSupportActor(
                                          selectedTicket.createdByName,
                                          selectedTicket.createdBy
                                        )
                                      } · ${msg.senderRole.toUpperCase()}`}
                                </span>
                                <span className="font-mono tabular-nums">
                                  {new Date(msg.createdAt).toLocaleString()}
                                </span>
                              </div>
                              <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                            </div>
                          );
                        })}
                    </div>

                    {/* Reply Form (Locked when ticket is closed) */}
                    {selectedTicket.status === 'closed' ? (
                      <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-900/70 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>
                          {isEs
                            ? 'Esta solicitud está cerrada. Cambia su estado arriba si necesitas reabrirla.'
                            : 'This support ticket is closed. Change the status above if you need to reopen it.'}
                        </span>
                      </div>
                    ) : (
                      <form onSubmit={handleSendAdminReply} className="pt-2 space-y-2">
                        <textarea
                          rows={3}
                          required
                          value={adminReplyText}
                          onChange={e => setAdminReplyText(e.target.value)}
                          placeholder={
                            isEs
                              ? 'Escribe la respuesta oficial de Soporte Novacode Tech...'
                              : 'Write an official reply from Novacode Tech Support...'
                          }
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="submit"
                            disabled={isSendingAdminReply || !adminReplyText.trim()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>{t.helpSupport.sendReplyBtn}</span>
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Status History Timeline */}
                    <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{t.superAdmin.statusHistoryTitle}</span>
                      </h4>
                      {(supportStatusHistoryByTicket[selectedTicket.id] || []).length === 0 ? (
                        <p className="text-[11px] text-slate-400">{t.superAdmin.noStatusHistory}</p>
                      ) : (
                        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                          {(supportStatusHistoryByTicket[selectedTicket.id] || []).map(entry => (
                            <div
                              key={entry.id}
                              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                <span className="font-mono text-slate-500">
                                  {entry.oldStatus
                                    ? t.helpSupport.statuses[entry.oldStatus as SupportTicketStatus] || entry.oldStatus
                                    : (isEs ? 'Creado' : 'Created')}
                                </span>
                                <span className="text-slate-400">→</span>
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                  {t.helpSupport.statuses[entry.newStatus as SupportTicketStatus] || entry.newStatus}
                                </span>
                                {entry.changedBy && (
                                  <span className="text-slate-500">
                                    · {formatSupportActor(undefined, entry.changedBy, isEs ? 'Administrador' : 'Support Admin')}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono tabular-nums text-[10px] text-slate-400 shrink-0">
                                {new Date(entry.createdAt).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: DEDICATED INCIDENTS TRIAGE (SUPER ADMIN ONLY) */}
      {section === 'incidents' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  <span>{t.superAdmin.supportIncidentsTitle}</span>
                  <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[11px] font-mono tabular-nums">
                    {platformIncidentsTotalCount ?? platformIncidents.length}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.superAdmin.supportIncidentsSubtitle}
                </p>
              </div>

              <button
                type="button"
                onClick={() => reloadPlatformIncidents()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors self-start lg:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.common.refresh}</span>
              </button>
            </div>

            {/* Honest Incident Ingestion Scope Banner */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
              <AlertCircle className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{t.superAdmin.incidentsIngestionNotice}</p>
            </div>

            {mode === 'supabase' && !incidentsTableExists && (
              <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-amber-900 dark:text-amber-200">
                    {isEs ? 'Tabla support_incidents pendiente en backend' : 'Backend support_incidents table not yet deployed'}
                  </p>
                  <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
                    {t.superAdmin.incidentsPendingBackend}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSection('infrastructure');
                      setSqlViewTab('incidents');
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300 hover:underline pt-0.5"
                  >
                    <span>{isEs ? 'Revisar support_incidents.sql en Infraestructura' : 'Review support_incidents.sql in Infrastructure'}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Search & Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2" />
                <input
                  type="text"
                  value={incidentSearchQuery}
                  onChange={e => setIncidentSearchQuery(e.target.value)}
                  placeholder={isEs ? 'Buscar título, código de error o negocio...' : 'Search title, error code, or business...'}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <select
                aria-label="Incident business filter"
                value={incidentBusinessFilter}
                onChange={e => setIncidentBusinessFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{t.superAdmin.allBusinessesFilter}</option>
                {availableTenants.map(biz => (
                  <option key={biz.id} value={biz.id}>
                    {biz.name} (#{biz.id})
                  </option>
                ))}
              </select>

              <select
                aria-label="Incident source filter"
                value={incidentSourceFilter}
                onChange={e => setIncidentSourceFilter(e.target.value as 'all' | IncidentSource)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todas las fuentes' : 'All Sources'}</option>
                <option value="technical_error">{t.superAdmin.sourceTechnicalError}</option>
                <option value="integration_failure">{t.superAdmin.sourceIntegrationFailure}</option>
                <option value="security_alert">{t.superAdmin.sourceSecurityAlert}</option>
                <option value="business_report">{t.superAdmin.sourceBusinessReport}</option>
              </select>

              <select
                aria-label="Incident severity filter"
                value={incidentSeverityFilter}
                onChange={e => setIncidentSeverityFilter(e.target.value as 'all' | IncidentSeverity)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todas las severidades' : 'All Severities'}</option>
                <option value="critical">{t.superAdmin.severityCritical}</option>
                <option value="high">{t.superAdmin.severityHigh}</option>
                <option value="medium">{t.superAdmin.severityMedium}</option>
                <option value="low">{t.superAdmin.severityLow}</option>
              </select>

              <select
                aria-label="Incident status filter"
                value={incidentStatusFilter}
                onChange={e => setIncidentStatusFilter(e.target.value as 'all' | IncidentStatus)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">{isEs ? 'Todos los estados' : 'All Statuses'}</option>
                <option value="open">{t.superAdmin.statusOpen}</option>
                <option value="investigating">{t.superAdmin.statusInvestigating}</option>
                <option value="resolved">{t.superAdmin.statusResolved}</option>
              </select>
            </div>

            {incidentActionFeedback && (
              <div
                className={`p-2.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                  incidentActionFeedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                }`}
              >
                {incidentActionFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{incidentActionFeedback.text}</span>
              </div>
            )}

            {/* Live Session Diagnostics, Captured Technical Crashes & Failed Workflows */}
            {(authDiagnosticError || failedInvitations.length > 0 || capturedTechnicalIncidents.length > 0) && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  {isEs ? 'Incidentes Técnicos Activos Detectados en Sesión' : 'Active Runtime & Workflow Technical Incidents'}
                </h3>

                {authDiagnosticError && (
                  <div className="p-4 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {t.auth.superAdminRpcFailedTitle}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[10px] font-bold uppercase">
                            {t.superAdmin.severityCritical}
                          </span>
                        </div>
                        <p className="text-[11px] text-rose-700 dark:text-rose-300 font-mono break-words mt-0.5">
                          {authDiagnosticError}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {capturedTechnicalIncidents.map(inc => (
                  <div
                    key={inc.id}
                    className="p-4 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-800/60 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {inc.title}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[10px] font-bold uppercase">
                          {inc.severity}
                        </span>
                        {inc.businessId && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono">
                            {inc.businessName ? `${inc.businessName} ` : ''}#{inc.businessId}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-rose-700 dark:text-rose-300 break-words whitespace-pre-wrap">
                        {inc.description}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                      {new Date(inc.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}

                {failedInvitations.map(inv => (
                  <div
                    key={inv.id}
                    className="p-4 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {t.superAdmin.sourceIntegrationFailure}: {inv.businessName || `#${inv.businessId}`}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold uppercase">
                          {t.superAdmin.severityHigh}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono">
                          Business #{inv.businessId}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-rose-700 dark:text-rose-300 break-words">
                        {inv.lastError || `Owner invitation delivery failed (${inv.email})`}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                      {new Date(inv.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Stored Support & Incident Records */}
            {filteredIncidents.length === 0 && !authDiagnosticError && failedInvitations.length === 0 && capturedTechnicalIncidents.length === 0 ? (
              <div className="py-12 px-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-1.5">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t.superAdmin.noIncidentsTitle}
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {t.superAdmin.noIncidentsDesc}
                </p>
              </div>
            ) : filteredIncidents.length > 0 ? (
              <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                {filteredIncidents.map(inc => {
                  const sevBadge =
                    inc.severity === 'critical'
                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                      : inc.severity === 'high'
                      ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';

                  const sourceLabel =
                    inc.source === 'integration_failure'
                      ? t.superAdmin.sourceIntegrationFailure
                      : inc.source === 'security_alert'
                      ? t.superAdmin.sourceSecurityAlert
                      : inc.source === 'business_report'
                      ? t.superAdmin.sourceBusinessReport
                      : t.superAdmin.sourceTechnicalError;

                  const isBusyIncident = updatingIncidentId === inc.id;

                  return (
                    <div
                      key={inc.id}
                      onClick={() => setSelectedIncidentForDetail(inc)}
                      className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {inc.title}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold">
                            {sourceLabel}
                          </span>
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${sevBadge}`}>
                            {inc.severity}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold uppercase">
                            {inc.status}
                          </span>
                          {inc.businessId && (
                            <span className="px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-mono">
                              {inc.businessName ? `${inc.businessName} ` : ''}#{inc.businessId}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                          {inc.description}
                        </p>
                        {inc.errorCode && (
                          <p className="text-[11px] font-mono text-rose-600 dark:text-rose-400">
                            {inc.errorCode}
                          </p>
                        )}
                      </div>

                      <div
                        className="flex flex-col sm:items-end gap-2 shrink-0"
                        onClick={e => e.stopPropagation()}
                      >
                        <span className="text-[11px] font-mono tabular-nums text-slate-400">
                          {new Date(inc.createdAt).toLocaleString()}
                        </span>
                        {inc.resolvedAt && (
                          <span className="text-[10px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                            {isEs ? 'Resuelto: ' : 'Resolved: '}
                            {new Date(inc.resolvedAt).toLocaleString()}
                          </span>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {inc.status !== 'open' && (
                            <button
                              type="button"
                              disabled={isBusyIncident}
                              onClick={() => handleIncidentStatusUpdate(inc.id, 'open')}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-[11px] font-semibold hover:bg-slate-100 disabled:opacity-50 transition-colors"
                            >
                              {t.superAdmin.statusOpen}
                            </button>
                          )}
                          {inc.status !== 'investigating' && (
                            <button
                              type="button"
                              disabled={isBusyIncident}
                              onClick={() => handleIncidentStatusUpdate(inc.id, 'investigating')}
                              className="px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[11px] font-semibold hover:bg-amber-100 disabled:opacity-50 transition-colors"
                            >
                              {t.superAdmin.statusInvestigating}
                            </button>
                          )}
                          {inc.status !== 'resolved' && (
                            <button
                              type="button"
                              disabled={isBusyIncident}
                              onClick={() => handleIncidentStatusUpdate(inc.id, 'resolved')}
                              className="px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                            >
                              {t.superAdmin.statusResolved}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {hasMorePlatformIncidents && (
              <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={isLoadingMorePlatformIncidents}
                  onClick={() => loadMorePlatformIncidents()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold hover:bg-indigo-100 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMorePlatformIncidents ? 'animate-spin' : ''}`} />
                  <span>{t.superAdmin.loadMoreIncidents}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: COMMUNICATION CHANNELS (SUPER ADMIN ONLY) */}
      {section === 'channels' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-indigo-500" />
                  <span>{t.superAdmin.channelsTitle}</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.superAdmin.channelsSubtitle}
                </p>
              </div>

              <div className="min-w-[240px]">
                <select
                  aria-label={t.superAdmin.selectBusinessLabel}
                  value={selectedBizId}
                  onChange={e => setSelectedBizId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  {availableTenants.map(biz => (
                    <option key={biz.id} value={biz.id}>
                      {biz.name} (#{biz.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/70 flex items-start gap-2.5 text-xs text-indigo-900 dark:text-indigo-200">
              <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{t.superAdmin.channelsSecurityNotice}</p>
            </div>

            {channelSaveFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                  channelSaveFeedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                }`}
              >
                {channelSaveFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{channelSaveFeedback.text}</span>
              </div>
            )}

            <form onSubmit={handleSaveChannels} className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* WhatsApp Channel Card */}
                {(() => {
                  const selectedTenantObj = availableTenants.find(b => b.id === selectedBizId);
                  const isSuspended = selectedTenantObj?.isActive === false;
                  const waState: ChannelConnectionState = isSuspended
                    ? 'suspended'
                    : channelDraft.whatsapp.verifiedByBackend
                    ? 'connected'
                    : channelDraft.whatsapp.displayPhoneNumber?.trim() ||
                      channelDraft.whatsapp.businessAccountLabel?.trim()
                    ? 'pending_backend'
                    : 'not_configured';
                  const waBadge = getChannelStatusBadge(waState, channelDraft.whatsapp.verifiedByBackend);
                  return (
                    <div className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {t.superAdmin.whatsappChannelLabel}
                          </h3>
                        </div>
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${waBadge.className}`}>
                          {waBadge.label}
                        </span>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {isEs ? 'Proveedor' : 'Provider'}
                          </label>
                          <select
                            value={channelDraft.whatsapp.provider || 'whatsapp_cloud'}
                            onChange={e =>
                              setChannelDraft(prev => ({
                                ...prev,
                                whatsapp: {
                                  ...prev.whatsapp,
                                  provider: e.target.value as 'whatsapp_cloud' | 'twilio',
                                },
                              }))
                            }
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                          >
                            <option value="whatsapp_cloud">WhatsApp Cloud API</option>
                            <option value="twilio">Twilio WhatsApp</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {isEs ? 'Número Visible (Display)' : 'Display Phone Number'}
                          </label>
                          <input
                            type="text"
                            value={channelDraft.whatsapp.displayPhoneNumber || ''}
                            onChange={e =>
                              setChannelDraft(prev => ({
                                ...prev,
                                whatsapp: { ...prev.whatsapp, displayPhoneNumber: e.target.value },
                              }))
                            }
                            placeholder="+1 (555) 010-0000"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {isEs ? 'Etiqueta de Cuenta Comercial' : 'Business Account Label'}
                          </label>
                          <input
                            type="text"
                            value={channelDraft.whatsapp.businessAccountLabel || ''}
                            onChange={e =>
                              setChannelDraft(prev => ({
                                ...prev,
                                whatsapp: { ...prev.whatsapp, businessAccountLabel: e.target.value },
                              }))
                            }
                            placeholder={isEs ? 'Cuenta Principal' : 'Primary Verified Account'}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {isEs ? 'Notas de Provisión' : 'Provisioning Notes'}
                          </label>
                          <input
                            type="text"
                            value={channelDraft.whatsapp.notes || ''}
                            onChange={e =>
                              setChannelDraft(prev => ({
                                ...prev,
                                whatsapp: { ...prev.whatsapp, notes: e.target.value },
                              }))
                            }
                            placeholder={isEs ? 'Estado de webhook / verificación...' : 'Webhook / verification notes...'}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* SMS Channel Card */}
                {(() => {
                  const selectedTenantObj = availableTenants.find(b => b.id === selectedBizId);
                  const isSuspended = selectedTenantObj?.isActive === false;
                  const msgCfg = messagingConfigsByBizId[selectedBizId];
                  const smsBackendReady = Boolean(
                    msgCfg &&
                      msgCfg.a2pStatus === 'approved' &&
                      msgCfg.autoSendEnabled &&
                      msgCfg.campaignSid &&
                      msgCfg.messagingServiceSid
                  );
                  const smsState: ChannelConnectionState = isSuspended
                    ? 'suspended'
                    : smsBackendReady
                    ? 'connected'
                    : msgCfg?.a2pStatus === 'pending_approval' || channelDraft.sms.fromPhoneNumber?.trim()
                    ? 'pending_backend'
                    : 'not_configured';
                  const smsBadge = getChannelStatusBadge(smsState, smsBackendReady);
                  return (
                    <div className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {t.superAdmin.smsChannelLabel}
                          </h3>
                        </div>
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${smsBadge.className}`}>
                          {smsBadge.label}
                        </span>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {isEs ? 'Número Remitente (No secreto)' : 'From Phone Number (Non-secret)'}
                          </label>
                          <input
                            type="text"
                            value={channelDraft.sms.fromPhoneNumber || ''}
                            onChange={e =>
                              setChannelDraft(prev => ({
                                ...prev,
                                sms: { ...prev.sms, fromPhoneNumber: e.target.value },
                              }))
                            }
                            placeholder="+1 (555) 019-9000"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                          />
                        </div>
                        <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">A2P 10DLC</span>
                            <span className="font-mono font-bold uppercase text-slate-800 dark:text-slate-200">
                              {msgCfg?.a2pStatus || 'not_configured'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">{isEs ? 'Envío Automático' : 'Auto-Send'}</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {msgCfg?.autoSendEnabled ? (isEs ? 'Habilitado' : 'Enabled') : (isEs ? 'Bloqueado / Inactivo' : 'Disabled')}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSection('sms-a2p')}
                          className="w-full py-2 px-3 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <span>{t.superAdmin.smsA2pTab}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Website Chat Channel Card */}
                {(() => {
                  const selectedTenantObj = availableTenants.find(b => b.id === selectedBizId);
                  const isSuspended = selectedTenantObj?.isActive === false;
                  const chatState: ChannelConnectionState = isSuspended
                    ? 'suspended'
                    : channelDraft.webChat.verifiedByBackend
                    ? 'connected'
                    : channelDraft.webChat.enabled || channelDraft.webChat.widgetPublicId?.trim()
                    ? 'pending_backend'
                    : 'not_configured';
                  const chatBadge = getChannelStatusBadge(chatState, channelDraft.webChat.verifiedByBackend);
                  return (
                    <div className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {t.superAdmin.webChatChannelLabel}
                          </h3>
                        </div>
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${chatBadge.className}`}>
                          {chatBadge.label}
                        </span>
                      </div>

                      <div className="space-y-3 text-xs">
                        <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={channelDraft.webChat.enabled}
                            onChange={e =>
                              setChannelDraft(prev => ({
                                ...prev,
                                webChat: { ...prev.webChat, enabled: e.target.checked },
                              }))
                            }
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          <span>{isEs ? 'Habilitar Widget Web' : 'Enable Website Chat Widget'}</span>
                        </label>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {isEs ? 'ID Público del Widget' : 'Public Widget ID'}
                          </label>
                          <input
                            type="text"
                            value={channelDraft.webChat.widgetPublicId || ''}
                            onChange={e =>
                              setChannelDraft(prev => ({
                                ...prev,
                                webChat: { ...prev.webChat, widgetPublicId: e.target.value },
                              }))
                            }
                            placeholder="nc-widget-public-id"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {isEs ? 'Orígenes Permitidos (separados por coma)' : 'Allowed Origins (comma-separated)'}
                          </label>
                          <input
                            type="text"
                            value={allowedOriginsText}
                            onChange={e => {
                              const raw = e.target.value;
                              setAllowedOriginsText(raw);
                              const list = raw
                                .split(',')
                                .map(s => s.trim())
                                .filter(Boolean);
                              setChannelDraft(prev => ({
                                ...prev,
                                webChat: { ...prev.webChat, allowedOrigins: list },
                              }));
                            }}
                            placeholder="https://clientdomain.com"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingChannels || !selectedBizId}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-all"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isEs ? 'Guardar Metadatos de Canales' : 'Save Channel Metadata'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB: SMS / A2P 10DLC GOVERNANCE (SUPER ADMIN ONLY) */}
      {section === 'sms-a2p' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-sky-500" />
                  <span>{t.superAdmin.smsA2pTitle}</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.superAdmin.smsA2pSubtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => reloadSmsA2pOverview?.()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 self-start lg:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.common.refresh}</span>
              </button>
            </div>

            {mode === 'supabase' && (!smsTablesStatus.configsTableExists || !smsTablesStatus.consentsTableExists) && (
              <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-3 text-xs">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-900 dark:text-amber-200">
                    {isEs
                      ? 'Migración SMS / A2P pendiente en Supabase'
                      : 'Backend SMS / A2P tables not yet deployed'}
                  </p>
                  <p className="text-amber-800 dark:text-amber-300">
                    {isEs
                      ? 'Aplica 20261115_sms_consent_a2p.sql en Supabase para habilitar business_messaging_configs y sms_consents.'
                      : 'Apply 20261115_sms_consent_a2p.sql in Supabase to enable business_messaging_configs and sms_consents.'}
                  </p>
                </div>
              </div>
            )}

            {/* Aggregate Compliance Registry Table (Zero Customer Names / Phone PII) */}
            <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4">{isEs ? 'Negocio' : 'Business'}</th>
                    <th className="py-3 px-4">A2P 10DLC</th>
                    <th className="py-3 px-4">{isEs ? 'Envío Automático' : 'Auto-Send'}</th>
                    <th className="py-3 px-4">{isEs ? 'Registros Opt-In' : 'Consent Counts'}</th>
                    <th className="py-3 px-4 text-right">{isEs ? 'Enlace Público Opt-In' : 'Public Consent Link'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {availableTenants.map(biz => {
                    const cfg = messagingConfigsByBizId[biz.id];
                    const sum = smsConsentSummariesByBizId[biz.id];
                    const optedIn = sum?.optedInCount ?? 0;
                    const optedOut = sum?.optedOutCount ?? 0;
                    const a2p = cfg?.a2pStatus || 'not_configured';
                    const isCopied = copiedConsentBizId === biz.id;
                    const href = buildPublicRouteHref('sms-consent', { businessId: biz.id });

                    return (
                      <tr
                        key={biz.id}
                        className={selectedBizId === biz.id ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''}
                      >
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => setSelectedBizId(biz.id)}
                            className="text-left font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-600"
                          >
                            {biz.name} <span className="font-mono text-slate-400 font-normal">#{biz.id}</span>
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${
                              a2p === 'approved'
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                : a2p === 'pending_approval'
                                ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                : a2p === 'rejected' || a2p === 'suspended'
                                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {a2p}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {cfg?.autoSendEnabled ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              {isEs ? 'Activo' : 'Enabled'}
                            </span>
                          ) : (
                            <span className="text-slate-500">
                              {isEs ? 'Bloqueado' : 'Blocked / Off'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums">
                          <span className="text-emerald-700 dark:text-emerald-300 font-bold">{optedIn}</span>
                          <span className="text-slate-400"> in · </span>
                          <span className="text-rose-600 dark:text-rose-400 font-bold">{optedOut}</span>
                          <span className="text-slate-400"> out</span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyConsentLink(biz.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                            >
                              {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              <span>{isCopied ? t.superAdmin.copiedConsentLink : t.superAdmin.copyConsentLink}</span>
                            </button>
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                              title={href}
                              aria-label={`Open ${href}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Selected Business A2P Configuration & Outbound Guard */}
            {(() => {
              const targetBiz = availableTenants.find(b => b.id === selectedBizId);
              const targetConsents = smsConsentSummariesByBizId[selectedBizId]?.optedInCount ?? 0;
              const hasActiveBiz = Boolean(targetBiz && targetBiz.isActive !== false);
              const hasApprovedA2p = smsA2pDraft.a2pStatus === 'approved';
              const hasOptInEnabled = smsA2pDraft.smsOptInEnabled;
              const hasSids =
                Boolean(smsA2pDraft.campaignSid.trim()) &&
                Boolean(smsA2pDraft.messagingServiceSid.trim());
              const hasConsents = targetConsents > 0;
              const canEnableAutoSend =
                hasActiveBiz && hasApprovedA2p && hasOptInEnabled && hasSids && hasConsents;

              return (
                <form
                  onSubmit={handleSaveSmsA2pConfig}
                  className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {targetBiz ? `${targetBiz.name} (#${targetBiz.id})` : t.superAdmin.selectBusinessLabel}
                      </h3>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {selectedBizId ? buildSmsConsentUrl(selectedBizId) : ''}
                      </p>
                    </div>
                    <select
                      aria-label={t.superAdmin.selectBusinessLabel}
                      value={selectedBizId}
                      onChange={e => setSelectedBizId(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                    >
                      {availableTenants.map(biz => (
                        <option key={biz.id} value={biz.id}>
                          {biz.name} (#{biz.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  {!canEnableAutoSend && (
                    <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{t.superAdmin.autoSendBlockedNotice}</span>
                    </div>
                  )}

                  {smsConfigFeedback && (
                    <div
                      className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                        smsConfigFeedback.type === 'success'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                          : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {smsConfigFeedback.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{smsConfigFeedback.text}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        A2P 10DLC Status
                      </label>
                      <select
                        aria-label="A2P 10DLC Status"
                        value={smsA2pDraft.a2pStatus}
                        onChange={e => {
                          const nextStatus = e.target.value as A2pApprovalStatus;
                          setSmsA2pDraft(prev => ({
                            ...prev,
                            a2pStatus: nextStatus,
                            autoSendEnabled: nextStatus === 'approved' ? prev.autoSendEnabled : false,
                          }));
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                      >
                        <option value="not_configured">not_configured</option>
                        <option value="pending_approval">pending_approval</option>
                        <option value="approved">approved</option>
                        <option value="rejected">rejected</option>
                        <option value="suspended">suspended</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Campaign SID
                      </label>
                      <input
                        type="text"
                        value={smsA2pDraft.campaignSid}
                        onChange={e => setSmsA2pDraft(prev => ({ ...prev, campaignSid: e.target.value }))}
                        placeholder="CMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Messaging Service SID
                      </label>
                      <input
                        type="text"
                        value={smsA2pDraft.messagingServiceSid}
                        onChange={e => setSmsA2pDraft(prev => ({ ...prev, messagingServiceSid: e.target.value }))}
                        placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Disclosure Version
                      </label>
                      <input
                        type="text"
                        value={smsA2pDraft.consentDisclosureVersion}
                        onChange={e =>
                          setSmsA2pDraft(prev => ({ ...prev, consentDisclosureVersion: e.target.value }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={smsA2pDraft.smsOptInEnabled}
                          onChange={e =>
                            setSmsA2pDraft(prev => ({
                              ...prev,
                              smsOptInEnabled: e.target.checked,
                              autoSendEnabled: e.target.checked ? prev.autoSendEnabled : false,
                            }))
                          }
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span>{isEs ? 'Formulario Público Opt-In Activo' : 'Public SMS Opt-In Enabled'}</span>
                      </label>

                      <label
                        className={`inline-flex items-center gap-2 font-medium ${
                          canEnableAutoSend
                            ? 'cursor-pointer text-slate-700 dark:text-slate-200'
                            : 'cursor-not-allowed text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          aria-label={isEs ? 'Habilitar Envío Automático SMS' : 'Enable Automated Outbound SMS'}
                          disabled={!canEnableAutoSend}
                          checked={canEnableAutoSend && smsA2pDraft.autoSendEnabled}
                          onChange={e =>
                            setSmsA2pDraft(prev => ({ ...prev, autoSendEnabled: e.target.checked }))
                          }
                          className="rounded border-slate-300 text-indigo-600 disabled:opacity-50"
                        />
                        <span>{isEs ? 'Habilitar Envío Automático SMS' : 'Enable Automated Outbound SMS'}</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isSavingSmsConfig || !selectedBizId}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-xs font-semibold shadow-xs"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isEs ? 'Guardar Política SMS / A2P' : 'Save SMS / A2P Policy'}</span>
                    </button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}

      {/* TAB: SYSTEM MONITORING (BOOKING NOTIFICATIONS, N8N, SUPPORT & INCIDENTS) */}
      {section === 'monitoring' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-indigo-500" />
                  <span>{t.superAdmin.monitoringTitle}</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.superAdmin.monitoringSubtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  reloadPlatformMetrics();
                  reloadBookingNotificationHealth?.();
                  reloadN8nIntegrationHealth?.();
                  reloadPlatformIncidents();
                  reloadSupportTickets();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 self-start lg:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.common.refresh}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Booking Notification Failure Queue & Recovery */}
              <div className="lg:col-span-7 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t.superAdmin.notificationHealthTitle}
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 rounded-md border text-[11px] font-bold uppercase ${
                      bookingNotificationHealth.status === 'healthy'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : bookingNotificationHealth.status === 'degraded'
                        ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                        : bookingNotificationHealth.status === 'critical' || bookingNotificationHealth.status === 'error'
                        ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {bookingNotificationHealth.status}
                  </span>
                </div>

                {bookingNotificationHealth.detail && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 rounded-xl p-3 font-mono">
                    {bookingNotificationHealth.detail}
                  </p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 block">{isEs ? 'Fallos Pendientes' : 'Pending Failures'}</span>
                    <span className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {bookingNotificationHealth.pendingFailures ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 block">{isEs ? 'Listos Reintento' : 'Due For Retry'}</span>
                    <span className="text-lg font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                      {bookingNotificationHealth.dueForRetry ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 block">{isEs ? 'Abandonados' : 'Abandoned Failures'}</span>
                    <span className="text-lg font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                      {bookingNotificationHealth.abandonedFailures ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 block">{isEs ? 'Recuperados (24h)' : 'Recovered (24h)'}</span>
                    <span className="text-lg font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                      {bookingNotificationHealth.recovered24h ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 block">{isEs ? 'Incidentes Abiertos' : 'Open Notif. Incidents'}</span>
                    <span className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {bookingNotificationHealth.openNotificationIncidents ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 block">{isEs ? 'Doble Fallo Crítico' : 'Double-Failure Critical'}</span>
                    <span className="text-lg font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                      {bookingNotificationHealth.criticalDoubleFailureIncidents ?? '—'}
                    </span>
                  </div>
                </div>

                {recoveryFeedback && (
                  <div
                    className={`p-3 rounded-xl border text-xs ${
                      recoveryFeedback.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                        : recoveryFeedback.type === 'warning'
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {recoveryFeedback.text}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-[11px] font-mono text-slate-400 space-y-0.5">
                    <div>
                      Worker: <span className="text-slate-600 dark:text-slate-300">{bookingNotificationHealth.recoveryWorkerStatus}</span>
                    </div>
                    {bookingNotificationHealth.checkedAt && (
                      <div>{new Date(bookingNotificationHealth.checkedAt).toLocaleString()}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isTriggeringRecovery}
                    onClick={handleTriggerNotificationRecovery}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isTriggeringRecovery ? 'animate-spin' : ''}`} />
                    <span>{t.superAdmin.notificationRecoveryBtn}</span>
                  </button>
                </div>
              </div>

              {/* n8n & Support/Incident Signals */}
              <div className="lg:col-span-5 space-y-4">
                <div className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {t.superAdmin.n8nHealthTitle}
                    </h3>
                    <span
                      className={`px-2.5 py-0.5 rounded-md border text-[10px] font-bold ${
                        n8nIntegrationHealth.status === 'verified_connected'
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : n8nIntegrationHealth.status === 'error'
                          ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      {n8nIntegrationHealth.status === 'verified_connected'
                        ? t.superAdmin.n8nVerifiedBadge
                        : n8nIntegrationHealth.status === 'demo'
                        ? (isEs ? 'Modo Demo' : 'Demo Sandbox')
                        : n8nIntegrationHealth.status === 'error'
                        ? (isEs ? 'Error' : 'Error')
                        : t.superAdmin.n8nNotVerifiedBadge}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {n8nIntegrationHealth.detail ||
                      (isEs
                        ? 'Sin endpoint de verificación de n8n en el backend; nunca se simula estado conectado.'
                        : 'No verified backend n8n health endpoint detected; live connectivity is never simulated.')}
                  </p>
                  {(n8nIntegrationHealth.activeWorkflows !== null || n8nIntegrationHealth.lastVerifiedAt) && (
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500">
                      {n8nIntegrationHealth.activeWorkflows !== null && (
                        <span>Workflows: {n8nIntegrationHealth.activeWorkflows}</span>
                      )}
                      {n8nIntegrationHealth.lastVerifiedAt && (
                        <span>{new Date(n8nIntegrationHealth.lastVerifiedAt).toLocaleString()}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-3 text-xs">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t.superAdmin.overviewSupportSummaryTitle}
                  </h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-[11px] text-slate-500 block">{t.superAdmin.openTicketsMetric}</span>
                      <span className="text-base font-extrabold font-mono tabular-nums">{unresolvedTicketsCount}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-[11px] text-slate-500 block">{t.superAdmin.unresolvedIncidentsMetric}</span>
                      <span className="text-base font-extrabold font-mono tabular-nums">{technicalIssuesCount}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setSection('support-center')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                    >
                      <span>{t.nav.supportCenter}</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSection('incidents')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    >
                      <span>{t.nav.supportIncidents}</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PLATFORM INFRASTRUCTURE (SUPER ADMIN ONLY) */}
      {section === 'infrastructure' && (
        <div className="space-y-6">
          {/* Data Source Mode & Supabase Connection Card */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-500" />
                  <span>{isEs ? 'Fuente de Datos y Diagnóstico' : 'Data Mode & Diagnostics'}</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Control exclusivo para Súper Administrador: alterna entre Supabase en producción y modo demostración local.'
                    : 'Super Admin-only runtime switch between live Supabase PostgreSQL and local demonstration sandbox.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMode('supabase')}
                  className={`py-2 px-3 rounded-lg transition-all ${
                    mode === 'supabase'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {isEs ? 'Supabase en Vivo' : 'Live Supabase'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('demo')}
                  className={`py-2 px-3 rounded-lg transition-all ${
                    mode === 'demo'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {isEs ? 'Modo Demo' : 'Demo Sandbox'}
                </button>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">{isEs ? 'Estado de Conexión' : 'Connection Status'}</span>
                  <span
                    className={`font-semibold ${
                      supabaseConfig.isConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'
                    }`}
                  >
                    {supabaseConfig.isConnected
                      ? t.superAdmin.infrastructure.supabaseStatusConnected
                      : t.superAdmin.infrastructure.supabaseStatusDemo}
                  </span>
                </div>
                {supabaseConfig.lastTestedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">{isEs ? 'Última prueba' : 'Last verified'}</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-300">
                      {new Date(supabaseConfig.lastTestedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-5 shadow-xs">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.superAdmin.infrastructure.supabaseSection}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.superAdmin.infrastructure.supabaseDesc}
                </p>
              </div>

              <form onSubmit={handleConnectSupabase} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.superAdmin.infrastructure.supabaseUrl}
                  </label>
                  <input
                    type="url"
                    placeholder="https://xyzcompany.supabase.co"
                    value={supabaseUrl}
                    onChange={e => setSupabaseUrl(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">{t.superAdmin.infrastructure.supabaseUrlHint}</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.superAdmin.infrastructure.supabaseAnonKey}
                  </label>
                  <input
                    type="password"
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={supabaseAnonKey}
                    onChange={e => setSupabaseAnonKey(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    {t.superAdmin.infrastructure.serviceRoleWarning}
                  </p>
                </div>

                <div className="flex items-center gap-2 justify-end pt-2">
                  {supabaseConfig.isConnected && (
                    <button
                      type="button"
                      onClick={disconnectSupabase}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    >
                      {t.superAdmin.infrastructure.disconnect}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
                    <span>{t.superAdmin.infrastructure.testAndConnect}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* SQL Schemas & Migrations Review (Manual Review Only — Never Auto-Executed) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {isEs ? 'Revisión de Migraciones SQL y Esquema RLS' : 'SQL Migrations & RLS Schema Review'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isEs
                    ? 'Copia y revisa manualmente antes de ejecutar cualquier script en el Editor SQL de Supabase.'
                    : 'Review and copy scripts for manual execution in your Supabase SQL Editor.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopySql}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                {isCopiedSql ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopiedSql ? t.superAdmin.infrastructure.sqlCopied : t.superAdmin.infrastructure.copySql}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
              {[
                { id: 'invitations' as const, label: '20261112_business_invitations.sql' },
                { id: 'support_system' as const, label: '20261113_support_system_hardened.sql' },
                { id: 'bigint' as const, label: 'BIGINT Super Admin SQL' },
                { id: 'status' as const, label: 'businesses is_active SQL' },
                { id: 'incidents' as const, label: 'support_incidents.sql' },
                { id: 'schema' as const, label: 'Full Multi-Tenant Schema' },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSqlViewTab(tab.id);
                    setIsCopiedSql(false);
                  }}
                  className={`flex-1 min-w-[140px] py-1.5 px-3 rounded-lg transition-all whitespace-nowrap ${
                    sqlViewTab === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <pre className="max-h-72 overflow-y-auto p-4 rounded-xl bg-slate-950 text-slate-300 font-mono text-[11px] leading-relaxed border border-slate-800">
              {activeSqlText}
            </pre>
          </div>
        </div>
      )}

      {/* Business Details Slide-Over Drawer */}
      {detailTenant && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            onClick={() => setDetailTenant(null)}
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
          />
          <div className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full overflow-y-auto p-6 space-y-6 shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <WorkspaceAvatar tenant={detailTenant} size="md" />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                    {detailTenant.name}
                  </h3>
                  <p className="text-xs font-mono text-slate-400">#{detailTenant.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailTenant(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="space-y-3 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">{isEs ? 'Categoría' : 'Category'}</dt>
                <dd className="font-semibold text-slate-900 dark:text-slate-100 text-right">
                  {getCategoryDisplayLabel(
                    detailTenant.category,
                    language,
                    detailTenant.categoryLabelEn,
                    detailTenant.categoryLabelEs,
                    detailTenant.settings?.categoryDetails?.customName
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">{isEs ? 'Zona Horaria' : 'Timezone'}</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200 text-right">
                  {formatTimezoneSummary(detailTenant.timezone)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">{isEs ? 'Idioma' : 'Default Language'}</dt>
                <dd className="font-semibold uppercase text-slate-800 dark:text-slate-200">
                  {detailTenant.defaultLanguage}
                </dd>
              </div>
              {detailTenant.email && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">{isEs ? 'Correo' : 'Email'}</dt>
                  <dd className="font-mono text-slate-800 dark:text-slate-200 truncate">{detailTenant.email}</dd>
                </div>
              )}
              {detailTenant.phone && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">{isEs ? 'Teléfono' : 'Phone'}</dt>
                  <dd className="font-mono text-slate-800 dark:text-slate-200">{detailTenant.phone}</dd>
                </div>
              )}
              {detailTenant.description && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <dt className="text-slate-400 mb-1">{isEs ? 'Descripción' : 'Description'}</dt>
                  <dd className="text-slate-700 dark:text-slate-300 leading-relaxed">{detailTenant.description}</dd>
                </div>
              )}
            </dl>

            <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              {(() => {
                const drawerOwners = businessOwnersByBizId[detailTenant.id] || [];
                return (
                  <div className="space-y-2 pb-2">
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {t.superAdmin.assignedOwnersCol} ({drawerOwners.length})
                    </h4>
                    {drawerOwners.length === 0 ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">{t.superAdmin.noOwnerAssigned}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {drawerOwners.map(o => (
                          <div
                            key={`${o.businessId}-${o.userId}`}
                            className="p-2.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 flex items-center justify-between text-xs"
                          >
                            <span className="font-mono truncate">{o.userEmail || o.userId}</span>
                            <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase">
                              {o.role}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {isEs ? 'Miembros Asignados' : 'Assigned Members'} ({liveMembers.length})
              </h4>
              {liveMembers.length === 0 ? (
                <p className="text-xs text-slate-400">{t.superAdmin.noMembersFound}</p>
              ) : (
                <div className="space-y-1.5">
                  {liveMembers.map(m => (
                    <div
                      key={m.id || m.userId}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs"
                    >
                      <span className="font-mono truncate">{m.userEmail || m.userId}</span>
                      <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase">
                        {m.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setCurrentTenantId(detailTenant.id);
                  setSelectedBizId(detailTenant.id);
                  setDetailTenant(null);
                  setActiveTab('overview');
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <span>{t.superAdmin.switchToBusiness}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentTenantId(detailTenant.id);
                  setSelectedBizId(detailTenant.id);
                  setDetailTenant(null);
                  setActiveTab('settings');
                }}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold"
              >
                {isEs ? 'Administrar Configuración del Negocio' : 'Manage Business Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incident Detail Modal */}
      {selectedIncidentForDetail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="incident-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={() => setSelectedIncidentForDetail(null)}
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
          />
          <div className="relative z-10 w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                    {t.superAdmin.incidentDetailTitle}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    #{selectedIncidentForDetail.id.slice(0, 8)}
                  </span>
                </div>
                <h3
                  id="incident-detail-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  {selectedIncidentForDetail.title}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close incident details"
                onClick={() => setSelectedIncidentForDetail(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold text-slate-700 dark:text-slate-300">
                {selectedIncidentForDetail.source}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 font-bold uppercase text-rose-700 dark:text-rose-300">
                {selectedIncidentForDetail.severity}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 font-semibold uppercase text-indigo-700 dark:text-indigo-300">
                {selectedIncidentForDetail.status}
              </span>
              {selectedIncidentForDetail.businessId && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-slate-600 dark:text-slate-300">
                  {selectedIncidentForDetail.businessName ? `${selectedIncidentForDetail.businessName} ` : ''}
                  #{selectedIncidentForDetail.businessId}
                </span>
              )}
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
              {selectedIncidentForDetail.description}
            </div>

            {selectedIncidentForDetail.errorCode && (
              <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800 text-xs font-mono text-rose-700 dark:text-rose-300">
                Error Code: {selectedIncidentForDetail.errorCode}
              </div>
            )}

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <dt className="text-slate-400">{isEs ? 'Creado' : 'Created At'}</dt>
                <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
                  {new Date(selectedIncidentForDetail.createdAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">{isEs ? 'Resuelto' : 'Resolved At'}</dt>
                <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
                  {selectedIncidentForDetail.resolvedAt
                    ? new Date(selectedIncidentForDetail.resolvedAt).toLocaleString()
                    : '—'}
                </dd>
              </div>
            </dl>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['open', 'investigating', 'resolved'] as IncidentStatus[]).map(st => {
                  const active = selectedIncidentForDetail.status === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={active || updatingIncidentId === selectedIncidentForDetail.id}
                      onClick={() => handleIncidentStatusUpdate(selectedIncidentForDetail.id, st)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50 ${
                        active
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {st === 'open'
                        ? t.superAdmin.statusOpen
                        : st === 'investigating'
                        ? t.superAdmin.statusInvestigating
                        : t.superAdmin.statusResolved}
                    </button>
                  );
                })}
              </div>

              {selectedIncidentForDetail.businessId && (
                <button
                  type="button"
                  onClick={() => {
                    const targetBiz = selectedIncidentForDetail.businessId!;
                    setSelectedIncidentForDetail(null);
                    setTicketBusinessFilter(targetBiz);
                    setSection('support-center');
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                >
                  <span>{t.nav.supportCenter}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Business Activation / Suspension */}
      {pendingStatusToggleBiz && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-business-status-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={() => setPendingStatusToggleBiz(null)}
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
          />
          <div className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    pendingStatusToggleBiz.isActive === false
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600'
                      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600'
                  }`}
                >
                  <Power className="w-4 h-4" />
                </div>
                <div>
                  <h3
                    id="confirm-business-status-title"
                    className="text-sm font-bold text-slate-900 dark:text-slate-100"
                  >
                    {pendingStatusToggleBiz.isActive === false
                      ? t.superAdmin.confirmToggleTitleActivate
                      : t.superAdmin.confirmToggleTitleSuspend}
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    {pendingStatusToggleBiz.name} (#{pendingStatusToggleBiz.id})
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close confirmation dialog"
                onClick={() => setPendingStatusToggleBiz(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              {pendingStatusToggleBiz.isActive === false
                ? t.superAdmin.confirmToggleActivateImpact
                : t.superAdmin.confirmToggleSuspendImpact}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingStatusToggleBiz(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={togglingBizId === pendingStatusToggleBiz.id}
                onClick={handleConfirmToggleBusinessStatus}
                className={`px-4 py-2 rounded-xl text-white text-xs font-semibold shadow-xs disabled:opacity-50 ${
                  pendingStatusToggleBiz.isActive === false
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {pendingStatusToggleBiz.isActive === false
                  ? t.superAdmin.confirmActivateBtn
                  : t.superAdmin.confirmSuspendBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3-Step Create Business Wizard Modal */}
      <CreateBusinessWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        language={language}
        onCreateBusiness={createBusinessAsSuperAdmin}
        onCreatedSuccess={newBizId => {
          setSelectedBizId(newBizId);
          reloadBusinessInvitations(inviteScopeFilter === 'selected' ? newBizId : undefined);
          reloadAuditLogs(newBizId);
        }}
      />
    </div>
  );
};
