import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { replayLocalChain } from './jobs/replay-local-chain.js';

const config = loadConfig();
// The job worker starts below, once the local dev chain (if any) has caught up with the database.
const app = await buildApp({ config, jobs: false });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
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
if (config.jobsEnabled) await app.jobs.start();
