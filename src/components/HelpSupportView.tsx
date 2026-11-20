import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketMessage,
} from '../types';
import { validateSupportTicketInput } from '../utils/security';
import {
  LifeBuoy,
  Plus,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  X,
  RefreshCw,
} from 'lucide-react';

const SUPPORT_CATEGORIES: SupportTicketCategory[] = [
  'general_question',
  'technical_problem',
  'booking_calendar_issue',
  'ai_receptionist_issue',
  'customer_service_concern',
  'account_access_problem',
  'feature_request',
  'complaint',
  'other',
];

const SUPPORT_PRIORITIES: SupportTicketPriority[] = ['low', 'medium', 'high', 'urgent'];

export const HelpSupportView: React.FC = () => {
  const {
    t,
    language,
    mode,
    currentTenant,
    supportTickets,
    supportMessagesByTicket,
    supportTicketsTableExists,
    isLoadingSupportTickets,
    reloadSupportTickets,
    createSupportTicket,
    loadTicketMessages,
    sendTicketReply,
    markTicketRead,
  } = useApp();

  const isEs = language === 'es';

  const scopedTickets = useMemo(() => {
    return supportTickets.filter(tk => !currentTenant.id || tk.businessId === currentTenant.id);
  }, [supportTickets, currentTenant.id]);

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [localMessagesByTicket, setLocalMessagesByTicket] = useState<Record<string, SupportTicketMessage[]>>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [category, setCategory] = useState<SupportTicketCategory>('general_question');
  const [priority, setPriority] = useState<SupportTicketPriority>('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  useEffect(() => {
    setSelectedTicketId(null);
    setReplyText('');
  }, [currentTenant.id]);

  const selectedTicket: SupportTicket | null = useMemo(() => {
    if (scopedTickets.length === 0) return null;
    if (selectedTicketId) {
      const match = scopedTickets.find(tk => tk.id === selectedTicketId);
      if (match) return match;
    }
    return scopedTickets[0] || null;
  }, [scopedTickets, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicket) return;
    let active = true;
    setIsLoadingMessages(true);
    loadTicketMessages(selectedTicket.id)
      .then(msgs => {
        if (!active) return;
        setLocalMessagesByTicket(prev => ({ ...prev, [selectedTicket.id]: msgs }));
        if (selectedTicket.unreadByBusiness) {
          markTicketRead(selectedTicket.id);
        }
      })
      .finally(() => {
        if (active) setIsLoadingMessages(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTicket?.id, selectedTicket?.unreadByBusiness, loadTicketMessages, markTicketRead]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;
    setFormError(null);

    const validation = validateSupportTicketInput(
      { category, subject, description, priority },
      language
    );
    if (!validation.valid || !validation.normalized) {
      setFormError(
        validation.error ||
          (isEs
            ? 'Por favor verifica los campos de tu solicitud.'
            : 'Please review your support request fields.')
      );
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await createSupportTicket({
        category: validation.normalized.category,
        subject: validation.normalized.subject,
        description: validation.normalized.description,
        priority: validation.normalized.priority,
      });

      if (res.success && res.ticket) {
        setIsCreateOpen(false);
        setSubject('');
        setDescription('');
        setCategory('general_question');
        setPriority('medium');
        setSelectedTicketId(res.ticket.id);
        const msgs = await loadTicketMessages(res.ticket.id);
        setLocalMessagesByTicket(prev => ({ ...prev, [res.ticket!.id]: msgs }));
      } else if (res.error) {
        setFormError(res.error);
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || selectedTicket.status === 'closed' || !replyText.trim() || isSendingReply) {
      return;
    }
    setIsSendingReply(true);
    try {
      const res = await sendTicketReply(selectedTicket.id, selectedTicket.businessId, replyText.trim());
      if (res.success && res.messageRecord) {
        setReplyText('');
        setLocalMessagesByTicket(prev => {
          const existing = prev[selectedTicket.id] || [];
          if (existing.some(m => m.id === res.messageRecord!.id)) return prev;
          return {
            ...prev,
            [selectedTicket.id]: [...existing, res.messageRecord!],
          };
        });
      }
    } finally {
      setIsSendingReply(false);
    }
  };

  const getStatusBadgeClass = (status: SupportTicketStatus) => {
    if (status === 'resolved' || status === 'closed') {
      return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    }
    if (status === 'waiting_for_customer') {
      return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    if (status === 'in_progress') {
      return 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
    }
    return 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';
  };

  const getPriorityBadgeClass = (prio: SupportTicketPriority) => {
    if (prio === 'urgent') {
      return 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    }
    if (prio === 'high') {
      return 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    if (prio === 'medium') {
      return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
    return 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800';
  };

  const activeMessages = selectedTicket
    ? (supportMessagesByTicket && supportMessagesByTicket[selectedTicket.id]) ||
      localMessagesByTicket[selectedTicket.id] ||
      []
    : [];

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header Card */}
      <div className="p-4 lg:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 lg:gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <LifeBuoy className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              {t.helpSupport.title}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl leading-relaxed">
              {t.helpSupport.subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {mode === 'supabase' && (
            <button
              type="button"
              onClick={reloadSupportTickets}
              disabled={isLoadingSupportTickets}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 lg:w-3.5 lg:h-3.5 text-indigo-500 ${isLoadingSupportTickets ? 'animate-spin' : ''}`} />
              <span>{t.common.refresh}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>{t.helpSupport.newRequestBtn}</span>
          </button>
        </div>
      </div>

      {/* Provisioning notice without database internals */}
      {mode === 'supabase' && !supportTicketsTableExists && (
        <div className="p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex items-start gap-3 text-sm lg:text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>
            {isEs
              ? 'El centro de mensajería de soporte se está habilitando para tu espacio de trabajo. Si necesitas ayuda inmediata, comunícate con tu administrador de Novacode Tech.'
              : 'Live support messaging is currently being enabled for your workspace. Please contact your Novacode Tech administrator if you need immediate assistance.'}
          </span>
        </div>
      )}

      {/* Main Master-Detail Support Workspace */}
      {scopedTickets.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 lg:p-12 text-center shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {t.helpSupport.noRequestsTitle}
          </h2>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {t.helpSupport.noRequestsDesc}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{t.helpSupport.newRequestBtn}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Ticket List */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="p-4 lg:px-5 lg:py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.helpSupport.yourRequestsTitle}
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {scopedTickets.length}
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[380px] lg:max-h-[560px] overflow-y-auto">
              {scopedTickets.map(ticket => {
                const isSelected = selectedTicket?.id === ticket.id;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={`w-full min-h-[44px] text-left p-4 transition-colors space-y-2 ${
                      isSelected
                        ? 'bg-indigo-50/50 dark:bg-indigo-950/30 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                        {ticket.subject}
                      </p>
                      {ticket.unreadByBusiness && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0 mt-1.5 lg:mt-1" />
                      )}
                    </div>

                    <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {ticket.description}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span
                        className={`px-2 py-0.5 rounded-md border text-xs lg:text-[10px] font-semibold ${getStatusBadgeClass(
                          ticket.status
                        )}`}
                      >
                        {t.helpSupport.statuses[ticket.status]}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-xs lg:text-[10px] font-semibold ${getPriorityBadgeClass(
                          ticket.priority
                        )}`}
                      >
                        {t.helpSupport.priorities[ticket.priority]}
                      </span>
                      <span className="text-xs lg:text-[10px] text-slate-400 truncate">
                        · {t.helpSupport.categories[ticket.category]}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-xs lg:text-[10px] font-mono tabular-nums text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(ticket.updatedAt || ticket.createdAt).toLocaleString()}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ticket Thread */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs flex flex-col min-h-[400px] lg:min-h-[480px] max-h-[75dvh] lg:max-h-[640px]">
            {selectedTicket ? (
              <>
                <div className="p-4 lg:p-5 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs lg:text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                      {t.helpSupport.categories[selectedTicket.category]}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-md border text-xs lg:text-[10px] font-semibold ${getPriorityBadgeClass(
                          selectedTicket.priority
                        )}`}
                      >
                        {t.helpSupport.priorities[selectedTicket.priority]}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-xs lg:text-[10px] font-semibold ${getStatusBadgeClass(
                          selectedTicket.status
                        )}`}
                      >
                        {t.helpSupport.statuses[selectedTicket.status]}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {selectedTicket.subject}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs lg:text-[11px] text-slate-400 font-mono tabular-nums">
                    <span>
                      {t.helpSupport.createdAtLabel}: {new Date(selectedTicket.createdAt).toLocaleString()}
                    </span>
                    <span>
                      {t.helpSupport.lastUpdatedLabel}:{' '}
                      {new Date(selectedTicket.updatedAt || selectedTicket.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Conversation Body */}
                <div className="flex-1 overflow-y-auto p-4 lg:p-5 space-y-4 bg-slate-50/40 dark:bg-slate-950/20">
                  {/* Original Request Summary */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs lg:text-[10px] font-semibold text-slate-400">
                      <span>{t.helpSupport.fromBusinessBadge}</span>
                      <span className="font-mono tabular-nums">
                        {new Date(selectedTicket.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm lg:text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {selectedTicket.description}
                    </p>
                  </div>

                  {isLoadingMessages && activeMessages.length === 0 ? (
                    <div className="text-center py-6 text-sm lg:text-xs text-slate-400">{t.common.loading}</div>
                  ) : (
                    activeMessages.map(msg => {
                      const isSupport = msg.senderRole === 'super_admin';
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isSupport ? 'items-start' : 'items-end'}`}
                        >
                          <div className="flex items-center gap-1.5 text-xs lg:text-[10px] text-slate-400 mb-1 px-1">
                            <span
                              className={
                                isSupport
                                  ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                                  : 'font-semibold text-slate-600 dark:text-slate-300'
                              }
                            >
                              {isSupport ? t.helpSupport.fromSupportBadge : t.helpSupport.fromBusinessBadge}
                            </span>
                            <span>·</span>
                            <span className="font-mono tabular-nums">
                              {new Date(msg.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div
                            className={`max-w-[85%] lg:max-w-lg p-3.5 rounded-2xl text-sm lg:text-xs whitespace-pre-wrap leading-relaxed shadow-xs ${
                              isSupport
                                ? 'bg-white dark:bg-slate-800 border border-indigo-200/80 dark:border-indigo-800 text-slate-800 dark:text-slate-100 rounded-tl-xs'
                                : 'bg-indigo-600 text-white rounded-tr-xs'
                            }`}
                          >
                            {msg.message}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Reply Footer */}
                {selectedTicket.status === 'closed' ? (
                  <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-center gap-2 text-sm lg:text-xs text-slate-500">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>
                      {isEs
                        ? 'Esta solicitud está cerrada. Si necesitas más ayuda, crea una nueva solicitud.'
                        : 'This request is closed. Submit a new support request if you need additional assistance.'}
                    </span>
                  </div>
                ) : (
                  <form
                    onSubmit={handleSendReply}
                    className="p-3.5 lg:p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2.5"
                  >
                    <input
                      type="text"
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder={t.helpSupport.replyPlaceholder}
                      className="flex-1 min-w-0 min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={!replyText.trim() || isSendingReply}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 lg:px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm lg:text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                    >
                      <Send className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                      <span className="hidden sm:inline">{t.helpSupport.sendReplyBtn}</span>
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-sm lg:text-xs text-slate-400">
                {t.helpSupport.selectTicketHint}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Support Request Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="w-full sm:max-w-lg max-h-[92dvh] bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 lg:p-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.helpSupport.createTitle}
                </h2>
                <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {t.helpSupport.createSubtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-5 h-5 lg:w-4 lg:h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="flex flex-col flex-1 min-h-0 text-sm lg:text-xs">
              <div className="flex-1 overflow-y-auto p-4 lg:p-5 space-y-4">
                {formError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.helpSupport.categoryLabel} *
                    </label>
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as SupportTicketCategory)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {SUPPORT_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>
                          {t.helpSupport.categories[cat]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.helpSupport.priorityLabel} *
                    </label>
                    <select
                      value={priority}
                      onChange={e => setPriority(e.target.value as SupportTicketPriority)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {SUPPORT_PRIORITIES.map(prio => (
                        <option key={prio} value={prio}>
                          {t.helpSupport.priorities[prio]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      {t.helpSupport.subjectLabel} *
                    </label>
                    <span className="text-xs lg:text-[10px] font-mono tabular-nums text-slate-400">
                      {subject.trim().length}/200
                    </span>
                  </div>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={200}
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder={t.helpSupport.subjectPlaceholder}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      {t.helpSupport.descriptionLabel} *
                    </label>
                    <span className="text-xs lg:text-[10px] text-slate-400">
                      {isEs ? 'Mín. 5 caracteres' : 'Min. 5 characters'}
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    required
                    minLength={5}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={t.helpSupport.descriptionPlaceholder}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 p-4 lg:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm lg:text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-xs transition-colors"
                >
                  {isSubmitting ? t.helpSupport.submittingBtn : t.helpSupport.submitBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
