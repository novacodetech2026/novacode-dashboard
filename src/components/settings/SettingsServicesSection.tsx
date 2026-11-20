import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Service } from '../../types';
import { SUPPORTED_CURRENCIES, getCurrencySymbol, normalizeCurrencyCode } from '../../utils/currency';
import {
  Sparkles,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  Search,
  Clock,
  ArrowUpRight,
  X,
  Save,
  AlertCircle,
} from 'lucide-react';

export const SettingsServicesSection: React.FC = () => {
  const {
    t,
    language,
    currentTenant,
    services,
    canManageServices,
    addService,
    updateService,
    setActiveTab,
    addToast,
  } = useApp();

  const isEs = language === 'es';
  const defaultCurrency = normalizeCurrencyCode(currentTenant.currency, 'USD');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);

  // Service Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<string>('60');
  const [price, setPrice] = useState<string>('75');
  const [currency, setCurrency] = useState<string>(defaultCurrency);
  const [isActive, setIsActive] = useState<boolean>(true);

  const openAddForm = () => {
    setEditingService(null);
    setName('');
    setDescription('');
    setDurationMinutes('60');
    setPrice('75');
    setCurrency(defaultCurrency);
    setIsActive(true);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (svc: Service) => {
    setEditingService(svc);
    setName(isEs ? svc.nameEs || svc.nameEn : svc.nameEn || svc.nameEs);
    setDescription(isEs ? svc.descriptionEs || svc.descriptionEn : svc.descriptionEn || svc.descriptionEs);
    setDurationMinutes(String(svc.durationMinutes || 60));
    setPrice(String(svc.price ?? 0));
    setCurrency(normalizeCurrencyCode(svc.currency, defaultCurrency));
    setIsActive(svc.active !== false);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError(isEs ? 'El nombre del servicio es obligatorio.' : 'Service name is required.');
      return;
    }

    const parsedDuration = Number(durationMinutes);
    if (!Number.isFinite(parsedDuration) || !Number.isInteger(parsedDuration) || parsedDuration < 5 || parsedDuration > 1440) {
      setFormError(
        isEs
          ? 'La duración debe ser un número entero entre 5 y 1440 minutos.'
          : 'Duration must be a whole number between 5 and 1440 minutes.'
      );
      return;
    }

    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFormError(
        isEs ? 'El precio debe ser un monto válido mayor o igual a 0.' : 'Price must be a valid non-negative number.'
      );
      return;
    }

    const normalizedCurrency = normalizeCurrencyCode(currency, defaultCurrency);
    const trimmedDescription = description.trim();

    setIsSaving(true);
    try {
      if (editingService) {
        const res = await updateService({
          ...editingService,
          tenantId: editingService.tenantId || currentTenant.id,
          nameEn: trimmedName,
          nameEs: trimmedName,
          descriptionEn: trimmedDescription,
          descriptionEs: trimmedDescription,
          durationMinutes: parsedDuration,
          price: Number(parsedPrice.toFixed(2)),
          currency: normalizedCurrency,
          active: isActive,
        });
        if (!res.success) {
          setFormError(res.error || (isEs ? 'No se pudo actualizar el servicio.' : 'Unable to update service.'));
          return;
        }
      } else {
        const locationTypes = currentTenant.settings?.locationTypes || ['in_business'];
        const res = await addService({
          nameEn: trimmedName,
          nameEs: trimmedName,
          descriptionEn: trimmedDescription,
          descriptionEs: trimmedDescription,
          durationMinutes: parsedDuration,
          price: Number(parsedPrice.toFixed(2)),
          currency: normalizedCurrency,
          category: 'General',
          allowsInBusiness: locationTypes.includes('in_business'),
          allowsAtHome: locationTypes.includes('at_home'),
          active: isActive,
        });
        if (!res.success) {
          setFormError(res.error || (isEs ? 'No se pudo crear el servicio.' : 'Unable to create service.'));
          return;
        }
      }
      setIsFormOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleArchive = async (svc: Service, nextActive: boolean) => {
    if (!canManageServices) return;
    setBusyServiceId(svc.id);
    try {
      const res = await updateService({
        ...svc,
        tenantId: svc.tenantId || currentTenant.id,
        active: nextActive,
      });
      if (!res.success && res.error) {
        addToast('error', t.common.error, res.error);
      }
    } finally {
      setBusyServiceId(null);
    }
  };

  const counts = useMemo(() => {
    const active = services.filter(s => s.active !== false).length;
    const inactive = services.length - active;
    return { total: services.length, active, inactive };
  }, [services]);

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return services.filter(svc => {
      const displayName = (isEs ? svc.nameEs || svc.nameEn : svc.nameEn || svc.nameEs).toLowerCase();
      const displayDesc = (isEs ? svc.descriptionEs || svc.descriptionEn : svc.descriptionEn || svc.descriptionEs).toLowerCase();
      const matchesSearch = !q || displayName.includes(q) || displayDesc.includes(q);
      const isSvcActive = svc.active !== false;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && isSvcActive) ||
        (statusFilter === 'inactive' && !isSvcActive);
      return matchesSearch && matchesStatus;
    });
  }, [services, searchQuery, statusFilter, isEs]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-4 lg:space-y-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>{t.settings.servicesOverviewTitle}</span>
            </h2>
            <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs lg:text-[11px] font-semibold font-mono tabular-nums">
              {counts.active} {t.settings.serviceActiveBadge}
            </span>
            {counts.inactive > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs lg:text-[11px] font-semibold font-mono tabular-nums">
                {counts.inactive} {t.settings.serviceArchivedBadge}
              </span>
            )}
          </div>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {t.settings.servicesOverviewDesc}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {canManageServices && (
            <button
              type="button"
              onClick={openAddForm}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
            >
              <Plus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{t.services.addService}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('services')}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm lg:text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <span>{t.settings.openServicesCatalogBtn}</span>
            <ArrowUpRight className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 lg:gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t.services.searchPlaceholder}
            aria-label={t.services.searchPlaceholder}
            className="w-full min-h-[44px] lg:min-h-0 pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          aria-label={t.common.status}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">{t.services.allStatuses}</option>
          <option value="active">{t.services.activeOnly}</option>
          <option value="inactive">{t.services.inactiveOnly}</option>
        </select>
      </div>

      {/* Inline Add / Edit Service Panel */}
      {isFormOpen && canManageServices && (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="p-4 lg:p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100">
              {editingService ? t.services.editServiceTitle : t.services.newServiceTitle}
            </h3>
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1 rounded-xl lg:rounded-lg text-slate-400 hover:text-slate-600"
              aria-label={t.common.close}
            >
              <X className="w-5 h-5 lg:w-4 lg:h-4" />
            </button>
          </div>

          {formError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-sm lg:text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 lg:gap-4 text-sm lg:text-xs">
            <div className="md:col-span-6">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.settings.serviceNameLabel} *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isEs ? 'Ej. Corte y Peinado Signature' : 'e.g. Signature Haircut & Blowout'}
                className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.settings.serviceDurationLabel} *
              </label>
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                required
                value={durationMinutes}
                onChange={e => setDurationMinutes(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.settings.servicePriceLabel} *
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.settings.serviceCurrencyLabel}
              </label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SUPPORTED_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.symbol})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-12">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.settings.serviceDescriptionLabel}
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={
                  isEs
                    ? 'Describe qué incluye este servicio y cualquier preparación previa...'
                    : 'Describe what this service includes and any preparation notes...'
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-indigo-200/60 dark:border-indigo-900/50">
            <label className="inline-flex items-center gap-2.5 min-h-[44px] lg:min-h-0 text-sm lg:text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="w-5 h-5 lg:w-4 lg:h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>{t.services.activeLabel}</span>
            </label>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold"
              >
                <Save className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                <span>{isSaving ? t.common.loading : t.services.saveService}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Services List */}
      {filteredServices.length === 0 ? (
        <div className="p-6 lg:p-8 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-3">
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {t.settings.noServicesYet}
          </p>
          {canManageServices && (
            <button
              type="button"
              onClick={openAddForm}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-sm lg:text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Plus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{t.services.addService}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
          {filteredServices.map(svc => {
            const svcActive = svc.active !== false;
            const svcCurrency = normalizeCurrencyCode(svc.currency, defaultCurrency);
            const svcSymbol = getCurrencySymbol(svcCurrency, currentTenant.currencySymbol || '$');
            const svcName = isEs ? svc.nameEs || svc.nameEn : svc.nameEn || svc.nameEs;
            const svcDesc = isEs ? svc.descriptionEs || svc.descriptionEn : svc.descriptionEn || svc.descriptionEs;
            const isBusy = busyServiceId === svc.id;

            return (
              <div
                key={svc.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                  svcActive
                    ? 'border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30'
                    : 'border-slate-200/70 dark:border-slate-800/70 bg-slate-100/60 dark:bg-slate-900/50 opacity-85'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {svcName}
                      </p>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded-md text-xs lg:text-[10px] font-semibold ${
                          svcActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/70'
                            : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300/60 dark:border-slate-700'
                        }`}
                      >
                        {svcActive ? t.settings.serviceActiveBadge : t.settings.serviceArchivedBadge}
                      </span>
                    </div>
                    <span className="text-sm lg:text-xs font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400 shrink-0">
                      {svcSymbol}
                      {(Number(svc.price) || 0).toFixed(2)} {svcCurrency}
                    </span>
                  </div>

                  {svcDesc && (
                    <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {svcDesc}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-xs lg:text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {svc.durationMinutes} {t.appointment.minutes}
                  </span>

                  {canManageServices && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openEditForm(svc)}
                        className="inline-flex items-center justify-center gap-1 min-h-[44px] lg:min-h-0 px-3 lg:px-2 py-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
                        aria-label={`${t.common.edit} ${svcName}`}
                      >
                        <Pencil className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                        <span>{t.common.edit}</span>
                      </button>

                      {svcActive ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleArchive(svc, false)}
                          className="inline-flex items-center justify-center gap-1 min-h-[44px] lg:min-h-0 px-3 lg:px-2 py-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                          title={
                            isEs
                              ? 'Archivar servicio (conserva historial de citas)'
                              : 'Archive service (preserves appointment history)'
                          }
                        >
                          <Archive className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                          <span>{t.settings.archiveServiceBtn}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleArchive(svc, true)}
                          className="inline-flex items-center justify-center gap-1 min-h-[44px] lg:min-h-0 px-3 lg:px-2 py-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                          <span>{t.settings.reactivateServiceBtn}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
