/**
 * First line of the ethics layer (Module 16): fast rule-based checks on everything an AI says and on
 * personas before they are deployed. A model-based classifier is layered on top later; these rules
 * stay as a cheap, predictable floor.
 */
export interface ModerationResult {
  flagged: boolean;
  categories: string[];
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
  { category: 'impersonation', patterns: [/\bI am (a|an) (real )?human\b/i, /\bI('m| am) not an AI\b/i] },
];

export function moderate(text: string): ModerationResult {
  const categories = RULES.filter((r) => r.patterns.some((p) => p.test(text))).map((r) => r.category);
  return { flagged: categories.length > 0, categories };
}

/** Text a person sees instead of a flagged AI reply. */
export const FLAGGED_REPLY = "I can't help with that. Let's talk about something else.";
