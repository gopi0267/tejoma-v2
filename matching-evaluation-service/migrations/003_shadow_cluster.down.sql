-- Rollback for 003_shadow_cluster. Destructive - only ever run with --confirm
-- (scripts/migrate.ts). The monolith's own copies of role_profiles/skill_nodes/career_trajectories/
-- reasoning_conclusions are never touched by this migration or its rollback - they remain fully
-- authoritative throughout, per this migration's strangler-fig discipline.

BEGIN;

DROP TABLE IF EXISTS shadow_weighting_computations;
DROP TABLE IF EXISTS reasoning_conclusions;
DROP TABLE IF EXISTS career_trajectories;
DROP TABLE IF EXISTS skill_nodes;
DROP TABLE IF EXISTS role_profiles;
DELETE FROM schema_migrations WHERE version = '003_shadow_cluster';

COMMIT;
