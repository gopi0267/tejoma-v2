/**
 * Internal, service-to-service endpoints for Candidate Core Service's write proxy (remaining-
 * monolith migration, Step 3a). Same network-boundary trust model as every other /internal/*
 * endpoint - no JWT, API Gateway's proxy.ts already 404s /internal/* unconditionally.
 *
 * Candidate Core Service's own public /api/candidates* GET routes read directly from its own
 * already-fresh dual-written mirror (real, safe cutover - no proxy needed). Its WRITE routes
 * (create/delete/bulk-upload/import) are thin proxies to these endpoints instead: the monolith
 * remains the sole writer of `candidates` (createCandidateWithSideEffects/deleteCandidate,
 * unchanged, still triggering the exact same 6 background side effects - RAG indexing, BERT
 * embedding, unknown-skill discovery, project intelligence, career trajectory, reasoning) so every
 * OTHER still-monolith surface that reads `candidates` directly (swipe.routes.ts, job.routes.ts,
 * recruiter-review.routes.ts, candidate-search.routes.ts - none cut over yet) keeps seeing fresh
 * data without any change. The existing dual-write hook already in db.ts's createCandidate/
 * deleteCandidate (dualWrite.upsertCandidate/deleteCandidateMirror) keeps Candidate Core Service's
 * own mirror in sync automatically - nothing new needed there.
 *
 * Same "move the edge first, migrate authority later" reasoning as Step 1's ML admin surface.
 */
import { Router } from 'express';
import { db, mapRowToCandidate } from '../db.js';
import { removeCandidateFromIndex } from '../rag.service.js';
import { indexCandidateInBackground } from '../rag.service.js';
import { indexCandidateEmbeddingInBackground } from '../matching/embeddingIndex.js';
import { discoverUnknownSkillsInBackground } from '../skillDiscoveryServiceShadow.js';
import { computeAndStoreProjectIntelligenceInBackground } from '../matching/projectIntelligence.js';
import { computeCareerTrajectoryInBackground } from '../careerIntelligenceServiceShadow.js';
import { computeReasoningForCandidateInBackground } from '../reasoningServiceShadow.js';
import type { Candidate } from '../types.js';

function candidateDiscoveryContext(candidate: Candidate): string {
  return [candidate.projects, candidate.resume_summary].filter((t) => t && t.trim()).join('. ');
}

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
    confidence_profile: cand.confidence_profile,
    work_history: Array.isArray(cand.work_history) ? cand.work_history : undefined,
    project_entries: Array.isArray(cand.project_entries) ? cand.project_entries : undefined,
  };
}

const router = Router();

// Remaining-monolith migration write-cutover completion, Phase A - Candidate Core Service now
// performs the real INSERT/DELETE itself (own database, own id sequence); these two endpoints are
// the reverse of the create/delete endpoints above: mirror the already-created/-deleted row into
// this table (db.ts's mirrorUpsertCandidate/mirrorDeleteCandidate, explicit id, never re-running
// this table's own sequence) and re-fire the exact same six background side effects
// createCandidateWithSideEffects/deleteCandidate always fired. The mirror-upsert itself is awaited
// (the caller needs it durable before its own response returns) but the side effects below stay
// exactly as fire-and-forget as they always were - only how they're reached has changed, not their
// own semantics.
router.post('/candidates/mirror-and-notify', async (req, res) => {
  try {
    const { candidate } = req.body as { candidate: Record<string, unknown> };
    if (!candidate || typeof candidate.id !== 'number') {
      return res.status(400).json({ error: 'candidate (with a real id) is required' });
    }
    // The row arrives in candidate-core-service's own raw storage shape (skills/
    // previous_companies/certifications as delimited strings) - correct as-is for the upsert
    // below (same storage convention this table already uses), but the background triggers need
    // the parsed shape (real arrays), same as every other reader of this table.
    await db.mirrorUpsertCandidate(candidate);

    const created = mapRowToCandidate(candidate);
    // Item 7: Indexing now done by candidate-core-service, skip here to avoid double-indexing
    // indexCandidateInBackground(created);
    // indexCandidateEmbeddingInBackground(created);
    discoverUnknownSkillsInBackground(created.skills, candidateDiscoveryContext(created), 'resume');
    computeAndStoreProjectIntelligenceInBackground(created.id, created.company_id, created.project_entries);
    computeCareerTrajectoryInBackground(created.id, created.company_id, created.work_history);
    computeReasoningForCandidateInBackground(created.id, created.skills, created.project_entries);

    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal/candidate-core] mirror-and-notify error:', error);
    res.status(500).json({ error: 'Failed to mirror candidate: ' + error.message });
  }
});

