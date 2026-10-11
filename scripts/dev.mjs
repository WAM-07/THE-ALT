#!/usr/bin/env node
// THE ALT ECOSYSTEM: one command to run everything locally.
//
//   npm run dev                 start database, migrations and every service behind http://localhost:8080
//   npm run dev -- --reset-db   wipe the local database first
//
// Works on Windows, macOS and Linux. Needs only Node.js 22+.
import { ensureDatabase, dropDatabase, loadDevSecrets, loadEnvFile, runMigrations, startPostgres } from '@alt/devkit';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.data');
const args = new Set(process.argv.slice(2));
const require = createRequire(import.meta.url);

const colors = { core: 36, gateway: 35, altera: 33, altar: 32, postgres: 34, chain: 94, dev: 37 };
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
process.env.STORAGE_DIR ||= path.join(dataDir, 'uploads');

const ports = {
  gateway: Number(process.env.GATEWAY_PORT || 8080),
  core: Number(process.env.CORE_PORT || 4000),
  altera: Number(process.env.ALTERA_PORT || 4100),
  altar: Number(process.env.ALTAR_PORT || 4200),
};
process.env.ALT_PUBLIC_URL ||= `http://localhost:${ports.gateway}`;

// ---------------------------------------------------------------- 3. database
let postgres = null;
if (blank('DATABASE_URL')) {
  say('starting embedded PostgreSQL (first run downloads nothing; binaries come from npm)…');
  postgres = await startPostgres({ dataDir: path.join(dataDir, 'postgres'), port: Number(process.env.DEV_POSTGRES_PORT || 54320) });
  if (args.has('--reset-db')) {
    await dropDatabase(postgres.adminUrl, 'alt');
    say('local database wiped');
  }
  await ensureDatabase(postgres.adminUrl, 'alt');
  process.env.DATABASE_URL = postgres.urlFor('alt');
} else if (args.has('--reset-db')) {
  fail('--reset-db only works with the embedded database (DATABASE_URL is set in .env).');
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
let chainProcess = null;

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
    say('a local chain is already running on :8545; reusing it');
  } else {
    say('starting local blockchain (Hardhat) on :8545…');
    chainProcess = spawn(process.execPath, [hardhatCli, 'node'], { cwd: contractsDir, stdio: ['ignore', 'ignore', 'pipe'] });
    readline.createInterface({ input: chainProcess.stderr }).on('line', (l) => console.log(`${tag('chain')} ${l}`));
    for (let i = 0; i < 120 && !(await rpcReady(rpc)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await rpcReady(rpc))) fail('The local blockchain did not start.');
  }
  say('deploying AITRegistry and ALTMarketplace…');
  const deploy = spawnSync(process.execPath, [hardhatCli, 'run', 'scripts/deploy.ts', '--network', 'localhost'], {
    cwd: contractsDir,
    encoding: 'utf8',
  });
  const line = (deploy.stdout || '').split(/\r?\n/).find((l) => l.startsWith('ALT_DEPLOYMENT '));
  if (deploy.status !== 0 || !line) fail(`Contract deployment failed:
${deploy.stdout}
${deploy.stderr}`);
  const d = JSON.parse(line.slice('ALT_DEPLOYMENT '.length));
  process.env.CHAIN_RPC_URL = rpc;
  process.env.CHAIN_NAME = 'ALT local chain';
  process.env.CHAIN_EXPLORER_URL = ''; // no public explorer for a local chain
  process.env.RELAYER_PRIVATE_KEY ||= LOCAL_RELAYER_KEY;
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
    env: { CORE_PORT: String(ports.core) },
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
    Health of every service       ${url}/health
    API docs (ALT Core)           ${url}/core/docs
    Emails / OTP codes (dev)      ${url}/core/dev/mail
    Database                      ${postgres ? `embedded PostgreSQL on port ${process.env.DEV_POSTGRES_PORT || 54320}` : 'DATABASE_URL from .env'}
    Blockchain                    ${chainMode === 'off' ? 'off' : `${process.env.CHAIN_NAME} (chain ${process.env.CHAIN_ID}) · AIT registry ${process.env.AIT_REGISTRY_ADDRESS}`}
    Phones on this Wi-Fi          ${lanIp ? `http://${lanIp}:${ports.gateway}` : 'no LAN address found'}
  Press Ctrl+C to stop everything.
`);
