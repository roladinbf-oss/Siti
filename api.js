const express = require('express');
const db = require('./db');

// Whitelist of tables exposed via /api/:table. Anything not in this set returns 404.
const TABLES = new Set([
  'dough_usage',
  'expenses',
  'fixed_workers',
  'ingredient_aliases',
  'ingredients',
  'invoices',
  'labor_log',
  'packaging_rules',
  'production_log',
  'production_logs',
  'purchase_orders',
  'recipes',
  'sales_log',
  'scan_corrections',
  'stock_audits',
  'suppliers',
]);

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// pg doesn't auto-serialize JS objects/arrays for jsonb columns — do it here.
function pgVal(v) {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

const OP_MAP = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

// PostgREST-style: value = "eq.foo" / "gte.5" / "is.null" / "in.(a,b)"
function parseFilter(rawValue) {
  const dot = rawValue.indexOf('.');
  if (dot === -1) return null;
  const op = rawValue.slice(0, dot);
  const val = rawValue.slice(dot + 1);
  if (op === 'is') {
    if (val === 'null') return { sql: 'IS NULL', value: undefined };
    if (val === 'not.null') return { sql: 'IS NOT NULL', value: undefined };
    return null;
  }
  if (op === 'in') {
    // expect "(a,b,c)" — strip parens, split
    const inner = val.replace(/^\(/, '').replace(/\)$/, '');
    const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
    return { sql: 'IN', value: parts };
  }
  const sqlOp = OP_MAP[op];
  if (!sqlOp) return null;
  return { sql: sqlOp, value: val };
}

function buildWhere(query, startParamIdx = 1) {
  const clauses = [];
  const params = [];
  let pIdx = startParamIdx;
  for (const [key, raw] of Object.entries(query)) {
    if (['order', 'limit', 'offset', 'select'].includes(key)) continue;
    if (!IDENT_RE.test(key)) {
      throw new Error(`Invalid column name: ${key}`);
    }
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      const f = parseFilter(v);
      if (!f) throw new Error(`Invalid filter for ${key}: ${v}`);
      if (f.sql === 'IS NULL' || f.sql === 'IS NOT NULL') {
        clauses.push(`"${key}" ${f.sql}`);
      } else if (f.sql === 'IN') {
        const placeholders = f.value.map(() => `$${pIdx++}`).join(', ');
        clauses.push(`"${key}" IN (${placeholders})`);
        params.push(...f.value);
      } else {
        clauses.push(`"${key}" ${f.sql} $${pIdx++}`);
        params.push(f.value);
      }
    }
  }
  return {
    sql: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '',
    params,
    nextIdx: pIdx,
  };
}

function buildOrder(orderRaw) {
  if (!orderRaw) return '';
  const parts = String(orderRaw).split(',').map((s) => s.trim()).filter(Boolean);
  const fragments = [];
  for (const part of parts) {
    const [col, dir] = part.split('.');
    if (!IDENT_RE.test(col)) throw new Error(`Invalid order column: ${col}`);
    const direction = dir && dir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    fragments.push(`"${col}" ${direction}`);
  }
  return fragments.length ? 'ORDER BY ' + fragments.join(', ') : '';
}

function buildLimit(limitRaw) {
  if (!limitRaw) return '';
  const n = parseInt(limitRaw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid limit');
  return `LIMIT ${n}`;
}

function checkTable(req, res, next) {
  if (!TABLES.has(req.params.table)) {
    return res.status(404).json({ error: 'Unknown table' });
  }
  next();
}

const router = express.Router();

// GET /api/:table
router.get('/:table', checkTable, async (req, res) => {
  try {
    const t = req.params.table;
    const where = buildWhere(req.query);
    const order = buildOrder(req.query.order);
    const limit = buildLimit(req.query.limit);
    const sql = `SELECT * FROM "${t}" ${where.sql} ${order} ${limit}`.replace(/\s+/g, ' ').trim();
    const result = await db.query(sql, where.params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET error', err);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/:table — body: object or array of objects
router.post('/:table', checkTable, async (req, res) => {
  try {
    const t = req.params.table;
    const body = req.body;
    if (!body || (Array.isArray(body) && body.length === 0)) {
      return res.status(400).json({ error: 'Empty body' });
    }
    const rows = Array.isArray(body) ? body : [body];
    // collect superset of columns across all rows
    const colSet = new Set();
    for (const r of rows) Object.keys(r).forEach((k) => colSet.add(k));
    const cols = [...colSet];
    for (const c of cols) {
      if (!IDENT_RE.test(c)) throw new Error(`Invalid column: ${c}`);
    }
    const valuesSql = [];
    const params = [];
    let pIdx = 1;
    for (const r of rows) {
      const placeholders = cols.map((c) => {
        if (r[c] === undefined) return 'DEFAULT';
        params.push(pgVal(r[c]));
        return `$${pIdx++}`;
      });
      valuesSql.push(`(${placeholders.join(', ')})`);
    }
    const colsSql = cols.map((c) => `"${c}"`).join(', ');
    const sql = `INSERT INTO "${t}" (${colsSql}) VALUES ${valuesSql.join(', ')} RETURNING *`;
    const result = await db.query(sql, params);
    res.status(201).json(Array.isArray(body) ? result.rows : result.rows[0]);
  } catch (err) {
    console.error('POST error', err);
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/:table?filter — body: object with fields to update
router.patch('/:table', checkTable, async (req, res) => {
  try {
    const t = req.params.table;
    const updates = req.body || {};
    const cols = Object.keys(updates);
    if (cols.length === 0) {
      return res.status(400).json({ error: 'Empty body' });
    }
    for (const c of cols) {
      if (!IDENT_RE.test(c)) throw new Error(`Invalid column: ${c}`);
    }
    const setParts = [];
    const params = [];
    let pIdx = 1;
    for (const c of cols) {
      setParts.push(`"${c}" = $${pIdx++}`);
      params.push(pgVal(updates[c]));
    }
    const where = buildWhere(req.query, pIdx);
    if (!where.sql) {
      return res.status(400).json({ error: 'PATCH requires a filter' });
    }
    const sql = `UPDATE "${t}" SET ${setParts.join(', ')} ${where.sql} RETURNING *`;
    const result = await db.query(sql, params.concat(where.params));
    res.json(result.rows);
  } catch (err) {
    console.error('PATCH error', err);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/:table?filter
router.delete('/:table', checkTable, async (req, res) => {
  try {
    const t = req.params.table;
    const where = buildWhere(req.query);
    if (!where.sql) {
      return res.status(400).json({ error: 'DELETE requires a filter' });
    }
    const sql = `DELETE FROM "${t}" ${where.sql}`;
    await db.query(sql, where.params);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE error', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
