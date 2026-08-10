-- Rollback for 002_match_scores. Destructive - only ever run with --confirm.
-- The monolith's own match_scores/match_features tables are never touched by this migration or
-- its rollback - they remain intact and continue being written to by the monolith's own
-- unchanged matchingApi.ts/featureStore.ts until job.routes.ts/swipe.routes.ts are actually cut
-- over (a later, separate step).

BEGIN;

DROP TABLE IF EXISTS match_features;
DROP TABLE IF EXISTS match_scores;
DELETE FROM schema_migrations WHERE version = '002_match_scores';

COMMIT;
