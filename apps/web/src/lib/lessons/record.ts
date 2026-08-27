import type { LessonStatus, PlacementAttempt, TagEvidence } from '@poker/engine';
import { LESSON_STATUSES, lessonStates, placeFrom, placementOrder } from '@poker/engine';

import { fetchDrillTemplates } from '@/lib/drills/queries';
import { createClient } from '@/lib/supabase/server';

import { fetchReaderState, fetchTrack } from './queries';

/**
 * Writing progress, and deciding placement.
 *
 * Reached through Route Handlers (`app/api/lessons/*`, `app/api/onboarding/*`)
 * rather than Server Actions, for the reason Phase 7 documented: Next
 * serialises actions through the router queue and drops concurrent dispatches.
 * One write path, one set of rules.
 *
 * **Placement is computed here, never accepted from the caller.**
 * docs/01-architecture.md §3 permits client-computed values in v1 on one
 * condition — that they "never gate money or unlock content". Placement unlocks
 * content. So the browser may ask for a placement, and cannot state one: the
 * result is derived from `drill_attempts` rows the server itself graded and
 * wrote during Phase 7's diagnostic.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new Error(message);
}

export interface SetLessonStatusInput {
  lessonSlug: string;
  status: LessonStatus;
}

export interface RecordedProgress {
  lessonSlug: string;
  status: LessonStatus;
}

export async function setLessonStatus(
  userId: string,
  input: SetLessonStatusInput,
): Promise<RecordedProgress> {
  if (typeof input.lessonSlug !== 'string' || input.lessonSlug.length === 0) {
    fail('lessonSlug must be a string');
  }
  if (!LESSON_STATUSES.includes(input.status)) fail(`unknown lesson status ${input.status}`);
  if (input.status === 'locked') fail('a reader cannot lock a lesson');

  const supabase = await createClient();
  const { track, lessonIds } = await fetchTrack();

  const lessonId = lessonIds.get(input.lessonSlug);
  if (lessonId === undefined) fail(`no lesson named ${input.lessonSlug}`);

  /**
   * You cannot finish a lesson you cannot open.
   *
   * Without this, posting a completion for the last lesson unlocks the whole
   * track — the ordering would be advisory, enforced only by which links the UI
   * happened to render. The state is recomputed here from stored rows rather
   * than taken from the request.
   */
  const reader = await fetchReaderState(lessonIds);
  const current = lessonStates({
    track,
    progress: reader.progress,
    placementSkillTag: reader.placementSkillTag,
  }).get(input.lessonSlug);

  if (current === 'locked') {
    fail(`${input.lessonSlug} is not unlocked yet`);
  }

  const { error } = await supabase.from('lesson_progress').upsert(
    {
      user_id: userId,
      lesson_id: lessonId,
      status: input.status,
      completed_at: input.status === 'completed' ? new Date().toISOString() : null,
    },
    { onConflict: 'user_id,lesson_id' },
  );

  if (error) fail(`could not save progress: ${error.message}`);

  return { lessonSlug: input.lessonSlug, status: input.status };
}

export interface PlacementOutcome {
  /** Null when every tested tag was demonstrated: open the whole track. */
  skillTag: string | null;
  byTag: readonly TagEvidence[];
  /** Where the reader should start, once placement is applied. */
  startLessonSlug: string | null;
}

/**
 * Grades a finished diagnostic session into a starting point.
 *
 * The attempts are read back from `drill_attempts` — rows the server graded
 * itself in Phase 7 — rather than accepted from the request. RLS scopes the
 * read to the caller, so a session id belonging to somebody else simply returns
 * nothing rather than placing this user from another person's results.
 */
export async function computePlacement(
  userId: string,
  sessionId: string,
): Promise<PlacementOutcome> {
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) fail('sessionId must be a uuid');

  const supabase = await createClient();

  const { data: attemptRows, error: attemptError } = await supabase
    .from('drill_attempts')
    .select('grade, skill_tags')
    .eq('session_id', sessionId);

  if (attemptError) fail(`could not read the diagnostic: ${attemptError.message}`);

  const attempts: PlacementAttempt[] = (attemptRows ?? []).flatMap((row) => {
    const tags = (row.skill_tags ?? []) as string[];
    // One spot exercises one skill tag; the column is an array because the
    // schema shares it with lessons, which can teach several.
    return tags.map((skillTag) => ({
      skillTag,
      tier: row.grade as PlacementAttempt['tier'],
    }));
  });

  const [{ track }, templates] = await Promise.all([fetchTrack(), fetchDrillTemplates()]);
  const order = placementOrder([track], templates.map((entry) => entry.template));

  const result = placeFrom({ attempts, groups: order });

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      placement_skill_tag: result.skillTag,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (profileError) fail(`could not save the placement: ${profileError.message}`);

  const startLesson = result.skillTag
    ? track.modules
        .flatMap((module) => module.lessons)
        .find((lesson) => lesson.skillTags.includes(result.skillTag!))
    : undefined;

  return {
    skillTag: result.skillTag,
    byTag: result.byTag,
    startLessonSlug: startLesson?.slug ?? null,
  };
}

/** Marks onboarding done without a placement, for a reader who skipped it. */
export async function skipPlacement(userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) fail(`could not finish onboarding: ${error.message}`);
}
