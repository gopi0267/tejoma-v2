import pg from 'pg';
import https from 'https';

const { Client } = pg;

// Disable SSL verification for self-signed cert
const agent = new https.Agent({
  rejectUnauthorized: false,
});

async function testAnalyticsApi() {
  console.log('🧪 Testing Analytics API with local data...\n');

  // Step 1: Get a valid recruiter from the database to generate JWT
  const dbClient = new Client({
    host: 'localhost',
    port: 5432,
    database: 'tejoma_recruiting',
    user: 'postgres',
    password: '3268',
  });

  try {
    await dbClient.connect();

    // Get a recruiter from the swipes table
    const recruiterResult = await dbClient.query(`
      SELECT DISTINCT u.id, u.email, u.name, u.company_id
      FROM swipes s
      JOIN users u ON s.recruiter_id = u.id
      WHERE u.company_id IS NOT NULL
      LIMIT 1
    `);

    if (recruiterResult.rows.length === 0) {
      console.error('❌ No recruiters found in database');
      process.exit(1);
    }

    const recruiter = recruiterResult.rows[0];
    console.log(`✓ Found recruiter: ${recruiter.name} (company_id: ${recruiter.company_id})\n`);

    // Step 2: Generate JWT token (same format as real auth)
    // In a real test, this would use the actual auth service, but for this test
    // we'll use a pre-generated token from docker logs or environment
    const token = process.env.TEST_JWT_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJjb21wYW55X2lkIjoxLCJlbWFpbCI6ImJqYW1lc0BnbWFpbC5jb20iLCJuYW1lIjoiQiBKYW1lcyIsInJvbGUiOiJyZWNydWl0ZXIifQ.8pHa2YrDW9Wy5_OlYmH7F7G6K8L9M0N1O2P3Q4R5S';

    console.log(`✓ Using JWT token\n`);

    // Step 3: Call analytics API through the gateway
    console.log('📊 Testing GET /api/analytics/dashboard...\n');

    const dashboardResponse = await fetch(
      'https://localhost/api/analytics/dashboard',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        agent,
      }
    );

    const dashboardData = await dashboardResponse.json();

    if (dashboardResponse.status === 200) {
      console.log('✅ Dashboard API returned 200\n');
      console.log('📋 Response data:');
      console.log(JSON.stringify(dashboardData, null, 2));

      // Check if data appears to be from local analytics (should have specific fields)
      if (dashboardData.total_reviewed !== undefined) {
        console.log('\n✅ Data appears to be from local analytics table (has total_reviewed field)');
      } else {
        console.log('\n⚠️  Data structure different from expected');
      }
    } else {
      console.error(`❌ Dashboard API returned ${dashboardResponse.status}`);
      console.error(dashboardData);
    }

    // Step 4: Verify analytics tables have data
    console.log('\n\n🔍 Verifying analytics tables have real data...\n');

    const analyticsClient = new Client({
      host: 'localhost',
      port: 5432,
      database: 'tejoma_analytics',
      user: 'postgres',
      password: '3268',
    });

    await analyticsClient.connect();

    const counts = await analyticsClient.query(`
      SELECT
        (SELECT COUNT(*) FROM analytics_dashboard_cache) as dashboard_count,
        (SELECT COUNT(*) FROM analytics_recent_activity) as recent_count,
        (SELECT COUNT(*) FROM analytics_job_stats) as job_stats_count,
        (SELECT COUNT(*) FROM analytics_daily_trends) as trends_count,
        (SELECT COUNT(*) FROM analytics_recruiter_profile) as recruiter_count
    `);

    const data = counts.rows[0];
    console.log('Analytics table record counts:');
    console.log(`  • analytics_dashboard_cache: ${data.dashboard_count}`);
    console.log(`  • analytics_recent_activity: ${data.recent_count}`);
    console.log(`  • analytics_job_stats: ${data.job_stats_count}`);
    console.log(`  • analytics_daily_trends: ${data.trends_count}`);
    console.log(`  • analytics_recruiter_profile: ${data.recruiter_count}`);

    if (data.dashboard_count > 0) {
      console.log('\n✅ Analytics tables have real data!');
    } else {
      console.log('\n⚠️  Analytics tables are empty');
    }

    await analyticsClient.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await dbClient.end();
  }
}

testAnalyticsApi();
