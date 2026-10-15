import type { Ctx } from '../context.js';
import { AppError } from './errors.js';

/**
 * Calls another ALT service's /internal API as ALT Core (shared service key). Each service owns its
 * data, so removing an ALTERA post or an ALTAR review is that service's job, asked for by Core.
 */
export async function callService(ctx: Ctx, service: 'altera' | 'altar', path: string, body: unknown) {
  const base = ctx.config.services[service];
  if (!base) throw new AppError(503, 'SERVICE_NOT_CONFIGURED', `ALT Core doesn't know where ${service.toUpperCase()} runs.`);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-alt-service': 'core', 'x-alt-service-key': ctx.config.internalServiceKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(502, 'SERVICE_UNAVAILABLE', `${service.toUpperCase()} is not responding right now.`);
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string }; message?: string; code?: string } | null;
  if (!res.ok) {
    throw new AppError(res.status === 404 ? 404 : 502, data?.error?.code ?? data?.code ?? 'SERVICE_ERROR', data?.error?.message ?? data?.message ?? `${service.toUpperCase()} answered HTTP ${res.status}.`);
  }
  return data;
}
