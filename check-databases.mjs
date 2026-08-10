import pg from 'pg';

const { Client } = pg;

async function checkDatabases() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: '3268',
  });

  try {
    await client.connect();
    const result = await client.query(`
      SELECT datname FROM pg_database
      WHERE datname NOT IN ('postgres', 'template0', 'template1')
      ORDER BY datname
    `);

    console.log('Available databases:');
    result.rows.forEach(row => console.log(`  - ${row.datname}`));

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

checkDatabases();
