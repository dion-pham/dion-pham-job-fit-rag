import { mkdir, writeFile, access } from 'node:fs/promises';
import { closePool, getPool } from '../src/db/client.js';
import { labelPath, type LabelFile } from './labels.js';

/**
 * Writes evals/labels/<posting>.json with every extracted requirement and
 * "met": null. You fill in true/false by hand: does your real experience
 * honestly cover this requirement? That file is your ground truth.
 */
const postingId = process.argv[2];
try {
  if (!postingId) throw new Error('Usage: npm run eval:template -- <posting-id>');
  const pool = await getPool();
  const { rows } = await pool.query<{ text: string; kind: string }>(
    'SELECT text, kind FROM requirements WHERE posting_id = $1 ORDER BY id',
    [postingId],
  );
  if (rows.length === 0) throw new Error(`No requirements for ${postingId}.`);

  const file: LabelFile = {
    postingId,
    labels: rows.map((r) => ({ requirement: r.text, kind: r.kind, met: null, note: '' })),
  };
  const out = labelPath(postingId);
  const exists = await access(out).then(() => true, () => false);
  if (exists) throw new Error(`${out} already exists. Delete it first if you want a fresh template.`);
  await mkdir('evals/labels', { recursive: true });
  await writeFile(out, JSON.stringify(file, null, 2) + '\n');
  console.log(`Wrote ${out}. Set each "met" to true or false, then run npm run eval.`);
} finally {
  await closePool();
}
