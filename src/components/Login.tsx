/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CheckCircle, ArrowRight, ShieldCheck, ArrowLeft } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { useAuth } from '../context/AuthContext.js';
import CompanyRegistration from './CompanyRegistration.js';

type AuthMode = 'login' | 'company-registration' | 'forgot-identifier' | 'forgot-otp' | 'forgot-reset';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.01l7.73 6c4.51-4.16 7.09-10.29 7.09-17.48z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.87.92 7.53 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// Same Google OAuth entry point pattern as the candidate portal's GoogleButton (CandidateAuth.tsx),
// hitting the recruiter-side /api/auth/google route instead.
function GoogleButton() {
  return (
    <a
      href="/api/auth/google"
      className="w-full bg-white hover:bg-[#F8F8F8] active:bg-[#F0F0F0] text-[#1A1A1A] text-sm font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2.5 cursor-pointer border border-[#E0E0E0]"
    >
      <GoogleIcon /> Continue with Google
    </a>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[#E0E0E0]" />
      <span className="text-[11px] text-[#999999] font-semibold uppercase tracking-wider">or</span>
      <div className="flex-1 h-px bg-[#E0E0E0]" />
    </div>
  );
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Login fields
  const [loginIdentifier, setLoginIdentifier] = useState('recruiter@tejoma.com');
  const [loginPassword, setLoginPassword] = useState('Tejoma@123');

  // Forgot-password wizard fields
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotChannel, setForgotChannel] = useState<'email' | 'phone'>('email');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotDone, setForgotDone] = useState(false);

  // The Google OAuth callback is a full server redirect back to / (not a fetch this component
  // makes), so a failure surfaces as a query param rather than a caught exception - same pattern
  // as the candidate portal's CandidateAuth.tsx.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (!authError) return;
    const messages: Record<string, string> = {
      google_not_configured: 'Google sign-in is not available right now. Please use email/phone instead.',
      google_auth_failed: 'Google sign-in failed. Please try again or use email/phone.',
      google_no_account: 'No recruiter account found for this Google email. Register your company, or ask your admin to invite you first.',
      account_deactivated: 'This account has been deactivated.',
    };
    setError(messages[authError] || 'Google sign-in failed. Please try again.');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const resetToLogin = () => {
    setMode('login');
    setError('');
    setInfo('');
    setForgotOtp('');
    setForgotDone(false);
  };

  // ==================== LOGIN ====================
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentifier || !loginPassword) {
      setError('Please fill in all credentials.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await postJson('/api/auth/login', { identifier: loginIdentifier, password: loginPassword, remember: rememberMe });
      login(data.user_info, data.company_id, data.company);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== FORGOT PASSWORD: step 1 - send OTP ====================
  const handleForgotStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotIdentifier) {
      setError('Please enter your email or phone number.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await postJson('/api/auth/forgot-password/start', { identifier: forgotIdentifier });
      setForgotIdentifier(data.identifier);
      setForgotChannel(data.identifier_type);
      setMode('forgot-otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== FORGOT PASSWORD: resend OTP ====================
  const handleResendForgotOtp = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const data = await postJson('/api/auth/forgot-password/start', { identifier: forgotIdentifier });
      setForgotIdentifier(data.identifier);
      setForgotChannel(data.identifier_type);
      setInfo('A new code has been sent.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== FORGOT PASSWORD: step 2 - verify OTP ====================
  const handleForgotVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotOtp.length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await postJson('/api/auth/verify-otp', { identifier: forgotIdentifier, otp: forgotOtp, purpose: 'password_reset' });
      setMode('forgot-reset');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== FORGOT PASSWORD: step 3 - set new password ====================
  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotNewPassword || !forgotConfirmPassword) {
      setError('Please set and confirm your new password.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (forgotNewPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await postJson('/api/auth/forgot-password/reset', {
        identifier: forgotIdentifier,
        new_password: forgotNewPassword,
        confirm_password: forgotConfirmPassword,
      });
      setForgotDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Company Registration is a dedicated full page (many more fields than fit this card), not
  // another step of this wizard - it renders entirely in place of the login card.
  if (mode === 'company-registration') {
    return <CompanyRegistration onBackToLogin={resetToLogin} />;
  }

  return (
    <div id="auth-screen" className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F8FAFC' }}>

      {/* Logo + tagline, centered above the card */}
      <div className="mb-6 flex flex-col items-center">
        <TejomaLogo size="lg" textColorClass="text-[#1A1A1A]" />
        <p className="text-[#666666] text-sm mt-2">Make the most of your recruiting workflow</p>
      </div>

      <div className="bg-white rounded-2xl w-full max-w-md shadow-md p-8 sm:p-10">

        {/* ============ LOGIN ============ */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-5">
            <TextField
              label="Email or phone number"
              value={loginIdentifier}
              onChange={(e) => setLoginIdentifier(e.target.value)}
              placeholder="recruiter@tejoma.com or +91 98765 43210"
            />

            <PasswordField
              label="Password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Enter your password"
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="rounded border-[#CCCCCC] text-[#27AE60] focus:ring-[#27AE60]" />
                <span className="text-xs text-[#666666]">Remember me for 30 days</span>
              </label>
              <button type="button" onClick={() => { setMode('forgot-identifier'); setError(''); }} className="text-xs font-semibold text-[#27AE60] hover:underline cursor-pointer">
                Forgot password?
              </button>
            </div>

            {error && <ErrorBanner text={error} />}

            <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
              {loading ? 'Logging In...' : 'Log In'}
            </button>

            <OrDivider />
            <GoogleButton />

            <p className="text-center text-xs text-[#666666]">
              New company?{' '}
              <button type="button" onClick={() => { setMode('company-registration'); setError(''); setInfo(''); }} className="text-[#27AE60] font-semibold hover:underline cursor-pointer">
                Register your company
              </button>
            </p>
          </form>
        )}

        {/* ============ FORGOT PASSWORD: STEP 1 - identifier ============ */}
        {mode === 'forgot-identifier' && (
          <form onSubmit={handleForgotStart} className="space-y-5">
            <div className="mb-1 text-center">
              <h2 className="text-lg font-bold text-[#1A1A1A]">Forgot password</h2>
              <p className="text-[#666666] text-xs mt-1">Enter your email or phone and we'll send a verification code.</p>
            </div>

            <TextField label="Email or phone number" value={forgotIdentifier} onChange={(e) => setForgotIdentifier(e.target.value)} placeholder="recruiter@tejoma.com or +91 98765 43210" />

            {error && <ErrorBanner text={error} />}

            <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60">
              {loading ? 'Sending...' : <>Send Verification Code <ArrowRight className="w-4 h-4" /></>}
            </button>

            <button type="button" onClick={resetToLogin} className="w-full text-[#666666] hover:text-[#1A1A1A] text-xs text-center focus:outline-none cursor-pointer">
              Back to Log In
            </button>
          </form>
        )}

        {/* ============ FORGOT PASSWORD: STEP 2 - OTP ============ */}
        {mode === 'forgot-otp' && (
          <OtpStep
            title="Verify Your Identity"
            description={`Enter the 6-digit code sent via ${forgotChannel} to`}
            identifier={forgotIdentifier}
            otp={forgotOtp}
            setOtp={setForgotOtp}
            onSubmit={handleForgotVerify}
            onBack={() => { setMode('forgot-identifier'); setError(''); setInfo(''); }}
            onResend={handleResendForgotOtp}
            loading={loading}
            error={error}
            info={info}
          />
        )}

        {/* ============ FORGOT PASSWORD: STEP 3 - new password ============ */}
        {mode === 'forgot-reset' && (
          forgotDone ? (
            <div className="bg-[#E5F5E5] border border-[#A8E6C1] p-5 rounded-xl text-[#27AE60] text-center text-sm">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-[#27AE60]" />
              Password updated successfully. Please log in with your new password.
              <button onClick={resetToLogin} className="block mx-auto mt-4 text-[#219653] font-semibold hover:underline cursor-pointer">
                Back to Log In
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotReset} className="space-y-5">
              <div className="mb-1 text-center">
                <h2 className="text-lg font-bold text-[#1A1A1A]">Set new password</h2>
                <p className="text-[#666666] text-xs mt-1">Verified! Choose a new password for your account.</p>
              </div>

              <div>
                <PasswordField label="New password (8 or more characters)" value={forgotNewPassword} onChange={(e) => setForgotNewPassword(e.target.value)} placeholder="Enter a new password" />
                <PasswordStrengthMeter password={forgotNewPassword} />
              </div>
              <PasswordField label="Confirm new password" value={forgotConfirmPassword} onChange={(e) => setForgotConfirmPassword(e.target.value)} placeholder="Re-enter new password" />

              {error && <ErrorBanner text={error} />}

              <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )
        )}

      </div>
    </div>
  );
}

// ==================== Shared, plain (icon-less) field components ====================

export function TextField({ label, value, onChange, placeholder, hint, type = 'text' }: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">{label}</label>
      <input
        type={type}
        required
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-white border border-[#E0E0E0] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
      />
      {hint && <p className="text-xs text-[#999999] mt-1">{hint}</p>}
    </div>
  );
}

export function PasswordField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          required
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full bg-white border border-[#E0E0E0] rounded-lg py-2.5 pl-3.5 pr-14 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#666666] hover:text-[#1A1A1A] cursor-pointer"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

export function ErrorBanner({ text }: { text: string }) {
  return <div className="bg-[#FFE5E5] border border-[#FFB3B3] p-3 rounded-lg text-[#E74C3C] text-xs font-medium">{text}</div>;
}

function InfoBanner({ text }: { text: string }) {
  return <div className="bg-[#E5F5E5] border border-[#A8E6C1] p-3 rounded-lg text-[#27AE60] text-xs font-medium">{text}</div>;
}

// Matches the backend's 60-second resend cooldown (see OTP_RESEND_COOLDOWN_MS in auth.routes.ts).
const RESEND_COOLDOWN_SECONDS = 60;

// Shared 6-digit OTP entry step used by both the signup and forgot-password wizards.
function OtpStep({ title, description, identifier, otp, setOtp, onSubmit, onBack, onResend, loading, error, info }: {
  title: string;
  description: string;
  identifier: string;
  otp: string;
  setOtp: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onResend: () => void;
  loading: boolean;
  error: string;
  info: string;
}) {
  // Starts counting down as soon as this step is shown (a code was just sent to get here),
  // and resets every time onResend is actually triggered - mirrors the backend cooldown so
  // the button doesn't just produce a "please wait" error on the very next click.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResendClick = () => {
    onResend();
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <>
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="w-10 h-10 rounded-full bg-[#E5F5E5] border border-[#A8E6C1] flex items-center justify-center mb-3">
          <ShieldCheck className="w-5 h-5 text-[#27AE60]" />
        </div>
        <h2 className="text-lg font-bold text-[#1A1A1A]">{title}</h2>
        <p className="text-[#666666] text-xs mt-1">
          {description} <span className="font-semibold text-[#1A1A1A]">{identifier}</span>
        </p>
      </div>

      {error && <div className="mb-4"><ErrorBanner text={error} /></div>}
      {!error && info && <div className="mb-4"><InfoBanner text={info} /></div>}

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5 text-center">6-digit verification code</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="w-full bg-white border border-[#E0E0E0] rounded-lg py-3 px-4 text-[#1A1A1A] text-lg font-bold tracking-[0.5em] text-center focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
          />
        </div>

        <div className="text-center">
          {cooldown > 0 ? (
            <span className="text-xs text-[#999999]">Resend code in {cooldown}s</span>
          ) : (
            <button type="button" onClick={handleResendClick} disabled={loading} className="text-xs text-[#27AE60] hover:underline font-semibold focus:outline-none cursor-pointer disabled:opacity-60">
              Didn't get a code? Resend
            </button>
          )}
        </div>

        <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
          {loading ? 'Verifying...' : 'Verify Code'}
        </button>

        <button type="button" onClick={onBack} className="w-full text-[#666666] hover:text-[#1A1A1A] text-xs text-center focus:outline-none cursor-pointer flex items-center justify-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Back
        </button>
      </form>
    </>
  );
}

// Client-side heuristic meter shown live as the user types, for immediate feedback. The
// authoritative check is still the backend's zxcvbn-based validatePassword() (see
// src/utils/password.ts) which runs on submit - this meter is a helpful hint, not the
// source of truth, so it deliberately stays simple (length + character-class checks).
function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: 'Weak', color: '#E74C3C' };
  if (score <= 2) return { score, label: 'Fair', color: '#F39C12' };
  if (score <= 3) return { score, label: 'Good', color: '#3498DB' };
  return { score, label: 'Strong', color: '#27AE60' };
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label, color } = getPasswordStrength(password);
  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full transition-colors" style={{ backgroundColor: i < score ? color : '#E0E0E0' }} />
        ))}
      </div>
      <span className="text-[11px] font-bold mt-1 block" style={{ color }}>{label}</span>
    </div>
  );
}
