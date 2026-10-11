// Starts a throwaway PostgreSQL (embedded binaries, no Docker) and applies all migrations.
import { dropDatabase, ensureDatabase, runMigrations, startPostgres } from '@alt/devkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const pg = await startPostgres({ dataDir: path.join(repoRoot, '.data', 'test-postgres'), port: 54399 });
  await dropDatabase(pg.adminUrl, 'alt_core_test');
  await ensureDatabase(pg.adminUrl, 'alt_core_test');
  const url = pg.urlFor('alt_core_test');
  await runMigrations(url, { repoRoot, log: () => {} });
  project.provide('databaseUrl', url);
  return async () => {
    await pg.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
