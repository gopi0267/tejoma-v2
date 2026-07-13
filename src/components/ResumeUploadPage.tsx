import React, { useState } from 'react';
import { Upload, X, CheckCircle2, Loader, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch } from '../utils/apiFetch.js';

interface ResumeUploadPageProps {
  onBackToLanding: () => void;
  onViewChange: (view: string) => void;
}

type FieldConfig = { key: string; label: string; isArray?: boolean; multiline?: boolean };

// All 31 extracted fields (matches the schema produced by parser.service.ts), grouped for a
// reviewable editing layout. name/email/phone/skills/years_of_experience/current_job_title
// double as the required-ish "at a glance" fields shown in the collapsed card header.
const FIELD_GROUPS: { title: string; fields: FieldConfig[] }[] = [
  {
    title: 'Contact',
    fields: [
      { key: 'name', label: 'Full Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'linkedin_url', label: 'LinkedIn URL' },
      { key: 'github_or_portfolio_url', label: 'GitHub / Portfolio URL' },
    ],
  },
  {
    title: 'Professional',
    fields: [
      { key: 'current_job_title', label: 'Current Job Title' },
      { key: 'current_company', label: 'Current Company' },
      { key: 'previous_companies', label: 'Previous Companies', isArray: true },
      { key: 'years_of_experience', label: 'Years of Experience' },
      { key: 'industry_domain', label: 'Industry / Domain' },
      { key: 'current_location', label: 'Current Location' },
      { key: 'preferred_location', label: 'Preferred Location' },
      { key: 'willingness_to_relocate', label: 'Willingness to Relocate' },
    ],
  },
  {
    title: 'Skills',
    fields: [
      { key: 'skills', label: 'All Skills (comma-separated)', isArray: true },
      { key: 'primary_skills', label: 'Primary Skills' },
      { key: 'secondary_skills', label: 'Secondary Skills' },
      { key: 'technical_tools', label: 'Technical Tools' },
      { key: 'languages_known', label: 'Languages Known' },
    ],
  },
  {
    title: 'Education',
    fields: [
      { key: 'education', label: 'Education' },
      { key: 'highest_qualification', label: 'Highest Qualification' },
      { key: 'university', label: 'University' },
      { key: 'graduation_year', label: 'Graduation Year' },
      { key: 'certifications', label: 'Certifications (comma-separated)', isArray: true },
    ],
  },
  {
    title: 'Compensation & Availability',
    fields: [
      { key: 'current_ctc', label: 'Current CTC' },
      { key: 'expected_ctc', label: 'Expected CTC' },
      { key: 'notice_period', label: 'Notice Period' },
    ],
  },
  {
    title: 'Summary',
    fields: [
      { key: 'projects', label: 'Projects', multiline: true },
      { key: 'resume_summary', label: 'Resume Summary', multiline: true },
    ],
  },
];
// Fields above: 5 + 8 + 5 + 5 + 3 + 2 = 28. Plus resume_text, ai_confidence_score and
// extraction_status (rendered separately below, not in the grouped grid) = 31 total.

const asArrayText = (val: any): string => Array.isArray(val) ? val.join(',') : (val || '');
const asText = (val: any): string => (val === null || val === undefined) ? '' : String(val);

export default function ResumeUploadPage({ onBackToLanding, onViewChange }: ResumeUploadPageProps) {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [extractedData, setExtractedData] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<{ name: string; error: string }[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showResumeText, setShowResumeText] = useState<Record<number, boolean>>({});

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    setExtractedData([]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleProcessResumes = async () => {
    if (uploadedFiles.length === 0) {
      alert('Please select resume files to process.');
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);
    setFailedFiles([]);
    const results: any[] = [];
    const failures: { name: string; error: string }[] = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      setCurrentFileName(file.name);
      try {
        const formData = new FormData();
        formData.append('file', file);

        // Each resume runs through a two-pass cloud AI extraction (extraction + audit) for
        // accuracy - typically a few seconds per resume.
        const response = await apiFetch('/api/parse-resume', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        if (response.ok && data.success) {
          results.push(data.data);
        } else {
          console.error(`Failed to parse ${file.name}:`, data.error || 'Unknown error');
          failures.push({ name: file.name, error: data.error || 'Unknown error' });
        }
      } catch (error: any) {
        console.error(`Could not process file ${file.name}:`, error);
        failures.push({ name: file.name, error: error.message || 'Network error' });
      }
      setProcessingProgress(((i + 1) / uploadedFiles.length) * 100);
    }

    setCurrentFileName(null);
    setFailedFiles(failures);
    setExtractedData(results);
    setExpandedIndex(results.length > 0 ? 0 : null);
    setIsProcessing(false);
  };

  const updateField = (idx: number, key: string, value: string) => {
    setExtractedData(prev => prev.map((c, i) => (i === idx ? { ...c, [key]: value } : c)));
  };

  const updateArrayField = (idx: number, key: string, rawText: string) => {
    // Split on plain ',' with no trim/filter while typing, so the input value round-trips
    // exactly (split(',').join(',') is an identity transform) instead of eating the user's
    // trailing comma/space as they type the next item. Trimming/deduping happens server-side
    // (candidatePayloadFromExtracted's toArray) before it reaches the database.
    setExtractedData(prev => prev.map((c, i) => (i === idx ? { ...c, [key]: rawText.split(',') } : c)));
  };

  const removeCandidate = (idx: number) => {
    setExtractedData(prev => prev.filter((_, i) => i !== idx));
    setExpandedIndex(null);
  };

  const handleImportToDatabase = async () => {
    if (extractedData.length === 0) {
      alert('No extracted candidate data to import.');
      return;
    }

    setIsImporting(true);
    try {
      const response = await apiFetch('/api/bulk-upload-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractedData)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Server-side import failed.');

      if (data.errors && data.errors.length > 0) {
        alert(`Imported ${data.inserted} of ${extractedData.length} candidates. ${data.errors.length} failed:\n` +
          data.errors.map((e: any) => `• ${e.candidate}: ${e.error}`).join('\n'));
      } else {
        alert(`✅ Successfully imported ${data.inserted} candidate(s) into your candidate list!`);
      }
      setUploadedFiles([]);
      setExtractedData([]);
      onViewChange('candidates');
    } catch (error: any) {
      alert('❌ Import failed: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Upload Resumes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload multiple resumes (PDF, DOCX, TXT) to automatically extract candidate details.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-lg p-8 border border-neutral-200"
        >
          {/* Upload Drop Zone */}
          <label className="block mb-6">
            <div className="border-2 border-dashed border-blue-300 rounded-xl p-8 text-center cursor-pointer hover:bg-blue-50 transition">
              <Upload className="w-12 h-12 text-blue-600 mx-auto mb-3" />
              <p className="text-sm font-bold text-neutral-700 mb-1">
                Click to select files or drag and drop
              </p>
              <p className="text-xs text-neutral-500">
                Supports PDF, DOCX, TXT. Select multiple files.
              </p>
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </label>

          {/* File List */}
          {uploadedFiles.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-neutral-700 mb-3">
                Selected Files ({uploadedFiles.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {uploadedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Upload className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <span className="text-xs font-medium text-neutral-700 truncate">{file.name}</span>
                    </div>
                    <button onClick={() => removeFile(idx)} className="p-1 hover:bg-red-100 rounded text-red-600 transition flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {extractedData.length > 0 && !isProcessing && (
            <div className="mb-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{extractedData.length} candidate(s) extracted - review and edit fields below, then import.</span>
            </div>
          )}

          {/* Action Row: both buttons together */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleProcessResumes}
              disabled={uploadedFiles.length === 0 || isProcessing}
              className={`flex-1 py-3 rounded-xl font-bold text-white transition-all duration-200 flex items-center justify-center gap-2 ${
                isProcessing || uploadedFiles.length === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Processing ({Math.round(processingProgress)}%)...
                </>
              ) : (
                'Extract from Resumes'
              )}
            </button>

            <button
              onClick={handleImportToDatabase}
              disabled={isImporting || extractedData.length === 0}
              className={`flex-1 py-3 font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-white ${
                isImporting || extractedData.length === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 hover:shadow-lg'
              }`}
            >
              {isImporting ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Importing...
                </>
              ) : (
                `Import All (${extractedData.length})`
              )}
            </button>
          </div>

          {isProcessing && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <p className="font-bold">Currently processing: {currentFileName}</p>
              <p className="mt-1">Each resume runs through a two-pass cloud AI extraction (extraction + accuracy audit), typically a few seconds per resume.</p>
            </div>
          )}

          {!isProcessing && failedFiles.length > 0 && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 space-y-1">
              <p className="font-bold">{failedFiles.length} file(s) failed to process:</p>
              {failedFiles.map((f, idx) => (
                <p key={idx}>• {f.name}: {f.error}</p>
              ))}
            </div>
          )}
        </motion.div>

        {/* Full-width: editable review of every extracted candidate (all 31 fields) */}
        {extractedData.length > 0 && (
          <div className="mt-8 space-y-4">
            {extractedData.map((candidate, idx) => {
              const isExpanded = expandedIndex === idx;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl shadow-lg border-2 border-neutral-100 overflow-hidden"
                >
                  {/* Collapsed header */}
                  <button
                    type="button"
                    onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 px-6 py-4 hover:bg-neutral-50 transition text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-bold text-neutral-900 truncate">{candidate.name || 'Unnamed Candidate'}</p>
                        {candidate.extraction_status && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            candidate.extraction_status === 'Complete'
                              ? 'bg-green-100 text-green-700'
                              : candidate.extraction_status === 'Review Required'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}>
                            {candidate.extraction_status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-500 mt-1 truncate">
                        {candidate.email} • {candidate.current_job_title || 'No title'} • {candidate.years_of_experience || 'Experience unknown'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        onClick={(e) => { e.stopPropagation(); removeCandidate(idx); }}
                        className="p-2 hover:bg-red-100 rounded-lg text-red-500 transition cursor-pointer"
                        title="Remove this candidate from the import batch"
                      >
                        <Trash2 className="w-4 h-4" />
                      </span>
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-neutral-400" /> : <ChevronDown className="w-5 h-5 text-neutral-400" />}
                    </div>
                  </button>

                  {/* Expanded editable fields */}
                  {isExpanded && (
                    <div className="px-6 pb-6 pt-2 border-t border-neutral-100 space-y-6">
                      {FIELD_GROUPS.map(group => (
                        <div key={group.title}>
                          <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-3">{group.title}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {group.fields.map(field => (
                              <div key={field.key} className={field.multiline ? 'sm:col-span-2' : ''}>
                                <label className="block text-xs font-semibold text-neutral-600 mb-1">{field.label}</label>
                                {field.multiline ? (
                                  <textarea
                                    value={asText(candidate[field.key])}
                                    onChange={(e) => updateField(idx, field.key, e.target.value)}
                                    rows={3}
                                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                  />
                                ) : field.isArray ? (
                                  <input
                                    type="text"
                                    value={asArrayText(candidate[field.key])}
                                    onChange={(e) => updateArrayField(idx, field.key, e.target.value)}
                                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    value={asText(candidate[field.key])}
                                    onChange={(e) => updateField(idx, field.key, e.target.value)}
                                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                      {/* Metadata + raw resume text (kept separate - resume_text can be very long) */}
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-3">Extraction Metadata</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-neutral-600 mb-1">AI Confidence Score</label>
                            <input
                              type="text"
                              value={asText(candidate.ai_confidence_score)}
                              onChange={(e) => updateField(idx, 'ai_confidence_score', e.target.value)}
                              className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-neutral-600 mb-1">Extraction Status</label>
                            <input
                              type="text"
                              value={asText(candidate.extraction_status)}
                              onChange={(e) => updateField(idx, 'extraction_status', e.target.value)}
                              className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <button
                          type="button"
                          onClick={() => setShowResumeText(prev => ({ ...prev, [idx]: !prev[idx] }))}
                          className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          {showResumeText[idx] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {showResumeText[idx] ? 'Hide' : 'View / Edit'} Full Resume Text
                        </button>
                        {showResumeText[idx] && (
                          <textarea
                            value={asText(candidate.resume_text)}
                            onChange={(e) => updateField(idx, 'resume_text', e.target.value)}
                            rows={10}
                            className="mt-2 w-full px-3 py-2 border border-neutral-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Back Button */}
        <div className="mt-12 text-center">
          <button
            onClick={onBackToLanding}
            className="px-6 py-3 text-blue-600 hover:text-blue-700 font-bold transition"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
