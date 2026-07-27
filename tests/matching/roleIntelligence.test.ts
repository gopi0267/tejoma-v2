import { describe, it, expect } from 'vitest';
import { ROLE_SEEDS } from '../../src/matching/roleIntelligence.js';

// Enterprise AI Matching Architecture, Phase 1 - Role Intelligence Platform. Pure data-integrity
// tests over ROLE_SEEDS (no DB) - seedRoleProfiles()/matchRoleByTitle() themselves need a real
// database and embedding service, covered by the integration test pass instead.

describe('ROLE_SEEDS - structural integrity', () => {
  it('seeds exactly the 9 roles from the architecture document', () => {
    expect(ROLE_SEEDS).toHaveLength(9);
  });

  it('every role has a unique role_key', () => {
    const keys = ROLE_SEEDS.map((r) => r.role_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every role_key is a lowercase slug (no spaces, no uppercase - a stable identifier future roles can extend)', () => {
    for (const role of ROLE_SEEDS) {
      expect(role.role_key).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('every role has a non-empty display_name', () => {
    for (const role of ROLE_SEEDS) {
      expect(role.display_name.trim().length).toBeGreaterThan(0);
    }
  });

  it('every role has a valid experience band (min <= max, both non-negative)', () => {
    for (const role of ROLE_SEEDS) {
      expect(role.experience_band_min).toBeGreaterThanOrEqual(0);
      expect(role.experience_band_max).toBeGreaterThanOrEqual(role.experience_band_min);
    }
  });

  it('every role has at least one mandatory or preferred skill (a role with none would be uninformative)', () => {
    for (const role of ROLE_SEEDS) {
      expect(role.mandatory_skills.length + role.preferred_skills.length, `role "${role.role_key}" has no mandatory or preferred skills`).toBeGreaterThan(0);
    }
  });

  it('every role has at least one typical responsibility', () => {
    for (const role of ROLE_SEEDS) {
      expect(role.typical_responsibilities.length).toBeGreaterThan(0);
    }
  });

  it('mandatory, preferred, and optional skill lists do not overlap within a single role', () => {
    for (const role of ROLE_SEEDS) {
      const mandatory = new Set(role.mandatory_skills);
      const preferred = new Set(role.preferred_skills);
      const optional = new Set(role.optional_skills);
      for (const s of preferred) expect(mandatory.has(s), `"${s}" is both mandatory and preferred in ${role.role_key}`).toBe(false);
      for (const s of optional) {
        expect(mandatory.has(s), `"${s}" is both mandatory and optional in ${role.role_key}`).toBe(false);
        expect(preferred.has(s), `"${s}" is both preferred and optional in ${role.role_key}`).toBe(false);
      }
    }
  });

  it('includes the specific 9 roles named in the architecture document', () => {
    const keys = new Set(ROLE_SEEDS.map((r) => r.role_key));
    expect(keys).toEqual(new Set([
      'genai_engineer', 'backend_engineer', 'frontend_engineer', 'data_engineer', 'ml_engineer',
      'devops_engineer', 'cyber_security_engineer', 'sap_consultant', 'product_manager',
    ]));
  });
});
