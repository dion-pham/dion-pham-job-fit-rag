import { z } from 'zod';

export const LabelFile = z.object({
  postingId: z.string(),
  labels: z.array(
    z.object({
      requirement: z.string(),
      kind: z.string(),
      met: z.boolean().nullable(),
      note: z.string().optional(),
    }),
  ),
});
export type LabelFile = z.infer<typeof LabelFile>;

/** Posting ids contain ":" (e.g. "file:notion-ai"), which some filesystems dislike. */
export const labelPath = (postingId: string) => `evals/labels/${postingId.replace(/[^a-z0-9-]+/gi, '_')}.json`;
