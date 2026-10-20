#!/usr/bin/env node
// The ALT beta server (owner, 2026-10-20): every service in production mode behind the gateway, on one machine.
//
//   node deploy/beta/start.mjs           run everything (systemd: alt-beta.service); Caddy serves it over HTTPS
//   node deploy/beta/start.mjs --seed    once, before the first start: build the demo story (nothing is public yet)
//
// Differences from `npm run dev`: PostgreSQL comes from DATABASE_URL (the server's own), the Next.js apps run
// their production builds, every port listens on 127.0.0.1 only, and the private test chain (chain 31337, never
// a public network) is saved block by block and replayed on restart, like `npm run demo`. Secrets come from
// /etc/alt/beta.env (see deploy/beta/README.md) and, generated once, from the state directory.
import { loadDevSecrets, loadEnvFile, runMigrations } from '@alt/devkit';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readJournal, recordBlocks, replayJournal, rpc as chainRpc, startJournal, updateMeta } from '../../scripts/chain/journal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const seed = process.argv.includes('--seed');
const say = (msg) => console.log(`[beta] ${msg}`);
const fail = (msg) => {
  console.error(`[beta] ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------- configuration
loadEnvFile(process.env.ALT_ENV_FILE || '/etc/alt/beta.env');
const state = process.env.ALT_STATE_DIR || '/var/lib/alt';
mkdirSync(state, { recursive: true });
const blank = (k) => !process.env[k] || process.env[k].trim() === '';
for (const [k, v] of Object.entries(loadDevSecrets(state))) if (blank(k)) process.env[k] = v; // token key, encryption key, service key
if (blank('DATABASE_URL')) fail('DATABASE_URL is missing (see /etc/alt/beta.env).');
if (blank('ALT_PUBLIC_URL')) fail('ALT_PUBLIC_URL is missing (see /etc/alt/beta.env).');
process.env.STORAGE_DIR ||= path.join(state, 'uploads');
// The demo story signs people up and reads their codes from the development mailbox, so it runs once in
// development mode with every port on 127.0.0.1; the beta itself always runs in production mode.
process.env.NODE_ENV = seed ? 'development' : 'production';
if (seed) process.env.MAIL_MODE = 'console';

const ports = { gateway: 8080, core: 4000, altera: 4100, altar: 4200, altarWeb: 4300, command: 4400 };
const local = '127.0.0.1';

// ---------------------------------------------------------------- database
say('applying migrations…');
await runMigrations(process.env.DATABASE_URL, { repoRoot: root, log: (m) => say(m.trim()) });

// ---------------------------------------------------------------- private test chain, kept between restarts
const contractsDir = path.join(root, 'packages', 'contracts');
const hardhatCli = path.join(root, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js');
const metaFile = path.join(state, 'chain.json');
const blocksFile = path.join(state, 'chain.jsonl');
const LOCAL_RELAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // Hardhat account #1
const LOCAL_GOVERNOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // account #0, deploys
const contractsHash = () => {
  const dir = path.join(contractsDir, 'contracts');
  const h = createHash('sha256');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sol')).sort()) h.update(f).update(readFileSync(path.join(dir, f)));
  return h.digest('hex');
};
const saved = readJournal(metaFile, blocksFile);
if (saved && saved.meta.contracts !== contractsHash()) {
  fail('The smart contracts changed since the beta chain was saved. Reset the beta (deploy/beta/README.md) to start a new one.');
}
const rpcUrl = `http://${local}:8545`;
const rpcReady = async () => {
  try {
    await chainRpc(rpcUrl, 'eth_chainId');
    return true;
  } catch {
    return false;
  }
};
say('starting the private test chain…');
const chainProcess = spawn(process.execPath, [hardhatCli, '--config', path.join(root, 'scripts', 'chain', 'hardhat.config.mjs'), 'node'], {
  cwd: contractsDir,
  stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, ...(saved ? { ALT_CHAIN_INITIAL_DATE: String(saved.meta.genesisTs) } : {}) },
});
readline.createInterface({ input: chainProcess.stderr }).on('line', (l) => console.log(`[chain] ${l}`));
for (let i = 0; i < 120 && !(await rpcReady()); i++) await new Promise((r) => setTimeout(r, 500));
if (!(await rpcReady())) fail('The test chain did not start.');

let deployment;
let recorder;
if (saved) {
  say(`replaying the saved chain (${saved.blocks.length} blocks)…`);
  await replayJournal(rpcUrl, saved.blocks, say);
  deployment = saved.meta.deployment;
  recorder = recordBlocks(rpcUrl, blocksFile, saved.blocks.length + 1, say);
  const last = saved.blocks.at(-1)?.ts ?? saved.meta.genesisTs;
  await chainRpc(rpcUrl, 'evm_mine', [Math.max(Math.floor(Date.now() / 1000), last + 1)]);
} else {
  say('first start: deploying AITRegistry and ALTMarketplace…');
  const deploy = spawnSync(process.execPath, [hardhatCli, 'run', 'scripts/deploy.ts', '--network', 'localhost'], { cwd: contractsDir, encoding: 'utf8' });
  const line = (deploy.stdout || '').split(/\r?\n/).find((l) => l.startsWith('ALT_DEPLOYMENT '));
  if (deploy.status !== 0 || !line) fail(`Contract deployment failed:\n${deploy.stdout}\n${deploy.stderr}`);
  deployment = JSON.parse(line.slice('ALT_DEPLOYMENT '.length));
  const genesis = await chainRpc(rpcUrl, 'eth_getBlockByNumber', ['0x0', false]);
  startJournal(metaFile, blocksFile, { version: 1, genesisTs: Number(genesis.timestamp), contracts: contractsHash(), deployment, createdAt: new Date().toISOString(), ready: false });
  recorder = recordBlocks(rpcUrl, blocksFile, 1, say);
}
Object.assign(process.env, {
  CHAIN_RPC_URL: rpcUrl,
  CHAIN_NAME: 'ALT beta test chain',
  CHAIN_EXPLORER_URL: '',
  CHAIN_ID: String(deployment.chainId),
  AIT_REGISTRY_ADDRESS: deployment.registry,
  ALT_MARKETPLACE_ADDRESS: deployment.marketplace,
  CHAIN_DEPLOYED_AT_BLOCK: String(deployment.deployedAtBlock ?? 0),
});
process.env.RELAYER_PRIVATE_KEY ||= LOCAL_RELAYER_KEY;
process.env.GOVERNOR_PRIVATE_KEY ||= LOCAL_GOVERNOR_KEY;

// ---------------------------------------------------------------- services
const tsx = require.resolve('tsx/cli');
const next = require.resolve('next/dist/bin/next');
// ALT's ML service (toxicity model, embeddings) from its virtualenv; without it, moderation uses the rules alone.
const mlPython = path.join(process.env.ALT_ML_VENV || path.join(state, 'ml-venv'), 'bin', 'python');
const mlOn = existsSync(mlPython);
if (mlOn) process.env.ML_URL ||= `http://${local}:4500`;
const services = [
  { name: 'core', cwd: 'services/core', cmd: [tsx, 'src/index.ts'], health: ports.core,
    env: { CORE_HOST: local, CORE_PORT: String(ports.core), ALTERA_SERVICE_URL: `http://${local}:${ports.altera}`, ALTAR_SERVICE_URL: `http://${local}:${ports.altar}` } },
  { name: 'gateway', cwd: 'services/gateway', cmd: [tsx, 'src/index.ts'], health: ports.gateway,
    env: { GATEWAY_HOST: local, GATEWAY_PORT: String(ports.gateway), CORE_URL: `http://${local}:${ports.core}`, ALTERA_URL: `http://${local}:${ports.altera}`,
      ALTAR_URL: `http://${local}:${ports.altar}`, ALTAR_WEB_URL: `http://${local}:${ports.altarWeb}`, COMMAND_URL: `http://${local}:${ports.command}` } },
  { name: 'altera', cwd: 'services/altera-api', cmd: ['src/server.js'], health: ports.altera, env: { HOST: local, PORT: String(ports.altera) } },
  { name: 'altar', cwd: 'services/altar-api', cmd: [tsx, 'src/index.ts'], health: ports.altar,
    env: { ALTAR_HOST: local, ALTAR_PORT: String(ports.altar), CORE_URL: `http://${local}:${ports.core}` } },
];
if (mlOn) {
  services.push({ name: 'ml', cwd: 'services/ml', exe: mlPython, cmd: ['-m', 'uvicorn', 'app:app', '--host', local, '--port', '4500', '--log-level', 'warning'],
    health: 4500, env: { ML_MODEL_DIR: path.join(state, 'models'), ML_THREADS: '2' } });
}
if (!seed) {
  services.push(
    { name: 'altar-web', cwd: 'apps/altar-web', cmd: [next, 'start', '-p', String(ports.altarWeb), '-H', local], health: ports.altarWeb, path: '/', env: { NEXT_TELEMETRY_DISABLED: '1' } },
    { name: 'command', cwd: 'apps/command-centre', cmd: [next, 'start', '-p', String(ports.command), '-H', local], health: ports.command, path: '/command', env: { NEXT_TELEMETRY_DISABLED: '1' } },
  );
}

const children = [];
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  say('stopping…');
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  await recorder?.flush(); // the chain's last blocks are written before it stops
  if (chainProcess.exitCode === null) chainProcess.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
chainProcess.on('exit', () => {
  if (!stopping) {
    say('the test chain stopped; restarting everything');
    stop(1);
  }
});

for (const s of services) {
  const child = spawn(s.exe ?? process.execPath, s.cmd, { cwd: path.join(root, s.cwd), env: { ...process.env, ...s.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) readline.createInterface({ input: stream }).on('line', (l) => console.log(`[${s.name}] ${l}`));
  // One service down means the beta is broken: systemd restarts the whole set (the chain is replayed).
  child.on('exit', (code) => {
    if (!stopping) {
      say(`${s.name} exited with code ${code}; restarting everything`);
      stop(1);
    }
  });
}

const deadline = Date.now() + 180_000;
for (const s of services) {
  for (;;) {
    try {
      if ((await fetch(`http://${local}:${s.health}${s.path ?? '/health'}`, { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch {}
    if (Date.now() > deadline) {
      say(`${s.name} did not become healthy`);
      await stop(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
say(`running: ${process.env.ALT_PUBLIC_URL} (gateway on ${local}:${ports.gateway})`);

if (seed) {
  const { seedDemo } = await import('../../scripts/seed-demo.mjs');
  say('building the demo story (a few minutes: real sign-ups, AI chats, mints and listings)…');
  try {
    await seedDemo({ gateway: `http://${local}:${ports.gateway}`, log: (m) => say(m) });
    updateMeta(metaFile, { ready: true, readyAt: new Date().toISOString() });
    say('demo story ready.');
    await stop(0);
  } catch (err) {
    say(`the demo story failed: ${err.message}`);
    await stop(1);
  }
}
