#!/usr/bin/env node
// THE ALT ECOSYSTEM: one command to run everything locally.
//
//   npm run dev                 start database, migrations and every service behind http://localhost:8080
//   npm run dev -- --reset-db   wipe the local database first
//   npm run demo                the demo, as it was left last time (built from the demo story the first time)
//   npm run demo -- --fresh     rebuild the demo from the demo story
//
// Works on Windows, macOS and Linux. Needs only Node.js 22+.
import { ensureDatabase, dropDatabase, loadDevSecrets, loadEnvFile, runMigrations, startPostgres } from '@alt/devkit';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DEMO_ADMIN_EMAIL, DEMO_PASSWORD, DEMO_PEOPLE, seedDemo } from './seed-demo.mjs';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { readJournal, recordBlocks, replayJournal, rpc as chainRpc, startJournal, updateMeta } from './chain/journal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.data');
const args = new Set(process.argv.slice(2));
const require = createRequire(import.meta.url);

const colors = { core: 36, gateway: 35, altera: 33, altar: 32, 'altar-web': 92, command: 96, postgres: 34, chain: 94, dev: 37 };
const tag = (name) => `\x1b[${colors[name] ?? 37}m${name.padEnd(8)}\x1b[0m`;
const say = (msg) => console.log(`${tag('dev')} ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
};

// ---------------------------------------------------------------- 1. prerequisites
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Node.js 22 or newer is required (you have ${process.versions.node}). Install it from https://nodejs.org`);
if (!existsSync(path.join(root, 'node_modules'))) fail('Dependencies are missing. Run `npm install` in the repository root first.');

// ---------------------------------------------------------------- 2. configuration
const envFile = path.join(root, '.env');
if (!existsSync(envFile)) {
  copyFileSync(path.join(root, '.env.example'), envFile);
  say('created .env from .env.example');
}
loadEnvFile(envFile);
const blank = (k) => !process.env[k] || process.env[k].trim() === '';
for (const [k, v] of Object.entries(loadDevSecrets(dataDir))) if (blank(k)) process.env[k] = v;
process.env.NODE_ENV ||= 'development';

// `npm run demo`: the same system on its own database (alt_demo), filled with the demo story the first
// time. It keeps everything between runs, database and blockchain, so accounts, posts, reports and
// decisions made while preparing an evaluation are still there; `--fresh` rebuilds it from the story.
// Your everyday data in the `alt` database is never touched.
const demo = args.has('--demo');
const fresh = args.has('--fresh');
const demoMeta = path.join(dataDir, 'demo-chain.json');
const demoBlocks = path.join(dataDir, 'demo-chain.jsonl');
const saved = demo && !fresh ? readJournal(demoMeta, demoBlocks) : null;
// The contracts a saved demo chain was deployed from; if they change, the saved chain no longer fits.
const contractsHash = () => {
  const dir = path.join(root, 'packages', 'contracts', 'contracts');
  const h = createHash('sha256');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sol')).sort()) h.update(f).update(readFileSync(path.join(dir, f)));
  return h.digest('hex');
};
let keepDemo = false;
const dbName = demo ? 'alt_demo' : 'alt';
if (demo) process.env.ADMIN_EMAILS = [process.env.ADMIN_EMAILS, DEMO_ADMIN_EMAIL].filter(Boolean).join(',');
process.env.STORAGE_DIR ||= path.join(dataDir, 'uploads');

const ports = {
  gateway: Number(process.env.GATEWAY_PORT || 8080),
  core: Number(process.env.CORE_PORT || 4000),
  altera: Number(process.env.ALTERA_PORT || 4100),
  altar: Number(process.env.ALTAR_PORT || 4200),
  altarWeb: Number(process.env.ALTAR_WEB_PORT || 4300),
  command: Number(process.env.COMMAND_PORT || 4400),
};
process.env.ALT_PUBLIC_URL ||= `http://localhost:${ports.gateway}`;

// A second `npm run dev` would fight the first one for the ports and the database files.
const portInUse = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer().once('error', () => resolve(true)).once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '0.0.0.0');
  });
const busy = [];
for (const [name, port] of [['gateway', ports.gateway], ['ALT Core', ports.core], ['ALTERA API', ports.altera], ['ALTAR API', ports.altar], ['ALTAR web', ports.altarWeb], ['database', Number(process.env.DEV_POSTGRES_PORT || 54320)]]) {
  if (await portInUse(port)) busy.push(`${name} (port ${port})`);
}
if (busy.length) {
  fail(`THE ALT already seems to be running: ${busy.join(', ')} in use. Stop the other "npm run dev" (Ctrl+C in its window) and try again.`);
}

