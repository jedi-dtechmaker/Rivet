require('dotenv').config({ path: './apps/web/.env' });
const { Pool } = require('pg');

const rawUrl = process.env.DATABASE_URL || '';
console.log("Raw URL:", rawUrl);

const cleanUrl = rawUrl.split('?')[0];
console.log("Clean URL:", cleanUrl);

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

async function test() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log("Connection successful:", res.rows[0]);
  } catch (e) {
    console.error("Connection failed:", e);
  } finally {
    await pool.end();
  }
}

test();
