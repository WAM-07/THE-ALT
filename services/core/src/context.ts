import type { Config } from './config.js';
import type { Db } from './db.js';
import type { GoogleVerifier } from './modules/auth/google.js';
import type { ChainService } from './lib/chain.js';
import type { IpfsStore } from './lib/ipfs.js';
import type { LlmRouter } from './modules/ai/llm.js';
import type { NotificationHub } from './lib/notify.js';
import type { PushSender } from './lib/push.js';
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
  llm: LlmRouter;
  /** Pushes committed notifications to people's open streams. */
  hub: NotificationHub;
  /** Sends them to closed apps through Firebase Cloud Messaging (off until configured). */
  push: PushSender;
}

export const PLATFORMS = ['alter', 'altera', 'altar', 'admin'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SELF_ROLES = ['creator', 'consumer', 'participant'] as const;
// Staff roles (the ALT Portal): admin manages everything; moderators handle reports and flags,
// support handles requests and disputes, auditors only read.
export const ALL_ROLES = [...SELF_ROLES, 'admin', 'moderator', 'support', 'auditor'] as const;
export type Role = (typeof ALL_ROLES)[number];
