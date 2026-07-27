import React, { useState, useRef } from 'react';
import { Upload, FileText, Save, ArrowLeft } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { ErrorBanner } from './Login.js';
import { ProfileField } from './CandidateProfile.js';

// Parsed shape returned by POST /candidate-resume/parse (parseResume() in parser.service.ts) -
// the full ~30-field Candidate-shaped payload. Only the subset that has a home in
// candidate_accounts (see the field mapping below) is offered for review/save; everything else
// (CTC, certifications, LinkedIn/GitHub, projects, languages, etc.) has no column to land in
// and is intentionally not carried forward, per Phase 2 scope.
interface ParsedResume {
  name?: string;
  current_job_title?: string;
  skills?: string[];
  years_of_experience?: string;
  current_location?: string;
  highest_qualification?: string;
  education?: string;
  resume_summary?: string;
}

export default function CandidateResumeUpload({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Review fields - mapped from the parsed resume, then freely editable before saving.
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [location, setLocation] = useState('');
  const [education, setEducation] = useState('');
  const [summary, setSummary] = useState('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] || null);
    setError('');
  };

  const handleExtract = async () => {
    if (!file) return;
    setParsing(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/candidate-resume/parse', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse resume');

      const parsed: ParsedResume = data.data;
      setName(parsed.name || '');
      setHeadline(parsed.current_job_title || '');
      setSkillsText((parsed.skills || []).join(', '));
      setYearsOfExperience(parsed.years_of_experience || '');
      setLocation(parsed.current_location || '');
      setEducation(parsed.highest_qualification || parsed.education || '');
      setSummary(parsed.resume_summary || '');
      setReviewing(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setParsing(false);
    }
  };

  const handleSaveToProfile = async () => {
    if (!name.trim()) {
      setError('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/candidate-profile/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          headline: headline || null,
          skills: skillsText.split(',').map((s) => s.trim()).filter(Boolean),
          years_of_experience: yearsOfExperience || null,
          location: location || null,
          education: education || null,
          summary: summary || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save profile');
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">

        <div className="flex items-center justify-between mb-6">
          <TejomaLogo size="md" textColorClass="text-[#1A1A1A]" />
          <button onClick={onCancel} className="text-xs font-semibold text-[#666666] hover:text-[#1A1A1A] cursor-pointer flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Profile
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-md p-8 sm:p-10 space-y-6">

          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Upload your resume</h1>
            <p className="text-[#666666] text-sm mt-1">We'll extract your details automatically - you can review and edit everything before saving.</p>
          </div>

          {!reviewing && (
            <>
              <label className="block">
                <div className="border-2 border-dashed border-[#A8E6C1] rounded-xl p-8 text-center cursor-pointer hover:bg-[#E5F5E5] transition-colors">
                  <Upload className="w-10 h-10 text-[#27AE60] mx-auto mb-3" />
                  <p className="text-sm font-bold text-[#1A1A1A] mb-1">Click to select a resume</p>
                  <p className="text-xs text-[#666666]">PDF, DOC, DOCX, or TXT - up to 10MB</p>
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileSelect} className="hidden" />
                </div>
              </label>

              {file && (
                <div className="flex items-center gap-2 bg-[#E5F5E5] border border-[#A8E6C1] rounded-lg px-4 py-2.5 text-sm text-[#1A1A1A]">
                  <FileText className="w-4 h-4 text-[#27AE60] flex-shrink-0" />
                  <span className="truncate">{file.name}</span>
                </div>
              )}

              {error && <ErrorBanner text={error} />}

              <button
                type="button"
                onClick={handleExtract}
                disabled={!file || parsing}
                className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60"
              >
                {parsing ? 'Extracting...' : 'Extract Details'}
              </button>
            </>
          )}

          {reviewing && (
            <div className="space-y-5">
              <p className="text-xs text-[#666666] bg-[#F8F9FA] border border-[#E5E7EB] rounded-lg px-3.5 py-2.5">
                Review what we found below - edit anything before saving to your profile.
              </p>

              <ProfileField label="Full name" value={name} onChange={setName} placeholder="Your full name" />
              <ProfileField label="Headline" value={headline} onChange={setHeadline} placeholder="e.g. Senior Frontend Engineer" />
              <ProfileField label="Skills (comma-separated)" value={skillsText} onChange={setSkillsText} placeholder="React, TypeScript, Node.js" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <ProfileField label="Years of experience" value={yearsOfExperience} onChange={setYearsOfExperience} placeholder="e.g. 5" />
                <ProfileField label="Location" value={location} onChange={setLocation} placeholder="e.g. Bengaluru, India" />
              </div>
              <ProfileField label="Education" value={education} onChange={setEducation} placeholder="e.g. B.Tech, XYZ University" />
              <ProfileField label="Summary" value={summary} onChange={setSummary} placeholder="A short summary about yourself" textarea />

              {error && <ErrorBanner text={error} />}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setReviewing(false); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="flex-1 border border-[#E5E7EB] text-[#666666] hover:text-[#1A1A1A] text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer"
                >
                  Start Over
                </button>
                <button
                  type="button"
                  onClick={handleSaveToProfile}
                  disabled={saving}
                  className="flex-1 bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60"
                >
                  <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save to Profile'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
