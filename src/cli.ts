import { closePool, getPool } from './db/client.js';
import { ingestResume } from './ingest/resume.js';
import { loadPostings, storePosting } from './ingest/postings.js';
import { matchPosting, printReport } from './match.js';

async function ingestPostings(): Promise<void> {
  const postings = await loadPostings();
  if (postings.length === 0) {
    console.log('No postings found. Add data/postings/*.txt or set NOTION_TOKEN and NOTION_DATA_SOURCE_ID.');
    return;
  }

  for (const p of postings) {
    const { count, usage } = await storePosting(p);
    const cost = usage.costUsd === null ? '' : `, $${usage.costUsd.toFixed(4)}`;
    console.log(`${p.id}  ${p.company} — ${p.title}: ${count} requirements (${usage.inputTokens} in / ${usage.outputTokens} out tokens${cost})`);
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
