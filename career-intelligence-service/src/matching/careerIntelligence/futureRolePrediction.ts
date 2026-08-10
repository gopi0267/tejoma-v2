// Ported from the monolith's src/matching/careerIntelligence/futureRolePrediction.ts -
// byte-identical logic. Rule-based from Role Intelligence's seed data (career_progression,
// related_roles), read from this service's own dual-written role_profiles mirror.

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
    const pathIndex = currentRole.career_progression.findIndex(
      (step) => normalizeForLexicalMatch(step) === normalizeForLexicalMatch(current.title || '')
    );
    if (pathIndex >= 0 && pathIndex < currentRole.career_progression.length - 1) {
      predictions.push({
        roleProfileId: null,
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
