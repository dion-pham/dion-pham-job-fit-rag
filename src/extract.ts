import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from './config.js';

export const Requirement = z.object({
  text: z.string().min(1),
  kind: z.enum(['required', 'nice_to_have']),
});
export type Requirement = z.infer<typeof Requirement>;

/**
 * Decision for you: this prompt decides what counts as "one requirement".
 * Too coarse ("strong engineering skills") and nothing matches well; too fine
 * and you get dozens of near-duplicates. Iterate on it and watch the evals.
 */
const SYSTEM_PROMPT = `You extract hiring requirements from job postings.

Return ONLY a JSON array. Each item is {"text": string, "kind": "required" | "nice_to_have"}.

Rules:
- One concrete skill, experience, or qualification per item.
- Rewrite each as a short standalone phrase (under 15 words), e.g. "Familiarity with relational databases like Postgres".
- Skip company boilerplate, benefits, salary, culture statements, and legal text.
- Use "nice_to_have" only when the posting marks it as preferred, a bonus, or a nice-to-have.`;

let client: Anthropic | undefined;

export async function extractRequirements(postingBody: string): Promise<Requirement[]> {
  client ??= new Anthropic({ apiKey: config.anthropicApiKey() });
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: postingBody }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return parseRequirements(text);
}

/** Models sometimes wrap JSON in a code fence despite instructions; strip it before parsing. */
export function parseRequirements(raw: string): Requirement[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return z.array(Requirement).parse(JSON.parse(cleaned));
}
