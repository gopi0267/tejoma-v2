import { Router } from 'express';
import { db } from '../db.js';
import { Candidate } from '../types.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { indexCandidateInBackground, removeCandidateFromIndex } from '../rag.service.js';
import { indexCandidateEmbeddingInBackground } from '../matching/embeddingIndex.js';
import { computeCandidateConfidence } from '../matching/confidenceService.js';
import { discoverUnknownSkillsInBackground } from '../matching/unknownSkillDiscovery.js';
import { computeAndStoreProjectIntelligenceInBackground } from '../matching/projectIntelligence.js';
import { computeCareerTrajectoryInBackground } from '../matching/careerIntelligence/computeCareerTrajectory.js';
import { computeReasoningForCandidateInBackground } from '../matching/reasoning/computeReasoning.js';

// Enterprise AI Matching Architecture, Phase 4 - Unknown Skill Discovery's "context" for a
// resume-sourced token, same composition embeddingIndex.ts's buildCandidateFacetTexts already
// uses for the "responsibilities" facet (projects + summary - the free text most likely to
// disambiguate a short, ambiguous skill token).
function candidateDiscoveryContext(candidate: Candidate): string {
  return [candidate.projects, candidate.resume_summary].filter((t) => t && t.trim()).join('. ');
}

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

// Every field is stored as VARCHAR/TEXT in the DB (see migration-31-cols.sql) - list fields
// (skills, previous_companies, certifications) are just arrays of strings joined with a
// separator. Coercing years_of_experience/willingness_to_relocate etc. to Number/boolean here
// was silently destroying real extracted data (e.g. "6+ years" -> 0) before it ever reached the
// database, so every field below is passed through as-is instead.
const toArray = (val: any): string[] => {
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') return val.split(/[,;]/).map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'null');
  return [];
};
const toText = (val: any): string => {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  return s.toLowerCase() === 'null' ? '' : s;
};

function candidatePayloadFromExtracted(cand: Partial<Candidate>, companyId: number): Omit<Candidate, 'id' | 'created_at' | 'updated_at'> {
  const skills = toArray(cand.skills);
  const years_of_experience = toText(cand.years_of_experience);
  const resume_text = toText(cand.resume_text) || `${toText(cand.name)} - ${toText(cand.current_job_title)}`;
  const highest_qualification = toText(cand.highest_qualification);
  const university = toText(cand.university);
  const graduation_year = toText(cand.graduation_year);
  const projects = toText(cand.projects);
  const ai_confidence_score = toText(cand.ai_confidence_score);
  const extraction_status = cand.extraction_status || 'Complete';

  return {
    company_id: companyId,
    name: toText(cand.name),
    email: toText(cand.email),
    phone: toText(cand.phone),
    skills,
    primary_skills: toText(cand.primary_skills),
    secondary_skills: toText(cand.secondary_skills),
    years_of_experience,
    current_location: toText(cand.current_location),
    preferred_location: toText(cand.preferred_location),
    current_company: toText(cand.current_company),
    previous_companies: toArray(cand.previous_companies),
    current_job_title: toText(cand.current_job_title),
    industry_domain: toText(cand.industry_domain),
    education: toText(cand.education),
    highest_qualification,
    graduation_year,
    university,
    certifications: toArray(cand.certifications),
    projects,
    technical_tools: toText(cand.technical_tools),
    languages_known: toText(cand.languages_known),
    current_ctc: toText(cand.current_ctc),
    expected_ctc: toText(cand.expected_ctc),
    notice_period: toText(cand.notice_period),
    willingness_to_relocate: toText(cand.willingness_to_relocate),
    linkedin_url: toText(cand.linkedin_url),
    github_or_portfolio_url: toText(cand.github_or_portfolio_url),
    resume_summary: toText(cand.resume_summary),
    resume_text,
    ai_confidence_score,
    extraction_status,
    resume_file_path: cand.resume_file_path,
    candidate_hash: cand.candidate_hash,
    resume_embedding: cand.resume_embedding,
    // Enterprise AI Matching Architecture, Phase 1 - Confidence Architecture. Computed from the
    // already-normalized fields above (never calls the parser, never changes what it returns) -
    // see src/matching/confidenceService.ts for the per-entity reasoning.
    confidence_profile: computeCandidateConfidence({
      skills, years_of_experience, resume_text, highest_qualification, university,
      graduation_year, projects, ai_confidence_score, extraction_status,
    }),
    // Enterprise AI Matching Architecture, Phase 5 prerequisite - passed through as-is from
    // parser.service.ts's already-normalized/validated arrays (see its normalizeWorkHistory/
    // normalizeProjectEntries). Undefined (not an empty array) when the caller didn't supply
    // either at all - e.g. a candidate created through a path other than the parsed-resume flow -
    // so db.createCandidate's JSONB write can distinguish "genuinely never parsed" from "parsed,
    // found nothing."
    work_history: Array.isArray(cand.work_history) ? cand.work_history : undefined,
    project_entries: Array.isArray(cand.project_entries) ? cand.project_entries : undefined,
  };
}

router.get('/candidates', async (req, res) => {
    const candidates = await db.getCandidates(req.user!.company_id);
    res.json(candidates);
});

