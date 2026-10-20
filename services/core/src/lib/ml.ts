/**
 * Client for ALT's ML service (services/ml): the toxicity model and sentence embeddings. Internal only, behind the
 * service key. Every call is bounded by a short timeout and answers null when the service is down or slow, so
 * callers fall back to ALT's rules and nothing stops working without it.
 */
export type ToxicityLevel = 'none' | 'mild' | 'toxic' | 'severe';

export interface ToxicityResult {
  level: ToxicityLevel;
  categories: string[];
  scores: Record<string, number>;
}

export interface AnomalyResult {
  score: number;
  extreme: number;
  unusual: boolean;
  reasons: string[];
}

export interface AnomalyRun {
  model: string;
  trained_rows: number;
  thresholds: Record<string, number>;
  results: AnomalyResult[];
}

export interface MlClient {
  readonly model: string;
  toxicity(texts: string[]): Promise<ToxicityResult[] | null>;
  embed(texts: string[], kind?: 'passage' | 'query'): Promise<number[][] | null>;
  /** Abnormal behaviour: learns from `train` (rows of counts per feature), then judges each row of `score`. */
  anomaly?(features: string[], train: number[][], score: number[][]): Promise<AnomalyRun | null>;
}

export function createMlClient(baseUrl: string, serviceKey: string, warn: (msg: string) => void = () => {}, timeoutMs = 3000): MlClient {
  const url = baseUrl.replace(/\/$/, '');
  let lastWarn = 0;
  const post = async <T>(path: string, body: unknown, timeout = timeoutMs): Promise<T | null> => {
    try {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-alt-service-key': serviceKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (Date.now() - lastWarn > 60_000) {
        lastWarn = Date.now();
        warn(`ML service unavailable (${(err as Error).message}); using ALT's rules only`);
      }
      return null;
    }
  };
  return {
    model: 'unitary/toxic-bert, BAAI/bge-small-en-v1.5',
    async toxicity(texts) {
      const r = await post<{ results: ToxicityResult[] }>('/toxicity', { texts });
      return r?.results ?? null;
    },
    async embed(texts, kind = 'passage') {
      const r = await post<{ vectors: number[][] }>('/embed', { texts, kind });
      return r?.vectors ?? null;
    },
    async anomaly(features, train, score) {
      return post<AnomalyRun>('/anomaly', { features, train, score }, 60_000);
    },
  };
}
