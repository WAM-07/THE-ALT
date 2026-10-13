import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

const DIR = new URL('../../../public/account/', import.meta.url);
const FILES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'account.js': 'text/javascript; charset=utf-8',
  'account.css': 'text/css; charset=utf-8',
};

// A sign-in page must never be framed (clickjacking), may only run its own script, and talks only
// to ALT. It is opened as a popup, so it keeps its opener (COOP unsafe-none) to post the code back.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "connect-src 'self'",
  "img-src 'self' data:",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The ALT Account window: "Continue with ALT" in ALTER, ALTERA and ALTAR opens /core/account/.
 * Static files; the page calls Core's public auth API through the gateway.
 */
export async function accountPageRoutes(app: FastifyInstance) {
  const send = (name: string) => async (_req: unknown, reply: import('fastify').FastifyReply) => {
    const body = await readFile(new URL(name, DIR));
    return reply
      .header('content-type', FILES[name]!)
      .header('content-security-policy', CSP)
      .header('cross-origin-opener-policy', 'unsafe-none')
      .header('cache-control', 'no-cache')
      .send(body);
  };
  // Always opened as /core/account/ (with the slash) so the page's relative links resolve.
  app.get('/account/', { schema: { hide: true } }, send('index.html'));
  app.get('/account/account.js', { schema: { hide: true } }, send('account.js'));
  app.get('/account/account.css', { schema: { hide: true } }, send('account.css'));
}
