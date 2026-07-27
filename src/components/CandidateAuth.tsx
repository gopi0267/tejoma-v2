import React, { useState, useEffect } from 'react';
import { ShieldCheck, ArrowRight, ArrowLeft, CheckCircle, UserCheck, Sparkles, ListChecks, Zap, Briefcase, GraduationCap } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { TextField, PasswordField, ErrorBanner, PasswordStrengthMeter } from './Login.js';
import { useCandidateAuth } from '../context/CandidateAuthContext.js';

// Naukri-inspired two-column redesign (benefits panel + form) - CandidateLanding.tsx, every
// backend route, and the OTP/password/session mechanics below are all untouched. Only the
// visual structure changed; every fetch call still hits the exact same endpoints with the exact
// same payloads as before this redesign.
// 'register-password' no longer exists as a separate mode - Naukri collects the password
// up front alongside name/email, so it's now part of 'register-start's form and held in state
// until OTP verification succeeds, at which point it's sent to register/complete automatically
// (same endpoint, same payload shape, same order of network calls as before - just triggered
// right after OTP verification instead of after a second, separate form).
type CandidateAuthMode = 'login' | 'register-start' | 'register-otp' | 'forgot-identifier' | 'forgot-otp' | 'forgot-reset';

// Small inline "G" mark - lucide-react has no brand icons, and pulling in an icon-font/SVG
// dependency for a single glyph isn't worth it.
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

