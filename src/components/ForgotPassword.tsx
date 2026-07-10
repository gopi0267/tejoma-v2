import React, { useState } from 'react';
import { Mail, ArrowRight, CheckCircle, Loader } from 'lucide-react';
import TejomaLogo from './TejomaLogo';

interface ForgotPasswordProps {
  onBackToLogin: () => void;
}

export default function ForgotPassword({ onBackToLogin }: ForgotPasswordProps) {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // ==================== STEP 1: Send Reset Link ====================
  const handleSendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  // ==================== STEP 2: Reset Password ====================
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirmPassword) {
      setError('Both password fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reset_token: resetToken,
          new_password: newPassword,
          confirm_password: confirmPassword
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess(true);
      setTimeout(() => onBackToLogin(), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Get reset token from URL
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setResetToken(token);
      setStep('reset');
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-gray-100 flex items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-2xl shadow-lg overflow-hidden">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-50 to-blue-50 p-8 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="w-full max-w-md">
                <TejomaLogo size="lg" textColorClass="text-gray-900" />
              </div>
              <p className="text-xs text-gray-600 font-medium tracking-tight mt-2">Recruiting Solutions</p>
            </div>
            <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold px-2.5 py-1 rounded-full uppercase tracking-widest whitespace-nowrap ml-4">Enterprise AI</span>
          </div>
        </div>

        {/* Form Content */}
        <div className="p-8">
          <div className="max-w-md">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Reset Your Password</h2>
            <p className="text-gray-600 text-xs mt-1">
              {step === 'email' ? 'Enter your email to receive a reset link' : 'Create a new password for your account'}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 p-3 rounded-lg text-red-700 text-xs font-medium my-4">
              {error}
            </div>
          )}

          {success && step === 'email' && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg text-emerald-700 text-xs my-4">
              <CheckCircle className="w-5 h-5 inline mr-2" />
              Reset link has been sent to your email. Check your inbox!
            </div>
          )}

          {success && step === 'reset' && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg text-emerald-700 text-xs my-4">
              <CheckCircle className="w-5 h-5 inline mr-2" />
              Password updated successfully! Redirecting to login...
            </div>
          )}

          {/* STEP 1: EMAIL */}
          {step === 'email' && (
            <form onSubmit={handleSendResetLink} className="space-y-4 mt-6">
              <div>
                <label className="block text-gray-700 text-[10px] font-bold mb-1 uppercase tracking-wider">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="sarah@company.com"
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl py-2 pl-9 pr-4 text-gray-900 text-xs focus:outline-none focus:border-emerald-500 focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-xl transition-colors mt-4 flex items-center justify-center gap-2"
              >
                {loading ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full text-gray-600 hover:text-gray-900 text-[10px] text-center mt-2"
              >
                Back to Login
              </button>
            </form>
          )}

          {/* STEP 2: RESET PASSWORD */}
          {step === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4 mt-6">
              <div>
                <label className="block text-gray-700 text-[10px] font-bold mb-1 uppercase tracking-wider">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl py-2 px-4 text-gray-900 text-xs focus:outline-none focus:border-emerald-500 focus:bg-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-gray-700 text-[10px] font-bold mb-1 uppercase tracking-wider">Confirm Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl py-2 px-4 text-gray-900 text-xs focus:outline-none focus:border-emerald-500 focus:bg-white transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-xl transition-colors mt-4 flex items-center justify-center gap-2"
              >
                {loading ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}