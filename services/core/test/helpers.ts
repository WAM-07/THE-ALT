import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createMailer } from '../src/lib/mailer.js';
import type { GoogleIdentity } from '../src/modules/auth/google.js';
import { AppError } from '../src/lib/errors.js';
import type { LlmProvider } from '../src/modules/ai/llm.js';
import type { MlClient } from '../src/lib/ml.js';

const privateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

export const ADMIN_EMAIL = 'admin@alt.test';

/** Fake Google: the "ID token" is just JSON describing the identity. */
export const fakeGoogle = {
  async verify(idToken: string): Promise<GoogleIdentity> {
    try {
      return JSON.parse(idToken) as GoogleIdentity;
    } catch {
      throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'bad token');
    }
  },
};

export async function makeApp(env: Record<string, string> = {}, opts: { llmProviders?: LlmProvider[]; ml?: MlClient | null } = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    CORE_JWT_PRIVATE_KEY: privateKey,
    CORE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    INTERNAL_SERVICE_KEY: 'test-internal-service-key-0123456789abcdef',
    ALT_PUBLIC_URL: 'http://localhost:8080',
    RATE_LIMIT_ENABLED: 'false',
    ADMIN_EMAILS: ADMIN_EMAIL,
    STORAGE_DIR: '.data/test-uploads',
    CHAIN_RPC_URL: inject('chain').rpcUrl,
    CHAIN_ID: String(inject('chain').chainId),
    CHAIN_NAME: 'ALT test chain',
    AIT_REGISTRY_ADDRESS: inject('chain').registry,
    ALT_MARKETPLACE_ADDRESS: inject('chain').marketplace,
    RELAYER_PRIVATE_KEY: inject('chain').relayerPrivateKey,
    ...env,
  });
  const mailer = createMailer(config, () => {});
  const app = await buildApp({ config, logger: false, google: fakeGoogle, mailer, jobs: false, ...(opts.llmProviders ? { llmProviders: opts.llmProviders } : {}), ...(opts.ml !== undefined ? { ml: opts.ml } : {}) });
  await app.ready();
  return { app, mailer, config };
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

export const uniq = () => randomBytes(4).toString('hex');

export function lastCode(t: TestApp, email: string) {
  const mail = t.mailer.outbox().find((m) => m.to === email);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No code mailed to ${email}`);
  return code;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Registers and verifies a user; returns their tokens. */
export async function signUp(t: TestApp, opts: { email?: string; password?: string; platform?: string } = {}) {
  const id = uniq();
  const email = opts.email ?? `user_${id}@alt.test`;
  const password = opts.password ?? 'correct horse 1';
  const reg = await t.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, handle: `u_${id}`, displayName: `User ${id}` },
  });
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
  const res = await t.app.inject({
    method: 'POST',
    url: '/auth/email/verify',
    payload: { email, code: lastCode(t, email), platform: opts.platform ?? 'alter' },
  });
  if (res.statusCode !== 200) throw new Error(`verify failed: ${res.body}`);
  const body = res.json();
  return { email, password, handle: `u_${id}`, ...body } as {
    email: string;
    password: string;
    handle: string;
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    user: { id: string; wallets: { address: string; kind: string; isPrimary: boolean }[]; roles: string[] };
  };
}
