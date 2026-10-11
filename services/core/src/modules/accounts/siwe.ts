import type pg from 'pg';
import { getAddress, verifyMessage, type Hex } from 'viem';
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import type { Ctx } from '../../context.js';
import { badRequest, unauthorized } from '../../lib/errors.js';

export type SiwePurpose = 'login' | 'link';
const NONCE_TTL_MS = 10 * 60_000;

export async function createSiweNonce(q: pg.Pool | pg.PoolClient, purpose: SiwePurpose, userId: string | null) {
  const nonce = generateSiweNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await q.query('INSERT INTO core.siwe_nonces (nonce, purpose, user_id, expires_at) VALUES ($1, $2, $3, $4)', [
    nonce,
    purpose,
    userId,
    expiresAt,
  ]);
  return { nonce, expiresAt: expiresAt.toISOString() };
}

/**
 * Verifies an EIP-4361 message and burns its nonce (single use, in the caller's transaction).
 * Returns the signer's lowercase address.
 */
export async function consumeSiwe(
  ctx: Ctx,
  client: pg.PoolClient,
  message: string,
  signature: string,
  purpose: SiwePurpose,
  userId: string | null,
) {
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce) throw badRequest('SIWE_INVALID', 'The sign-in message is malformed.');
  const valid = validateSiweMessage({ message: parsed, domain: ctx.config.publicHost });
  if (!valid) throw unauthorized('SIWE_INVALID', 'The sign-in message is not valid for this site or has expired.');
  if (parsed.uri && !parsed.uri.startsWith(ctx.config.publicUrl)) {
    throw unauthorized('SIWE_INVALID', 'The sign-in message was created for a different site.');
  }

  const { rows } = await client.query(
    `UPDATE core.siwe_nonces SET used_at = now()
      WHERE nonce = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
        AND (user_id IS NOT DISTINCT FROM $3)
      RETURNING nonce`,
    [parsed.nonce, purpose, userId],
  );
  if (!rows.length) throw unauthorized('SIWE_NONCE_INVALID', 'This sign-in request was already used or has expired.');

  let ok = false;
  try {
    ok = await verifyMessage({ address: getAddress(parsed.address), message, signature: signature as Hex });
  } catch {
    ok = false;
  }
  if (!ok) throw unauthorized('SIWE_SIGNATURE_INVALID', 'The wallet signature does not match.');
  return parsed.address.toLowerCase();
}
