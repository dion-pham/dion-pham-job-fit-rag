import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './client.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

const pool = await getPool();
await pool.query(await readFile(schemaPath, 'utf8'));
console.log('Schema ready.');
await closePool();
