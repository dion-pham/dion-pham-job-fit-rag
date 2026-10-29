import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import mammoth from 'mammoth';
import { z } from 'zod';
import { config } from '../config.js';
import { anthropic, usageOf, type ExtractionUsage } from '../extract.js';
import type { Resume } from './resume.js';

const ParsedResume = z.object({
  roles: z.array(z.object({ role: z.string(), bullets: z.array(z.string()) })),
});

/**
 * Bullets are retrieval chunks and the whole point is honest matching, so the
 * prompt asks Claude to copy text, not improve it. Review the result in the UI
 * before saving.
 */
const SYSTEM_PROMPT = `You convert a resume into structured bullets for a matching tool.

Group the content into sections. Each section has a "role" label and a list of "bullets".
- For each job, the role is "<Title>, <Company>", e.g. "Sales Engineer II, QA Wolf".
- Projects, education, certifications, and skills each get their own section, e.g. "Projects", "Skills".
- Copy each bullet's wording exactly. Do not rewrite, shorten, merge, or invent anything.
- Lists of skills become one bullet per line or category as written, e.g. "Languages: TypeScript, Python, SQL".
- Skip contact details, headers, dates, and locations.`;

const MAX_BYTES = 10 * 1024 * 1024;

/** Turns an uploaded resume (PDF, DOCX, TXT, or MD) into role-grouped bullets using Claude. */
export async function parseResumeFile(
  filename: string,
  data: Buffer,
): Promise<{ resume: Resume; usage: ExtractionUsage }> {
  if (data.length > MAX_BYTES) throw new Error('Resume file is over 10 MB.');

  const ext = path.extname(filename).toLowerCase();
  let content: Anthropic.ContentBlockParam;
  if (ext === '.pdf') {
    // Claude reads PDFs directly, layout included.
    content = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') },
    };
  } else if (ext === '.docx') {
    content = { type: 'text', text: (await mammoth.extractRawText({ buffer: data })).value };
  } else if (ext === '.txt' || ext === '.md') {
    content = { type: 'text', text: data.toString('utf8') };
  } else {
    throw new Error('Upload a .pdf, .docx, .txt, or .md file.');
  }

  const response = await anthropic().messages.parse({
    model: config.claudeModel,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [content, { type: 'text', text: 'Extract this resume.' }] }],
    output_config: { format: zodOutputFormat(ParsedResume) },
  });
  if (!response.parsed_output) throw new Error(`Claude couldn't parse the resume (stop reason: ${response.stop_reason}).`);

  // Drop empty sections and blank bullets so the result passes ResumeFile validation.
  const roles = response.parsed_output.roles
    .map((r) => ({ role: r.role.trim(), bullets: r.bullets.map((b) => b.trim()).filter(Boolean) }))
    .filter((r) => r.role && r.bullets.length > 0);
  return { resume: { roles }, usage: usageOf(response.usage) };
}