// ---------------------------------------------------------------- 3. database
let postgres = null;
if (blank('DATABASE_URL')) {
  say('starting embedded PostgreSQL (first run downloads nothing; binaries come from npm)…');
  try {
    postgres = await startPostgres({ dataDir: path.join(dataDir, 'postgres'), port: Number(process.env.DEV_POSTGRES_PORT || 54320) });
  } catch (err) {
    // Usually an earlier run that didn't shut down cleanly still holds the database files.
    fail(`The embedded database did not start${err?.message ? ` (${err.message})` : ''}. An earlier run may still be open: close its window, or end the leftover "postgres.exe" and "node scripts/dev.mjs" processes in Task Manager, then run it again.`);
  }
  if (demo) {
    const pg = (await import('pg')).default;
    const admin = new pg.Client({ connectionString: postgres.adminUrl });
    await admin.connect();
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rowCount > 0;
    await admin.end();
    keepDemo = Boolean(saved?.meta.ready) && exists && (process.env.CHAIN_MODE || 'local').toLowerCase() === 'local';
    if (keepDemo && saved.meta.contracts !== contractsHash()) {
      await postgres.stop();
      fail('The smart contracts changed since this demo was saved, so its saved chain no longer fits. Run `npm run demo -- --fresh` to rebuild the demo (this replaces it).');
    }
    if (keepDemo) say(`demo kept from last time (saved ${new Date(saved.meta.readyAt ?? saved.meta.createdAt).toLocaleString()}); \`npm run demo -- --fresh\` rebuilds it`);
    else {
      await dropDatabase(postgres.adminUrl, dbName);
      say(fresh ? 'demo database (alt_demo) rebuilt from scratch' : 'no saved demo yet: building one (alt_demo)');
    }
  } else if (args.has('--reset-db')) {
    await dropDatabase(postgres.adminUrl, dbName);
    say('local database wiped');
  }
  await ensureDatabase(postgres.adminUrl, dbName);
  process.env.DATABASE_URL = postgres.urlFor(dbName);
} else if (args.has('--reset-db') || demo) {
  fail(`${demo ? 'npm run demo' : '--reset-db'} only works with the embedded database (DATABASE_URL is set in .env), so it can never wipe a real one.`);
}

say('applying migrations…');
try {
  const applied = await runMigrations(process.env.DATABASE_URL, { repoRoot: root, log: (m) => say(m.trim()) });
  if (!applied.length) say('database is up to date');
} catch (err) {
  await postgres?.stop();
  fail(err.message);
}

