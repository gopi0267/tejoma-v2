/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, X, RefreshCw, AlertCircle, ClipboardList, Clock, CheckCircle2, XCircle,
  Eye, Check, Ban, ChevronLeft, ChevronRight, Filter
} from 'lucide-react';
import { apiFetch } from '../utils/apiFetch.js';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint.js';

interface TenantRequest {
  id: number;
  company_name: string;
  company_website: string | null;
  industry: string | null;
  company_size: string | null;
  business_email: string;
  company_phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  admin_name: string;
  admin_email: string;
  admin_phone: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_notes: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  resulting_company_id: number | null;
  resulting_user_id: number | null;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

const PAGE_SIZE = 25;

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

const statusBadgeClass = (status: string) =>
  status === 'approved' ? 'text-emerald-700 border-emerald-100 bg-emerald-50'
    : status === 'rejected' ? 'text-rose-700 border-rose-100 bg-rose-50'
    : 'text-amber-700 border-amber-100 bg-amber-50';

export default function TenantRequests() {
  const { isMobile } = useResponsiveBreakpoint();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [industry, setIndustry] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [rows, setRows] = useState<TenantRequest[]>([]);
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
    if (industry) params.set('industry', industry);
    if (companyName) params.set('companyName', companyName);
    if (businessEmail) params.set('businessEmail', businessEmail);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (sortBy) params.set('sortBy', sortBy);
    return params;
  }, [page, search, statusTab, industry, companyName, businessEmail, dateFrom, dateTo, sortBy]);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/api/admin/company-requests?${buildQuery().toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load tenant requests.');
      const json = await res.json();
      setRows(json.data);
      setStats(json.stats);
      setTotalRecords(json.totalRecords);
      setTotalPages(json.totalPages);
    } catch (err: any) {
      setError(err.message || 'Failed to load tenant requests.');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const [viewing, setViewing] = useState<TenantRequest | null>(null);

  // Approve confirmation
  const [approving, setApproving] = useState<TenantRequest | null>(null);
  const [approveError, setApproveError] = useState('');
  const [approveSaving, setApproveSaving] = useState(false);

  const runApprove = async () => {
    if (!approving) return;
    setApproveSaving(true);
    setApproveError('');
    try {
      const res = await apiFetch(`/api/admin/company-requests/${approving.id}/approve`, { method: 'PATCH' });
      const json = await res.json();
      if (!res.ok) { setApproveError(json.error || 'Failed to approve request'); return; }
      setApproving(null);
      fetchList();
    } finally {
      setApproveSaving(false);
    }
  };

  // Reject with required reason
  const [rejecting, setRejecting] = useState<TenantRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);

  const openReject = (r: TenantRequest) => {
    setRejecting(r);
    setRejectReason('');
    setRejectError('');
  };

  const runReject = async () => {
    if (!rejecting) return;
    if (rejectReason.trim().length < 3) { setRejectError('Please provide a reason (at least 3 characters)'); return; }
    setRejectSaving(true);
    setRejectError('');
    try {
      const res = await apiFetch(`/api/admin/company-requests/${rejecting.id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setRejectError(json.error || 'Failed to reject request'); return; }
      setRejecting(null);
      fetchList();
    } finally {
      setRejectSaving(false);
    }
  };

  const statCards = stats ? [
    { label: 'Total Requests', value: stats.total, icon: ClipboardList, color: 'indigo' },
    { label: 'Pending', value: stats.pending, icon: Clock, color: 'amber' },
    { label: 'Approved', value: stats.approved, icon: CheckCircle2, color: 'emerald' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'rose' },
  ] : [];
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600', amber: 'bg-amber-50 text-amber-600',
  };

  const clearFilters = () => {
    setIndustry(''); setCompanyName(''); setBusinessEmail(''); setDateFrom(''); setDateTo('');
    setPage(1);
  };

  return (
    <div className="p-4 sm:p-8 space-y-6 h-full overflow-y-auto max-w-7xl mx-auto text-slate-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Tenant Requests</h1>
          <p className="text-xs text-slate-500 mt-1">Review company registration requests. Approving creates the company, its admin account, and activates login.</p>
        </div>
        <button onClick={fetchList} className="p-2 border border-slate-200 hover:bg-slate-50 rounded-xl transition-all text-slate-500 cursor-pointer" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
        {(['all', 'pending', 'approved', 'rejected'] as const).map((t) => (
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

      {/* Search + sort + filter toggle */}
      <div className="flex gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by company name, business email, admin name, or admin email..."
            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
          />
        </div>
        <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }} className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs">
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="company_name">Company Name</option>
          <option value="status">Status</option>
        </select>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold cursor-pointer ${showFilters ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          <Filter className="w-4 h-4" /> Filters
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs shadow-xs">
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Industry</label>
            <input type="text" value={industry} onChange={(e) => { setIndustry(e.target.value); setPage(1); }} placeholder="Technology" className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Company Name</label>
            <input type="text" value={companyName} onChange={(e) => { setCompanyName(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Business Email</label>
            <input type="text" value={businessEmail} onChange={(e) => { setBusinessEmail(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">From</label>
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
            </div>
            <div className="flex-1">
              <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">To</label>
              <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
            </div>
          </div>
          <div className="col-span-2 sm:col-span-4 flex justify-end">
            <button onClick={clearFilters} className="text-slate-500 hover:text-rose-600 font-bold text-[11px] cursor-pointer">Clear all filters</button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Table / cards */}
      {loading ? (
        <div className="p-10 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading tenant requests...</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-slate-400 text-center py-10 text-xs">No requests matched the current search/filters.</p>
      ) : isMobile ? (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs space-y-2">
              <div className="flex justify-between items-start">
                <div className="overflow-hidden">
                  <h4 className="font-bold text-slate-900 text-sm truncate">{r.company_name}</h4>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{r.admin_name} · {r.admin_email}</p>
                </div>
                <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border flex-shrink-0 ${statusBadgeClass(r.status)}`}>{r.status}</span>
              </div>
              <div className="flex justify-between items-center text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                <span>{formatDate(r.created_at)}</span>
              </div>
              <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-2">
                <button onClick={() => setViewing(r)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`View ${r.company_name}`}><Eye className="w-3.5 h-3.5" /></button>
                {r.status === 'pending' && (
                  <>
                    <button onClick={() => setApproving(r)} className="text-slate-400 hover:text-emerald-600 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`Approve ${r.company_name}`}><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => openReject(r)} className="text-slate-400 hover:text-rose-600 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" aria-label={`Reject ${r.company_name}`}><Ban className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[9px] border-b border-slate-100">
                <th className="p-4 pl-6">Company</th>
                <th className="p-4">Website</th>
                <th className="p-4">Industry</th>
                <th className="p-4">Business Email</th>
                <th className="p-4">Admin</th>
                <th className="p-4">Phone</th>
                <th className="p-4">Submitted</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 pl-6 font-semibold text-slate-800">{r.company_name}</td>
                  <td className="p-4 text-slate-600">{r.company_website || '-'}</td>
                  <td className="p-4 text-slate-600">{r.industry || '-'}</td>
                  <td className="p-4 text-slate-600">{r.business_email}</td>
                  <td className="p-4 text-slate-600">{r.admin_name}<div className="text-[10px] text-slate-400">{r.admin_email}</div></td>
                  <td className="p-4 text-slate-600">{r.admin_phone || '-'}</td>
                  <td className="p-4 text-slate-500 font-mono text-[10px]">{formatDate(r.created_at)}</td>
                  <td className="p-4"><span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusBadgeClass(r.status)}`}>{r.status}</span></td>
                  <td className="p-4 text-right pr-6">
                    <div className="flex justify-end gap-2.5">
                      <button onClick={() => setViewing(r)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="View" aria-label={`View ${r.company_name}`}><Eye className="w-3.5 h-3.5" /></button>
                      {r.status === 'pending' && (
                        <>
                          <button onClick={() => setApproving(r)} className="text-slate-400 hover:text-emerald-600 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="Approve" aria-label={`Approve ${r.company_name}`}><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openReject(r)} className="text-slate-400 hover:text-rose-600 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="Reject" aria-label={`Reject ${r.company_name}`}><Ban className="w-3.5 h-3.5" /></button>
                        </>
                      )}
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
          <span>Showing page {page} of {totalPages} ({totalRecords} total requests)</span>
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
                <h2 className="text-xl font-bold text-slate-900">{viewing.company_name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{viewing.business_email}</p>
              </div>
              <button onClick={() => setViewing(null)} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-300 rounded-lg transition-colors cursor-pointer">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Company Information</p>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div><span className="text-slate-500">Website</span><div className="font-medium text-slate-900">{viewing.company_website || '-'}</div></div>
                  <div><span className="text-slate-500">Industry</span><div className="font-medium text-slate-900">{viewing.industry || '-'}</div></div>
                  <div><span className="text-slate-500">Size</span><div className="font-medium text-slate-900">{viewing.company_size || '-'}</div></div>
                  <div><span className="text-slate-500">Company Phone</span><div className="font-medium text-slate-900">{viewing.company_phone || '-'}</div></div>
                </div>
              </div>
              <div className="pt-6 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Admin Information</p>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div><span className="text-slate-500">Name</span><div className="font-medium text-slate-900">{viewing.admin_name}</div></div>
                  <div><span className="text-slate-500">Email</span><div className="font-medium text-slate-900">{viewing.admin_email}</div></div>
                  <div><span className="text-slate-500">Phone</span><div className="font-medium text-slate-900">{viewing.admin_phone || '-'}</div></div>
                </div>
              </div>
              <div className="pt-6 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Address</p>
                <p className="text-xs text-slate-900">
                  {[viewing.address, viewing.city, viewing.state, viewing.country].filter(Boolean).join(', ') || '-'}
                </p>
              </div>
              <div className="pt-6 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs">
                <div><span className="text-slate-500">Registration Date</span><div className="font-medium text-slate-900">{formatDate(viewing.created_at)}</div></div>
                <div><span className="text-slate-500">Status</span><div><span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusBadgeClass(viewing.status)}`}>{viewing.status}</span></div></div>
              </div>
              {viewing.status !== 'pending' && (
                <div className="pt-6 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Review Notes</p>
                  <p className="text-xs text-slate-900 bg-slate-50 rounded-lg p-3">{viewing.review_notes || '-'}</p>
                  <p className="text-[10px] text-slate-400 mt-2">Reviewed {formatDate(viewing.reviewed_at)}</p>
                </div>
              )}
              <button onClick={() => setViewing(null)} className="w-full px-4 py-2.5 border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 cursor-pointer text-xs">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve confirmation */}
      {approving && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6 space-y-4 text-center">
            <h2 className="text-lg font-bold text-slate-900">Approve {approving.company_name}?</h2>
            <p className="text-xs text-slate-500">
              This creates the company, activates <strong>{approving.admin_email}</strong> as its Company Admin, and lets them log in immediately.
            </p>
            {approveError && <p className="text-rose-600 text-[11px] font-semibold">{approveError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setApproving(null)} className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg cursor-pointer text-xs">Cancel</button>
              <button onClick={runApprove} disabled={approveSaving} className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg cursor-pointer text-xs disabled:opacity-50">
                {approveSaving ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject with required reason */}
      {rejecting && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Reject {rejecting.company_name}?</h2>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejection (shown to the applicant if they ask, kept for audit)"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
            />
            {rejectError && <p className="text-rose-600 text-[11px] font-semibold">{rejectError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setRejecting(null)} className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg cursor-pointer text-xs">Cancel</button>
              <button onClick={runReject} disabled={rejectSaving} className="flex-1 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-lg cursor-pointer text-xs disabled:opacity-50">
                {rejectSaving ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
