import { AppError } from '../../lib/errors.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
}

export interface LlmOptions {
  temperature: number;
  maxTokens: number;
}

/** One way of turning a prompt into a reply. The persona engine tries providers in order. */
export interface LlmProvider {
  readonly name: string;
  complete(messages: LlmMessage[], options: LlmOptions): Promise<LlmResult>;
}

/** Any OpenAI-compatible chat completions API: Groq, DeepSeek, OpenRouter, a local model server... */
export function openAiCompatible(name: string, baseUrl: string, apiKey: string, model: string, fetchImpl: typeof fetch = fetch): LlmProvider {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  // Reasoning models (gpt-oss, as on Groq) count their thinking against max_tokens: unless it is kept
  // short and given room, a reply comes back empty or cut off mid-sentence.
  const reasoning = /gpt-oss/i.test(model);
  const ask = (messages: LlmMessage[], temperature: number, maxTokens: number) =>
    fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: reasoning ? maxTokens + REASONING_ALLOWANCE : maxTokens,
        ...(reasoning ? { reasoning_effort: 'low' } : {}),
      }),
      // Short enough that a stalled provider leaves time for the next one before the gateway gives up.
      signal: AbortSignal.timeout(20_000),
    });
  return {
    name,
    async complete(messages, { temperature, maxTokens }) {
      let res = await ask(messages, temperature, maxTokens);
      // Rate-limited for a moment ("try again in 1.5s"): wait once rather than skip to the next provider.
      if (res.status === 429) {
        const wait = retryAfterMs(res.headers.get('retry-after'), await res.clone().text().catch(() => ''));
        if (wait !== null && wait <= 5_000) {
          await new Promise((r) => setTimeout(r, wait));
          res = await ask(messages, temperature, maxTokens);
        }
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`${name} answered HTTP ${res.status}: ${detail}`);
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const text = body.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`${name} returned an empty reply`);
      return { text, provider: name, model: body.model ?? model, tokensIn: body.usage?.prompt_tokens, tokensOut: body.usage?.completion_tokens };
    },
  };
}

/** Extra tokens a reasoning model may spend thinking (with reasoning_effort "low") before it answers. */
export const REASONING_ALLOWANCE = 300;

/** How long a 429 asks us to wait, from Retry-After or Groq's "Please try again in 1.5s"; null if it doesn't say. */
export function retryAfterMs(header: string | null, body: string): number | null {
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header) * 1000);
  const m = body.match(/try again in (\d+(?:\.\d+)?)(ms|s)\b/i);
  if (!m) return null;
  return Math.ceil(Number(m[1]) * (m[2]!.toLowerCase() === 'ms' ? 1 : 1000));
}

/**
 * Development only: a predictable stand-in when no LLM key is configured, so every flow still works
 * offline. Replies are clearly marked so nobody mistakes them for the real thing.
 */
export function mockProvider(): LlmProvider {
  return {
    name: 'mock',
    async complete(messages) {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const name = system.match(/^You are (.+?) \(@/)?.[1] ?? 'your AI';
      const traits = system.match(/^Personality: (.+)\.$/m)?.[1];
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const posting = /Write one social media post/.test(system);
      const text = posting
        ? `[mock] ${name} here, sharing a thought${traits ? ` as someone ${traits.toLowerCase()}` : ''}: small steps add up. #ALT`
        : `[mock reply from ${name}${traits ? `, ${traits.toLowerCase()}` : ''}] You said: "${lastUser.slice(0, 160)}". ` +
          `Set GROQ_API_KEY (or another LLM provider) for real replies.`;
      return { text, provider: 'mock', model: 'mock-1' };
    },
  };
}

/** Tries each provider in order; the first good answer wins. */
export class LlmRouter {
  constructor(readonly providers: LlmProvider[]) {
    if (!providers.length) throw new Error('At least one LLM provider is required');
  }

  get names() {
    return this.providers.map((p) => p.name);
  }

  async complete(messages: LlmMessage[], options: LlmOptions): Promise<LlmResult> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.complete(messages, options);
      } catch (err) {
        errors.push(`${provider.name}: ${(err as Error).message}`);
      }
    }
    throw new AppError(503, 'AI_UNAVAILABLE', 'The AI could not answer right now. Try again in a moment.', { errors });
  }
}

export interface LlmConfig {
  providers: string[];
  groqApiKey?: string | undefined;
  groqModel: string;
  geminiApiKey?: string | undefined;
  geminiModel: string;
  deepseekApiKey?: string | undefined;
  deepseekModel: string;
  compatBaseUrl?: string | undefined;
  compatApiKey?: string | undefined;
  compatModel?: string | undefined;
}

export function createLlmRouter(cfg: LlmConfig): LlmRouter {
  const providers: LlmProvider[] = [];
  for (const name of cfg.providers) {
    if (name === 'groq' && cfg.groqApiKey) providers.push(openAiCompatible('groq', 'https://api.groq.com/openai/v1', cfg.groqApiKey, cfg.groqModel));
    // Gemini and DeepSeek both offer OpenAI-compatible endpoints.
    if (name === 'gemini' && cfg.geminiApiKey) {
      providers.push(openAiCompatible('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', cfg.geminiApiKey, cfg.geminiModel));
    }
    if (name === 'deepseek' && cfg.deepseekApiKey) providers.push(openAiCompatible('deepseek', 'https://api.deepseek.com', cfg.deepseekApiKey, cfg.deepseekModel));
    if (name === 'compat' && cfg.compatBaseUrl && cfg.compatApiKey && cfg.compatModel) {
      providers.push(openAiCompatible('compat', cfg.compatBaseUrl, cfg.compatApiKey, cfg.compatModel));
    }
    if (name === 'mock') providers.push(mockProvider());
  }
  return new LlmRouter(providers.length ? providers : [mockProvider()]);
}
