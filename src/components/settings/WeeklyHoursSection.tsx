import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { BusinessHours } from '../../types';
import {
  Globe,
  CopyCheck,
  Pencil,
  RotateCcw,
  Save,
  AlertCircle,
  X,
} from 'lucide-react';

const SUNDAY_TO_SATURDAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;

export const WeeklyHoursSection: React.FC = () => {
  const { t, language, currentTenant, saveWeeklyBusinessHours, addToast } = useApp();
  const isEs = language === 'es';

  const savedHours = currentTenant.settings?.operatingHours || {};
  const isMigrated = Boolean(currentTenant.settings?.operatingHoursMigrated);
  const hasAnyConfiguredDay = SUNDAY_TO_SATURDAY_ORDER.some(dow => Boolean(savedHours[dow]));

  const [draftHours, setDraftHours] = useState<Record<number, BusinessHours>>(savedHours);
  const [isEditing, setIsEditing] = useState<boolean>(!hasAnyConfiguredDay);
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const nextSaved = currentTenant.settings?.operatingHours || {};
    const anyConfigured = SUNDAY_TO_SATURDAY_ORDER.some(dow => Boolean(nextSaved[dow]));
    setDraftHours(nextSaved);
    setIsEditing(!anyConfigured);
    setValidationError(null);
  }, [currentTenant.id, currentTenant.settings?.operatingHours]);

  const handleToggleDayOpen = (dayIndex: number) => {
    setValidationError(null);
    setDraftHours(prev => {
      const existing = prev[dayIndex];
      if (!existing || existing.isClosed) {
        return {
          ...prev,
          [dayIndex]: {
            open: existing?.open || '',
            close: existing?.close || '',
            isClosed: false,
          },
        };
      }
      return {
        ...prev,
        [dayIndex]: {
          open: existing.open || '',
          close: existing.close || '',
          isClosed: true,
        },
      };
    });
  };

  const handleTimeChange = (dayIndex: number, field: 'open' | 'close', value: string) => {
    setValidationError(null);
    setDraftHours(prev => {
      const current = prev[dayIndex] || { open: '', close: '', isClosed: false };
      return {
        ...prev,
        [dayIndex]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleClearDay = (dayIndex: number) => {
    setValidationError(null);
    setDraftHours(prev => {
      const next = { ...prev };
      delete next[dayIndex];
      return next;
    });
  };

  const handleCopyMondayToWeekdays = () => {
    const monday = draftHours[1];
    if (!monday) {
      setValidationError(
        isEs
          ? 'Configura primero el horario del lunes antes de copiarlo a entre semana.'
          : 'Configure Monday first before copying to weekdays.'
      );
      return;
    }
    if (!monday.isClosed && (!monday.open || !monday.close || monday.open >= monday.close)) {
      setValidationError(
        isEs
          ? 'El lunes debe tener una hora de apertura anterior al cierre antes de copiarlo.'
          : 'Monday must have a valid opening time earlier than its closing time before copying.'
      );
      return;
    }
    setValidationError(null);
    setDraftHours(prev => ({
      ...prev,
      1: { ...monday },
      2: { ...monday },
      3: { ...monday },
      4: { ...monday },
      5: { ...monday },
    }));
    addToast(
      'info',
      isEs ? 'Horario Aplicado' : 'Schedule Copied',
      isEs ? 'Horario de lunes aplicado de lunes a viernes.' : 'Monday schedule applied to weekdays.'
    );
  };

  const handleReset = () => {
    setDraftHours(savedHours);
    setValidationError(null);
  };

  const handleCancelEdit = () => {
    setDraftHours(savedHours);
    setValidationError(null);
    if (hasAnyConfiguredDay) {
      setIsEditing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setValidationError(null);

    for (const dow of SUNDAY_TO_SATURDAY_ORDER) {
      const entry = draftHours[dow];
      if (!entry || entry.isClosed) continue;
      if (!entry.open || !entry.close || entry.open >= entry.close) {
        const dayLabel = t.days[dow as keyof typeof t.days];
        setValidationError(
          isEs
            ? `El horario de ${dayLabel} debe tener una hora de apertura anterior al cierre.`
            : `${dayLabel} must have an opening time earlier than its closing time.`
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      const res = await saveWeeklyBusinessHours(draftHours);
      if (!res.success) {
        setValidationError(
          res.error || (isEs ? 'No se pudieron guardar los horarios.' : 'Unable to save operating hours.')
        );
        return;
      }
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      noValidate
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-4 lg:space-y-5 shadow-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.settings.operatingHoursTitle}
            </h2>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {isMigrated ? t.settings.hoursMigratedBadge : t.settings.hoursAuthoritativeBadge}
            </span>
          </div>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.settings.operatingHoursDesc}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs lg:text-[11px] font-mono text-slate-600 dark:text-slate-300">
            <Globe className="w-3.5 h-3.5 text-indigo-500" />
            <span>{currentTenant.timezone}</span>
          </span>

          {!isEditing ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 lg:px-3 py-2 lg:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs lg:text-[11px] font-semibold transition-colors whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{t.settings.editHours}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopyMondayToWeekdays}
                className="inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 lg:px-3 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs lg:text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <CopyCheck className="w-3.5 h-3.5 text-indigo-500" />
                <span>{isEs ? 'Copiar Lun a Lun–Vie' : 'Copy Mon to Weekdays'}</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-0 px-3.5 lg:px-3 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs lg:text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>{t.settings.resetHours}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {validationError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-sm lg:text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {!hasAnyConfiguredDay && (
        <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 text-sm lg:text-xs text-amber-800 dark:text-amber-200">
          {isEs
            ? 'Este negocio aún no tiene horarios configurados. Activa los días que abres y define explícitamente la hora de apertura y cierre.'
            : 'No weekly hours are configured yet for this business. Toggle open the days you operate and enter explicit opening and closing times.'}
        </div>
      )}

      <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden">
        {SUNDAY_TO_SATURDAY_ORDER.map(dayIndex => {
          const entry = draftHours[dayIndex];
          const isUnconfigured = !entry;
          const isClosed = isUnconfigured || Boolean(entry.isClosed);

          return (
            <div
              key={dayIndex}
              className="p-3.5 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm lg:text-xs bg-white dark:bg-slate-900"
            >
              <div className="flex items-center justify-between sm:justify-start gap-4 sm:min-w-[200px]">
                <span className="w-24 font-semibold text-slate-800 dark:text-slate-200">
                  {t.days[dayIndex as keyof typeof t.days]}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={!isClosed}
                  disabled={!isEditing}
                  onClick={() => handleToggleDayOpen(dayIndex)}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1 rounded-lg text-xs lg:text-[11px] font-semibold border transition-colors disabled:opacity-70 ${
                    isClosed
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                      : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isClosed ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                  <span>
                    {isUnconfigured
                      ? t.settings.dayUnconfigured
                      : isClosed
                      ? t.settings.dayClosed
                      : t.settings.dayOpen}
                  </span>
                </button>
              </div>

              {!isClosed ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:flex sm:items-center gap-1.5 sm:gap-2 font-mono tabular-nums w-full sm:w-auto min-w-0">
                  <label className="sr-only">{t.settings.openAt}</label>
                  <input
                    type="time"
                    disabled={!isEditing}
                    value={entry?.open || ''}
                    onChange={e => handleTimeChange(dayIndex, 'open', e.target.value)}
                    className="min-w-0 w-full sm:w-auto min-h-[44px] lg:min-h-0 px-2 sm:px-2.5 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-70"
                  />
                  <span className="text-slate-400 self-center">—</span>
                  <label className="sr-only">{t.settings.closeAt}</label>
                  <input
                    type="time"
                    disabled={!isEditing}
                    value={entry?.close || ''}
                    onChange={e => handleTimeChange(dayIndex, 'close', e.target.value)}
                    className="min-w-0 w-full sm:w-auto min-h-[44px] lg:min-h-0 px-2 sm:px-2.5 py-2 lg:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-70"
                  />
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={() => handleClearDay(dayIndex)}
                      title={t.settings.clearDayHours}
                      aria-label={t.settings.clearDayHours}
                      className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center p-2 lg:p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                    >
                      <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                    </button>
                  ) : (
                    <span className="hidden sm:hidden" />
                  )}
                </div>
              ) : (
                <span className="text-xs lg:text-[11px] text-slate-400">
                  {isUnconfigured ? t.settings.dayUnconfigured : t.settings.dayClosed}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {isEditing && (
        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
          {hasAnyConfiguredDay && (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="min-h-[44px] lg:min-h-0 w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm lg:text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
          )}
          <button
            type="submit"
            disabled={isSaving}
            className="min-h-[44px] lg:min-h-0 w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? t.common.loading : t.settings.saveHours}</span>
          </button>
        </div>
      )}
    </form>
  );
};