// Unchanged href - same Google OAuth entry point built in Phase 6, only its visual container
// changed (this button now sits inside the redesigned form card rather than the old plain card).
function GoogleButton() {
  return (
    <a
      href="/api/candidate-auth/google"
      className="w-full bg-white hover:bg-[#F8F8F8] active:bg-[#F0F0F0] text-[#1A1A1A] text-sm font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2.5 cursor-pointer border border-[#E5E7EB]"
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

const BENEFITS: { icon: typeof UserCheck; text: string }[] = [
  { icon: UserCheck, text: 'Build your profile and get discovered by recruiters' },
  { icon: Sparkles, text: 'Get job recommendations' },
  { icon: ListChecks, text: 'Track applications' },
  { icon: Zap, text: 'Find jobs faster with AI' },
];

// Left brand panel - hidden below lg (per the mobile-no-horizontal-scroll requirement, same
// pattern Naukri itself uses). An original, on-brand illustration composed from existing
// lucide-react icons - no Naukri artwork or colors reused, no new image assets.
function BenefitsPanel() {
  return (
    <div
      className="hidden lg:flex lg:w-[42%] xl:w-[38%] flex-shrink-0 flex-col justify-center px-12 xl:px-16 py-12 text-white"
      style={{ background: 'linear-gradient(160deg, #1E8449 0%, #27AE60 55%, #219653 100%)' }}
    >
      <div className="bg-white/95 rounded-xl px-4 py-2.5 inline-flex w-fit">
        <TejomaLogo size="md" textColorClass="text-[#1A1A1A]" />
      </div>

      <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mt-10 mb-6">
        <Sparkles className="w-8 h-8 text-white" />
      </div>

      <h2 className="text-2xl xl:text-3xl font-bold mb-2">Why join Tejoma?</h2>
      <p className="text-white/75 text-sm mb-8 max-w-xs">Join candidates finding better-matched roles, faster, with AI on their side.</p>

      <ul className="space-y-5">
        {BENEFITS.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icon className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm text-white/90 leading-snug pt-1">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RESEND_COOLDOWN_SECONDS = 60;

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

export default function CandidateAuth() {
  const { login } = useCandidateAuth();
  const [mode, setMode] = useState<CandidateAuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Login fields
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Registration fields - all collected on one screen now (Naukri-style), submitted across the
  // same three endpoints as before, just at different trigger points (see handlers below).
  const [regName, setRegName] = useState('');
  const [regIdentifier, setRegIdentifier] = useState('');
  const [regChannel, setRegChannel] = useState<'email' | 'phone'>('email');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regWorkStatus, setRegWorkStatus] = useState<'experienced' | 'fresher' | ''>('');
  const [regAgreeTerms, setRegAgreeTerms] = useState(false);
  const [regOtp, setRegOtp] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // Forgot-password wizard fields
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotChannel, setForgotChannel] = useState<'email' | 'phone'>('email');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotDone, setForgotDone] = useState(false);
  const [forgotCooldown, setForgotCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (mode !== 'register-otp' || cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [mode, cooldown]);

  useEffect(() => {
    if (mode !== 'forgot-otp' || forgotCooldown <= 0) return;
    const timer = setInterval(() => setForgotCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [mode, forgotCooldown]);

  // The Google OAuth callback is a full server redirect back to /candidate (not a fetch this
  // component makes), so a failure surfaces as a query param rather than a caught exception.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (!authError) return;
    const messages: Record<string, string> = {
      google_not_configured: 'Google sign-in is not available right now. Please use email/phone instead.',
      google_auth_failed: 'Google sign-in failed. Please try again or use email/phone.',
      account_deactivated: 'This account has been deactivated.',
    };
    setError(messages[authError] || 'Google sign-in failed. Please try again.');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const resetToLogin = () => {
    setMode('login');
    setError('');
    setInfo('');
    setRegOtp('');
    setRegPassword('');
    setRegConfirmPassword('');
    setRegWorkStatus('');
    setRegAgreeTerms(false);
    setForgotOtp('');
    setForgotDone(false);
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
      const data = await postJson('/api/candidate-auth/forgot-password/start', { identifier: forgotIdentifier });
      setForgotIdentifier(data.identifier);
      setForgotChannel(data.identifier_type);
      setForgotCooldown(RESEND_COOLDOWN_SECONDS);
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
      const data = await postJson('/api/candidate-auth/forgot-password/start', { identifier: forgotIdentifier });
      setForgotIdentifier(data.identifier);
      setForgotChannel(data.identifier_type);
      setForgotCooldown(RESEND_COOLDOWN_SECONDS);
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
      await postJson('/api/candidate-auth/forgot-password/verify-otp', { identifier: forgotIdentifier, otp: forgotOtp });
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
    setLoading(true);
    setError('');
    try {
      await postJson('/api/candidate-auth/forgot-password/reset', {
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
      const data = await postJson('/api/candidate-auth/login', { identifier: loginIdentifier, password: loginPassword, remember: rememberMe });
      login(data.candidate);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== REGISTER: step 1 - validate + send OTP ====================
  // Still calls POST /candidate-auth/register/start with exactly {name, identifier}, the same
  // payload shape as before this redesign - password/work-status stay in local state and are
  // only ever sent once OTP verification succeeds (see handleVerifyAndComplete).
  const handleRegisterStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName || !regIdentifier) {
      setError('Please enter your name and email or mobile number.');
      return;
    }
    if (!regPassword || !regConfirmPassword) {
      setError('Please set and confirm your password.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (regPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!regWorkStatus) {
      setError('Please select your work status.');
      return;
    }
    if (!regAgreeTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await postJson('/api/candidate-auth/register/start', { name: regName, identifier: regIdentifier });
      setRegIdentifier(data.identifier);
      setRegChannel(data.identifier_type);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setMode('register-otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== REGISTER: resend OTP ====================
  const handleResendOtp = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const data = await postJson('/api/candidate-auth/register/start', { name: regName, identifier: regIdentifier });
      setRegIdentifier(data.identifier);
      setRegChannel(data.identifier_type);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setInfo('A new code has been sent.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== REGISTER: step 2 - verify OTP, then complete registration ====================
  // Calls verify-otp then register/complete back-to-back, in the same order and with the same
  // payloads (name/identifier/password/confirm_password) that the old separate "set password"
  // screen used to send - that screen is gone, but the API sequence is identical.
  const handleVerifyAndComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regOtp.length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await postJson('/api/candidate-auth/register/verify-otp', { identifier: regIdentifier, otp: regOtp });
      const data = await postJson('/api/candidate-auth/register/complete', {
        name: regName,
        identifier: regIdentifier,
        password: regPassword,
        confirm_password: regConfirmPassword,
      });
      login(data.candidate);
      // Best-effort, fire-and-forget - registration has already succeeded regardless of this
      // call's outcome. Reuses the existing PUT /candidate-profile/me (Phase 7) rather than any
      // new endpoint; "Experienced" is left for the candidate to fill in later via their profile.
      if (regWorkStatus === 'fresher') {
        fetch('/api/candidate-profile/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ years_of_experience: 'Fresher' }),
        }).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="candidate-auth-screen" className="min-h-screen flex flex-col lg:flex-row" style={{ backgroundColor: '#F8FAFC' }}>
      <BenefitsPanel />

      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-12">
        <div className="lg:hidden mb-6 flex flex-col items-center">
          <TejomaLogo size="lg" textColorClass="text-[#1A1A1A]" />
          <p className="text-[#666666] text-sm mt-2">Find your next role</p>
        </div>

        <div className="bg-white rounded-2xl w-full max-w-md shadow-md p-8 sm:p-10">

          {/* ============ LOGIN ============ */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="mb-1 text-center">
                <h1 className="text-xl font-bold text-[#1A1A1A]">Log in to Tejoma</h1>
                <p className="text-[#666666] text-xs mt-1">Pick up where you left off.</p>
              </div>

              <TextField
                label="Email or phone number"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                placeholder="you@example.com or +91 98765 43210"
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
                <button type="button" onClick={() => { setMode('forgot-identifier'); setError(''); setInfo(''); }} className="text-xs font-semibold text-[#27AE60] hover:underline cursor-pointer">
                  Forgot password?
                </button>
              </div>

              {error && <ErrorBanner text={error} />}

              <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
                {loading ? 'Logging In...' : 'Log In'}
              </button>

              <OrDivider />
              <GoogleButton />

              <p className="text-center text-xs text-[#666666]">
                New here?{' '}
                <button type="button" onClick={() => { setMode('register-start'); setError(''); setInfo(''); }} className="text-[#27AE60] font-semibold hover:underline cursor-pointer">
                  Create your candidate account
                </button>
              </p>
            </form>
          )}

          {/* ============ REGISTER: everything on one screen (Naukri-style) ============ */}
          {mode === 'register-start' && (
            <form onSubmit={handleRegisterStart} className="space-y-5">
              <div className="mb-1 text-center">
                <h1 className="text-xl font-bold text-[#1A1A1A]">Create your candidate account</h1>
                <p className="text-[#666666] text-xs mt-1">It only takes a minute - start getting matched with jobs today.</p>
              </div>

              <TextField label="Full name" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Your full name" />

              <div>
                <div className="flex gap-1 mb-1.5 bg-[#F3F2EF] rounded-full p-1 w-fit">
                  <button
                    type="button"
                    onClick={() => setRegChannel('email')}
                    className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition-colors cursor-pointer ${regChannel === 'email' ? 'bg-white text-[#27AE60] shadow-sm' : 'text-[#666666]'}`}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegChannel('phone')}
                    className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition-colors cursor-pointer ${regChannel === 'phone' ? 'bg-white text-[#27AE60] shadow-sm' : 'text-[#666666]'}`}
                  >
                    Mobile Number
                  </button>
                </div>
                <TextField
                  label={regChannel === 'email' ? 'Email Address' : 'Mobile Number'}
                  value={regIdentifier}
                  onChange={(e) => setRegIdentifier(e.target.value)}
                  placeholder={regChannel === 'email' ? 'you@example.com' : '+91 98765 43210'}
                  type={regChannel === 'phone' ? 'tel' : 'email'}
                />
              </div>

              <div>
                <PasswordField label="Password (8 or more characters)" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="Create a password" />
                <PasswordStrengthMeter password={regPassword} />
              </div>
              <PasswordField label="Confirm password" value={regConfirmPassword} onChange={(e) => setRegConfirmPassword(e.target.value)} placeholder="Re-enter your password" />

              <div>
                <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">Work status</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRegWorkStatus('experienced')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer border ${
                      regWorkStatus === 'experienced' ? 'bg-[#E5F5E5] border-[#27AE60] text-[#1E8449]' : 'bg-white border-[#E5E7EB] text-[#666666] hover:border-[#CCCCCC]'
                    }`}
                  >
                    <Briefcase className="w-4 h-4" /> Experienced
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegWorkStatus('fresher')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer border ${
                      regWorkStatus === 'fresher' ? 'bg-[#E5F5E5] border-[#27AE60] text-[#1E8449]' : 'bg-white border-[#E5E7EB] text-[#666666] hover:border-[#CCCCCC]'
                    }`}
                  >
                    <GraduationCap className="w-4 h-4" /> Fresher
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={regAgreeTerms}
                  onChange={(e) => setRegAgreeTerms(e.target.checked)}
                  className="mt-0.5 rounded border-[#CCCCCC] text-[#27AE60] focus:ring-[#27AE60]"
                />
                <span className="text-xs text-[#666666]">
                  I agree to Tejoma's <span className="font-semibold text-[#1A1A1A]">Terms of Service</span> and <span className="font-semibold text-[#1A1A1A]">Privacy Policy</span>
                </span>
              </label>

              {error && <ErrorBanner text={error} />}

              <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60">
                {loading ? 'Sending Code...' : <>Register <ArrowRight className="w-4 h-4" /></>}
              </button>

              <OrDivider />
              <GoogleButton />

              <button type="button" onClick={resetToLogin} className="w-full text-[#666666] hover:text-[#1A1A1A] text-xs text-center focus:outline-none cursor-pointer">
                Back to Log In
              </button>
            </form>
          )}

          {/* ============ REGISTER: verify OTP (also finalizes the account) ============ */}
          {mode === 'register-otp' && (
            <>
              <div className="mb-6 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-[#E5F5E5] border border-[#A8E6C1] flex items-center justify-center mb-3">
                  <ShieldCheck className="w-5 h-5 text-[#27AE60]" />
                </div>
                <h1 className="text-lg font-bold text-[#1A1A1A]">Verify Your Identity</h1>
                <p className="text-[#666666] text-xs mt-1">
                  Enter the 6-digit code sent via {regChannel} to <span className="font-semibold text-[#1A1A1A]">{regIdentifier}</span>
                </p>
              </div>

              {error && <div className="mb-4"><ErrorBanner text={error} /></div>}

              <form onSubmit={handleVerifyAndComplete} className="space-y-5">
                <div>
                  <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5 text-center">6-digit verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={regOtp}
                    onChange={(e) => setRegOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full bg-white border border-[#E5E7EB] rounded-lg py-3 px-4 text-[#1A1A1A] text-lg font-bold tracking-[0.5em] text-center focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
                  />
                </div>

                <div className="text-center">
                  {cooldown > 0 ? (
                    <span className="text-xs text-[#999999]">Resend code in {cooldown}s</span>
                  ) : (
                    <button type="button" onClick={handleResendOtp} disabled={loading} className="text-xs text-[#27AE60] hover:underline font-semibold focus:outline-none cursor-pointer disabled:opacity-60">
                      Didn't get a code? Resend
                    </button>
                  )}
                </div>

                <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
                  {loading ? 'Verifying...' : 'Verify & Create Account'}
                </button>

                <button type="button" onClick={() => { setMode('register-start'); setError(''); setInfo(''); }} className="w-full text-[#666666] hover:text-[#1A1A1A] text-xs text-center focus:outline-none cursor-pointer flex items-center justify-center gap-1">
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
              </form>
            </>
          )}

          {/* ============ FORGOT PASSWORD: STEP 1 - identifier ============ */}
          {mode === 'forgot-identifier' && (
            <form onSubmit={handleForgotStart} className="space-y-5">
              <div className="mb-1 text-center">
                <h1 className="text-lg font-bold text-[#1A1A1A]">Forgot password</h1>
                <p className="text-[#666666] text-xs mt-1">Enter your email or phone and we'll send a verification code.</p>
              </div>

              <TextField label="Email or phone number" value={forgotIdentifier} onChange={(e) => setForgotIdentifier(e.target.value)} placeholder="you@example.com or +91 98765 43210" />

              {error && <ErrorBanner text={error} />}

              <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60">
                {loading ? 'Sending...' : <>Send Verification Code <ArrowRight className="w-4 h-4" /></>}
              </button>

              <button type="button" onClick={resetToLogin} className="w-full text-[#666666] hover:text-[#1A1A1A] text-xs text-center focus:outline-none cursor-pointer">
                Back to Log In
              </button>
            </form>
          )}

          {/* ============ FORGOT PASSWORD: STEP 2 - OTP ============ */}
          {mode === 'forgot-otp' && (
            <>
              <div className="mb-6 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-[#E5F5E5] border border-[#A8E6C1] flex items-center justify-center mb-3">
                  <ShieldCheck className="w-5 h-5 text-[#27AE60]" />
                </div>
                <h1 className="text-lg font-bold text-[#1A1A1A]">Verify Your Identity</h1>
                <p className="text-[#666666] text-xs mt-1">
                  Enter the 6-digit code sent via {forgotChannel} to <span className="font-semibold text-[#1A1A1A]">{forgotIdentifier}</span>
                </p>
              </div>

              {error && <div className="mb-4"><ErrorBanner text={error} /></div>}

              <form onSubmit={handleForgotVerify} className="space-y-5">
                <div>
                  <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5 text-center">6-digit verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full bg-white border border-[#E5E7EB] rounded-lg py-3 px-4 text-[#1A1A1A] text-lg font-bold tracking-[0.5em] text-center focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
                  />
                </div>

                <div className="text-center">
                  {forgotCooldown > 0 ? (
                    <span className="text-xs text-[#999999]">Resend code in {forgotCooldown}s</span>
                  ) : (
                    <button type="button" onClick={handleResendForgotOtp} disabled={loading} className="text-xs text-[#27AE60] hover:underline font-semibold focus:outline-none cursor-pointer disabled:opacity-60">
                      Didn't get a code? Resend
                    </button>
                  )}
                </div>

                <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
                  {loading ? 'Verifying...' : 'Verify Code'}
                </button>

                <button type="button" onClick={() => { setMode('forgot-identifier'); setError(''); setInfo(''); }} className="w-full text-[#666666] hover:text-[#1A1A1A] text-xs text-center focus:outline-none cursor-pointer flex items-center justify-center gap-1">
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
              </form>
            </>
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
                  <h1 className="text-lg font-bold text-[#1A1A1A]">Set new password</h1>
                  <p className="text-[#666666] text-xs mt-1">Verified! Choose a new password for your account.</p>
                </div>

                <div>
                  <PasswordField label="New password (8 or more characters)" value={forgotNewPassword} onChange={(e) => setForgotNewPassword(e.target.value)} placeholder="Enter a new password" />
                  <PasswordStrengthMeter password={forgotNewPassword} />
                </div>
                <PasswordField label="Confirm new password" value={forgotConfirmPassword} onChange={(e) => setForgotConfirmPassword(e.target.value)} placeholder="Re-enter new password" />

                {error && <ErrorBanner text={error} />}

                <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            )
          )}

        </div>
      </div>
    </div>
  );
}
