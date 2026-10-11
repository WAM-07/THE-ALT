import type { Config } from './config.js';
import type { Db } from './db.js';
import type { GoogleVerifier } from './modules/auth/google.js';
import type { ChainService } from './lib/chain.js';
import type { IpfsStore } from './lib/ipfs.js';
import type { Mailer } from './lib/mailer.js';
import type { TokenService } from './lib/tokens.js';

/** Everything a route or service needs, created once at start-up and passed down explicitly. */
export interface Ctx {
  config: Config;
  db: Db;
  tokens: TokenService;
  mailer: Mailer;
  google: GoogleVerifier;
  /** Null when no blockchain is configured; chain features then answer 503 CHAIN_DISABLED. */
  chain: ChainService | null;
  ipfs: IpfsStore;
}

export const PLATFORMS = ['alter', 'altera', 'altar', 'admin'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SELF_ROLES = ['creator', 'consumer', 'participant'] as const;
export const ALL_ROLES = [...SELF_ROLES, 'admin'] as const;
export type Role = (typeof ALL_ROLES)[number];
