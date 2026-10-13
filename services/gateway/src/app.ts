import cors from '@fastify/cors';
import proxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  GATEWAY_HOST: z.string().default('0.0.0.0'),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  ALT_PUBLIC_URL: z.url().default('http://localhost:8080'),
  CORE_URL: z.url().default('http://127.0.0.1:4000'),
  ALTERA_URL: z.url().optional(),
  ALTAR_URL: z.url().optional(),
  ALTAR_WEB_URL: z.url().optional(),
  CORS_ORIGINS: z.string().optional(),
  GATEWAY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

export type GatewayConfig = ReturnType<typeof loadGatewayConfig>;

export function loadGatewayConfig(env: Record<string, string | undefined> = process.env) {
  const e = EnvSchema.parse(env);
  const upstreams: { name: string; prefix: string; url: string; websocket?: boolean }[] = [
    { name: 'core', prefix: '/core', url: e.CORE_URL },
  ];
  if (e.ALTERA_URL) upstreams.push({ name: 'altera', prefix: '/altera', url: e.ALTERA_URL, websocket: true });
  if (e.ALTAR_URL) upstreams.push({ name: 'altar', prefix: '/altar', url: e.ALTAR_URL });
  return {
    isProd: e.NODE_ENV === 'production',
    logLevel: e.LOG_LEVEL,
    host: e.GATEWAY_HOST,
    port: e.GATEWAY_PORT,
    publicUrl: e.ALT_PUBLIC_URL.replace(/\/$/, ''),
    coreUrl: e.CORE_URL.replace(/\/$/, ''),
    altarWebUrl: e.ALTAR_WEB_URL,
    upstreams,
    corsOrigins: list(e.CORS_ORIGINS),
    rateLimitPerMinute: e.GATEWAY_RATE_LIMIT_PER_MINUTE,
    upstreamTimeoutMs: e.UPSTREAM_TIMEOUT_MS,
  };
}

interface Caller {
  userId: string;
  sessionId: string;
  roles: string[];
  platform: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    caller?: Caller;
  }
}

// Headers only the gateway may set. Anything a client sends under these names is dropped.
const TRUSTED_HEADERS = ['x-alt-user-id', 'x-alt-session-id', 'x-alt-roles', 'x-alt-platform', 'x-alt-service', 'x-alt-service-key'];

const errorBody = (req: { id: string }, code: string, message: string) => ({ error: { code, message, requestId: req.id } });

