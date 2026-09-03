import type { ActionFreq, Day, DrillScenario, GradeTier } from '@poker/engine';

/**
 * The shapes and vocabularies Session Review is built on, with no imports
 * beyond the engine.
 *
 * In its own file for the same reason `lib/progress/types.ts` is: `queries.ts`
 * pulls in the server Supabase client, and the filter bar and the attempt row
 * are client components. A *type* import from there is erased at build time and
 * works — right up until one value import comes with it, at which point Next
 * tries to bundle `next/headers` for the browser and the whole route 500s.
 *
 * That is not hypothetical. It happened here: `REVIEW_MODES` was a value import
 * in `filter-bar.tsx`, and `/review` returned 500 until this file existed. The
 * accessibility scan is what caught it, by way of a document with no `<title>`.
 */

export const REVIEW_MODES = [
  'quick',
  'focused',
  'weak_spots',
  'lesson',
  'study',
  'placement',
] as const;

export type ReviewMode = (typeof REVIEW_MODES)[number];

export interface ReviewFilters {
  mode?: ReviewMode | undefined;
  grade?: GradeTier | undefined;
  skillTag?: string | undefined;
  /** Inclusive, in the reader's own zone. */
  from?: Day | undefined;
  to?: Day | undefined;
}

export interface SessionRow {
  id: string;
  mode: string;
  startedAt: string;
  completedAt: string | null;
  spots: number;
}

export interface AttemptRow {
  id: string;
  sessionId: string | null;
  createdAt: string;
  day: Day;
  scenario: DrillScenario;
  hand: string;
  userAction: string;
  userSize: number | null;
  /** The distribution this answer was graded against, as stored. */
  frequencies: readonly ActionFreq[];
  grade: GradeTier;
  evLoss: number;
  responseMs: number | null;
  skillTags: readonly string[];
  chartVersion: string;
}
