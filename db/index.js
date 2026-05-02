const { Pool, types } = require('pg');

// Match Supabase REST behaviour: return bigint and numeric as JS numbers, not
// strings. Safe for this dataset (row counts and prices are well within
// Number.MAX_SAFE_INTEGER).
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));   // int8 / bigint
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));   // numeric

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set');
  process.exit(1);
}

const needsSSL = !/(localhost|127\.0\.0\.1|\.railway\.internal)/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
