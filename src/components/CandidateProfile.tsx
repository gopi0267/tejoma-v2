import React, { useState, useEffect, useMemo } from 'react';
import {
  Save, MapPin, Briefcase, GraduationCap, Sparkles, FileText,
  Wallet, Clock, CheckCircle2, Mail, Phone, Upload,
} from 'lucide-react';
import { ErrorBanner } from './Login.js';
import { ChipInput } from './CandidateOnboardingSkills.js';
import { useCandidateAuth } from '../context/CandidateAuthContext.js';
import {
  NAV_SECTIONS, scrollToSection, formatDate, EmptyNote, ExperienceEntryCard,
  computeCandidateInsights, AIInsightsCard, CandidateExperience, ResumeFileManager,
} from './CandidateProfileSections.js';

interface ProfileData {
  id: number;
  name: string;
  email: string;
  phone: string;
  headline: string | null;
  skills: string[];
  years_of_experience: string | null;
  location: string | null;
  education: string | null;
  summary: string | null;
  completion: { percent: number; filled: number; total: number };
  current_company: string | null;
  certifications: string[];
  tools: string[];
  languages: string[];
  notice_period: string | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  open_to_work: boolean;
  visible_to_recruiters: boolean;
  course_name: string | null;
  course_type: string | null;
  specialization: string | null;
  institution_name: string | null;
  start_year: string | null;
  end_year: string | null;
  grading_system: string | null;
  grade_value: string | null;
  primary_skill: string | null;
  secondary_skills: string[];
  updated_at?: string;
  resume_original_filename?: string | null;
  resume_file_uploaded_at?: string | null;
}

// Plain, unstyled-by-TextField inputs on purpose: Login.tsx's shared TextField hardcodes
// `required`, which is correct for login/registration fields but wrong here - every profile
// field except name is optional, and a required attribute would block saving a partial profile.
export function ProfileField({ label, value, onChange, placeholder, textarea }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  const className = "w-full bg-white border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors";
  return (
    <div>
      <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">{label}</label>
      {textarea ? (
        <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={className} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={className} />
      )}
    </div>
  );
}

