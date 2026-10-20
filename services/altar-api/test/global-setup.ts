// A throwaway PostgreSQL and blockchain (ALT contracts deployed), then every migration.
import { dropDatabase, ensureDatabase, runMigrations, startLocalChain, startPostgres } from '@alt/devkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const [pg, chain] = await Promise.all([
    startPostgres({ dataDir: path.join(repoRoot, '.data', 'test-postgres-altar'), port: 54398 }),
    startLocalChain({ repoRoot, port: 8546, network: 'testchain' }),
  ]);
  await dropDatabase(pg.adminUrl, 'alt_altar_test');
  await ensureDatabase(pg.adminUrl, 'alt_altar_test');
  const url = pg.urlFor('alt_altar_test');
  await runMigrations(url, { repoRoot, log: () => {} });
  project.provide('databaseUrl', url);
  project.provide('chain', { rpcUrl: chain.rpcUrl, registry: chain.deployment.registry, marketplace: chain.deployment.marketplace, relayerPrivateKey: chain.relayerPrivateKey });
  return async () => {
    await Promise.all([pg.stop(), chain.stop()]);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    chain: { rpcUrl: string; registry: string; marketplace: string; relayerPrivateKey: string };
  }
}
