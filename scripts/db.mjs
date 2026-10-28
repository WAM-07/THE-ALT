#!/usr/bin/env node
// A read-only look into ALT's database, for showing it live (evaluations) and for debugging.
// Start the system first (`npm run demo` or `npm run dev`), then in a second terminal:
//
//   npm run db                              every schema and table, with row counts
//   npm run db -- describe core.users       one table: columns, keys, references, indexes
//   npm run db -- rows core.personal_ais 5  its newest rows (secrets and vectors hidden)
//   npm run db -- views                     the views (altera.users, altar.rentals)
//   npm run db -- migrations                which migration files have been applied
//   npm run db -- sql "SELECT ..."          any query, in a read-only transaction
//
// Options: --db alt_demo | alt (default: the one the running services use), --url postgres://...
// Nothing here can change data: every query runs in a READ ONLY transaction with a 10 s limit.
import pg from 'pg';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const port = process.env.DEV_POSTGRES_PORT || 54320;
const base = (db) => `postgres://alt:alt@127.0.0.1:${port}/${db}`;
const urlArg = opt('url');
const dbArg = opt('db');
const [command = 'tables', ...rest] = argv;

// Columns never printed: password hashes, encrypted keys and secrets, token hashes.
const SECRET = /(password_hash|private_key_enc|_secret_enc|refresh_hash|code_hash|^hash$|^prev_hash$)/;

async function connect() {
  if (urlArg || process.env.DATABASE_URL) return { url: urlArg || process.env.DATABASE_URL, name: 'DATABASE_URL' };
  if (dbArg) return { url: base(dbArg), name: dbArg };
  const probe = new pg.Client({ connectionString: base('postgres') });
  try {
    await probe.connect();
  } catch {
    console.error(`Can't reach the database on 127.0.0.1:${port}. Start ALT first: npm run demo (or npm run dev).`);
    process.exit(1);
  }
  // The database the running services are connected to (npm run demo: alt_demo; npm run dev: alt).
  const { rows } = await probe.query(
    `SELECT d.datname, (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS connections
       FROM pg_database d WHERE d.datname IN ('alt_demo', 'alt') ORDER BY connections DESC, d.datname DESC`,
  );
  await probe.end();
  const name = rows[0]?.datname ?? 'alt';
  return { url: base(name), name };
}

function show(rows) {
  if (!rows.length) return console.log('(no rows)');
  const clean = rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => {
        if (SECRET.test(k) && v != null) return [k, '[hidden]'];
        if (Array.isArray(v) && v.length > 12 && typeof v[0] === 'number') return [k, `[${v.length} numbers]`];
        if (v instanceof Date) return [k, v.toISOString().replace('T', ' ').slice(0, 19)];
        if (v && typeof v === 'object') v = JSON.stringify(v);
        const s = String(v ?? '');
        return [k, s.length > 60 ? `${s.slice(0, 57)}...` : v];
      }),
    ),
  );
  console.table(clean);
}

const { url, name } = await connect();
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('BEGIN TRANSACTION READ ONLY');
await client.query(`SET LOCAL statement_timeout = '10s'`);
const q = (text, values) => client.query(text, values);
console.log(`database: ${name}\n`);

try {
  if (command === 'tables') {
    const { rows } = await q(
      `SELECT n.nspname AS schema, c.relname AS table, c.reltuples::bigint AS approx_rows,
              obj_description(c.oid) AS comment
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname IN ('core', 'altera', 'altar') ORDER BY 1, 2`,
    );
    // Exact counts (small database): reltuples is only an estimate.
    for (const r of rows) r.rows = Number((await q(`SELECT count(*) FROM ${r.schema}."${r.table}"`)).rows[0].count);
    show(rows.map(({ schema, table, rows: n }) => ({ schema, table, rows: n })));
    console.log(`${rows.length} tables in 3 schemas. Next: npm run db -- describe core.users`);
  } else if (command === 'describe') {
    const [schema, table] = (rest[0] ?? '').split('.');
    if (!schema || !table) throw new Error('Usage: npm run db -- describe <schema>.<table>, e.g. core.users');
    show(
      (
        await q(
          `SELECT column_name AS column, data_type AS type, is_nullable AS nullable, column_default AS "default"
             FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
          [schema, table],
        )
      ).rows,
    );
    console.log('Keys and checks:');
    show(
      (
        await q(
          `SELECT conname AS name, CASE contype WHEN 'p' THEN 'primary key' WHEN 'f' THEN 'foreign key' WHEN 'u' THEN 'unique'
                  WHEN 'c' THEN 'check' ELSE contype::text END AS kind, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint WHERE conrelid = $1::regclass AND contype <> 'n' ORDER BY contype, conname`,
          [`${schema}.${table}`],
        )
      ).rows,
    );
    console.log('Referenced by:');
    show(
      (
        await q(
          `SELECT conrelid::regclass AS from_table, conname AS name, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint WHERE confrelid = $1::regclass ORDER BY 1`,
          [`${schema}.${table}`],
        )
      ).rows,
    );
    console.log('Indexes:');
    show((await q(`SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`, [schema, table])).rows);
  } else if (command === 'rows') {
    const [schema, table] = (rest[0] ?? '').split('.');
    if (!schema || !table) throw new Error('Usage: npm run db -- rows <schema>.<table> [how many]');
    const limit = Math.min(Number(rest[1] ?? 10) || 10, 100);
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [schema, table])).rows.map((r) => r.column_name);
    if (!cols.length) throw new Error(`No table ${schema}.${table}`);
    const order = ['created_at', 'occurred_at', 'id', 'ran_at', 'updated_at'].find((c) => cols.includes(c));
    show((await q(`SELECT * FROM ${schema}."${table}"${order ? ` ORDER BY "${order}" DESC` : ''} LIMIT ${limit}`)).rows);
  } else if (command === 'views') {
    show((await q(`SELECT schemaname AS schema, viewname AS view, definition FROM pg_views WHERE schemaname IN ('core', 'altera', 'altar')`)).rows);
  } else if (command === 'migrations') {
    const { rows } = await q(`SELECT * FROM public.alt_migrations ORDER BY 1`);
    show(rows);
  } else if (command === 'sql') {
    const text = rest.join(' ');
    if (!text) throw new Error('Usage: npm run db -- sql "SELECT ..."');
    show((await q(text)).rows);
  } else {
    throw new Error(`Unknown command "${command}". Try: tables, describe, rows, views, migrations, sql.`);
  }
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
