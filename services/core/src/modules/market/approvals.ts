import { createHash, randomBytes } from 'node:crypto';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';

export const SPEND_ACTIONS = ['buy', 'rent', 'subscribe', 'list', 'withdraw', 'send'] as const;
export type SpendAction = (typeof SPEND_ACTIONS)[number];

/** What a spend is: the action, the AI (if any) and its details as strings (amounts in wei). */
export interface SpendIntent {
  action: SpendAction;
  aiId?: string | null;
  params: Record<string, string>;
}

/** How long an approval from the ALT window stays usable. */
export const APPROVAL_TTL_MS = 2 * 60_000;

const canonical = (p: Record<string, string>) =>
  Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join('&');

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

/**
 * One-time approvals of a single spend. The person confirms with their password or 2FA code in the
 * ALT Account window (served by Core), never on the platform's page; Core then signs an approval
 * bound to that person, action, AI and amounts, usable once within two minutes. The platform sends
 * it with the spend instead of a password. Used approvals are remembered in memory until they
 * expire (one Core instance; a shared store would be needed to run several).
 */
export class SpendApprovals {
  private readonly key: Buffer;
  private readonly used = new Map<string, number>();

  constructor(secret: Buffer, private readonly now: () => number = Date.now) {
    this.key = createHash('sha256').update(secret).update('alt-spend-approval').digest();
  }

  issue(userId: string, intent: SpendIntent) {
    const exp = this.now() + APPROVAL_TTL_MS;
    const payload = b64(JSON.stringify({ sub: userId, act: intent.action, ai: intent.aiId ?? null, p: canonical(intent.params), exp, jti: randomBytes(12).toString('hex') }));
    return { approval: `${payload}.${hmacSha256(this.key, payload)}`, expiresAt: new Date(exp).toISOString() };
  }

  /** True (and the approval is used up) only for this person and exactly this spend, in time. */
  consume(userId: string, approval: string, intent: SpendIntent): boolean {
    const [payload, sig] = approval.split('.');
    if (!payload || !sig || !safeEqual(sig, hmacSha256(this.key, payload))) return false;
    let claims: { sub: string; act: string; ai: string | null; p: string; exp: number; jti: string };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return false;
    }
    const now = this.now();
    for (const [jti, exp] of this.used) if (exp < now) this.used.delete(jti);
    if (claims.exp < now || this.used.has(claims.jti)) return false;
    if (claims.sub !== userId || claims.act !== intent.action || claims.ai !== (intent.aiId ?? null) || claims.p !== canonical(intent.params)) return false;
    this.used.set(claims.jti, claims.exp);
    return true;
  }
}
