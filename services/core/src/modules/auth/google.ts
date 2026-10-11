import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError, unauthorized } from '../../lib/errors.js';

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

/** Verifies Google ID tokens against Google's published keys. Tests inject a fake verifier instead. */
export function createGoogleVerifier(clientIds: string[]): GoogleVerifier {
  const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return {
    async verify(idToken) {
      if (!clientIds.length) throw new AppError(501, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this server.');
      try {
        const { payload } = await jwtVerify(idToken, jwks, {
          issuer: ['https://accounts.google.com', 'accounts.google.com'],
          audience: clientIds,
        });
        return {
          sub: payload.sub!,
          email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
          emailVerified: payload.email_verified === true || payload.email_verified === 'true',
          name: typeof payload.name === 'string' ? payload.name : null,
          picture: typeof payload.picture === 'string' ? payload.picture : null,
        };
      } catch {
        throw unauthorized('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.');
      }
    },
  };
}
