// Throwaway PostgreSQL with every service's migrations (core first, then altera).
import { dropDatabase, ensureDatabase, runMigrations, startPostgres } from '@alt/devkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default async function setup(project) {
  const pg = await startPostgres({ dataDir: path.join(repoRoot, '.data', 'test-postgres'), port: 54399 });
  await dropDatabase(pg.adminUrl, 'alt_altera_test');
  await ensureDatabase(pg.adminUrl, 'alt_altera_test');
  const url = pg.urlFor('alt_altera_test');
  await runMigrations(url, { repoRoot, log: () => {} });
  project.provide('databaseUrl', url);
  return async () => {
    await pg.stop();
  };
}
