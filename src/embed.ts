import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_MODEL, EMBEDDING_DIM } from './config.js';

/**
 * Local embeddings with transformers.js: no API key, no per-call cost.
 * The model downloads once (~90 MB) and is cached after that.
 *
 * Decision for you: a small local model is cheap and private, but a hosted
 * embedding model may separate "similar wording" from "same skill" better.
 * Swap it in here and compare the two with `npm run eval`.
 */
let extractor: FeatureExtractionPipeline | undefined;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) extractor = await pipeline('feature-extraction', EMBEDDING_MODEL);
  return extractor;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = await getExtractor();
  const output = await model(texts, { pooling: 'mean', normalize: true });
  const vectors = output.tolist() as number[][];
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(`Expected ${EMBEDDING_DIM}-dim embeddings, got ${v.length}. Update schema.sql.`);
    }
  }
  return vectors;
}
