// Enterprise AI Matching Architecture, Phase 1 - one-time (idempotent, safe to re-run) seeding
// entry point for the Skill Intelligence Platform and Role Intelligence Platform. Run with:
//   npx tsx scripts/seed-intelligence-layer.ts
//
// Not wired into application startup - this is a deliberate, explicit operation an operator runs
// once (and can re-run any time to pick up dictionary/role-seed changes or refresh co-occurrence
// against newer platform data), not something that should silently re-run on every server boot.
import { seedSkillIntelligence, computeCooccurrenceEdges } from '../src/matching/skillIntelligence.js';
import { seedRoleProfiles } from '../src/matching/roleIntelligence.js';

async function main() {
  console.log('=== Seeding Skill Intelligence Platform ===');
  const skillResult = await seedSkillIntelligence();
  console.log(skillResult);

  console.log('\n=== Computing skill co-occurrence from live platform data ===');
  const cooccurrenceResult = await computeCooccurrenceEdges();
  console.log(cooccurrenceResult);

  console.log('\n=== Seeding Role Intelligence Platform ===');
  const roleResult = await seedRoleProfiles();
  console.log(roleResult);

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
