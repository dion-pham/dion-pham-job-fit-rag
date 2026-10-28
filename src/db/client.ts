import pg from 'pg';
import pgvector from 'pgvector';
import { config } from '../config.js';

let pool: pg.Pool | undefined;

export async function getPool(): Promise<pg.Pool> {
  if (!pool) pool = new pg.Pool({ connectionString: config.databaseUrl() });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * pgvector expects a '[1,2,3]' literal. We only ever write vectors and read back
 * similarity scores, so we don't need to register the vector type for reads.
 */
export const toVector = (values: number[]) => pgvector.toSql(values);
