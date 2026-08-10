BEGIN;

DROP TABLE IF EXISTS skill_edges;
DROP TABLE IF EXISTS skill_nodes;
DROP TABLE IF EXISTS role_profiles;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
