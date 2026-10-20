// Throwaway PostgreSQL with every service's migrations (core first, then altera), and a throwaway
// blockchain with the ALT contracts so AIs can really be minted during the tests.
import { dropDatabase, ensureDatabase, runMigrations, startLocalChain, startPostgres } from '@alt/devkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default async function setup(project) {
  const [pg, chain] = await Promise.all([
    startPostgres({ dataDir: path.join(repoRoot, '.data', 'test-postgres'), port: 54399 }),
    startLocalChain({ repoRoot, port: 8546, network: 'testchain' }),
  ]);
  await dropDatabase(pg.adminUrl, 'alt_altera_test');
  await ensureDatabase(pg.adminUrl, 'alt_altera_test');
  const url = pg.urlFor('alt_altera_test');
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
