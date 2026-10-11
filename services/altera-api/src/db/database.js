const { Pool } = require('pg');

/**
 * PostgreSQL pool for ALTERA. One database for the whole ecosystem: ALTERA's tables live in the
 * `altera` schema and people live in `core.users` (ALT Core). Every connection searches
 * altera first, so `users` resolves to the altera.users compatibility view.
 * Schema changes are migrations in services/altera-api/migrations, never created at start-up.
 */

const connectionString = process.env.DATABASE_URL;
// Hosted Postgres (Neon etc.) needs TLS; the local embedded database does not.
const needsSsl = /sslmode=require|neon\.tech/.test(connectionString || '');

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', (client) => {
  client.query('SET search_path TO altera, core, public').catch((err) => {
    console.error('[DB] could not set search_path', err.message);
  });
});

pool.on('error', (err) => {
  console.error('[DB ERROR] Unexpected error on idle client', err);
});

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    if (process.env.DB_LOG_QUERIES === 'true') {
      console.log('[DB QUERY]', { text, duration: `${Date.now() - start}ms`, rows: result.rowCount });
    }
    return result;
  } catch (err) {
    console.error('[DB ERROR]', err.message, { text });
    throw err;
  }
}

async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function queryMany(text, params) {
  const result = await query(text, params);
  return result.rows;
}

/** Verifies connectivity and that migrations have been applied. */
async function initialize() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT to_regclass('altera.posts') IS NOT NULL AS ready`);
    if (!rows[0].ready) {
      throw new Error('ALTERA tables are missing. Run `npm run migrate` from the repository root.');
    }
    console.log('[DB INIT] Connected to PostgreSQL');
    return true;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end().catch((err) => console.error('[DB ERROR] Failed to close connection pool', err));
}

module.exports = {
  query,
  queryOne,
  queryMany,
  pool,
  initialize,
  close,
};
