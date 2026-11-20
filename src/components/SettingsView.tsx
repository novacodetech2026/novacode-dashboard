import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { CategorySelector } from './CategorySelector';
import { TimezoneSelector } from './TimezoneSelector';
import { WorkspaceAvatar } from './WorkspaceSwitcher';
import { getCategoryOption } from '../data/businessCategories';
import { SUPPORTED_CURRENCIES, getCurrencySymbol, normalizeCurrencyCode } from '../utils/currency';
import { isValidIanaTimezone } from '../utils/timezone';
import { LocationType } from '../types';
import { SettingsServicesSection } from './settings/SettingsServicesSection';
import { WeeklyHoursSection } from './settings/WeeklyHoursSection';
import { SpecialHoursCalendarSection } from './settings/SpecialHoursCalendarSection';
import { BookingPoliciesSection } from './settings/BookingPoliciesSection';
import {
  Building2,
  Clock,
  Sparkles,
  Users,
  SlidersHorizontal,
  LifeBuoy,
  Save,
  Lock,
  UserPlus,
  Trash2,
  Calendar,
  ArrowUpRight,
  Home,
  Building,
  Video,
  AlertCircle,
  Instagram,
  Globe,
} from 'lucide-react';

type SettingsSectionTab =
  | 'profile'
  | 'hours'
  | 'specialHours'
  | 'services'
  | 'team'
  | 'preferences'
  | 'support';

const SUNDAY_TO_SATURDAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;

