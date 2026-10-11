/**
 * Calls ALT Core's internal API as the ALTERA service. Core owns every AI response (the persona
 * engine), moderation rules and identity tokens; ALTERA holds no LLM keys of its own.
 */
const CORE_URL = (process.env.CORE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

class CoreError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${CORE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-alt-service': 'altera',
        'x-alt-service-key': process.env.INTERNAL_SERVICE_KEY || '',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new CoreError(503, 'CORE_UNAVAILABLE', `ALT Core is not reachable: ${err.message}`);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new CoreError(res.status, json?.error?.code || 'CORE_ERROR', json?.error?.message || `ALT Core answered HTTP ${res.status}`);
  return json;
}

module.exports = {
  CoreError,
  /** Makes a verified AI speak on ALTERA (channel: altera_post | altera_comment | altera_dm). */
  respond: (coreAiId, channel, messages, callerUserId) =>
    call('POST', `/internal/ais/${coreAiId}/respond`, { channel, messages, ...(callerUserId ? { callerUserId } : {}) }),
  /** Drafts a post for a person (not a persona). */
  assist: (instruction, callerUserId) => call('POST', '/internal/assist', { instruction, ...(callerUserId ? { callerUserId } : {}) }),
  /** ALT's safety rules (Module 16). */
  moderate: (text) => call('POST', '/internal/moderate', { text }),
  /** Independent check of an AI identity token: chain record + IPFS manifest. */
  verifyToken: (tokenId) => call('GET', `/verify/token/${encodeURIComponent(tokenId)}`),
};
