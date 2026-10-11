import { buildGateway, loadGatewayConfig } from './app.js';

const config = loadGatewayConfig();
const app = await buildGateway(config);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
