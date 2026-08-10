/**
 * Shared row-level comparison helper for the Batch 13 validation scripts - the "validate" step of
 * Phase 11 section 12's migration methodology (backfill -> dual-write -> shadow-read -> validate
 * -> cutover -> rollback -> legacy removal). Used to confirm a target service's database is a
 * faithful, complete mirror of the corresponding monolith table before any real cutover decision
 * is made - this is meant to gate that decision, not just report information.
 *
 * Compares every row by id: missing rows (in source, not target), extra rows (in target, not
 * source), and field-level mismatches on rows present in both. Date/timestamp columns are
 * compared by epoch value (`.getTime()`), not by raw driver representation, since Postgres
 * TIMESTAMP columns come back as JS Date objects and two logically-equal timestamps can otherwise
 * differ in string form.
 */
import type { Pool } from './migrationDb.js';

export interface CompareTableSpec {
  sourceTable: string;
  targetTable: string;
  columns: string[];
}

export interface RowMismatch {
  id: number | string;
  field: string;
  sourceValue: unknown;
  targetValue: unknown;
}

export interface CompareResult {
  table: string;
  sourceCount: number;
  targetCount: number;
  missingFromTarget: (number | string)[];
  extraInTarget: (number | string)[];
  mismatches: RowMismatch[];
  ok: boolean;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const aTime = a instanceof Date ? a.getTime() : new Date(a as string).getTime();
    const bTime = b instanceof Date ? b.getTime() : new Date(b as string).getTime();
    return aTime === bTime;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

export async function compareTable(source: InstanceType<typeof Pool>, target: InstanceType<typeof Pool>, spec: CompareTableSpec): Promise<CompareResult> {
  const columnList = spec.columns.join(', ');
  const [sourceResult, targetResult] = await Promise.all([
    source.query(`SELECT ${columnList} FROM ${spec.sourceTable} ORDER BY id`),
    target.query(`SELECT ${columnList} FROM ${spec.targetTable} ORDER BY id`),
  ]);

  const sourceById = new Map<number | string, Record<string, unknown>>(sourceResult.rows.map((r: any) => [r.id, r]));
  const targetById = new Map<number | string, Record<string, unknown>>(targetResult.rows.map((r: any) => [r.id, r]));

  const missingFromTarget: (number | string)[] = [];
  const mismatches: RowMismatch[] = [];

  for (const [id, sourceRow] of sourceById) {
    const targetRow = targetById.get(id);
    if (!targetRow) {
      missingFromTarget.push(id);
      continue;
    }
    for (const column of spec.columns) {
      if (!valuesEqual(sourceRow[column], targetRow[column])) {
        mismatches.push({ id, field: column, sourceValue: sourceRow[column], targetValue: targetRow[column] });
      }
    }
  }

  const extraInTarget: (number | string)[] = [];
  for (const id of targetById.keys()) {
    if (!sourceById.has(id)) extraInTarget.push(id);
  }

  return {
    table: spec.targetTable,
    sourceCount: sourceResult.rows.length,
    targetCount: targetResult.rows.length,
    missingFromTarget,
    extraInTarget,
    mismatches,
    ok: missingFromTarget.length === 0 && extraInTarget.length === 0 && mismatches.length === 0,
  };
}

export function printCompareResult(result: CompareResult): void {
  const status = result.ok ? 'OK' : 'MISMATCH';
  console.log(`  [${status}] ${result.table}: source=${result.sourceCount} target=${result.targetCount}`);
  if (result.missingFromTarget.length > 0) {
    console.log(`    missing from target (${result.missingFromTarget.length}): ${result.missingFromTarget.slice(0, 20).join(', ')}${result.missingFromTarget.length > 20 ? ', ...' : ''}`);
  }
  if (result.extraInTarget.length > 0) {
    console.log(`    extra in target (${result.extraInTarget.length}): ${result.extraInTarget.slice(0, 20).join(', ')}${result.extraInTarget.length > 20 ? ', ...' : ''}`);
  }
  if (result.mismatches.length > 0) {
    console.log(`    field mismatches (${result.mismatches.length}), first 20:`);
    for (const m of result.mismatches.slice(0, 20)) {
      console.log(`      id=${m.id} ${m.field}: source=${JSON.stringify(m.sourceValue)} target=${JSON.stringify(m.targetValue)}`);
    }
  }
}