export async function buildGateway(config: GatewayConfig, opts: { jwks?: JWTVerifyGetKey; logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: true,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
  });

  // Tokens are verified with Core's public key, fetched once and cached; no shared secret.
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${config.coreUrl}/.well-known/jwks.json`), { cooldownDuration: 30_000 });
  const issuer = `${config.publicUrl}/core`;

  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : !config.isProd,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    if (/^\/[^/]+\/internal(\/|$)/.test(req.url)) {
      return reply.status(404).send(errorBody(req, 'NOT_FOUND', 'Not found.'));
    }
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const { payload } = await jwtVerify(header.slice(7), jwks, { issuer, audience: 'alt', algorithms: ['RS256'] });
        req.caller = {
          userId: payload.sub!,
          sessionId: payload.sid as string,
          roles: (payload.roles as string[]) ?? [],
          platform: payload.plat as string,
        };
      } catch (err) {
        // Expired or forged: refuse here so no service does work for it. The client should refresh.
        if ((err as { code?: string }).code === 'ERR_JWKS_TIMEOUT' || (err as Error).name === 'TypeError') {
          req.log.error({ err }, 'could not load signing keys from core');
          return reply.status(503).send(errorBody(req, 'AUTH_UNAVAILABLE', 'Sign-in is temporarily unavailable.'));
        }
        return reply.status(401).send(errorBody(req, 'INVALID_TOKEN', 'Your session has expired. Sign in again.'));
      }
    }
  });

  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.caller ? `user:${req.caller.userId}` : `ip:${req.ip}`),
    errorResponseBuilder: (req, ctx) =>
      Object.assign(new Error(`Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`), { statusCode: 429, code: 'RATE_LIMITED' }),
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'gateway error');
    return reply.status(status).send(errorBody(req, err.code ?? (status >= 500 ? 'GATEWAY_ERROR' : 'BAD_REQUEST'), status >= 500 ? 'The gateway hit an error.' : err.message));
  });

  const forwardHeaders = (req: FastifyRequest, headers: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...headers };
    for (const h of TRUSTED_HEADERS) delete out[h];
    out['x-request-id'] = req.id;
    out['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.ip].filter(Boolean).join(', ');
    out['x-forwarded-proto'] = req.protocol;
    out['x-forwarded-host'] = req.headers.host;
    if (req.caller) {
      out['x-alt-user-id'] = req.caller.userId;
      out['x-alt-session-id'] = req.caller.sessionId;
      out['x-alt-roles'] = req.caller.roles.join(',');
      out['x-alt-platform'] = req.caller.platform;
    }
    return out;
  };

  // One failing service must not take the others down: errors become a clear 502/504 for that prefix only.
  type ProxyReply = {
    request: { id: string; log: FastifyRequest['log'] };
    sent: boolean;
    raw: { headersSent: boolean; destroy(): void };
    status(code: number): { send(payload: unknown): unknown };
  };
  const upstreamError = (name: string) => (reply: ProxyReply, e: unknown): void => {
    const err = ((e as { error?: unknown })?.error ?? e) as Error & { statusCode?: number; code?: string };
    const timedOut = err.statusCode === 504 || /timeout/i.test(err.code ?? '') || /timeout/i.test(err.message ?? '');
    reply.request.log.warn({ err, upstream: name }, 'upstream failed');
    // The service died part-way through a response (e.g. Core restarting while an app's inbox stream
    // is open). Too late for an error body: end the client's connection so it reconnects. Sending
    // here would throw and take the whole gateway down.
    if (reply.sent || reply.raw.headersSent) {
      reply.raw.destroy();
      return;
    }
    void reply
      .status(timedOut ? 504 : 502)
      .send(errorBody(reply.request, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', `The ${name} service is not responding right now.`));
  };

  for (const u of config.upstreams) {
    await app.register(proxy, {
      upstream: u.url,
      prefix: u.prefix,
      rewritePrefix: '',
      ...(u.websocket ? { websocket: true as const } : {}),
      http: { requestOptions: { timeout: config.upstreamTimeoutMs } },
      replyOptions: {
        rewriteRequestHeaders: (req, headers) => forwardHeaders(req as FastifyRequest, headers) as typeof headers,
        onError: upstreamError(u.name),
      },
    });
  }

  app.get('/health', async () => {
    const checks = await Promise.all(
      config.upstreams.map(async (u) => {
        const started = Date.now();
        try {
          const res = await fetch(`${u.url}/health`, { signal: AbortSignal.timeout(2_000) });
          return [u.name, { ok: res.ok, status: res.status, latencyMs: Date.now() - started }] as const;
        } catch (err) {
          return [u.name, { ok: false, error: (err as Error).message, latencyMs: Date.now() - started }] as const;
        }
      }),
    );
    const services = Object.fromEntries(checks);
    const ok = checks.every(([, c]) => c.ok);
    return { status: ok ? 'ok' : 'degraded', services, time: new Date().toISOString() };
  });

  app.get('/docs', async (_req, reply) => reply.redirect('/core/docs'));

  // A client that drops a WebSocket mid-handshake resets its socket; with no listener that
  // error would crash the whole gateway. Log it and carry on.
  app.server.on('upgrade', (_req, socket) => {
    socket.on('error', (err) => app.log.debug({ err }, 'websocket client went away'));
  });

  if (config.altarWebUrl) {
    // ALTAR web is the public face of the ecosystem; everything not matched above goes to it.
    await app.register(proxy, {
      upstream: config.altarWebUrl,
      // OPTIONS "*" already belongs to CORS; ALTAR web is same-origin and needs no preflight.
      httpMethods: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
      // Next.js live reload (development) uses a WebSocket on this route too.
      websocket: true,
      replyOptions: { onError: upstreamError('altar-web') },
    });
  } else {
    app.get('/', async () => ({
      name: 'THE ALT ECOSYSTEM gateway',
      services: config.upstreams.map((u) => ({ name: u.name, path: u.prefix })),
      docs: `${config.publicUrl}/core/docs`,
      health: `${config.publicUrl}/health`,
    }));
  }

  return app;
}