// Shared dropdown, same visual language as ProfileField above - added for the onboarding wizard
// (Qualification/Course Type/Grading System/Employment Type selects), exported here rather than
// duplicated per-step since this is already the established home for reusable profile-field UI.
export function SelectField({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
      >
        <option value="" disabled>{placeholder || `Select ${label.toLowerCase()}`}</option>
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

// Original circular progress ring (not copied from any UI kit) - a more premium completion
// indicator than a flat bar, used in the profile header.
function CompletionRing({ percent }: { percent: number }) {
  const size = 76;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E5E5E5" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#27AE60" strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-black text-[#1A1A1A] leading-none">{percent}%</span>
        <span className="text-[7px] font-bold text-[#999999] uppercase tracking-wide mt-0.5">Complete</span>
      </div>
    </div>
  );
}

function SectionCard({ id, icon, title, subtitle, children }: { id: string; icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-6 sm:p-7 scroll-mt-40">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-lg bg-[#E5F5E5] flex items-center justify-center flex-shrink-0">{icon}</div>
        <h2 className="text-sm font-bold text-[#1A1A1A]">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-[#999999] ml-[42px] mb-5">{subtitle}</p>}
      <div className={`space-y-5 ${subtitle ? '' : 'mt-5'}`}>{children}</div>
    </div>
  );
}

const QUALIFICATIONS = ['Doctorate / PhD', 'Masters / Post Graduation', 'Graduation / Diploma', '12th', '10th', 'Below 10th'];
const COURSE_TYPES = ['Full Time', 'Part Time', 'Distance Learning', 'Online'];
const GRADING_SYSTEMS = ['Percentage', 'CGPA', 'GPA', 'Grade'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'U';
}

export default function CandidateProfile({ onUploadResume }: { onUploadResume?: () => void }) {
  const { refreshCandidate } = useCandidateAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [experiences, setExperiences] = useState<CandidateExperience[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [location, setLocation] = useState('');
  const [summary, setSummary] = useState('');

  const [primarySkill, setPrimarySkill] = useState('');
  const [secondarySkills, setSecondarySkills] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [certifications, setCertifications] = useState<string[]>([]);

  const [qualification, setQualification] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseType, setCourseType] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [institution, setInstitution] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [gradingSystem, setGradingSystem] = useState('');
  const [gradeValue, setGradeValue] = useState('');

  const [currentCompany, setCurrentCompany] = useState('');
  const [noticePeriod, setNoticePeriod] = useState('');
  const [currentCtc, setCurrentCtc] = useState('');
  const [expectedCtc, setExpectedCtc] = useState('');
  const [openToWork, setOpenToWork] = useState(true);
  const [visibleToRecruiters, setVisibleToRecruiters] = useState(true);

  const loadFromProfile = (data: ProfileData) => {
    setProfile(data);
    setName(data.name);
    setHeadline(data.headline || '');
    setSkills(data.skills || []);
    setYearsOfExperience(data.years_of_experience || '');
    setLocation(data.location || '');
    setSummary(data.summary || '');
    setPrimarySkill(data.primary_skill || '');
    setSecondarySkills(data.secondary_skills || []);
    setTools(data.tools || []);
    setLanguages(data.languages || []);
    setCertifications(data.certifications || []);
    setQualification(data.education || '');
    setCourseName(data.course_name || '');
    setCourseType(data.course_type || '');
    setSpecialization(data.specialization || '');
    setInstitution(data.institution_name || '');
    setStartYear(data.start_year || '');
    setEndYear(data.end_year || '');
    setGradingSystem(data.grading_system || '');
    setGradeValue(data.grade_value || '');
    setCurrentCompany(data.current_company || '');
    setNoticePeriod(data.notice_period || '');
    setCurrentCtc(data.current_ctc || '');
    setExpectedCtc(data.expected_ctc || '');
    setOpenToWork(data.open_to_work ?? true);
    setVisibleToRecruiters(data.visible_to_recruiters ?? true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profileRes, experiencesRes] = await Promise.all([
          fetch('/api/candidate-profile/me'),
          fetch('/api/candidate-profile/experiences'),
        ]);
        if (profileRes.ok) {
          const data = await profileRes.json();
          if (!cancelled) loadFromProfile(data);
        }
        if (experiencesRes.ok) {
          const data = await experiencesRes.json();
          if (!cancelled) setExperiences(data.experiences || []);
        }
      } catch {
        if (!cancelled) setError('Failed to load your profile.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/candidate-profile/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          headline: headline || null,
          skills,
          years_of_experience: yearsOfExperience || null,
          location: location || null,
          education: qualification || null,
          summary: summary || null,
          current_company: currentCompany || null,
          certifications,
          tools,
          languages,
          notice_period: noticePeriod || null,
          current_ctc: currentCtc || null,
          expected_ctc: expectedCtc || null,
          open_to_work: openToWork,
          visible_to_recruiters: visibleToRecruiters,
          course_name: courseName || null,
          course_type: courseType || null,
          specialization: specialization || null,
          institution_name: institution || null,
          start_year: startYear || null,
          end_year: endYear || null,
          grading_system: gradingSystem || null,
          grade_value: gradeValue || null,
          primary_skill: primarySkill || null,
          secondary_skills: secondarySkills,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save profile');
      loadFromProfile(data);
      await refreshCandidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const internshipEntries = useMemo(() => experiences.filter((e) => e.employment_type === 'Internship').slice().reverse(), [experiences]);
  const employmentEntries = useMemo(() => experiences.filter((e) => e.employment_type !== 'Internship').slice().reverse(), [experiences]);
  const preferredLocations = useMemo(() => {
    const tokens = experiences
      .map((e) => e.preferred_location)
      .filter((v): v is string => !!v && v.trim().length > 0)
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    return Array.from(new Set(tokens));
  }, [experiences]);

  const insights = useMemo(() => {
    if (!profile) return null;
    const sectionChecks = [
      !!(profile.notice_period || profile.current_ctc || profile.expected_ctc || preferredLocations.length > 0), // career preferences
      !!(profile.education || profile.course_name || profile.institution_name), // education
      !!(profile.primary_skill || profile.secondary_skills.length > 0 || profile.skills.length > 0 || profile.tools.length > 0), // key skills
      profile.languages.length > 0, // languages
      internshipEntries.length > 0, // internships
      false, // projects - not part of the current data model
      !!(profile.summary && profile.summary.trim()), // profile summary
      profile.certifications.length > 0, // certifications
      !!(profile.current_company || profile.years_of_experience || employmentEntries.length > 0), // employment history
      false, // academic achievements - not part of the current data model
      !!profile.resume_original_filename, // resume
    ];
    const sectionsWithContent = sectionChecks.filter(Boolean).length;
    return computeCandidateInsights(profile, sectionsWithContent, sectionChecks.length);
  }, [profile, internshipEntries.length, employmentEntries.length, preferredLocations.length]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="w-10 h-10 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
      </div>
    );
  }

  const lastUpdated = formatDate(profile?.updated_at);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8FAFC' }}>
      {/* ==================== STICKY PROFILE HEADER ==================== */}
      <div className="sticky top-16 z-20 bg-white border-b border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-white text-xl font-black shadow-sm flex-shrink-0"
              style={{ background: 'linear-gradient(160deg, #27AE60 0%, #1E8449 100%)' }}
            >
              {initials(name || 'U')}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-[#1A1A1A] truncate">{name || 'Your Profile'}</h1>
                {openToWork && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#1E8449] bg-[#E5F5E5] border border-[#A8E6C1] px-2 py-0.5 rounded-full uppercase tracking-wider">
                    <CheckCircle2 className="w-2.5 h-2.5" /> Open to Work
                  </span>
                )}
              </div>
              {headline && <p className="text-xs text-[#666666] mt-0.5 truncate">{headline}</p>}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[11px] text-[#666666]">
                {location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[#999999]" />{location}</span>}
                {profile?.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-[#999999]" />{profile.email}</span>}
                {profile?.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-[#999999]" />{profile.phone}</span>}
                {lastUpdated && <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-[#999999]" />Updated {lastUpdated}</span>}
              </div>

              <div className="flex items-center gap-2 mt-3">
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                  profile?.resume_original_filename ? 'text-[#1E8449] bg-[#E5F5E5] border-[#A8E6C1]' : 'text-[#999999] bg-[#F8F9FA] border-[#E5E7EB]'
                }`}>
                  <FileText className="w-3 h-3" /> {profile?.resume_original_filename ? 'Resume on file' : 'No resume on file'}
                </span>
                <button
                  type="button"
                  onClick={() => scrollToSection('resume')}
                  className="text-[11px] font-semibold text-[#27AE60] hover:underline cursor-pointer"
                >
                  Manage Resume
                </button>
              </div>
            </div>

            {profile && (
              <div className="flex-shrink-0 self-center sm:self-start">
                <CompletionRing percent={profile.completion.percent} />
              </div>
            )}
          </div>
        </div>

        {/* Mobile / tablet horizontal quick nav */}
        <div className="lg:hidden border-t border-[#F0F0F0] overflow-x-auto">
          <div className="flex gap-1 px-4 py-2 min-w-max">
            {NAV_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToSection(s.id)}
                className="text-[11px] font-medium text-[#666666] hover:text-[#1E8449] hover:bg-[#E5F5E5] rounded-full px-3 py-1.5 whitespace-nowrap transition-colors cursor-pointer"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6">
        <form onSubmit={handleSave} className="flex flex-col lg:flex-row gap-6 items-start">

          {/* ==================== DESKTOP QUICK NAV ==================== */}
          <nav className="hidden lg:block w-52 flex-shrink-0 sticky top-[168px] self-start bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-3">
            <div className="flex flex-col gap-1">
              {NAV_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollToSection(s.id)}
                  className="text-left text-xs font-medium text-[#666666] hover:text-[#1E8449] hover:bg-[#E5F5E5] rounded-lg px-3 py-2 transition-colors cursor-pointer"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </nav>

          {/* ==================== MAIN: sectioned content ==================== */}
          <div className="flex-1 min-w-0 space-y-5">
            {error && <ErrorBanner text={error} />}
            {saved && (
              <div className="bg-[#E5F5E5] border border-[#A8E6C1] p-3.5 rounded-xl text-[#1E8449] text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Profile saved successfully.
              </div>
            )}

            {insights && <AIInsightsCard insights={insights} />}

            {/* Career Preferences */}
            <SectionCard id="career-preferences" icon={<Wallet className="w-4 h-4 text-[#27AE60]" />} title="Career Preferences">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <ProfileField label="Notice Period" value={noticePeriod} onChange={setNoticePeriod} placeholder="e.g. 30 days" />
                <ProfileField label="Current CTC" value={currentCtc} onChange={setCurrentCtc} placeholder="e.g. 12 LPA" />
                <ProfileField label="Expected CTC" value={expectedCtc} onChange={setExpectedCtc} placeholder="e.g. 18 LPA" />
              </div>

              {preferredLocations.length > 0 ? (
                <div>
                  <p className="text-[#1A1A1A] text-sm font-medium mb-1.5">Preferred Locations</p>
                  <p className="text-xs text-[#666666]">{preferredLocations.join(', ')}</p>
                  <p className="text-[10px] text-[#999999] mt-1">From the work experience you've added below - edit there to change it.</p>
                </div>
              ) : (
                <EmptyNote text="No preferred locations yet - add a work experience entry with a preferred location during onboarding, or from the Employment History section below." />
              )}

              <label className="flex items-center justify-between gap-3 bg-[#F8F9FA] rounded-xl p-4 cursor-pointer hover:bg-[#F3F2EF] transition-colors">
                <div>
                  <span className="text-sm font-semibold text-[#1A1A1A] block">Visible to recruiters</span>
                  <span className="text-xs text-[#999999]">Appear in recruiter candidate search results</span>
                </div>
                <input type="checkbox" checked={visibleToRecruiters} onChange={(e) => setVisibleToRecruiters(e.target.checked)} className="w-5 h-5 rounded border-[#CCCCCC] text-[#27AE60] focus:ring-[#27AE60] flex-shrink-0" />
              </label>
              <label className="flex items-center justify-between gap-3 bg-[#F8F9FA] rounded-xl p-4 cursor-pointer hover:bg-[#F3F2EF] transition-colors">
                <div>
                  <span className="text-sm font-semibold text-[#1A1A1A] block">Open to work</span>
                  <span className="text-xs text-[#999999]">Show an "Open to Work" badge on your profile</span>
                </div>
                <input type="checkbox" checked={openToWork} onChange={(e) => setOpenToWork(e.target.checked)} className="w-5 h-5 rounded border-[#CCCCCC] text-[#27AE60] focus:ring-[#27AE60] flex-shrink-0" />
              </label>
            </SectionCard>

            {/* Education */}
            <SectionCard id="education" icon={<GraduationCap className="w-4 h-4 text-[#27AE60]" />} title="Education">
              <SelectField label="Highest Qualification" value={qualification} onChange={setQualification} options={QUALIFICATIONS} />
              <ProfileField label="Course Name" value={courseName} onChange={setCourseName} placeholder="e.g. B.Tech, B.Com, M.Sc" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <SelectField label="Course Type" value={courseType} onChange={setCourseType} options={COURSE_TYPES} />
                <ProfileField label="Specialization" value={specialization} onChange={setSpecialization} placeholder="e.g. Computer Science" />
              </div>
              <ProfileField label="University / Institution" value={institution} onChange={setInstitution} placeholder="e.g. XYZ University" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <ProfileField label="Starting Year" value={startYear} onChange={setStartYear} placeholder="e.g. 2018" />
                <ProfileField label="Ending Year" value={endYear} onChange={setEndYear} placeholder="e.g. 2022" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <SelectField label="Grading System" value={gradingSystem} onChange={setGradingSystem} options={GRADING_SYSTEMS} />
                <ProfileField label="Grade Value" value={gradeValue} onChange={setGradeValue} placeholder="e.g. 8.5 or 85%" />
              </div>
            </SectionCard>

            {/* Key Skills */}
            <SectionCard id="key-skills" icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Key Skills" subtitle="Recruiters search by these - the more specific, the better.">
              <ProfileField label="Primary Skill" value={primarySkill} onChange={setPrimarySkill} placeholder="e.g. React Development" />
              <ChipInput label="Secondary Skills" values={secondarySkills} onChange={setSecondarySkills} placeholder="Add a secondary skill..." />
              <ChipInput label="Technical Skills" values={skills} onChange={setSkills} placeholder="Add a technical skill..." />
              <ChipInput label="Tools & Technologies" values={tools} onChange={setTools} placeholder="Add a tool..." />
            </SectionCard>

            {/* Languages */}
            <SectionCard id="languages" icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Languages">
              <ChipInput label="Languages Known" values={languages} onChange={setLanguages} placeholder="Add a language..." />
            </SectionCard>

            {/* Internships */}
            <SectionCard id="internships" icon={<Briefcase className="w-4 h-4 text-[#27AE60]" />} title="Internships">
              {internshipEntries.length > 0 ? (
                <div className="space-y-3">
                  {internshipEntries.map((exp) => <ExperienceEntryCard key={exp.id} exp={exp} />)}
                </div>
              ) : (
                <EmptyNote text="No internships have been added to your profile yet. Internships you add during onboarding (marked as Employment Type: Internship) will appear here." />
              )}
            </SectionCard>

            {/* Projects */}
            <SectionCard id="projects" icon={<FileText className="w-4 h-4 text-[#27AE60]" />} title="Projects">
              <EmptyNote text="Project details aren't captured by your profile yet. This section will appear filled in once project tracking is added to candidate profiles." />
            </SectionCard>

            {/* Profile Summary */}
            <SectionCard id="profile-summary" icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Profile Summary">
              <ProfileField label="Full name" value={name} onChange={setName} placeholder="Your full name" />
              <ProfileField label="Headline" value={headline} onChange={setHeadline} placeholder="e.g. Senior Frontend Engineer" />
              <ProfileField label="Location" value={location} onChange={setLocation} placeholder="e.g. Bengaluru, India" />
              <ProfileField label="Summary" value={summary} onChange={setSummary} placeholder="A short summary about yourself" textarea />
            </SectionCard>

            {/* Certifications */}
            <SectionCard id="certifications" icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Certifications">
              <ChipInput label="Certifications" values={certifications} onChange={setCertifications} placeholder="Add a certification..." />
            </SectionCard>

            {/* Employment History */}
            <SectionCard id="employment-history" icon={<Briefcase className="w-4 h-4 text-[#27AE60]" />} title="Employment History">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <ProfileField label="Total Years of Experience" value={yearsOfExperience} onChange={setYearsOfExperience} placeholder="e.g. 5 years" />
                <ProfileField label="Current Company" value={currentCompany} onChange={setCurrentCompany} placeholder="e.g. Acme Corp" />
              </div>

              {employmentEntries.length > 0 ? (
                <div className="space-y-3 pt-2 border-t border-[#F0F0F0]">
                  {employmentEntries.map((exp) => <ExperienceEntryCard key={exp.id} exp={exp} />)}
                </div>
              ) : (
                <EmptyNote text="No detailed work experience entries have been added yet. Entries you add during onboarding will appear here." />
              )}
            </SectionCard>

            {/* Academic Achievements */}
            <SectionCard id="academic-achievements" icon={<GraduationCap className="w-4 h-4 text-[#27AE60]" />} title="Academic Achievements">
              <EmptyNote text="Awards, hackathons, publications, and competitions aren't captured by your profile yet. This section will appear filled in once achievement tracking is added to candidate profiles." />
            </SectionCard>

            {/* Resume */}
            <SectionCard id="resume" icon={<FileText className="w-4 h-4 text-[#27AE60]" />} title="Resume">
              <div>
                <p className="text-[#1A1A1A] text-sm font-semibold mb-1">Your Resume File</p>
                <p className="text-xs text-[#666666] mb-3">Keep a copy of your resume on file - view, download, or replace it any time.</p>
                <ResumeFileManager
                  filename={profile?.resume_original_filename ?? null}
                  uploadedAt={profile?.resume_file_uploaded_at ?? null}
                  onUploaded={(data) => setProfile((prev) => (prev ? { ...prev, ...data } : prev))}
                />
              </div>

              {onUploadResume && (
                <div className="pt-5 border-t border-[#F0F0F0]">
                  <p className="text-[#1A1A1A] text-sm font-semibold mb-1">Auto-fill Profile from Resume</p>
                  <p className="text-xs text-[#666666] mb-3">Upload a resume to automatically extract details like skills, education, and summary - you'll review everything before it's saved to your profile.</p>
                  <button
                    type="button"
                    onClick={onUploadResume}
                    className="w-full sm:w-auto bg-white border border-[#27AE60] text-[#27AE60] hover:bg-[#E5F5E5] text-xs font-semibold py-3 px-5 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Upload className="w-4 h-4" /> Extract Details from Resume
                  </button>
                </div>
              )}
            </SectionCard>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-60"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
