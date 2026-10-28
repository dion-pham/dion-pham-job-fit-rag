import { closePool, getPool, toVector } from './db/client.js';
import { embed } from './embed.js';
import { extractRequirements } from './extract.js';
import { ingestResume } from './ingest/resume.js';
import { loadPostings } from './ingest/postings.js';
import { matchPosting, printReport } from './match.js';

async function ingestPostings(): Promise<void> {
  const pool = await getPool();
  const postings = await loadPostings();
  if (postings.length === 0) {
    console.log('No postings found. Add data/postings/*.txt or set NOTION_TOKEN and NOTION_DATA_SOURCE_ID.');
    return;
  }

  for (const p of postings) {
    const requirements = await extractRequirements(p.body);
    const vectors = await embed(requirements.map((r) => r.text));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO postings (id, company, title, body, source) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET company = $2, title = $3, body = $4, ingested_at = now()`,
        [p.id, p.company, p.title, p.body, p.source],
      );
      // Re-extracting replaces old requirements (and their saved matches).
      await client.query('DELETE FROM requirements WHERE posting_id = $1', [p.id]);
      for (const [i, r] of requirements.entries()) {
        await client.query(
          'INSERT INTO requirements (posting_id, text, kind, embedding) VALUES ($1, $2, $3, $4)',
          [p.id, r.text, r.kind, toVector(vectors[i])],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    console.log(`${p.id}  ${p.company} — ${p.title}: ${requirements.length} requirements`);
  }
}

async function match(postingId: string | undefined): Promise<void> {
  const pool = await getPool();
  if (!postingId) {
    const { rows } = await pool.query('SELECT id, company, title FROM postings ORDER BY ingested_at DESC');
    console.log('Usage: npm run match -- <posting-id>\n');
    for (const r of rows) console.log(`  ${r.id}  ${r.company} — ${r.title}`);
    return;
  }
  const { rows } = await pool.query('SELECT company, title FROM postings WHERE id = $1', [postingId]);
  if (rows.length === 0) throw new Error(`Unknown posting ${postingId}.`);
  printReport(rows[0].company, rows[0].title, await matchPosting(postingId));
}

const [command, arg] = process.argv.slice(2);
try {
  switch (command) {
    case 'ingest-resume':
      console.log(`Stored ${await ingestResume()} bullets.`);
      break;
    case 'ingest-postings':
      await ingestPostings();
      break;
    case 'match':
      await match(arg);
      break;
    default:
      console.log('Commands: ingest-resume | ingest-postings | match <posting-id>');
  }
} finally {
  await closePool();
}
