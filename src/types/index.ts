export type Language = 'en' | 'es';

export type LocationType = 'in_business' | 'at_home' | 'online';

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface BusinessHours {
  open: string; // "09:00"
  close: string; // "19:00"
  isClosed: boolean;
}

export interface SpecialBusinessHours {
  id?: string;
  date: string; // YYYY-MM-DD
  label?: string;
  open?: string;
  close?: string;
  isClosed: boolean;
}

export interface AiAssistantSettings {
  assistantName: string;
  preferredLanguage: Language | 'auto';
  greeting: string;
  businessDescription: string;
  communicationStyle: 'warm' | 'concise' | 'formal';
}

export interface Tenant {
  id: string;
  name: string;
  slug?: string;
  tagline: string;
  description?: string;
  isActive?: boolean;
  category: string;
  categoryLabelEn: string;
  categoryLabelEs: string;
  logo: string;
  timezone: string;
  defaultLanguage: Language;
  currency: string;
  currencySymbol: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  instagram?: string;
  settings: {
    operatingHours: Record<number, BusinessHours>; // 0 = Sunday, 1 = Monday, etc.
    operatingHoursMigrated?: boolean;
    specialHours?: SpecialBusinessHours[];
    cancellationBufferHours: number;
    bufferBetweenAppointmentsMinutes: number;
    locationTypes?: LocationType[];
    bookingInstructions?: string;
    aiAutomatedBooking?: boolean;
    requireAtHomeAddress?: boolean;
    categoryDetails?: {
      customName?: string;
      groupId?: string;
    };
    aiAssistant?: AiAssistantSettings;
    isSuspended?: boolean;
    communicationChannels?: Partial<BusinessCommunicationChannels>;
  };
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email: string;
  preferredLanguage: Language;
  address?: string;
  notes?: string;
  avatar?: string;
  totalAppointments: number;
  lastInteractionAt: string;
  createdAt: string;
}

