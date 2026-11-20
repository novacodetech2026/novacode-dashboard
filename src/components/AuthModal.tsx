import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, 
  Lock, 
  Mail, 
  ArrowRight, 
  ArrowLeft,
  AlertCircle, 
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  KeyRound
} from 'lucide-react';
import { sanitizeErrorForBusiness } from '../utils/security';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthModalView = 'signin' | 'forgot' | 'recovery' | 'invite';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { 
    t, 
    language, 
    loginWithSupabase, 
    requestPasswordReset,
    completePasswordReset,
    completeInvitationOnboarding,
    isPasswordRecoveryMode,
    setIsPasswordRecoveryMode,
    recoveryError,
    setRecoveryError,
    isInvitationOnboardingMode,
    setIsInvitationOnboardingMode,
    invitationError,
    setInvitationError,
    authSession,
    isAuthLoading,
    setMode,
    addToast 
  } = useApp();

  const [authMode, setAuthMode] = useState<AuthModalView>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [passwordUpdatedSuccess, setPasswordUpdatedSuccess] = useState(false);
  const [inviteActivatedSuccess, setInviteActivatedSuccess] = useState(false);

  // Sync recovery or invitation onboarding mode detected from Supabase Auth / URL link
  useEffect(() => {
    if (isInvitationOnboardingMode) {
      setAuthMode('invite');
      setAuthError(invitationError || null);
      setInviteActivatedSuccess(false);
    } else if (isPasswordRecoveryMode) {
      setAuthMode('recovery');
      setAuthError(recoveryError || null);
      setPasswordUpdatedSuccess(false);
    }
  }, [isInvitationOnboardingMode, invitationError, isPasswordRecoveryMode, recoveryError]);

  if (!isOpen) return null;

  const handleClose = () => {
    setAuthError(null);
    setRecoveryError(null);
    setInvitationError(null);
    setResetEmailSent(false);
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.replace(/\/+$/, '');
      if (path === '/reset-password' || path === '/accept-invite') {
        window.history.replaceState({}, document.title, '/');
      }
    }
    if (isInvitationOnboardingMode) {
      setIsInvitationOnboardingMode(false);
    }
    if (isPasswordRecoveryMode) {
      setIsPasswordRecoveryMode(false);
    } else if (!isInvitationOnboardingMode) {
      setPasswordUpdatedSuccess(false);
      setInviteActivatedSuccess(false);
      setAuthMode('signin');
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);

    try {
      if (authMode === 'signin') {
        const result = await loginWithSupabase(email.trim(), password);
        if (result.success) {
          onClose();
        } else {
          setAuthError(result.error || 'Authentication failed. Please check your credentials.');
        }
      } else if (authMode === 'forgot') {
        const result = await requestPasswordReset(email.trim());
        if (result.success) {
          setResetEmailSent(true);
        } else {
          setAuthError(result.error || 'Unable to send password recovery email.');
        }
      } else if (authMode === 'recovery') {
        if (newPassword.length < 6) {
          setAuthError(t.auth.passwordTooShort);
          setIsLoading(false);
          return;
        }
        if (newPassword !== confirmPassword) {
          setAuthError(t.auth.passwordMismatch);
          setIsLoading(false);
          return;
        }
        const result = await completePasswordReset(newPassword);
        if (result.success) {
          setPasswordUpdatedSuccess(true);
          setNewPassword('');
          setConfirmPassword('');
        } else {
          setAuthError(result.error || 'Failed to update password.');
        }
      } else if (authMode === 'invite') {
        if (newPassword.length < 6) {
          setAuthError(t.auth.passwordTooShort);
          setIsLoading(false);
          return;
        }
        if (newPassword !== confirmPassword) {
          setAuthError(t.auth.passwordMismatch);
          setIsLoading(false);
          return;
        }
        const result = await completeInvitationOnboarding(newPassword);
        if (result.success) {
          setInviteActivatedSuccess(true);
          setNewPassword('');
          setConfirmPassword('');
        } else {
          setAuthError(result.error || 'Failed to activate business invitation.');
        }
      }
    } catch (err: unknown) {
      setAuthError(sanitizeErrorForBusiness(err, language).userMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueWithDemo = () => {
    setMode('demo');
    handleClose();
    addToast(
      'info',
      language === 'es' ? 'Vista Previa Interactiva' : 'Interactive Preview',
      language === 'es' ? 'Estás explorando con datos de muestra locales.' : 'You are exploring with local preview data.'
    );
  };

  const getHeaderTitle = () => {
    if (authMode === 'invite') return t.auth.acceptInviteTitle;
    if (authMode === 'forgot') return t.auth.resetTitle;
    if (authMode === 'recovery') return t.auth.setNewPasswordTitle;
    return t.auth.signInTitle;
  };

  const getHeaderSubtitle = () => {
    if (authMode === 'invite') return t.auth.acceptInviteSubtitle;
    if (authMode === 'forgot') return t.auth.resetSubtitle;
    if (authMode === 'recovery') return t.auth.setNewPasswordSubtitle;
    return t.auth.signInSubtitle;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="w-full sm:max-w-md max-h-[92dvh] bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 lg:p-6 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-2 shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/50 text-xs lg:text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
              {authMode === 'recovery' || authMode === 'forgot' || authMode === 'invite' ? (
                <KeyRound className="w-3 h-3 text-indigo-600" />
              ) : (
                <ShieldCheck className="w-3 h-3 text-indigo-600" />
              )}
              <span>Novacode Tech</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {getHeaderTitle()}
            </h2>
            <p className="text-sm lg:text-xs text-slate-500 dark:text-slate-400">
              {getHeaderSubtitle()}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 flex items-center justify-center p-2 lg:p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label={t.common.close}
          >
            <X className="w-5 h-5 lg:w-4 lg:h-4" />
          </button>
        </div>

        {/* Scrollable Content + Footer */}
        <div className="flex-1 overflow-y-auto">
        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 lg:p-6 space-y-4">
          {authError && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm lg:text-xs animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {/* FORGOT PASSWORD SUCCESS STATE */}
          {authMode === 'forgot' && resetEmailSent ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm lg:text-xs">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <span>{t.auth.resetEmailSent}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signin');
                  setResetEmailSent(false);
                  setAuthError(null);
                }}
                className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t.auth.backToSignIn}</span>
              </button>
            </div>
          ) : authMode === 'recovery' && passwordUpdatedSuccess ? (
            /* SET NEW PASSWORD SUCCESS STATE */
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm lg:text-xs">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <span>{t.auth.passwordUpdatedSuccess}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPasswordUpdatedSuccess(false);
                  setAuthMode('signin');
                  setAuthError(null);
                }}
                className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold transition-all"
              >
                <span>{t.auth.proceedToSignIn}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : authMode === 'invite' && inviteActivatedSuccess ? (
            /* INVITE ONBOARDING COMPLETED STATE */
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm lg:text-xs">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <span>{t.auth.inviteActivatedSuccess}</span>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold transition-all"
              >
                <span>{t.auth.enterPortalButton}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : authMode === 'invite' ? (
            /* INVITED OWNER CREDENTIALS & ONBOARDING FORM */
            <>
              {!isAuthLoading && !authSession ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm lg:text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{t.auth.inviteExpiredOrInvalid}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setInvitationError(null);
                      setIsInvitationOnboardingMode(false);
                      setAuthMode('signin');
                    }}
                    className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold transition-all"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{t.auth.backToSignIn}</span>
                  </button>
                </div>
              ) : (
                <>
                  {authSession?.user?.email && (
                    <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/70 dark:border-indigo-900 text-sm lg:text-xs space-y-1">
                      <p className="font-semibold text-indigo-900 dark:text-indigo-200 font-mono">
                        {authSession.user.email}
                      </p>
                      <p className="text-xs lg:text-[11px] text-indigo-700 dark:text-indigo-300">
                        {t.auth.inviteWrongEmailNotice}
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.auth.newPasswordLabel} *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 lg:top-3" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        placeholder="••••••••••••"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.auth.confirmPasswordLabel} *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 lg:top-3" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        placeholder="••••••••••••"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || isAuthLoading}
                    className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>{t.auth.activateAccountButton}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </>
              )}
            </>
          ) : authMode === 'recovery' ? (
            /* SET NEW PASSWORD FORM */
            <>
              {!isAuthLoading && !authSession ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm lg:text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{t.auth.recoveryInvalidSession}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setRecoveryError(null);
                      setIsPasswordRecoveryMode(false);
                      setAuthMode('forgot');
                    }}
                    className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold transition-all"
                  >
                    <span>{t.auth.sendResetButton}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.auth.newPasswordLabel} *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 lg:top-3" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        placeholder="••••••••••••"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.auth.confirmPasswordLabel} *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 lg:top-3" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        placeholder="••••••••••••"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || isAuthLoading}
                    className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>{t.auth.updatePasswordButton}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </>
              )}
            </>
          ) : (
            /* SIGN IN OR FORGOT PASSWORD REQUEST FORM */
            <>
              <div>
                <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.auth.emailLabel} *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 lg:top-3" />
                  <input
                    type="email"
                    required
                    placeholder="owner@yourbusiness.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
              </div>

              {authMode === 'signin' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.auth.passwordLabel} *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('forgot');
                        setAuthError(null);
                        setResetEmailSent(false);
                      }}
                      className="min-h-[44px] lg:min-h-0 inline-flex items-center text-xs lg:text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {t.auth.forgotPasswordLink}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 lg:top-3" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-0 pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-base lg:text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm lg:text-xs font-semibold shadow-xs shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>
                      {authMode === 'forgot'
                        ? t.auth.sendResetButton
                        : t.auth.signInButton}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              {authMode === 'signin' && (
                <p className="text-xs lg:text-[11px] text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                  {t.auth.inviteOnlyNotice}
                </p>
              )}

              {authMode === 'forgot' && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signin');
                    setAuthError(null);
                  }}
                  className="w-full min-h-[44px] lg:min-h-0 flex items-center justify-center gap-1.5 py-2 text-sm lg:text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{t.auth.backToSignIn}</span>
                </button>
              )}
            </>
          )}
        </form>

        {/* Demo Mode Fallback Option */}
        <div className="p-4 lg:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:pb-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-2 text-center">
          <p className="text-xs lg:text-[11px] text-slate-500">
            {t.auth.orContinueWithDemo}
          </p>
          <button
            type="button"
            onClick={handleContinueWithDemo}
            className="w-full min-h-[44px] lg:min-h-0 py-2.5 lg:py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-sm lg:text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            {t.auth.exploreDemoButton}
          </button>
          <div className="pt-1 flex items-center justify-center gap-4 text-xs lg:text-[11px] text-slate-500 dark:text-slate-400">
            <a
              href="/privacy-policy"
              onClick={e => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onClose();
                window.history.pushState({}, '', '/privacy-policy');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="min-h-[44px] lg:min-h-0 inline-flex items-center px-1 hover:text-slate-900 dark:hover:text-slate-200 underline underline-offset-4"
            >
              Privacy Policy
            </a>
            <a
              href="/terms-of-service"
              onClick={e => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onClose();
                window.history.pushState({}, '', '/terms-of-service');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="min-h-[44px] lg:min-h-0 inline-flex items-center px-1 hover:text-slate-900 dark:hover:text-slate-200 underline underline-offset-4"
            >
              Terms of Service
            </a>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
