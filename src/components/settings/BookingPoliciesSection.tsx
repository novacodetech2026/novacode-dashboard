import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Language, LocationType, AiAssistantSettings } from '../../types';
import {
  SlidersHorizontal,
  Save,
  Bot,
  Building,
  Home,
  Video,
  AlertCircle,
} from 'lucide-react';

export const BookingPoliciesSection: React.FC = () => {
  const { t, language, currentTenant, saveBookingPolicies } = useApp();
  const isEs = language === 'es';

  const [bufferBetweenAppointmentsMinutes, setBufferBetweenAppointmentsMinutes] = useState<string>(
    String(currentTenant.settings?.bufferBetweenAppointmentsMinutes ?? 15)
  );
  const [cancellationBufferHours, setCancellationBufferHours] = useState<string>(
    String(currentTenant.settings?.cancellationBufferHours ?? 24)
  );
  const [bookingInstructions, setBookingInstructions] = useState<string>(
    currentTenant.settings?.bookingInstructions || ''
  );
  const [locationTypes, setLocationTypes] = useState<LocationType[]>(
    currentTenant.settings?.locationTypes && currentTenant.settings.locationTypes.length > 0
      ? currentTenant.settings.locationTypes
      : ['in_business']
  );

  // Business default language & AI Receptionist copy
  const [defaultLang, setDefaultLang] = useState<Language>(currentTenant.defaultLanguage || 'en');
  const [assistantName, setAssistantName] = useState(
    currentTenant.settings?.aiAssistant?.assistantName || `${currentTenant.name || 'Business'} AI`
  );
  const [assistantLang, setAssistantLang] = useState<Language | 'auto'>(
    currentTenant.settings?.aiAssistant?.preferredLanguage || 'auto'
  );
  const [assistantGreeting, setAssistantGreeting] = useState(
    currentTenant.settings?.aiAssistant?.greeting || ''
  );
  const [assistantBusinessDesc, setAssistantBusinessDesc] = useState(
    currentTenant.settings?.aiAssistant?.businessDescription ||
      currentTenant.description ||
      currentTenant.tagline ||
      ''
  );
  const [communicationStyle, setCommunicationStyle] = useState<AiAssistantSettings['communicationStyle']>(
    currentTenant.settings?.aiAssistant?.communicationStyle || 'warm'
  );

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setBufferBetweenAppointmentsMinutes(
      String(currentTenant.settings?.bufferBetweenAppointmentsMinutes ?? 15)
    );
    setCancellationBufferHours(String(currentTenant.settings?.cancellationBufferHours ?? 24));
    setBookingInstructions(currentTenant.settings?.bookingInstructions || '');
    setLocationTypes(
      currentTenant.settings?.locationTypes && currentTenant.settings.locationTypes.length > 0
        ? currentTenant.settings.locationTypes
        : ['in_business']
    );
    setDefaultLang(currentTenant.defaultLanguage || 'en');
    setAssistantName(
      currentTenant.settings?.aiAssistant?.assistantName || `${currentTenant.name || 'Business'} AI`
    );
    setAssistantLang(currentTenant.settings?.aiAssistant?.preferredLanguage || 'auto');
    setAssistantGreeting(currentTenant.settings?.aiAssistant?.greeting || '');
    setAssistantBusinessDesc(
      currentTenant.settings?.aiAssistant?.businessDescription ||
        currentTenant.description ||
        currentTenant.tagline ||
        ''
    );
    setCommunicationStyle(currentTenant.settings?.aiAssistant?.communicationStyle || 'warm');
    setErrorMsg(null);
  }, [currentTenant]);

  const toggleLocationType = (loc: LocationType) => {
    setErrorMsg(null);
    setLocationTypes(prev =>
      prev.includes(loc) ? prev.filter(item => item !== loc) : [...prev, loc]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsedBuffer = Number(bufferBetweenAppointmentsMinutes);
    if (!Number.isFinite(parsedBuffer) || !Number.isInteger(parsedBuffer) || parsedBuffer < 0) {
      setErrorMsg(
        isEs
          ? 'El tiempo de preparación entre citas debe ser un número entero mayor o igual a 0.'
          : 'Buffer between appointments must be a non-negative whole integer.'
      );
      return;
    }

    const parsedCancellation = Number(cancellationBufferHours);
    if (
      !Number.isFinite(parsedCancellation) ||
      !Number.isInteger(parsedCancellation) ||
      parsedCancellation < 0
    ) {
      setErrorMsg(
        isEs
          ? 'La ventana de aviso para cancelaciones debe ser un número entero mayor o igual a 0.'
          : 'Cancellation notice window must be a non-negative whole integer.'
      );
      return;
    }

    if (locationTypes.length === 0) {
      setErrorMsg(
        isEs
          ? 'Selecciona al menos una modalidad de cita soportada.'
          : 'Select at least one supported appointment location.'
      );
      return;
    }

    setIsSaving(true);
    try {
      const res = await saveBookingPolicies({
        bufferBetweenAppointmentsMinutes: parsedBuffer,
        cancellationBufferHours: parsedCancellation,
        bookingInstructions: bookingInstructions.trim(),
        locationTypes,
        defaultLanguage: defaultLang,
        aiAssistant: {
          assistantName: assistantName.trim() || `${currentTenant.name} AI`,
          preferredLanguage: assistantLang,
          greeting: assistantGreeting.trim(),
          businessDescription: assistantBusinessDesc.trim(),
          communicationStyle,
        },
      });
      if (!res.success) {
        setErrorMsg(res.error || (isEs ? 'No se pudieron guardar las políticas.' : 'Unable to save booking policies.'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const locationOptions: Array<{
    id: LocationType;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'in_business', label: t.settings.locationInBusiness, icon: Building },
    { id: 'at_home', label: t.settings.locationAtHome, icon: Home },
    { id: 'online', label: t.settings.locationOnline, icon: Video },
  ];

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-5 lg:space-y-6 shadow-xs"
    >
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span>{t.settings.preferencesTitle}</span>
        </h2>
        <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          {t.settings.preferencesDesc}
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-sm lg:text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
        <div>
          <label
            htmlFor="policy-cancellation-hours"
            className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            {t.settings.cancellationBufferLabel} ({t.settings.hoursUnit})
          </label>
          <input
            id="policy-cancellation-hours"
            type="number"
            min={0}
            max={720}
            step={1}
            value={cancellationBufferHours}
            onChange={e => setCancellationBufferHours(e.target.value)}
            className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs lg:text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            {t.settings.cancellationBufferHelp}
          </p>
        </div>

        <div>
          <label
            htmlFor="policy-buffer-minutes"
            className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            {t.settings.appointmentBufferLabel} ({t.settings.minutesUnit})
          </label>
          <input
            id="policy-buffer-minutes"
            type="number"
            min={0}
            max={480}
            step={5}
            value={bufferBetweenAppointmentsMinutes}
            onChange={e => setBufferBetweenAppointmentsMinutes(e.target.value)}
            className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs lg:text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            {t.settings.appointmentBufferHelp}
          </p>
        </div>

        <div className="md:col-span-2">
          <span className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            {t.settings.supportedLocationsLabel}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 lg:gap-3">
            {locationOptions.map(opt => {
              const Icon = opt.icon;
              const checked = locationTypes.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleLocationType(opt.id)}
                  className={`flex items-center gap-2.5 min-h-[44px] px-3.5 py-2.5 rounded-xl border text-sm lg:text-xs font-semibold transition-colors ${
                    checked
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                      : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs lg:text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            {t.settings.supportedLocationsHelp}
          </p>
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="policy-booking-instructions"
            className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
          >
            {t.settings.bookingInstructionsLabel}
          </label>
          <textarea
            id="policy-booking-instructions"
            rows={3}
            value={bookingInstructions}
            onChange={e => setBookingInstructions(e.target.value)}
            placeholder={t.settings.bookingInstructionsPlaceholder}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
        </div>

        <div>
          <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            {t.settings.defaultLanguage}
          </label>
          <select
            value={defaultLang}
            onChange={e => setDefaultLang(e.target.value as Language)}
            className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="en">English (Default)</option>
            <option value="es">Español (Predeterminado)</option>
          </select>
          <p className="text-xs lg:text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            {t.settings.defaultLanguageHelp}
          </p>
        </div>
      </div>

      {/* AI Receptionist Context & Greeting */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
        <div>
          <h3 className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>{t.settings.aiAssistantTitle}</span>
          </h3>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {t.settings.aiAssistantDesc}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
          <div>
            <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t.settings.assistantNameLabel}
            </label>
            <input
              type="text"
              value={assistantName}
              onChange={e => setAssistantName(e.target.value)}
              placeholder={`${currentTenant.name} Concierge`}
              className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t.settings.assistantLangLabel}
            </label>
            <select
              value={assistantLang}
              onChange={e => setAssistantLang(e.target.value as Language | 'auto')}
              className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="auto">{isEs ? 'Automático (Según cliente)' : 'Auto-detect Client Language'}</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>

          <div>
            <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t.settings.assistantStyleLabel}
            </label>
            <select
              value={communicationStyle}
              onChange={e =>
                setCommunicationStyle(e.target.value as AiAssistantSettings['communicationStyle'])
              }
              className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="warm">{isEs ? 'Cálido y amigable' : 'Warm & Welcoming'}</option>
              <option value="concise">{isEs ? 'Directo y conciso' : 'Concise & Efficient'}</option>
              <option value="formal">{isEs ? 'Profesional y formal' : 'Formal & Executive'}</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t.settings.assistantGreetingLabel}
            </label>
            <input
              type="text"
              value={assistantGreeting}
              onChange={e => setAssistantGreeting(e.target.value)}
              placeholder={
                isEs
                  ? `¡Hola! Bienvenido a ${currentTenant.name}. ¿Cómo te ayudo hoy?`
                  : `Hello! Welcome to ${currentTenant.name}. How can I help you today?`
              }
              className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t.settings.assistantDescLabel}
            </label>
            <textarea
              rows={3}
              value={assistantBusinessDesc}
              onChange={e => setAssistantBusinessDesc(e.target.value)}
              placeholder={
                isEs
                  ? 'Explica tu especialidad, políticas de cancelación o qué hace único a tu negocio para guiar las respuestas de la IA...'
                  : 'Describe your business specialties, policies, and booking workflow so the AI answers accurately...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
        <button
          type="submit"
          disabled={isSaving}
          className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
        >
          <Save className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
          <span>{isSaving ? t.common.loading : t.settings.savePreferencesBtn}</span>
        </button>
      </div>
    </form>
  );
};
