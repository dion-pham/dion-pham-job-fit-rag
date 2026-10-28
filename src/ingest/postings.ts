import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, collectPaginatedAPI, isFullBlock, isFullPage } from '@notionhq/client';
import { config } from '../config.js';

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
