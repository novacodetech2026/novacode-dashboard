import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, 
  Search, 
  Check, 
  Clock, 
  Building, 
  Home, 
  Globe,
  AlertCircle, 
  ArrowRight, 
  ArrowLeft,
  RefreshCw
} from 'lucide-react';
import { LocationType, Language } from '../types';
import { checkAvailabilityInSupabase, isValidUuid } from '../services/supabase';
import { getDateStringInTimezone, formatMinutesToTime, parseTimeToMinutes } from '../utils/dateTime';
import {
  generateBookingTimeSlots,
  validateBookingWindow,
  formatBookingValidationError,
} from '../utils/scheduling';
import { sanitizeErrorForBusiness } from '../utils/security';

interface NewAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewAppointmentModal: React.FC<NewAppointmentModalProps> = ({ isOpen, onClose }) => {
  const { 
    t, 
    language, 
    mode,
    currentTenant, 
    customers, 
    services, 
    staff, 
    appointments = [],
    addAppointment, 
    addCustomer,
    isBookingConflict 
  } = useApp();

  // Wizard Step (1 to 5)
  const [step, setStep] = useState<number>(1);

  // Step 1: Client
  const [isCreatingNewClient, setIsCreatingNewClient] = useState<boolean>(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [clientSearchQuery, setClientSearchQuery] = useState<string>('');
  const [newClientName, setNewClientName] = useState<string>('');
  const [newClientPhone, setNewClientPhone] = useState<string>('');
  const [newClientEmail, setNewClientEmail] = useState<string>('');
  const [newClientLanguage, setNewClientLanguage] = useState<Language>(currentTenant.defaultLanguage || 'en');
  const [newClientAddress, setNewClientAddress] = useState<string>('');

  // Step 2: Service
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');

  // Step 3: Date, Time & Staff
  const todayStr = getDateStringInTimezone(new Date(), currentTenant.timezone);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');

  // Step 4: Location & Address
  const initialLocationType: LocationType =
    Array.isArray(currentTenant.settings?.locationTypes) && currentTenant.settings.locationTypes.length > 0
      ? currentTenant.settings.locationTypes[0]
      : 'in_business';
  const [locationType, setLocationType] = useState<LocationType>(initialLocationType);
  const [atHomeAddress, setAtHomeAddress] = useState<string>('');
  const [appointmentNotes, setAppointmentNotes] = useState<string>('');

  // Error validation message & in-flight state
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const prevIsOpenRef = useRef(isOpen);
  const prevTenantIdRef = useRef(currentTenant.id);

  // Reset wizard fields cleanly whenever modal opens/closes or active tenant changes
  useEffect(() => {
    const isOpening = !prevIsOpenRef.current && isOpen;
    const isClosing = prevIsOpenRef.current && !isOpen;
    const tenantChanged = prevTenantIdRef.current !== currentTenant.id;
    prevIsOpenRef.current = isOpen;
    prevTenantIdRef.current = currentTenant.id;

    if (isOpening || isClosing || tenantChanged) {
      const defaultLoc: LocationType =
        Array.isArray(currentTenant.settings?.locationTypes) && currentTenant.settings.locationTypes.length > 0
          ? currentTenant.settings.locationTypes[0]
          : 'in_business';
      setStep(1);
      setIsCreatingNewClient(false);
      setSelectedCustomerId('');
      setClientSearchQuery('');
      setNewClientName('');
      setNewClientPhone('');
      setNewClientEmail('');
      setNewClientLanguage(currentTenant.defaultLanguage || 'en');
      setNewClientAddress('');
      setSelectedServiceId('');
      setSelectedDate(getDateStringInTimezone(new Date(), currentTenant.timezone));
      setSelectedTime('');
      setSelectedStaffId('');
      setLocationType(defaultLoc);
      setAtHomeAddress('');
      setAppointmentNotes('');
      setValidationError(null);
      setIsSubmitting(false);
    }
  }, [
    isOpen,
    currentTenant.id,
    currentTenant.defaultLanguage,
    currentTenant.timezone,
    currentTenant.settings?.locationTypes,
  ]);

  // Selected Service object
  const selectedService = services.find(s => s.id === selectedServiceId);

  // Compute permitted location options based on tenant settings and selected service
  const locationAvailability = useMemo(() => {
    const tenantTypes = currentTenant.settings?.locationTypes;
    const hasExplicitTenantTypes = Array.isArray(tenantTypes) && tenantTypes.length > 0;
    let inBusiness =
      (selectedService ? selectedService.allowsInBusiness !== false : true) &&
      (!hasExplicitTenantTypes || tenantTypes.includes('in_business'));
    const atHome =
      (selectedService ? selectedService.allowsAtHome !== false : true) &&
      (!hasExplicitTenantTypes || tenantTypes.includes('at_home'));
    const online = hasExplicitTenantTypes && tenantTypes.includes('online');

    if (!inBusiness && !atHome && !online) {
      inBusiness = true;
    }

    const allowed: LocationType[] = [];
    if (inBusiness) allowed.push('in_business');
    if (atHome) allowed.push('at_home');
    if (online) allowed.push('online');

    return { inBusiness, atHome, online, allowed };
  }, [currentTenant.settings?.locationTypes, selectedService]);

  // Keep selected locationType valid when service or tenant configuration changes
  useEffect(() => {
    if (!locationAvailability.allowed.includes(locationType)) {
      setLocationType(locationAvailability.allowed[0] || 'in_business');
    }
  }, [locationAvailability, locationType]);

  // Dynamic Time Slots generator based on operating hours, special holiday hours, timezone & buffer
  const slotAnalysis = useMemo(() => {
    return generateBookingTimeSlots({
      tenant: currentTenant,
      date: selectedDate,
      durationMinutes: selectedService?.durationMinutes || 60,
      appointments,
      staffId: selectedStaffId || undefined,
    });
  }, [currentTenant, selectedDate, selectedService?.durationMinutes, appointments, selectedStaffId]);

  // Auto-select first valid slot whenever date, service, or staff changes (only during steps 1-3)
  useEffect(() => {
    if (!isOpen || step > 3) return;
    const duration = selectedService?.durationMinutes || 60;
    const firstValid = slotAnalysis.slots.find(
      s => s.isAvailable && !isBookingConflict(selectedDate, s.time, duration, selectedStaffId || undefined)
    );
    const currentStillValid = slotAnalysis.slots.some(
      s =>
        s.time === selectedTime &&
        s.isAvailable &&
        !isBookingConflict(selectedDate, s.time, duration, selectedStaffId || undefined)
    );

    if (!currentStillValid) {
      setSelectedTime(firstValid ? firstValid.time : '');
    }
  }, [
    isOpen,
    step,
    slotAnalysis.slots,
    selectedDate,
    selectedTime,
    selectedService?.durationMinutes,
    selectedStaffId,
    isBookingConflict,
  ]);

  if (!isOpen) return null;

  // Active bookable services only
  const activeServices = services.filter(s => s.active);
  // Selected Customer object
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  // Selected Staff object
  const selectedStaff = staff.find(st => st.id === selectedStaffId);

  // Filtered customer list
  const filteredCustomers = customers.filter(c =>
    (c.name || '').toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
    (c.phone || '').includes(clientSearchQuery)
  );

  const handleNext = async () => {
    if (isSubmitting) return;
    setValidationError(null);

    if (step === 1) {
      if (isCreatingNewClient) {
        if (!newClientName.trim() || !newClientPhone.trim()) {
          setValidationError(language === 'es' ? 'Nombre y teléfono son obligatorios.' : 'Name and phone are required.');
          return;
        }
        try {
          setIsSubmitting(true);
          const created = await addCustomer({
            name: newClientName.trim(),
            phone: newClientPhone.trim(),
            email: newClientEmail.trim(),
            preferredLanguage: newClientLanguage,
            address: newClientAddress.trim(),
          });
          if (mode === 'supabase' && !isValidUuid(created.id)) {
            setValidationError(
              language === 'es'
                ? 'No pudimos guardar el perfil del cliente. Inténtalo nuevamente.'
                : 'Unable to save customer profile right now. Please try again.'
            );
            return;
          }
          setSelectedCustomerId(created.id);
          if (newClientAddress.trim()) {
            setAtHomeAddress(newClientAddress.trim());
          }
        } catch (err: unknown) {
          setValidationError(sanitizeErrorForBusiness(err, language).userMessage);
          return;
        } finally {
          setIsSubmitting(false);
        }
      } else {
        if (!selectedCustomerId) {
          setValidationError(t.bookingModal.selectClientError);
          return;
        }
        const cust = customers.find(c => c.id === selectedCustomerId);
        if (!cust) {
          setValidationError(t.bookingModal.selectClientError);
          return;
        }
        if (mode === 'supabase' && !isValidUuid(cust.id)) {
          setValidationError(
            language === 'es'
              ? 'Selecciona un cliente válido antes de continuar.'
              : 'Please select a valid customer profile before booking.'
          );
          return;
        }
        if (cust.address) {
          setAtHomeAddress(cust.address);
        }
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!selectedServiceId || !selectedService) {
        setValidationError(t.bookingModal.selectServiceError);
        return;
      }
      if (!selectedService.active) {
        setValidationError(t.services.inactiveBookError);
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      if (slotAnalysis.effectiveHours.isClosed) {
        setValidationError(
          slotAnalysis.effectiveHours.specialLabel
            ? t.bookingModal.closedHolidayNotice
                .replace('{label}', slotAnalysis.effectiveHours.specialLabel)
                .replace('{date}', selectedDate)
            : t.bookingModal.closedDayNotice.replace('{date}', selectedDate)
        );
        return;
      }

      if (!selectedDate || !selectedTime) {
        setValidationError(t.bookingModal.selectTimeError);
        return;
      }

      const duration = selectedService?.durationMinutes || 60;
      const scheduleCheck = validateBookingWindow({
        tenant: currentTenant,
        date: selectedDate,
        startTime: selectedTime,
        durationMinutes: duration,
        appointments,
        staffId: selectedStaffId || undefined,
        service: selectedService,
      });

      if (!scheduleCheck.valid) {
        setValidationError(formatBookingValidationError(scheduleCheck, language));
        return;
      }

      if (isBookingConflict(selectedDate, selectedTime, duration, selectedStaffId || undefined)) {
        setValidationError(t.bookingModal.conflictError);
        return;
      }

      if (mode === 'supabase' && selectedService) {
        setIsSubmitting(true);
        try {
          const availability = await checkAvailabilityInSupabase({
            businessId: currentTenant.id,
            serviceId: selectedService.id,
            date: selectedDate,
            startTime: selectedTime,
            timezone: currentTenant.timezone,
          });

          if (availability.error) {
            setValidationError(sanitizeErrorForBusiness(availability.error, language).userMessage);
            return;
          }

          if (!availability.available) {
            setValidationError(t.bookingModal.conflictError);
            return;
          }
        } finally {
          setIsSubmitting(false);
        }
      }

      setStep(4);
      return;
    }

    if (step === 4) {
      if (locationType === 'at_home' && !atHomeAddress.trim()) {
        setValidationError(t.bookingModal.selectLocationError);
        return;
      }
      setStep(5);
      return;
    }

    if (step === 5) {
      await handleFinalBooking();
    }
  };

  const handleFinalBooking = async () => {
    if (isSubmitting || !selectedService) return;
    if (!selectedService.active) {
      setValidationError(t.services.inactiveBookError);
      return;
    }

    const endTotalMins = parseTimeToMinutes(selectedTime) + selectedService.durationMinutes;
    const endTime = formatMinutesToTime(endTotalMins);

    const cust = selectedCustomer || customers.find(c => c.id === selectedCustomerId);
    const serviceDisplayName =
      language === 'es'
        ? selectedService.nameEs || selectedService.nameEn
        : selectedService.nameEn || selectedService.nameEs;

    setIsSubmitting(true);
    try {
      const result = await addAppointment({
        customerId: selectedCustomerId,
        customerName: cust?.name || newClientName,
        customerPhone: cust?.phone || newClientPhone,
        customerLanguage: cust?.preferredLanguage || newClientLanguage,
        serviceId: selectedService.id,
        serviceName: serviceDisplayName,
        staffId: selectedStaffId || undefined,
        staffName: selectedStaff?.name || undefined,
        date: selectedDate,
        startTime: selectedTime,
        endTime,
        durationMinutes: selectedService.durationMinutes,
        price: selectedService.price,
        locationType,
        address: locationType === 'at_home' ? atHomeAddress : undefined,
        status: 'pending',
        notes: appointmentNotes,
        source: 'manual_dashboard',
      });

      if (result.success) {
        onClose();
      } else {
        setValidationError(result.error || (language === 'es' ? 'Error al crear la cita' : 'Booking error'));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (language === 'es' ? 'Error al crear la cita' : 'Booking error');
      setValidationError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
      <div className="w-full sm:max-w-2xl bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden">
        {/* Wizard Header */}
        <div className="p-4 lg:p-6 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {t.bookingModal.stepProgress.replace('{step}', String(step))}
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-xs text-slate-500 font-medium truncate">
                {currentTenant.name}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              {step === 1 && t.bookingModal.step1Title}
              {step === 2 && t.bookingModal.step2Title}
              {step === 3 && t.bookingModal.step3Title}
              {step === 4 && t.bookingModal.step4Title}
              {step === 5 && t.bookingModal.step5Title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress Line */}
        <div className="h-1 bg-slate-100 dark:bg-slate-800 w-full flex shrink-0">
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-300"
            style={{ width: `${(step / 5) * 100}%` }}
          />
        </div>

        {/* Wizard Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-5">
          {validationError && (
            <div className="flex items-start justify-between gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm lg:text-xs animate-in fade-in">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words whitespace-pre-wrap min-w-0">{validationError}</span>
              </div>
              {step === 5 && (
                <button
                  type="button"
                  onClick={() => {
                    setValidationError(null);
                    setStep(3);
                  }}
                  className="shrink-0 min-h-[36px] px-2.5 py-1 rounded-lg bg-rose-100 dark:bg-rose-900/50 hover:bg-rose-200 dark:hover:bg-rose-900 text-rose-800 dark:text-rose-200 text-xs font-semibold transition-colors"
                >
                  {language === 'es' ? 'Cambiar horario' : 'Change Time'}
                </button>
              )}
            </div>
          )}

          {/* STEP 1: CLIENT SELECTION */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setIsCreatingNewClient(false)}
                  className={`flex-1 min-h-[44px] lg:min-h-0 py-2 text-sm lg:text-xs font-semibold rounded-lg transition-all ${
                    !isCreatingNewClient
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {t.bookingModal.existingClient}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingNewClient(true)}
                  className={`flex-1 min-h-[44px] lg:min-h-0 py-2 text-sm lg:text-xs font-semibold rounded-lg transition-all ${
                    isCreatingNewClient
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {t.bookingModal.newClient}
                </button>
              </div>

              {!isCreatingNewClient ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 lg:top-3" />
                    <input
                      type="text"
                      placeholder={t.bookingModal.searchClient}
                      value={clientSearchQuery}
                      onChange={e => setClientSearchQuery(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-1.5 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-2">
                    {filteredCustomers.length === 0 ? (
                      <p className="text-center py-6 text-sm lg:text-xs text-slate-400">
                        {t.customers.emptyDesc}
                      </p>
                    ) : (
                      filteredCustomers.map(cust => (
                        <button
                          key={cust.id}
                          type="button"
                          onClick={() => setSelectedCustomerId(cust.id)}
                          className={`w-full min-h-[44px] lg:min-h-0 flex items-center justify-between p-3 rounded-xl text-left text-sm lg:text-xs transition-colors ${
                            selectedCustomerId === cust.id
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-transparent'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {cust.name}
                            </p>
                            <p className="text-xs lg:text-[11px] text-slate-500 font-mono truncate">
                              {cust.phone} · {cust.preferredLanguage.toUpperCase()}
                            </p>
                          </div>
                          {selectedCustomerId === cust.id && (
                            <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.customers.fullName} *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Maria Gonzalez"
                      value={newClientName}
                      onChange={e => setNewClientName(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.customers.phone} *
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="+1 (555) 000-0000"
                      value={newClientPhone}
                      onChange={e => setNewClientPhone(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {t.customers.preferredLang}
                      </label>
                      <select
                        value={newClientLanguage}
                        onChange={e => setNewClientLanguage(e.target.value as Language)}
                        className="w-full min-h-[44px] lg:min-h-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="en">English</option>
                        <option value="es">Español</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {t.customers.email}
                      </label>
                      <input
                        type="email"
                        placeholder="client@gmail.com"
                        value={newClientEmail}
                        onChange={e => setNewClientEmail(e.target.value)}
                        className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.customers.addressOptional}
                    </label>
                    <input
                      type="text"
                      placeholder="123 Main St, Apt 4"
                      value={newClientAddress}
                      onChange={e => setNewClientAddress(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: SERVICE SELECTION */}
          {step === 2 && (
            <div className="space-y-3">
              {activeServices.length === 0 ? (
                <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-center text-sm lg:text-xs text-slate-500 dark:text-slate-400">
                  {t.services.noActiveServicesToBook}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeServices.map(svc => {
                    const isSelected = selectedServiceId === svc.id;
                    const name = language === 'es' ? (svc.nameEs || svc.nameEn) : (svc.nameEn || svc.nameEs);
                    const desc =
                      language === 'es'
                        ? svc.descriptionEs || svc.descriptionEn
                        : svc.descriptionEn || svc.descriptionEs;

                    return (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={() => setSelectedServiceId(svc.id)}
                        className={`p-4 rounded-2xl text-left border transition-all min-w-0 ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 shadow-sm ring-1 ring-indigo-500'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 break-words min-w-0">
                            {name}
                          </span>
                          <span className="text-sm lg:text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400 shrink-0">
                            {currentTenant.currencySymbol}{svc.price.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 break-words">
                          {desc}
                        </p>
                        <div className="flex items-center gap-3 text-xs lg:text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {svc.durationMinutes} {t.appointment.minutes}
                          </span>
                          <span>·</span>
                          <span className="truncate">{svc.category}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: DATE, TIME & STAFF */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.bookingModal.dateLabel}
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    min={todayStr}
                    onChange={e => setSelectedDate(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.bookingModal.staffLabel}
                  </label>
                  <select
                    value={selectedStaffId}
                    onChange={e => setSelectedStaffId(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">{t.bookingModal.anyStaff}</option>
                    {staff.map(st => (
                      <option key={st.id} value={st.id}>
                        {st.name} ({language === 'es' ? st.roleEs : st.roleEn})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs lg:text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-medium">
                  {slotAnalysis.effectiveHours.isClosed
                    ? slotAnalysis.effectiveHours.specialLabel
                      ? t.bookingModal.closedHolidayNotice
                          .replace('{label}', slotAnalysis.effectiveHours.specialLabel)
                          .replace('{date}', selectedDate)
                      : t.bookingModal.closedDayNotice.replace('{date}', selectedDate)
                    : slotAnalysis.effectiveHours.isSpecialHours && slotAnalysis.effectiveHours.specialLabel
                    ? t.bookingModal.specialHoursNotice
                        .replace('{label}', slotAnalysis.effectiveHours.specialLabel)
                        .replace('{open}', slotAnalysis.effectiveHours.open)
                        .replace('{close}', slotAnalysis.effectiveHours.close)
                    : t.bookingModal.operatingHoursInfo
                        .replace('{tz}', currentTenant.timezone)
                        .replace('{open}', slotAnalysis.effectiveHours.open)
                        .replace('{close}', slotAnalysis.effectiveHours.close)}
                </span>
                {(currentTenant.settings?.bufferBetweenAppointmentsMinutes || 0) > 0 && (
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">
                    {t.bookingModal.bufferNotice.replace(
                      '{minutes}',
                      String(currentTenant.settings.bufferBetweenAppointmentsMinutes)
                    )}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  {t.bookingModal.timeSlotLabel}
                </label>
                {slotAnalysis.effectiveHours.isClosed ? (
                  <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm lg:text-xs text-amber-800 dark:text-amber-200">
                    {slotAnalysis.effectiveHours.specialLabel
                      ? t.bookingModal.closedHolidayNotice
                          .replace('{label}', slotAnalysis.effectiveHours.specialLabel)
                          .replace('{date}', selectedDate)
                      : t.bookingModal.closedDayNotice.replace('{date}', selectedDate)}
                  </div>
                ) : slotAnalysis.slots.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-sm lg:text-xs text-slate-500 dark:text-slate-400">
                    {t.bookingModal.noSlotsAvailable}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {slotAnalysis.slots.map(slot => {
                      const isSelected = selectedTime === slot.time;
                      const duration = selectedService?.durationMinutes || 60;
                      const hasConflict =
                        !slot.isAvailable ||
                        isBookingConflict(selectedDate, slot.time, duration, selectedStaffId || undefined);

                      const disabledTitle =
                        slot.status === 'buffer'
                          ? t.bookingModal.bufferConflictError.replace(
                              '{minutes}',
                              String(currentTenant.settings?.bufferBetweenAppointmentsMinutes || 0)
                            )
                          : slot.status === 'conflict'
                          ? t.bookingModal.conflictError
                          : undefined;

                      return (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={hasConflict}
                          title={disabledTitle}
                          onClick={() => {
                            setValidationError(null);
                            setSelectedTime(slot.time);
                          }}
                          className={`min-h-[44px] lg:min-h-0 py-2 px-2 text-sm lg:text-xs font-mono font-medium rounded-xl border transition-all ${
                            hasConflict
                              ? 'opacity-30 border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 cursor-not-allowed line-through'
                              : isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                              : 'border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {slot.time}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: LOCATION & ADDRESS */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {locationAvailability.inBusiness && (
                  <button
                    type="button"
                    onClick={() => setLocationType('in_business')}
                    className={`p-4 rounded-2xl text-left border transition-all min-w-0 ${
                      locationType === 'in_business'
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-2">
                      <Building className="w-4 h-4" />
                    </div>
                    <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                      {t.bookingModal.inBusinessOption}
                    </p>
                    <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {t.bookingModal.inBusinessDesc}
                    </p>
                    {currentTenant.address && (
                      <p className="text-xs lg:text-[11px] text-indigo-600 dark:text-indigo-400 font-medium mt-2 break-words">
                        📍 {currentTenant.address}
                      </p>
                    )}
                  </button>
                )}

                {locationAvailability.atHome && (
                  <button
                    type="button"
                    onClick={() => setLocationType('at_home')}
                    className={`p-4 rounded-2xl text-left border transition-all min-w-0 ${
                      locationType === 'at_home'
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-2">
                      <Home className="w-4 h-4" />
                    </div>
                    <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                      {t.bookingModal.atHomeOption}
                    </p>
                    <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {t.bookingModal.atHomeDesc}
                    </p>
                  </button>
                )}

                {locationAvailability.online && (
                  <button
                    type="button"
                    onClick={() => setLocationType('online')}
                    className={`p-4 rounded-2xl text-left border transition-all min-w-0 ${
                      locationType === 'online'
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-950 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-2">
                      <Globe className="w-4 h-4" />
                    </div>
                    <p className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                      {t.settings.locationOnline}
                    </p>
                    <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {language === 'es' ? 'Sesión remota por videollamada o enlace en línea' : 'Remote session via video call or online link'}
                    </p>
                  </button>
                )}
              </div>

              {locationType === 'at_home' && (
                <div className="space-y-1.5 animate-in fade-in">
                  <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.bookingModal.enterAddress} *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 74 Ocean Crest Way, Apt 4B, Asbury Park, NJ"
                    value={atHomeAddress}
                    onChange={e => setAtHomeAddress(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.bookingModal.notesOptional}
                </label>
                <textarea
                  rows={2}
                  placeholder={t.bookingModal.notesPlaceholder}
                  value={appointmentNotes}
                  onChange={e => setAppointmentNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW & CONFIRM */}
          {step === 5 && selectedService && (
            <div className="space-y-4">
              <div className="p-4 lg:p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/60 dark:border-slate-700">
                  <span className="text-sm lg:text-xs text-slate-500 shrink-0">{t.bookingModal.summaryClient}</span>
                  <span className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 text-right break-words min-w-0">
                    {selectedCustomer?.name || newClientName}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/60 dark:border-slate-700">
                  <span className="text-sm lg:text-xs text-slate-500 shrink-0">{t.bookingModal.summaryService}</span>
                  <span className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100 text-right break-words min-w-0">
                    {language === 'es'
                      ? selectedService.nameEs || selectedService.nameEn
                      : selectedService.nameEn || selectedService.nameEs}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/60 dark:border-slate-700">
                  <span className="text-sm lg:text-xs text-slate-500 shrink-0">{t.bookingModal.summaryDateTime}</span>
                  <span className="text-sm lg:text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 text-right break-words min-w-0">
                    {selectedDate} @ {selectedTime} ({selectedService.durationMinutes} min)
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/60 dark:border-slate-700">
                  <span className="text-sm lg:text-xs text-slate-500 shrink-0">{t.bookingModal.summaryStaff}</span>
                  <span className="text-sm lg:text-xs font-medium text-slate-900 dark:text-slate-100 text-right break-words min-w-0">
                    {selectedStaff?.name || t.bookingModal.anyStaff}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/60 dark:border-slate-700">
                  <span className="text-sm lg:text-xs text-slate-500 shrink-0">{t.bookingModal.summaryLocation}</span>
                  <span className="text-sm lg:text-xs font-medium text-slate-900 dark:text-slate-100 text-right break-words min-w-0">
                    {locationType === 'at_home'
                      ? `${t.appointment.atHome} (${atHomeAddress})`
                      : locationType === 'online'
                      ? t.settings.locationOnline
                      : t.appointment.inBusiness}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-sm lg:text-xs font-bold text-slate-900 dark:text-slate-100">
                    {t.bookingModal.summaryTotal}
                  </span>
                  <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {currentTenant.currencySymbol}{selectedService.price.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="p-4 lg:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-6 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-3 shrink-0">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(prev => prev - 1)}
              className="min-h-[44px] lg:min-h-0 flex items-center gap-1.5 px-4 py-2.5 lg:py-2 rounded-xl text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.bookingModal.btnBack}</span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleNext}
            className="min-h-[44px] lg:min-h-0 flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-sm shadow-indigo-600/25 active:scale-[0.98] transition-all"
          >
            {isSubmitting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <span>{step === 5 ? t.bookingModal.btnConfirm : t.bookingModal.btnNext}</span>
                {step < 5 && <ArrowRight className="w-3.5 h-3.5" />}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
