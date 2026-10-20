// Starts a throwaway PostgreSQL (embedded binaries, no Docker) and a throwaway blockchain with
// ALT contracts deployed, then applies all migrations.
import { dropDatabase, ensureDatabase, runMigrations, startLocalChain, startPostgres } from '@alt/devkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const [pg, chain] = await Promise.all([
    startPostgres({ dataDir: path.join(repoRoot, '.data', 'test-postgres'), port: 54399 }),
    startLocalChain({ repoRoot, port: 8546, network: 'testchain' }),
  ]);
  await dropDatabase(pg.adminUrl, 'alt_core_test');
  await ensureDatabase(pg.adminUrl, 'alt_core_test');
  const url = pg.urlFor('alt_core_test');
  await runMigrations(url, { repoRoot, log: () => {} });
  project.provide('databaseUrl', url);
  project.provide('chain', {
    rpcUrl: chain.rpcUrl,
    chainId: chain.deployment.chainId,
    registry: chain.deployment.registry,
    marketplace: chain.deployment.marketplace,
    relayerPrivateKey: chain.relayerPrivateKey,
  });
  return async () => {
    await Promise.all([pg.stop(), chain.stop()]);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    chain: { rpcUrl: string; chainId: number; registry: string; marketplace: string; relayerPrivateKey: string };
  }
}
