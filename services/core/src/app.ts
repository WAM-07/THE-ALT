import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import { createPool } from './db.js';
import { AppError } from './lib/errors.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { TokenService } from './lib/tokens.js';
import { createGoogleVerifier, type GoogleVerifier } from './modules/auth/google.js';
import { authRoutes } from './http/routes/auth.js';
import { directoryRoutes } from './http/routes/directory.js';
import { meRoutes } from './http/routes/me.js';

export interface BuildOptions {
  config: Config;
  /** Test seams. */
  google?: GoogleVerifier;
  mailer?: Mailer;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions) {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: true,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Clients often send "content-type: application/json" on body-less POSTs (logout, 2FA setup).
  // Treat an empty body as "no body" instead of rejecting the request.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error('The request body is not valid JSON.'), { statusCode: 400, code: 'INVALID_JSON' }), undefined);
    }
  });

  const db = createPool(config.databaseUrl);
  const ctx: Ctx = {
    config,
    db,
    tokens: await TokenService.create(config.jwtPrivateKeyPem, `${config.publicUrl}/core`, config.accessTokenTtl),
    mailer: opts.mailer ?? createMailer(config, (m) => app.log.info(m)),
    google: opts.google ?? createGoogleVerifier(config.googleClientIds),
  };
  app.decorate('ctx', ctx);
  app.addHook('onClose', async () => {
    await db.end();
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    const requestId = req.id;
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    }
    const fe = err as FastifyError;
    if (fe.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are missing or invalid.',
          details: { issues: fe.validation.map((v) => ({ path: v.instancePath || v.params?.missingProperty, message: v.message })) },
          requestId,
        },
      });
    }
    if (fe.statusCode && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ error: { code: fe.code ?? 'BAD_REQUEST', message: fe.message, requestId } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.', requestId } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}`, requestId: req.id } }),
  );

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: true });
  await app.register(cookie);
  await app.register(multipart);
  await app.register(rateLimit, {
    global: false,
    // Behind the gateway every request comes from the same proxy; key on the real client address.
    keyGenerator: (req) => req.ip,
    // Thrown, then shaped by the error handler like every other error.
    errorResponseBuilder: (_req, context) =>
      Object.assign(new Error(`Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`), {
        statusCode: 429,
        code: 'RATE_LIMITED',
      }),
    // Tests can switch limits off; route-level limits would otherwise still apply.
    allowList: () => !config.rateLimitEnabled,
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'ALT Core API', version: '0.1.0', description: 'One ALT account and identity for ALTER, ALTAR and ALTERA.' },
      servers: [{ url: `${config.publicUrl}/core` }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', { schema: { hide: true } }, async () => {
    await db.query('SELECT 1');
    return { service: 'core', status: 'ok', time: new Date().toISOString() };
  });
  app.get('/.well-known/jwks.json', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { keys: [ctx.tokens.jwk] };
  });

  await app.register(async (i) => authRoutes(i, ctx));
  await app.register(async (i) => meRoutes(i, ctx));
  await app.register(async (i) => directoryRoutes(i, ctx));

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx;
  }
}
