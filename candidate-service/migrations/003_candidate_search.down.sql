-- Rollback for 003_candidate_search. Destructive - only ever run with --confirm
-- (scripts/migrate.ts). The monolith's own saved_candidates/candidate_profile_views tables are
-- never touched by this migration or its rollback - they remain in place (though no longer the
-- live-traffic path once the gateway routing entry for /api/candidate-search is reverted), per
-- this migration's strangler-fig discipline.

BEGIN;

DROP TABLE IF EXISTS candidate_profile_views;
DROP TABLE IF EXISTS saved_candidates;
DELETE FROM schema_migrations WHERE version = '003_candidate_search';

COMMIT;
