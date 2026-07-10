/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sparkles, Download, Archive, X, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { Candidate } from '../types.js';

interface CandidateMatchingProps {
  selectedCandidates?: Candidate[];
  setSelectedCandidates?: (candidates: Candidate[]) => void;
}

export default function CandidateMatching({ selectedCandidates = [], setSelectedCandidates }: CandidateMatchingProps) {
  const [candidates, setCandidates] = useState<Candidate[]>(selectedCandidates);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);

  useEffect(() => {
    setCandidates(selectedCandidates);
  }, [selectedCandidates]);

  // ==================== REMOVE CANDIDATE ====================
  const handleRemoveCandidate = (candidateId: number) => {
    const updated = candidates.filter(c => c.id !== candidateId);
    setCandidates(updated);
    if (setSelectedCandidates) {
      setSelectedCandidates(updated);
    }
    setMessage({ type: 'success', text: 'Candidate removed from matches' });
    setTimeout(() => setMessage(null), 3000);
  };

  // ==================== EXPORT CANDIDATES ====================
  const handleExportCandidates = () => {
    const data = candidates.map(c => ({
      Name: c.name,
      Email: c.email,
      Phone: c.phone || '',
      Skills: Array.isArray(c.skills) ? c.skills.join(', ') : c.skills,
      Experience: c.years_of_experience || 0,
      Location: c.current_location || '',
      Company: c.current_company || '',
      'Job Title': c.current_job_title || '',
      Salary: c.salary_expectation || 0,
      Education: c.education || ''
    }));

    const csv = [
      Object.keys(data[0]).join(','),
      ...data.map(row => 
        Object.values(row).map(val => {
          const str = String(val);
          return str.includes(',') ? `"${str}"` : str;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matched-candidates-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    setMessage({ type: 'success', text: 'Candidates exported to CSV' });
    setTimeout(() => setMessage(null), 3000);
  };

  // ==================== ARCHIVE ALL ====================
  const handleArchiveAll = () => {
    if (window.confirm(`Archive all ${candidates.length} candidates?`)) {
      setCandidates([]);
      if (setSelectedCandidates) {
        setSelectedCandidates([]);
      }
      setMessage({ type: 'success', text: 'All candidates archived' });
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            Match Candidates ({candidates.length})
          </h2>
          <p className="text-xs text-slate-600 mt-1">Selected candidates from job matches</p>
        </div>
        <div className="flex gap-2">
          {candidates.length > 0 && (
            <>
              <button
                onClick={handleExportCandidates}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg cursor-pointer text-sm transition-colors"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              <button
                onClick={handleArchiveAll}
                className="flex items-center gap-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold py-2 px-4 rounded-lg cursor-pointer text-sm transition-colors"
              >
                <Archive className="w-4 h-4" />
                Archive All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`mx-6 mt-4 p-4 rounded-lg flex items-center gap-3 text-sm font-medium ${
          message.type === 'success' 
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      {/* Candidates Grid */}
      <div className="flex-1 overflow-auto p-6">
        {candidates.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600 font-medium">No matched candidates yet</p>
              <p className="text-slate-500 text-sm mt-2">
                When you select candidates from job matches, they'll appear here
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {candidates.map(candidate => (
              <div
                key={candidate.id}
                className="bg-white rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-lg transition-all overflow-hidden"
              >
                {/* Card Header */}
                <div className="bg-gradient-to-r from-emerald-50 to-blue-50 p-4 border-b border-slate-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 text-lg">{candidate.name}</h3>
                      <p className="text-xs text-slate-600 mt-1">{candidate.email}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveCandidate(candidate.id)}
                      className="text-slate-400 hover:text-red-600 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-3">
                  {/* Job Info */}
                  {candidate.current_job_title && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">Current Role</p>
                      <p className="text-sm text-slate-900 font-medium mt-1">{candidate.current_job_title}</p>
                    </div>
                  )}

                  {/* Experience */}
                  {candidate.years_of_experience && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">Experience</p>
                      <p className="text-sm text-slate-900 font-medium mt-1">{candidate.years_of_experience} years</p>
                    </div>
                  )}

                  {/* Location */}
                  {candidate.current_location && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">Location</p>
                      <p className="text-sm text-slate-900 font-medium mt-1">📍 {candidate.current_location}</p>
                    </div>
                  )}

                  {/* Company */}
                  {candidate.current_company && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">Company</p>
                      <p className="text-sm text-slate-900 font-medium mt-1">{candidate.current_company}</p>
                    </div>
                  )}

                  {/* Skills */}
                  {candidate.skills && candidate.skills.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider mb-2">Skills</p>
                      <div className="flex flex-wrap gap-2">
                        {candidate.skills.slice(0, 5).map((skill, idx) => (
                          <span
                            key={idx}
                            className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs font-medium"
                          >
                            {skill}
                          </span>
                        ))}
                        {candidate.skills.length > 5 && (
                          <span className="text-slate-600 text-xs pt-1">+{candidate.skills.length - 5} more</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Salary */}
                  {candidate.salary_expectation && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">Salary Expectation</p>
                      <p className="text-sm text-slate-900 font-medium mt-1">
                        ${candidate.salary_expectation.toLocaleString()}
                      </p>
                    </div>
                  )}

                  {/* Education */}
                  {candidate.education && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">Education</p>
                      <p className="text-sm text-slate-900 font-medium mt-1">{candidate.education}</p>
                    </div>
                  )}

                  {/* Resume/Summary */}
                  {candidate.resume_text && (
                    <div>
                      <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">Summary</p>
                      <p
                        className="text-xs text-slate-700 mt-1 line-clamp-2 cursor-pointer hover:text-slate-900"
                        onClick={() => setExpandedCard(expandedCard === candidate.id ? null : candidate.id)}
                      >
                        {candidate.resume_text}
                      </p>
                      {expandedCard === candidate.id && (
                        <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap">
                          {candidate.resume_text}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Footer */}
                <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex gap-2">
                  <button
                    onClick={() => window.open(`mailto:${candidate.email}`)}
                    className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                  >
                    Email
                  </button>
                  <button
                    onClick={() => handleRemoveCandidate(candidate.id)}
                    className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}