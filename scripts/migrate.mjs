#!/usr/bin/env node
// Applies pending migrations for every service, in order (core, altera, altar).
//   npm run migrate          uses DATABASE_URL from .env, or the embedded dev database if it is blank
import { ensureDatabase, loadEnvFile, runMigrations, startPostgres } from '@alt/devkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile(path.join(root, '.env'));

let postgres = null;
let url = process.env.DATABASE_URL;
if (!url) {
  postgres = await startPostgres({ dataDir: path.join(root, '.data', 'postgres'), port: Number(process.env.DEV_POSTGRES_PORT || 54320) });
  await ensureDatabase(postgres.adminUrl, 'alt');
  url = postgres.urlFor('alt');
}
try {
  const applied = await runMigrations(url, { repoRoot: root });
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
} finally {
  await postgres?.stop();
}
