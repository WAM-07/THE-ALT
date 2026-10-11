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
