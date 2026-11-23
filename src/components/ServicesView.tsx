import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { SUPPORTED_CURRENCIES, getCurrencySymbol, normalizeCurrencyCode } from '../utils/currency';
import {
  Plus,
  Clock,
  Building,
  Home,
  Search,
  X,
  Pencil,
  Save,
  RotateCcw,
  Archive,
  AlertCircle,
} from 'lucide-react';
import { Service } from '../types';

export const ServicesView: React.FC = () => {
  const {
    t,
    language,
    currentTenant,
    services,
    activeServicesCount,
    canManageServices,
    addService,
    updateService,
    addToast,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [togglingServiceId, setTogglingServiceId] = useState<string | null>(null);

  const defaultCurrency = normalizeCurrencyCode(currentTenant.currency, 'USD');

  // Service Form State
  const [nameEn, setNameEn] = useState('');
  const [nameEs, setNameEs] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionEs, setDescriptionEs] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [price, setPrice] = useState('75');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [category, setCategory] = useState('General');
  const [allowsInBusiness, setAllowsInBusiness] = useState(true);
  const [allowsAtHome, setAllowsAtHome] = useState(false);
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreateModal = () => {
    setEditingService(null);
    setNameEn('');
    setNameEs('');
    setDescriptionEn('');
    setDescriptionEs('');
    setDurationMinutes('60');
    setPrice('75');
    setCurrency(defaultCurrency);
    setCategory('General');
    setAllowsInBusiness(true);
    setAllowsAtHome(false);
    setActive(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (svc: Service) => {
    setEditingService(svc);
    setNameEn(svc.nameEn || '');
    setNameEs(svc.nameEs || '');
    setDescriptionEn(svc.descriptionEn || '');
    setDescriptionEs(svc.descriptionEs || '');
    setDurationMinutes(String(svc.durationMinutes || 60));
    setPrice(String(svc.price ?? 0));
    setCurrency(normalizeCurrencyCode(svc.currency, defaultCurrency));
    setCategory(svc.category);
    setAllowsInBusiness(svc.allowsInBusiness);
    setAllowsAtHome(svc.allowsAtHome);
    setActive(svc.active);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setFormError(null);

    const trimmedEn = nameEn.trim();
    const trimmedEs = nameEs.trim();
    if (!trimmedEn && !trimmedEs) {
      setFormError(language === 'es' ? 'El nombre del servicio es obligatorio.' : 'Service name is required.');
      return;
    }

    const parsedDuration = Number(durationMinutes);
    if (!Number.isFinite(parsedDuration) || !Number.isInteger(parsedDuration) || parsedDuration < 5 || parsedDuration > 1440) {
      setFormError(
        language === 'es'
          ? 'La duración debe ser un número entero entre 5 y 1440 minutos.'
          : 'Duration must be a whole number between 5 and 1440 minutes.'
      );
      return;
    }

    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFormError(
        language === 'es'
          ? 'El precio debe ser un monto válido mayor o igual a 0.'
          : 'Price must be a valid non-negative amount.'
      );
      return;
    }

    const resolvedNameEn = trimmedEn || trimmedEs;
    const resolvedNameEs = trimmedEs || trimmedEn;
    const trimmedDescEn = descriptionEn.trim();
    const trimmedDescEs = descriptionEs.trim();
    const resolvedDescEn = editingService ? trimmedDescEn : (trimmedDescEn || trimmedDescEs);
    const resolvedDescEs = editingService ? trimmedDescEs : (trimmedDescEs || trimmedDescEn);

    setIsSaving(true);
    try {
      const payload = {
        nameEn: resolvedNameEn,
        nameEs: resolvedNameEs,
        descriptionEn: resolvedDescEn,
        descriptionEs: resolvedDescEs,
        durationMinutes: parsedDuration,
        price: Number(parsedPrice.toFixed(2)),
        currency: normalizeCurrencyCode(currency, defaultCurrency),
        category: category.trim() || 'General',
        allowsInBusiness,
        allowsAtHome,
        active,
      };

      const res = editingService
        ? await updateService({ ...editingService, ...payload })
        : await addService(payload);

      if (res.success) {
        setIsModalOpen(false);
      } else if (res.error) {
        setFormError(res.error);
        addToast('error', t.common.error, res.error);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickToggleArchive = async (svc: Service, nextActive: boolean) => {
    if (!canManageServices || togglingServiceId) return;
    setTogglingServiceId(svc.id);
    try {
      const res = await updateService({ ...svc, active: nextActive });
      if (!res.success && res.error) {
        addToast('error', t.common.error, res.error);
      }
    } finally {
      setTogglingServiceId(null);
    }
  };

  // Categories list derived from current services
  const categories = useMemo(() => {
    const set = new Set<string>();
    services.forEach(s => set.add(s.category));
    return Array.from(set);
  }, [services]);

  const filteredServices = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return services.filter(s => {
      const name = language === 'es' ? (s.nameEs || s.nameEn || '') : (s.nameEn || s.nameEs || '');
      const desc = language === 'es' ? (s.descriptionEs || s.descriptionEn || '') : (s.descriptionEn || s.descriptionEs || '');
      const matchesSearch =
        name.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q);
      const matchesCategory = selectedCategory === 'all' || s.category === selectedCategory;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && s.active) ||
        (statusFilter === 'inactive' && !s.active);

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [services, searchQuery, selectedCategory, statusFilter, language]);

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header and Controls */}
      <div className="p-4 lg:p-6 rounded-2xl lg:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3.5 lg:space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 lg:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                {t.services.title}
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-semibold font-mono tabular-nums">
                {t.services.totalServices.replace('{count}', String(activeServicesCount))}
              </span>
            </div>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.services.subtitle}
            </p>
          </div>

          {canManageServices && (
            <button
              onClick={openCreateModal}
              className="flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors self-start sm:self-auto"
            >
              <Plus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{t.services.addService}</span>
            </button>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 lg:gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder={t.services.searchPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:flex items-center gap-2">
            <select
              aria-label={t.common.status}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              className="w-full sm:w-auto min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t.services.allStatuses}</option>
              <option value="active">{t.services.activeOnly}</option>
              <option value="inactive">{t.services.inactiveOnly}</option>
            </select>

            <select
              aria-label={t.services.category}
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full sm:w-auto min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t.services.allCategories}</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
        {filteredServices.map(service => {
          const name = language === 'es' ? (service.nameEs || service.nameEn) : (service.nameEn || service.nameEs);
          const desc = language === 'es' ? (service.descriptionEs || service.descriptionEn) : (service.descriptionEn || service.descriptionEs);

          return (
            <div
              key={service.id}
              className={`p-4 lg:p-5 rounded-2xl lg:rounded-3xl bg-white dark:bg-slate-900 border transition-all flex flex-col justify-between shadow-xs group min-w-0 ${
                service.active
                  ? 'border-slate-200/80 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/60'
                  : 'border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/60 opacity-85'
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2.5 lg:gap-3 mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400">
                    {service.category}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-base font-extrabold font-mono text-slate-900 dark:text-slate-100">
                      {getCurrencySymbol(
                        normalizeCurrencyCode(service.currency, defaultCurrency),
                        currentTenant.currencySymbol || '$'
                      )}
                      {service.price.toFixed(2)} {normalizeCurrencyCode(service.currency, defaultCurrency)}
                    </span>
                    {canManageServices && (
                      <button
                        type="button"
                        onClick={() => openEditModal(service)}
                        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors"
                        title={t.services.editService}
                        aria-label={t.services.editService}
                      >
                        <Pencil className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors break-words">
                  {name}
                </h3>

                <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-3 leading-relaxed">
                  {desc}
                </p>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5 lg:space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-mono">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{service.durationMinutes} {t.appointment.minutes}</span>
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs lg:text-[11px] font-semibold font-sans ${
                        service.active
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/70'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {service.active ? t.services.activeStatus : t.services.inactiveStatus}
                    </span>
                    {canManageServices && (
                      service.active ? (
                        <button
                          type="button"
                          disabled={togglingServiceId === service.id}
                          onClick={() => handleQuickToggleArchive(service, false)}
                          className="inline-flex items-center justify-center gap-1 min-h-[44px] lg:min-h-0 px-3 lg:px-2 py-2 lg:py-0.5 rounded-lg lg:rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 disabled:opacity-50 text-amber-700 dark:text-amber-300 text-xs lg:text-[11px] font-semibold font-sans transition-colors"
                        >
                          <Archive className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                          <span>{t.settings.archiveServiceBtn}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={togglingServiceId === service.id}
                          onClick={() => handleQuickToggleArchive(service, true)}
                          className="inline-flex items-center justify-center gap-1 min-h-[44px] lg:min-h-0 px-3 lg:px-2 py-2 lg:py-0.5 rounded-lg lg:rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs lg:text-[11px] font-semibold font-sans transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                          <span>{t.services.reactivateService}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs lg:text-[11px] text-slate-400 pt-1">
                  {service.allowsInBusiness && (
                    <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                      <Building className="w-3.5 h-3.5 lg:w-3 lg:h-3 text-indigo-500" />
                      <span>{t.services.inBusinessOffered}</span>
                    </span>
                  )}
                  {service.allowsAtHome && (
                    <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                      <Home className="w-3.5 h-3.5 lg:w-3 lg:h-3 text-emerald-500" />
                      <span>{t.services.atHomeOffered}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Service Modal */}
      {isModalOpen && canManageServices && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
          <div className="w-full sm:max-w-lg max-h-[92dvh] sm:max-h-[90vh] bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 p-4 lg:px-6 lg:py-4 shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingService ? t.services.editServiceTitle : t.services.newServiceTitle}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1 rounded-xl lg:rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5 lg:w-4 lg:h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveService} noValidate className="flex flex-col flex-1 min-h-0 text-sm lg:text-xs">
              <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-3.5">
                {formError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="service-name-en"
                      className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      {t.services.nameEn}
                    </label>
                    <input
                      id="service-name-en"
                      type="text"
                      required
                      value={nameEn}
                      onChange={e => setNameEn(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="service-name-es"
                      className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      {t.services.nameEs}
                    </label>
                    <input
                      id="service-name-es"
                      type="text"
                      value={nameEs}
                      onChange={e => setNameEs(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.services.category}
                    </label>
                    <input
                      type="text"
                      value={category}
                      placeholder={t.services.categoryPlaceholder}
                      onChange={e => setCategory(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.services.durationMinutes}
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      step={5}
                      required
                      value={durationMinutes}
                      onChange={e => setDurationMinutes(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 font-mono text-base lg:text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.services.priceAmount}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 font-mono text-base lg:text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.settings.serviceCurrencyLabel}
                    </label>
                    <select
                      value={currency}
                      onChange={e => setCurrency(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 font-mono text-base lg:text-xs text-slate-900 dark:text-slate-100"
                    >
                      {SUPPORTED_CURRENCIES.map(c => (
                        <option key={c.code} value={c.code}>
                          {c.code} ({c.symbol})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.services.descriptionEn}
                  </label>
                  <textarea
                    rows={2}
                    value={descriptionEn}
                    onChange={e => setDescriptionEn(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.services.descriptionEs}
                  </label>
                  <textarea
                    rows={2}
                    value={descriptionEs}
                    onChange={e => setDescriptionEs(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 lg:gap-4 pt-1">
                  <label className="inline-flex items-center gap-2.5 min-h-[44px] lg:min-h-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowsInBusiness}
                      onChange={e => setAllowsInBusiness(e.target.checked)}
                      className="w-5 h-5 lg:w-4 lg:h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {t.services.allowsInBusinessLabel}
                    </span>
                  </label>

                  <label className="inline-flex items-center gap-2.5 min-h-[44px] lg:min-h-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowsAtHome}
                      onChange={e => setAllowsAtHome(e.target.checked)}
                      className="w-5 h-5 lg:w-4 lg:h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {t.services.allowsAtHomeLabel}
                    </span>
                  </label>

                  <label className="inline-flex items-center gap-2.5 min-h-[44px] lg:min-h-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={e => setActive(e.target.checked)}
                      className="w-5 h-5 lg:w-4 lg:h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {t.services.activeLabel}
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 lg:px-6 lg:py-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm lg:text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white"
                >
                  <Save className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                  <span>{isSaving ? t.common.loading : t.services.saveService}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
