import type pg from 'pg';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { hmacSha256, numericCode, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest } from '../../lib/errors.js';

export type OtpPurpose = 'verify_email' | 'reset_password';

const TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

const otpKey = (ctx: Ctx) => Buffer.from(sha256(Buffer.concat([ctx.config.encryptionKey, Buffer.from('otp')])), 'hex');

/** Creates a fresh code (invalidating older ones) and returns it so the caller can email it after commit. */
export async function issueOtp(ctx: Ctx, client: pg.PoolClient, userId: string, email: string, purpose: OtpPurpose) {
  const { rows } = await client.query<{ created_at: Date }>(
    `SELECT created_at FROM core.otp_codes
      WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  const last = rows[0];
  if (last && Date.now() - last.created_at.getTime() < RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last.created_at.getTime())) / 1000);
    throw new AppError(429, 'OTP_COOLDOWN', `Wait ${retryAfter} seconds before requesting another code.`, { retryAfter });
  }
  await client.query(
    'UPDATE core.otp_codes SET consumed_at = now() WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL',
    [email, purpose],
  );
  const code = numericCode(6);
  await client.query(
    `INSERT INTO core.otp_codes (user_id, email, purpose, code_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, email, purpose, hmacSha256(otpKey(ctx), code), new Date(Date.now() + TTL_MS)],
  );
  return code;
}

export async function sendOtpMail(ctx: Ctx, email: string, purpose: OtpPurpose, code: string) {
  const subject = purpose === 'verify_email' ? 'Verify your ALT account' : 'Reset your ALT password';
  const intro =
    purpose === 'verify_email'
      ? 'Use this code to verify your email for your ALT account (ALTER, ALTAR and ALTERA):'
      : 'Use this code to reset your ALT account password:';
  await ctx.mailer.send({
    to: email,
    subject,
    text: `${intro}\n\n    ${code}\n\nIt expires in 10 minutes. If you did not ask for this, ignore this email.`,
  });
}

/**
 * Checks a code in its own transaction so failed attempts are counted even though the caller
 * then refuses the request. A code dies after 5 wrong tries.
 */
export async function verifyOtp(ctx: Ctx, email: string, purpose: OtpPurpose, code: string) {
  const outcome = await tx(ctx.db, async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, code_hash, attempts, expires_at FROM core.otp_codes
        WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email, purpose],
    );
    const otp = rows[0];
    if (!otp || otp.expires_at < new Date()) return { ok: false as const, reason: 'OTP_INVALID' };
    if (!safeEqual(otp.code_hash, hmacSha256(otpKey(ctx), code))) {
      const attempts = otp.attempts + 1;
      await client.query(
        `UPDATE core.otp_codes SET attempts = $2, consumed_at = CASE WHEN $3 THEN now() END WHERE id = $1`,
        [otp.id, attempts, attempts >= MAX_ATTEMPTS],
      );
      return { ok: false as const, reason: attempts >= MAX_ATTEMPTS ? 'OTP_TOO_MANY_ATTEMPTS' : 'OTP_INVALID' };
    }
    await client.query('UPDATE core.otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
    return { ok: true as const, userId: otp.user_id as string };
  });
  if (!outcome.ok) {
    throw badRequest(
      outcome.reason,
      outcome.reason === 'OTP_TOO_MANY_ATTEMPTS' ? 'Too many wrong codes. Request a new one.' : 'That code is wrong or has expired.',
    );
  }
  return outcome.userId;
}
