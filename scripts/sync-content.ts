/**
 * Syncs packages/content into Supabase.
 *
 * docs/01-architecture.md: content lives in packages/content as
 * schema-validated JSON and is synced to Supabase so strategy can be retuned
 * "without a deploy — and in v2, without an App Store resubmission". This is
 * that sync.
 *
 * Four properties it has to have:
 *
 *   - **Validating.** It loads content through the Phase 2/3 validators, so
 *     invalid charts fail here rather than reaching a table the app trusts.
 *   - **Idempotent.** Every write is an upsert on the same natural key the
 *     schema declares unique, so running it twice is a no-op.
 *   - **Reconciling.** It deletes rows that packages/content no longer
 *     declares. Upserting alone makes the sync additive, which means retiring
 *     a chart you found to be wrong silently does not happen — and retiring a
 *     wrong chart is exactly the "retune without a deploy" this exists for.
 *   - **Hard to fire at the wrong database.** It holds the service role key,
 *     which bypasses RLS entirely. A non-local URL needs --confirm-remote.
 *
 * Every count it prints is read back from the database afterwards rather than
 * taken from the length of what was sent, and a mismatch is a hard failure.
 * An operator reading "range_charts 10" off a table holding 11 rows is worse
 * than no output at all.
 *
 * Usage:
 *   pnpm content:sync
 *   pnpm content:sync --confirm-remote     # against a deployed project
 *   pnpm content:sync --drop-progress      # allow retiring a lesson people started,
 *                                          # or an achievement people earned
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import {
  CHART_SET_VERSION,
  SKILL_TAGS,
  loadAchievements,
  loadChartSet,
  loadDrillTemplates,
  loadTracks,
} from '@poker/content';
import { orderedLessons } from '@poker/engine';

// '[::1]' with the brackets: that is what `new URL(...).hostname` returns for
// an IPv6 literal, so the bare '::1' form would never match anything.
const LOCAL_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
  'host.docker.internal',
]);

function required(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key];
    if (value !== undefined && value.length > 0) return value;
  }

  throw new Error(
    `${name} is not set. For the local stack, run \`supabase status -o env\` and export what it prints.`,
  );
}

function assertWritable(url: string, confirmRemote: boolean): void {
  const { hostname } = new URL(url);

  if (LOCAL_HOSTS.has(hostname) || confirmRemote) return;

  throw new Error(
    `refusing to sync to ${hostname}: this script writes with the service role key, which bypasses RLS. ` +
      'Re-run with --confirm-remote if you really mean to write to a deployed project.',
  );
}

/**
 * A PostgREST `in.(...)` list. Values are quoted so a slug containing a comma
 * cannot silently split into two filter terms.
 */
function inList(values: readonly string[]): string {
  return `(${values.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')})`;
}

/**
 * Reads the row count back and fails loudly if it is not what was written.
 *
 * This is the check that catches a delete blocked by a foreign key: retiring a
 * skill tag that a user's skill_stats still references is `on delete restrict`,
 * so the delete fails, the table keeps a row content no longer declares, and
 * without this the script would still print a clean number and exit 0.
 */
async function verifyCount(
  db: SupabaseClient,
  table: string,
  expected: number,
  scope?: { column: string; value: string },
): Promise<void> {
  let query = db.from(table).select('*', { count: 'exact', head: true });
  if (scope) query = query.eq(scope.column, scope.value);

  const { count, error } = await query;
  if (error) throw new Error(`${table}: reading back the row count: ${error.message}`);

  if (count !== expected) {
    throw new Error(
      `${table}: expected ${expected} rows after sync but the table holds ${count}. ` +
        'A row packages/content no longer declares could not be removed — most likely a ' +
        'foreign key from user data still points at it.',
    );
  }

  console.log(`  ${table.padEnd(16)} ${count}`);
}

