-- Phase 5 (prerequisite for architecture doc §2.2 Skill Recency & Evolution, §2.3 Project
-- Intelligence Graph, §2.4 Career Intelligence) of the Enterprise AI Matching Architecture.
-- Purely additive: two new nullable columns on candidates. Nothing existing is dropped,
-- retyped, or renamed - candidates.projects/current_company/previous_companies are untouched and
-- remain what every existing caller reads.
--
-- WHY THIS MIGRATION EXISTS: §2.2/§2.3/§2.4 all need dated, structured per-role and per-project
-- history. Before this phase, parser.service.ts only ever produced a flat Projects string (one
-- blob covering every project) and an undated Current_Company/Previous_Companies name list - real
-- date ranges were used internally to compute years_of_experience but were never persisted. This
-- migration adds the storage; parser.service.ts is extended (same phase) to actually populate it.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS work_history JSONB;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS project_entries JSONB;

COMMENT ON COLUMN candidates.work_history IS 'Array of {company, title, start_date, end_date, is_current} - start_date/end_date are "YYYY-MM" or null when the resume does not state a specific month. Populated by parser.service.ts; null for any candidate parsed before this phase until re-parsed.';
COMMENT ON COLUMN candidates.project_entries IS 'Array of {name, description, technologies, start_date, end_date} - one entry per distinct project, decomposed from the same source text as the flat `projects` string (which is left untouched for backward compatibility). Populated by parser.service.ts; null for any candidate parsed before this phase until re-parsed.';
