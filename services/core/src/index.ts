import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { replayLocalChain } from './jobs/replay-local-chain.js';
import { assignDefaultAvatars } from './jobs/default-avatars.js';
import { startBehaviourScans } from './modules/accounts/behaviour.js';
import { startRegistryIndexer } from './modules/market/holders.js';

const config = loadConfig();
// The job worker starts below, once the local dev chain (if any) has caught up with the database.
const app = await buildApp({ config, jobs: false });

let stopIndexer: () => void = () => {};
let stopScans: () => void = () => {};
const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopIndexer();
  stopScans();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });

try {
  await replayLocalChain(app.ctx, (msg) => app.log.info(msg));
} catch (err) {
  app.log.error({ err }, 'could not replay identity tokens onto the local chain');
}
try {
  await assignDefaultAvatars(app.ctx, (msg) => app.log.info(msg));
} catch (err) {
  app.log.error({ err }, 'could not give ready-made pictures to older accounts');
}
if (config.jobsEnabled) {
  await app.jobs.start();
  // Ownership and rentals follow the chain, including transfers made outside ALTAR.
  if (app.ctx.chain) stopIndexer = startRegistryIndexer(app.ctx, (msg) => app.log.info(msg));
  // The daily abnormal-behaviour scan, with ALT's ML service.
  if (app.ctx.ml) stopScans = startBehaviourScans(app.ctx, (msg) => app.log.warn(msg));
}