router.post('/candidates/mirror-delete', async (req, res) => {
  try {
    const { id } = req.body as { id: number };
    if (typeof id !== 'number') {
      return res.status(400).json({ error: 'a valid id is required' });
    }
    await db.mirrorDeleteCandidate(id);
    removeCandidateFromIndex(id).catch((err) => console.error(`RAG unindex failed for candidate ${id}:`, err.message));
    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal/candidate-core] mirror-delete error:', error);
    res.status(500).json({ error: 'Failed to mirror candidate deletion: ' + error.message });
  }
});

router.post('/candidates', async (req, res) => {
  try {
    const { candidate, companyId } = req.body as { candidate: Partial<Candidate>; companyId: number };
    if (!candidate?.name || !candidate?.email || typeof companyId !== 'number') {
      return res.status(400).json({ error: 'candidate.name, candidate.email, and companyId are required' });
    }
    const created = await db.createCandidate(candidatePayloadFromExtracted(candidate, companyId));
    res.status(201).json({ candidate: created });
  } catch (error: any) {
    console.error('[internal/candidate-core] create error:', error);
    res.status(500).json({ error: 'Failed to create candidate: ' + error.message });
  }
});

router.delete('/candidates/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(id) || !Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'a valid id and companyId are required' });
    }
    const deleted = await db.deleteCandidate(id, companyId);
    if (!deleted) return res.status(404).json({ error: 'Candidate not found' });
    removeCandidateFromIndex(id).catch((err) => console.error(`RAG unindex failed for candidate ${id}:`, err.message));
    res.status(204).send();
  } catch (error: any) {
    console.error('[internal/candidate-core] delete error:', error);
    res.status(500).json({ error: 'Failed to delete candidate: ' + error.message });
  }
});

router.post('/bulk-upload-candidates', async (req, res) => {
  try {
    const { candidates, companyId } = req.body as { candidates: Partial<Candidate>[]; companyId: number };
    if (!Array.isArray(candidates) || candidates.length === 0 || typeof companyId !== 'number') {
      return res.status(400).json({ error: 'candidates[] and companyId are required' });
    }

    let insertedCount = 0;
    const errors: Array<{ candidate: string; error: string }> = [];

    for (const cand of candidates) {
      try {
        if (!cand.name || !cand.email) {
          errors.push({ candidate: cand.name || 'Unknown', error: 'Missing name or email' });
          continue;
        }
        const created = await createCandidateWithSideEffects(candidatePayloadFromExtracted(cand, companyId));
        if (!created) {
          errors.push({ candidate: cand.email, error: 'Database insert returned no row' });
          continue;
        }
        insertedCount++;
      } catch (dbError: any) {
        console.error(`[internal/candidate-core] bulk-upload insert failed for ${cand.email}:`, dbError.message);
        errors.push({ candidate: cand.email || 'Unknown', error: dbError.message });
      }
    }
    res.status(201).json({ success: true, inserted: insertedCount, errors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Bulk upload failed: ' + error.message });
  }
});

router.post('/candidates/import', async (req, res) => {
  try {
    const { candidates, companyId } = req.body as { candidates: Partial<Candidate>[]; companyId: number };
    if (!Array.isArray(candidates) || candidates.length === 0 || typeof companyId !== 'number') {
      return res.status(400).json({ error: 'candidates[] and companyId are required' });
    }

    const importedCandidates: (Candidate | null)[] = [];
    const errors: string[] = [];

    for (let i = 0; i < candidates.length; i++) {
      try {
        const candidate = candidates[i];
        if (!candidate.name || !candidate.email) {
          errors.push(`Row ${i + 1}: Missing name or email`);
          continue;
        }
        const newCandidate = await createCandidateWithSideEffects(candidatePayloadFromExtracted(candidate, companyId));
        importedCandidates.push(newCandidate);
      } catch (err: any) {
        console.error(`[internal/candidate-core] import error at row ${i + 1}:`, err.message);
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    res.status(201).json({
      success: true,
      message: `Imported ${importedCandidates.length} candidates successfully`,
      imported_count: importedCandidates.length,
      error_count: errors.length,
      candidates: importedCandidates,
      errors,
    });
  } catch (error: any) {
    console.error('[internal/candidate-core] BULK IMPORT ERROR:', error);
    res.status(500).json({ success: false, error: 'Failed to import candidates: ' + error.message });
  }
});

export default router;
