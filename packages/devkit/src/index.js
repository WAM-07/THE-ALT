// Local development helpers shared by scripts/dev.mjs, scripts/migrate.mjs and the test suites.
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Order matters: platform schemas reference core.
export const MIGRATION_SERVICES = ['core', 'altera', 'altar'];

/**
 * Starts a PostgreSQL server from npm-provided binaries. No Docker or system install needed.
 * The data directory is kept between runs.
 */
export async function startPostgres({ dataDir, port = 54320, user = 'alt', password = 'alt', quiet = true }) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const fresh = !existsSync(path.join(dataDir, 'PG_VERSION'));
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true,
    // Without this, initdb on Windows picks the system code page (e.g. WIN1252) and emoji or Urdu text fail.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // PostgreSQL 18 does disk I/O in separate worker processes by default. On Windows those can
    // outlive a server stopped in a hurry (a test run shutting down) and keep its port busy, so the
    // next run can't start. Doing I/O in the server itself avoids that and is plenty for development.
    postgresFlags: ['-c', 'io_method=sync'],
    onLog: quiet ? () => {} : console.log,
    onError: (e) => console.error('[postgres]', e?.toString?.() ?? e),
  });
  if (fresh) await server.initialise();
  await server.start();
  const adminUrl = `postgres://${user}:${password}@127.0.0.1:${port}/postgres`;
  return {
    adminUrl,
    urlFor: (db) => `postgres://${user}:${password}@127.0.0.1:${port}/${db}`,
    stop: () => server.stop(),
  };
}

export async function ensureDatabase(adminUrl, name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid database name: ${name}`);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    // Always UTF-8, whatever the cluster's default (clusters made before this fix may be WIN1252).
    if (!rowCount) await client.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  } finally {
    await client.end();
  }
}

export async function dropDatabase(adminUrl, name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid database name: ${name}`);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

/**
 * Applies services/<service>/migrations/*.sql in filename order, one transaction per file.
 * Applied files are recorded with a checksum; editing an applied file is an error.
 */
export async function runMigrations(databaseUrl, { repoRoot, services = MIGRATION_SERVICES, log = console.log } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.alt_migrations (
        service    text        NOT NULL,
        name       text        NOT NULL,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (service, name)
      )`);
    for (const service of services) {
      const dir = path.join(repoRoot, 'services', service === 'core' ? 'core' : `${service}-api`, 'migrations');
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      const { rows } = await client.query('SELECT name, checksum FROM public.alt_migrations WHERE service = $1', [service]);
      const done = new Map(rows.map((r) => [r.name, r.checksum]));
      for (const file of files) {
        const sql = readFileSync(path.join(dir, file), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        if (done.has(file)) {
          if (done.get(file) !== checksum) {
            throw new Error(`Migration ${service}/${file} was edited after it was applied. Add a new migration instead.`);
          }
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO public.alt_migrations (service, name, checksum) VALUES ($1, $2, $3)', [service, file, checksum]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          err.message = `Migration ${service}/${file} failed: ${err.message}`;
          throw err;
        }
        applied.push(`${service}/${file}`);
        log(`  applied ${service}/${file}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

/**
 * Secrets that development needs but nobody should have to invent by hand.
 * Generated once into .data/dev-secrets.json. Production must set these explicitly.
 */
export function loadDevSecrets(dataDir) {
  const file = path.join(dataDir, 'dev-secrets.json');
  let secrets = {};
  if (existsSync(file)) secrets = JSON.parse(readFileSync(file, 'utf8'));
  let changed = false;
  const ensure = (key, make) => {
    if (!secrets[key]) {
      secrets[key] = make();
      changed = true;
    }
  };
  ensure('CORE_JWT_PRIVATE_KEY', () =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey,
  );
  ensure('CORE_ENCRYPTION_KEY', () => randomBytes(32).toString('base64'));
  ensure('INTERNAL_SERVICE_KEY', () => randomBytes(32).toString('base64url'));
  if (changed) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(secrets, null, 2));
  }
  return secrets;
}

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). Existing process env wins. */
export function loadEnvFile(file, target = process.env) {
  if (!existsSync(file)) return {};
  const parsed = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, '\n');
    }
    parsed[key] = value;
    if (target[key] === undefined) target[key] = value;
  }
  return parsed;
}

/** Hardhat's well-known development account #1 (relayer in dev and tests). Never holds real funds. */
export const LOCAL_RELAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

async function rpcReady(url) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts a throwaway local blockchain and deploys the ALT contracts to it.
 * `network` must be a Hardhat network in packages/contracts/hardhat.config.ts pointing at `port`.
 */
export async function startLocalChain({ repoRoot, port = 8546, network = 'testchain' }) {
  const { spawn, spawnSync } = await import('node:child_process');
  const contractsDir = path.join(repoRoot, 'packages', 'contracts');
  const cli = path.join(repoRoot, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js');
  const rpcUrl = `http://127.0.0.1:${port}`;
  if (!existsSync(path.join(contractsDir, 'artifacts', 'contracts', 'AITRegistry.sol'))) {
    const built = spawnSync(process.execPath, [cli, 'build'], { cwd: contractsDir, encoding: 'utf8' });
    if (built.status !== 0) throw new Error(`Contracts did not compile:\n${built.stdout}\n${built.stderr}`);
  }
  if (await rpcReady(rpcUrl)) throw new Error(`Something is already listening on ${rpcUrl}`);
  const child = spawn(process.execPath, [cli, 'node', '--port', String(port)], { cwd: contractsDir, stdio: 'ignore' });
  for (let i = 0; i < 120 && !(await rpcReady(rpcUrl)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await rpcReady(rpcUrl))) {
    child.kill();
    throw new Error('Local chain did not start');
  }
  const deploy = spawnSync(process.execPath, [cli, 'run', 'scripts/deploy.ts', '--network', network], { cwd: contractsDir, encoding: 'utf8' });
  const line = (deploy.stdout || '').split(/\r?\n/).find((l) => l.startsWith('ALT_DEPLOYMENT '));
  if (deploy.status !== 0 || !line) {
    child.kill();
    throw new Error(`Contract deployment failed:\n${deploy.stdout}\n${deploy.stderr}`);
  }
  const deployment = JSON.parse(line.slice('ALT_DEPLOYMENT '.length));
  const stop = async () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  };
  return { rpcUrl, deployment, relayerPrivateKey: LOCAL_RELAYER_KEY, stop };
}
