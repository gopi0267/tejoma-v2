import React, { useState, useEffect, useRef } from 'react';
import { Upload, Save, ArrowLeft, Sparkles, GraduationCap, Wallet, Link2, Briefcase, AlertTriangle, Plus } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { ErrorBanner } from './Login.js';
import { ProfileField } from './CandidateProfile.js';
import { ChipInput } from './CandidateOnboardingSkills.js';

// Full shape returned by POST /candidate-resume/parse (parseResume() in parser.service.ts,
// unmodified) - unlike the existing CandidateResumeUpload.tsx (which only surfaces a small
// subset, per its own Phase 2 scope note), this path now has a real column to land nearly every
// field the parser already extracts, so the review form below maps almost all of them.
// previous_companies is read here (used for candidate-type classification and shown as
// read-only reference context) but is NOT written back on save - candidate_accounts has no
// column for it, and adding one is out of scope for this UX-only enhancement.
// ai_confidence_score / extraction_status are the only extraction-quality signals the parser
// actually returns (one overall score, not per-field) - used below to gate a "Needs Review"
// treatment on AI-populated fields. No fabricated per-field confidence.
interface ParsedResume {
  name?: string;
  current_job_title?: string;
  current_company?: string;
  previous_companies?: string[];
  skills?: string[];
  years_of_experience?: string;
  current_location?: string;
  highest_qualification?: string;
  education?: string;
  graduation_year?: string;
  certifications?: string[];
  projects?: string;
  languages_known?: string;
  current_ctc?: string;
  expected_ctc?: string;
  notice_period?: string;
  linkedin_url?: string;
  github_or_portfolio_url?: string;
  resume_summary?: string;
  ai_confidence_score?: string;
  extraction_status?: string;
}

const LOADING_MESSAGES = [
  'Uploading Resume...',
  'Analyzing Resume...',
  'Extracting Candidate Information...',
  'Building Your Professional Profile...',
  'Please wait...',
];

type CandidateType = 'fresher' | 'experienced';

// Shared signal-detection used both for the one-time classification right after parsing AND for
// live reclassification as the candidate edits the form (see isFresher below) - one function, two
// callers, so the two never drift apart. A candidate reads as Experienced the moment ANY one
// signal of real work points that way (a positive experience figure, a real current employer, a
// past employer, or a senior-sounding designation); uncertainty always resolves toward
// Experienced, never the other way (showing an Experienced-only field to a fresher just goes
// unused; hiding one from someone who actually has a work history would lose real data).
// An internship/trainee-only title is deliberately NOT treated as employment (a resume with only
// an internship and no other signal still reads as Fresher) - internships, academic projects,
// freelance and volunteer work are real experience worth capturing, but not "prior employment"
// for the purposes of this split.
function hasExperienceSignals(input: {
  yearsOfExperience?: string;
  currentCompany?: string;
  currentJobTitle?: string;
  previousCompanies?: string[];
}): boolean {
  const titleText = (input.currentJobTitle || '').toLowerCase();
  const isInternshipTitle = /\b(intern|internship|trainee|apprentice)\b/.test(titleText);
  const isSeniorTitle = /\b(senior|sr\.?|lead|principal|staff|architect|manager|head|director)\b/.test(titleText);
  const hasPreviousCompanies = (input.previousCompanies || []).filter(Boolean).length > 0;

  // A profile whose only current role is an internship, with no separate past employer and no
  // senior title anywhere, is never real prior employment - even if the parser surfaces a small
  // "years_of_experience" figure for it (Gemini sometimes reports an internship's own duration as
  // e.g. "Less than 1 Year"), that figure is the internship's length, not genuine work history, so
  // it must not flip the classification. Internships are still real experience worth capturing
  // (see the "Add Employment Details" affordance and the Certifications & Projects guidance for
  // Freshers) - they're just not "prior employment" for this split.
  if (isInternshipTitle && !hasPreviousCompanies && !isSeniorTitle) {
    return false;
  }

  const expText = (input.yearsOfExperience || '').trim().toLowerCase();
  const expNumberMatch = expText.match(/\d+(\.\d+)?/);
  const expNumber = expNumberMatch ? parseFloat(expNumberMatch[0]) : null;
  const hasRealExpFigure = expNumber !== null && expNumber > 0 && !expText.includes('fresher');
  const hasCurrentCompany = Boolean(input.currentCompany?.trim()) && !isInternshipTitle;

  return hasRealExpFigure || hasCurrentCompany || hasPreviousCompanies || isSeniorTitle;
}

