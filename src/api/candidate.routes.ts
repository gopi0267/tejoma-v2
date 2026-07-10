import { Router } from 'express';
import { db } from '../db.js';
import { Candidate } from '../types.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/candidates', async (req, res) => {
    const candidates = await db.getCandidates();
    res.json(candidates);
});
  
router.post('/candidates', async (req, res) => {
    try {
      const { name, email, phone, skills, years_of_experience, current_location, current_company, current_job_title, salary_expectation, education, notice_period, willingness_to_relocate, industry_domain, certifications, resume_text } = req.body;
      
      if (!name || !email) {
        return res.status(400).json({ error: 'Name and Email are required' });
      }
  
      const newCandidate = await db.createCandidate({
        name,
        email,
        phone: phone || '',
        skills: Array.isArray(skills) ? skills : skills ? skills.split(',').map((s: string) => s.trim()) : [],
        years_of_experience: years_of_experience || 0,
        current_location: current_location || '',
        current_company: current_company || '',
        previous_companies: [],
        current_job_title: current_job_title || '',
        salary_expectation: salary_expectation || 0,
        education: education || '',
        notice_period: notice_period || '',
        willingness_to_relocate: willingness_to_relocate === true || willingness_to_relocate === 'true',
        industry_domain: industry_domain || '',
        certifications: certifications ? (Array.isArray(certifications) ? certifications : [certifications]) : [],
        resume_text: resume_text || `${name} - ${current_job_title}`
      });
  
      res.status(201).json(newCandidate);
    } catch (error: any) {
      console.error('Failed to create candidate:', error);
      res.status(500).json({ error: 'Failed to create candidate: ' + error.message });
    }
});
  
router.get('/candidates/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const candidates = await db.getCandidates();
    const candidate = candidates.find(c => c.id === id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    res.json(candidate);
});
  
router.delete('/candidates/:id', async (req, res) => {
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
  
          await db.createCandidate({
            name: cand.name,
            email: cand.email,
            phone: cand.phone || '',
            skills: Array.isArray(cand.skills) ? cand.skills : (typeof cand.skills === 'string' ? cand.skills.split(',').map(s => s.trim()) : []),
            years_of_experience: Number(cand.years_of_experience) || 0,
            current_location: cand.current_location || '',
            current_company: cand.current_company || '',
            previous_companies: Array.isArray(cand.previous_companies) ? cand.previous_companies : (typeof cand.previous_companies === 'string' ? cand.previous_companies.split(',').map(s => s.trim()) : []),
            current_job_title: cand.current_job_title || '',
            salary_expectation: Number(cand.salary_expectation) || 0,
            education: cand.education || '',
            notice_period: cand.notice_period || '',
            willingness_to_relocate: cand.willingness_to_relocate === 'true' || cand.willingness_to_relocate === true,
            industry_domain: cand.industry_domain || '',
            certifications: Array.isArray(cand.certifications) ? cand.certifications : (typeof cand.certifications === 'string' ? cand.certifications.split(',').map(s => s.trim()) : []),
            // The 'as any' is used here to bridge the Partial<Candidate> from the request
            // with the full object expected by createCandidate.
          } as any);
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
          const { name, email, phone, skills, years_of_experience, current_location, current_company, current_job_title, salary_expectation, education, notice_period, willingness_to_relocate, industry_domain, certifications, resume_text } = candidate;
  
          // Validate
          if (!name || !email) {
            errors.push(`Row ${i + 1}: Missing name or email`);
            continue;
          }
  
          // Create candidate
          const newCandidate = await db.createCandidate({
            name,
            email,
            phone: phone || '',
            skills: Array.isArray(skills) ? skills : (typeof skills === 'string' ? skills.split(',').map(s => s.trim()) : []),
            years_of_experience: parseInt(years_of_experience) || 0,
            current_location: current_location || '',
            current_company: current_company || '',
            previous_companies: [],
            current_job_title: current_job_title || '',
            salary_expectation: parseInt(salary_expectation) || 0,
            education: education || '',
            notice_period: notice_period || '',
            willingness_to_relocate: willingness_to_relocate === true || willingness_to_relocate === 'true',
            industry_domain: industry_domain || '',
            certifications: certifications ? (Array.isArray(certifications) ? certifications : [certifications]) : [],
            resume_text: resume_text || `${name} - ${current_job_title || 'Professional'}`
          });
  
          importedCandidates.push(newCandidate);
          console.log(`✅ Imported: ${name}`);
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
