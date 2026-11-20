import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { SpecialBusinessHours } from '../../types';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

export const SpecialHoursCalendarSection: React.FC = () => {
  const { t, language, currentTenant, saveSpecialHours } = useApp();
  const isEs = language === 'es';

  const savedSpecialHours = currentTenant.settings?.specialHours || [];
  const [draftSpecialHours, setDraftSpecialHours] = useState<SpecialBusinessHours[]>(savedSpecialHours);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState<number>(today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(today.getMonth()); // 0..11

  const initialSelectedDate = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
  const [selectedDate, setSelectedDate] = useState<string>(initialSelectedDate);
  const [editorClosed, setEditorClosed] = useState<boolean>(true);
  const [editorOpen, setEditorOpen] = useState<string>('10:00');
  const [editorClose, setEditorClose] = useState<string>('16:00');
  const [editorLabel, setEditorLabel] = useState<string>('');

  useEffect(() => {
    setDraftSpecialHours(currentTenant.settings?.specialHours || []);
    setErrorMsg(null);
  }, [currentTenant.id, currentTenant.settings?.specialHours]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, SpecialBusinessHours>();
    for (const item of draftSpecialHours) {
      if (item?.date) map.set(item.date, item);
    }
    return map;
  }, [draftSpecialHours]);

  const selectDateForEditing = (dateStr: string, existing?: SpecialBusinessHours) => {
    setSelectedDate(dateStr);
    setErrorMsg(null);
    if (existing) {
      setEditorClosed(Boolean(existing.isClosed));
      setEditorOpen(existing.isClosed ? '10:00' : existing.open || '10:00');
      setEditorClose(existing.isClosed ? '16:00' : existing.close || '16:00');
      setEditorLabel(existing.label || '');
    } else {
      setEditorClosed(true);
      setEditorOpen('10:00');
      setEditorClose('16:00');
      setEditorLabel('');
    }
  };

  const handleSelectDateClick = (dateStr: string) => {
    const existing = overrideMap.get(dateStr);
    selectDateForEditing(dateStr, existing);
  };

  const handleEditListRow = (item: SpecialBusinessHours) => {
    const [y, m] = item.date.split('-').map(Number);
    if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12) {
      setViewYear(y);
      setViewMonth(m - 1);
    }
    selectDateForEditing(item.date, item);
  };

  const handleApplyDateOverride = () => {
    setErrorMsg(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      setErrorMsg(isEs ? 'Selecciona una fecha válida.' : 'Please select a valid date.');
      return;
    }

    if (!editorClosed && (!editorOpen || !editorClose || editorOpen >= editorClose)) {
      setErrorMsg(
        isEs
          ? 'El horario especial debe tener una hora de apertura anterior al cierre.'
          : 'Special opening hours must have an opening time earlier than closing time.'
      );
      return;
    }

    const trimmedLabel = editorLabel.trim();
    const nextItem: SpecialBusinessHours = editorClosed
      ? {
          date: selectedDate,
          isClosed: true,
          ...(trimmedLabel ? { label: trimmedLabel } : {}),
        }
      : {
          date: selectedDate,
          isClosed: false,
          open: editorOpen,
          close: editorClose,
          ...(trimmedLabel ? { label: trimmedLabel } : {}),
        };

    setDraftSpecialHours(prev =>
      [...prev.filter(item => item.date !== selectedDate), nextItem].sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    );
  };

  const handleRemoveDate = (dateStr: string) => {
    setErrorMsg(null);
    setDraftSpecialHours(prev => prev.filter(item => item.date !== dateStr));
    if (selectedDate === dateStr) {
      setEditorClosed(true);
      setEditorLabel('');
    }
  };

  const handleReset = () => {
    setDraftSpecialHours(savedSpecialHours);
    setErrorMsg(null);
  };

  const handleSave = async () => {
    setErrorMsg(null);
    setIsSaving(true);
    try {
      const res = await saveSpecialHours(draftSpecialHours);
      if (!res.success) {
        setErrorMsg(res.error || (isEs ? 'No se pudieron guardar los horarios especiales.' : 'Unable to save special hours.'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(y => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(y => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun..6=Sat
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ day: number | null; dateStr?: string }> = [];
    for (let i = 0; i < firstDayOfMonth; i += 1) {
      cells.push({ day: null });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push({ day: d, dateStr: toIsoDate(viewYear, viewMonth, d) });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const monthName = t.months[viewMonth] || '';
  const selectedOverride = overrideMap.get(selectedDate);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 lg:p-6 space-y-5 lg:space-y-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>{t.settings.specialHoursTitle}</span>
          </h2>
          <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {t.settings.specialHoursDesc}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <RotateCcw className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
            <span>{t.common.reset}</span>
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white text-sm lg:text-xs font-semibold shadow-xs"
          >
            <Save className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
            <span>{isSaving ? t.common.loading : t.settings.saveSpecialHours}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-sm lg:text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        {/* Monthly Calendar Grid */}
        <div className="lg:col-span-7 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label={isEs ? 'Mes anterior' : 'Previous month'}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="w-5 h-5 lg:w-4 lg:h-4" />
            </button>

            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {monthName} {viewYear}
            </span>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label={isEs ? 'Mes siguiente' : 'Next month'}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <ChevronRight className="w-5 h-5 lg:w-4 lg:h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs lg:text-[11px] font-bold text-slate-400 dark:text-slate-500">
            {t.shortDays.map(dayLabel => (
              <div key={dayLabel} className="py-1">
                {dayLabel}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell, idx) => {
              if (!cell.day || !cell.dateStr) {
                return <div key={`empty-${idx}`} className="h-11 rounded-xl" />;
              }
              const dateStr = cell.dateStr;
              const override = overrideMap.get(dateStr);
              const isSelected = selectedDate === dateStr;

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => handleSelectDateClick(dateStr)}
                  aria-label={dateStr}
                  className={`min-h-[44px] h-11 rounded-xl border flex flex-col items-center justify-center gap-0.5 text-xs font-mono transition-all ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-600 text-white font-bold shadow-xs'
                      : override
                      ? override.isClosed
                        ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-semibold'
                        : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-semibold'
                      : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-700'
                  }`}
                >
                  <span>{cell.day}</span>
                  {override && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected
                          ? 'bg-white'
                          : override.isClosed
                          ? 'bg-rose-500'
                          : 'bg-amber-500'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2 text-xs lg:text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>{t.settings.specialClosedOption}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>{t.settings.specialCustomOption}</span>
            </span>
          </div>
        </div>

        {/* Date Override Editor */}
        <div className="lg:col-span-5 p-4 lg:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div>
            <p className="text-xs lg:text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {selectedOverride ? (isEs ? 'Editar Fecha Especial' : 'Edit Date Override') : t.settings.addSpecialHour}
            </p>
            <div className="mt-1.5">
              <label className="block text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {isEs ? 'Fecha seleccionada' : 'Selected Date'}
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={e => selectDateForEditing(e.target.value, overrideMap.get(e.target.value))}
                className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditorClosed(true)}
              className={`min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl text-sm lg:text-xs font-semibold border transition-colors ${
                editorClosed
                  ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.settings.dayClosed}
            </button>
            <button
              type="button"
              onClick={() => setEditorClosed(false)}
              className={`min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl text-sm lg:text-xs font-semibold border transition-colors ${
                !editorClosed
                  ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {isEs ? 'Horario Especial' : 'Special Hours'}
            </button>
          </div>

          {!editorClosed && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t.settings.openAt}
                </label>
                <input
                  type="time"
                  value={editorOpen}
                  onChange={e => setEditorOpen(e.target.value)}
                  className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t.settings.closeAt}
                </label>
                <input
                  type="time"
                  value={editorClose}
                  onChange={e => setEditorClose(e.target.value)}
                  className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs lg:text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
              {t.settings.specialReasonOptional}
            </label>
            <input
              type="text"
              value={editorLabel}
              onChange={e => setEditorLabel(e.target.value)}
              placeholder={t.settings.specialReasonPlaceholder}
              className="w-full min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-base lg:text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleApplyDateOverride}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-sm lg:text-xs font-semibold transition-colors"
            >
              <Plus className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              <span>
                {selectedOverride
                  ? isEs
                    ? 'Actualizar Fecha'
                    : 'Update Date'
                  : isEs
                  ? 'Aplicar Fecha'
                  : 'Apply Date'}
              </span>
            </button>
            {selectedOverride && (
              <button
                type="button"
                onClick={() => handleRemoveDate(selectedDate)}
                className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-3 py-2.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold"
                aria-label={t.common.delete}
              >
                <Trash2 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Configured Special Dates List */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {isEs ? 'Excepciones y Feriados Configurados' : 'Configured Holidays & Date Overrides'} ({draftSpecialHours.length})
        </h3>
        {draftSpecialHours.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-sm lg:text-xs text-slate-500 dark:text-slate-400">
            {t.settings.specialNoOverrides}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {draftSpecialHours.map(sh => (
              <div
                key={sh.date}
                className="flex items-center justify-between gap-2 lg:gap-3 px-3.5 py-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 text-sm lg:text-xs bg-slate-50/40 dark:bg-slate-800/30"
              >
                <button
                  type="button"
                  onClick={() => handleEditListRow(sh)}
                  className="flex items-center gap-3 min-w-0 min-h-[44px] lg:min-h-0 text-left flex-1"
                >
                  <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums shrink-0">
                    {sh.date}
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {sh.label || (sh.isClosed ? t.settings.dayClosed : isEs ? 'Horario especial' : 'Special hours')}
                  </span>
                </button>
                <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-md font-mono text-xs lg:text-[11px] font-semibold ${
                      sh.isClosed
                        ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
                        : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {sh.isClosed ? t.settings.dayClosed : `${sh.open} – ${sh.close}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveDate(sh.date)}
                    className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 p-2 lg:p-1.5 rounded-xl lg:rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    aria-label={`${t.common.delete} ${sh.date}`}
                  >
                    <Trash2 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