export const SettingsView: React.FC = () => {
  const {
    t,
    language,
    mode,
    currentTenant,
    saveBusinessProfile,
    canManageBusinessSettings,
    canManageStaff,
    isSuperAdmin,
    liveMembers,
    staff,
    reloadBusinessMembers,
    assignBusinessMember,
    removeBusinessMember,
    setActiveTab,
    addToast,
  } = useApp();

  const isEs = language === 'es';
  const [activeSubTab, setActiveSubTab] = useState<SettingsSectionTab>('profile');

  // 1. Business Profile state
  const [name, setName] = useState(currentTenant.name || '');
  const [tagline, setTagline] = useState(currentTenant.tagline || '');
  const [description, setDescription] = useState(currentTenant.description || '');
  const [logo, setLogo] = useState(currentTenant.logo || '');
  const [category, setCategory] = useState(currentTenant.category || 'general_service');
  const [categoryLabelEn, setCategoryLabelEn] = useState(currentTenant.categoryLabelEn || '');
  const [categoryLabelEs, setCategoryLabelEs] = useState(currentTenant.categoryLabelEs || '');
  const [customCategoryName, setCustomCategoryName] = useState(
    currentTenant.settings?.categoryDetails?.customName || ''
  );
  const [timezone, setTimezone] = useState(currentTenant.timezone || 'America/New_York');
  const [currency, setCurrency] = useState(normalizeCurrencyCode(currentTenant.currency, 'USD'));
  const [phone, setPhone] = useState(currentTenant.phone || '');
  const [email, setEmail] = useState(currentTenant.email || '');
  const [address, setAddress] = useState(currentTenant.address || '');
  const [website, setWebsite] = useState(currentTenant.website || '');
  const [instagram, setInstagram] = useState(currentTenant.instagram || '');
  const [locationTypes, setLocationTypes] = useState<LocationType[]>(
    currentTenant.settings?.locationTypes && currentTenant.settings.locationTypes.length > 0
      ? currentTenant.settings.locationTypes
      : ['in_business']
  );
  const [bookingInstructions, setBookingInstructions] = useState(
    currentTenant.settings?.bookingInstructions || ''
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Team & Staff state
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'owner' | 'admin' | 'manager' | 'staff'>('staff');
  const [isAssigningMember, setIsAssigningMember] = useState(false);

  useEffect(() => {
    setName(currentTenant.name || '');
    setTagline(currentTenant.tagline || '');
    setDescription(currentTenant.description || '');
    setLogo(currentTenant.logo || '');
    setCategory(currentTenant.category || 'general_service');
    setCategoryLabelEn(currentTenant.categoryLabelEn || '');
    setCategoryLabelEs(currentTenant.categoryLabelEs || '');
    setCustomCategoryName(currentTenant.settings?.categoryDetails?.customName || '');
    setTimezone(currentTenant.timezone || 'America/New_York');
    setCurrency(normalizeCurrencyCode(currentTenant.currency, 'USD'));
    setPhone(currentTenant.phone || '');
    setEmail(currentTenant.email || '');
    setAddress(currentTenant.address || '');
    setWebsite(currentTenant.website || '');
    setInstagram(currentTenant.instagram || '');
    setLocationTypes(
      currentTenant.settings?.locationTypes && currentTenant.settings.locationTypes.length > 0
        ? currentTenant.settings.locationTypes
        : ['in_business']
    );
    setBookingInstructions(currentTenant.settings?.bookingInstructions || '');
    setProfileError(null);
  }, [currentTenant]);

  useEffect(() => {
    if (activeSubTab === 'team' && mode === 'supabase' && canManageStaff && currentTenant.id) {
      reloadBusinessMembers(currentTenant.id);
    }
  }, [activeSubTab, mode, canManageStaff, currentTenant.id, reloadBusinessMembers]);

  // Staff read-only view: preserve 'Staff Access' heading & zero Business Profile edit controls
  if (!canManageBusinessSettings) {
    const readOnlyHours = currentTenant.settings?.operatingHours || {};
    const readOnlyLocations =
      currentTenant.settings?.locationTypes && currentTenant.settings.locationTypes.length > 0
        ? currentTenant.settings.locationTypes
        : ['in_business'];
    const readOnlyCurrency = normalizeCurrencyCode(currentTenant.currency, 'USD');

    return (
      <div className="max-w-3xl mx-auto mt-2 lg:mt-6 space-y-4 lg:space-y-5">
        <div className="p-5 lg:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 shadow-xs text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {t.auth.staffRestrictedTitle}
          </h2>
          <p className="text-sm lg:text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-lg mx-auto">
            {t.auth.staffRestrictedNotice}
          </p>
        </div>

        {/* Permitted Read-Only Business Summary for Staff */}
        <div className="p-4 lg:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="min-w-0">
              <h3 className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {currentTenant.name}
              </h3>
              <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400">
                {isEs ? 'Información de solo lectura del negocio' : 'Read-only business reference'}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs lg:text-[11px] font-mono text-slate-600 dark:text-slate-300">
              <Globe className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="truncate">{currentTenant.timezone}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm lg:text-xs">
            <div>
              <span className="text-xs lg:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {t.settings.currency}
              </span>
              <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                {readOnlyCurrency} ({getCurrencySymbol(readOnlyCurrency, currentTenant.currencySymbol || '$')})
              </p>
            </div>
            <div>
              <span className="text-xs lg:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {t.settings.supportedLocationsLabel}
              </span>
              <p className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                {readOnlyLocations
                  .map(loc =>
                    loc === 'in_business'
                      ? t.settings.locationInBusiness
                      : loc === 'at_home'
                      ? t.settings.locationAtHome
                      : t.settings.locationOnline
                  )
                  .join(' · ')}
              </p>
            </div>
            {currentTenant.settings?.bookingInstructions && (
              <div className="sm:col-span-2">
                <span className="text-xs lg:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  {t.settings.bookingInstructionsLabel}
                </span>
                <p className="text-slate-700 dark:text-slate-300 mt-0.5 leading-relaxed">
                  {currentTenant.settings.bookingInstructions}
                </p>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs lg:text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">
              {t.settings.operatingHoursTitle}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm lg:text-xs">
              {SUNDAY_TO_SATURDAY_ORDER.map(dow => {
                const entry = readOnlyHours[dow];
                const label = !entry
                  ? t.settings.dayUnconfigured
                  : entry.isClosed
                  ? t.settings.dayClosed
                  : `${entry.open} – ${entry.close}`;
                return (
                  <div
                    key={dow}
                    className="flex items-center justify-between px-3 py-2 lg:py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                  >
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {t.days[dow as keyof typeof t.days]}
                    </span>
                    <span className="font-mono text-xs lg:text-[11px] text-slate-500 dark:text-slate-400">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const toggleProfileLocation = (loc: LocationType) => {
    setProfileError(null);
    setLocationTypes(prev =>
      prev.includes(loc) ? prev.filter(item => item !== loc) : [...prev, loc]
    );
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setProfileError(isEs ? 'El nombre del negocio es obligatorio.' : 'Business name is required.');
      return;
    }

    if (!isValidIanaTimezone(timezone)) {
      setProfileError(
        isEs
          ? 'Selecciona una zona horaria IANA válida.'
          : 'Please select a valid IANA timezone.'
      );
      return;
    }

    if (locationTypes.length === 0) {
      setProfileError(
        isEs
          ? 'Selecciona al menos una modalidad de cita soportada.'
          : 'Select at least one supported appointment location.'
      );
      return;
    }

    setIsSavingProfile(true);
    try {
      const catOpt = getCategoryOption(category);
      const res = await saveBusinessProfile({
        name: trimmedName,
        category,
        categoryLabelEn: categoryLabelEn || catOpt.labelEn,
        categoryLabelEs: categoryLabelEs || catOpt.labelEs,
        customCategoryName: category === 'custom_business' ? customCategoryName.trim() : undefined,
        tagline: tagline.trim(),
        description: description.trim(),
        logo: logo.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        website: website.trim(),
        instagram: instagram.trim(),
        timezone,
        currency: normalizeCurrencyCode(currency, 'USD'),
        locationTypes,
        bookingInstructions: bookingInstructions.trim(),
      });

      if (!res.success && res.error) {
        setProfileError(res.error);
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAssignMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberEmail.trim() || !currentTenant.id) return;
    setIsAssigningMember(true);
    const res = await assignBusinessMember(currentTenant.id, memberEmail.trim(), memberRole);
    setIsAssigningMember(false);
    if (res.success) {
      setMemberEmail('');
    } else if (res.error) {
      addToast('error', t.common.error, res.error);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!currentTenant.id) return;
    const res = await removeBusinessMember(currentTenant.id, userId);
    if (!res.success && res.error) {
      addToast('error', t.common.error, res.error);
    }
  };

  const formatMemberRole = (role: string) => {
    if (role === 'owner') return t.auth.roleOwner;
    if (role === 'admin') return t.auth.roleAdmin;
    if (role === 'manager') return t.auth.roleManager;
    return t.auth.roleStaff;
  };

  const subTabs: Array<{
    id: SettingsSectionTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'profile', label: t.settings.tabs.profile, icon: Building2 },
    { id: 'hours', label: t.settings.tabs.hours, icon: Clock },
    { id: 'specialHours', label: t.settings.tabs.specialHours, icon: Calendar },
    { id: 'services', label: t.settings.tabs.services, icon: Sparkles },
    ...(canManageStaff ? [{ id: 'team' as const, label: t.settings.tabs.team, icon: Users }] : []),
    { id: 'preferences', label: t.settings.tabs.preferences, icon: SlidersHorizontal },
    { id: 'support', label: t.settings.tabs.support, icon: LifeBuoy },
  ];

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
    <div className="space-y-4 lg:space-y-6">
      {/* Header & Business Settings Tab Bar */}
      <div className="p-4 lg:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3.5 lg:space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 lg:gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <WorkspaceAvatar tenant={{ ...currentTenant, logo, name }} size="md" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
                {t.settings.title}
              </h1>
              <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate leading-relaxed">
                {t.settings.subtitle}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 lg:gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl overflow-x-auto no-scrollbar text-sm lg:text-xs font-semibold">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs ring-1 ring-slate-900/5 dark:ring-white/10'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 1: Business Profile */}
      {activeSubTab === 'profile' && (
        <form
          onSubmit={handleSaveProfile}
          noValidate
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-5 lg:space-y-6 shadow-xs"
        >
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.settings.businessProfile}
            </h2>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.settings.businessProfileDesc}
            </p>
          </div>

          {profileError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-sm lg:text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{profileError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
            <div>
              <label
                htmlFor="profile-business-name"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.businessName} *
              </label>
              <input
                id="profile-business-name"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="profile-tagline"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.tagline}
              </label>
              <input
                id="profile-tagline"
                type="text"
                value={tagline}
                onChange={e => setTagline(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.settings.category}
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

            <div>
              <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.settings.timezone} *
              </label>
              <TimezoneSelector
                value={timezone}
                onChange={setTimezone}
                language={language}
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="profile-description"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.businessDescription}
              </label>
              <textarea
                id="profile-description"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t.settings.businessDescriptionPlaceholder}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </div>

            <div>
              <label
                htmlFor="profile-currency"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.currency}
              </label>
              <select
                id="profile-currency"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SUPPORTED_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>
                    {isEs ? c.labelEs : c.labelEn}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="profile-logo"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.logoUrl}
              </label>
              <input
                id="profile-logo"
                type="text"
                value={logo}
                onChange={e => setLogo(e.target.value)}
                placeholder="https://..."
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="profile-phone"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.phone}
              </label>
              <input
                id="profile-phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="profile-email"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.email}
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="profile-address"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.address}
              </label>
              <input
                id="profile-address"
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="profile-website"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.website}
              </label>
              <input
                id="profile-website"
                type="url"
                value={website}
                onChange={e => setWebsite(e.target.value)}
                placeholder="https://yourbusiness.com"
                className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="profile-instagram"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.instagram}
              </label>
              <div className="relative">
                <Instagram className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="profile-instagram"
                  type="text"
                  value={instagram}
                  onChange={e => setInstagram(e.target.value)}
                  placeholder={t.settings.instagramPlaceholder}
                  className="w-full min-h-[44px] lg:min-h-0 pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <span className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.settings.supportedLocationsLabel} *
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
                      onClick={() => toggleProfileLocation(opt.id)}
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
                htmlFor="profile-booking-instructions"
                className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.settings.bookingInstructionsLabel}
              </label>
              <textarea
                id="profile-booking-instructions"
                rows={3}
                value={bookingInstructions}
                onChange={e => setBookingInstructions(e.target.value)}
                placeholder={t.settings.bookingInstructionsPlaceholder}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="submit"
              disabled={isSavingProfile}
              className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
            >
              <Save className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{isSavingProfile ? t.common.loading : t.settings.saveProfile}</span>
            </button>
          </div>
        </form>
      )}

      {/* Section 2: Weekly Operating Hours */}
      {activeSubTab === 'hours' && <WeeklyHoursSection />}

      {/* Section 3: Special & Holiday Hours Calendar */}
      {activeSubTab === 'specialHours' && <SpecialHoursCalendarSection />}

      {/* Section 4: Services & Pricing */}
      {activeSubTab === 'services' && <SettingsServicesSection />}

      {/* Section 5: Team & Staff (Permission-Gated) */}
      {activeSubTab === 'team' && canManageStaff && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-4 lg:space-y-5 shadow-xs">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.settings.tabs.team}
            </h2>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.settings.teamMembersDesc.replace('{business}', currentTenant.name)}
            </p>
          </div>

          {mode === 'supabase' ? (
            <div className="space-y-4 lg:space-y-5">
              <form
                onSubmit={handleAssignMember}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
              >
                <div className="md:col-span-6">
                  <label className="block text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t.auth.emailLabel}
                  </label>
                  <input
                    type="email"
                    required
                    value={memberEmail}
                    onChange={e => setMemberEmail(e.target.value)}
                    placeholder={t.settings.teamEmailPlaceholder}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t.settings.teamRoleLabel}
                  </label>
                  <select
                    value={memberRole}
                    onChange={e =>
                      setMemberRole(e.target.value as 'owner' | 'admin' | 'manager' | 'staff')
                    }
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="staff">{t.auth.roleStaff}</option>
                    <option value="manager">{t.auth.roleManager}</option>
                    {isSuperAdmin && <option value="admin">{t.auth.roleAdmin}</option>}
                    {isSuperAdmin && <option value="owner">{t.auth.roleOwner}</option>}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <button
                    type="submit"
                    disabled={isAssigningMember}
                    className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold transition-all whitespace-nowrap"
                  >
                    <UserPlus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                    <span>{t.settings.teamAddMemberBtn}</span>
                  </button>
                </div>
              </form>

              {liveMembers.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-sm lg:text-xs text-slate-500">
                  {t.settings.teamNoMembersFound}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
                  {liveMembers.map((member, idx) => {
                    const isOwnerRow = member.role === 'owner' || member.role === 'admin';
                    const canRemoveThisMember = canManageStaff && (isSuperAdmin || !isOwnerRow);
                    const displayLabel =
                      member.userEmail && member.userEmail.trim()
                        ? member.userEmail.trim()
                        : `${t.settings.teamMemberFallback} #${idx + 1}`;

                    return (
                      <div
                        key={member.id || `${member.businessId}-${idx}`}
                        className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800 flex items-center justify-center font-bold text-xs text-indigo-700 dark:text-indigo-300 shrink-0">
                            {displayLabel.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                              {displayLabel}
                            </p>
                            <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs lg:text-[10px] font-bold text-slate-600 dark:text-slate-300">
                              {formatMemberRole(member.role)}
                            </span>
                          </div>
                        </div>

                        {canRemoveThisMember && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.userId)}
                            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
                            title={t.settings.teamRemoveMemberBtn}
                            aria-label={t.settings.teamRemoveMemberBtn}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
              {staff.map(member => (
                <div
                  key={member.id}
                  className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center gap-3 bg-white dark:bg-slate-900"
                >
                  <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800 flex items-center justify-center font-bold text-xs text-indigo-700 dark:text-indigo-300 shrink-0">
                    {member.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {member.name}
                    </p>
                    <p className="text-xs lg:text-[11px] text-slate-500 truncate">
                      {language === 'es' ? member.roleEs : member.roleEn}
                    </p>
                    <p className="text-xs lg:text-[10px] text-slate-400 font-mono truncate">
                      {member.email}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section 6: Booking Policies & Preferences */}
      {activeSubTab === 'preferences' && <BookingPoliciesSection />}

      {/* Section 7: Help & Support */}
      {activeSubTab === 'support' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-4 lg:space-y-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <LifeBuoy className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.settings.supportSectionTitle}
                </h2>
                <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xl leading-relaxed">
                  {t.settings.supportSectionDesc}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('support')}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap self-start sm:self-auto"
            >
              <span>{t.settings.openSupportCenterBtn}</span>
              <ArrowUpRight className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
