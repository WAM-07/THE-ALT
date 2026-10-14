import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  ALTAR_HOST: z.string().default('127.0.0.1'),
  ALTAR_PORT: z.coerce.number().int().positive().default(4200),
  DATABASE_URL: z.string().min(1),
  /** Where ALT Core's public keys are (JWKS), to check ALT access tokens. */
  CORE_URL: z.url().default('http://127.0.0.1:4000'),
  /** Tokens are issued by `${ALT_PUBLIC_URL}/core`. */
  ALT_PUBLIC_URL: z.url().default('http://localhost:8080'),
  /** Lets ALTAR ask ALT Core to moderate reviews (POST /internal/moderate). */
  INTERNAL_SERVICE_KEY: z.string().optional(),
  // The chain, read-only: ALTAR mirrors the marketplace contract but never signs anything.
  CHAIN_RPC_URL: z.string().optional(),
  AIT_REGISTRY_ADDRESS: z.string().optional(),
  ALT_MARKETPLACE_ADDRESS: z.string().optional(),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const e = Env.parse(env);
  const chainOn = Boolean(e.CHAIN_RPC_URL?.trim() && e.AIT_REGISTRY_ADDRESS && e.ALT_MARKETPLACE_ADDRESS);
  return {
    isTest: e.NODE_ENV === 'test',
    logLevel: e.LOG_LEVEL,
    host: e.ALTAR_HOST,
    port: e.ALTAR_PORT,
    databaseUrl: e.DATABASE_URL,
    coreUrl: e.CORE_URL.replace(/\/$/, ''),
    jwksUrl: `${e.CORE_URL.replace(/\/$/, '')}/.well-known/jwks.json`,
    internalServiceKey: e.INTERNAL_SERVICE_KEY || null,
    issuer: `${e.ALT_PUBLIC_URL.replace(/\/$/, '')}/core`,
    chain: chainOn ? { rpcUrl: e.CHAIN_RPC_URL!, registry: e.AIT_REGISTRY_ADDRESS!, marketplace: e.ALT_MARKETPLACE_ADDRESS! } : null,
  };
}
