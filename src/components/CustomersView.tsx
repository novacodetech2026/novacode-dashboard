import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Search,
  UserPlus,
  Calendar,
  X,
  ChevronRight,
  Save,
  Users,
  AlertCircle,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { Customer, Language } from '../types';

export const CustomersView: React.FC = () => {
  const {
    t,
    language,
    mode,
    currentTenant,
    customers,
    appointments,
    isLoadingLiveData,
    liveDataError,
    liveDataErrorType,
    reloadLiveAppointments,
    addCustomer,
    updateCustomerNotes,
    setIsNewBookingModalOpen,
    setSelectedAppointmentForDetail,
  } = useApp();

  const isEs = language === 'es';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);

  // New Customer Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [custLanguage, setCustLanguage] = useState<Language>(currentTenant.defaultLanguage || 'en');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Editing notes state inside profile drawer
  const [editNotes, setEditNotes] = useState('');

  // Reset drawer & search cleanly when switching business tenants
  useEffect(() => {
    setSelectedCustomer(null);
    setSearchQuery('');
    setCustLanguage(currentTenant.defaultLanguage || 'en');
  }, [currentTenant.id, currentTenant.defaultLanguage]);

  const filteredCustomers = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => {
      const cName = (c?.name ?? '').toLowerCase();
      const cPhone = c?.phone ?? '';
      const cEmail = (c?.email ?? '').toLowerCase();
      return cName.includes(q) || cPhone.includes(searchQuery.trim()) || cEmail.includes(q);
    });
  }, [customers, searchQuery]);

  const handleOpenProfile = (cust: Customer) => {
    setSelectedCustomer(cust);
    setEditNotes(cust.notes || '');
  };

  const handleSaveNotes = () => {
    if (selectedCustomer) {
      updateCustomerNotes(selectedCustomer.id, editNotes);
      setSelectedCustomer(prev => (prev ? { ...prev, notes: editNotes } : null));
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    try {
      await addCustomer({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        preferredLanguage: custLanguage,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      setIsAddCustomerOpen(false);
      setName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setNotes('');
    } catch {
      // Error toast is handled safely by AppContext; keep modal open for retry
    }
  };

  const customerAppointments = useMemo(() => {
    if (!selectedCustomer) return [];
    return appointments.filter(a => a.customerId === selectedCustomer.id);
  }, [appointments, selectedCustomer]);

  const getCustomerDisplayName = (cust: Customer) =>
    (cust?.name && cust.name.trim()) || (isEs ? 'Cliente sin nombre' : 'Unnamed Customer');

  const getCustomerInitial = (cust: Customer) => {
    const source = (cust?.name || cust?.email || 'C').trim();
    return source ? source.charAt(0).toUpperCase() : 'C';
  };

  const showLoadingState = mode === 'supabase' && isLoadingLiveData && customers.length === 0;
  const showPermissionError =
    mode === 'supabase' && !isLoadingLiveData && liveDataErrorType === 'permission' && customers.length === 0;
  const showConnectionError =
    mode === 'supabase' &&
    !isLoadingLiveData &&
    Boolean(liveDataError) &&
    liveDataErrorType !== 'permission' &&
    customers.length === 0;

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header and Controls */}
      <div className="p-4 lg:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3.5 lg:space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 lg:gap-4">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              {t.customers.title}
            </h1>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.customers.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsAddCustomerOpen(true)}
            className="flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            <UserPlus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
            <span>{t.customers.addCustomer}</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative pt-2 border-t border-slate-100 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-[calc(0.5rem+22px)] lg:top-5 -translate-y-1/2 lg:translate-y-0 pointer-events-none" />
          <input
            type="text"
            placeholder={t.customers.searchPlaceholder}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Explicit Loading / Error / Empty / Data Table States */}
      {showLoadingState ? (
        <div
          aria-busy="true"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-3 shadow-xs"
        >
          {[0, 1, 2, 3].map(idx => (
            <div
              key={idx}
              className="flex items-center justify-between gap-4 p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-36 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-2.5 w-24 rounded bg-slate-200/70 dark:bg-slate-800" />
                </div>
              </div>
              <div className="h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      ) : showPermissionError ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-800/70 p-6 lg:p-10 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100">
            {isEs ? 'Acceso restringido' : 'Access Restricted'}
          </h2>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {liveDataError}
          </p>
        </div>
      ) : showConnectionError ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800/70 p-6 lg:p-10 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100">
            {isEs ? 'No pudimos cargar los clientes' : 'Unable to load customers'}
          </h2>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {liveDataError}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={reloadLiveAppointments}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold transition-colors"
            >
              <RefreshCw className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{isEs ? 'Reintentar' : 'Retry'}</span>
            </button>
          </div>
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 lg:p-12 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" />
          </div>
          <h2 className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100">
            {t.customers.emptyTitle}
          </h2>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {t.customers.emptyDesc}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsAddCustomerOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors"
            >
              <UserPlus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>{t.customers.addCustomer}</span>
            </button>
          </div>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 lg:p-12 text-center space-y-3 shadow-xs">
          <p className="text-base lg:text-sm font-bold text-slate-900 dark:text-slate-100">
            {t.customers.filteredEmptyTitle}
          </p>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t.customers.filteredEmptyDesc}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
            >
              {t.customers.clearSearch}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-transparent lg:bg-white lg:dark:bg-slate-900 rounded-2xl lg:border border-slate-200/80 dark:border-slate-800 overflow-hidden lg:shadow-xs">
          <div className="lg:overflow-x-auto">
            <table className="w-full text-left text-sm lg:text-xs block lg:table">
              <thead className="hidden lg:table-header-group bg-slate-50/70 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">{t.customers.name}</th>
                  <th className="px-5 py-3.5">{t.customers.contact}</th>
                  <th className="px-5 py-3.5">{t.customers.preferredLang}</th>
                  <th className="px-5 py-3.5 text-center">{t.customers.totalBookings}</th>
                  <th className="px-5 py-3.5">{t.customers.notes}</th>
                  <th className="px-5 py-3.5 text-right">{t.customers.actions}</th>
                </tr>
              </thead>
              <tbody className="block lg:table-row-group divide-y-0 lg:divide-y divide-slate-100 dark:divide-slate-800 space-y-3 lg:space-y-0">
                {filteredCustomers.map(cust => {
                  const displayName = getCustomerDisplayName(cust);
                  return (
                    <tr
                      key={cust.id}
                      onClick={() => handleOpenProfile(cust)}
                      className="grid grid-cols-[1fr_auto] lg:table-row items-center gap-x-3 gap-y-2 p-4 lg:p-0 bg-white dark:bg-slate-900 rounded-2xl lg:rounded-none border lg:border-0 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 cursor-pointer transition-colors shadow-xs lg:shadow-none"
                    >
                      <td className="col-span-2 lg:col-span-1 lg:px-5 lg:py-4 min-w-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 lg:w-8 lg:h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/50 flex items-center justify-center text-sm lg:text-xs font-bold text-indigo-700 dark:text-indigo-400 shrink-0">
                            {getCustomerInitial(cust)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 dark:text-slate-100 truncate">{displayName}</p>
                            <p className="text-xs lg:text-[11px] text-slate-400 truncate">{cust.email || '—'}</p>
                          </div>
                        </div>
                      </td>

                      <td className="lg:px-5 lg:py-4 whitespace-nowrap font-mono tabular-nums text-sm lg:text-xs text-slate-700 dark:text-slate-300">
                        {cust.phone || '—'}
                      </td>

                      <td className="justify-self-end lg:justify-self-auto lg:px-5 lg:py-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-xs lg:text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 uppercase">
                          {cust.preferredLanguage === 'es' ? t.customers.langEs : t.customers.langEn}
                        </span>
                      </td>

                      <td className="lg:px-5 lg:py-4 whitespace-nowrap lg:text-center font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {cust.totalAppointments || 0}
                      </td>

                      <td className="col-span-2 lg:col-span-1 lg:px-5 lg:py-4 lg:max-w-xs truncate text-sm lg:text-xs text-slate-500">
                        {cust.notes || <span className="text-slate-300 italic">—</span>}
                      </td>

                      <td className="justify-self-end lg:justify-self-auto lg:px-5 lg:py-4 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleOpenProfile(cust)}
                          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <ChevronRight className="w-5 h-5 lg:w-4 lg:h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 lg:mt-0 px-4 lg:px-5 py-3 rounded-2xl lg:rounded-none bg-white dark:bg-slate-900 border lg:border-0 lg:border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-400 tabular-nums">
            {t.customers.totalCount.replace('{count}', String(filteredCustomers.length))}
          </div>
        </div>
      )}

      {/* Customer Profile Slide-over Drawer */}
      {selectedCustomer && (
        <>
          <div
            onClick={() => setSelectedCustomer(null)}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs"
          />

          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-full sm:max-w-md h-dvh bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="p-4 lg:p-6 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  {getCustomerInitial(selectedCustomer)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                    {getCustomerDisplayName(selectedCustomer)}
                  </h2>
                  <p className="text-xs text-slate-500 font-mono tabular-nums truncate">
                    {selectedCustomer.phone || '—'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-5 lg:space-y-6">
              <div className="grid grid-cols-2 gap-3 text-sm lg:text-xs p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800">
                <div>
                  <span className="text-slate-400 text-xs lg:text-[11px] block">{t.customers.preferredLang}</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedCustomer.preferredLanguage === 'es' ? t.customers.langEs : t.customers.langEn}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-xs lg:text-[11px] block">{t.customers.totalBookings}</span>
                  <span className="font-mono tabular-nums font-bold text-indigo-600 dark:text-indigo-400">
                    {selectedCustomer.totalAppointments || 0}
                  </span>
                </div>
                <div className="col-span-2 pt-2 border-t border-slate-200/50 dark:border-slate-700 min-w-0">
                  <span className="text-slate-400 text-xs lg:text-[11px] block">{t.customers.email}</span>
                  <span className="text-slate-700 dark:text-slate-300 font-mono break-all">
                    {selectedCustomer.email || '—'}
                  </span>
                </div>
                {selectedCustomer.address && (
                  <div className="col-span-2 pt-2 border-t border-slate-200/50 dark:border-slate-700 min-w-0">
                    <span className="text-slate-400 text-xs lg:text-[11px] block">{t.appointment.address}</span>
                    <span className="text-slate-700 dark:text-slate-300">{selectedCustomer.address}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {t.customers.notes}
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveNotes}
                    className="inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-0 px-3 lg:px-0 text-sm lg:text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                  >
                    <Save className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                    <span>{t.common.save}</span>
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder={t.bookingModal.notesPlaceholder}
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-base lg:text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {t.customers.pastBookings}
                </h4>

                {customerAppointments.length === 0 ? (
                  <p className="text-sm lg:text-xs text-slate-400 italic">{t.customers.noBookingsYet}</p>
                ) : (
                  <div className="space-y-2">
                    {customerAppointments.map(apt => (
                      <div
                        key={apt.id}
                        onClick={() => {
                          setSelectedCustomer(null);
                          setSelectedAppointmentForDetail(apt);
                        }}
                        className="p-3.5 lg:p-3 min-h-[44px] rounded-xl border border-slate-200/80 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 text-sm lg:text-xs cursor-pointer bg-white dark:bg-slate-900 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                            {apt.serviceName || t.appointment.service}
                          </p>
                          <p className="text-xs lg:text-[11px] font-mono tabular-nums text-slate-400">
                            {apt.date} @ {apt.startTime} · {apt.status}
                          </p>
                        </div>
                        <span className="font-mono tabular-nums font-bold text-slate-700 dark:text-slate-300 shrink-0">
                          {currentTenant.currencySymbol}
                          {(Number(apt.price) || 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 lg:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-6 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => {
                  setSelectedCustomer(null);
                  setIsNewBookingModalOpen(true);
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs transition-colors"
              >
                <Calendar className="w-4 h-4" />
                <span>{t.customers.bookAppointment}</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add Customer Modal */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full sm:max-w-md max-h-[92dvh] bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 lg:p-5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.customers.newCustomerTitle}
                </h3>
                <p className="text-sm lg:text-xs text-slate-500 mt-0.5 leading-relaxed">{t.customers.newCustomerDesc}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddCustomerOpen(false)}
                className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
              >
                <X className="w-5 h-5 lg:w-4 lg:h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto p-4 lg:p-5 space-y-4">
                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.customers.fullName} *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. David Miller"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.customers.phone} *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+1 (732) 555-0199"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.customers.preferredLang}
                    </label>
                    <select
                      value={custLanguage}
                      onChange={e => setCustLanguage(e.target.value as Language)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium focus:outline-none"
                    >
                      <option value="en">English (EN)</option>
                      <option value="es">Español (ES)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.customers.email}
                    </label>
                    <input
                      type="email"
                      placeholder="david@gmail.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.customers.addressOptional}
                  </label>
                  <input
                    type="text"
                    placeholder="Street, City, Zip"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.customers.clientNotes}
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Preferences, allergies..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium focus:outline-none resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 p-4 lg:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAddCustomerOpen(false)}
                  className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm lg:text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
                >
                  {t.customers.saveCustomer}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
