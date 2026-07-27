/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Plus, Upload, X, AlertCircle, CheckCircle, Loader, Search, Filter, Trash2, Eye } from 'lucide-react';
import { Candidate } from '../types.js';
import { apiFetch } from '../utils/apiFetch.js';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint.js';
import CandidateProfileView from './CandidateProfileView.js';

interface CandidateManagementProps {
  candidates: Candidate[];
  fetchCandidates: () => void;
}

export default function CandidateManagement({ candidates, fetchCandidates }: CandidateManagementProps) {
  const { isMobile } = useResponsiveBreakpoint();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [skills, setSkills] = useState('');
  const [experience, setExperience] = useState('0');
  const [location, setLocation] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [salary, setSalary] = useState('0');

  // Bulk import
  const [bulkData, setBulkData] = useState('');

  // Filter candidates by search
  const filteredCandidates = candidates.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ==================== MANUAL ADD ====================
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim() || !email.trim()) {
      setMessage({ type: 'error', text: 'Name and Email are required!' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await apiFetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          skills: skills.trim() ? skills.split(',').map(s => s.trim()) : [],
          years_of_experience: parseInt(experience) || 0,
          current_location: location.trim(),
          current_company: company.trim(),
          current_job_title: jobTitle.trim(),
          salary_expectation: parseInt(salary) || 0,
          education: '',
          notice_period: '',
          willingness_to_relocate: false,
          industry_domain: '',
          certifications: [],
          resume_text: `${name.trim()} - ${jobTitle.trim() || 'Professional'}`
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add candidate');
      }

      setMessage({ type: 'success', text: `✅ "${name}" added successfully!` });
      
      // Reset form
      setName('');
      setEmail('');
      setPhone('');
      setSkills('');
      setExperience('0');
      setLocation('');
      setCompany('');
      setJobTitle('');
      setSalary('0');

      setShowAddForm(false);
      
      setTimeout(() => {
        fetchCandidates();
      }, 500);
    } catch (error: any) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  // ==================== BULK IMPORT ====================
  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bulkData.trim()) {
      setMessage({ type: 'error', text: 'Please paste data' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      let parsed = JSON.parse(bulkData);
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }

      const response = await apiFetch('/api/candidates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: parsed.map((c: any) => ({
            name: c.name || '',
            email: c.email || '',
            phone: c.phone || '',
            skills: typeof c.skills === 'string' ? c.skills.split(',').map((s: string) => s.trim()) : (Array.isArray(c.skills) ? c.skills : []),
            years_of_experience: parseInt(c.years_of_experience || c.experience || 0),
            current_location: c.current_location || c.location || '',
            current_company: c.current_company || c.company || '',
            current_job_title: c.current_job_title || c.job_title || '',
            salary_expectation: parseInt(c.salary_expectation || c.salary || 0),
            education: c.education || '',
            notice_period: c.notice_period || '',
            willingness_to_relocate: c.willingness_to_relocate === true || c.willingness_to_relocate === 'true',
            industry_domain: c.industry_domain || '',
            certifications: Array.isArray(c.certifications) ? c.certifications : [],
            resume_text: `${c.name} - ${c.current_job_title || 'Professional'}`
          }))
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setMessage({ type: 'success', text: `✅ Imported ${data.imported_count} candidates!` });
      setBulkData('');
      setShowBulkImport(false);

      setTimeout(() => {
        fetchCandidates();
      }, 500);
    } catch (error: any) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  // ==================== DELETE CANDIDATE ====================
  const handleDeleteCandidate = async (candidateId: number) => {
    if (!window.confirm('Are you sure you want to delete this candidate?')) {
      return;
    }

    try {
      const response = await apiFetch(`/api/candidates/${candidateId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Candidate deleted successfully' });
        fetchCandidates();
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="px-4 sm:px-8 py-4 sm:py-6 bg-white border-b border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Candidate Management</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Manage your talent pool • {candidates.length} total candidates</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold py-2.5 px-5 rounded-lg cursor-pointer transition-all shadow-md hover:shadow-lg min-h-[44px]"
            >
              <Plus className="w-5 h-5" />
              Add Candidate
            </button>
            <button
              onClick={() => setShowBulkImport(true)}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-2.5 px-5 rounded-lg cursor-pointer transition-all shadow-md hover:shadow-lg min-h-[44px]"
            >
              <Upload className="w-5 h-5" />
              Bulk Import
            </button>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`mx-8 mt-4 p-4 rounded-lg flex items-center gap-3 font-medium animate-fade-in ${
          message.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Search & Filter */}
      <div className="px-4 sm:px-8 py-4 bg-white border-b border-slate-200 mt-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>
          <button
            aria-label="Filter candidates"
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg cursor-pointer transition-colors min-h-[44px]"
          >
            <Filter className="w-4 h-4" />
            Filter
          </button>
        </div>
      </div>

      {/* Candidates Table */}
      <div className="flex-1 overflow-auto p-4 sm:p-8">
        {filteredCandidates.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Plus className="w-8 h-8 text-slate-500" />
              </div>
              <p className="text-slate-600 font-semibold text-lg">No candidates found</p>
              <p className="text-slate-500 text-sm mt-2">
                {candidates.length === 0
                  ? 'Add candidates manually or import them in bulk to get started'
                  : 'Try adjusting your search filters'}
              </p>
            </div>
          </div>
        ) : isMobile ? (
          /* Mobile card view - mirrors JobManagement.tsx's table/card pattern for consistency */
          <div className="space-y-3">
            {filteredCandidates.map((candidate) => (
              <div
                key={candidate.id}
                className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs space-y-3 cursor-pointer"
                onClick={() => setSelectedCandidate(candidate)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="overflow-hidden min-w-0">
                    <h4 className="font-bold text-slate-900 text-sm truncate" title={candidate.name}>{candidate.name}</h4>
                    <p className="text-xs text-slate-600 truncate mt-0.5" title={candidate.email}>{candidate.email}</p>
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-100 pt-2">
                  <span className="truncate min-w-0" title={candidate.current_job_title || ''}>{candidate.current_job_title || '-'}</span>
                  <span className="flex-shrink-0 ml-2">{candidate.years_of_experience || '-'}</span>
                </div>
                <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setSelectedCandidate(candidate)}
                    aria-label={`View details for ${candidate.name}`}
                    className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg cursor-pointer transition-colors text-xs font-semibold"
                  >
                    <Eye className="w-4 h-4" /> View
                  </button>
                  <button
                    onClick={() => handleDeleteCandidate(candidate.id)}
                    aria-label={`Delete ${candidate.name}`}
                    className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] bg-red-100 hover:bg-red-200 text-red-600 rounded-lg cursor-pointer transition-colors text-xs font-semibold"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 overflow-x-auto">
            {/* Table Header */}
            <div className="grid grid-cols-5 gap-4 px-6 py-3 bg-slate-200 rounded-lg font-semibold text-sm text-slate-700 min-w-[640px]">
              <div className="min-w-0">Name</div>
              <div className="min-w-0">Email</div>
              <div className="min-w-0">Position</div>
              <div className="min-w-0">Experience</div>
              <div className="min-w-0">Actions</div>
            </div>

            {/* Table Rows */}
            {filteredCandidates.map((candidate) => (
              <div key={candidate.id} className="grid grid-cols-5 gap-4 px-6 py-4 bg-white rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all items-center min-w-[640px]">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate" title={candidate.name}>{candidate.name}</p>
                  {candidate.current_company && <p className="text-xs text-slate-600 mt-1 truncate" title={candidate.current_company}>{candidate.current_company}</p>}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-600 truncate" title={candidate.email}>{candidate.email}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-600 truncate" title={candidate.current_job_title || ''}>{candidate.current_job_title || '-'}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-600 truncate" title={candidate.years_of_experience}>{candidate.years_of_experience || '-'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedCandidate(candidate)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg cursor-pointer transition-colors"
                    title="View details"
                    aria-label={`View details for ${candidate.name}`}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteCandidate(candidate.id)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-600 rounded-lg cursor-pointer transition-colors"
                    title="Delete"
                    aria-label={`Delete ${candidate.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ==================== ADD FORM MODAL ==================== */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-auto shadow-2xl">
            <div className="sticky top-0 bg-gradient-to-r from-emerald-50 to-blue-50 flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Add New Candidate</h2>
                <p className="text-xs text-slate-500 mt-1">Fill in the candidate details below</p>
              </div>
              <button onClick={() => setShowAddForm(false)} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-200 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="p-4 sm:p-8 space-y-6">
              {/* Row 1: Name & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Full Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    required
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Email Address *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                    required
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Row 2: Phone & Experience */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Years of Experience</label>
                  <input
                    type="number"
                    value={experience}
                    onChange={(e) => setExperience(e.target.value)}
                    placeholder="5"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Row 3: Skills & Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Skills (comma-separated)</label>
                  <input
                    type="text"
                    value={skills}
                    onChange={(e) => setSkills(e.target.value)}
                    placeholder="React, TypeScript, Node.js"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Austin, TX"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Row 4: Company & Job Title */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Current Company</label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Tech Corp Inc"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Job Title</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="Senior Developer"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Row 5: Salary */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Salary Expectation ($)</label>
                <input
                  type="number"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  placeholder="120000"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-6 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 px-6 py-3 border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-slate-400 text-white font-bold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== BULK IMPORT MODAL ==================== */}
      {showBulkImport && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl">
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Bulk Import Candidates</h2>
                <p className="text-xs text-slate-500 mt-1">Paste JSON data to import multiple candidates at once</p>
              </div>
              <button onClick={() => setShowBulkImport(false)} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-200 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            <form onSubmit={handleBulkImport} className="p-4 sm:p-8 space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">JSON Data *</label>
                <textarea
                  value={bulkData}
                  onChange={(e) => setBulkData(e.target.value)}
                  placeholder={'[{"name":"John","email":"john@test.com","skills":"React,TypeScript","years_of_experience":5,"current_location":"Austin","salary_expectation":120000}]'}
                  rows={12}
                  required
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <p className="text-xs text-slate-600 bg-blue-50 border border-blue-200 p-3 rounded-lg">
                📋 <strong>Required fields:</strong> name, email | <strong>Optional:</strong> phone, skills, years_of_experience, current_location, current_company, current_job_title, salary_expectation, education
              </p>

              <div className="flex gap-3 pt-6 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowBulkImport(false)}
                  className="flex-1 px-6 py-3 border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-400 text-white font-bold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Import Candidates'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== CANDIDATE PROFILE VIEW ==================== */}
      {selectedCandidate && (
        <CandidateProfileView
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onDelete={(id) => {
            handleDeleteCandidate(id);
            setSelectedCandidate(null);
          }}
        />
      )}
    </div>
  );
}