import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { config } from './config.js';
import { getPool } from './db/client.js';
import { storePosting } from './ingest/postings.js';
import { parseResumeFile } from './ingest/parse-resume.js';
import { readResume, saveResume, type Resume } from './ingest/resume.js';
import { matchPosting } from './match.js';

/**
 * A small local web UI over the same pipeline the CLI uses. Pasted postings are
 * also written to data/postings/<slug>.txt, so `npm run match` and the evals
 * see them under the same file:<slug> id.
 */
const PORT = Number(process.env.PORT ?? 3000);

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function report(postingId: string) {
  const pool = await getPool();
  const { rows } = await pool.query('SELECT id, company, title FROM postings WHERE id = $1', [postingId]);
  if (rows.length === 0) throw new Error(`Unknown posting ${postingId}.`);
  return { ...rows[0], threshold: config.matchThreshold, results: await matchPosting(postingId) };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(await readFile(new URL('./web/index.html', import.meta.url)));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/postings') {
    const pool = await getPool();
    const { rows } = await pool.query('SELECT id, company, title FROM postings ORDER BY ingested_at DESC');
    return send(res, 200, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/report') {
    return send(res, 200, await report(url.searchParams.get('id') ?? ''));
  }

  if (req.method === 'POST' && url.pathname === '/api/match') {
    const body = await readJson(req);
    const company = String(body.company ?? '').trim();
    const title = String(body.title ?? '').trim();
    const description = String(body.description ?? '').trim();
    if (!company || !title || !description) {
      return send(res, 400, { error: 'Company, title, and the job description are all required.' });
    }

    const slug = slugify(`${company} ${title}`);
    await mkdir('data/postings', { recursive: true });
    await writeFile(`data/postings/${slug}.txt`, `Company: ${company}\nTitle: ${title}\n\n${description}\n`);

    const id = `file:${slug}`;
    const { usage } = await storePosting({ id, company, title, body: description, source: 'file' });
    return send(res, 200, { ...(await report(id)), usage });
  }

  if (req.method === 'GET' && url.pathname === '/api/resume') {
    return send(res, 200, await readResume());
  }

  // Parse only: the browser shows the result for review, then PUTs it back to save.
  if (req.method === 'POST' && url.pathname === '/api/resume/parse') {
    const body = await readJson(req);
    const filename = String(body.filename ?? '');
    const data = Buffer.from(String(body.data ?? ''), 'base64');
    if (!filename || data.length === 0) return send(res, 400, { error: 'Choose a resume file first.' });
    return send(res, 200, await parseResumeFile(filename, data));
  }

  if (req.method === 'PUT' && url.pathname === '/api/resume') {
    const count = await saveResume((await readJson(req)) as Resume);
    return send(res, 200, { count });
  }

  send(res, 404, { error: 'Not found' });
}

createServer((req, res) => {
  handle(req, res).catch((err: Error) => {
    console.error(err);
    send(res, 500, { error: err.message });
  });
}).listen(PORT, () => console.log(`job-fit-rag UI on http://localhost:${PORT}`));