router.post('/candidates', async (req, res) => {
    try {
      const { name, email } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: 'Name and Email are required' });
      }

      const newCandidate = await db.createCandidate(candidatePayloadFromExtracted(req.body, req.user!.company_id));
      if (newCandidate) {
        indexCandidateInBackground(newCandidate);
        indexCandidateEmbeddingInBackground(newCandidate);
        discoverUnknownSkillsInBackground(newCandidate.skills, candidateDiscoveryContext(newCandidate), 'resume');
        computeAndStoreProjectIntelligenceInBackground(newCandidate.id, newCandidate.company_id, newCandidate.project_entries);
        computeCareerTrajectoryInBackground(newCandidate.id, newCandidate.company_id, newCandidate.work_history);
        computeReasoningForCandidateInBackground(newCandidate.id, newCandidate.skills, newCandidate.project_entries);
      }

      res.status(201).json(newCandidate);
    } catch (error: any) {
      console.error('Failed to create candidate:', error);
      res.status(500).json({ error: 'Failed to create candidate: ' + error.message });
    }
});

router.get('/candidates/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const candidate = await db.getCandidateById(id, req.user!.company_id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    res.json(candidate);
});

router.delete('/candidates/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await db.deleteCandidate(id, req.user!.company_id);
    if (!deleted) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    removeCandidateFromIndex(id).catch((err) => console.error(`RAG unindex failed for candidate ${id}:`, err.message));
    res.status(204).send();
});

// ==================== BULK UPLOAD CANDIDATES (from Resume Parser) ====================
router.post('/bulk-upload-candidates', async (req, res) => {
    try {
      const candidates: Partial<Candidate>[] = req.body;

      if (!Array.isArray(candidates) || candidates.length === 0) {
        return res.status(400).json({ error: 'No candidate data provided' });
      }

      let insertedCount = 0;
      const errors = [];

      for (const cand of candidates) {
        try {
          if (!cand.name || !cand.email) {
            errors.push({ candidate: cand.name || 'Unknown', error: 'Missing name or email' });
            continue;
          }

          const created = await db.createCandidate(candidatePayloadFromExtracted(cand, req.user!.company_id));
          if (!created) {
            errors.push({ candidate: cand.email, error: 'Database insert returned no row' });
            continue;
          }
          indexCandidateInBackground(created);
          indexCandidateEmbeddingInBackground(created);
          discoverUnknownSkillsInBackground(created.skills, candidateDiscoveryContext(created), 'resume');
          computeAndStoreProjectIntelligenceInBackground(created.id, created.company_id, created.project_entries);
          computeCareerTrajectoryInBackground(created.id, created.company_id, created.work_history);
          computeReasoningForCandidateInBackground(created.id, created.skills, created.project_entries);
          insertedCount++;
        } catch (dbError: any) {
          console.error(`DB insert failed for ${cand.email}:`, dbError.message);
          errors.push({ candidate: cand.email, error: dbError.message });
        }
      }
      res.status(201).json({ success: true, inserted: insertedCount, errors });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Bulk upload failed: ' + error.message });
    }
});
// ==================== BULK IMPORT CANDIDATES ====================
router.post('/candidates/import', async (req, res) => {
    try {
      const { candidates } = req.body;
  
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return res.status(400).json({ error: 'No candidates provided' });
      }
  
      console.log(`📥 BULK IMPORT: Processing ${candidates.length} candidates`);
  
      const importedCandidates = [];
      const errors = [];
  
      for (let i = 0; i < candidates.length; i++) {
        try {
          const candidate = candidates[i];

          // Validate
          if (!candidate.name || !candidate.email) {
            errors.push(`Row ${i + 1}: Missing name or email`);
            continue;
          }

          // Create candidate
          const newCandidate = await db.createCandidate(candidatePayloadFromExtracted(candidate, req.user!.company_id));
          if (newCandidate) {
            indexCandidateInBackground(newCandidate);
            indexCandidateEmbeddingInBackground(newCandidate);
            discoverUnknownSkillsInBackground(newCandidate.skills, candidateDiscoveryContext(newCandidate), 'resume');
            computeAndStoreProjectIntelligenceInBackground(newCandidate.id, newCandidate.company_id, newCandidate.project_entries);
            computeCareerTrajectoryInBackground(newCandidate.id, newCandidate.company_id, newCandidate.work_history);
            computeReasoningForCandidateInBackground(newCandidate.id, newCandidate.skills, newCandidate.project_entries);
          }

          importedCandidates.push(newCandidate);
          console.log(`✅ Imported: ${candidate.name}`);
        } catch (err: any) {
          console.error(`❌ Error importing candidate ${i + 1}:`, err.message);
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }
  
      console.log(`📊 IMPORT COMPLETE: ${importedCandidates.length} successful, ${errors.length} errors`);
  
      res.status(201).json({
        success: true,
        message: `Imported ${importedCandidates.length} candidates successfully`,
        imported_count: importedCandidates.length,
        error_count: errors.length,
        candidates: importedCandidates,
        errors: errors
      });
    } catch (error: any) {
      console.error('❌ BULK IMPORT ERROR:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to import candidates: ' + error.message 
      });
    }
});

export default router;
