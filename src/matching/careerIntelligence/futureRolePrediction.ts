// Enterprise AI Matching Architecture, §2.4 Career Intelligence Platform - Module 5: Future Role
// Prediction.
//
// Rule-based from Role Intelligence's existing seed data (role_profiles.career_progression,
// .related_roles - Phase 1), NOT learned from historical outcomes. This platform does not yet
// have enough candidates with populated work_history (a Phase 5 field) to learn "candidates with
// this trajectory typically moved to X" from real transitions - the architecture doc's own Design
// Principle 9 ("respect the data volume that actually exists... rule-based default... never the
// reverse") is exactly the situation here. This module implements the doc's own explicitly-named
// fallback ("default progression rules"); a learned-confidence upgrade is future work once real
// transition volume exists to learn from.

import { db } from '../../db.js';
import { normalizeForLexicalMatch } from '../dynamicWeighting.js';
import type { NormalizedJob, PredictedRole, RoleProfile } from '../../types.js';
import type { ProgressionAnalysis } from './progression.js';

export async function predictNextRoles(
  jobs: NormalizedJob[],
  _progression: ProgressionAnalysis,
  topK: number = 2
): Promise<PredictedRole[]> {
  const current = jobs[jobs.length - 1];
  if (!current) return [];

  const predictions: PredictedRole[] = [];

  let currentRole: RoleProfile | undefined;
  if (current.roleProfileId) {
    const roles = await db.getAllRoleProfiles();
    currentRole = roles.find((r) => r.id === current.roleProfileId);
  }

  if (currentRole) {
    // 1. Next step in this role's own career_progression path (an ordered array of display
    // names, e.g. ['Backend Engineer', 'Senior Backend Engineer', 'Staff Engineer', 'Engineering
    // Manager']) - locate the candidate's current title within it.
    const pathIndex = currentRole.career_progression.findIndex(
      (step) => normalizeForLexicalMatch(step) === normalizeForLexicalMatch(current.title || '')
    );
    if (pathIndex >= 0 && pathIndex < currentRole.career_progression.length - 1) {
      predictions.push({
        roleProfileId: null, // career_progression is a plain string path, not itself linked to a role_profiles row per step
        roleName: currentRole.career_progression[pathIndex + 1],
        confidence: 0.6,
        reasoning: `Next step in ${currentRole.display_name}'s typical career progression path`,
      });
    } else if (currentRole.career_progression.length > 0) {
      const lastStep = currentRole.career_progression[currentRole.career_progression.length - 1];
      if (normalizeForLexicalMatch(lastStep) !== normalizeForLexicalMatch(current.title || '')) {
        predictions.push({
          roleProfileId: null, roleName: lastStep, confidence: 0.35,
          reasoning: `${currentRole.display_name}'s typical progression path (current title did not exactly match a known step in it)`,
        });
      }
    }

    // 2. A related role, as a lower-confidence, domain-adjacent possibility.
    if (currentRole.related_roles.length > 0) {
      predictions.push({
        roleProfileId: null, roleName: currentRole.related_roles[0], confidence: 0.3,
        reasoning: `A related role to ${currentRole.display_name} (Role Intelligence's related-roles data), reachable via a domain move`,
      });
    }
  }

  if (predictions.length === 0) {
    return [{
      roleProfileId: null, roleName: current.title || 'Unknown', confidence: 0.1,
      reasoning: 'Current title could not be matched to a known role profile - no progression data available to predict from',
    }];
  }

  return predictions.slice(0, topK);
}
