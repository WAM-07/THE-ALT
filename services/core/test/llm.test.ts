import { describe, expect, it } from 'vitest';
import { openAiCompatible, REASONING_ALLOWANCE, retryAfterMs } from '../src/modules/ai/llm.js';

/** A stand-in for fetch that answers from a list and records each request body. */
function fakeFetch(answers: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const sent: Array<Record<string, unknown>> = [];
  const impl = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    const a = answers.shift()!;
    return new Response(JSON.stringify(a.body), { status: a.status, headers: a.headers });
  }) as unknown as typeof fetch;
  return { impl, sent };
}
const ok = (text: string) => ({ status: 200, body: { choices: [{ message: { content: text } }], model: 'm' } });
const ask = [{ role: 'user' as const, content: 'hi' }];

describe('the LLM client', () => {
  it('gives reasoning models (gpt-oss) a low effort and room to think, and leaves other models alone', async () => {
    const r = fakeFetch([ok('Hello!')]);
    await openAiCompatible('groq', 'https://x', 'k', 'openai/gpt-oss-120b', r.impl).complete(ask, { temperature: 0.7, maxTokens: 180 });
    expect(r.sent[0]).toMatchObject({ reasoning_effort: 'low', max_tokens: 180 + REASONING_ALLOWANCE });

    const p = fakeFetch([ok('Hello!')]);
    await openAiCompatible('gemini', 'https://x', 'k', 'gemini-flash-latest', p.impl).complete(ask, { temperature: 0.7, maxTokens: 180 });
    expect(p.sent[0]!.max_tokens).toBe(180);
    expect(p.sent[0]).not.toHaveProperty('reasoning_effort');
  });

  it('waits once when rate-limited for a moment, instead of giving up on the provider', async () => {
    const r = fakeFetch([{ status: 429, body: { error: { message: 'Rate limit reached. Please try again in 20ms.' } } }, ok('Back again')]);
    const out = await openAiCompatible('groq', 'https://x', 'k', 'llama', r.impl).complete(ask, { temperature: 0.7, maxTokens: 100 });
    expect(out.text).toBe('Back again');
    expect(r.sent).toHaveLength(2);

    // A long wait is left to the next provider.
    const slow = fakeFetch([{ status: 429, body: { error: { message: 'Please try again in 2m10s.' } } }]);
    await expect(openAiCompatible('groq', 'https://x', 'k', 'llama', slow.impl).complete(ask, { temperature: 0.7, maxTokens: 100 })).rejects.toThrow(/429/);
  });

  it('reads how long to wait from Retry-After or the message', () => {
    expect(retryAfterMs('2', '')).toBe(2000);
    expect(retryAfterMs(null, 'Please try again in 1.5s.')).toBe(1500);
    expect(retryAfterMs(null, 'try again in 340ms')).toBe(340);
    expect(retryAfterMs(null, 'slow down')).toBeNull();
  });
});
