import pg from 'pg';

const { Client } = pg;

async function checkSchema() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'tejoma_recruiting',
    user: 'postgres',
    password: '3268',
  });

  try {
    await client.connect();

    // Get users table schema
    const usersSchema = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    console.log('📊 users table schema:');
    usersSchema.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    // Get jobs table schema
    const jobsSchema = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'jobs'
      ORDER BY ordinal_position
    `);

    console.log('\n📊 jobs table schema:');
    jobsSchema.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkSchema();
