import React from 'react';
import { useApp } from '../context/AppContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:bottom-5 left-4 right-4 lg:left-auto lg:right-5 z-50 flex flex-col gap-2 lg:max-w-sm lg:w-full pointer-events-none">
      {toasts.map(toast => {
        const icons = {
          success: <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />,
          error: <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />,
          warning: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />,
          info: <Info className="w-5 h-5 text-indigo-500 shrink-0" />,
        };

        const borders = {
          success: 'border-emerald-200 dark:border-emerald-800/60',
          error: 'border-rose-200 dark:border-rose-800/60',
          warning: 'border-amber-200 dark:border-amber-800/60',
          info: 'border-indigo-200 dark:border-indigo-800/60',
        };

        return (
          <div
            key={toast.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-3 p-4 lg:p-3.5 bg-white dark:bg-slate-900 border ${borders[toast.type]} rounded-xl shadow-lg shadow-slate-900/5 dark:shadow-black/20 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2`}
          >
            {icons[toast.type]}
            <div className="flex-1 min-w-0">
              <p className="text-sm lg:text-xs font-semibold text-slate-900 dark:text-slate-100">{toast.title}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 break-words leading-relaxed">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center p-1 lg:p-0.5 -mr-2 -mt-2 lg:m-0 rounded-lg transition-colors"
              aria-label="Close notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
