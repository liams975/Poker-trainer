import type { ProgressRow } from '@poker/engine';

import { getCharts } from '@/lib/charts/registry';
import { fetchDrillTemplates } from '@/lib/drills/queries';
import { createClient } from '@/lib/supabase/server';

import { toTrack, type StoredTrack, type TrackRow } from './map';

/**
 * Loading the track, the reader's progress, and their placement.
 *
 * RLS does all the scoping: `tracks` is gated on `published` and cascades that
 * to modules and lessons, while `lesson_progress` and `profiles` return the
 * caller's own rows only. None of these queries names a user id, and adding one
 * would suggest the policies were optional.
 */

const TRACK_SELECT = `
  slug, title, description, sort_order, published,
  modules ( slug, title, sort_order,
    lessons ( id, slug, title, body, skill_tags, sort_order, version ) )
`;

export async function fetchTrack(): Promise<StoredTrack> {
  const supabase = await createClient();
  const [{ registry }, templates] = await Promise.all([getCharts(), fetchDrillTemplates()]);

  const { data, error } = await supabase
    .from('tracks')
    .select(TRACK_SELECT)
    .order('sort_order')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`could not load the track: ${error.message}`);
  if (!data) {
    throw new Error(
      'no published track is visible. Run `pnpm content:sync` against this database.',
    );
  }

  return toTrack(data as unknown as TrackRow, {
    registry,
    templates: templates.map((entry) => entry.template),
  });
}

export interface ReaderState {
  progress: readonly ProgressRow[];
  placementSkillTag: string | null;
  onboardingCompleted: boolean;
}

/**
 * Everything about *this* reader that the unlock rule needs.
 *
 * `placement_skill_tag` is read here and never written from the browser — it
 * unlocks content, and docs/01-architecture.md §3 allows client-computed values
 * only where they "never gate money or unlock content".
 */
export async function fetchReaderState(lessonIds: ReadonlyMap<string, string>): Promise<ReaderState> {
  const supabase = await createClient();

  const [progressResult, profileResult] = await Promise.all([
    supabase.from('lesson_progress').select('lesson_id, status'),
    supabase.from('profiles').select('placement_skill_tag, onboarding_completed_at').maybeSingle(),
  ]);

  if (progressResult.error) {
    throw new Error(`could not load progress: ${progressResult.error.message}`);
  }

  // The engine works in slugs; the database works in ids. Resolving here keeps
  // the id out of the pure layer entirely.
  const slugById = new Map([...lessonIds].map(([slug, id]) => [id, slug]));

  const progress = (progressResult.data ?? []).flatMap((row) => {
    const lessonSlug = slugById.get(row.lesson_id as string);
    // A row for a lesson this track no longer has is history, not an error.
    return lessonSlug === undefined
      ? []
      : [{ lessonSlug, status: row.status as ProgressRow['status'] }];
  });

  return {
    progress,
    placementSkillTag: (profileResult.data?.placement_skill_tag as string | null) ?? null,
    onboardingCompleted: profileResult.data?.onboarding_completed_at !== null &&
      profileResult.data?.onboarding_completed_at !== undefined,
  };
}

/**
 * Whether this reader has been through onboarding.
 *
 * Deliberately separate from `fetchReaderState`, which needs the track loaded
 * first. The dashboard decides whether to send someone to onboarding, and that
 * decision must not depend on the curriculum loading — a content problem should
 * not silently mean "already onboarded", which is the direction the combined
 * version failed in.
 *
 * An unreadable profile counts as *not* onboarded: the cost is one skippable
 * screen, against never offering placement at all.
 */
export async function fetchOnboardingCompleted(): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .maybeSingle();

  if (error || !data) return false;

  return data.onboarding_completed_at !== null;
}
