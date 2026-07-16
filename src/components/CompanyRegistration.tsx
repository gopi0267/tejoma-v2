/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { CheckCircle, ArrowLeft } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { TextField, PasswordField, PasswordStrengthMeter, ErrorBanner } from './Login.js';

interface CompanyRegistrationProps {
  onBackToLogin: () => void;
}

const EMPTY_FORM = {
  companyName: '', companyWebsite: '', industry: '', companySize: '',
  businessEmail: '', companyPhone: '', country: '', state: '', city: '', address: '',
  adminName: '', adminEmail: '', adminPhone: '', password: '', confirmPassword: '',
};

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

export default function CompanyRegistration({ onBackToLogin }: CompanyRegistrationProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const set = (field: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.companyName || !form.businessEmail || !form.adminName || !form.adminEmail || !form.password) {
      setError('Please complete all required fields.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/company-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName,
          companyWebsite: form.companyWebsite || null,
          industry: form.industry || null,
          companySize: form.companySize || null,
          businessEmail: form.businessEmail,
          companyPhone: form.companyPhone || null,
          country: form.country || null,
          state: form.state || null,
          city: form.city || null,
          address: form.address || null,
          adminName: form.adminName,
          adminEmail: form.adminEmail,
          adminPhone: form.adminPhone || null,
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div id="auth-screen" className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F3F2EF' }}>
        <div className="mb-6 flex flex-col items-center">
          <TejomaLogo size="lg" textColorClass="text-[#1A1A1A]" />
        </div>
        <div className="bg-white rounded-2xl w-full max-w-md shadow-md p-8 sm:p-10 text-center space-y-4">
          <CheckCircle className="w-12 h-12 mx-auto text-[#27AE60]" />
          <h2 className="text-lg font-bold text-[#1A1A1A]">Registration submitted</h2>
          <p className="text-[#666666] text-sm">
            Thanks, {form.adminName.split(' ')[0]}. Your company registration for <strong>{form.companyName}</strong> is now pending administrator approval.
            You'll be able to log in with <strong>{form.adminEmail}</strong> once it's reviewed.
          </p>
          <button onClick={onBackToLogin} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors cursor-pointer shadow-sm">
            Back to Log In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="company-registration-screen" className="min-h-screen flex flex-col items-center py-10 px-4" style={{ backgroundColor: '#F3F2EF' }}>
      <div className="mb-6 flex flex-col items-center">
        <TejomaLogo size="lg" textColorClass="text-[#1A1A1A]" />
        <p className="text-[#666666] text-sm mt-2">Register your company to get started with Tejoma</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl w-full max-w-2xl shadow-md p-8 sm:p-10 space-y-8">
        <button type="button" onClick={onBackToLogin} className="flex items-center gap-1 text-xs text-[#666666] hover:text-[#1A1A1A] cursor-pointer">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Log In
        </button>

        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A] mb-1">Company Information</h2>
          <p className="text-xs text-[#666666] mb-4">A Tejoma Super Admin will review this before your workspace is created.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="Company name" value={form.companyName} onChange={set('companyName')} placeholder="Acme Talent Inc" />
            <TextField label="Company website" value={form.companyWebsite} onChange={set('companyWebsite')} placeholder="https://acmetalent.com" />
            <TextField label="Industry" value={form.industry} onChange={set('industry')} placeholder="Technology, Healthcare, Finance..." />
            <div>
              <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">Company size</label>
              <select
                value={form.companySize}
                onChange={(e) => setForm((f) => ({ ...f, companySize: e.target.value }))}
                className="w-full bg-white border border-[#E0E0E0] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
              >
                <option value="">Select a range</option>
                {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
              </select>
            </div>
            <TextField label="Business email" type="email" value={form.businessEmail} onChange={set('businessEmail')} placeholder="hello@acmetalent.com" />
            <TextField label="Company phone" value={form.companyPhone} onChange={set('companyPhone')} placeholder="+91 98765 43210" />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A] mb-4">Address</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="Country" value={form.country} onChange={set('country')} placeholder="India" />
            <TextField label="State" value={form.state} onChange={set('state')} placeholder="Telangana" />
            <TextField label="City" value={form.city} onChange={set('city')} placeholder="Hyderabad" />
            <TextField label="Address" value={form.address} onChange={set('address')} placeholder="Street, building, suite" />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A] mb-4">Company Admin Account</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="Admin name" value={form.adminName} onChange={set('adminName')} placeholder="Priya Sharma" />
            <TextField label="Admin email" type="email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="priya@acmetalent.com" hint="You'll log in with this once approved." />
            <TextField label="Admin phone" value={form.adminPhone} onChange={set('adminPhone')} placeholder="+91 98765 43210" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <PasswordField label="Password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" />
              <PasswordStrengthMeter password={form.password} />
            </div>
            <PasswordField label="Confirm password" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Re-enter password" />
          </div>
        </div>

        {error && <ErrorBanner text={error} />}

        <p className="text-xs text-[#666666] text-center">
          By submitting, you agree to Tejoma's Terms of Service and Privacy Policy.
        </p>

        <button type="submit" disabled={loading} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-bold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60">
          {loading ? 'Submitting...' : 'Submit for Approval'}
        </button>
      </form>
    </div>
  );
}
