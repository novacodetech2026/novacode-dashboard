import React from 'react';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  viewKey?: string;
  language?: 'en' | 'es';
  onReturnToOverview?: () => void;
  onCaptureIncident?: (error: Error, componentStack?: string) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log internally for diagnostics / Super Admin technical incidents without exposing technical stacks to business users
    console.error('[Novacode View ErrorBoundary]', error);
    if (this.props.onCaptureIncident) {
      this.props.onCaptureIncident(error, info.componentStack || undefined);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.viewKey !== this.props.viewKey) {
      this.setState({ hasError: false });
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const isEs = this.props.language === 'es';
      return (
        <div
          role="alert"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-8 sm:p-12 text-center shadow-xs max-w-xl mx-auto my-8"
        >
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/80 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {isEs ? 'No pudimos cargar esta sección' : "We couldn't load this section right now"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
            {isEs
              ? 'Ocurrió un problema temporal al mostrar esta vista. Puedes intentar de nuevo o volver al resumen principal.'
              : 'Something unexpected interrupted this view. Please try reloading it or return to the overview.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-6">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{isEs ? 'Intentar de nuevo' : 'Try Again'}</span>
            </button>
            {this.props.onReturnToOverview && (
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false });
                  this.props.onReturnToOverview?.();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>{isEs ? 'Volver al Resumen' : 'Return to Overview'}</span>
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
