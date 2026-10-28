import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { embed } from '../embed.js';
import { getPool, toVector } from '../db/client.js';

const ResumeFile = z.object({
  roles: z.array(z.object({ role: z.string(), bullets: z.array(z.string().min(1)) })),
});

/** Replaces all stored bullets with the contents of data/resume.json. */
export async function ingestResume(path = 'data/resume.json'): Promise<number> {
  const parsed = ResumeFile.parse(JSON.parse(await readFile(path, 'utf8')));
  const rows = parsed.roles.flatMap((r) => r.bullets.map((text) => ({ role: r.role, text })));
  const vectors = await embed(rows.map((r) => r.text));

  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Wiping bullets cascades to saved matches, which would be stale anyway.
    await client.query('DELETE FROM resume_bullets');
    for (const [i, row] of rows.entries()) {
      await client.query(
        'INSERT INTO resume_bullets (role, text, embedding) VALUES ($1, $2, $3)',
        [row.role, row.text, toVector(vectors[i])],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return rows.length;
}
