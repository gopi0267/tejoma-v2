import pg from 'pg';
import jwt from 'jsonwebtoken';

const { Client } = pg;

const JWT_SECRET = '4ae06877de86615cd38067bab4dc7e28bd2a6aa72e652b6d2c82a8ba27921327';

async function testMirrorEvents() {
  console.log('🧪 Testing Analytics Mirror Events...\n');

  const dbClient = new Client({
    host: 'localhost',
    port: 5432,
    database: 'tejoma_recruiting',
    user: 'postgres',
    password: '3268',
  });

  const analyticsClient = new Client({
    host: 'localhost',
    port: 5432,
    database: 'tejoma_analytics',
    user: 'postgres',
    password: '3268',
  });

  try {
    await dbClient.connect();
    await analyticsClient.connect();

    // Get a recruiter and candidate/job for testing
    const recruiterResult = await dbClient.query(`
      SELECT DISTINCT u.id, u.name, u.company_id
      FROM users u
      WHERE u.company_id = 1
      LIMIT 1
    `);

    const candidateResult = await dbClient.query(`
      SELECT id, name FROM candidates WHERE company_id = 1 LIMIT 1
    `);

    const jobResult = await dbClient.query(`
      SELECT id, title FROM jobs WHERE company_id = 1 LIMIT 1
    `);

    if (!recruiterResult.rows[0] || !candidateResult.rows[0] || !jobResult.rows[0]) {
      console.error('❌ Could not find test recruiter, candidate, or job');
      process.exit(1);
    }

    const recruiter = recruiterResult.rows[0];
    const candidate = candidateResult.rows[0];
    const job = jobResult.rows[0];

    console.log(`✓ Found test data:`);
    console.log(`  - Recruiter: ${recruiter.name}`);
    console.log(`  - Candidate: ${candidate.name}`);
    console.log(`  - Job: ${job.title}\n`);

    // Count current analytics records BEFORE creating new swipe
    const beforeCount = await analyticsClient.query(`
      SELECT COUNT(*) as count FROM analytics_recent_activity
      WHERE candidate_name = $1
    `, [candidate.name]);

    console.log(`📊 Analytics records BEFORE new swipe: ${beforeCount.rows[0].count}\n`);

    // Simulate a new swipe by directly inserting into the recruiting db
    // (In a real test, this would go through the API)
    const newSwipeResult = await dbClient.query(`
      INSERT INTO swipes
      (recruiter_id, candidate_id, job_id, action, match_score, timestamp, company_id)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      RETURNING id, match_score, timestamp
    `, [recruiter.id, candidate.id, job.id, 1, 65.5, 1]);

    const newSwipe = newSwipeResult.rows[0];
    console.log(`✓ Created new swipe:`);
    console.log(`  - Swipe ID: ${newSwipe.id}`);
    console.log(`  - Match Score: ${newSwipe.match_score}`);
    console.log(`  - Timestamp: ${newSwipe.timestamp}\n`);

    // Wait a moment for mirror event to fire
    console.log('⏳ Waiting for mirror event to fire (2 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if analytics was updated via mirror event
    const afterCount = await analyticsClient.query(`
      SELECT COUNT(*) as count FROM analytics_recent_activity
      WHERE swipe_id = $1
    `, [newSwipe.id]);

    if (afterCount.rows[0].count > 0) {
      console.log('\n✅ Mirror event worked! New swipe appeared in analytics_recent_activity\n');

      // Get the analytics record
      const record = await analyticsClient.query(`
        SELECT * FROM analytics_recent_activity WHERE swipe_id = $1
      `, [newSwipe.id]);

      console.log('📋 Analytics record:');
      console.log(JSON.stringify(record.rows[0], null, 2));
    } else {
      console.log('\n⚠️  Mirror event did NOT fire - new swipe not in analytics_recent_activity');
      console.log('    This could mean:');
      console.log('    1. Mirror event code is not sending data to analytics-service');
      console.log('    2. Analytics internal endpoint is not receiving/storing the data');
      console.log('    3. The fire-and-forget request is failing silently\n');

      // Check dashboard stats were updated instead
      const dashStats = await analyticsClient.query(`
        SELECT total_reviewed, matches_made FROM analytics_dashboard_cache
        WHERE company_id = $1
      `, [1]);

      if (dashStats.rows.length > 0) {
        console.log('But dashboard cache exists:', JSON.stringify(dashStats.rows[0]));
      }
    }

    // Verify overall analytics integrity
    console.log('\n\n🔍 Analytics Integrity Check:\n');

    const tables = await analyticsClient.query(`
      SELECT
        (SELECT COUNT(*) FROM analytics_dashboard_cache) as dashboard,
        (SELECT COUNT(*) FROM analytics_recent_activity) as recent_activity,
        (SELECT COUNT(*) FROM analytics_job_stats) as job_stats,
        (SELECT COUNT(*) FROM analytics_daily_trends) as trends,
        (SELECT COUNT(*) FROM analytics_recruiter_profile) as recruiter_profiles
    `);

    const counts = tables.rows[0];
    console.log('Analytics tables populated:');
    console.log(`  ✓ analytics_dashboard_cache: ${counts.dashboard} records`);
    console.log(`  ✓ analytics_recent_activity: ${counts.recent_activity} records`);
    console.log(`  ✓ analytics_job_stats: ${counts.job_stats} records`);
    console.log(`  ✓ analytics_daily_trends: ${counts.trends} records`);
    console.log(`  ✓ analytics_recruiter_profile: ${counts.recruiter_profiles} records`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await dbClient.end();
    await analyticsClient.end();
  }
}

testMirrorEvents();
