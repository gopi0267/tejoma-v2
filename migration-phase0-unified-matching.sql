-- Phase 0 (Foundation & Unified Serving) of the Enterprise AI Matching Architecture.
-- Purely additive: no column is dropped or retyped, no existing row is deleted, no existing
-- index is removed. Safe to run multiple times (every statement is IF NOT EXISTS / idempotent).
--
-- What this does:
--   1. Adds candidates.skills_array (TEXT[]) alongside the existing candidates.skills (TEXT)
--      column. skills stays the source of truth for every existing read/write path in the
--      codebase (mapRowToCandidate, getRecruiterReviewList's ILIKE filter, the skill-frequency
--      string_to_array() query) - none of that is touched. skills_array is a new, GIN-indexed,
--      always-in-sync array projection of the same data, used only by the new structured
--      pre-filter (db.getCandidatesForJobScoring) introduced in this phase.
--   2. Backfills skills_array for every existing row from the current skills string, using the
--      exact same ", "-split convention mapRowToCandidate's parseList() already uses, so the
--      backfilled array is byte-for-byte consistent with what the app already treats "the
--      candidate's skills" as meaning.
--   3. Adds the missing GIN index on jobs.required_skills - the single highest-weighted signal
--      in the matching formula (40% of the heuristic score) had no supporting index at all.
--
-- What this does NOT do: touch pgvector/embeddings (see migration-pgvector-embeddings.sql - that
-- one is blocked on an infrastructure prerequisite and is not applied by this file).

-- ============================================================================
-- 1. candidates.skills_array - additive column, dual-write source of truth going forward
-- ============================================================================
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skills_array TEXT[];

-- Backfill every existing row. Mirrors db.ts's mapRowToCandidate.parseList(row.skills, ', ')
-- exactly: NULL/empty/the literal string 'null' (case-insensitive - the legacy "no data" sentinel
-- used throughout this table, see schema.sql's own DEFAULT 'NULL' convention) all become '{}',
-- everything else is split on ", " and trimmed. Idempotent - only touches rows where
-- skills_array is still NULL, so re-running this file after new rows have been created with a
-- real skills_array (see db.ts's createCandidate/updateCandidate changes) is a no-op for those
-- rows.
UPDATE candidates
SET skills_array = (
  CASE
    WHEN skills IS NULL OR btrim(skills) = '' OR lower(btrim(skills)) = 'null'
      THEN '{}'::text[]
    ELSE (
      SELECT array_agg(btrim(s)) FILTER (WHERE btrim(s) <> '')
      FROM unnest(string_to_array(skills, ', ')) AS s
    )
  END
)
WHERE skills_array IS NULL;

-- array_agg(...) FILTER can return NULL (not '{}') when every split element was blank - normalize
-- that last edge case explicitly rather than leaving a NULL that would make skills_array's
-- semantics inconsistent (NULL should only ever mean "not backfilled yet", never "known empty").
UPDATE candidates SET skills_array = '{}'::text[] WHERE skills_array IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_skills_array ON candidates USING GIN (skills_array);

-- ============================================================================
-- 2. jobs.required_skills - missing index fix (Finding 10 of the architecture audit)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_jobs_required_skills ON jobs USING GIN (required_skills);

-- ============================================================================
-- Verification query (informational only, safe to run standalone):
--   SELECT count(*) AS total, count(*) FILTER (WHERE skills_array IS NULL) AS unbackfilled
--   FROM candidates;
-- unbackfilled should be 0 after this migration runs.
-- ============================================================================
