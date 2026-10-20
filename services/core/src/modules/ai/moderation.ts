import type { MlClient, ToxicityLevel } from '../../lib/ml.js';

/**
 * The ethics layer (Module 16), in two parts. Fast rule-based checks (below) are a cheap, predictable floor and
 * catch what models miss (an AI claiming to be human, private data, dehumanising wording). On top, the toxicity
 * model in ALT's ML service (`checkSafety`) scores insults, obscenity, threats and identity-based hate.
 */
export interface ModerationResult {
  flagged: boolean;
  categories: string[];
}

export interface SafetyCheck extends ModerationResult {
  /** The model's level ("none" when it was not consulted or found nothing). */
  level: ToxicityLevel;
  /** Borderline: not blocked, but a person sending it privately is asked to confirm. */
  warn: boolean;
  /** What decided: ALT's rules alone (model unavailable) or rules and the toxicity model. */
  source: 'rules' | 'rules+model';
  scores?: Record<string, number>;
}

/**
 * Rules plus the toxicity model. `flagged` (blocked) when a rule hits or the model says "toxic" or "severe";
 * `warn` when the model says "mild". Without the ML service it is exactly `moderate()`.
 */
export async function checkSafety(ml: MlClient | null, text: string): Promise<SafetyCheck> {
  const rules = moderate(text);
  const model = ml && text.trim() ? (await ml.toxicity([text]))?.[0] ?? null : null;
  if (!model) return { ...rules, level: 'none', warn: false, source: 'rules' };
  const blocking = model.level === 'toxic' || model.level === 'severe';
  const categories = [...new Set([...rules.categories, ...(blocking ? model.categories : [])])];
  const flagged = rules.flagged || blocking;
  return { flagged, categories, level: model.level, warn: !flagged && model.level === 'mild', source: 'rules+model', scores: model.scores };
}

const RULES: { category: string; patterns: RegExp[] }[] = [
  {
    category: 'violence',
    patterns: [/\b(kill|murder|shoot|stab|bomb)\s+(him|her|them|you|people|everyone|myself)\b/i, /\bhow to (make|build) (a )?(bomb|explosive|gun)\b/i],
  },
  { category: 'self_harm', patterns: [/\b(kill|hurt|harm)\s+myself\b/i, /\bsuicide (method|plan)s?\b/i] },
  { category: 'hate', patterns: [/\b(all|those)\s+\w+\s+(are|should be)\s+(vermin|subhuman|exterminated)\b/i] },
  { category: 'sexual_minors', patterns: [/\b(child|minor|underage)\b.{0,40}\b(sex|nude|explicit)\b/i] },
  {
    category: 'private_data',
    patterns: [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/, /(?:\+?\d[\s-]?){10,14}\d/, /\b(password|passcode|seed phrase|private key)\s*(is|:)\s*\S+/i],
  },
  {
    category: 'impersonation',
    patterns: [/\bI(?:'m| am) (?:a |an )?(?:real |actual )?(?:human|person)\b/i, /\bI(?:'m| am) not (?:an? )?(?:AI|bot|robot|machine)\b/i],
  },
];

/** Phones type curly quotes (I’m); the rules are written with straight ones. */
const normalise = (text: string) => text.replace(/[‘’‛′`´]/g, "'");

export function moderate(text: string): ModerationResult {
  const clean = normalise(text);
  const categories = RULES.filter((r) => r.patterns.some((p) => p.test(clean))).map((r) => r.category);
  return { flagged: categories.length > 0, categories };
}

/** Text a person sees instead of a flagged AI reply. */
export const FLAGGED_REPLY = "I can't help with that. Let's talk about something else.";
