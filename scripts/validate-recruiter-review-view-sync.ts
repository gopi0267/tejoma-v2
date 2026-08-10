/**
 * Validate recruiter_review_view sync (matching-decision-service vs. monolith)
 *
 * Phase 4, Item 5: Confirms materialized view is in sync with source data
 *
 * Run BEFORE cutover: validates backfill completeness
 * Run AFTER dual-writes enabled: validates refresh hooks are working
 * Run periodically: detects any divergence
 */

import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const monolithPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tejoma',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const matchingDecisionPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.MATCHING_DECISION_SERVICE_DB_NAME || 'tejoma_matching_decision',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function validateRowCount(): Promise<boolean> {
  console.log('\n[recruiter_review_view] Validating row counts...');

  try {
    // Count swipes in monolith (source of truth)
    const monolithCount = await monolithPool.query(
      `SELECT COUNT(*) as count FROM swipes`
    );
    const swipeCount = parseInt(monolithCount.rows[0].count);

    // Count rows in view (should match)
    const viewCount = await matchingDecisionPool.query(
      `SELECT COUNT(*) as count FROM recruiter_review_view`
    );
    const viewRowCount = parseInt(viewCount.rows[0].count);

    console.log(`  Monolith swipes: ${swipeCount}`);
    console.log(`  View rows: ${viewRowCount}`);

    if (swipeCount === viewRowCount) {
      console.log(`  ✅ Row counts match`);
      return true;
    } else {
      console.log(`  ❌ Row count mismatch! (diff: ${Math.abs(swipeCount - viewRowCount)})`);
      return false;
    }
  } catch (error) {
    console.error(`  ❌ Error validating row counts:`, error);
    return false;
  }
}

async function validateSampleData(): Promise<boolean> {
  console.log('\n[recruiter_review_view] Validating sample data (10 random rows)...');

  try {
    // Get 10 random swipes from monolith
    const sampleSwipes = await monolithPool.query(
      `SELECT id, candidate_id, job_id, company_id, action, score
       FROM swipes
       ORDER BY RANDOM()
       LIMIT 10`
    );

    if (sampleSwipes.rows.length === 0) {
      console.log('  No swipes found in monolith, skipping sample validation');
      return true;
    }

    let driftFound = false;
    for (const swipe of sampleSwipes.rows) {
      const viewRow = await matchingDecisionPool.query(
        `SELECT candidate_id, job_id, company_id, action, score, updated_at
         FROM recruiter_review_view
         WHERE candidate_id = $1 AND job_id = $2 AND company_id = $3`,
        [swipe.candidate_id, swipe.job_id, swipe.company_id]
      );

      if (viewRow.rows.length === 0) {
        console.log(
          `  ❌ Missing in view: candidate_id=${swipe.candidate_id}, job_id=${swipe.job_id}, company_id=${swipe.company_id}`
        );
        driftFound = true;
        continue;
      }

      const row = viewRow.rows[0];
      if (
        row.action !== swipe.action ||
        parseFloat(row.score) !== parseFloat(swipe.score)
      ) {
        console.log(
          `  ❌ Data mismatch for candidate=${swipe.candidate_id}, job=${swipe.job_id}: ` +
            `action=${swipe.action} vs ${row.action}, score=${swipe.score} vs ${row.score}`
        );
        driftFound = true;
      }
    }

    if (!driftFound) {
      console.log(`  ✅ Sample data matches`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`  ❌ Error validating sample data:`, error);
    return false;
  }
}

async function validatePerCompany(): Promise<boolean> {
  console.log('\n[recruiter_review_view] Validating row counts per company...');

  try {
    // Count swipes per company in monolith
    const monolithPerCompany = await monolithPool.query(
      `SELECT company_id, COUNT(*) as count
       FROM swipes
       GROUP BY company_id
       ORDER BY company_id`
    );

    // Count rows per company in view
    const viewPerCompany = await matchingDecisionPool.query(
      `SELECT company_id, COUNT(*) as count
       FROM recruiter_review_view
       GROUP BY company_id
       ORDER BY company_id`
    );

    const monolithMap = new Map(
      monolithPerCompany.rows.map((r) => [r.company_id, parseInt(r.count)])
    );
    const viewMap = new Map(
      viewPerCompany.rows.map((r) => [r.company_id, parseInt(r.count)])
    );

    let match = true;
    const allCompanies = new Set([...monolithMap.keys(), ...viewMap.keys()]);

    for (const companyId of allCompanies) {
      const monolithCount = monolithMap.get(companyId) || 0;
      const viewCount = viewMap.get(companyId) || 0;

      if (monolithCount !== viewCount) {
        console.log(
          `  ❌ Company ${companyId}: ${monolithCount} swipes vs ${viewCount} view rows`
        );
        match = false;
      }
    }

    if (match) {
      console.log(`  ✅ All companies match`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`  ❌ Error validating per-company counts:`, error);
    return false;
  }
}

async function main(): Promise<void> {
  try {
    console.log('Starting recruiter_review_view sync validation...');

    const results = await Promise.all([
      validateRowCount(),
      validateSampleData(),
      validatePerCompany(),
    ]);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('VALIDATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');

    if (results.every((r) => r)) {
      console.log('✅ All validations passed! Ready for cutover.');
      process.exit(0);
    } else {
      console.log('❌ Some validations failed. Do not proceed with cutover.');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ Validation error:', err);
    process.exit(1);
  } finally {
    await monolithPool.end();
    await matchingDecisionPool.end();
  }
}

main();