function classifyCandidate(parsed: ParsedResume): CandidateType {
  return hasExperienceSignals({
    yearsOfExperience: parsed.years_of_experience,
    currentCompany: parsed.current_company,
    currentJobTitle: parsed.current_job_title,
    previousCompanies: parsed.previous_companies,
  }) ? 'experienced' : 'fresher';
}

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-6 sm:p-7">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-lg bg-[#E5F5E5] flex items-center justify-center flex-shrink-0">{icon}</div>
        <h2 className="text-sm font-bold text-[#1A1A1A]">{title}</h2>
      </div>
      {description && <p className="text-xs text-[#999999] ml-[42px] mb-5">{description}</p>}
      <div className={`space-y-5 ${description ? '' : 'mt-5'}`}>{children}</div>
    </div>
  );
}

function splitList(text: string | undefined): string[] {
  if (!text) return [];
  return text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

// AI-transparency + validation-aware field. Deliberately a local, self-contained copy of
// ProfileField's exact visual language (same classes) rather than an edit to the shared
// ProfileField component - ProfileField is also used by the untouched Manual onboarding path and
// the Profile page, and this enhancement is scoped to the AI-resume review form only.
function AiBadge({ needsReview }: { needsReview: boolean }) {
  return needsReview ? (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#FFF7E6] text-[#B7791F] border border-[#F5D999] flex-shrink-0">
      <AlertTriangle className="w-2.5 h-2.5" /> Needs Review
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#EAF2FF] text-[#2962FF] border border-[#D6E4FF] flex-shrink-0">
      <Sparkles className="w-2.5 h-2.5" /> AI Extracted
    </span>
  );
}

function SmartField({
  id, label, value, onChange, placeholder, textarea, aiExtracted, needsReview, conflict, validation,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  aiExtracted?: boolean;
  needsReview?: boolean;
  conflict?: string | null;
  validation?: string | null;
}) {
  const className = "w-full bg-white border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors";
  const hint = conflict ? `${id}-hint` : validation ? `${id}-hint` : undefined;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="block text-[#1A1A1A] text-sm font-medium">{label}</label>
        {aiExtracted && <AiBadge needsReview={Boolean(needsReview)} />}
      </div>
      {textarea ? (
        <textarea id={id} rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-describedby={hint} className={className} />
      ) : (
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-describedby={hint} className={className} />
      )}
      {conflict ? (
        <p id={hint} className="text-[10px] text-[#B7791F] mt-1 flex items-start gap-1">
          <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" /> Differs from your resume (originally &quot;{conflict}&quot;) - just double-check this is correct.
        </p>
      ) : validation ? (
        <p id={hint} className="text-[10px] text-[#B7791F] mt-1">{validation}</p>
      ) : null}
    </div>
  );
}

function conflictWith(current: string, original: string): string | null {
  const c = current.trim();
  const o = original.trim();
  if (!o || !c || c === o) return null;
  return o;
}

function validateExperienceText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const match = t.match(/-?\d+(\.\d+)?/);
  const num = match ? parseFloat(match[0]) : null;
  if (num !== null && num < 0) return 'Experience cannot be negative.';
  if (num !== null && num > 60) return 'That seems unusually high - please double-check.';
  return null;
}

function validateSalaryText(text: string, label: string): string | null {
  const t = text.trim();
  if (!t || /\d/.test(t)) return null;
  return `${label} should usually include a number, e.g. "12 LPA".`;
}

function validateNoticePeriodText(text: string): string | null {
  const t = text.trim();
  if (!t || /\d/.test(t) || /immediate|negotiable|serving|available/i.test(t)) return null;
  return 'e.g. "30 days", "2 months", or "Immediate".';
}

function validateUrlText(text: string, expectedDomain?: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const looksLikeUrl = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t);
  if (!looksLikeUrl) return "This doesn't look like a valid URL.";
  if (expectedDomain && !t.toLowerCase().includes(expectedDomain)) return `Doesn't look like a ${expectedDomain} link - double-check the URL.`;
  return null;
}

