// One-time backfill: copies the monolith's ltr_model_versions, match_evaluation_runs, (Batch 25)
// proficiency_shadow_scores, and (Batch 31) skill_nodes/role_profiles/career_trajectories/
// reasoning_conclusions tables into Matching Evaluation Service's own database
// (tejoma_matching_evaluation). shadow_weighting_computations is NOT backfilled here - it's this
// service's own independently-computed table (populated only by its own ported shadowScoring.ts),
// same reasoning as every other owned table in this migration. See
// backfill-identity-service.ts's header comment for the full methodology (read-only against the
// monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-matching-evaluation-service.ts             (writes for real)
//   npx tsx scripts/backfill-matching-evaluation-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.MATCHING_EVALUATION_SERVICE_DB_NAME || 'tejoma_matching_evaluation';

const LTR_MODEL_VERSION_COLUMNS = ['id', 'version', 'algorithm', 'training_examples', 'training_groups', 'ndcg_at_10', 'trained_at', 'is_active'];
const MATCH_EVALUATION_RUN_COLUMNS = ['id', 'company_id', 'evaluated_at', 'jobs_evaluated', 'swipes_evaluated', 'k', 'ndcg_at_k', 'map_at_k', 'mrr', 'precision_at_k', 'recall_at_k', 'data_volume_note'];
const PROFICIENCY_SHADOW_SCORE_COLUMNS = [
  'id', 'company_id', 'candidate_id', 'job_id', 'base_match_score', 'proficiency_adjusted_score',
  'overall_multiplier', 'skill_multipliers', 'computed_at', 'decision_action', 'career_multiplier',
  'career_progression_signal', 'career_stability_signal', 'career_domain_signal',
  'career_adjusted_score', 'career_progression_type', 'recency_multiplier', 'recency_adjusted_score',
  'recency_role_expectation', 'recency_skill_multipliers', 'reasoning_multiplier',
  'reasoning_density_signal', 'reasoning_coverage_signal', 'reasoning_quality_signal',
  'reasoning_adjusted_score', 'reasoning_covered_domains', 'reasoning_uncovered_domains',
];
const PROFICIENCY_SHADOW_SCORE_JSON_COLUMNS = ['skill_multipliers', 'recency_skill_multipliers', 'reasoning_covered_domains', 'reasoning_uncovered_domains'];

const SKILL_NODE_COLUMNS = ['id', 'canonical_name', 'category', 'technology_domain', 'aliases', 'popularity_score', 'confidence', 'is_deprecated', 'is_emerging', 'source', 'embedding', 'created_at', 'updated_at'];
const ROLE_PROFILE_COLUMNS = ['id', 'role_key', 'display_name', 'mandatory_skills', 'preferred_skills', 'optional_skills', 'common_tools', 'typical_responsibilities', 'preferred_certifications', 'experience_band_min', 'experience_band_max', 'related_roles', 'career_progression', 'embedding', 'source', 'created_at', 'updated_at'];
const CAREER_TRAJECTORY_COLUMNS = ['id', 'candidate_id', 'company_id', 'job_sequence', 'total_career_months', 'role_count', 'progression_type', 'seniority_level', 'seniority_trend', 'transitions', 'avg_tenure_months', 'median_tenure_months', 'tenure_pattern', 'gaps', 'domain_concentration', 'domains', 'trajectory_embedding', 'predicted_next_roles', 'created_at', 'updated_at'];
const CAREER_TRAJECTORY_JSON_COLUMNS = ['job_sequence', 'transitions', 'gaps', 'domains', 'predicted_next_roles'];
const REASONING_CONCLUSION_COLUMNS = ['id', 'subject_type', 'subject_id', 'conclusion_text', 'conclusion_type', 'reasoning_type', 'evidence_chain', 'conclusion_confidence', 'confidence_derivation', 'derived_from', 'created_at'];
const REASONING_CONCLUSION_JSON_COLUMNS = ['evidence_chain'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Matching Evaluation Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const ltrResult = await backfillTable(
      source, target,
      { sourceTable: 'ltr_model_versions', targetTable: 'ltr_model_versions', columns: LTR_MODEL_VERSION_COLUMNS },
      dryRun
    );
    const evalResult = await backfillTable(
      source, target,
      { sourceTable: 'match_evaluation_runs', targetTable: 'match_evaluation_runs', columns: MATCH_EVALUATION_RUN_COLUMNS },
      dryRun
    );
    const shadowScoreResult = await backfillTable(
      source, target,
      { sourceTable: 'proficiency_shadow_scores', targetTable: 'proficiency_shadow_scores', columns: PROFICIENCY_SHADOW_SCORE_COLUMNS, jsonColumns: PROFICIENCY_SHADOW_SCORE_JSON_COLUMNS },
      dryRun
    );
    const skillNodeResult = await backfillTable(
      source, target,
      { sourceTable: 'skill_nodes', targetTable: 'skill_nodes', columns: SKILL_NODE_COLUMNS },
      dryRun
    );
    const roleProfileResult = await backfillTable(
      source, target,
      { sourceTable: 'role_profiles', targetTable: 'role_profiles', columns: ROLE_PROFILE_COLUMNS },
      dryRun
    );
    const careerTrajectoryResult = await backfillTable(
      source, target,
      { sourceTable: 'career_trajectories', targetTable: 'career_trajectories', columns: CAREER_TRAJECTORY_COLUMNS, jsonColumns: CAREER_TRAJECTORY_JSON_COLUMNS },
      dryRun
    );
    const reasoningConclusionResult = await backfillTable(
      source, target,
      { sourceTable: 'reasoning_conclusions', targetTable: 'reasoning_conclusions', columns: REASONING_CONCLUSION_COLUMNS, jsonColumns: REASONING_CONCLUSION_JSON_COLUMNS },
      dryRun
    );

    console.log('\n=== Summary ===');
    for (const result of [ltrResult, evalResult, shadowScoreResult, skillNodeResult, roleProfileResult, careerTrajectoryResult, reasoningConclusionResult]) {
      console.log(`  ${result.table.padEnd(24)} read=${result.read}  ${dryRun ? '' : `written=${result.written}`}`);
    }
    console.log(dryRun ? '\nDry run complete - no data was written.' : '\nBackfill complete.');
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
