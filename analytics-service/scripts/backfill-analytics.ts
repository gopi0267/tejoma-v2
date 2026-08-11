/**
 * Backfill Analytics CQRS Tables
 * One-time script to populate analytics read model from service databases
 * Run once after deploying analytics CQRS infrastructure
 *
 * Usage: npx tsx scripts/backfill-analytics.ts
 */
import pkg from 'pg';
const { Pool } = pkg;

const analyticsPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_analytics',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

const monolithPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

async function backfillAnalytics() {
  console.log('Starting analytics backfill...');

  try {
    // 1. Get all companies
    const companiesResult = await monolithPool.query(
      `SELECT id as company_id FROM companies WHERE deleted_at IS NULL LIMIT 1000`
    );

    const companies = companiesResult.rows;
    console.log(`Found ${companies.length} companies`);

    for (const { company_id } of companies) {
      console.log(`Processing company ${company_id}...`);

      // Backfill dashboard metrics for this company
      const jobsResult = await monolithPool.query(
        `SELECT COUNT(*) as count FROM jobs WHERE company_id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [company_id]
      );
      const activeJobs = jobsResult.rows[0]?.count || 0;

      const swipesResult = await monolithPool.query(
        `SELECT COUNT(*) as count FROM decisions WHERE company_id = $1 AND deleted_at IS NULL`,
        [company_id]
      );
      const totalSwipes = swipesResult.rows[0]?.count || 0;

      const acceptedResult = await monolithPool.query(
        `SELECT COUNT(*) as count FROM decisions WHERE company_id = $1 AND decision_type = 'accept' AND deleted_at IS NULL`,
        [company_id]
      );
      const acceptedSwipes = acceptedResult.rows[0]?.count || 0;

      const acceptanceRate = totalSwipes > 0 ? (acceptedSwipes / totalSwipes) * 100 : 0;

      await analyticsPool.query(
        `INSERT INTO analytics_dashboard_cache (company_id, total_reviewed, matches_made, acceptance_rate)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id) DO UPDATE SET
           total_reviewed = $2,
           matches_made = $3,
           acceptance_rate = $4`,
        [company_id, totalSwipes, acceptedSwipes, parseFloat(acceptanceRate.toFixed(2))]
      );

      // Backfill job stats for this company
      const jobsForCompany = await monolithPool.query(
        `SELECT id FROM jobs WHERE company_id = $1 AND deleted_at IS NULL LIMIT 1000`,
        [company_id]
      );

      for (const job of jobsForCompany.rows) {
        const jobSwipesResult = await monolithPool.query(
          `SELECT COUNT(*) as count FROM decisions WHERE job_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [job.id, company_id]
        );
        const jobSwipes = jobSwipesResult.rows[0]?.count || 0;

        const jobAcceptedResult = await monolithPool.query(
          `SELECT COUNT(*) as count FROM decisions WHERE job_id = $1 AND company_id = $2 AND decision_type = 'accept' AND deleted_at IS NULL`,
          [job.id, company_id]
        );
        const jobAccepted = jobAcceptedResult.rows[0]?.count || 0;

        const jobAcceptanceRate = jobSwipes > 0 ? (jobAccepted / jobSwipes) * 100 : 0;

        await analyticsPool.query(
          `INSERT INTO analytics_job_stats (company_id, job_id, total_reviewed, acceptance_rate)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (job_id) DO UPDATE SET
             total_reviewed = $3,
             acceptance_rate = $4`,
          [company_id, job.id, jobSwipes, parseFloat(jobAcceptanceRate.toFixed(2))]
        );
      }

      // Backfill recruiter profiles for this company
      const recruitersResult = await monolithPool.query(
        `SELECT DISTINCT user_id FROM decisions WHERE company_id = $1 AND deleted_at IS NULL LIMIT 1000`,
        [company_id]
      );

      for (const { user_id } of recruitersResult.rows) {
        const recruiterSwipesResult = await monolithPool.query(
          `SELECT COUNT(*) as count FROM decisions WHERE user_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [user_id, company_id]
        );
        const recruiterSwipes = recruiterSwipesResult.rows[0]?.count || 0;

        const recruiterAcceptedResult = await monolithPool.query(
          `SELECT COUNT(*) as count FROM decisions WHERE user_id = $1 AND company_id = $2 AND decision_type = 'accept' AND deleted_at IS NULL`,
          [user_id, company_id]
        );
        const recruiterAccepted = recruiterAcceptedResult.rows[0]?.count || 0;

        const recruiterAcceptanceRate = recruiterSwipes > 0 ? (recruiterAccepted / recruiterSwipes) * 100 : 0;

        const userResult = await monolithPool.query(
          `SELECT name, email FROM users WHERE id = $1 LIMIT 1`,
          [user_id]
        );
        const user = userResult.rows[0];

        await analyticsPool.query(
          `INSERT INTO analytics_recruiter_profile (company_id, user_id, name, email, swipes_count, accepted, acceptance_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id) DO UPDATE SET
             swipes_count = $5,
             accepted = $6,
             acceptance_rate = $7`,
          [company_id, user_id, user?.name || '', user?.email || '', recruiterSwipes, recruiterAccepted, parseFloat(recruiterAcceptanceRate.toFixed(2))]
        );
      }

      console.log(`  ✓ Backfilled company ${company_id}`);
    }

    console.log('Backfill complete!');
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  } finally {
    await analyticsPool.end();
    await monolithPool.end();
  }
}

backfillAnalytics();
