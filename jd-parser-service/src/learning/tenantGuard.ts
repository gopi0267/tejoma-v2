/**
 * Phase 8 tenant-contamination guard.
 *
 * THE RISK THIS EXISTS FOR, STATED PLAINLY
 * The existing LTR trains globally by design - its own trainingDataClient.ts says the three
 * training feeds are "deliberately UNSCOPED: the ranker is trained globally, not per tenant".
 * With 118 of 120 swipes belonging to company_id=1, a "global" model is company 1's preferences,
 * and serving it to companies 69 and 71 would be leaking one customer's hiring judgement into
 * another's ranking. Nothing in the current code prevents that; these functions do.
 *
 * The guard is structural rather than advisory: every function that could assemble or evaluate a
 * training set takes an explicit scope, and a global scope is only constructible with a recorded
 * authorisation reference. There is no default that quietly means "everyone".
 */

import type { TenantScopeDeclaration } from './contract.js';

export interface TenantViolation {
  kind: 'FOREIGN_TENANT_ROW' | 'MISSING_TENANT' | 'FORGED_TENANT' | 'TENANT_MISMATCH'
    | 'UNAUTHORIZED_GLOBAL' | 'MIXED_TENANT_SET';
  detail: string;
}

/** Build a single-tenant scope. The only scope a request path may ever construct. */
export function singleTenantScope(tenantId: string): TenantScopeDeclaration {
  if (!tenantId || !tenantId.trim()) throw new Error('tenant_id is required and must be non-empty');
  return { scope: 'SINGLE_TENANT', tenant_id: tenantId, authorization_reference: null };
}

/**
 * Build a global scope. Deliberately awkward: it cannot be created without naming the approval,
 * and the reference is stored on the model version so a global model can always be traced to the
 * decision that permitted it.
 */
export function globalAuthorizedScope(authorizationReference: string): TenantScopeDeclaration {
  if (!authorizationReference || !authorizationReference.trim()) {
    throw new Error('a global training scope requires a documented authorization_reference');
  }
  return { scope: 'GLOBAL_AUTHORIZED', tenant_id: null, authorization_reference: authorizationReference };
}

/**
 * The tenant a request is allowed to act for is derived from the verified JWT claim, never from the
 * request body. Mirrors the Phase 6/7 route rule that already rejects a body-supplied tenant_id.
 */
export function tenantFromToken(companyId: number | string | null | undefined): string {
  if (companyId === null || companyId === undefined || companyId === '') {
    throw new Error('authenticated token carries no company_id; refusing to derive a tenant');
  }
  return `tenant-${companyId}`;
}

/**
 * Verify an assembled row set actually honours the scope it claims. Run after assembly, so a bug in
 * the assembler cannot silently produce a mixed set - the same fail-closed pattern Phase 6 and 7
 * use for evidence and satisfaction.
 */
export function verifyTenantIsolation(
  rows: { tenant_id?: string | null }[], scope: TenantScopeDeclaration,
): TenantViolation[] {
  const violations: TenantViolation[] = [];

  if (scope.scope === 'SINGLE_TENANT' && !scope.tenant_id) {
    violations.push({ kind: 'MISSING_TENANT', detail: 'SINGLE_TENANT scope without a tenant_id' });
    return violations;
  }
  if (scope.scope === 'GLOBAL_AUTHORIZED' && !scope.authorization_reference) {
    violations.push({
      kind: 'UNAUTHORIZED_GLOBAL',
      detail: 'global scope without an authorization_reference - refused',
    });
    return violations;
  }

  const seen = new Set<string>();
  for (const r of rows) {
    if (r.tenant_id === null || r.tenant_id === undefined || r.tenant_id === '') {
      violations.push({ kind: 'MISSING_TENANT', detail: 'row carries no tenant_id' });
      continue;
    }
    seen.add(r.tenant_id);
    if (scope.scope === 'SINGLE_TENANT' && r.tenant_id !== scope.tenant_id) {
      violations.push({
        kind: 'FOREIGN_TENANT_ROW',
        detail: `row tenant ${r.tenant_id} present in a set scoped to ${scope.tenant_id}`,
      });
    }
  }

  if (scope.scope === 'SINGLE_TENANT' && seen.size > 1) {
    violations.push({
      kind: 'MIXED_TENANT_SET',
      detail: `single-tenant set contains ${seen.size} tenants: ${[...seen].sort().join(', ')}`,
    });
  }
  return violations;
}

/**
 * Reject a caller attempting to assert a tenant. Returns a violation rather than throwing so a
 * route can answer 400 and increment the guard counter in one place.
 */
export function rejectCallerTenant(
  bodyTenant: unknown, tokenTenant: string,
): TenantViolation | null {
  if (bodyTenant === undefined || bodyTenant === null) return null;
  return String(bodyTenant) === tokenTenant
    ? { kind: 'FORGED_TENANT', detail: 'tenant is derived from the token and must not be supplied, even when it matches' }
    : { kind: 'TENANT_MISMATCH', detail: `body tenant ${String(bodyTenant)} does not match token tenant ${tokenTenant}` };
}

/**
 * Sources that may never contribute labels because they cannot prove tenant ownership.
 * `candidate_decisions` has no tenant column at all; joining to infer one would be guessing at
 * ownership of another company's data.
 */
export const TENANT_BLOCKED_SOURCES: readonly string[] = ['candidate_decisions'] as const;

export function assertSourcePermitted(table: string): TenantViolation | null {
  return TENANT_BLOCKED_SOURCES.includes(table)
    ? { kind: 'MISSING_TENANT', detail: `${table} has no tenant column and is blocked as a label source` }
    : null;
}
