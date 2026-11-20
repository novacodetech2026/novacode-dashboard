import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Search,
  Bot,
  User,
  Send,
  Headphones,
  ArrowLeft,
} from 'lucide-react';

export const MessagesView: React.FC = () => {
  const {
    t,
    currentTenant,
    conversations,
    chatMessages,
    activeConversationId,
    setActiveConversationId,
    takeOverConversation,
    returnConversationToAi,
    sendChatMessage,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<'all' | 'whatsapp' | 'sms'>('all');
  const [inputText, setInputText] = useState('');
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Active conversation object
  const activeConversation = useMemo(() => {
    return conversations.find(c => c.id === activeConversationId) || conversations[0] || null;
  }, [conversations, activeConversationId]);

  // Messages of active conversation
  const messagesList = useMemo(() => {
    if (!activeConversation) return [];
    return chatMessages[activeConversation.id] || [];
  }, [chatMessages, activeConversation]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesList]);

  // Filtered conversations
  const filteredConversations = useMemo(() => {
    const q = (searchQuery || '').toLowerCase();
    return conversations.filter(c => {
      const matchesSearch =
        (c.customerName || '').toLowerCase().includes(q) ||
        (c.customerPhone || '').includes(searchQuery);
      const matchesChannel = selectedChannel === 'all' || c.channel === selectedChannel;
      return matchesSearch && matchesChannel;
    });
  }, [conversations, searchQuery, selectedChannel]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConversation) return;

    sendChatMessage(activeConversation.id, inputText.trim(), 'staff');
    setInputText('');

    // If conversation is handled by AI, simulate customer follow-up after 1.5s
    if (activeConversation.isAiHandled) {
      setTimeout(() => {
        const clientFollowUps = activeConversation.customerLanguage === 'es'
          ? 'Muchas gracias por la información, quedo al pendiente.'
          : 'Thank you for confirming that, I look forward to it!';
        sendChatMessage(activeConversation.id, clientFollowUps, 'customer');
      }, 2000);
    }
  };

  const handleQuickAction = (type: 'booking' | 'confirm' | 'address') => {
    if (!activeConversation) return;
    const isEs = activeConversation.customerLanguage === 'es';

    let content = '';
    if (type === 'booking') {
      content = isEs
        ? `Puedes consultar nuestros horarios en tiempo real y agendar directamente aquí: https://novacode.tech/book/${currentTenant.id}`
        : `You can check our real-time availability and book your appointment directly here: https://novacode.tech/book/${currentTenant.id}`;
    } else if (type === 'confirm') {
      content = isEs
        ? 'Tu cita ha sido confirmada exitosamente en nuestro sistema. ¡Te esperamos!'
        : 'Your appointment has been officially confirmed in our system. See you soon!';
    } else if (type === 'address') {
      content = isEs
        ? 'Por favor compártenos tu dirección completa (calle, número interior/exterior y código postal) para la visita a domicilio.'
        : 'Please share your complete street address (including apartment/suite number and zip code) for your at-home service visit.';
    }

    sendChatMessage(activeConversation.id, content, 'staff');
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs h-[calc(100dvh-13.5rem)] lg:h-[calc(100vh-140px)] min-h-[460px] lg:min-h-[520px] flex flex-col md:flex-row">
      {/* Column 1: Conversations List (Left) */}
      <div className={`${mobileShowChat ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-96 md:border-r border-slate-200/80 dark:border-slate-800 flex-col bg-slate-50/50 dark:bg-slate-900/50 shrink-0 min-h-0 flex-1 md:flex-none`}>
        {/* Search & Channel Filters */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder={t.messages.searchConversations}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] lg:min-h-0 pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-200/60 dark:bg-slate-800 rounded-xl text-sm lg:text-xs font-semibold">
            <button
              onClick={() => setSelectedChannel('all')}
              className={`flex-1 min-h-[44px] lg:min-h-0 py-1.5 lg:py-1 rounded-lg transition-all ${
                selectedChannel === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              {t.messages.allChannels}
            </button>
            <button
              onClick={() => setSelectedChannel('whatsapp')}
              className={`flex-1 min-h-[44px] lg:min-h-0 py-1.5 lg:py-1 rounded-lg transition-all ${
                selectedChannel === 'whatsapp'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              WhatsApp
            </button>
            <button
              onClick={() => setSelectedChannel('sms')}
              className={`flex-1 min-h-[44px] lg:min-h-0 py-1.5 lg:py-1 rounded-lg transition-all ${
                selectedChannel === 'sms'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              SMS
            </button>
          </div>
        </div>

        {/* Conversation Items List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-12 text-sm lg:text-xs text-slate-400 p-4">
              {t.messages.noConversationsFound}
            </div>
          ) : (
            filteredConversations.map(conv => {
              const isActive = activeConversation?.id === conv.id;

              return (
                <button
                  key={conv.id}
                  onClick={() => {
                    setActiveConversationId(conv.id);
                    setMobileShowChat(true);
                  }}
                  className={`w-full min-h-[44px] p-4 text-left flex items-start gap-3 transition-colors ${
                    isActive
                      ? 'bg-white dark:bg-slate-800 ring-1 ring-inset ring-indigo-200/90 dark:ring-indigo-700/60'
                      : 'hover:bg-white/60 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-sm lg:text-xs text-slate-700 dark:text-slate-200 shrink-0">
                    {(conv.customerName || 'C').charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {conv.customerName}
                      </p>
                      <span className="text-xs lg:text-[10px] text-slate-400 font-mono shrink-0">
                        {conv.lastMessageAt ? conv.lastMessageAt.split('T')[1]?.slice(0, 5) : ''}
                      </span>
                    </div>

                    <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 truncate">
                      {conv.lastMessageSnippet}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {conv.isAiHandled ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs lg:text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400">
                          <Bot className="w-3 h-3" />
                          <span>{t.messages.aiHandled}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs lg:text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
                          <User className="w-3 h-3" />
                          <span>{t.messages.staffHandled}</span>
                        </span>
                      )}

                      <span className="text-xs lg:text-[10px] font-semibold uppercase text-slate-400">
                        {conv.channel} · {conv.customerLanguage}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Column 2: Active Chat Transcript (Right) */}
      {activeConversation ? (
        <div className={`${mobileShowChat ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-white dark:bg-slate-900 min-w-0 min-h-0`}>
          {/* Chat Header */}
          <div className="p-3.5 lg:p-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2.5 lg:gap-3 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2.5 lg:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileShowChat(false)}
                className="md:hidden inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 shrink-0"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                {(activeConversation.customerName || 'C').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {activeConversation.customerName}
                </h3>
                <p className="text-xs lg:text-[11px] text-slate-500 font-mono truncate">
                  {activeConversation.customerPhone} · {activeConversation.channel.toUpperCase()}
                </p>
              </div>
            </div>

            {/* AI vs Staff Takeover Switch */}
            <div className="flex items-center gap-2 shrink-0">
              {activeConversation.isAiHandled ? (
                <button
                  onClick={() => takeOverConversation(activeConversation.id)}
                  className="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-100 transition-colors"
                >
                  <Headphones className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                  <span className="hidden sm:inline">{t.messages.takeOverButton}</span>
                </button>
              ) : (
                <button
                  onClick={() => returnConversationToAi(activeConversation.id)}
                  className="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  <Bot className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                  <span className="hidden sm:inline">{t.messages.returnToAiButton}</span>
                </button>
              )}
            </div>
          </div>

          {/* AI Notice Banner */}
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/40 text-xs lg:text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${activeConversation.isAiHandled ? 'bg-indigo-500' : 'bg-amber-400'}`} />
              <span className="truncate">
                {activeConversation.isAiHandled ? t.messages.aiBadgeDesc : t.messages.staffBadgeDesc}
              </span>
            </div>

            <span className="text-slate-400 shrink-0">
              {t.aiAssistant.clientLanguageLabel}: <strong className="text-slate-700 dark:text-slate-300 uppercase">{activeConversation.customerLanguage}</strong>
            </span>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5 bg-slate-50/20 dark:bg-slate-950/20">
            {messagesList.map(msg => {
              const isCustomer = msg.sender === 'customer';
              const isAi = msg.sender === 'ai';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-1 text-xs lg:text-[10px] text-slate-400 mb-1 px-1">
                    {isCustomer && <span>{activeConversation.customerName}</span>}
                    {isAi && (
                      <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold">
                        <Bot className="w-3 h-3" />
                        {t.aiAssistant.aiAgentLabel}
                      </span>
                    )}
                    {!isCustomer && !isAi && (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        {t.aiAssistant.staffMemberLabel}
                      </span>
                    )}
                    <span>·</span>
                    <span className="font-mono">{msg.timestamp.split('T')[1]?.slice(0, 5)}</span>
                  </div>

                  <div
                    className={`max-w-[85%] lg:max-w-md p-3.5 rounded-2xl text-sm lg:text-xs font-normal leading-relaxed shadow-xs ${
                      isCustomer
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-xs border border-slate-200/80 dark:border-slate-700'
                        : isAi
                        ? 'bg-indigo-600 text-white rounded-tr-xs shadow-indigo-600/10'
                        : 'bg-slate-900 dark:bg-slate-700 text-white rounded-tr-xs'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}
            <div ref={chatBottomRef} />
          </div>

          {/* Quick Actions Shortcuts */}
          <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar bg-white dark:bg-slate-900">
            <span className="text-xs lg:text-[11px] font-semibold text-slate-400 whitespace-nowrap">
              {t.messages.quickActions}:
            </span>
            <button
              onClick={() => handleQuickAction('booking')}
              className="min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1 text-xs lg:text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-700 dark:text-slate-300 hover:text-indigo-600 whitespace-nowrap transition-colors"
            >
              {t.messages.quickSendBookingLink}
            </button>
            <button
              onClick={() => handleQuickAction('confirm')}
              className="min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1 text-xs lg:text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-700 dark:text-slate-300 hover:text-indigo-600 whitespace-nowrap transition-colors"
            >
              {t.messages.quickConfirmAppointment}
            </button>
            <button
              onClick={() => handleQuickAction('address')}
              className="min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1 text-xs lg:text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-700 dark:text-slate-300 hover:text-indigo-600 whitespace-nowrap transition-colors"
            >
              {t.messages.quickAskAddress}
            </button>
          </div>

          {/* Input Footer */}
          <form onSubmit={handleSendMessage} className="p-3.5 border-t border-slate-200/80 dark:border-slate-800 flex items-center gap-2 bg-slate-50/50 dark:bg-slate-900/50">
            <input
              type="text"
              placeholder={t.messages.inputPlaceholder}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              className="flex-1 min-h-[44px] lg:min-h-0 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white shadow-xs transition-all shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        <div className={`${mobileShowChat ? 'flex' : 'hidden md:flex'} flex-1 items-center justify-center p-8 text-sm lg:text-xs text-slate-400`}>
          {t.messages.noConversationSelected}
        </div>
      )}
    </div>
  );
};
