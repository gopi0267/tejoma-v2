/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  X, Trash2, MapPin, Mail, Phone, Briefcase, GraduationCap, Sparkles,
  Building2, FolderKanban, FileText, Award, Languages as LanguagesIcon,
  ClipboardList, Trophy, Clock, Navigation, LucideIcon,
} from 'lucide-react';
import { Candidate } from '../types.js';

interface CandidateProfileViewProps {
  candidate: Candidate;
  onClose: () => void;
  onDelete: (id: number) => void;
}

const NAV_SECTIONS = [
  { id: 'career-preferences', label: 'Career Preferences' },
  { id: 'education', label: 'Education' },
  { id: 'key-skills', label: 'Key Skills' },
  { id: 'languages', label: 'Languages' },
  { id: 'internships', label: 'Internships' },
  { id: 'projects', label: 'Projects' },
  { id: 'profile-summary', label: 'Profile Summary' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'employment-history', label: 'Employment History' },
  { id: 'academic-achievements', label: 'Academic Achievements' },
  { id: 'resume', label: 'Resume' },
];

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

function splitList(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

// Unset text columns in this table default to the literal string 'NULL' (see schema.sql's
// `TEXT DEFAULT 'NULL'`), not a real SQL NULL - the write path (candidatePayloadFromExtracted in
// candidate.routes.ts) scrubs this before insert for candidates created through the app, but
// rows from other paths (bulk import, older data) can still carry the raw sentinel through to
// the client. Every text field is cleaned once here so nothing downstream ever has to special-
// case it, and no section mistakes "NULL" for a real value.
function clean(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  const trimmed = val.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'null' ? '' : trimmed;
}

const SANITIZED_TEXT_FIELDS: (keyof Candidate)[] = [
  'name', 'email', 'phone', 'primary_skills', 'secondary_skills', 'years_of_experience',
  'current_location', 'preferred_location', 'current_company', 'current_job_title',
  'industry_domain', 'education', 'highest_qualification', 'graduation_year', 'university',
  'projects', 'technical_tools', 'languages_known', 'current_ctc', 'expected_ctc',
  'notice_period', 'willingness_to_relocate', 'linkedin_url', 'github_or_portfolio_url',
  'resume_summary', 'resume_text', 'ai_confidence_score', 'extraction_status', 'resume_file_path',
];

function sanitizeCandidate(c: Candidate): Candidate {
  const cleaned: Record<string, unknown> = { ...c };
  for (const field of SANITIZED_TEXT_FIELDS) {
    cleaned[field] = clean(c[field] as unknown as string);
  }
  cleaned.skills = (c.skills || []).map(clean).filter(Boolean);
  cleaned.previous_companies = (c.previous_companies || []).map(clean).filter(Boolean);
  cleaned.certifications = (c.certifications || []).map(clean).filter(Boolean);
  return cleaned as unknown as Candidate;
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==================== AI Insights (computed, not fetched) ====================
// Every number here is derived purely from fields already present on this candidate record -
// nothing is fetched, guessed, or hardcoded. "Match Readiness" deliberately mirrors the exact
// inputs the real matching engine consumes (see computeMatchFeatures in services.ts: skills,
// resume_text, years_of_experience, current_location, expected/current_ctc), so it reflects how
// much signal the matcher actually has for this candidate - not a live prediction against any
// specific job. "Resume Completeness" is a broader field-presence check across the full profile.
function computeInsights(c: Candidate) {
  const completenessChecks = [
    !!c.name, !!c.email, !!c.phone, !!c.current_location, !!c.current_job_title,
    !!c.current_company, !!c.years_of_experience, (c.skills?.length ?? 0) > 0,
    !!c.highest_qualification, !!c.university, !!c.graduation_year,
    (c.certifications?.length ?? 0) > 0, !!c.projects, !!c.technical_tools,
    !!c.languages_known, !!c.current_ctc, !!c.expected_ctc, !!c.notice_period,
    !!(c.linkedin_url || c.github_or_portfolio_url), !!c.resume_summary,
  ];
  const completenessScore = Math.round((completenessChecks.filter(Boolean).length / completenessChecks.length) * 100);

  const matchReadinessChecks = [
    (c.skills?.length ?? 0) > 0,
    (c.resume_text?.trim().length ?? 0) > 40,
    !!c.years_of_experience,
    !!c.current_location,
    !!(c.expected_ctc || c.current_ctc),
  ];
  const matchReadinessScore = Math.round((matchReadinessChecks.filter(Boolean).length / matchReadinessChecks.length) * 100);

  const rawSkills = (c.skills?.length ?? 0) > 0 ? c.skills : [...splitList(c.primary_skills), ...splitList(c.secondary_skills)];
  const topSkills = Array.from(new Set(rawSkills.map((s) => s.trim()).filter(Boolean))).slice(0, 8);

  const expParts: string[] = [];
  if (c.years_of_experience) expParts.push(`${c.years_of_experience} of experience`);
  if (c.current_job_title) expParts.push(`currently ${c.current_job_title}`);
  if (c.current_company) expParts.push(`at ${c.current_company}`);
  const experienceSummary = expParts.length > 0
    ? `${expParts.join(' ')}${c.industry_domain ? `, primarily in ${c.industry_domain}.` : '.'}`
    : 'Not enough resume data to summarize experience yet.';

  let strengthLabel = 'Incomplete';
  let strengthClass = 'text-rose-700 bg-rose-50 border-rose-200';
  if (completenessScore >= 80) { strengthLabel = 'Excellent'; strengthClass = 'text-emerald-700 bg-emerald-50 border-emerald-200'; }
  else if (completenessScore >= 60) { strengthLabel = 'Strong'; strengthClass = 'text-blue-700 bg-blue-50 border-blue-200'; }
  else if (completenessScore >= 35) { strengthLabel = 'Needs Improvement'; strengthClass = 'text-amber-700 bg-amber-50 border-amber-200'; }

  return { completenessScore, matchReadinessScore, topSkills, experienceSummary, strengthLabel, strengthClass };
}

function extractionStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'complete') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (s === 'partial') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (s === 'failed') return 'text-rose-700 bg-rose-50 border-rose-200';
  return 'text-slate-600 bg-slate-50 border-slate-200';
}

