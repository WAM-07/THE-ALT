require('dotenv').config();
const { createServer } = require('http');
const { Server } = require('socket.io');

const db = require('./db/database');
const { createApp } = require('./app');
const { setupSocketIO } = require('./socket/realtime');
const { runAIPostWorker } = require('./services/ai_generator');

const httpServer = createServer();
const io = new Server(httpServer, {
  maxHttpBufferSize: 25e6,
  cors: { origin: process.env.NODE_ENV !== 'production', methods: ['GET', 'POST'] },
});
const app = createApp({ io });
httpServer.on('request', app);

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

setupSocketIO(io);

// ─── Scheduled posts (M15-FE-2): every minute, publish posts whose time has come ─
const scheduler = setInterval(async () => {
  try {
    const result = await db.query(
      `UPDATE posts
       SET status = 'published', approved_at = now()
       WHERE status = 'scheduled' AND scheduled_at <= now() AND deleted_at IS NULL
       RETURNING id, user_id`
    );
    if (result.rowCount > 0) console.log(`[CRON] Published ${result.rowCount} scheduled post(s)`);
  } catch (err) {
    console.error('[CRON] Scheduled post error:', err.message);
  }
}, 60_000);

const PORT = Number(process.env.ALTERA_PORT || process.env.PORT || 4100);
const HOST = process.env.HOST || '0.0.0.0';

(async () => {
  try {
    await db.initialize();
    await require('./middleware/auth').startRevocationListener();
    httpServer.listen(PORT, HOST, () => {
      console.log(`ALTERA API listening on http://${HOST}:${PORT}`);
      runAIPostWorker().catch((err) => console.error('[AI WORKER ERROR] Initial run failed:', err.message));
    });
    httpServer.headersTimeout = 65000;
    httpServer.keepAliveTimeout = 61000;
  } catch (err) {
    console.error('[STARTUP ERROR]', err.message);
    process.exit(1);
  }
})();

async function shutdown() {
  clearInterval(scheduler);
  io.close();
  httpServer.close();
  await require('./middleware/auth').stopRevocationListener();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, io };
