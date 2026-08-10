import pg from 'pg';
import jwt from 'jsonwebtoken';
import https from 'https';

const { Client } = pg;

// Disable SSL verification for self-signed cert
const agent = new https.Agent({
  rejectUnauthorized: false,
});

const JWT_SECRET = 'dev-only-insecure-secret'; // matching app config

async function testAnalyticsWithJWT() {
  console.log('🧪 Testing Analytics API with real JWT token...\n');

  const dbClient = new Client({
    host: 'localhost',
    port: 5432,
    database: 'tejoma_recruiting',
    user: 'postgres',
    password: '3268',
  });

  try {
    await dbClient.connect();

    // Get a recruiter who has made swipes
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
    console.log(`✓ Found recruiter: ${recruiter.name} (ID: ${recruiter.id}, company_id: ${recruiter.company_id})\n`);

    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: recruiter.id,
        company_id: recruiter.company_id,
        email: recruiter.email,
        name: recruiter.name,
        role: 'recruiter',
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✓ Generated JWT token\n`);

    // Test analytics API
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
      console.log(`✅ Dashboard API returned ${dashboardResponse.status}\n`);
      console.log('📋 Response data:');
      console.log(JSON.stringify(dashboardData, null, 2));

      // Verify this is local analytics data
      if (dashboardData.total_reviewed !== undefined) {
        console.log('\n✅ Response contains analytics data (total_reviewed field)');
        console.log(`   Total candidates reviewed: ${dashboardData.total_reviewed}`);
        if (dashboardData.trends) {
          console.log(`   Trends available: ${dashboardData.trends.length} records`);
        }
      }
    } else {
      console.error(`❌ Dashboard API returned ${dashboardResponse.status}`);
      console.error(JSON.stringify(dashboardData, null, 2));
    }

    // Test recruiter profile API
    console.log('\n\n👤 Testing GET /api/analytics/recruiter/me...\n');

    const profileResponse = await fetch(
      'https://localhost/api/analytics/recruiter/me',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        agent,
      }
    );

    const profileData = await profileResponse.json();

    if (profileResponse.status === 200) {
      console.log(`✅ Recruiter profile API returned ${profileResponse.status}\n`);
      console.log('📋 Response data:');
      console.log(JSON.stringify(profileData, null, 2));
    } else {
      console.error(`❌ Recruiter profile API returned ${profileResponse.status}`);
    }

    // Verify analytics tables
    console.log('\n\n🔍 Verifying analytics database state...\n');

    const analyticsClient = new Client({
      host: 'localhost',
      port: 5432,
      database: 'tejoma_analytics',
      user: 'postgres',
      password: '3268',
    });

    await analyticsClient.connect();

    const sample = await analyticsClient.query(`
      SELECT total_reviewed, matches_made, avg_score, acceptance_rate
      FROM analytics_dashboard_cache
      WHERE company_id = $1
      LIMIT 1
    `, [recruiter.company_id]);

    if (sample.rows.length > 0) {
      console.log(`✅ Found analytics data for company ${recruiter.company_id}:`);
      console.log(JSON.stringify(sample.rows[0], null, 2));
    } else {
      console.log(`⚠️  No analytics data found for company ${recruiter.company_id}`);
    }

    await analyticsClient.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await dbClient.end();
  }
}

testAnalyticsWithJWT();
