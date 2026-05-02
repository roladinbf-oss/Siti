const { Pool } = require('pg');

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
