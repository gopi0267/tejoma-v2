-- Enterprise AI Matching Architecture, Phase 15 - Reasoning Conclusions Weighting, SHADOW MODE
-- ONLY.
--
-- Extends the same shadow log Phases 11/12/13 already write to - see those migrations' own
-- comments for why one denormalized row per decision beats a separate table per signal.
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS reasoning_multiplier NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS reasoning_density_signal NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS reasoning_coverage_signal NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS reasoning_quality_signal NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS reasoning_adjusted_score NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS reasoning_covered_domains JSONB;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS reasoning_uncovered_domains JSONB;
