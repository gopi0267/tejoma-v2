// Rehearsal-only script (Batch 2.5 cutover-mechanism rehearsal) - exercises the REAL dual-write
// code path in src/db.ts / src/dualWrite.ts by calling the actual exported functions directly,
// the same functions the monolith's real HTTP routes call. Not part of the application.
import * as db from '../../src/db.js';

async function main() {
  console.log('=== Dual-write rehearsal: calling real db.ts functions with DUAL_WRITE_ENABLED=true ===\n');

  console.log('1. updateCandidateProfile(2, { headline, skills, current_ctc })');
  const updated = await db.updateCandidateProfile(2, {
    headline: 'Staff Frontend Engineer',
    skills: ['React', 'TypeScript', 'CSS', 'GraphQL'],
    current_ctc: '16 LPA',
  });
  console.log('   monolith row now:', { id: updated?.id, headline: updated?.headline, skills: updated?.skills, current_ctc: updated?.current_ctc });

  console.log('\n2. createCandidateExperience(2, { job_title: "Frontend Intern", ... })');
  const created = await db.createCandidateExperience(2, {
    job_title: 'Frontend Intern',
    company: 'Startup Co',
    employment_type: 'Internship',
    experience_years: 0,
    experience_months: 6,
    skills_used: ['React'],
  });
  console.log('   monolith row created with id:', created?.id);

  console.log('\n3. markCandidateOnboardingComplete(4)');
  const marked = await db.markCandidateOnboardingComplete(4);
  console.log('   onboarding marked complete:', marked);

  // Dual-write is a fire-and-forget internal queue (dualWrite.ts's writeQueueTail) - give it a
  // moment to actually flush to the target database before this process exits.
  console.log('\nWaiting 1s for the dual-write queue to flush...');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('\nDone. Run scripts/validate-candidate-service-sync.ts now to confirm candidate-service caught up.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Rehearsal script failed:', err);
  process.exit(1);
});