// ---------------------------------------------------------------- 3b. blockchain
// CHAIN_MODE=local (default): a throwaway Hardhat chain on :8545 with freshly deployed contracts.
// CHAIN_MODE=amoy: Polygon Amoy; addresses come from packages/contracts/deployments/amoy.json and
// RELAYER_PRIVATE_KEY / CHAIN_RPC_URL from .env.
const chainMode = (process.env.CHAIN_MODE || 'local').toLowerCase();
const contractsDir = path.join(root, 'packages', 'contracts');
const hardhatCli = path.join(root, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js');
// Hardhat's well-known development account #1. It only ever exists on the local chain.
const LOCAL_RELAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
// Hardhat's development account #0: it deploys the contracts, so it holds the registry's GOVERNOR_ROLE
// (the ALT Command Centre suspends AIs with it). It only ever exists on the local chain.
const LOCAL_GOVERNOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
let chainProcess = null;
let recorder = null;

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

function applyDeployment(d) {
  process.env.CHAIN_ID ||= String(d.chainId);
  process.env.AIT_REGISTRY_ADDRESS ||= d.registry;
  process.env.ALT_MARKETPLACE_ADDRESS ||= d.marketplace;
  process.env.CHAIN_DEPLOYED_AT_BLOCK ||= String(d.deployedAtBlock ?? 0);
}

if (chainMode === 'local') {
  if (!existsSync(path.join(contractsDir, 'artifacts', 'contracts', 'AITRegistry.sol'))) {
    say('compiling smart contracts (first run)…');
    const built = spawnSync(process.execPath, [hardhatCli, 'build'], { cwd: contractsDir, stdio: 'inherit' });
    if (built.status !== 0) fail('Smart contracts did not compile.');
  }
  const rpc = 'http://127.0.0.1:8545';
  if (await rpcReady(rpc)) {
    if (demo) fail('Another blockchain is already running on :8545. Stop it: the demo starts its own, from where it was saved.');
    say('a local chain is already running on :8545; reusing it');
  } else {
    say('starting local blockchain (Hardhat) on :8545…');
    // The demo's chain can start on its saved date (scripts/chain/hardhat.config.mjs), so its blocks replay at their original times.
    const cmd = demo ? [hardhatCli, '--config', path.join(root, 'scripts', 'chain', 'hardhat.config.mjs'), 'node'] : [hardhatCli, 'node'];
    chainProcess = spawn(process.execPath, cmd, {
      cwd: contractsDir,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...(keepDemo ? { ALT_CHAIN_INITIAL_DATE: String(saved.meta.genesisTs) } : {}) },
    });
    readline.createInterface({ input: chainProcess.stderr }).on('line', (l) => console.log(`${tag('chain')} ${l}`));
    for (let i = 0; i < 120 && !(await rpcReady(rpc)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await rpcReady(rpc))) fail('The local blockchain did not start.');
  }
  let d;
  if (keepDemo) {
    say(`replaying the saved demo chain (${saved.blocks.length} blocks)…`);
    try {
      await replayJournal(rpc, saved.blocks, say);
    } catch (err) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(chainProcess.pid), '/T', '/F'], { stdio: 'ignore' });
      else chainProcess.kill('SIGTERM');
      await postgres?.stop().catch(() => {});
      fail(`The saved demo chain could not be replayed: ${err.message}. Run \`npm run demo -- --fresh\` to rebuild the demo.`);
    }
    d = saved.meta.deployment;
    recorder = recordBlocks(rpc, demoBlocks, saved.blocks.length + 1, say);
    // Bring the chain's clock from the last saved block to now (this block is saved too).
    const last = saved.blocks.at(-1)?.ts ?? saved.meta.genesisTs;
    await chainRpc(rpc, 'evm_mine', [Math.max(Math.floor(Date.now() / 1000), last + 1)]);
  } else {
    say('deploying AITRegistry and ALTMarketplace…');
    const deploy = spawnSync(process.execPath, [hardhatCli, 'run', 'scripts/deploy.ts', '--network', 'localhost'], {
      cwd: contractsDir,
      encoding: 'utf8',
    });
    const line = (deploy.stdout || '').split(/\r?\n/).find((l) => l.startsWith('ALT_DEPLOYMENT '));
    if (deploy.status !== 0 || !line) fail(`Contract deployment failed:
${deploy.stdout}
${deploy.stderr}`);
    d = JSON.parse(line.slice('ALT_DEPLOYMENT '.length));
    if (demo) {
      // A new saved demo: every block from here on is written down as it is mined.
      const genesis = await chainRpc(rpc, 'eth_getBlockByNumber', ['0x0', false]);
      startJournal(demoMeta, demoBlocks, { version: 1, genesisTs: Number(genesis.timestamp), contracts: contractsHash(), deployment: d, createdAt: new Date().toISOString(), ready: false });
      recorder = recordBlocks(rpc, demoBlocks, 1, say);
    }
  }
  process.env.CHAIN_RPC_URL = rpc;
  process.env.CHAIN_NAME = 'ALT local chain';
  process.env.CHAIN_EXPLORER_URL = ''; // no public explorer for a local chain
  process.env.RELAYER_PRIVATE_KEY ||= LOCAL_RELAYER_KEY;
  process.env.GOVERNOR_PRIVATE_KEY ||= LOCAL_GOVERNOR_KEY;
  for (const k of ['CHAIN_ID', 'AIT_REGISTRY_ADDRESS', 'ALT_MARKETPLACE_ADDRESS', 'CHAIN_DEPLOYED_AT_BLOCK']) delete process.env[k];
  applyDeployment(d);
  say(`contracts: registry ${d.registry} · marketplace ${d.marketplace}`);
} else if (chainMode === 'amoy') {
  const file = path.join(contractsDir, 'deployments', 'amoy.json');
  if (!existsSync(file)) fail('CHAIN_MODE=amoy but packages/contracts/deployments/amoy.json is missing. Deploy first: npm run deploy:amoy -w @alt/contracts');
  applyDeployment(JSON.parse(readFileSync(file, 'utf8')));
  process.env.CHAIN_NAME ||= 'Polygon Amoy';
  process.env.CHAIN_EXPLORER_URL ||= 'https://amoy.polygonscan.com';
  if (blank('CHAIN_RPC_URL') || blank('RELAYER_PRIVATE_KEY')) fail('CHAIN_MODE=amoy needs CHAIN_RPC_URL and RELAYER_PRIVATE_KEY in .env');
} else if (chainMode !== 'off') {
  fail(`Unknown CHAIN_MODE "${chainMode}" (use local, amoy or off).`);
}

