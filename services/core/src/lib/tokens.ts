import { createPrivateKey, createPublicKey } from 'node:crypto';
import { calculateJwkThumbprint, exportJWK, jwtVerify, SignJWT, type JWK } from 'jose';
import { unauthorized } from './errors.js';

export interface AccessClaims {
  sub: string;
  sid: string;
  plat: string;
  roles: string[];
}

const ACCESS_AUDIENCE = 'alt';
const MFA_AUDIENCE = 'alt-mfa';

/**
 * Signs and verifies ALT tokens. Access tokens are RS256 JWTs so every service can verify them
 * with the public key from /.well-known/jwks.json and never needs a shared secret.
 */
export class TokenService {
  private constructor(
    private readonly privateKey: CryptoKey | import('node:crypto').KeyObject,
    private readonly publicKey: import('node:crypto').KeyObject,
    readonly jwk: JWK,
    private readonly issuer: string,
    private readonly accessTtl: number,
  ) {}

  static async create(privateKeyPem: string, issuer: string, accessTtl: number) {
    const privateKey = createPrivateKey(privateKeyPem);
    const publicKey = createPublicKey(privateKey);
    const jwk = await exportJWK(publicKey);
    jwk.kid = await calculateJwkThumbprint(jwk);
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    return new TokenService(privateKey, publicKey, jwk, issuer, accessTtl);
  }

  get accessTokenTtl() {
    return this.accessTtl;
  }

  signAccess(claims: AccessClaims) {
    return new SignJWT({ sid: claims.sid, plat: claims.plat, roles: claims.roles })
      .setProtectedHeader({ alg: 'RS256', kid: this.jwk.kid!, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setAudience(ACCESS_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtl}s`)
      .sign(this.privateKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.issuer,
        audience: ACCESS_AUDIENCE,
        algorithms: ['RS256'],
      });
      return {
        sub: payload.sub!,
        sid: payload.sid as string,
        plat: payload.plat as string,
        roles: (payload.roles as string[]) ?? [],
      };
    } catch {
      throw unauthorized('INVALID_TOKEN', 'Your session has expired. Sign in again.');
    }
  }

  /** Short-lived proof that the password step passed, exchanged for tokens once the 2FA code is checked. */
  signMfa(userId: string, platform: string, device: string | undefined) {
    return new SignJWT({ plat: platform, dev: device ?? null })
      .setProtectedHeader({ alg: 'RS256', kid: this.jwk.kid! })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience(MFA_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.privateKey);
  }

  async verifyMfa(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.issuer,
        audience: MFA_AUDIENCE,
        algorithms: ['RS256'],
      });
      return { userId: payload.sub!, platform: payload.plat as string, device: (payload.dev as string | null) ?? undefined };
    } catch {
      throw unauthorized('MFA_EXPIRED', 'The sign-in attempt expired. Start again.');
    }
  }
}
