import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { embed } from '../embed.js';
import { getPool, toVector } from '../db/client.js';

export const ResumeFile = z.object({
  roles: z.array(z.object({ role: z.string(), bullets: z.array(z.string().min(1)) })),
});

export type Resume = z.infer<typeof ResumeFile>;

const RESUME_PATH = 'data/resume.json';
const RESUME_NOTE =
  'Your master resume bullets. Each bullet is one retrieval chunk. Edit freely, then re-run `npm run ingest:resume`.';

export async function readResume(path = RESUME_PATH): Promise<Resume> {
  return ResumeFile.parse(JSON.parse(await readFile(path, 'utf8')));
}

/**
 * Writes data/resume.json (keeping the old one as data/resume.previous.json)
 * and re-embeds it. Saved matches are wiped, so every report re-matches
 * against the new bullets the next time it's opened.
 */
export async function saveResume(resume: Resume, path = RESUME_PATH): Promise<number> {
  // resume_bullets.text is UNIQUE, so keep only the first copy of a repeated bullet.
  const seen = new Set<string>();
  const parsed = ResumeFile.parse({
    roles: resume.roles
      .map((r) => ({ role: r.role.trim(), bullets: r.bullets.map((b) => b.trim()).filter((b) => b && !seen.has(b) && seen.add(b)) }))
      .filter((r) => r.role && r.bullets.length > 0),
  });
  if (parsed.roles.length === 0) throw new Error('The resume has no bullets.');
  await copyFile(path, path.replace(/\.json$/, '.previous.json')).catch(() => {});
  await writeFile(path, JSON.stringify({ _note: RESUME_NOTE, ...parsed }, null, 2) + '\n');
  return ingestResume(path);
}

/** Replaces all stored bullets with the contents of data/resume.json. */
export async function ingestResume(path = RESUME_PATH): Promise<number> {
  const parsed = await readResume(path);
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
