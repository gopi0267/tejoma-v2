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

    // Get swipes table schema
    const swipesSchema = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'swipes'
      ORDER BY ordinal_position
    `);

    console.log('📊 swipes table schema:');
    swipesSchema.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    // Sample some data
    const sample = await client.query('SELECT * FROM swipes LIMIT 3');
    console.log('\n📋 Sample swipes data:');
    if (sample.rows.length > 0) {
      console.log(JSON.stringify(sample.rows[0], null, 2));
    } else {
      console.log('  (no rows)');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkSchema();
