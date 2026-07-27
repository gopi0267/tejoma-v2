-- Phase 6 (§2.2 Skill Recency & Evolution Intelligence, §2.3 Project Intelligence Graph) of the
-- Enterprise AI Matching Architecture. Purely additive: one new nullable column on candidates.
-- Nothing existing is dropped, retyped, or renamed.
--
-- Skill Recency (§2.2) is computed on demand (src/matching/skillRecency.ts) from
-- candidates.project_entries + skill_nodes.category and is NOT stored - cheap enough to compute
-- per call, and storing it would mean keeping a derived value in sync with project_entries/
-- skill_nodes.category as either changes, for no real benefit at this phase's request volume.
--
-- Project Intelligence (§2.3) DOES need graph traversal (skill_edges lookups per technology), so
-- it's precomputed once in the background after candidate creation and stored here, avoiding
-- recomputing it on every later read.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS project_intelligence JSONB;

COMMENT ON COLUMN candidates.project_intelligence IS 'Array of {projectName, explicitSkills: [{raw, canonicalSkillId, canonicalName}], impliedSkills: [{canonicalSkillId, canonicalName, viaSkill, relationshipType}]} - one entry per candidates.project_entries item. impliedSkills are one-hop USES/FRAMEWORK_OF graph inferences, never merged into candidates.skills/skills_array. Populated by src/matching/projectIntelligence.ts in the background after candidate creation; null until that runs, and null forever for a candidate with no project_entries.';
