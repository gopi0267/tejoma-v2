-- Enterprise AI Matching Architecture, Phase 11B - Proficiency Analytics.
--
-- Adds the one column proficiency_shadow_scores was missing for real analysis: the recruiter's
-- actual decision at the moment the shadow score was computed. Score computation and the
-- decision are the same atomic event in this codebase (a recruiter swipes, and that swipe IS
-- both the scoring moment and the outcome) - so this is a single denormalized column, not a
-- separate outcome-event table with its own join/latency bookkeeping (the original Phase 11B
-- spec's experiment_events/experiment_outcomes split assumes match-time and decision-time are
-- asynchronous, which they are not here).
ALTER TABLE proficiency_shadow_scores ADD COLUMN IF NOT EXISTS decision_action NUMERIC;
