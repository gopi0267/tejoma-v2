/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, X, RefreshCw, AlertCircle, Users as UsersIcon, UserCheck, UserX, ShieldCheck,
  Eye, Pencil, Ban, CheckCircle2, KeyRound, Trash2, ChevronLeft, ChevronRight, Copy, Check, PlusCircle
} from 'lucide-react';
import { apiFetch } from '../utils/apiFetch.js';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint.js';
import { useAuth } from '../context/AuthContext.js';

interface ManagedUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'recruiter';
  is_active: boolean;
  created_at: string;
  created_by: number | null;
  updated_by: number | null;
  disabled_by: number | null;
  password_reset_by: number | null;
  last_login_at: string | null;
}

interface Stats {
  totalUsers: number;
  totalRecruiters: number;
  activeUsers: number;
  disabledUsers: number;
  adminUsers: number;
}

const PAGE_SIZE = 25;
const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '', role: 'recruiter' as 'admin' | 'recruiter' };

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function actorLabel(id: number | null) {
  return id ? `User #${id}` : '-';
}

export default function UserManagement() {
  const { isMobile } = useResponsiveBreakpoint();
  const { user: currentUser } = useAuth();

  // Search / filters / sort / pagination
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<'all' | 'active' | 'disabled'>('all');
  const [roleFilter, setRoleFilter] = useState<'' | 'admin' | 'recruiter'>('');
  const [sortBy, setSortBy] = useState('created_desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (search) params.set('search', search);
    if (statusTab !== 'all') params.set('status', statusTab);
    if (roleFilter) params.set('role', roleFilter);
    if (sortBy) params.set('sortBy', sortBy);
    return params;
  }, [page, search, statusTab, roleFilter, sortBy]);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/api/users?${buildQuery().toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load users.');
      const json = await res.json();
      setRows(json.data);
      setStats(json.stats);
      setTotalRecords(json.totalRecords);
      setTotalPages(json.totalPages);
    } catch (err: any) {
      setError(err.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // View detail modal
  const [viewing, setViewing] = useState<ManagedUser | null>(null);

  // Add / Edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [passwordMode, setPasswordMode] = useState<'generate' | 'set'>('generate');
  const [passwordInput, setPasswordInput] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const openAddForm = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setPasswordMode('generate');
    setPasswordInput('');
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (u: ManagedUser) => {
    const [firstName, ...rest] = u.name.split(' ');
    setEditingUser(u);
    setForm({ firstName: firstName || '', lastName: rest.join(' '), email: u.email || '', phone: u.phone || '', role: u.role });
    setFormError('');
    setShowForm(true);
  };

  // Generated-password reveal banner (shown once, after Add or Reset Password)
  const [revealedPassword, setRevealedPassword] = useState<{ forName: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyPassword = async () => {
    if (!revealedPassword) return;
    try {
      await navigator.clipboard.writeText(revealedPassword.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable - the password is still visible to copy manually */ }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const name = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    if (!name) { setFormError('First and last name are required'); return; }
    if (!form.email.trim() && !form.phone.trim()) { setFormError('Email or phone is required'); return; }
    if (passwordMode === 'set' && !editingUser && !passwordInput) { setFormError('Enter a password or switch to auto-generate'); return; }

    setSaving(true);
    try {
      if (editingUser) {
        const res = await apiFetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email: form.email.trim() || null, phone: form.phone.trim() || null, role: form.role }),
        });
        const json = await res.json();
        if (!res.ok) { setFormError(json.error || 'Failed to update recruiter'); return; }
        setShowForm(false);
        fetchList();
      } else {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            role: form.role,
            generatePassword: passwordMode === 'generate',
            password: passwordMode === 'set' ? passwordInput : undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) { setFormError(json.error || 'Failed to add recruiter'); return; }
        setShowForm(false);
        fetchList();
        if (json.generated_password) {
          setRevealedPassword({ forName: name, password: json.generated_password });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  // Reset password modal
  const [resettingUser, setResettingUser] = useState<ManagedUser | null>(null);
  const [resetMode, setResetMode] = useState<'generate' | 'set'>('generate');
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);

  const openResetPassword = (u: ManagedUser) => {
    setResettingUser(u);
    setResetMode('generate');
    setResetPasswordInput('');
    setResetError('');
  };

  const submitResetPassword = async () => {
    if (!resettingUser) return;
    if (resetMode === 'set' && !resetPasswordInput) { setResetError('Enter a password or switch to auto-generate'); return; }
    setResetting(true);
    setResetError('');
    try {
      const res = await apiFetch(`/api/users/${resettingUser.id}/reset-password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatePassword: resetMode === 'generate', password: resetMode === 'set' ? resetPasswordInput : undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setResetError(json.error || 'Failed to reset password'); return; }
      setResettingUser(null);
      if (json.generated_password) {
        setRevealedPassword({ forName: resettingUser.name, password: json.generated_password });
      }
    } finally {
      setResetting(false);
    }
  };

  // Enable / Disable / Soft delete confirmation
  const [confirmAction, setConfirmAction] = useState<{ type: 'disable' | 'enable' | 'delete'; user: ManagedUser } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    setConfirming(true);
    try {
      const { type, user } = confirmAction;
      const res = type === 'delete'
        ? await apiFetch(`/api/users/${user.id}`, { method: 'DELETE' })
        : await apiFetch(`/api/users/${user.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: type === 'enable' }),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Action failed'); }
      setConfirmAction(null);
      fetchList();
    } finally {
      setConfirming(false);
    }
  };

  const statCards = stats ? [
    { label: 'Total Users', value: stats.totalUsers, icon: UsersIcon, color: 'indigo' },
    { label: 'Total Recruiters', value: stats.totalRecruiters, icon: UsersIcon, color: 'slate' },
    { label: 'Active Users', value: stats.activeUsers, icon: UserCheck, color: 'emerald' },
    { label: 'Disabled Users', value: stats.disabledUsers, icon: UserX, color: 'rose' },
    { label: 'Admin Users', value: stats.adminUsers, icon: ShieldCheck, color: 'amber' },
  ] : [];
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600', amber: 'bg-amber-50 text-amber-600', slate: 'bg-slate-100 text-slate-600',
  };

  const roleBadgeClass = (role: string) => role === 'admin' ? 'text-indigo-700 border-indigo-100 bg-indigo-50' : 'text-slate-600 border-slate-200 bg-slate-50';
  const statusBadgeClass = (active: boolean) => active ? 'text-emerald-700 border-emerald-100 bg-emerald-50' : 'text-rose-700 border-rose-100 bg-rose-50';

  const passwordFieldsUI = (mode: 'generate' | 'set', setMode: (m: 'generate' | 'set') => void, value: string, setValue: (v: string) => void) => (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('generate')} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${mode === 'generate' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          Auto-generate secure password
        </button>
        <button type="button" onClick={() => setMode('set')} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${mode === 'set' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          Set password manually
        </button>
      </div>
      {mode === 'set' && (
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="At least 8 characters, mixed case, number, symbol"
          className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        />
      )}
    </div>
  );

  return (
    <div className="p-4 sm:p-8 space-y-6 h-full overflow-y-auto max-w-7xl mx-auto text-slate-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">User Management</h1>
          <p className="text-xs text-slate-500 mt-1">Add recruiters to your company - they'll log in with their own email and share your team's data.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchList} className="p-2 border border-slate-200 hover:bg-slate-50 rounded-xl transition-all text-slate-500 cursor-pointer" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openAddForm} className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-emerald-100 cursor-pointer">
            <PlusCircle className="w-4 h-4" /> Add Recruiter
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200/70 p-4 rounded-2xl flex flex-col justify-between shadow-xs relative overflow-hidden group">
            <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-16 h-16 bg-slate-50 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
            <div className="flex items-center justify-between relative z-10">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{c.label}</span>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colorMap[c.color]}`}>
                <c.icon className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl font-extrabold text-slate-950 font-mono tracking-tight">{c.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 text-xs">
        {(['all', 'active', 'disabled'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setStatusTab(t); setPage(1); }}
            className={`px-3.5 py-1.5 rounded-xl font-bold capitalize transition-colors cursor-pointer ${
              statusTab === t ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Search + role filter + sort */}
      <div className="flex flex-col sm:flex-row gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, email, or phone..."
            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
          />
        </div>
        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value as any); setPage(1); }} className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs">
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="recruiter">Recruiter</option>
        </select>
        <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }} className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs">
          <option value="created_desc">Newest First</option>
          <option value="created_asc">Oldest First</option>
          <option value="name_asc">Name A-Z</option>
          <option value="name_desc">Name Z-A</option>
          <option value="last_login_desc">Last Login</option>
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Table / cards */}
      {loading ? (
        <div className="p-10 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading users...</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-slate-400 text-center py-10 text-xs">No users matched the current search/filters.</p>
      ) : isMobile ? (
        <div className="space-y-3">
          {rows.map((u) => (
            <div key={u.id} className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs space-y-2">
              <div className="flex justify-between items-start">
                <div className="overflow-hidden">
                  <h4 className="font-bold text-slate-900 text-sm truncate">{u.name}</h4>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{u.email || u.phone}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${roleBadgeClass(u.role)}`}>{u.role}</span>
                  <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusBadgeClass(u.is_active)}`}>{u.is_active ? 'Active' : 'Disabled'}</span>
                </div>
              </div>
              <div className="flex justify-between items-center text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                <span>Last login: {formatDate(u.last_login_at)}</span>
              </div>
              <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-2">
                <button onClick={() => setViewing(u)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`View ${u.name}`}><Eye className="w-3.5 h-3.5" /></button>
                <button onClick={() => openEditForm(u)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`Edit ${u.name}`}><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => openResetPassword(u)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`Reset password for ${u.name}`}><KeyRound className="w-3.5 h-3.5" /></button>
                {u.is_active ? (
                  <button disabled={u.id === currentUser?.id} onClick={() => setConfirmAction({ type: 'disable', user: u })} className="text-slate-400 hover:text-amber-600 disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`Disable ${u.name}`}><Ban className="w-3.5 h-3.5" /></button>
                ) : (
                  <button onClick={() => setConfirmAction({ type: 'enable', user: u })} className="text-slate-400 hover:text-emerald-600 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`Enable ${u.name}`}><CheckCircle2 className="w-3.5 h-3.5" /></button>
                )}
                <button disabled={u.id === currentUser?.id} onClick={() => setConfirmAction({ type: 'delete', user: u })} className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`Delete ${u.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[9px] border-b border-slate-100">
                <th className="p-4 pl-6">Name</th>
                <th className="p-4">Email</th>
                <th className="p-4">Phone</th>
                <th className="p-4">Role</th>
                <th className="p-4">Status</th>
                <th className="p-4">Last Login</th>
                <th className="p-4">Created</th>
                <th className="p-4 text-right pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 pl-6 font-semibold text-slate-800">{u.name}{u.id === currentUser?.id && <span className="ml-1.5 text-[9px] text-slate-400 font-normal">(you)</span>}</td>
                  <td className="p-4 text-slate-600">{u.email || '-'}</td>
                  <td className="p-4 text-slate-600">{u.phone || '-'}</td>
                  <td className="p-4"><span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${roleBadgeClass(u.role)}`}>{u.role}</span></td>
                  <td className="p-4"><span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusBadgeClass(u.is_active)}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                  <td className="p-4 text-slate-500 font-mono text-[10px]">{formatDate(u.last_login_at)}</td>
                  <td className="p-4 text-slate-500 font-mono text-[10px]">{formatDate(u.created_at)}</td>
                  <td className="p-4 text-right pr-6">
                    <div className="flex justify-end gap-2.5">
                      <button onClick={() => setViewing(u)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="View" aria-label={`View ${u.name}`}><Eye className="w-3.5 h-3.5" /></button>
                      <button onClick={() => openEditForm(u)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="Edit" aria-label={`Edit ${u.name}`}><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => openResetPassword(u)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="Reset Password" aria-label={`Reset password for ${u.name}`}><KeyRound className="w-3.5 h-3.5" /></button>
                      {u.is_active ? (
                        <button disabled={u.id === currentUser?.id} onClick={() => setConfirmAction({ type: 'disable', user: u })} className="text-slate-400 hover:text-amber-600 disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title={u.id === currentUser?.id ? "You can't disable your own account" : 'Disable'} aria-label={`Disable ${u.name}`}><Ban className="w-3.5 h-3.5" /></button>
                      ) : (
                        <button onClick={() => setConfirmAction({ type: 'enable', user: u })} className="text-slate-400 hover:text-emerald-600 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="Enable" aria-label={`Enable ${u.name}`}><CheckCircle2 className="w-3.5 h-3.5" /></button>
                      )}
                      <button disabled={u.id === currentUser?.id} onClick={() => setConfirmAction({ type: 'delete', user: u })} className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title={u.id === currentUser?.id ? "You can't delete your own account" : 'Delete'} aria-label={`Delete ${u.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Showing page {page} of {totalPages} ({totalRecords} total users)</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page" className="min-w-[44px] min-h-[44px] flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page" className="min-w-[44px] min-h-[44px] flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* View detail modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-auto shadow-2xl">
            <div className="sticky top-0 bg-gradient-to-r from-slate-50 to-slate-100 flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{viewing.name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{viewing.email || viewing.phone}</p>
              </div>
              <button onClick={() => setViewing(null)} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-300 rounded-lg transition-colors cursor-pointer">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Role</p><p className="text-slate-900 font-medium mt-2 capitalize">{viewing.role}</p></div>
                <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Status</p><p className="text-slate-900 font-medium mt-2">{viewing.is_active ? 'Active' : 'Disabled'}</p></div>
                <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Phone</p><p className="text-slate-900 font-medium mt-2">{viewing.phone || '-'}</p></div>
                <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Email</p><p className="text-slate-900 font-medium mt-2">{viewing.email || '-'}</p></div>
              </div>
              <div className="pt-6 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Audit Trail</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Created</span><div className="font-bold text-slate-800">{formatDate(viewing.created_at)}</div><div className="text-slate-500 mt-0.5">by {actorLabel(viewing.created_by)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Last Updated</span><div className="font-bold text-slate-800">by {actorLabel(viewing.updated_by)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Last Login</span><div className="font-bold text-slate-800">{formatDate(viewing.last_login_at)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Password Last Reset</span><div className="font-bold text-slate-800">by {actorLabel(viewing.password_reset_by)}</div></div>
                  {!viewing.is_active && (
                    <div className="bg-rose-50 rounded-lg p-3 col-span-2"><span className="text-rose-500">Disabled</span><div className="font-bold text-rose-700">by {actorLabel(viewing.disabled_by)}</div></div>
                  )}
                </div>
              </div>
              <button onClick={() => setViewing(null)} className="w-full px-4 py-2.5 border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 cursor-pointer text-xs">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-auto shadow-2xl">
            <div className="sticky top-0 bg-gradient-to-r from-slate-50 to-slate-100 flex items-center justify-between p-6 border-b border-slate-200 z-10">
              <h2 className="text-lg font-bold text-slate-900">{editingUser ? 'Edit Recruiter' : 'Add Recruiter'}</h2>
              <button onClick={() => setShowForm(false)} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-300 rounded-lg transition-colors cursor-pointer">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <form onSubmit={submitForm} className="p-6 space-y-4">
              {!editingUser && (
                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  This recruiter joins your existing company workspace automatically - they'll log in with their own email/password and see the same jobs, candidates, and reviews your team does.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">First Name</label>
                  <input type="text" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500 text-xs" />
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Last Name</label>
                  <input type="text" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500 text-xs" />
                </div>
              </div>
              <div>
                <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="recruiter@company.com" className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500 text-xs" />
              </div>
              <div>
                <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500 text-xs" />
              </div>
              <div>
                <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Role</label>
                <div className="flex gap-2">
                  {(['recruiter', 'admin'] as const).map((r) => (
                    <button key={r} type="button" onClick={() => setForm({ ...form, role: r })} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold capitalize cursor-pointer ${form.role === r ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Password</label>
                  {passwordFieldsUI(passwordMode, setPasswordMode, passwordInput, setPasswordInput)}
                </div>
              )}
              {formError && <p className="text-rose-600 text-[11px] font-semibold">{formError}</p>}
              <div className="pt-2 flex justify-end gap-3 border-t border-slate-100">
                <button type="button" onClick={() => setShowForm(false)} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs cursor-pointer">
                  {saving ? 'Saving...' : editingUser ? 'Save Changes' : 'Add Recruiter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resettingUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Reset Password</h2>
              <p className="text-xs text-slate-500 mt-1">For {resettingUser.name}. They'll keep logging in the same way with their new password - no forced change screen.</p>
            </div>
            <div className="p-6 space-y-4">
              {passwordFieldsUI(resetMode, setResetMode, resetPasswordInput, setResetPasswordInput)}
              {resetError && <p className="text-rose-600 text-[11px] font-semibold">{resetError}</p>}
              <div className="flex justify-end gap-3">
                <button onClick={() => setResettingUser(null)} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={submitResetPassword} disabled={resetting} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs cursor-pointer">
                  {resetting ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generated password reveal (shown once) */}
      {revealedPassword && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Password Generated</h2>
            <p className="text-xs text-slate-500">Share this with {revealedPassword.forName} securely - it won't be shown again.</p>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <code className="flex-1 font-mono text-sm text-slate-900 break-all">{revealedPassword.password}</code>
              <button onClick={copyPassword} aria-label="Copy password" className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-500 hover:text-slate-800 cursor-pointer">
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={() => setRevealedPassword(null)} className="w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer text-xs">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Enable / Disable / Delete confirmation */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6 space-y-4 text-center">
            <h2 className="text-lg font-bold text-slate-900">
              {confirmAction.type === 'delete' ? 'Delete User?' : confirmAction.type === 'disable' ? 'Disable User?' : 'Enable User?'}
            </h2>
            <p className="text-xs text-slate-500">
              {confirmAction.type === 'delete'
                ? `${confirmAction.user.name} will lose access immediately and be removed from this list.`
                : confirmAction.type === 'disable'
                ? `${confirmAction.user.name} will be logged out and unable to sign in until re-enabled.`
                : `${confirmAction.user.name} will regain access and be able to sign in again.`}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAction(null)} className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg cursor-pointer text-xs">Cancel</button>
              <button
                onClick={runConfirmAction}
                disabled={confirming}
                className={`flex-1 px-3 py-2 text-white font-semibold rounded-lg cursor-pointer text-xs disabled:opacity-50 ${confirmAction.type === 'enable' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
              >
                {confirming ? 'Working...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
