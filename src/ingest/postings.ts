import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, collectPaginatedAPI, isFullBlock, isFullPage } from '@notionhq/client';
import { config } from '../config.js';
import { getPool, toVector } from '../db/client.js';
import { embed } from '../embed.js';
import { extractRequirements, type ExtractionUsage } from '../extract.js';

export interface Posting {
  id: string;
  company: string;
  title: string;
  body: string;
  source: 'notion' | 'file';
}

/** Reads postings from Notion when configured, otherwise from data/postings/*.txt. */
export async function loadPostings(): Promise<Posting[]> {
  if (config.notionToken && config.notionDataSourceId) return loadFromNotion();
  return loadFromFiles();
}

// ---------------------------------------------------------------------------
// Local files: data/postings/<slug>.txt
//
//   Company: Notion
//   Title: Early Career AI Engineer
//
//   <paste the job description here>
// ---------------------------------------------------------------------------
export async function loadFromFiles(dir = 'data/postings'): Promise<Posting[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.txt'));
  const postings: Posting[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    const [header, ...rest] = raw.split(/\r?\n\r?\n/);
    const field = (name: string) =>
      header.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1].trim() ?? '';
    const body = rest.join('\n\n').trim();
    if (!field('Company') || !field('Title') || !body) {
      console.warn(`Skipping ${file}: needs "Company:" and "Title:" lines, a blank line, then the posting.`);
      continue;
    }
    postings.push({
      id: `file:${path.basename(file, '.txt')}`,
      company: field('Company'),
      title: field('Title'),
      body,
      source: 'file',
    });
  }
  return postings;
}

// ---------------------------------------------------------------------------
// Notion: one page per posting in a job-tracker database.
// Expected properties: "Company" and "Role" (title or text). The job
// description goes in the page body.
// ---------------------------------------------------------------------------
type PropertyValue = { type: string; title?: { plain_text: string }[]; rich_text?: { plain_text: string }[] };

function propertyText(prop: PropertyValue | undefined): string {
  const parts = prop?.title ?? prop?.rich_text ?? [];
  return parts.map((p) => p.plain_text).join('').trim();
}

async function pageBodyText(notion: Client, pageId: string): Promise<string> {
  const blocks = await collectPaginatedAPI(notion.blocks.children.list, { block_id: pageId });
  const lines: string[] = [];
  for (const block of blocks) {
    if (!isFullBlock(block)) continue;
    // Most text blocks (paragraph, headings, list items, quotes) store text in
    // block[block.type].rich_text. Nested children are skipped for now.
    const content = (block as unknown as Record<string, { rich_text?: { plain_text: string }[] }>)[block.type];
    const text = content?.rich_text?.map((t) => t.plain_text).join('') ?? '';
    if (text.trim()) lines.push(text);
  }
  return lines.join('\n');
}

export async function loadFromNotion(): Promise<Posting[]> {
  const notion = new Client({ auth: config.notionToken });
  const pages = await collectPaginatedAPI(notion.dataSources.query, {
    data_source_id: config.notionDataSourceId,
  });

  const postings: Posting[] = [];
  for (const page of pages) {
    if (!isFullPage(page)) continue;
    const props = page.properties as Record<string, PropertyValue>;
    const company = propertyText(props['Company']);
    const title = propertyText(props['Role']);
    const body = await pageBodyText(notion, page.id);
    if (!company || !title || !body) {
      console.warn(`Skipping Notion page ${page.id}: needs Company, Role, and a description in the page body.`);
      continue;
    }
    postings.push({ id: `notion:${page.id}`, company, title, body, source: 'notion' });
  }
  return postings;
}

// ---------------------------------------------------------------------------
// Storing: extract requirements with Claude, embed them, and replace whatever
// was stored for this posting before. Shared by the CLI and the web server.
// ---------------------------------------------------------------------------
export async function storePosting(p: Posting): Promise<{ count: number; usage: ExtractionUsage }> {
  const { requirements, usage } = await extractRequirements(p.body);
  const vectors = await embed(requirements.map((r) => r.text));

  const pool = await getPool();
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
  return { count: requirements.length, usage };
}
