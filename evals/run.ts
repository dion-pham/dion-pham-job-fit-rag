import { readdir, readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { closePool } from '../src/db/client.js';
import { matchPosting } from '../src/match.js';
import { LabelFile } from './labels.js';

/**
 * Compares the matcher's "supported" calls against your hand labels.
 *
 * - precision: when it says SUPPORTED, how often you agree (false positives
 *   here are the dangerous kind: they'd tempt you to claim experience you lack)
 * - recall: of the requirements you really meet, how many it found
 *
 * Then it sweeps thresholds so you can pick MATCH_THRESHOLD from data.
 */
interface Row { requirement: string; truth: boolean; best: number; bestBullet: string }

try {
  const files = (await readdir('evals/labels').catch(() => [])).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error('No label files yet. Run npm run eval:template -- <posting-id> first.');

  const rows: Row[] = [];
  for (const file of files) {
    const labels = LabelFile.parse(JSON.parse(await readFile(`evals/labels/${file}`, 'utf8')));
    const results = await matchPosting(labels.postingId);
    const byText = new Map(results.map((r) => [r.text, r]));
    for (const label of labels.labels) {
      if (label.met === null) continue; // not labeled yet
      const result = byText.get(label.requirement);
      if (!result) {
        console.warn(`  "${label.requirement}" is no longer extracted; re-run eval:template after re-ingesting.`);
        continue;
      }
      rows.push({
        requirement: label.requirement,
        truth: label.met,
        best: result.hits[0]?.similarity ?? 0,
        bestBullet: result.hits[0]?.text ?? '',
      });
    }
  }
  if (rows.length === 0) throw new Error('No labeled requirements. Set "met" to true/false in your label files.');

  const score = (threshold: number) => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const r of rows) {
      const predicted = r.best >= threshold;
      if (predicted && r.truth) tp++;
      else if (predicted && !r.truth) fp++;
      else if (!predicted && r.truth) fn++;
      else tn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : 1;
    const recall = tp + fn ? tp / (tp + fn) : 1;
    return { tp, fp, fn, tn, precision, recall, accuracy: (tp + tn) / rows.length };
  };

  const current = score(config.matchThreshold);
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  console.log(`\nLabeled requirements: ${rows.length}`);
  console.log(`At threshold ${config.matchThreshold}: precision ${pct(current.precision)}, recall ${pct(current.recall)}, accuracy ${pct(current.accuracy)}`);

  console.log('\nThreshold sweep:');
  for (let t = 0.3; t <= 0.8001; t += 0.05) {
    const s = score(t);
    console.log(`  ${t.toFixed(2)}  precision ${pct(s.precision).padStart(4)}  recall ${pct(s.recall).padStart(4)}  false positives ${s.fp}`);
  }

  console.log('\nDisagreements at the current threshold:');
  for (const r of rows) {
    const predicted = r.best >= config.matchThreshold;
    if (predicted === r.truth) continue;
    const kind = predicted ? 'FALSE POSITIVE' : 'FALSE NEGATIVE';
    console.log(`  [${kind}] ${r.requirement}`);
    console.log(`      best ${r.best.toFixed(2)}: ${r.bestBullet.slice(0, 100)}…`);
  }
} finally {
  await closePool();
}
