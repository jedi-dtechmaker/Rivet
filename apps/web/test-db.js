const { Pool } = require('pg');

const rawUrl = "postgresql://neondb_owner:npg_1UePkxz7imMF@ep-lucky-credit-b55ks03n-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const cleanUrl = rawUrl.replace('&channel_binding=require', '');

console.log("Testing connection with Neon serverless driver...");

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

async function test() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log("SUCCESS! Connected to Neon:", res.rows[0]);
  } catch (e) {
    console.error("CONNECTION FAILED:");
    console.error(e.message);
  } finally {
    await pool.end();
  }
}

test();
