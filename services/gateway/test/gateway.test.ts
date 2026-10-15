import Fastify, { type FastifyInstance } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGateway, loadGatewayConfig } from '../src/app.js';

let upstream: FastifyInstance;
let gateway: Awaited<ReturnType<typeof buildGateway>>;
let token: string;
let forged: string;

beforeAll(async () => {
  // A stand-in service that echoes what it received.
  upstream = Fastify();
  // Starts a live stream, then dies (as Core does when it restarts with an app's inbox open).
  upstream.get('/stream-then-die', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    reply.raw.write('event: ready\ndata: {}\n\n');
    setTimeout(() => req.raw.socket.resetAndDestroy(), 100); // a killed process resets the connection
  });
  upstream.all('/*', async (req) => ({ url: req.url, headers: req.headers }));
  upstream.get('/health', async () => ({ status: 'ok' }));
  await upstream.listen({ port: 0, host: '127.0.0.1' });
  const port = (upstream.server.address() as { port: number }).port;

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const sign = (key: CryptoKey, kid: string) =>
    new SignJWT({ sid: 's1', plat: 'altera', roles: ['participant'] })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject('user-1')
      .setIssuer('http://localhost:8080/core')
      .setAudience('alt')
      .setExpirationTime('5m')
      .sign(key);
  token = await sign(privateKey, 'k1');
  forged = await sign((await generateKeyPair('RS256')).privateKey, 'k1');

  const config = loadGatewayConfig({
    NODE_ENV: 'test',
    CORE_URL: `http://127.0.0.1:${port}`,
    ALTERA_URL: 'http://127.0.0.1:9', // nothing listens here
    ALTAR_WEB_URL: `http://127.0.0.1:${port}`, // the stand-in plays ALTAR web too
    COMMAND_URL: `http://127.0.0.1:${port}`, // and the ALT Command Centre
  });
  gateway = await buildGateway(config, { jwks: createLocalJWKSet({ keys: [jwk] }), logger: false });
  await gateway.ready();
});

afterAll(async () => {
  await gateway.close();
  await upstream.close();
});

describe('gateway', () => {
  it('strips the prefix and passes the verified caller to the service', async () => {
    const res = await gateway.inject({ method: 'GET', url: '/core/me?x=1', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('/me?x=1');
    expect(body.headers['x-alt-user-id']).toBe('user-1');
    expect(body.headers['x-alt-platform']).toBe('altera');
    expect(body.headers['x-request-id']).toBeTruthy();
  });

  it('serves ALTAR web for every path the services do not own', async () => {
    const page = await gateway.inject({ method: 'GET', url: '/details/sara_ai?x=1' });
    expect(page.statusCode).toBe(200);
    expect(page.json().url).toBe('/details/sara_ai?x=1');
    expect((await gateway.inject({ method: 'GET', url: '/' })).json().url).toBe('/');
    // Service prefixes still win.
    expect((await gateway.inject({ method: 'GET', url: '/core/me' })).json().url).toBe('/me');
  });

  it('serves the ALT Command Centre under /command, keeping its prefix', async () => {
    expect((await gateway.inject({ method: 'GET', url: '/command/queue?status=open' })).json().url).toBe('/command/queue?status=open');
    expect((await gateway.inject({ method: 'GET', url: '/command' })).json().url).toBe('/command');
  });

  it('drops identity headers a client tries to forge', async () => {
    const res = await gateway.inject({ method: 'GET', url: '/core/me', headers: { 'x-alt-user-id': 'admin', 'x-alt-service-key': 'guess' } });
    expect(res.json().headers['x-alt-user-id']).toBeUndefined();
    expect(res.json().headers['x-alt-service-key']).toBeUndefined();
  });

  it('refuses tokens not signed by Core', async () => {
    const res = await gateway.inject({ method: 'GET', url: '/core/me', headers: { authorization: `Bearer ${forged}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('never exposes internal service routes', async () => {
    expect((await gateway.inject({ method: 'POST', url: '/core/internal/users/lookup' })).statusCode).toBe(404);
  });

  it('isolates a dead service: its routes fail cleanly while others keep working', async () => {
    const dead = await gateway.inject({ method: 'GET', url: '/altera/feed' });
    expect(dead.statusCode).toBe(502);
    expect(dead.json().error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect((await gateway.inject({ method: 'GET', url: '/core/anything' })).statusCode).toBe(200);
  });

  it('reports per-service health', async () => {
    const res = (await gateway.inject({ method: 'GET', url: '/health' })).json();
    expect(res.status).toBe('degraded');
    expect(res.services.core.ok).toBe(true);
    expect(res.services.altera.ok).toBe(false);
  });
});

describe('browser CORS', () => {
  it('allows every method the apps use in preflight', async () => {
    const res = await gateway.inject({
      method: 'OPTIONS',
      url: '/core/me',
      headers: { origin: 'http://localhost:5555', 'access-control-request-method': 'PATCH' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });

  it('survives a service dying in the middle of a live stream', async () => {
    await gateway.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
    const res = await fetch(`${base}/core/stream-then-die`);
    expect(res.status).toBe(200);
    // The client sees its stream end (and reconnects); the gateway itself keeps running.
    await res.text().catch(() => '');
    await new Promise((r) => setTimeout(r, 200));
    const after = await fetch(`${base}/core/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(200);
  });
});