// ---------------------------------------------------------------- 4. app config for the Flutter apps
const lanIp = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254'))?.address;
for (const app of ['alter', 'altera']) {
  const dir = path.join(root, 'apps', app);
  if (!existsSync(dir)) continue;
  mkdirSync(path.join(dir, 'env'), { recursive: true });
  // Android emulators reach the host PC at 10.0.2.2; real phones need the LAN address.
  writeFileSync(
    path.join(dir, 'env', 'dev.json'),
    JSON.stringify(
      {
        ALT_API_URL: `http://10.0.2.2:${ports.gateway}`,
        ALT_API_URL_DEVICE: lanIp ? `http://${lanIp}:${ports.gateway}` : '',
        ALT_PLATFORM: app,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------- 5. services
const tsx = require.resolve('tsx/cli');
const services = [
  {
    name: 'core',
    cwd: path.join(root, 'services', 'core'),
    cmd: [process.execPath, tsx, 'watch', '--clear-screen=false', 'src/index.ts'],
    // Core asks ALTERA and ALTAR to remove content when staff decide it (their /internal routes).
    env: { CORE_PORT: String(ports.core), ALTERA_SERVICE_URL: `http://127.0.0.1:${ports.altera}`, ALTAR_SERVICE_URL: `http://127.0.0.1:${ports.altar}` },
    health: `http://127.0.0.1:${ports.core}/health`,
  },
  {
    name: 'gateway',
    cwd: path.join(root, 'services', 'gateway'),
    cmd: [process.execPath, tsx, 'watch', '--clear-screen=false', 'src/index.ts'],
    env: {
      GATEWAY_PORT: String(ports.gateway),
      CORE_URL: `http://127.0.0.1:${ports.core}`,
      ...(existsSync(path.join(root, 'services', 'altera-api', 'migrations')) ? { ALTERA_URL: `http://127.0.0.1:${ports.altera}` } : {}),
      ALTAR_URL: `http://127.0.0.1:${ports.altar}`,
      ALTAR_WEB_URL: `http://127.0.0.1:${ports.altarWeb}`,
      COMMAND_URL: `http://127.0.0.1:${ports.command}`,
    },
    health: `http://127.0.0.1:${ports.gateway}/health`,
  },
];
if (existsSync(path.join(root, 'services', 'altera-api', 'migrations'))) {
  services.push({
    name: 'altera',
    cwd: path.join(root, 'services', 'altera-api'),
    cmd: [process.execPath, '--watch-path=src', 'src/server.js'],
    env: { PORT: String(ports.altera) },
    health: `http://127.0.0.1:${ports.altera}/health`,
  });
}

// ALTAR API: listings, subscription prices and saved AIs (the altar schema). It reads the chain
// (CHAIN_RPC_URL and the contract addresses set above) but never signs: ALT Core holds the keys.
services.push({
  name: 'altar',
  cwd: path.join(root, 'services', 'altar-api'),
  cmd: [process.execPath, tsx, 'watch', '--clear-screen=false', 'src/index.ts'],
  env: { ALTAR_PORT: String(ports.altar), CORE_URL: `http://127.0.0.1:${ports.core}` },
  health: `http://127.0.0.1:${ports.altar}/health`,
});

// ALTAR web (Next.js) is the gateway's front page: http://localhost:8080/
services.push({
  name: 'altar-web',
  cwd: path.join(root, 'apps', 'altar-web'),
  cmd: [process.execPath, require.resolve('next/dist/bin/next'), 'dev', '-p', String(ports.altarWeb), '-H', '127.0.0.1'],
  env: { NEXT_TELEMETRY_DISABLED: '1', ALTAR_DEV_ORIGINS: ['localhost', '127.0.0.1', lanIp].filter(Boolean).join(',') },
  health: `http://127.0.0.1:${ports.altarWeb}/`,
});

// The ALT Command Centre (Next.js, staff only): http://localhost:8080/command
services.push({
  name: 'command',
  cwd: path.join(root, 'apps', 'command-centre'),
  cmd: [process.execPath, require.resolve('next/dist/bin/next'), 'dev', '-p', String(ports.command), '-H', '127.0.0.1'],
  env: { NEXT_TELEMETRY_DISABLED: '1', COMMAND_DEV_ORIGINS: ['localhost', '127.0.0.1', lanIp].filter(Boolean).join(',') },
  health: `http://127.0.0.1:${ports.command}/command`,
});

/** Turns pino JSON lines into short readable ones. */
function pretty(line) {
  if (!line.startsWith('{')) return line;
  try {
    const j = JSON.parse(line);
    const lvl = j.level >= 50 ? '\x1b[31mERROR\x1b[0m' : j.level >= 40 ? '\x1b[33mWARN \x1b[0m' : 'info ';
    if (j.req) return `${lvl} → ${j.req.method} ${j.req.url}`;
    if (j.res) return `${lvl} ← ${j.res.statusCode} ${Math.round(j.responseTime ?? 0)}ms`;
    return `${lvl} ${j.msg}${j.err ? `\n${j.err.stack ?? j.err.message}` : ''}`;
  } catch {
    return line;
  }
}

const children = [];
for (const s of services) {
  const child = spawn(s.cmd[0], s.cmd.slice(1), { cwd: s.cwd, env: { ...process.env, ...s.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on('line', (l) => {
      if (/"req":|"res":/.test(l) && !args.has('--verbose')) return; // request noise
      console.log(`${tag(s.name)} ${pretty(l)}`);
    });
  }
  child.on('exit', (code) => {
    if (!shuttingDown) console.log(`${tag(s.name)} \x1b[31mexited with code ${code}\x1b[0m`);
  });
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  say('stopping…');
  for (const c of children) {
    if (c.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  // Write the demo chain's last blocks before the chain stops.
  await recorder?.flush();
  if (chainProcess && chainProcess.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(chainProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    else chainProcess.kill('SIGTERM');
  }
  await postgres?.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------------------------------------------------- 6. wait until healthy, then print where things are
const deadline = Date.now() + 90_000;
for (const s of services) {
  for (;;) {
    try {
      if ((await fetch(s.health, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {}
    if (Date.now() > deadline) {
      say(`\x1b[31m${s.name} did not become healthy; see its log above\x1b[0m`);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const url = process.env.ALT_PUBLIC_URL;
console.log(`
\x1b[1m  THE ALT ECOSYSTEM is running\x1b[0m
    Gateway (single entry point)  ${url}
    ALTAR marketplace (web)       ${url}/
    Health of every service       ${url}/health
    API docs (ALT Core)           ${url}/core/docs
    Emails / OTP codes (dev)      ${url}/core/dev/mail
    Database                      ${postgres ? `embedded PostgreSQL on port ${process.env.DEV_POSTGRES_PORT || 54320}` : 'DATABASE_URL from .env'}
    Blockchain                    ${chainMode === 'off' ? 'off' : `${process.env.CHAIN_NAME} (chain ${process.env.CHAIN_ID}) · AIT registry ${process.env.AIT_REGISTRY_ADDRESS}`}
    Phones on this Wi-Fi          ${lanIp ? `http://${lanIp}:${ports.gateway}` : 'no LAN address found'}
  Press Ctrl+C to stop everything.
`);

if (demo) {
  try {
    if (keepDemo) {
      say('the demo is as you left it.');
    } else {
      say('filling the demo story (a few minutes: real sign-ups, AI chats, on-chain mints and listings; it waits out sign-up limits)…');
      await seedDemo({ gateway: url, log: (m) => say(m) });
      // From now on `npm run demo` keeps this demo, and everything done in it.
      updateMeta(demoMeta, { ready: true, readyAt: new Date().toISOString() });
    }
    const rows = DEMO_PEOPLE.map((p) => `    ${p.email.padEnd(20)} ${p.role}`).join('\n');
    console.log(`
\x1b[1m  Demo accounts\x1b[0m (password for all: "${DEMO_PASSWORD}")
${rows}
    ${DEMO_ADMIN_EMAIL.padEnd(20)} Admin (sent the welcome announcement)
    bilal, zainab, omar  @demo.alt: creators of the AIs listed on ALTAR
  The walkthrough is in docs/demo-script.md. The demo is kept between runs; \`npm run demo -- --fresh\` rebuilds it.
`);
  } catch (err) {
    say(`\x1b[31mthe demo story could not be created: ${err.message}\x1b[0m`);
  }
}
