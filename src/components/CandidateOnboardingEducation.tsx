import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { ProfileField, SelectField } from './CandidateProfile.js';
import { ErrorBanner } from './Login.js';

const QUALIFICATIONS = ['Doctorate / PhD', 'Masters / Post Graduation', 'Graduation / Diploma', '12th', '10th', 'Below 10th'];
const COURSE_TYPES = ['Full Time', 'Part Time', 'Distance Learning', 'Online'];
const GRADING_SYSTEMS = ['Percentage', 'CGPA', 'GPA', 'Grade'];

export interface EducationData {
  qualification: string;
  courseName: string;
  courseType: string;
  specialization: string;
  institution: string;
  startYear: string;
  endYear: string;
  gradingSystem: string;
  gradeValue: string;
}

export default function CandidateOnboardingEducation({ initial, onSaved }: { initial: EducationData; onSaved: (data: EducationData) => void }) {
  const [qualification, setQualification] = useState(initial.qualification);
  const [courseName, setCourseName] = useState(initial.courseName);
  const [courseType, setCourseType] = useState(initial.courseType);
  const [specialization, setSpecialization] = useState(initial.specialization);
  const [institution, setInstitution] = useState(initial.institution);
  const [startYear, setStartYear] = useState(initial.startYear);
  const [endYear, setEndYear] = useState(initial.endYear);
  const [gradingSystem, setGradingSystem] = useState(initial.gradingSystem);
  const [gradeValue, setGradeValue] = useState(initial.gradeValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qualification) {
      setError('Please select your highest qualification.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/candidate-profile/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          education: qualification,
          course_name: courseName || null,
          course_type: courseType || null,
          specialization: specialization || null,
          institution_name: institution || null,
          start_year: startYear || null,
          end_year: endYear || null,
          grading_system: gradingSystem || null,
          grade_value: gradeValue || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save education details');
      onSaved({ qualification, courseName, courseType, specialization, institution, startYear, endYear, gradingSystem, gradeValue });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-[#1A1A1A]">Education Details</h1>
        <p className="text-[#666666] text-xs mt-1">Tell us about your highest qualification - this helps recruiters find you.</p>
      </div>

      <SelectField label="Highest Qualification" value={qualification} onChange={setQualification} options={QUALIFICATIONS} />

      {qualification && (
        <div className="space-y-5 pt-1">
          <ProfileField label="Course Name" value={courseName} onChange={setCourseName} placeholder="e.g. B.Tech, B.Com, M.Sc" />
          <SelectField label="Course Type" value={courseType} onChange={setCourseType} options={COURSE_TYPES} />
          <ProfileField label="Specialization" value={specialization} onChange={setSpecialization} placeholder="e.g. Computer Science" />
          <ProfileField label="University / Institution Name" value={institution} onChange={setInstitution} placeholder="e.g. XYZ University" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <ProfileField label="Starting Year" value={startYear} onChange={setStartYear} placeholder="e.g. 2018" />
            <ProfileField label="Ending Year" value={endYear} onChange={setEndYear} placeholder="e.g. 2022" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <SelectField label="Grading System" value={gradingSystem} onChange={setGradingSystem} options={GRADING_SYSTEMS} />
            <ProfileField label="Grade Value" value={gradeValue} onChange={setGradeValue} placeholder="e.g. 8.5 or 85%" />
          </div>
        </div>
      )}

      {error && <ErrorBanner text={error} />}

      <button type="submit" disabled={saving} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60">
        {saving ? 'Saving...' : <>Save &amp; Continue <ArrowRight className="w-4 h-4" /></>}
      </button>
    </form>
  );
}
