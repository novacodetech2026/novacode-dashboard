import React, { useState, useRef } from 'react';
import { Language, InviteOwnerResult } from '../types';
import { CategorySelector } from './CategorySelector';
import { TimezoneSelector } from './TimezoneSelector';
import { getBrowserTimezone, formatTimezoneSummary } from '../utils/timezone';
import { getCategoryDisplayLabel } from '../data/businessCategories';
import {
  X,
  Building2,
  UserCheck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Mail,
  Phone,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface CreateBusinessWizardProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onCreateBusiness: (input: {
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
  }) => Promise<{
    success: boolean;
    businessId?: string;
    inviteResult?: InviteOwnerResult;
    error?: string;
  }>;
  onCreatedSuccess?: (businessId: string) => void;
}

export const CreateBusinessWizard: React.FC<CreateBusinessWizardProps> = ({
  isOpen,
  onClose,
  language,
  onCreateBusiness,
  onCreatedSuccess,
}) => {
  const isEs = language === 'es';
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Business Info
  const [name, setName] = useState('');
  const [category, setCategory] = useState('spa');
  const [categoryLabelEn, setCategoryLabelEn] = useState('Spa');
  const [categoryLabelEs, setCategoryLabelEs] = useState('Spa');
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [timezone, setTimezone] = useState(() => getBrowserTimezone() || 'America/New_York');
  const [defaultLanguage, setDefaultLanguage] = useState<'en' | 'es'>(language);
  const [tagline, setTagline] = useState('');
  const [phone, setPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [logo, setLogo] = useState('');

  // Step 2: Business Owner
  const [inviteOwnerNow, setInviteOwnerNow] = useState(true);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerRole, setOwnerRole] = useState<'owner' | 'admin' | 'manager' | 'staff'>('owner');

  // Step 3: Submission state & idempotency guard
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  if (!isOpen) return null;

  const resetForm = () => {
    setStep(1);
    setName('');
    setCategory('spa');
    setCategoryLabelEn('Spa');
    setCategoryLabelEs('Spa');
    setCustomCategoryName('');
    setTimezone(getBrowserTimezone() || 'America/New_York');
    setDefaultLanguage(language);
    setTagline('');
    setPhone('');
    setContactEmail('');
    setLogo('');
    setInviteOwnerNow(true);
    setOwnerEmail('');
    setOwnerRole('owner');
    setSubmitError(null);
    setIsSubmitting(false);
    submitLockRef.current = false;
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const canProceedStep1 =
    name.trim().length >= 2 &&
    (category !== 'custom_business' || customCategoryName.trim().length >= 2);

  const canProceedStep2 =
    !inviteOwnerNow || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim());

  const handleSubmit = async () => {
    if (submitLockRef.current || isSubmitting || !canProceedStep1) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await onCreateBusiness({
        name: name.trim(),
        category,
        categoryLabelEn,
        categoryLabelEs,
        customCategoryName: customCategoryName.trim() || undefined,
        timezone,
        defaultLanguage,
        phone: phone.trim() || undefined,
        email: contactEmail.trim() || undefined,
        tagline: tagline.trim() || undefined,
        logo: logo.trim() || undefined,
        ownerEmail: inviteOwnerNow && ownerEmail.trim() ? ownerEmail.trim().toLowerCase() : undefined,
        ownerRole: inviteOwnerNow ? ownerRole : undefined,
      });

      if (!res.success) {
        setSubmitError(res.error || (isEs ? 'No se pudo crear el negocio.' : 'Unable to create business.'));
        return;
      }

      if (res.businessId && onCreatedSuccess) {
        onCreatedSuccess(res.businessId);
      }
      resetForm();
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : isEs
          ? 'Error inesperado al crear el negocio.'
          : 'Unexpected error creating business.'
      );
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const resolvedCategoryLabel = getCategoryDisplayLabel(
    category,
    language,
    categoryLabelEn,
    categoryLabelEs,
    customCategoryName
  );

  const stepItems = [
    { num: 1, title: isEs ? 'Información' : 'Business Info', icon: Building2 },
    { num: 2, title: isEs ? 'Propietario' : 'Business Owner', icon: UserCheck },
    { num: 3, title: isEs ? 'Revisar y Crear' : 'Review & Create', icon: CheckCircle2 },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        onClick={handleClose}
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150"
      />

      {/* Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-business-wizard-title"
        className="relative z-10 w-full sm:max-w-2xl bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-4 lg:px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="create-business-wizard-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                {isEs ? 'Crear Nuevo Negocio' : 'Create New Business'}
              </h2>
              <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {isEs
                  ? 'Configura un nuevo espacio multi-inquilino en 3 pasos rápidos'
                  : 'Provision a new multi-tenant workspace in 3 guided steps'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label={isEs ? 'Cerrar' : 'Close'}
          >
            <X className="w-5 h-5 lg:w-4 lg:h-4" />
          </button>
        </div>

        {/* Stepper Bar */}
        <div className="px-4 lg:px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="grid grid-cols-3 gap-2">
            {stepItems.map(item => {
              const Icon = item.icon;
              const isCurrent = step === item.num;
              const isCompleted = step > item.num;
              return (
                <button
                  key={item.num}
                  type="button"
                  disabled={item.num > step && (!canProceedStep1 || (item.num === 3 && !canProceedStep2))}
                  onClick={() => {
                    if (item.num < step) setStep(item.num);
                  }}
                  className={`min-h-[44px] lg:min-h-0 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-xl text-left text-xs font-semibold transition-all border ${
                    isCurrent
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                      : isCompleted
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200/70 dark:border-slate-800 text-slate-400'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs lg:text-[10px] font-bold shrink-0 ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : isCompleted
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                    }`}
                  >
                    {isCompleted ? '✓' : item.num}
                  </span>
                  <Icon className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                  <span className="truncate">{item.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-5">
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'Nombre del Negocio *' : 'Business Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={isEs ? 'Ej. Aura MedSpa & Wellness' : 'e.g. Aura MedSpa & Wellness'}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'Categoría de Industria *' : 'Industry Category *'}
                  </label>
                  <CategorySelector
                    value={category}
                    customName={customCategoryName}
                    language={language}
                    onChange={(catId, meta) => {
                      setCategory(catId);
                      setCategoryLabelEn(meta.labelEn);
                      setCategoryLabelEs(meta.labelEs);
                      setCustomCategoryName(meta.customName || '');
                    }}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'Zona Horaria Global (IANA) *' : 'Global Timezone (IANA) *'}
                  </label>
                  <TimezoneSelector
                    value={timezone}
                    onChange={setTimezone}
                    language={language}
                  />
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'Idioma Predeterminado' : 'Default Language'}
                  </label>
                  <select
                    value={defaultLanguage}
                    onChange={e => setDefaultLanguage(e.target.value as 'en' | 'es')}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="en">English (EN)</option>
                    <option value="es">Español (ES)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'URL del Logo (Opcional)' : 'Logo URL (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={logo}
                    onChange={e => setLogo(e.target.value)}
                    placeholder="https://... (initials used if empty)"
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'Teléfono de Contacto (Opcional)' : 'Contact Phone (Optional)'}
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3.5 lg:top-3" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full min-h-[44px] lg:min-h-0 pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'Correo del Negocio (Opcional)' : 'Business Email (Optional)'}
                  </label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3.5 lg:top-3" />
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)}
                      placeholder="contact@business.com"
                      className="w-full min-h-[44px] lg:min-h-0 pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isEs ? 'Lema o Descripción Corta (Opcional)' : 'Tagline (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={tagline}
                    onChange={e => setTagline(e.target.value)}
                    placeholder={
                      isEs
                        ? 'Ej. Atención estética personalizada y reservas automáticas'
                        : 'e.g. Personalized care & seamless automated booking'
                    }
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                    {isEs ? 'Invitar Propietario Inicial por Correo' : 'Invite Initial Owner via Email'}
                  </p>
                  <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isEs
                      ? 'Envía un enlace seguro mediante invite-business-owner para que configure su contraseña y acceda solo a este negocio.'
                      : 'Sends a secure invitation link via invite-business-owner so the owner can set credentials and access only this workspace.'}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={inviteOwnerNow}
                  onClick={() => setInviteOwnerNow(prev => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                    inviteOwnerNow ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                      inviteOwnerNow ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {inviteOwnerNow ? (
                <div className="space-y-4 p-4 rounded-xl border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20">
                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {isEs ? 'Correo del Propietario *' : 'Owner Email Address *'}
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 lg:top-2.5" />
                      <input
                        type="email"
                        required
                        value={ownerEmail}
                        onChange={e => setOwnerEmail(e.target.value)}
                        placeholder="owner@company.com"
                        className="w-full min-h-[44px] lg:min-h-0 pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {isEs ? 'Rol Inicial en el Negocio' : 'Assigned Business Role'}
                    </label>
                    <select
                      value={ownerRole}
                      onChange={e => setOwnerRole(e.target.value as 'owner' | 'admin' | 'manager' | 'staff')}
                      className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="owner">{isEs ? 'Propietario (Owner)' : 'Business Owner'}</option>
                      <option value="admin">{isEs ? 'Administrador del Negocio' : 'Business Admin'}</option>
                      <option value="manager">{isEs ? 'Gerente' : 'Manager'}</option>
                      <option value="staff">{isEs ? 'Personal (Staff)' : 'Staff Member'}</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-sm lg:text-xs text-slate-500 dark:text-slate-400">
                  {isEs
                    ? 'El negocio se creará sin invitación inicial. Podrás invitar o asignar un propietario en cualquier momento desde la pestaña Invitaciones.'
                    : 'This workspace will be created without an immediate email invitation. You can invite or assign an owner later from the Invitations tab.'}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-sm lg:text-xs font-bold text-indigo-600 dark:text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                  <span>{isEs ? 'Resumen de Aprovisionamiento' : 'Provisioning Summary'}</span>
                </div>

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm lg:text-xs">
                  <div>
                    <dt className="text-xs lg:text-[11px] text-slate-400">{isEs ? 'Nombre' : 'Business Name'}</dt>
                    <dd className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">{name.trim()}</dd>
                  </div>
                  <div>
                    <dt className="text-xs lg:text-[11px] text-slate-400">{isEs ? 'Categoría' : 'Category'}</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{resolvedCategoryLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs lg:text-[11px] text-slate-400">{isEs ? 'Zona Horaria' : 'Timezone'}</dt>
                    <dd className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                      {formatTimezoneSummary(timezone)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs lg:text-[11px] text-slate-400">{isEs ? 'Idioma Predeterminado' : 'Default Language'}</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                      {defaultLanguage === 'es' ? 'Español (ES)' : 'English (EN)'}
                    </dd>
                  </div>
                  {phone && (
                    <div>
                      <dt className="text-xs lg:text-[11px] text-slate-400">{isEs ? 'Teléfono' : 'Phone'}</dt>
                      <dd className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{phone}</dd>
                    </div>
                  )}
                  {contactEmail && (
                    <div>
                      <dt className="text-xs lg:text-[11px] text-slate-400">{isEs ? 'Correo de Contacto' : 'Contact Email'}</dt>
                      <dd className="text-slate-800 dark:text-slate-200 mt-0.5">{contactEmail}</dd>
                    </div>
                  )}
                </dl>

                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80">
                  <dt className="text-xs lg:text-[11px] text-slate-400">{isEs ? 'Propietario Inicial' : 'Owner Onboarding'}</dt>
                  <dd className="text-sm lg:text-xs font-semibold text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                    {inviteOwnerNow && ownerEmail.trim() ? (
                      <span className="font-mono">
                        {ownerEmail.trim().toLowerCase()} ({ownerRole})
                      </span>
                    ) : (
                      <span className="text-slate-500 font-normal">
                        {isEs ? 'Sin invitación inicial (se asignará después)' : 'No initial invitation (assign later)'}
                      </span>
                    )}
                  </dd>
                </div>
              </div>

              {submitError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-sm lg:text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 lg:px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-4 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            {step > 1 && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setStep(prev => (prev === 3 ? 2 : 1))}
                className="min-h-[44px] lg:min-h-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{isEs ? 'Atrás' : 'Back'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleClose}
              className="min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              {isEs ? 'Cancelar' : 'Cancel'}
            </button>

            {step === 1 && (
              <button
                type="button"
                disabled={!canProceedStep1}
                onClick={() => setStep(2)}
                className="min-h-[44px] lg:min-h-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
              >
                <span>{isEs ? 'Siguiente: Propietario' : 'Next: Business Owner'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={!canProceedStep2}
                onClick={() => setStep(3)}
                className="min-h-[44px] lg:min-h-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
              >
                <span>{isEs ? 'Revisar y Crear' : 'Review & Create'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmit}
                className="min-h-[44px] lg:min-h-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{isEs ? 'Creando...' : 'Creating...'}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isEs ? 'Crear Negocio' : 'Create Business'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
