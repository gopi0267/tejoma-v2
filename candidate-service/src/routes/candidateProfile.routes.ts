/**
 * Ported from the monolith's src/api/candidate-profile.routes.ts - byte-identical response
 * shapes, byte-identical validation, byte-identical completion-percent calculation. Reads/writes
 * this service's own database directly (no monolith proxy needed - candidate_accounts/
 * candidate_experiences are fully owned here).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireCandidateAuth);

const PROFILE_FIELDS = ['headline', 'skills', 'years_of_experience', 'location', 'education', 'summary'] as const;
const PROFILE_FIELDS_V2 = ['course_name', 'primary_skill'] as const;

function computeCompletion(candidate: any, hasExperience: boolean): { percent: number; filled: number; total: number } {
  const values = [candidate.name, ...PROFILE_FIELDS.map((f) => candidate[f]), ...PROFILE_FIELDS_V2.map((f) => candidate[f])];
  const filled = values.filter((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim()))).length
    + (hasExperience || candidate.years_of_experience === 'Fresher' ? 1 : 0);
  const total = values.length + 1;
  return { percent: Math.round((filled / total) * 100), filled, total };
}

function toProfileResponse(candidate: any, hasExperience: boolean) {
  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email || '',
    phone: candidate.phone || '',
    headline: candidate.headline,
    skills: candidate.skills || [],
    years_of_experience: candidate.years_of_experience,
    location: candidate.location,
    education: candidate.education,
    summary: candidate.summary,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
    completion: computeCompletion(candidate, hasExperience),
    current_company: candidate.current_company || null,
    certifications: candidate.certifications || [],
    tools: candidate.tools || [],
    languages: candidate.languages || [],
    notice_period: candidate.notice_period || null,
    current_ctc: candidate.current_ctc || null,
    expected_ctc: candidate.expected_ctc || null,
    open_to_work: candidate.open_to_work ?? true,
    visible_to_recruiters: candidate.visible_to_recruiters ?? true,
    course_name: candidate.course_name || null,
    course_type: candidate.course_type || null,
    specialization: candidate.specialization || null,
    institution_name: candidate.institution_name || null,
    start_year: candidate.start_year || null,
    end_year: candidate.end_year || null,
    grading_system: candidate.grading_system || null,
    grade_value: candidate.grade_value || null,
    primary_skill: candidate.primary_skill || null,
    secondary_skills: candidate.secondary_skills || [],
    resume_original_filename: candidate.resume_original_filename || null,
    resume_file_uploaded_at: candidate.resume_file_uploaded_at || null,
    current_job_title: candidate.current_job_title || null,
    projects: candidate.projects || null,
    linkedin_url: candidate.linkedin_url || null,
    github_url: candidate.github_url || null,
  };
}

// ==================== GET OWN PROFILE ====================
router.get('/candidate-profile/me', async (req, res) => {
  try {
    const candidate = await db.getCandidateAccountById(req.candidate!.candidate_id);
    if (!candidate || !candidate.is_active || candidate.deleted_at) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const experiences = await db.getCandidateExperiences(req.candidate!.candidate_id);
    res.json(toProfileResponse(candidate, experiences.length > 0));
  } catch (error) {
    console.error('Get candidate profile error:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ==================== UPDATE OWN PROFILE ====================
router.put('/candidate-profile/me', async (req, res) => {
  try {
    const {
      name, headline, skills, years_of_experience, location, education, summary,
      current_company, certifications, tools, languages, notice_period, current_ctc, expected_ctc,
      open_to_work, visible_to_recruiters,
      course_name, course_type, specialization, institution_name, start_year, end_year, grading_system, grade_value,
      primary_skill, secondary_skills,
      current_job_title, projects, linkedin_url, github_url,
    } = req.body;

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    if (skills !== undefined && skills !== null && !Array.isArray(skills)) {
      return res.status(400).json({ error: 'Skills must be a list' });
    }
    for (const [label, value] of [['Certifications', certifications], ['Tools', tools], ['Languages', languages], ['Secondary skills', secondary_skills]] as const) {
      if (value !== undefined && value !== null && !Array.isArray(value)) {
        return res.status(400).json({ error: `${label} must be a list` });
      }
    }
    for (const [label, value] of [['Open to work', open_to_work], ['Visible to recruiters', visible_to_recruiters]] as const) {
      if (value !== undefined && typeof value !== 'boolean') {
        return res.status(400).json({ error: `${label} must be true or false` });
      }
    }

    const updated = await db.updateCandidateProfile(req.candidate!.candidate_id, {
      ...(name !== undefined && { name }),
      ...(headline !== undefined && { headline }),
      ...(skills !== undefined && { skills }),
      ...(years_of_experience !== undefined && { years_of_experience }),
      ...(location !== undefined && { location }),
      ...(education !== undefined && { education }),
      ...(summary !== undefined && { summary }),
      ...(current_company !== undefined && { current_company }),
      ...(certifications !== undefined && { certifications }),
      ...(tools !== undefined && { tools }),
      ...(languages !== undefined && { languages }),
      ...(notice_period !== undefined && { notice_period }),
      ...(current_ctc !== undefined && { current_ctc }),
      ...(expected_ctc !== undefined && { expected_ctc }),
      ...(open_to_work !== undefined && { open_to_work }),
      ...(visible_to_recruiters !== undefined && { visible_to_recruiters }),
      ...(course_name !== undefined && { course_name }),
      ...(course_type !== undefined && { course_type }),
      ...(specialization !== undefined && { specialization }),
      ...(institution_name !== undefined && { institution_name }),
      ...(start_year !== undefined && { start_year }),
      ...(end_year !== undefined && { end_year }),
      ...(grading_system !== undefined && { grading_system }),
      ...(grade_value !== undefined && { grade_value }),
      ...(primary_skill !== undefined && { primary_skill }),
      ...(secondary_skills !== undefined && { secondary_skills }),
      ...(current_job_title !== undefined && { current_job_title }),
      ...(projects !== undefined && { projects }),
      ...(linkedin_url !== undefined && { linkedin_url }),
      ...(github_url !== undefined && { github_url }),
    });

    if (!updated) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const experiences = await db.getCandidateExperiences(req.candidate!.candidate_id);
    res.json(toProfileResponse(updated, experiences.length > 0));
  } catch (error) {
    console.error('Update candidate profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ==================== EXPERIENCES (onboarding "Add Experience", one-to-many) ====================
function toExperienceResponse(exp: any) {
  return {
    id: exp.id,
    job_title: exp.job_title,
    company: exp.company,
    employment_type: exp.employment_type,
    experience_years: exp.experience_years,
    experience_months: exp.experience_months,
    current_ctc: exp.current_ctc,
    expected_ctc: exp.expected_ctc,
    notice_period: exp.notice_period,
    current_location: exp.current_location,
    preferred_location: exp.preferred_location,
    key_responsibilities: exp.key_responsibilities,
    skills_used: exp.skills_used || [],
    created_at: exp.created_at,
    updated_at: exp.updated_at,
  };
}

router.get('/candidate-profile/experiences', async (req, res) => {
  try {
    const experiences = await db.getCandidateExperiences(req.candidate!.candidate_id);
    res.json({ experiences: experiences.map(toExperienceResponse) });
  } catch (error) {
    console.error('Get candidate experiences error:', error);
    res.status(500).json({ error: 'Failed to load experience' });
  }
});

router.post('/candidate-profile/experiences', async (req, res) => {
  try {
    const { job_title, company, employment_type, experience_years, experience_months,
      current_ctc, expected_ctc, notice_period, current_location, preferred_location,
      key_responsibilities, skills_used } = req.body;

    if (skills_used !== undefined && skills_used !== null && !Array.isArray(skills_used)) {
      return res.status(400).json({ error: 'Skills used must be a list' });
    }

    const created = await db.createCandidateExperience(req.candidate!.candidate_id, {
      job_title, company, employment_type, experience_years, experience_months,
      current_ctc, expected_ctc, notice_period, current_location, preferred_location,
      key_responsibilities, skills_used,
    });
    if (!created) {
      return res.status(500).json({ error: 'Failed to add experience' });
    }
    res.status(201).json({ experience: toExperienceResponse(created) });
  } catch (error) {
    console.error('Create candidate experience error:', error);
    res.status(500).json({ error: 'Failed to add experience' });
  }
});

router.put('/candidate-profile/experiences/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid experience id' });

    const { job_title, company, employment_type, experience_years, experience_months,
      current_ctc, expected_ctc, notice_period, current_location, preferred_location,
      key_responsibilities, skills_used } = req.body;

    if (skills_used !== undefined && skills_used !== null && !Array.isArray(skills_used)) {
      return res.status(400).json({ error: 'Skills used must be a list' });
    }

    const updated = await db.updateCandidateExperience(id, req.candidate!.candidate_id, {
      ...(job_title !== undefined && { job_title }),
      ...(company !== undefined && { company }),
      ...(employment_type !== undefined && { employment_type }),
      ...(experience_years !== undefined && { experience_years }),
      ...(experience_months !== undefined && { experience_months }),
      ...(current_ctc !== undefined && { current_ctc }),
      ...(expected_ctc !== undefined && { expected_ctc }),
      ...(notice_period !== undefined && { notice_period }),
      ...(current_location !== undefined && { current_location }),
      ...(preferred_location !== undefined && { preferred_location }),
      ...(key_responsibilities !== undefined && { key_responsibilities }),
      ...(skills_used !== undefined && { skills_used }),
    });
    if (!updated) {
      return res.status(404).json({ error: 'Experience not found' });
    }
    res.json({ experience: toExperienceResponse(updated) });
  } catch (error) {
    console.error('Update candidate experience error:', error);
    res.status(500).json({ error: 'Failed to update experience' });
  }
});

router.delete('/candidate-profile/experiences/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid experience id' });
    const ok = await db.deleteCandidateExperience(id, req.candidate!.candidate_id);
    if (!ok) {
      return res.status(404).json({ error: 'Experience not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete candidate experience error:', error);
    res.status(500).json({ error: 'Failed to delete experience' });
  }
});

export default router;
