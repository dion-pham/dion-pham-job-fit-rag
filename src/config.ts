import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export const config = {
  databaseUrl: () => required('DATABASE_URL'),
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  notionToken: process.env.NOTION_TOKEN || '',
  notionDataSourceId: process.env.NOTION_DATA_SOURCE_ID || '',
  matchThreshold: Number(process.env.MATCH_THRESHOLD ?? 0.5),
  topK: Number(process.env.TOP_K ?? 3),
};

/** all-MiniLM-L6-v2 produces 384-dimensional vectors. Change schema.sql if you swap models. */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;
