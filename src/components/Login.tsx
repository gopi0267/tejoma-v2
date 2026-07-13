/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CheckCircle, ArrowRight, ShieldCheck, ArrowLeft } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { useAuth } from '../context/AuthContext.js';

type AuthMode = 'login' | 'signup-details' | 'signup-otp' | 'signup-password' | 'forgot-identifier' | 'forgot-otp' | 'forgot-reset';

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

  // Signup wizard fields
  const [signupName, setSignupName] = useState('');
  const [signupIdentifier, setSignupIdentifier] = useState('');
  const [signupCompany, setSignupCompany] = useState('');
  const [signupCompanyId, setSignupCompanyId] = useState<number | null>(null);
  const [signupChannel, setSignupChannel] = useState<'email' | 'phone'>('email');
  const [signupOtp, setSignupOtp] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  // Forgot-password wizard fields
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotChannel, setForgotChannel] = useState<'email' | 'phone'>('email');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotDone, setForgotDone] = useState(false);

  const resetToLogin = () => {
    setMode('login');
    setError('');
    setInfo('');
    setSignupOtp('');
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
      login(data.user_info, data.company_id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== SIGN UP: step 1 - send OTP ====================
  const handleSignupStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupName || !signupIdentifier || !signupCompany) {
      setError('Please complete all required fields.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await postJson('/api/auth/signup/start', {
        name: signupName,
        identifier: signupIdentifier,
        company_name: signupCompany,
      });
      setSignupIdentifier(data.identifier);
      setSignupChannel(data.identifier_type);
      setSignupCompanyId(data.company_id);
      setMode('signup-otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== SIGN UP: resend OTP (reuses the captured details) ====================
  const handleResendSignupOtp = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const data = await postJson('/api/auth/signup/start', {
        name: signupName,
        identifier: signupIdentifier,
        company_name: signupCompany,
      });
      setSignupIdentifier(data.identifier);
      setSignupChannel(data.identifier_type);
      setSignupCompanyId(data.company_id);
      setInfo('A new code has been sent.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== SIGN UP: step 2 - verify OTP ====================
  const handleSignupVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signupOtp.length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await postJson('/api/auth/verify-otp', { identifier: signupIdentifier, otp: signupOtp, purpose: 'signup' });
      setMode('signup-password');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== SIGN UP: step 3 - set password ====================
  const handleSignupComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupPassword || !signupConfirmPassword) {
      setError('Please set and confirm your password.');
      return;
    }
    if (signupPassword !== signupConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (signupPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await postJson('/api/auth/signup/complete', {
        name: signupName,
        identifier: signupIdentifier,
        company_id: signupCompanyId,
        password: signupPassword,
        confirm_password: signupConfirmPassword,
        remember: rememberMe,
      });
      login(data.user_info, data.company_id);
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

  return (
    <div id="auth-screen" className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F3F2EF' }}>

      {/* Logo + tagline, centered above the card */}
      <div className="mb-6 flex flex-col items-center">
        <TejomaLogo size="lg" textColorClass="text-[#1A1A1A]" />
        <p className="text-[#666666] text-sm mt-2">Make the most of your recruiting workflow</p>
      </div>

      <div className="bg-white rounded-2xl w-full max-w-md shadow-md p-8 sm:p-10">

        {/* ============ LOG IN / SIGN UP TAB SWITCHER ============ */}
        {/* Only shown on the two entry-point screens - hidden during OTP/password sub-steps
            and the forgot-password flow, where jumping tabs mid-verification would lose progress. */}
        {(mode === 'login' || mode === 'signup-details') && (
          <div className="flex mb-8 bg-[#F3F2EF] rounded-full p-1">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); setInfo(''); }}
              className={`flex-1 py-2 text-sm font-bold text-center rounded-full transition-colors cursor-pointer ${
                mode === 'login' ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#666666] hover:text-[#1A1A1A]'
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup-details'); setError(''); setInfo(''); }}
              className={`flex-1 py-2 text-sm font-bold text-center rounded-full transition-colors cursor-pointer ${
                mode === 'signup-details' ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#666666] hover:text-[#1A1A1A]'
              }`}
            >
              Sign Up
            </button>
          </div>
        )}

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
          </form>
        )}

        {/* ============ SIGN UP: STEP 1 - details ============ */}
        {mode === 'signup-details' && (
          <form onSubmit={handleSignupStart} className="space-y-5">
            <TextField label="Full name" value={signupName} onChange={(e) => setSignupName(e.target.value)} placeholder="Sarah Mitchell" />

            <TextField
              label="Email or phone number"
              value={signupIdentifier}
              onChange={(e) => setSignupIdentifier(e.target.value)}
              placeholder="sarah@company.com or +91 98765 43210"
              hint="We'll send a 6-digit verification code here."
            />

            <TextField label="Company name" value={signupCompany} onChange={(e) => setSignupCompany(e.target.value)} placeholder="Tejoma Tech Inc" />

            {error && <ErrorBanner text={error} />}

            <p className="text-xs text-[#666666] text-center">
              By clicking Send Code, you agree to Tejoma's Terms of Service and Privacy Policy.
            </p>

            <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
              {loading ? 'Sending Code...' : 'Send Verification Code'}
            </button>
          </form>
        )}

        {/* ============ SIGN UP: STEP 2 - OTP ============ */}
        {mode === 'signup-otp' && (
          <OtpStep
            title="Verify Your Account"
            description={`Enter the 6-digit code sent via ${signupChannel} to`}
            identifier={signupIdentifier}
            otp={signupOtp}
            setOtp={setSignupOtp}
            onSubmit={handleSignupVerify}
            onBack={() => { setMode('signup-details'); setError(''); setInfo(''); }}
            onResend={handleResendSignupOtp}
            loading={loading}
            error={error}
            info={info}
          />
        )}

        {/* ============ SIGN UP: STEP 3 - password ============ */}
        {mode === 'signup-password' && (
          <form onSubmit={handleSignupComplete} className="space-y-5">
            <div className="mb-1 text-center">
              <h2 className="text-lg font-bold text-[#1A1A1A]">Create your password</h2>
              <p className="text-[#666666] text-xs mt-1">Verified! Now set a password for your account.</p>
            </div>

            <div>
              <PasswordField label="New password (8 or more characters)" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} placeholder="Enter a password" />
              <PasswordStrengthMeter password={signupPassword} />
            </div>
            <PasswordField label="Confirm password" value={signupConfirmPassword} onChange={(e) => setSignupConfirmPassword(e.target.value)} placeholder="Re-enter password" />

            {error && <ErrorBanner text={error} />}

            <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
              {loading ? 'Creating Account...' : 'Create Account & Log In'}
            </button>
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

function TextField({ label, value, onChange, placeholder, hint, type = 'text' }: {
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

function PasswordField({ label, value, onChange, placeholder }: {
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

function ErrorBanner({ text }: { text: string }) {
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

function PasswordStrengthMeter({ password }: { password: string }) {
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
