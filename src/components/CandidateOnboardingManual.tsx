import React, { useState } from 'react';
import { Save, ArrowLeft, Sparkles, GraduationCap, Wallet, Link2, FileText } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { ErrorBanner } from './Login.js';
import { ProfileField, SelectField } from './CandidateProfile.js';
import { ChipInput } from './CandidateOnboardingSkills.js';
import { ResumeFileManager } from './CandidateProfileSections.js';

const QUALIFICATIONS = ['Doctorate / PhD', 'Masters / Post Graduation', 'Graduation / Diploma', '12th', '10th', 'Below 10th'];
const COURSE_TYPES = ['Full Time', 'Part Time', 'Distance Learning', 'Online'];
const GRADING_SYSTEMS = ['Percentage', 'CGPA', 'GPA', 'Grade'];

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-6 sm:p-7">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-[#E5F5E5] flex items-center justify-center flex-shrink-0">{icon}</div>
        <h2 className="text-sm font-bold text-[#1A1A1A]">{title}</h2>
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

// Option 1 of the two-path onboarding choice: a single, comprehensive, scrollable "Complete
// Profile" form covering every field the spec lists. Resume upload here reuses the EXISTING
// permanent-storage endpoint (POST /candidate-resume/file, built for the Profile page's "Your
// Resume File" feature) - it only stores the file, it never triggers parsing, and there is no
// "Extract Details" affordance anywhere on this screen, exactly as specified.
export default function CandidateOnboardingManual({ candidateName, onBack, onComplete }: { candidateName: string; onBack: () => void; onComplete: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [headline, setHeadline] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [currentJobTitle, setCurrentJobTitle] = useState('');
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [location, setLocation] = useState('');

  const [skills, setSkills] = useState<string[]>([]);

  const [qualification, setQualification] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseType, setCourseType] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [institution, setInstitution] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [gradingSystem, setGradingSystem] = useState('');
  const [gradeValue, setGradeValue] = useState('');

  const [certifications, setCertifications] = useState<string[]>([]);
  const [projects, setProjects] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [summary, setSummary] = useState('');

  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [githubUrl, setGithubUrl] = useState('');

  const [noticePeriod, setNoticePeriod] = useState('');
  const [expectedCtc, setExpectedCtc] = useState('');

  const [resumeFilename, setResumeFilename] = useState<string | null>(null);
  const [resumeUploadedAt, setResumeUploadedAt] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/candidate-profile/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: headline || null,
          current_company: currentCompany || null,
          current_job_title: currentJobTitle || null,
          years_of_experience: yearsOfExperience || null,
          location: location || null,
          skills,
          education: qualification || null,
          course_name: courseName || null,
          course_type: courseType || null,
          specialization: specialization || null,
          institution_name: institution || null,
          start_year: startYear || null,
          end_year: endYear || null,
          grading_system: gradingSystem || null,
          grade_value: gradeValue || null,
          certifications,
          projects: projects || null,
          languages,
          summary: summary || null,
          linkedin_url: linkedinUrl || null,
          github_url: githubUrl || null,
          notice_period: noticePeriod || null,
          expected_ctc: expectedCtc || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save profile');

      await fetch('/api/candidate-auth/complete-onboarding', { method: 'PUT' });
      onComplete();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <TejomaLogo size="md" textColorClass="text-[#1A1A1A]" />
          <button type="button" onClick={onBack} className="text-xs font-semibold text-[#666666] hover:text-[#1A1A1A] cursor-pointer flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        </div>

        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Complete your profile, {candidateName.split(' ')[0]}</h1>
          <p className="text-[#666666] text-xs mt-1">Fill in as much as you'd like now - you can always come back and edit later.</p>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {error && <ErrorBanner text={error} />}

          <Section icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="About">
            <ProfileField label="Headline" value={headline} onChange={setHeadline} placeholder="e.g. Senior Frontend Engineer" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ProfileField label="Current Company" value={currentCompany} onChange={setCurrentCompany} placeholder="e.g. Acme Corp" />
              <ProfileField label="Current Designation" value={currentJobTitle} onChange={setCurrentJobTitle} placeholder="e.g. Senior Software Engineer" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ProfileField label="Total Experience" value={yearsOfExperience} onChange={setYearsOfExperience} placeholder="e.g. 5 years" />
              <ProfileField label="Location" value={location} onChange={setLocation} placeholder="e.g. Bengaluru, India" />
            </div>
          </Section>

          <Section icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Skills">
            <ChipInput label="Skills" values={skills} onChange={setSkills} placeholder="Add a skill..." />
          </Section>

          <Section icon={<GraduationCap className="w-4 h-4 text-[#27AE60]" />} title="Education">
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
          </Section>

          <Section icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Certifications &amp; Projects">
            <ChipInput label="Certifications" values={certifications} onChange={setCertifications} placeholder="Add a certification..." />
            <ProfileField label="Projects" value={projects} onChange={setProjects} placeholder="Describe a project you've built - title, tech used, and outcome" textarea />
          </Section>

          <Section icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Languages &amp; Summary">
            <ChipInput label="Languages" values={languages} onChange={setLanguages} placeholder="Add a language..." />
            <ProfileField label="Professional Summary" value={summary} onChange={setSummary} placeholder="A short summary about yourself" textarea />
          </Section>

          <Section icon={<Link2 className="w-4 h-4 text-[#27AE60]" />} title="Social Links">
            <ProfileField label="LinkedIn" value={linkedinUrl} onChange={setLinkedinUrl} placeholder="https://linkedin.com/in/yourname" />
            <ProfileField label="GitHub" value={githubUrl} onChange={setGithubUrl} placeholder="https://github.com/yourname" />
          </Section>

          <Section icon={<Wallet className="w-4 h-4 text-[#27AE60]" />} title="Career Preferences">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ProfileField label="Notice Period" value={noticePeriod} onChange={setNoticePeriod} placeholder="e.g. 30 days" />
              <ProfileField label="Expected Salary" value={expectedCtc} onChange={setExpectedCtc} placeholder="e.g. 18 LPA" />
            </div>
          </Section>

          <Section icon={<FileText className="w-4 h-4 text-[#27AE60]" />} title="Resume (Optional)">
            <p className="text-xs text-[#666666] -mt-2">Keep a copy of your resume on file - completely optional, and only stored, never auto-analyzed.</p>
            <ResumeFileManager
              filename={resumeFilename}
              uploadedAt={resumeUploadedAt}
              onUploaded={(data) => { setResumeFilename(data.resume_original_filename); setResumeUploadedAt(data.resume_file_uploaded_at); }}
            />
          </Section>

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
