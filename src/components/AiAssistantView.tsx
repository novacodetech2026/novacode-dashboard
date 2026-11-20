import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  getCategoryOption,
  getCategoryDisplayLabel,
} from '../data/businessCategories';
import {
  Bot,
  Sparkles,
  Send,
  RotateCcw,
  Calendar,
  MessageSquare,
  CheckCircle2,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Language } from '../types';

interface SimulatorMessage {
  id: string;
  sender: 'customer' | 'ai';
  text: string;
  time: string;
}

export const AiAssistantView: React.FC = () => {
  const {
    t,
    language,
    currentTenant,
    services,
    activeServicesCount,
    setActiveTab,
    canManageBusinessSettings,
  } = useApp();

  const isEs = language === 'es';
  const aiConfig = currentTenant.settings.aiAssistant;
  const receptionistName = aiConfig?.assistantName || `${currentTenant.name} Concierge`;
  const communicationStyle = aiConfig?.communicationStyle || 'warm';

  const categoryOption = useMemo(
    () => getCategoryOption(currentTenant.category),
    [currentTenant.category]
  );
  const categoryLabel = useMemo(
    () =>
      getCategoryDisplayLabel(
        currentTenant.category,
        language,
        currentTenant.categoryLabelEn,
        currentTenant.categoryLabelEs,
        currentTenant.settings?.categoryDetails?.customName
      ),
    [currentTenant, language]
  );

  const openDaysCount = useMemo(() => {
    const hours = currentTenant.settings?.operatingHours || {};
    return Object.values(hours).filter(day => day && !day.isClosed).length;
  }, [currentTenant.settings?.operatingHours]);

  const communicationStyleLabel = useMemo(() => {
    if (communicationStyle === 'formal') return isEs ? 'Profesional y Formal' : 'Formal & Executive';
    if (communicationStyle === 'concise') return isEs ? 'Directo y Ágil' : 'Direct & Concise';
    return isEs ? 'Cercano y Amable' : 'Warm & Friendly';
  }, [communicationStyle, isEs]);

  const defaultPreferredLang: Language =
    aiConfig?.preferredLanguage === 'en' || aiConfig?.preferredLanguage === 'es'
      ? aiConfig.preferredLanguage
      : language;

  const [simulatorLang, setSimulatorLang] = useState<Language>(defaultPreferredLang);
  const [simulatorInput, setSimulatorInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const buildInitialGreeting = (lang: Language) => {
    if (aiConfig?.greeting && aiConfig.greeting.trim()) {
      return aiConfig.greeting.trim();
    }
    const focus = lang === 'es' ? categoryOption.aiFocusEs : categoryOption.aiFocusEn;
    if (lang === 'es') {
      return `¡Hola! Bienvenido a ${currentTenant.name}. Soy ${receptionistName}, tu recepcionista automatizado para ${focus}. ¿Te gustaría consultar nuestros servicios o agendar una cita?`;
    }
    return `Hello! Welcome to ${currentTenant.name}. I am ${receptionistName}, your AI Receptionist for ${focus}. Would you like to browse our services or schedule an appointment?`;
  };

  const [simulatorMessages, setSimulatorMessages] = useState<SimulatorMessage[]>([
    {
      id: 'sim-1',
      sender: 'ai',
      text: buildInitialGreeting(defaultPreferredLang),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  useEffect(() => {
    setSimulatorLang(defaultPreferredLang);
    setSimulatorMessages([
      {
        id: `sim-${currentTenant.id || 'init'}`,
        sender: 'ai',
        text: buildInitialGreeting(defaultPreferredLang),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenant.id, aiConfig?.greeting, aiConfig?.assistantName, aiConfig?.preferredLanguage]);

  useEffect(() => {
    if (typeof chatBottomRef.current?.scrollIntoView === 'function') {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [simulatorMessages, isAiThinking]);

  const handleReset = () => {
    setSimulatorMessages([
      {
        id: `sim-${Date.now()}`,
        sender: 'ai',
        text: buildInitialGreeting(simulatorLang),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const dynamicPromptSuggestions = useMemo(() => {
    const firstSvc = services[0];
    const svcName = firstSvc
      ? simulatorLang === 'es'
        ? firstSvc.nameEs
        : firstSvc.nameEn
      : simulatorLang === 'es'
      ? categoryOption.labelEs
      : categoryOption.labelEn;

    if (simulatorLang === 'es') {
      return [
        `¿Tienen horarios disponibles para ${svcName} mañana?`,
        '¿Cuáles son sus tarifas y servicios principales?',
        '¿Atienden en sucursal o a domicilio?',
      ];
    }
    return [
      `Do you have openings for ${svcName} tomorrow?`,
      'What are your primary services and pricing?',
      'Do you offer in-location or at-home visits?',
    ];
  }, [services, simulatorLang, categoryOption]);

  const handleSendSimulatorMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulatorInput.trim()) return;

    const userText = simulatorInput.trim();
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setSimulatorMessages(prev => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        sender: 'customer',
        text: userText,
        time: nowTime,
      },
    ]);
    setSimulatorInput('');
    setIsAiThinking(true);

    setTimeout(() => {
      let reply = '';
      const lower = userText.toLowerCase();
      const targetEs = simulatorLang === 'es';
      const firstService = services[0];
      const sName = firstService
        ? targetEs
          ? firstService.nameEs
          : firstService.nameEn
        : targetEs
        ? categoryOption.labelEs
        : categoryOption.labelEn;

      const stylePrefix =
        communicationStyle === 'formal'
          ? targetEs
            ? 'Con mucho gusto le informo: '
            : 'Certainly, I would be pleased to assist: '
          : communicationStyle === 'concise'
          ? ''
          : targetEs
          ? '¡Claro que sí! '
          : 'Happy to help! ';

      if (
        lower.includes('cita') ||
        lower.includes('horario') ||
        lower.includes('appointment') ||
        lower.includes('opening') ||
        lower.includes('disponib') ||
        lower.includes('available') ||
        lower.includes('book') ||
        lower.includes('agendar')
      ) {
        reply = targetEs
          ? `${stylePrefix}Para ${sName} en ${currentTenant.name} (${currentTenant.timezone}) podemos verificar horarios disponibles según nuestro calendario activo. ¿Qué día y hora prefieres?`
          : `${stylePrefix}For ${sName} at ${currentTenant.name} (${currentTenant.timezone}), I can check open slots against our active schedule. Which day and time works best for you?`;
      } else if (
        lower.includes('precio') ||
        lower.includes('tarifa') ||
        lower.includes('cost') ||
        lower.includes('price') ||
        lower.includes('servicio') ||
        lower.includes('service') ||
        lower.includes('cuanto') ||
        lower.includes('cuánto')
      ) {
        if (services.length > 0) {
          const sList = services
            .slice(0, 4)
            .map(
              s =>
                `• ${targetEs ? s.nameEs : s.nameEn}: ${currentTenant.currencySymbol}${(
                  Number(s.price) || 0
                ).toFixed(2)} (${s.durationMinutes} min)`
            )
            .join('\n');
          reply = targetEs
            ? `${stylePrefix}Estos son nuestros servicios actuales de ${categoryLabel}:\n${sList}\n¿Deseas reservar alguno?`
            : `${stylePrefix}Here are our current ${categoryLabel} services:\n${sList}\nWould you like to book one of these?`;
        } else {
          reply = targetEs
            ? `${stylePrefix}En ${currentTenant.name} (${categoryLabel}) configuramos cada servicio a medida. Indica qué atención necesitas y verifico la disponibilidad.`
            : `${stylePrefix}At ${currentTenant.name} (${categoryLabel}), let me know what service you need and I will check availability.`;
        }
      } else if (
        lower.includes('domicilio') ||
        lower.includes('home') ||
        lower.includes('casa') ||
        lower.includes('sucursal') ||
        lower.includes('location') ||
        lower.includes('mobile')
      ) {
        const supportsHome = services.some(s => s.allowsAtHome);
        reply = targetEs
          ? supportsHome
            ? `${stylePrefix}Atendemos tanto en nuestras instalaciones${
                currentTenant.address ? ` (${currentTenant.address})` : ''
              } como a domicilio en servicios seleccionados.`
            : `${stylePrefix}Nuestra atención se brinda directamente en nuestras instalaciones${
                currentTenant.address ? ` en ${currentTenant.address}` : ''
              }.`
          : supportsHome
          ? `${stylePrefix}We offer both in-location visits${
              currentTenant.address ? ` (${currentTenant.address})` : ''
            } and at-home appointments for eligible services.`
          : `${stylePrefix}Appointments take place at our business location${
              currentTenant.address ? ` (${currentTenant.address})` : ''
            }.`;
      } else {
        const contextDesc =
          aiConfig?.businessDescription ||
          currentTenant.description ||
          currentTenant.tagline ||
          (targetEs ? categoryOption.aiFocusEs : categoryOption.aiFocusEn);
        reply = targetEs
          ? `${stylePrefix}En ${currentTenant.name} (${contextDesc}) estamos listos para ayudarte. Dime qué servicio y horario prefieres para agendar.`
          : `${stylePrefix}At ${currentTenant.name} (${contextDesc}), I can help check open times and schedule your appointment. What service and day works best?`;
      }

      setSimulatorMessages(prev => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      setIsAiThinking(false);
    }, 500);
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* 1. AI Receptionist Readiness Hero */}
      <div className="p-4 lg:p-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 lg:gap-6 shadow-xs">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>{t.aiAssistant.connectedState}</span>
            </div>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {receptionistName} · {categoryLabel}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {t.aiAssistant.readyTitle}
          </h1>

          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
            {aiConfig?.businessDescription || currentTenant.description || t.aiAssistant.readyDesc}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 flex items-center gap-4">
            <div>
              <p className="text-xs lg:text-[11px] text-slate-400 font-medium">{t.aiAssistant.modelEngineLabel}</p>
              <p className="text-sm lg:text-xs font-semibold text-slate-900 dark:text-slate-100">
                {communicationStyleLabel}
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
            <div>
              <p className="text-xs lg:text-[11px] text-slate-400 font-medium">{t.services.title}</p>
              <p className="text-sm lg:text-xs font-mono tabular-nums font-bold text-indigo-600 dark:text-indigo-400">
                {t.services.totalServices.replace('{count}', String(activeServicesCount))}
              </p>
            </div>
          </div>

          {canManageBusinessSettings && (
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              <SettingsIcon className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-indigo-500" />
              <span>{isEs ? 'Configurar Recepcionista' : 'Customize Receptionist'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Capabilities Overview (Zero Infrastructure Jargon) */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {t.aiAssistant.integrationsHeader}
          </h2>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t.aiAssistant.integrationsDesc}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-4 pt-1">
          <div className="p-4 lg:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <MessageSquare className="w-5 h-5" />
              </div>
              <span className="px-2 py-0.5 rounded-md text-xs lg:text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                {t.aiAssistant.activeBadge}
              </span>
            </div>
            <div>
              <h3 className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                {t.aiAssistant.whatsappCard}
              </h3>
              <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {t.aiAssistant.whatsappDesc}
              </p>
            </div>
            <p className="text-xs lg:text-[11px] font-mono tabular-nums text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800 truncate">
              {t.aiAssistant.numberLabel}: {currentTenant.phone || '—'}
            </p>
          </div>

          <div className="p-4 lg:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Calendar className="w-5 h-5" />
              </div>
              <span className="px-2 py-0.5 rounded-md text-xs lg:text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                {t.aiAssistant.activeBadge}
              </span>
            </div>
            <div>
              <h3 className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                {t.aiAssistant.calendarSyncCard}
              </h3>
              <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {t.aiAssistant.calendarSyncDesc}
              </p>
            </div>
            <p className="text-xs lg:text-[11px] font-mono tabular-nums text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800 truncate">
              {currentTenant.timezone} · {openDaysCount}{' '}
              {isEs ? 'días activos' : 'active days/wk'}
            </p>
          </div>

          <div className="p-4 lg:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <span className="px-2 py-0.5 rounded-md text-xs lg:text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                {t.aiAssistant.workflowsCount}
              </span>
            </div>
            <div>
              <h3 className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                {t.aiAssistant.n8nCard}
              </h3>
              <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {t.aiAssistant.n8nDesc}
              </p>
            </div>
            <p className="text-xs lg:text-[11px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800 truncate">
              {t.aiAssistant.webhookLabel}
            </p>
          </div>
        </div>
      </div>

      {/* 3. Interactive Receptionist Preview */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 lg:p-6 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 lg:gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>{t.aiAssistant.simulatorTitle}</span>
            </h2>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.aiAssistant.simulatorSubtitle}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm lg:text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSimulatorLang('en')}
                className={`min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 px-3 lg:px-2.5 py-1 rounded-lg transition-all ${
                  simulatorLang === 'en'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setSimulatorLang('es')}
                className={`min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 px-3 lg:px-2.5 py-1 rounded-lg transition-all ${
                  simulatorLang === 'es'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                ES
              </button>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
              title={t.aiAssistant.simulatorReset}
            >
              <RotateCcw className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span className="hidden sm:inline">{t.aiAssistant.simulatorReset}</span>
            </button>
          </div>
        </div>

        {/* Category-Aware Quick Prompts */}
        <div className="px-4 lg:px-5 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-xs lg:text-[11px] font-semibold text-slate-400 shrink-0">
            {simulatorLang === 'es' ? 'Probar:' : 'Try:'}
          </span>
          {dynamicPromptSuggestions.map(prompt => (
            <button
              key={prompt}
              type="button"
              onClick={() => setSimulatorInput(prompt)}
              className="min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 text-xs lg:text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="p-4 lg:p-6 space-y-4 max-h-80 lg:max-h-96 overflow-y-auto bg-slate-50/20 dark:bg-slate-950/20">
          {simulatorMessages.map(msg => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'customer' ? 'items-end' : 'items-start'}`}
            >
              <span className="text-xs lg:text-[10px] text-slate-400 mb-1 px-1 font-mono tabular-nums">
                {msg.sender === 'customer' ? t.aiAssistant.youClient : receptionistName} · {msg.time}
              </span>
              <div
                className={`max-w-[85%] lg:max-w-lg p-3.5 rounded-2xl text-sm lg:text-xs whitespace-pre-line leading-relaxed shadow-xs ${
                  msg.sender === 'customer'
                    ? 'bg-slate-900 dark:bg-slate-700 text-white rounded-tr-xs'
                    : 'bg-indigo-600 text-white rounded-tl-xs shadow-indigo-600/10'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {isAiThinking && (
            <div className="flex items-center gap-2 text-sm lg:text-xs text-indigo-600 dark:text-indigo-400 font-medium">
              <Bot className="w-4 h-4" />
              <span>{t.aiAssistant.checkingAvailability}</span>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSendSimulatorMessage}
          className="p-3.5 lg:p-4 border-t border-slate-200/80 dark:border-slate-800 flex items-center gap-2 bg-slate-50/50 dark:bg-slate-900/50"
        >
          <input
            type="text"
            placeholder={t.aiAssistant.inputTestPlaceholder}
            value={simulatorInput}
            onChange={e => setSimulatorInput(e.target.value)}
            className="flex-1 min-w-0 min-h-[44px] lg:min-h-0 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!simulatorInput.trim() || isAiThinking}
            className="flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 lg:px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all shrink-0 whitespace-nowrap"
          >
            <span className="hidden sm:inline">{t.aiAssistant.sendTestMessage}</span>
            <Send className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