export interface Service {
  id: string;
  tenantId: string;
  nameEn: string;
  nameEs: string;
  descriptionEn: string;
  descriptionEs: string;
  durationMinutes: number;
  price: number;
  currency?: string;
  category: string;
  allowsInBusiness: boolean;
  allowsAtHome: boolean;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Staff {
  id: string;
  tenantId: string;
  name: string;
  roleEn: string;
  roleEs: string;
  email: string;
  phone: string;
  avatar: string;
  active: boolean;
  servicesProvided: string[]; // service IDs
}

export interface Appointment {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerLanguage: Language;
  serviceId: string;
  serviceName: string;
  staffId?: string;
  staffName?: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  rawStartTime?: string; // Authoritative start_time instant from DB
  rawEndTime?: string; // Authoritative end_time instant from DB
  durationMinutes: number | null;
  price: number;
  locationType: LocationType;
  address?: string;
  status: AppointmentStatus;
  notes?: string;
  source: 'ai_whatsapp' | 'ai_sms' | 'manual_dashboard' | 'online_widget';
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerLanguage: Language;
  channel: 'whatsapp' | 'sms' | 'web';
  isAiHandled: boolean;
  unreadCount: number;
  lastMessageSnippet: string;
  lastMessageAt: string;
  status: 'active' | 'resolved' | 'waiting';
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: 'customer' | 'ai' | 'staff';
  content: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  language: Language;
}

export interface IntegrationStatus {
  aiEngine: {
    status: 'operational' | 'degraded' | 'offline';
    model: string;
    avgLatencyMs: number;
    lastPing: string;
  };
  whatsapp: {
    status: 'connected' | 'demo' | 'disconnected';
    phoneNumber?: string;
    verifiedName?: string;
  };
  calendarSync: {
    status: 'synced' | 'pending' | 'disconnected';
    provider: 'google_calendar' | 'internal';
    lastSync: string;
  };
  n8nEngine: {
    status: 'connected' | 'demo' | 'disconnected';
    activeWorkflows: number;
  };
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConnected: boolean;
  lastTestedAt?: string;
}

export type DataSourceMode = 'demo' | 'supabase';

export type PlatformRole = 'super_admin' | 'owner' | 'staff' | 'none';

export interface BusinessMember {
  id?: string;
  userId: string;
  businessId: string;
  role: 'owner' | 'admin' | 'manager' | 'staff' | 'member';
  userEmail?: string;
  business?: Tenant;
  createdAt?: string;
}

export interface SupabaseUser {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  platformRole: PlatformRole;
  role?: string;
  businessMemberships: BusinessMember[];
}

export interface AuditLogEntry {
  id: string;
  businessId?: string;
  businessName?: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked' | 'failed';

export interface BusinessInvitation {
  id: string;
  businessId: string;
  businessName?: string;
  email: string;
  role: 'owner' | 'admin' | 'manager' | 'staff';
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt?: string;
  lastSentAt?: string;
  resendCount: number;
  lastError?: string;
  createdAt: string;
}

export interface InviteOwnerResult {
  success: boolean;
  outcome?:
    | 'invitation_sent'
    | 'invitation_resent'
    | 'invitation_revoked'
    | 'existing_user_assigned'
    | 'duplicate_pending_invitation'
    | 'already_member'
    | 'already_accepted'
    | 'user_not_found'
    | 'user_unconfirmed'
    | 'invite_failed';
  message?: string;
  error?: string;
  invitation?: BusinessInvitation;
}

export interface PlatformMetrics {
  totalBusinesses: number;
  activeBusinesses: number;
  suspendedBusinesses?: number;
  totalCustomers: number | null;
  totalAppointments: number | null;
  systemHealth: 'healthy' | 'degraded' | 'offline' | 'demo';
  healthDetail?: string;
  lastCheckedAt?: string;
}

export type BookingNotificationEventType =
  | 'appointment_confirmed'
  | 'appointment_cancelled'
  | 'appointment_rescheduled';

export interface BusinessNotification {
  id: string;
  businessId: string;
  type:
    | 'new_appointment'
    | 'appointment_confirmed'
    | 'appointment_cancelled'
    | 'appointment_updated'
    | 'support_reply'
    | 'support_status';
  eventType?: BookingNotificationEventType;
  idempotencyKey?: string;
  title: string;
  description: string;
  appointmentId?: string;
  customerName?: string;
  serviceName?: string;
  appointmentDate?: string;
  appointmentStartTime?: string;
  appointmentEndTime?: string;
  appointmentStatus?: AppointmentStatus;
  ticketId?: string;
  createdAt: string;
  read: boolean;
  readAt?: string;
  readByUserId?: string;
}

export type SupportTicketCategory =
  | 'general_question'
  | 'technical_problem'
  | 'booking_calendar_issue'
  | 'ai_receptionist_issue'
  | 'customer_service_concern'
  | 'account_access_problem'
  | 'feature_request'
  | 'complaint'
  | 'other';

export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type SupportTicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_for_customer'
  | 'resolved'
  | 'closed';

export interface SupportTicket {
  id: string;
  businessId: string;
  businessName?: string;
  createdBy?: string;
  createdByName?: string;
  category: SupportTicketCategory;
  subject: string;
  description: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  lastMessageAt: string;
  unreadByBusiness: boolean;
  unreadByAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  businessId: string;
  senderId?: string;
  senderRole: 'business_owner' | 'business_staff' | 'super_admin';
  senderName?: string;
  message: string;
  createdAt: string;
}

export interface SupportTicketStatusHistoryEntry {
  id: string;
  ticketId: string;
  changedBy?: string;
  oldStatus?: SupportTicketStatus | null;
  newStatus: SupportTicketStatus;
  createdAt: string;
}

export interface SupportNotification {
  id: string;
  businessId?: string;
  targetRole: 'business' | 'super_admin';
  ticketId?: string;
  incidentId?: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';
export type IncidentSource =
  | 'business_report'
  | 'technical_error'
  | 'integration_failure'
  | 'security_alert';

export interface SupportIncident {
  id: string;
  businessId?: string;
  businessName?: string;
  reportedBy?: string;
  source: IncidentSource;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  errorCode?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
}

export interface BusinessOwnerSummary {
  businessId: string;
  userId: string;
  role: 'owner' | 'admin';
  userEmail?: string;
  assignedAt?: string;
}

export type ChannelConnectionState =
  | 'not_configured'
  | 'pending_backend'
  | 'connected'
  | 'suspended'
  | 'error';

export interface BusinessCommunicationChannels {
  whatsapp: {
    status: ChannelConnectionState;
    provider?: 'whatsapp_cloud' | 'twilio';
    displayPhoneNumber?: string;
    businessAccountLabel?: string;
    verifiedByBackend: boolean;
    lastCheckedAt?: string;
    notes?: string;
  };
  sms: {
    status: ChannelConnectionState;
    provider?: 'twilio_a2p';
    fromPhoneNumber?: string;
    verifiedByBackend: boolean;
    lastCheckedAt?: string;
  };
  webChat: {
    status: ChannelConnectionState;
    enabled: boolean;
    widgetPublicId?: string;
    allowedOrigins?: string[];
    verifiedByBackend: boolean;
    lastCheckedAt?: string;
  };
}

export type BookingNotificationHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'critical'
  | 'not_deployed'
  | 'error'
  | 'demo';

export interface BookingNotificationHealth {
  status: BookingNotificationHealthStatus;
  pendingFailures: number | null;
  dueForRetry: number | null;
  abandonedFailures: number | null;
  recovered24h: number | null;
  oldestPendingAgeSeconds: number | null;
  openNotificationIncidents: number | null;
  criticalDoubleFailureIncidents: number | null;
  latestFailureAt?: string | null;
  checkedAt: string;
  detail?: string;
  recoveryWorkerStatus: 'service_role_scheduled' | 'edge_function_ready' | 'not_deployed' | 'demo';
}

export interface N8nIntegrationHealth {
  status: 'verified_connected' | 'not_verified' | 'error' | 'demo';
  activeWorkflows: number | null;
  lastVerifiedAt?: string;
  detail: string;
}

export type A2pApprovalStatus =
  | 'not_configured'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'suspended';

export interface BusinessMessagingConfig {
  businessId: string;
  a2pStatus: A2pApprovalStatus;
  smsOptInEnabled: boolean;
  autoSendEnabled: boolean;
  consentDisclosureVersion: string;
  campaignSid?: string;
  messagingServiceSid?: string;
  approvedAt?: string;
  updatedAt?: string;
  persistedInBackend: boolean;
}

export interface BusinessSmsConsentSummary {
  businessId: string;
  totalConsents: number;
  optedInCount: number;
  optedOutCount: number;
  latestConsentAt?: string;
  disclosureVersions: string[];
  sources: string[];
}