// ==================== Small shared building blocks ====================

function InsightStat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-3.5 py-3">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-1 ${valueClass || 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function ProfileSection({ id, title, icon: Icon, children }: { id: string; title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 italic bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-3">{text}</p>;
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-slate-900 font-medium mt-1">{value}</p>
    </div>
  );
}

function ChipList({ items, tone = 'emerald' }: { items: string[]; tone?: 'emerald' | 'slate' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, idx) => (
        <span key={idx} className={`text-xs font-medium px-3 py-1.5 rounded-full border ${cls}`}>{item}</span>
      ))}
    </div>
  );
}

// ==================== Main component ====================

export default function CandidateProfileView({ candidate: rawCandidate, onClose, onDelete }: CandidateProfileViewProps) {
  const candidate = sanitizeCandidate(rawCandidate);
  const insights = computeInsights(candidate);
  const previousCompanies = candidate.previous_companies || [];
  const certifications = candidate.certifications || [];
  const languageChips = splitList(candidate.languages_known);
  const primarySkillChips = splitList(candidate.primary_skills);
  const secondarySkillChips = splitList(candidate.secondary_skills);
  const skillChips = (candidate.skills?.length ?? 0) > 0 ? candidate.skills : [...primarySkillChips, ...secondarySkillChips];

  const resumeOnFile = !!candidate.resume_file_path;
  const lastUpdated = formatDate(candidate.updated_at);
  const resumeFileName = candidate.resume_file_path ? candidate.resume_file_path.split(/[\\/]/).pop() : '';

  const hasCareerPrefs = !!(candidate.preferred_location || candidate.current_ctc || candidate.expected_ctc || candidate.notice_period || candidate.willingness_to_relocate);
  const hasEducation = !!(candidate.highest_qualification || candidate.university || candidate.graduation_year || candidate.education);
  const hasEmployment = !!(candidate.current_company || candidate.current_job_title || previousCompanies.length > 0);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-6xl h-full sm:h-[92vh] shadow-2xl flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200 bg-white flex-shrink-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Candidate Profile</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDelete(candidate.id)}
              className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Delete</span>
            </button>
            <button onClick={onClose} aria-label="Close" className="min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="px-4 sm:px-8 pt-6 pb-6 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
            <div className="flex flex-col sm:flex-row sm:items-start gap-5">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-2xl font-bold flex items-center justify-center flex-shrink-0 shadow-sm">
                {initialsOf(candidate.name)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-bold text-slate-900">{candidate.name || 'Unnamed Candidate'}</h2>
                <p className="text-sm font-medium text-slate-500 mt-0.5">{candidate.current_job_title || 'Designation not specified'}</p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-slate-600">
                  {candidate.current_location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{candidate.current_location}</span>}
                  {candidate.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-slate-400" />{candidate.email}</span>}
                  {candidate.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-slate-400" />{candidate.phone}</span>}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-4">
                  {candidate.extraction_status && (
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${extractionStatusClass(candidate.extraction_status)}`}>
                      {candidate.extraction_status}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 border-slate-200">
                    {resumeOnFile ? 'Resume on file' : 'No resume on file'}
                  </span>
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${insights.strengthClass}`}>
                    {insights.completenessScore}% profile complete
                  </span>
                  {lastUpdated && <span className="text-[11px] text-slate-400">Updated {lastUpdated}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row">
            {/* Quick links */}
            <nav className="lg:w-56 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-slate-100 bg-white lg:sticky lg:top-0 lg:self-start overflow-x-auto">
              <div className="flex lg:flex-col gap-1 p-3 sm:p-4 min-w-max lg:min-w-0">
                {NAV_SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className="text-left text-xs font-medium text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg px-3 py-2 whitespace-nowrap lg:whitespace-normal transition-colors cursor-pointer"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </nav>

            {/* Main content */}
            <div className="flex-1 min-w-0 px-4 sm:px-8 py-6 space-y-8">

              {/* AI Insights */}
              <section className="rounded-2xl border border-[#2962FF]/20 bg-gradient-to-br from-[#2962FF]/5 to-white p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full bg-[#2962FF] text-white flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-3.5 h-3.5" />
                  </span>
                  <h3 className="text-sm font-bold text-slate-900">Tejoma AI Insights</h3>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  <InsightStat label="Match Readiness" value={`${insights.matchReadinessScore}%`} />
                  <InsightStat label="Resume Completeness" value={`${insights.completenessScore}%`} />
                  <InsightStat label="Profile Strength" value={insights.strengthLabel} valueClass={insights.strengthClass.split(' ')[0]} />
                  <InsightStat label="Skills Identified" value={String(insights.topSkills.length)} />
                </div>

                {insights.topSkills.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Top Skills</p>
                    <ChipList items={insights.topSkills} tone="slate" />
                  </div>
                )}

                <p className="text-xs text-slate-600 leading-relaxed">{insights.experienceSummary}</p>

                <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
                  Match Readiness and Resume Completeness are computed from how much of this profile is filled in against the fields Tejoma's matching engine actually uses - not a live prediction against a specific job.
                </p>
              </section>

              {/* Career Preferences */}
              <ProfileSection id="career-preferences" title="Career Preferences" icon={Navigation}>
                {hasCareerPrefs ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    <FieldRow label="Preferred Location" value={candidate.preferred_location} />
                    <FieldRow label="Willingness to Relocate" value={candidate.willingness_to_relocate} />
                    <FieldRow label="Current CTC" value={candidate.current_ctc} />
                    <FieldRow label="Expected CTC" value={candidate.expected_ctc} />
                    <FieldRow label="Notice Period" value={candidate.notice_period} />
                  </div>
                ) : (
                  <EmptyNote text="No career preference details were captured for this candidate." />
                )}
              </ProfileSection>

              {/* Education */}
              <ProfileSection id="education" title="Education" icon={GraduationCap}>
                {hasEducation ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
                      <FieldRow label="Highest Qualification" value={candidate.highest_qualification} />
                      <FieldRow label="University / College" value={candidate.university} />
                      <FieldRow label="Graduation Year" value={candidate.graduation_year} />
                    </div>
                    {candidate.education && candidate.education !== candidate.highest_qualification && (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-t border-slate-100 pt-4">{candidate.education}</p>
                    )}
                  </div>
                ) : (
                  <EmptyNote text="No education details were captured for this candidate." />
                )}
              </ProfileSection>

              {/* Key Skills */}
              <ProfileSection id="key-skills" title="Key Skills" icon={Award}>
                <div className="space-y-4">
                  {primarySkillChips.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Primary Skills</p>
                      <ChipList items={primarySkillChips} tone="emerald" />
                    </div>
                  ) : skillChips.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Skills</p>
                      <ChipList items={skillChips} tone="emerald" />
                    </div>
                  ) : (
                    <EmptyNote text="No skills were captured for this candidate." />
                  )}
                  {secondarySkillChips.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Secondary Skills</p>
                      <ChipList items={secondarySkillChips} tone="slate" />
                    </div>
                  )}
                  {candidate.technical_tools && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Technical Tools</p>
                      <ChipList items={splitList(candidate.technical_tools)} tone="slate" />
                    </div>
                  )}
                </div>
              </ProfileSection>

              {/* Languages */}
              <ProfileSection id="languages" title="Languages" icon={LanguagesIcon}>
                {languageChips.length > 0 ? (
                  <ChipList items={languageChips} tone="slate" />
                ) : (
                  <EmptyNote text="No languages were captured for this candidate." />
                )}
              </ProfileSection>

              {/* Internships */}
              <ProfileSection id="internships" title="Internships" icon={ClipboardList}>
                <EmptyNote text="Internship details aren't captured by the current resume parser for this candidate." />
              </ProfileSection>

              {/* Projects */}
              <ProfileSection id="projects" title="Projects" icon={FolderKanban}>
                {candidate.projects ? (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{candidate.projects}</p>
                ) : (
                  <EmptyNote text="No project details were captured for this candidate." />
                )}
              </ProfileSection>

              {/* Profile Summary */}
              <ProfileSection id="profile-summary" title="Profile Summary" icon={FileText}>
                {candidate.resume_summary ? (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{candidate.resume_summary}</p>
                ) : (
                  <EmptyNote text="No professional summary was captured for this candidate." />
                )}
              </ProfileSection>

              {/* Certifications */}
              <ProfileSection id="certifications" title="Certifications" icon={Trophy}>
                {certifications.length > 0 ? (
                  <ChipList items={certifications} tone="emerald" />
                ) : (
                  <EmptyNote text="No certifications were captured for this candidate." />
                )}
              </ProfileSection>

              {/* Employment History */}
              <ProfileSection id="employment-history" title="Employment History" icon={Building2}>
                {hasEmployment ? (
                  <div className="space-y-3">
                    {(candidate.current_company || candidate.current_job_title) && (
                      <div className="flex items-start gap-3 border border-slate-200 rounded-xl px-4 py-3.5">
                        <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0"><Briefcase className="w-4 h-4" /></span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-900">{candidate.current_job_title || 'Current Role'}</p>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Current</span>
                          </div>
                          {candidate.current_company && <p className="text-xs text-slate-500 mt-0.5">{candidate.current_company}</p>}
                        </div>
                      </div>
                    )}
                    {previousCompanies.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-1">Previous Employers</p>
                        <div className="space-y-2">
                          {previousCompanies.map((name, idx) => (
                            <div key={idx} className="flex items-center gap-3 border border-slate-100 rounded-xl px-4 py-3">
                              <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0"><Building2 className="w-3.5 h-3.5" /></span>
                              <p className="text-sm font-medium text-slate-800">{name}</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2">Role and duration for previous employers aren't captured by the current resume parser.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyNote text="No employment history was captured for this candidate." />
                )}
              </ProfileSection>

              {/* Academic Achievements */}
              <ProfileSection id="academic-achievements" title="Academic Achievements" icon={Trophy}>
                <EmptyNote text="Awards, hackathons, publications, and competitions aren't captured by the current resume parser for this candidate." />
              </ProfileSection>

              {/* Resume */}
              <ProfileSection id="resume" title="Resume" icon={FileText}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Resume File</p>
                    <p className="text-sm text-slate-900 font-medium mt-1 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      {resumeFileName || 'No resume file on record'}
                    </p>
                  </div>
                  {candidate.extraction_status && <FieldRow label="Extraction Status" value={candidate.extraction_status} />}
                  {candidate.ai_confidence_score && <FieldRow label="Extraction Confidence" value={candidate.ai_confidence_score} />}
                  {lastUpdated && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Last Updated</p>
                      <p className="text-sm text-slate-900 font-medium mt-1 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-slate-400" />{lastUpdated}</p>
                    </div>
                  )}
                </div>
              </ProfileSection>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
