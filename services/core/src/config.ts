import { z } from 'zod';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  CORE_HOST: z.string().default('0.0.0.0'),
  CORE_PORT: z.coerce.number().int().positive().default(4000),
  /** Public base URL of the gateway; every link handed to clients is built from it. */
  ALT_PUBLIC_URL: z.url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1),
  /** PKCS#8 PEM (RSA). Signs access tokens; the public half is served at /.well-known/jwks.json. */
  CORE_JWT_PRIVATE_KEY: z.string().includes('PRIVATE KEY'),
  /** 32 bytes, base64. Encrypts custodial wallet keys and 2FA secrets (AES-256-GCM). */
  CORE_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  /** Shared by ALT services when calling /internal routes. */
  INTERNAL_SERVICE_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAIL_MODE: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('THE ALT <no-reply@alt.local>'),
  GOOGLE_CLIENT_IDS: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  STORAGE_DIR: z.string().default('.data/uploads'),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DEEP_LINK_ALTER: z.string().default('alter://handoff'),
  DEEP_LINK_ALTERA: z.string().default('altera://handoff'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid ALT Core configuration:\n${issues}`);
  }
  const e = parsed.data;
  if (e.MAIL_MODE === 'smtp' && !e.SMTP_URL) throw new Error('MAIL_MODE=smtp requires SMTP_URL');
  const publicUrl = new URL(e.ALT_PUBLIC_URL);
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    logLevel: e.LOG_LEVEL,
    host: e.CORE_HOST,
    port: e.CORE_PORT,
    publicUrl: e.ALT_PUBLIC_URL.replace(/\/$/, ''),
    publicHost: publicUrl.host,
    databaseUrl: e.DATABASE_URL,
    jwtPrivateKeyPem: e.CORE_JWT_PRIVATE_KEY,
    encryptionKey: Buffer.from(e.CORE_ENCRYPTION_KEY, 'base64'),
    internalServiceKey: e.INTERNAL_SERVICE_KEY,
    accessTokenTtl: e.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    mail: { mode: e.MAIL_MODE, smtpUrl: e.SMTP_URL, from: e.MAIL_FROM },
    googleClientIds: list(e.GOOGLE_CLIENT_IDS),
    adminEmails: list(e.ADMIN_EMAILS).map((s) => s.toLowerCase()),
    corsOrigins: list(e.CORS_ORIGINS),
    storageDir: e.STORAGE_DIR,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    deepLinks: {
      alter: e.DEEP_LINK_ALTER,
      altera: e.DEEP_LINK_ALTERA,
      altar: `${e.ALT_PUBLIC_URL.replace(/\/$/, '')}/handoff`,
      admin: `${e.ALT_PUBLIC_URL.replace(/\/$/, '')}/admin/handoff`,
    },
  };
}
