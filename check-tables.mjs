import pg from 'pg';

const { Client } = pg;

async function checkTables() {
  const databases = [
    'tejoma_recruiting',
    'tejoma_matching_decision',
    'tejoma_candidate_core',
    'tejoma_job',
  ];

  for (const dbname of databases) {
    const client = new Client({
      host: 'localhost',
      port: 5432,
      database: dbname,
      user: 'postgres',
      password: '3268',
    });

    try {
      await client.connect();
      const result = await client.query(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `);

      console.log(`\n📊 ${dbname}:`);
      result.rows.forEach(row => console.log(`  - ${row.tablename}`));

    } catch (error) {
      console.error(`❌ Error querying ${dbname}:`, error.message);
    } finally {
      await client.end();
    }
  }
}

checkTables();