// The parser's own fallback default is a percentage string ("90%"), but a real Gemini extraction
// actually returns a 0-1 decimal (e.g. "0.98") - both are handled here since the format isn't
// consistent between the two, and this file cannot change parser.service.ts to normalize it.
function parseConfidencePercent(raw: string | undefined): number {
  if (!raw) return 90;
  const num = parseFloat(raw.trim().replace('%', ''));
  if (!Number.isFinite(num)) return 90;
  return num <= 1 ? num * 100 : num;
}

function validateYearText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{4}$/.test(t)) return 'Enter a 4-digit year, e.g. 2024.';
  const y = parseInt(t, 10);
  const thisYear = new Date().getFullYear();
  if (y < 1950 || y > thisYear + 10) return 'That year looks off - please double-check.';
  return null;
}

interface FieldSnapshot {
  name: string; headline: string; currentCompany: string; currentJobTitle: string;
  yearsOfExperience: string; location: string; education: string; graduationYear: string;
  projects: string; summary: string; linkedinUrl: string; githubUrl: string;
  noticePeriod: string; currentCtc: string; expectedCtc: string;
}
const EMPTY_SNAPSHOT: FieldSnapshot = {
  name: '', headline: '', currentCompany: '', currentJobTitle: '', yearsOfExperience: '',
  location: '', education: '', graduationYear: '', projects: '', summary: '', linkedinUrl: '',
  githubUrl: '', noticePeriod: '', currentCtc: '', expectedCtc: '',
};

interface StrengthField { label: string; filled: boolean }
function computeProfileStrength(fields: StrengthField[]): { percent: number; missing: string[] } {
  const filled = fields.filter((f) => f.filled).length;
  const percent = fields.length ? Math.round((filled / fields.length) * 100) : 0;
  return { percent, missing: fields.filter((f) => !f.filled).map((f) => f.label) };
}

type Stage = 'upload' | 'loading' | 'review';

