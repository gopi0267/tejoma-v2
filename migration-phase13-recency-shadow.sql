-- Enterprise AI Matching Architecture, Phase 13 - Skill Recency Weighting, SHADOW MODE ONLY.
--
-- Extends the same shadow log Phases 11 (proficiency) and 12 (career) already write to, for the
-- same reason Phase 12's migration gave: all three multipliers are computed at the same decision
-- moment and chained together (proficiency -> career -> recency), so one denormalized row per
-- decision stays simpler than three tables that would always need joining back together.
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS recency_multiplier NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS recency_adjusted_score NUMERIC;
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS recency_role_expectation VARCHAR(10);
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS recency_skill_multipliers JSONB;
