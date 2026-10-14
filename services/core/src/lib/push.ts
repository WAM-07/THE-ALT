import { existsSync, readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import type { Db } from '../db.js';

/** A Firebase service account (the JSON file from Firebase console → Service accounts). */
export interface PushConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** FCM_SERVICE_ACCOUNT may be the JSON itself, a path to the file, or the JSON in base64. */
export function loadPushConfig(raw: string | undefined): PushConfig | null {
  if (!raw?.trim()) return null;
  const text = raw.trim().startsWith('{') ? raw : existsSync(raw.trim()) ? readFileSync(raw.trim(), 'utf8') : Buffer.from(raw.trim(), 'base64').toString('utf8');
  const j = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string };
  if (!j.project_id || !j.client_email || !j.private_key) throw new Error('FCM_SERVICE_ACCOUNT is not a Firebase service-account key.');
  return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Sends ALT inbox notifications to people's phones through Firebase Cloud Messaging (HTTP v1), so
 * they arrive while the app is closed. Off (does nothing) until a service account is configured.
 * Phones Firebase no longer knows are forgotten.
 */
export class PushSender {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: PushConfig | null,
    private readonly log: (message: string) => void = () => {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get enabled() {
    return this.config !== null;
  }

  /** Pushes one committed notification to every phone of its person. Returns how many were sent. */
  async sendNotification(notificationId: string) {
    if (!this.config) return 0;
    const { rows } = await this.db.query<{ user_id: string; title: string; body: string | null; category: string; platform: string; link: string | null }>(
      'SELECT user_id, title, body, category, platform, link FROM core.notifications WHERE id = $1',
      [notificationId],
    );
    const n = rows[0];
    if (!n) return 0;
    const { rows: devices } = await this.db.query<{ token: string }>('SELECT token FROM core.push_devices WHERE user_id = $1', [n.user_id]);
    let sent = 0;
    for (const d of devices) {
      const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.config.projectId}/messages:send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.accessToken()}` },
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title: n.title, body: n.body ?? '' },
            data: { notificationId, category: n.category, platform: n.platform, link: n.link ?? '' },
            android: { priority: 'HIGH' },
          },
        }),
      });
      if (res.ok) {
        sent++;
        continue;
      }
      const detail = await res.text().catch(() => '');
      // The app was uninstalled or the token rotated: forget this phone.
      if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(detail)) {
        await this.db.query('DELETE FROM core.push_devices WHERE token = $1', [d.token]);
      } else {
        this.log(`push failed (${res.status}): ${detail.slice(0, 200)}`);
      }
    }
    return sent;
  }

  /** A Google OAuth token for FCM, from the service account (cached until shortly before it expires). */
  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const c = this.config!;
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(c.clientEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(await importPKCS8(c.privateKey, 'RS256'));
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw new Error(`Google OAuth answered HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }
}
