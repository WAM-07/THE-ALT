const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const db = require('./db/database');
const authRoutes = require('./routes/auth');
const feedRoutes = require('./routes/feed');
const postRoutes = require('./routes/posts');
const profileRoutes = require('./routes/profiles');
const followRoutes = require('./routes/follows');
const notificationRoutes = require('./routes/notifications');
const exploreRoutes = require('./routes/explore');
const blockchainRoutes = require('./routes/blockchain');
const messageRoutes = require('./routes/messages');
const storyRoutes = require('./routes/stories');
const aiRoutes = require('./routes/ai');
const { getStoredMedia } = require('./services/media_storage');

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Builds the ALTERA HTTP app. `io` is the Socket.IO server routes use to push live updates.
 * Normally reached through the ALT gateway at /altera/*; the gateway strips that prefix.
 */
function createApp({ io = null, logRequests = true } = {}) {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  if (logRequests) app.use(morgan('dev'));
  app.use(cors({
    // Mobile apps send no Origin header; browsers must be on the allow-list (ALTAR web is same-origin via the gateway).
    origin: allowedOrigins.length ? allowedOrigins : process.env.NODE_ENV !== 'production',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  }));
  // Media arrives as base64 data URIs; 25 MB covers a phone photo or a short clip.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  if (process.env.RATE_LIMIT_ENABLED !== 'false') {
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 2000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
    }));
  }

  app.use((req, _res, next) => {
    req.io = io;
    req.db = db;
    next();
  });

  app.use('/auth', authRoutes);
  app.use('/feed', feedRoutes);
  app.use('/posts', postRoutes);
  app.use('/profiles', profileRoutes);
  app.use('/follows', followRoutes);
  app.use('/notifications', notificationRoutes);
  app.use('/explore', exploreRoutes);
  app.use('/blockchain', blockchainRoutes);
  app.use('/messages', messageRoutes);
  app.use('/stories', storyRoutes);
  app.use('/ai', aiRoutes);
  app.use('/uploads', express.static('public/uploads'));

  app.get('/media/:id', async (req, res) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ message: 'Media not found' });
      const media = await getStoredMedia(req.params.id);
      if (!media || !media.storage_blob) {
        return res.status(404).json({ message: 'Media not found' });
      }
      res.setHeader('Content-Type', media.mime_type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(media.storage_blob);
    } catch (err) {
      console.error('[GET /media/:id]', err.message);
      return res.status(500).json({ message: 'Failed to load media' });
    }
  });

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ service: 'altera', status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ service: 'altera', status: 'database_unavailable' });
    }
  });

  app.use((req, res) => res.status(404).json({ message: `Route ${req.path} not found`, code: 'NOT_FOUND' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ message: 'That upload is too large (25 MB max).', code: 'PAYLOAD_TOO_LARGE' });
    }
    console.error('[ERROR]', err.stack || err);
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ message: status < 500 ? err.message : 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