// Option 2 of the two-path onboarding choice: parsing starts the instant a file is selected -
// there is no "Extract Details" button anywhere on this screen (that affordance only exists on
// the separate, untouched CandidateResumeUpload.tsx used by the post-onboarding Profile page).
// AI output is only ever an editable first draft; every field below is a real, freely-editable
// input, and nothing is saved until the candidate explicitly reviews and submits. Immediately
// after parsing, the candidate is auto-classified as Fresher/Experienced (see classifyCandidate
// above) and the review form below adapts which sections/fields it shows accordingly - the
// candidate is never asked to pick one manually. The classification then stays LIVE: editing
// Experience/Current Company/Designation re-evaluates it in real time (see isFresher below), so a
// wrong initial read self-corrects as the candidate fills the form in, with no page refresh.
export default function CandidateOnboardingAIResume({
  candidateName, accountEmail, accountPhone, onBack, onComplete,
}: {
  candidateName: string;
  accountEmail: string;
  accountPhone: string;
  onBack: () => void;
  onComplete: () => void;
}) {
  const [stage, setStage] = useState<Stage>('upload');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const fileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previousCompanies, setPreviousCompanies] = useState<string[]>([]);
  // Controls whether the Employment History / Career Preferences sections are rendered at all.
  // Seeded from the initial AI classification; for an initially-Fresher candidate who then wants
  // to add work experience, the "+ Add Employment Details" affordance below sets this true. Once
  // revealed it never auto-hides again (even if the candidate later clears every field) - a
  // section disappearing out from under someone mid-edit reads as the app eating their input, so
  // only the badge/copy react live to empty fields, never the section's visibility.
  const [employmentSectionRevealed, setEmploymentSectionRevealed] = useState(false);
  // Only real extraction-quality signal the parser returns (see parser.service.ts's
  // ai_confidence_score / extraction_status) - used to gate AI-badge styling between "AI
  // Extracted" and "Needs Review". Not fabricated per-field; applied uniformly to every
  // AI-populated field when the overall extraction came back low-confidence or partial.
  const [confidenceLevel, setConfidenceLevel] = useState<'high' | 'low'>('high');
  const [parsedSnapshot, setParsedSnapshot] = useState<FieldSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    if (stage !== 'loading') return;
    const timer = setInterval(() => {
      setMessageIndex((i) => (i < LOADING_MESSAGES.length - 1 ? i + 1 : i));
    }, 1400);
    return () => clearInterval(timer);
  }, [stage]);

  // Review fields - populated from the parsed draft, then freely editable before saving.
  const [name, setName] = useState(candidateName);
  const [headline, setHeadline] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [currentJobTitle, setCurrentJobTitle] = useState('');
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [education, setEducation] = useState('');
  const [graduationYear, setGraduationYear] = useState('');
  const [certifications, setCertifications] = useState<string[]>([]);
  const [projects, setProjects] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [noticePeriod, setNoticePeriod] = useState('');
  const [currentCtc, setCurrentCtc] = useState('');
  const [expectedCtc, setExpectedCtc] = useState('');

  const startParsing = async (file: File) => {
    fileRef.current = file;
    setError('');
    setMessageIndex(0);
    setStage('loading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/candidate-resume/parse', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse resume');

      const parsed: ParsedResume = data.data;
      setEmploymentSectionRevealed(classifyCandidate(parsed) === 'experienced');
      setPreviousCompanies((parsed.previous_companies || []).filter(Boolean));

      const isLowConfidence = (parsed.extraction_status && parsed.extraction_status !== 'Complete')
        || parseConfidencePercent(parsed.ai_confidence_score) < 70;
      setConfidenceLevel(isLowConfidence ? 'low' : 'high');

      const resolvedName = parsed.name?.trim() || candidateName;
      const resolvedHeadline = parsed.current_job_title || '';
      const resolvedCurrentCompany = parsed.current_company || '';
      const resolvedCurrentJobTitle = parsed.current_job_title || '';
      const resolvedExp = parsed.years_of_experience || '';
      const resolvedLocation = parsed.current_location || '';
      const resolvedEducation = parsed.highest_qualification || parsed.education || '';
      const resolvedGradYear = parsed.graduation_year || '';
      const resolvedProjects = parsed.projects || '';
      const resolvedSummary = parsed.resume_summary || '';
      const resolvedLinkedin = parsed.linkedin_url || '';
      const resolvedGithub = parsed.github_or_portfolio_url || '';
      const resolvedNotice = parsed.notice_period || '';
      const resolvedCurrentCtc = parsed.current_ctc || '';
      const resolvedExpectedCtc = parsed.expected_ctc || '';

      setName(resolvedName);
      setHeadline(resolvedHeadline);
      setCurrentCompany(resolvedCurrentCompany);
      setCurrentJobTitle(resolvedCurrentJobTitle);
      setYearsOfExperience(resolvedExp);
      setLocation(resolvedLocation);
      setSkills(parsed.skills || []);
      setEducation(resolvedEducation);
      setGraduationYear(resolvedGradYear);
      setCertifications(parsed.certifications || []);
      setProjects(resolvedProjects);
      setLanguages(splitList(parsed.languages_known));
      setSummary(resolvedSummary);
      setLinkedinUrl(resolvedLinkedin);
      setGithubUrl(resolvedGithub);
      setNoticePeriod(resolvedNotice);
      setCurrentCtc(resolvedCurrentCtc);
      setExpectedCtc(resolvedExpectedCtc);

      setParsedSnapshot({
        name: resolvedName, headline: resolvedHeadline, currentCompany: resolvedCurrentCompany,
        currentJobTitle: resolvedCurrentJobTitle, yearsOfExperience: resolvedExp, location: resolvedLocation,
        education: resolvedEducation, graduationYear: resolvedGradYear, projects: resolvedProjects,
        summary: resolvedSummary, linkedinUrl: resolvedLinkedin, githubUrl: resolvedGithub,
        noticePeriod: resolvedNotice, currentCtc: resolvedCurrentCtc, expectedCtc: resolvedExpectedCtc,
      });
      setStage('review');
    } catch (err: any) {
      setError(err.message);
      setStage('upload');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) startParsing(file);
  };

  // Live, not a one-time snapshot: re-evaluated on every render from the current field values, so
  // the badge, the save payload, and which sections show all stay in sync as the candidate types -
  // see hasExperienceSignals' docstring above for the reasoning.
  const isFresher = !hasExperienceSignals({ yearsOfExperience, currentCompany, currentJobTitle });

  const aiExtracted = (current: string, original: string) => Boolean(original.trim()) && current.trim() === original.trim();
  const needsReview = (current: string, original: string) => confidenceLevel === 'low' && aiExtracted(current, original);

  const strengthFields: StrengthField[] = [
    { label: 'Headline', filled: Boolean(headline.trim()) },
    { label: 'Location', filled: Boolean(location.trim()) },
    { label: 'Skills', filled: skills.length > 0 },
    { label: 'Education', filled: Boolean(education.trim()) },
    { label: 'Projects', filled: Boolean(projects.trim()) },
    { label: 'Languages', filled: languages.length > 0 },
    { label: 'Summary', filled: Boolean(summary.trim()) },
    { label: 'LinkedIn', filled: Boolean(linkedinUrl.trim()) },
    { label: isFresher ? 'GitHub / Portfolio' : 'GitHub', filled: Boolean(githubUrl.trim()) },
    ...(!isFresher ? [
      { label: 'Current Company', filled: Boolean(currentCompany.trim()) },
      { label: 'Current Designation', filled: Boolean(currentJobTitle.trim()) },
      { label: 'Notice Period', filled: Boolean(noticePeriod.trim()) },
      { label: 'Expected Salary', filled: Boolean(expectedCtc.trim()) },
    ] : []),
  ];
  const { percent: strengthPercent, missing: strengthMissing } = computeProfileStrength(strengthFields);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Only the fields shown for the (live) detected candidate type are sent - the rest are
      // simply omitted from the request body, which the existing PUT /candidate-profile/me
      // endpoint already treats as "leave unchanged" (see its `...(x !== undefined && {x})`
      // pattern) - no API contract change, hidden fields just stay whatever they already were
      // (null/empty for a brand-new account completing onboarding for the first time). end_year
      // is an already-accepted field on this same endpoint (used by the Manual path for
      // "Ending Year") - reused here to carry the parser's Graduation Year, no new API surface.
      const payload: Record<string, unknown> = {
        name,
        headline: headline || null,
        location: location || null,
        skills,
        education: education || null,
        end_year: graduationYear || null,
        certifications,
        projects: projects || null,
        languages,
        summary: summary || null,
        linkedin_url: linkedinUrl || null,
        github_url: githubUrl || null,
      };

      if (isFresher) {
        // Established codebase convention (see CandidateAuth.tsx's registration flow) for
        // representing "no work experience yet" in this free-text column.
        payload.years_of_experience = 'Fresher';
      } else {
        payload.years_of_experience = yearsOfExperience || null;
        payload.current_company = currentCompany || null;
        payload.current_job_title = currentJobTitle || null;
        payload.notice_period = noticePeriod || null;
        payload.current_ctc = currentCtc || null;
        payload.expected_ctc = expectedCtc || null;
      }

      const res = await fetch('/api/candidate-profile/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save profile');

      // Best-effort: also keep the uploaded file on permanent file (same feature the Profile
      // page's "Your Resume File" card uses) - failing this must never block onboarding.
      if (fileRef.current) {
        const formData = new FormData();
        formData.append('file', fileRef.current);
        fetch('/api/candidate-resume/file', { method: 'POST', body: formData }).catch(() => {});
      }

      await fetch('/api/candidate-auth/complete-onboarding', { method: 'PUT' });
      onComplete();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (stage === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-8">
            <TejomaLogo size="md" textColorClass="text-[#1A1A1A]" />
          </div>
          <div className="bg-white rounded-2xl shadow-md p-10">
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-[#E5F5E5]" />
              <div className="absolute inset-0 rounded-full border-4 border-[#27AE60] border-t-transparent animate-spin" />
              <Sparkles className="w-6 h-6 text-[#27AE60] absolute inset-0 m-auto" />
            </div>
            <p className="text-sm font-bold text-[#1A1A1A] transition-all">{LOADING_MESSAGES[messageIndex]}</p>
            <p className="text-xs text-[#999999] mt-2">This usually takes just a few seconds.</p>
            <div className="flex items-center justify-center gap-1.5 mt-6">
              {LOADING_MESSAGES.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i <= messageIndex ? 'w-6 bg-[#27AE60]' : 'w-1.5 bg-[#E5E7EB]'}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'upload') {
    return (
      <div className="min-h-screen p-4 sm:p-8 flex flex-col items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="w-full max-w-xl">
          <div className="flex items-center justify-between mb-6">
            <TejomaLogo size="md" textColorClass="text-[#1A1A1A]" />
            <button type="button" onClick={onBack} className="text-xs font-semibold text-[#666666] hover:text-[#1A1A1A] cursor-pointer flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-md p-8 sm:p-10 space-y-6">
            <div>
              <h1 className="text-xl font-bold text-[#1A1A1A]">Build your profile from your resume</h1>
              <p className="text-[#666666] text-sm mt-1">Upload your resume and we'll start analyzing it right away - you'll review and edit everything before it's saved.</p>
            </div>

            <label className="block">
              <div className="border-2 border-dashed border-[#A8E6C1] rounded-xl p-10 text-center cursor-pointer hover:bg-[#E5F5E5] transition-colors">
                <Upload className="w-10 h-10 text-[#27AE60] mx-auto mb-3" />
                <p className="text-sm font-bold text-[#1A1A1A] mb-1">Click to select your resume</p>
                <p className="text-xs text-[#666666]">PDF, DOC, DOCX, or TXT - up to 10MB</p>
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileSelect} className="hidden" />
              </div>
            </label>

            {error && <ErrorBanner text={error} />}
          </div>
        </div>
      </div>
    );
  }

  // stage === 'review'
  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <TejomaLogo size="md" textColorClass="text-[#1A1A1A]" />
          <button type="button" onClick={() => { setStage('upload'); fileRef.current = null; if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-xs font-semibold text-[#666666] hover:text-[#1A1A1A] cursor-pointer flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Start Over
          </button>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1A1A1A]">Review &amp; edit your profile</h1>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${
              isFresher ? 'bg-[#EAF2FF] text-[#2962FF] border-[#D6E4FF]' : 'bg-[#E5F5E5] text-[#1E8449] border-[#A8E6C1]'
            }`}>
              {isFresher ? <GraduationCap className="w-3 h-3" /> : <Briefcase className="w-3 h-3" />}
              {isFresher ? 'Fresh Graduate Profile' : 'Experienced Professional Profile'}
            </span>
          </div>
          <p className="text-[#666666] text-xs mt-2 bg-[#F8F9FA] border border-[#E5E7EB] rounded-lg px-3.5 py-2.5">
            {isFresher
              ? "We've tailored this form for a fresh graduate based on your resume - no work history was detected. Everything below is a first draft: review it, fix anything that's off, and add whatever's missing."
              : "This is a first draft from your resume - review it carefully, fix anything AI got wrong, and add whatever's missing."}
            {' '}Nothing is saved until you submit below.
          </p>
          {confidenceLevel === 'low' && (
            <p className="text-[#B7791F] text-xs mt-2 bg-[#FFF7E6] border border-[#F5D999] rounded-lg px-3.5 py-2.5 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              We weren't fully confident in everything we pulled from this resume - fields marked "Needs Review" below are worth a closer look.
            </p>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {error && <ErrorBanner text={error} />}

          <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-[#1A1A1A]">Profile Strength</p>
              <p className="text-xs font-bold text-[#27AE60]">{strengthPercent}%</p>
            </div>
            <div className="w-full h-1.5 bg-[#F0F0F0] rounded-full overflow-hidden">
              <div className="h-full bg-[#27AE60] transition-all" style={{ width: `${strengthPercent}%` }} />
            </div>
            {strengthMissing.length > 0 && (
              <p className="text-[10px] text-[#999999] mt-2">
                Add {strengthMissing.slice(0, 3).join(', ')}{strengthMissing.length > 3 ? ', and more' : ''} to strengthen your profile.
              </p>
            )}
          </div>

          <Section icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="About">
            <SmartField id="name" label="Full Name" value={name} onChange={setName} placeholder="Your full name"
              aiExtracted={aiExtracted(name, parsedSnapshot.name)} needsReview={needsReview(name, parsedSnapshot.name)} />
            <SmartField id="headline" label="Headline" value={headline} onChange={setHeadline} placeholder={isFresher ? 'e.g. Aspiring Frontend Developer' : 'e.g. Senior Frontend Engineer'}
              aiExtracted={aiExtracted(headline, parsedSnapshot.headline)} needsReview={needsReview(headline, parsedSnapshot.headline)} />
            <SmartField id="location" label="Location" value={location} onChange={setLocation} placeholder="e.g. Bengaluru, India"
              aiExtracted={aiExtracted(location, parsedSnapshot.location)} needsReview={needsReview(location, parsedSnapshot.location)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">Email</label>
                <input type="text" value={accountEmail} disabled className="w-full bg-[#F8F9FA] border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#999999] text-sm cursor-not-allowed" />
                <p className="text-[10px] text-[#999999] mt-1">Your login email - contact support to change this.</p>
              </div>
              <div>
                <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">Phone</label>
                <input type="text" value={accountPhone || 'Not set'} disabled className="w-full bg-[#F8F9FA] border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#999999] text-sm cursor-not-allowed" />
                <p className="text-[10px] text-[#999999] mt-1">Your login phone - contact support to change this.</p>
              </div>
            </div>
          </Section>

          {employmentSectionRevealed ? (
            <Section icon={<Briefcase className="w-4 h-4 text-[#27AE60]" />} title="Employment History">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <SmartField id="yearsOfExperience" label="Experience" value={yearsOfExperience} onChange={setYearsOfExperience} placeholder="e.g. 5 years"
                  aiExtracted={aiExtracted(yearsOfExperience, parsedSnapshot.yearsOfExperience)} needsReview={needsReview(yearsOfExperience, parsedSnapshot.yearsOfExperience)}
                  conflict={conflictWith(yearsOfExperience, parsedSnapshot.yearsOfExperience)}
                  validation={conflictWith(yearsOfExperience, parsedSnapshot.yearsOfExperience) ? null : validateExperienceText(yearsOfExperience)} />
                <SmartField id="currentCompany" label="Current Company" value={currentCompany} onChange={setCurrentCompany} placeholder="e.g. Acme Corp"
                  aiExtracted={aiExtracted(currentCompany, parsedSnapshot.currentCompany)} needsReview={needsReview(currentCompany, parsedSnapshot.currentCompany)}
                  conflict={conflictWith(currentCompany, parsedSnapshot.currentCompany)} />
              </div>
              <SmartField id="currentJobTitle" label="Current Designation" value={currentJobTitle} onChange={setCurrentJobTitle} placeholder="e.g. Senior Software Engineer"
                aiExtracted={aiExtracted(currentJobTitle, parsedSnapshot.currentJobTitle)} needsReview={needsReview(currentJobTitle, parsedSnapshot.currentJobTitle)} />
              {previousCompanies.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-[#666666] uppercase tracking-wide mb-2">Previous Companies (from your resume)</p>
                  <div className="flex flex-wrap gap-2">
                    {previousCompanies.map((c, i) => (
                      <span key={i} className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#F3F2EF] text-[#666666] border border-[#E5E7EB]">{c}</span>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#999999] mt-1.5">Shown for reference - add anything relevant to your Professional Summary below.</p>
                </div>
              )}
            </Section>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-dashed border-[#E5E7EB] p-6 sm:p-7 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-bold text-[#1A1A1A]">Have work experience to add?</p>
                <p className="text-xs text-[#999999] mt-1">Internships, freelance work, or a job - add your employment details.</p>
              </div>
              <button
                type="button"
                onClick={() => setEmploymentSectionRevealed(true)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#27AE60] border border-[#A8E6C1] bg-[#E5F5E5] hover:bg-[#27AE60] hover:text-white px-4 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Employment Details
              </button>
            </div>
          )}

          <Section icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Skills">
            <ChipInput label="Skills" values={skills} onChange={setSkills} placeholder="Add a skill..." />
          </Section>

          <Section icon={<GraduationCap className="w-4 h-4 text-[#27AE60]" />} title="Education">
            <SmartField id="education" label="Education" value={education} onChange={setEducation} placeholder="e.g. B.Tech, XYZ University"
              aiExtracted={aiExtracted(education, parsedSnapshot.education)} needsReview={needsReview(education, parsedSnapshot.education)} />
            <SmartField id="graduationYear" label="Graduation Year" value={graduationYear} onChange={setGraduationYear} placeholder="e.g. 2024"
              aiExtracted={aiExtracted(graduationYear, parsedSnapshot.graduationYear)} needsReview={needsReview(graduationYear, parsedSnapshot.graduationYear)}
              validation={validateYearText(graduationYear)} />
          </Section>

          <Section
            icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />}
            title="Certifications &amp; Projects"
            description={isFresher ? 'Include internships, academic projects, freelance work, research, teaching assistantships, or volunteer work here.' : undefined}
          >
            <ChipInput label="Certifications" values={certifications} onChange={setCertifications} placeholder="Add a certification..." />
            <SmartField
              id="projects"
              label="Projects"
              value={projects}
              onChange={setProjects}
              placeholder={isFresher ? 'Describe an internship, academic project, or personal project' : "Describe a project you've built"}
              textarea
              aiExtracted={aiExtracted(projects, parsedSnapshot.projects)}
              needsReview={needsReview(projects, parsedSnapshot.projects)}
            />
          </Section>

          <Section icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Languages &amp; Summary">
            <ChipInput label="Languages" values={languages} onChange={setLanguages} placeholder="Add a language..." />
            <SmartField
              id="summary"
              label={isFresher ? 'Career Objective / Summary' : 'Professional Summary'}
              value={summary}
              onChange={setSummary}
              placeholder="A short summary about yourself"
              textarea
              aiExtracted={aiExtracted(summary, parsedSnapshot.summary)}
              needsReview={needsReview(summary, parsedSnapshot.summary)}
            />
          </Section>

          <Section icon={<Link2 className="w-4 h-4 text-[#27AE60]" />} title="Social Links">
            <SmartField id="linkedinUrl" label="LinkedIn" value={linkedinUrl} onChange={setLinkedinUrl} placeholder="https://linkedin.com/in/yourname"
              aiExtracted={aiExtracted(linkedinUrl, parsedSnapshot.linkedinUrl)} needsReview={needsReview(linkedinUrl, parsedSnapshot.linkedinUrl)}
              validation={validateUrlText(linkedinUrl, 'linkedin.com')} />
            <SmartField id="githubUrl" label={isFresher ? 'GitHub / Portfolio' : 'GitHub'} value={githubUrl} onChange={setGithubUrl} placeholder="https://github.com/yourname"
              aiExtracted={aiExtracted(githubUrl, parsedSnapshot.githubUrl)} needsReview={needsReview(githubUrl, parsedSnapshot.githubUrl)}
              validation={validateUrlText(githubUrl, isFresher ? undefined : 'github.com')} />
          </Section>

          {employmentSectionRevealed && (
            <Section icon={<Wallet className="w-4 h-4 text-[#27AE60]" />} title="Career Preferences">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <SmartField id="noticePeriod" label="Notice Period" value={noticePeriod} onChange={setNoticePeriod} placeholder="e.g. 30 days"
                  aiExtracted={aiExtracted(noticePeriod, parsedSnapshot.noticePeriod)} needsReview={needsReview(noticePeriod, parsedSnapshot.noticePeriod)}
                  validation={validateNoticePeriodText(noticePeriod)} />
                <SmartField id="currentCtc" label="Current Salary" value={currentCtc} onChange={setCurrentCtc} placeholder="e.g. 12 LPA"
                  aiExtracted={aiExtracted(currentCtc, parsedSnapshot.currentCtc)} needsReview={needsReview(currentCtc, parsedSnapshot.currentCtc)}
                  validation={validateSalaryText(currentCtc, 'Current Salary')} />
              </div>
              <SmartField id="expectedCtc" label="Expected Salary" value={expectedCtc} onChange={setExpectedCtc} placeholder="e.g. 18 LPA"
                aiExtracted={aiExtracted(expectedCtc, parsedSnapshot.expectedCtc)} needsReview={needsReview(expectedCtc, parsedSnapshot.expectedCtc)}
                conflict={conflictWith(expectedCtc, parsedSnapshot.expectedCtc)}
                validation={conflictWith(expectedCtc, parsedSnapshot.expectedCtc) ? null : validateSalaryText(expectedCtc, 'Expected Salary')} />
            </Section>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-sm font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-60"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Profile & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