async function main(): Promise<void> {
  const confirmRemote = process.argv.includes('--confirm-remote');
  const dropProgress = process.argv.includes('--drop-progress');
  const url = required('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');

  assertWritable(url, confirmRemote);

  // Loaded before the client is even built: content that does not validate
  // must never reach a database, and these throw listing every problem.
  const chartSet = loadChartSet();
  const templates = loadDrillTemplates();
  const tracks = loadTracks();
  const achievements = loadAchievements();

  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`syncing content to ${new URL(url).host}`);

  // 1. The vocabulary first: every other table's skill_tags is validated
  //    against it by a trigger, so nothing else can be written before it.
  const { error: tagError } = await db
    .from('skill_tags')
    .upsert(
      SKILL_TAGS.map((tag) => ({ tag })),
      { onConflict: 'tag' },
    );
  if (tagError) throw new Error(`skill_tags: ${tagError.message}`);

  // Retired tags. Safe to prune before the charts that carry them: the array
  // columns are policed by a trigger that fires on write, not by a foreign
  // key, and every chart is rewritten below anyway. The scalar columns *are*
  // foreign keys, and `on delete restrict` means a tag some user's skill_stats
  // still points at refuses to go — which verifyCount turns into a failure
  // rather than a silent no-op.
  const { error: tagPruneError } = await db
    .from('skill_tags')
    .delete()
    .not('tag', 'in', inList(SKILL_TAGS));
  if (tagPruneError) throw new Error(`skill_tags (pruning): ${tagPruneError.message}`);

  await verifyCount(db, 'skill_tags', SKILL_TAGS.length);

  // 2. The chart set, whose id every chart needs.
  const { data: setRow, error: setError } = await db
    .from('range_chart_sets')
    .upsert(
      {
        version: chartSet.version,
        published: chartSet.published,
        notes: chartSet.notes ?? null,
      },
      { onConflict: 'version' },
    )
    .select('id')
    .single();
  if (setError) throw new Error(`range_chart_sets: ${setError.message}`);
  console.log(`  range_chart_sets ${chartSet.version}`);

  // 3. Charts, keyed by the same tuple the engine looks them up by.
  const { data: chartRows, error: chartError } = await db
    .from('range_charts')
    .upsert(
      chartSet.charts.map((chart) => ({
        chart_set_id: setRow.id,
        table_size: chart.tableSize,
        stack_depth: chart.stackDepth,
        hero_position: chart.heroPosition,
        action_sequence: chart.actionSequence,
        ranges: chart.ranges,
        skill_tags: chart.skillTags,
      })),
      { onConflict: 'chart_set_id,table_size,stack_depth,hero_position,action_sequence' },
    )
    .select('id');
  if (chartError) throw new Error(`range_charts: ${chartError.message}`);

  // Scoped to this chart set. Earlier sets are versioned history and are
  // deliberately left alone — retiring one is a decision, not a side effect
  // of syncing the current version.
  const { error: chartPruneError } = await db
    .from('range_charts')
    .delete()
    .eq('chart_set_id', setRow.id)
    .not('id', 'in', inList((chartRows ?? []).map((row) => String(row.id))));
  if (chartPruneError) throw new Error(`range_charts (pruning): ${chartPruneError.message}`);

  await verifyCount(db, 'range_charts', chartSet.charts.length, {
    column: 'chart_set_id',
    value: String(setRow.id),
  });

  // 4. Drill templates. Everything that is not a first-class column goes in
  //    `config`, which is the shape drill_templates was designed around.
  const { error: templateError } = await db.from('drill_templates').upsert(
    templates.map(({ slug, title, skillTags, published, ...config }) => ({
      slug,
      title,
      config,
      skill_tags: skillTags,
      published,
    })),
    { onConflict: 'slug' },
  );
  if (templateError) throw new Error(`drill_templates: ${templateError.message}`);

  // drill_attempts.template_id is `on delete set null`, so retiring a template
  // orphans the attempts that used it rather than blocking the delete or
  // taking the history with it.
  const { error: templatePruneError } = await db
    .from('drill_templates')
    .delete()
    .not('slug', 'in', inList(templates.map((template) => template.slug)));
  if (templatePruneError) throw new Error(`drill_templates (pruning): ${templatePruneError.message}`);

  await verifyCount(db, 'drill_templates', templates.length);

  // 5. The learning track: tracks -> modules -> lessons, each needing its
  //    parent's id before it can be written.
  let moduleTotal = 0;
  let lessonTotal = 0;

  for (const track of tracks) {
    const { data: trackRow, error: trackError } = await db
      .from('tracks')
      .upsert(
        {
          slug: track.slug,
          title: track.title,
          description: track.description ?? null,
          sort_order: track.sortOrder,
          published: track.published,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();
    if (trackError) throw new Error(`tracks: ${trackError.message}`);

    const { data: moduleRows, error: moduleError } = await db
      .from('modules')
      .upsert(
        track.modules.map((module) => ({
          track_id: trackRow.id,
          slug: module.slug,
          title: module.title,
          sort_order: module.sortOrder,
        })),
        { onConflict: 'track_id,slug' },
      )
      .select('id, slug');
    if (moduleError) throw new Error(`modules: ${moduleError.message}`);

    const moduleIdBySlug = new Map((moduleRows ?? []).map((row) => [String(row.slug), String(row.id)]));

    const lessonRowsToWrite = track.modules.flatMap((module) =>
      module.lessons.map((lesson) => ({
        module_id: moduleIdBySlug.get(module.slug)!,
        slug: lesson.slug,
        title: lesson.title,
        // Everything that is not a first-class column goes in `body`, which is
        // the shape `lessons` was designed around.
        body: { summary: lesson.summary, blocks: lesson.blocks },
        skill_tags: lesson.skillTags,
        sort_order: lesson.sortOrder,
        version: lesson.version,
      })),
    );

    const { data: lessonRows, error: lessonError } = await db
      .from('lessons')
      .upsert(lessonRowsToWrite, { onConflict: 'module_id,slug' })
      .select('id');
    if (lessonError) throw new Error(`lessons: ${lessonError.message}`);

    const keptLessonIds = (lessonRows ?? []).map((row) => String(row.id));

    /**
     * Pruning a lesson is not like pruning a chart.
     *
     * `lesson_progress.lesson_id` is `on delete cascade`, so deleting a retired
     * lesson silently takes real user progress with it — where
     * `drill_attempts.template_id` is `on delete set null` and merely orphans
     * the history. Losing somebody's place in the course to a content edit is
     * not a thing to discover afterwards, so it is counted first and refused.
     */
    const { data: doomed, error: doomedError } = await db
      .from('lessons')
      .select('id')
      .in('module_id', [...moduleIdBySlug.values()])
      .not('id', 'in', inList(keptLessonIds));
    if (doomedError) throw new Error(`lessons (finding retired): ${doomedError.message}`);

    const doomedIds = (doomed ?? []).map((row) => String(row.id));

    if (doomedIds.length > 0) {
      const { count, error: progressError } = await db
        .from('lesson_progress')
        .select('*', { count: 'exact', head: true })
        .in('lesson_id', doomedIds);
      if (progressError) throw new Error(`lesson_progress: ${progressError.message}`);

      if ((count ?? 0) > 0 && !dropProgress) {
        throw new Error(
          `retiring ${doomedIds.length} lesson(s) would cascade-delete ${count} lesson_progress ` +
            'row(s). Re-run with --drop-progress if that is genuinely intended.',
        );
      }

      const { error: pruneError } = await db.from('lessons').delete().in('id', doomedIds);
      if (pruneError) throw new Error(`lessons (pruning): ${pruneError.message}`);
    }

    const { error: modulePruneError } = await db
      .from('modules')
      .delete()
      .eq('track_id', trackRow.id)
      .not('id', 'in', inList([...moduleIdBySlug.values()]));
    if (modulePruneError) throw new Error(`modules (pruning): ${modulePruneError.message}`);

    moduleTotal += track.modules.length;
    lessonTotal += orderedLessons(track).length;
  }

  await verifyCount(db, 'tracks', tracks.length);
  await verifyCount(db, 'modules', moduleTotal);
  await verifyCount(db, 'lessons', lessonTotal);

  // 6. Achievements. Flat, unlike the track, but with the same pruning hazard.
  const { error: achievementError } = await db.from('achievements').upsert(
    achievements.map((achievement) => ({
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      criteria: achievement.criteria,
    })),
    { onConflict: 'id' },
  );
  if (achievementError) throw new Error(`achievements: ${achievementError.message}`);

  /**
   * `user_achievements.achievement_id` is `on delete cascade`, so retiring an
   * achievement destroys the record that somebody earned it — the same hazard
   * `lesson_progress` has, and worse in one respect: progress can be re-earned
   * by reading the lesson again, and an unlock that has been deleted simply
   * never happened. Counted first, and refused unless asked for explicitly.
   */
  const keptAchievementIds = achievements.map((achievement) => achievement.id);

  const { data: doomedAchievements, error: doomedAchievementError } = await db
    .from('achievements')
    .select('id')
    .not('id', 'in', inList(keptAchievementIds));
  if (doomedAchievementError) {
    throw new Error(`achievements (finding retired): ${doomedAchievementError.message}`);
  }

  const doomedAchievementIds = (doomedAchievements ?? []).map((row) => String(row.id));

  if (doomedAchievementIds.length > 0) {
    const { count, error: unlockedError } = await db
      .from('user_achievements')
      .select('*', { count: 'exact', head: true })
      .in('achievement_id', doomedAchievementIds);
    if (unlockedError) throw new Error(`user_achievements: ${unlockedError.message}`);

    if ((count ?? 0) > 0 && !dropProgress) {
      throw new Error(
        `retiring ${doomedAchievementIds.length} achievement(s) would cascade-delete ${count} ` +
          'user_achievements row(s) — unlocks people actually earned. Re-run with ' +
          '--drop-progress if that is genuinely intended.',
      );
    }

    const { error: achievementPruneError } = await db
      .from('achievements')
      .delete()
      .in('id', doomedAchievementIds);
    if (achievementPruneError) {
      throw new Error(`achievements (pruning): ${achievementPruneError.message}`);
    }
  }

  await verifyCount(db, 'achievements', achievements.length);

  console.log(`done — chart set ${CHART_SET_VERSION}`);
}

main().catch((error: unknown) => {
  console.error(`content sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
