import { config } from './config.js';
import { getPool, toVector } from './db/client.js';

export interface BulletHit {
  bulletId: number;
  role: string;
  text: string;
  similarity: number;
}

export interface RequirementResult {
  requirementId: number;
  text: string;
  kind: 'required' | 'nice_to_have';
  hits: BulletHit[];
  supported: boolean;
}

/**
 * For each requirement on a posting, retrieve the top-k most similar resume
 * bullets (cosine similarity via pgvector), save them, and call the requirement
 * "supported" if the best hit clears the threshold.
 */
export async function matchPosting(postingId: string): Promise<RequirementResult[]> {
  const pool = await getPool();
  const { rows: reqs } = await pool.query<{ id: number; text: string; kind: 'required' | 'nice_to_have'; embedding: string }>(
    'SELECT id, text, kind, embedding::text AS embedding FROM requirements WHERE posting_id = $1 ORDER BY id',
    [postingId],
  );
  if (reqs.length === 0) throw new Error(`No requirements for ${postingId}. Run ingest:postings first.`);

  const results: RequirementResult[] = [];
  for (const req of reqs) {
    // <=> is pgvector's cosine distance; similarity = 1 - distance.
    const { rows: hits } = await pool.query<{ id: number; role: string; text: string; similarity: number }>(
      `SELECT id, role, text, 1 - (embedding <=> $1) AS similarity
         FROM resume_bullets
        ORDER BY embedding <=> $1
        LIMIT $2`,
      [req.embedding, config.topK],
    );

    await pool.query('DELETE FROM matches WHERE requirement_id = $1', [req.id]);
    for (const [rank, hit] of hits.entries()) {
      await pool.query(
        'INSERT INTO matches (requirement_id, bullet_id, rank, similarity) VALUES ($1, $2, $3, $4)',
        [req.id, hit.id, rank + 1, hit.similarity],
      );
    }

    const best = hits[0]?.similarity ?? 0;
    results.push({
      requirementId: req.id,
      text: req.text,
      kind: req.kind,
      hits: hits.map((h) => ({ bulletId: h.id, role: h.role, text: h.text, similarity: Number(h.similarity) })),
      supported: best >= config.matchThreshold,
    });
  }
  return results;
}

export function printReport(company: string, title: string, results: RequirementResult[]): void {
  const supported = results.filter((r) => r.supported).length;
  console.log(`\n${company} — ${title}`);
  console.log(`${supported}/${results.length} requirements supported (threshold ${config.matchThreshold})\n`);
  for (const r of results) {
    const mark = r.supported ? 'SUPPORTED' : 'GAP      ';
    const tag = r.kind === 'nice_to_have' ? ' (nice to have)' : '';
    console.log(`[${mark}] ${r.text}${tag}`);
    const best = r.hits[0];
    if (best) console.log(`            best: ${best.similarity.toFixed(2)}  ${best.text.slice(0, 110)}…`);
  }
}

// Re-exported so callers that embed ad-hoc text can share the vector format.
export { toVector };
