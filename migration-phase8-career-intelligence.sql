-- Phase 8 (architecture doc §2.4 Career Intelligence Platform) of the Enterprise AI Matching
-- Architecture. Purely additive: one new table, one new nullable column on candidates. Nothing
-- existing is dropped, retyped, or renamed.
--
-- TYPE NOTE: every ID in this schema is SERIAL/INTEGER, never BIGINT/BIGSERIAL - kept consistent
-- here rather than introducing a new numeric type family for one table.
-- EMBEDDING NOTE: trajectory_embedding is DOUBLE PRECISION[], the same plain-array pattern every
-- other embedding column in this schema already uses (pgvector remains uninstalled - see
-- migration-pgvector-embeddings.sql).

CREATE TABLE IF NOT EXISTS career_trajectories (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Normalized job sequence (Module 1) - computed from candidates.work_history, not a second
  -- source of truth for it. Array of NormalizedJob (see src/matching/careerIntelligence/
  -- jobSequence.ts): {roleProfileId, title, company, startDate, endDate, isCurrent,
  -- durationMonths, inferredSeniority, inferredSeniorityConfidence, domain}.
  job_sequence               JSONB NOT NULL,
  total_career_months        INTEGER,
  role_count                 INTEGER,

  -- Progression analysis (Module 2)
  progression_type           VARCHAR(20), -- 'ic_track' | 'management_track' | 'mixed' | 'unclear'
  seniority_level             VARCHAR(20), -- most recent role's inferred seniority
  seniority_trend             VARCHAR(20), -- 'ascending' | 'stable' | 'descending' | 'unclear'
  transitions                JSONB,        -- array of Transition (see progression.ts)

  -- Stability & domain analysis (Module 3) - FACTS ONLY, see this table's own column comments
  -- below and progression.ts's fairness-critical module doc. Never a screening signal by design.
  avg_tenure_months           NUMERIC,
  median_tenure_months        NUMERIC,
  tenure_pattern               VARCHAR(20), -- 'stable' | 'short' | 'variable' | 'unclear'
  gaps                        JSONB,        -- array of {startDate, endDate, durationMonths} - dates and duration ONLY, never a cause
  domain_concentration         NUMERIC,      -- 0-1
  domains                      JSONB,        -- array of {domain, roleCount, totalMonths, percentage}

  -- Trajectory embedding (Module 4) - deterministic positional encoding, see
  -- trajectoryEmbedding.ts's module doc for why this is not a trained neural sequence model.
  trajectory_embedding         DOUBLE PRECISION[],

  -- Future role prediction (Module 5) - rule-based from Role Intelligence's career_progression/
  -- related_roles (Phase 1 seed data), NOT learned from historical outcomes - this platform does
  -- not yet have enough candidates with populated work_history to learn from real transitions.
  -- See futureRolePrediction.ts's module doc.
  predicted_next_roles         JSONB, -- array of {roleProfileId, roleName, confidence, reasoning}

  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT career_trajectories_candidate_unique UNIQUE (candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_career_trajectories_candidate ON career_trajectories(candidate_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_company ON career_trajectories(company_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_seniority ON career_trajectories(seniority_level);

COMMENT ON COLUMN career_trajectories.gaps IS 'Employment gaps between work_history entries - start date, end date, and duration ONLY. Never annotated with an inferred cause (parental leave, caregiving, disability, sabbatical, etc.) - see this codebase''s fairness governance discipline. Not used in any scoring path this phase.';
COMMENT ON COLUMN career_trajectories.tenure_pattern IS 'Descriptive only (stable/short/variable) - never wired into live matching or screening this phase. See progression.ts module doc for the full fairness caveat.';

-- Not a separate FK column on candidates (career_trajectories already has a UNIQUE candidate_id
-- and its own id) - a candidate->trajectory lookup is a single indexed query
-- (WHERE candidate_id = $1), not worth a redundant denormalized pointer column.
