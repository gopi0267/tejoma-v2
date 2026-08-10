-- Enterprise AI Matching Architecture, Phase 11 - Proficiency Weighting, SHADOW MODE ONLY.
--
-- Append-only event log (same convention as `swipes` - never updated/deleted, one row per
-- decision, not upserted) recording what the match score WOULD have been with proficiency
-- weighting applied, alongside the real score actually shown. Never read by any live scoring
-- path - purely for future analysis before a deliberate, separate decision to wire this in live.
CREATE TABLE IF NOT EXISTS proficiency_shadow_scores (
  id                          SERIAL PRIMARY KEY,
  company_id                  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id                INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id                      INTEGER NOT NULL,
  base_match_score            NUMERIC NOT NULL,
  proficiency_adjusted_score  NUMERIC NOT NULL,
  overall_multiplier          NUMERIC NOT NULL,
  skill_multipliers           JSONB NOT NULL,
  computed_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_proficiency_shadow_scores_candidate_job ON proficiency_shadow_scores(candidate_id, job_id);
CREATE INDEX IF NOT EXISTS idx_proficiency_shadow_scores_company ON proficiency_shadow_scores(company_id);
