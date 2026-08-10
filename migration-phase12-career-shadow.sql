-- Enterprise AI Matching Architecture, Phase 12 - Career Trajectory Weighting, SHADOW MODE ONLY.
--
-- Extends the same shadow log Phase 11 (proficiency) already writes to, rather than a parallel
-- career_shadow_scores table - proficiency and career multipliers are computed at the exact same
-- decision moment (see proficiencyWeighting.ts/careerWeighting.ts's shared call sites), so one
-- denormalized row per decision stays simpler and more honest than two tables that would always
-- need to be joined back together for any real analysis.
--
-- career_progression_type is stored as a snapshot at decision time (not re-joined from
-- career_trajectories later) - same "shadow log is an immutable, decision-time snapshot"
-- discipline already applied to skill_multipliers JSONB.
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS career_multiplier NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS career_progression_signal NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS career_stability_signal NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS career_domain_signal NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS career_adjusted_score NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS career_progression_type VARCHAR(20);
