import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9's exit criteria, against the real stack:
 *
 *   1. The streak survives a timezone change and does not break across DST.
 *   2. Weak spots reflect actual recent performance.
 *   3. XP totals reconcile with the ledger.
 *
 * The first is mostly a unit-test problem — `apps/web/tests/timezone.test.ts`
 * covers the transitions themselves — so what is checked here is the half a
 * unit test cannot see: that the *server* applies the reader's own zone when it
 * decides what day it is, rather than its own.
 *
 * The third is checked by reading `xp_events` back and re-deriving the total
 * from the grades the server stored. A test that asserted the screen matched
 * the screen would pass with the ledger empty.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'correct horse battery staple';

/** Mirrors `XP_PER_TIER` in packages/engine/src/progress/xp.ts. */
const XP_PER_TIER: Record<string, number> = {
  optimal: 10,
  acceptable: 7,
  inaccurate: 3,
  blunder: 1,
};

const XP_LESSON_COMPLETE = 50;
const WEAK_TAG = 'preflop.rfi.btn';

let sequence = 0;

function admin() {
  return createClient(SUPABASE_URL!, SERVICE_KEY!);
}

async function signUp(page: Page): Promise<string> {
  sequence += 1;
  const email = `e2e-progress-${Date.now()}-${process.pid}-${sequence}@test.local`;

  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/(dashboard|onboarding)$/);

  return email;
}

async function userIdFor(email: string): Promise<string> {
  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`no user for ${email}`);
  return user.id;
}

async function skipOnboarding(page: Page): Promise<void> {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Skip, start at the beginning/ }).click();
  await expect(page.getByTestId('placement-result')).toBeVisible();
}

/** Signs up and gets to a usable dashboard. */
async function ready(page: Page): Promise<string> {
  const email = await signUp(page);
  await skipOnboarding(page);
  return email;
}

async function startQuickSession(page: Page, length: string): Promise<void> {
  await page.goto('/drill/quick');
  await page.getByRole('button', { name: length, exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('[data-testid="progress"]');
}

/** Answers the current spot and waits for the row to actually reach Postgres. */
async function answerAndRecord(page: Page): Promise<void> {
  const recorded = page.waitForResponse(
    (response) =>
      response.url().includes('/api/drill/attempts') && response.request().method() === 'POST',
  );
  await page.keyboard.press('f');
  await page.waitForSelector('[data-testid="grade"]');
  await recorded;
}

/** Plays a whole session of `length` spots and lands on the summary. */
async function playSession(page: Page, spots: number): Promise<void> {
  await startQuickSession(page, `${spots} spots`);

  for (let spot = 1; spot <= spots; spot += 1) {
    await answerAndRecord(page);
    if (spot < spots) await page.keyboard.press(' ');
  }

  await page.keyboard.press(' ');
  await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
}

/**
 * Seeds a finished-looking session of graded attempts, without playing it.
 *
 * Written with the service role because the point is to arrange a *history* —
 * fifteen bad answers on one skill — and playing fifteen spots badly through
 * the UI is not something a test can arrange, since folding is the correct
 * answer to most opening spots. The session is left open so the app's own
 * close-and-award path is what runs.
 */
async function seedAttempts(
  userId: string,
  options: { grade: string; count: number; skillTag: string; mode?: string },
): Promise<string> {
  const db = admin();

  const { data: session, error: sessionError } = await db
    .from('drill_sessions')
    .insert({ user_id: userId, mode: options.mode ?? 'quick', config: {} })
    .select('id')
    .single();

  if (sessionError) throw new Error(`seeding a session: ${sessionError.message}`);

  const rows = Array.from({ length: options.count }, (_, i) => ({
    user_id: userId,
    session_id: session.id,
    seed: 1000 + i,
    chart_version: 'e2e',
    scenario: {},
    user_action: 'fold',
    primary_action: 'raise',
    frequencies: [{ action: 'raise', freq: 1 }],
    grade: options.grade,
    ev_loss: options.grade === 'blunder' ? 1.5 : 0,
    skill_tags: [options.skillTag],
  }));

  const { error } = await db.from('drill_attempts').insert(rows);
  if (error) throw new Error(`seeding attempts: ${error.message}`);

  return String(session.id);
}

/** Closes a session through the app's own route, with the browser's cookies. */
async function closeSession(page: Page, sessionId: string) {
  const response = await page.request.patch('/api/drill/sessions', { data: { sessionId } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ rewards: { xpAwarded: number } | null }>;
}

test.describe('XP reconciles with the ledger', () => {
  test('a finished session is worth exactly what its stored grades say', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the ledger back');
    test.setTimeout(120_000);

    const email = await ready(page);
    await playSession(page, 10);

    const userId = await userIdFor(email);
    const db = admin();

    const { data: attempts } = await db
      .from('drill_attempts')
      .select('grade')
      .eq('user_id', userId);

    expect(attempts).toHaveLength(10);

    // Derived from what the SERVER stored, not from what the browser showed.
    const expected = (attempts ?? []).reduce(
      (sum, row) => sum + (XP_PER_TIER[String(row.grade)] ?? 0),
      0,
    );

    const { data: events } = await db
      .from('xp_events')
      .select('amount, reason')
      .eq('user_id', userId);

    const session = (events ?? []).filter((e) => e.reason === 'drill_session');
    expect(session).toHaveLength(1);
    expect(Number(session[0]!.amount)).toBe(expected);
  });

  test('the screen shows the number that was written, not one of its own', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    await playSession(page, 10);

    const shown = await page.getByTestId('xp-awarded').innerText();
    const { data: events } = await admin()
      .from('xp_events')
      .select('amount')
      .eq('user_id', await userIdFor(email));

    const total = (events ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

    expect(shown.replace(/[^0-9]/g, '')).toBe(String(total));
  });

  /**
   * The retried PATCH. The unique index is what stops it, and without it every
   * screen afterwards reports the doubled total faithfully — there is nothing
   * left to notice it by.
   */
  test('closing a session twice does not pay twice', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    await playSession(page, 10);

    const userId = await userIdFor(email);
    const db = admin();

    const before = await db.from('xp_events').select('amount').eq('user_id', userId);
    const beforeTotal = (before.data ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

    const { data: sessions } = await db
      .from('drill_sessions')
      .select('id')
      .eq('user_id', userId)
      .not('completed_at', 'is', null);

    const replay = await closeSession(page, String(sessions![0]!.id));
    // Nothing to close, so nothing to pay for.
    expect(replay.rewards).toBeNull();

    const after = await db.from('xp_events').select('amount').eq('user_id', userId);
    const afterTotal = (after.data ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

    expect(afterTotal).toBe(beforeTotal);
  });

  test('a study session records history but pays nothing', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');

    const email = await ready(page);
    const userId = await userIdFor(email);

    const sessionId = await seedAttempts(userId, {
      grade: 'optimal',
      count: 5,
      skillTag: WEAK_TAG,
      mode: 'study',
    });

    const { rewards } = await closeSession(page, sessionId);
    expect(rewards?.xpAwarded).toBe(0);

    const { data } = await admin()
      .from('xp_events')
      .select('amount')
      .eq('user_id', userId)
      .eq('reason', 'drill_session');

    expect(data).toEqual([]);

    // And it stays out of the rollup, which is what weak-spot detection reads.
    const { data: stats } = await admin()
      .from('skill_stats')
      .select('skill_tag')
      .eq('user_id', userId);

    expect(stats).toEqual([]);
  });

  test('finishing a lesson pays once, however many times it is marked done', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');

    const email = await ready(page);

    // Twice through the route, not twice through the button: once a lesson is
    // finished the button is gone, so clicking it again cannot be what proves
    // the second call pays nothing. Posting the same completion directly is
    // exactly what a retry does.
    await page.goto('/learn/a-range-is-not-a-list');
    const saved = page.waitForResponse(
      (r) => r.url().includes('/api/lessons/progress') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Mark as complete' }).click();
    await saved;

    const replay = await page.request.post('/api/lessons/progress', {
      data: { lessonSlug: 'a-range-is-not-a-list', status: 'completed' },
    });
    expect(replay.ok()).toBe(true);
    expect((await replay.json()).xpAwarded).toBe(0);

    const { data } = await admin()
      .from('xp_events')
      .select('amount')
      .eq('user_id', await userIdFor(email))
      .eq('reason', 'lesson_complete');

    expect(data).toHaveLength(1);
    expect(Number(data![0]!.amount)).toBe(XP_LESSON_COMPLETE);
  });
});

test.describe('the streak is kept in the reader’s own timezone', () => {
  /**
   * The half a unit test cannot reach: that the *server* asks the profile which
   * day it is, rather than answering in its own zone.
   *
   * The pair is chosen so this cannot pass by luck at some hours and fail at
   * others. Kiritimati is +14, so its date is UTC's or UTC's plus one; Midway
   * is -11, so its date is UTC's or UTC's minus one. Below 10:00 UTC, Midway
   * disagrees with UTC; from 10:00, Kiritimati does. There is no hour of any
   * day when both agree, so a UTC implementation always fails at least one of
   * these two — which is the whole reason there are two.
   */
  for (const timeZone of ['Pacific/Kiritimati', 'Pacific/Midway']) {
    test(`records the local date in ${timeZone}`, async ({ page }) => {
      test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
      test.setTimeout(120_000);

      const email = await ready(page);
      const userId = await userIdFor(email);

      await admin().from('profiles').update({ timezone: timeZone }).eq('id', userId);

      const sessionId = await seedAttempts(userId, {
        grade: 'optimal',
        count: 3,
        skillTag: WEAK_TAG,
      });
      await closeSession(page, sessionId);

      const { data } = await admin()
        .from('streaks')
        .select('current_streak, last_active_date')
        .eq('user_id', userId)
        .single();

      const expected = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      expect(data?.last_active_date).toBe(expected);
      expect(data?.current_streak).toBe(1);
    });
  }

  test('a second session the same day does not count twice', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    for (let i = 0; i < 2; i += 1) {
      const sessionId = await seedAttempts(userId, {
        grade: 'optimal',
        count: 2,
        skillTag: WEAK_TAG,
      });
      await closeSession(page, sessionId);
    }

    const { data } = await admin()
      .from('streaks')
      .select('current_streak')
      .eq('user_id', userId)
      .single();

    expect(data?.current_streak).toBe(1);
  });

  test('the strip warns before a streak is lost, rather than after', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    /**
     * The zone is pinned first. `handle_new_user()` captures whatever zone the
     * browser reported at signup, so "yesterday" computed in UTC is only
     * yesterday for an account actually in UTC — on a machine running behind
     * it, UTC's yesterday is the user's today and the strip is right to say so.
     */
    await admin().from('profiles').update({ timezone: 'UTC' }).eq('id', userId);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    await admin()
      .from('streaks')
      .update({ current_streak: 4, longest_streak: 4, last_active_date: yesterday })
      .eq('user_id', userId);

    await page.goto('/dashboard');

    await expect(page.getByTestId('today-strip')).toContainText(
      'Play today to keep your 4-day streak.',
    );
  });

  test('a broken streak reads as zero, not as its stale stored number', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    await admin()
      .from('streaks')
      .update({ current_streak: 9, longest_streak: 9, last_active_date: '2026-01-01' })
      .eq('user_id', userId);

    await page.goto('/dashboard');

    await expect(page.getByTestId('today-strip')).toContainText('0 days');
    await expect(page.getByTestId('today-strip')).toContainText('Your best is 9 days');
  });
});

test.describe('weak spots come from recent performance', () => {
  test('a skill answered badly shows in the rail and can be drilled', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    // Fifteen blunders on one skill: past the minimum, and unambiguous.
    const sessionId = await seedAttempts(userId, {
      grade: 'blunder',
      count: 15,
      skillTag: WEAK_TAG,
    });
    await closeSession(page, sessionId);

    await page.goto('/dashboard');

    // Labelled from the chart that teaches it, not as a dotted identifier.
    const rail = page.getByTestId('rail-weak-spots');
    await expect(rail).toBeVisible();
    await expect(rail).toContainText('BTN open');

    await rail.locator(`[data-tag="${WEAK_TAG}"]`).click();
    await page.waitForURL(/\/drill\/weak-spots/);
    await expect(page.getByTestId('weak-spot-focus')).toContainText('BTN open');
  });

  test('a skill answered well does not', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    const sessionId = await seedAttempts(userId, {
      grade: 'optimal',
      count: 15,
      skillTag: WEAK_TAG,
    });
    await closeSession(page, sessionId);

    await page.goto('/dashboard');

    await expect(page.getByTestId('rail-weak-spots')).toHaveCount(0);
    await expect(page.getByTestId('weak-spot-focus')).toHaveCount(0);
  });

  /**
   * A small sample is not evidence. Someone told their button opening is their
   * weakest skill after four answers goes and drills noise, and has no way to
   * know that is what happened.
   */
  test('a short bad run is not called a weakness', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    const sessionId = await seedAttempts(userId, {
      grade: 'blunder',
      count: 4,
      skillTag: WEAK_TAG,
    });
    await closeSession(page, sessionId);

    await page.goto('/dashboard');
    await expect(page.getByTestId('rail-weak-spots')).toHaveCount(0);

    // And the page itself says why, rather than looking broken.
    await page.goto('/drill/weak-spots');
    await expect(page.getByText(/answers before a low score means anything/)).toBeVisible();
  });

  test('the rollup is a cache of the attempts, and matches them', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    const sessionId = await seedAttempts(userId, {
      grade: 'blunder',
      count: 15,
      skillTag: WEAK_TAG,
    });
    await closeSession(page, sessionId);

    const { data } = await admin()
      .from('skill_stats')
      .select('skill_tag, attempts, correct, ewma_accuracy')
      .eq('user_id', userId)
      .eq('skill_tag', WEAK_TAG)
      .single();

    expect(Number(data?.attempts)).toBe(15);
    expect(Number(data?.correct)).toBe(0);
    expect(Number(data?.ewma_accuracy)).toBe(0);
  });
});

test.describe('achievements', () => {
  test('unlock once, and are shown on the summary that unlocked them', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    // 100 answers is the first volume badge. Ninety-nine, then the session that
    // crosses it — so the unlock is caused by the close, not by the seeding.
    const primer = await seedAttempts(userId, {
      grade: 'optimal',
      count: 99,
      skillTag: WEAK_TAG,
    });
    await closeSession(page, primer);

    const { data: early } = await admin()
      .from('user_achievements')
      .select('achievement_id')
      .eq('user_id', userId);

    expect(early?.map((r) => r.achievement_id)).not.toContain('first-hundred');

    const crossing = await seedAttempts(userId, {
      grade: 'optimal',
      count: 1,
      skillTag: WEAK_TAG,
    });
    const { rewards } = await closeSession(page, crossing);

    const { data: unlocked } = await admin()
      .from('user_achievements')
      .select('achievement_id')
      .eq('user_id', userId);

    expect(unlocked?.map((r) => r.achievement_id)).toContain('first-hundred');

    expect(rewards?.xpAwarded).toBeGreaterThan(0);

    /**
     * Ninety-nine clean answers on one skill already earn `sharp-on-a-spot`, so
     * two closes legitimately produce two achievement events. What must hold is
     * that the XP paid matches the badges actually recorded — one payment per
     * unlock, never a second for the same badge.
     */
    const { data: events } = await admin()
      .from('xp_events')
      .select('amount')
      .eq('user_id', userId)
      .eq('reason', 'achievement');

    const paid = (events ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
    expect(paid).toBe(40 * (unlocked?.length ?? 0));

    // No badge recorded twice.
    const ids = (unlocked ?? []).map((r) => String(r.achievement_id));
    expect(new Set(ids).size).toBe(ids.length);

    // And re-closing an already-closed session adds nothing.
    const replay = await closeSession(page, crossing);
    expect(replay.rewards).toBeNull();

    const { data: after } = await admin()
      .from('xp_events')
      .select('amount')
      .eq('user_id', userId)
      .eq('reason', 'achievement');

    expect((after ?? []).reduce((sum, e) => sum + Number(e.amount), 0)).toBe(paid);
  });

  test('every seeded achievement has criteria the app can evaluate', async () => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');

    const { data } = await admin().from('achievements').select('id, criteria');

    expect(data?.length).toBeGreaterThan(0);

    for (const row of data ?? []) {
      const criteria = row.criteria as { kind?: string };
      // An achievement the evaluator does not understand never unlocks for
      // anybody, and nothing anywhere would say so.
      expect(['spots', 'streak', 'lessons', 'mastery'], String(row.id)).toContain(criteria.kind);
    }
  });
});

test.describe('the daily goal', () => {
  test('fills from today’s scored spots and pays once when met', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(120_000);

    const email = await ready(page);
    const userId = await userIdFor(email);

    const sessionId = await seedAttempts(userId, {
      grade: 'optimal',
      count: 25,
      skillTag: WEAK_TAG,
    });
    await closeSession(page, sessionId);

    const { data: first } = await admin()
      .from('xp_events')
      .select('amount')
      .eq('user_id', userId)
      .eq('reason', 'daily_goal');

    expect(first).toHaveLength(1);

    // A second session the same day must not pay the bonus again.
    const second = await seedAttempts(userId, {
      grade: 'optimal',
      count: 5,
      skillTag: WEAK_TAG,
    });
    await closeSession(page, second);

    const { data: after } = await admin()
      .from('xp_events')
      .select('amount')
      .eq('user_id', userId)
      .eq('reason', 'daily_goal');

    expect(after).toHaveLength(1);

    await page.goto('/dashboard');
    await expect(page.getByTestId('goal-ring')).toHaveAttribute('data-met', 'true');
  });

  test('starts a new account at zero of a real target', async ({ page }) => {
    await ready(page);
    await page.goto('/dashboard');

    const ring = page.getByTestId('goal-ring');
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAttribute('data-met', 'false');
    await expect(page.getByTestId('today-strip')).toContainText('0 / 20');
  });
});

/**
 * The level-up moment, added in Phase 11.
 *
 * Phase 11's tone decision is "celebrate milestones, never answers", and a
 * milestone that fires every time is not a milestone — it is a participation
 * banner, and the second time somebody sees it they stop reading it.
 *
 * `SessionRewards.levelBefore` exists so the client never has to remember what
 * level the session started at. This is the test that says it is actually being
 * compared against, rather than the level merely being above 1.
 */
test.describe('the level-up moment', () => {
  test('fires only when the level actually moved', async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);

    /**
     * Twenty-five spots first, to get clear of level 1.
     *
     * Not ten: pressing `f` is not always the top action, so a spot pays
     * anywhere from 1 to 10 XP and ten spots can land short of the 100 that
     * level 2 begins at. The first draft asserted a level-up after ten and
     * failed for exactly that reason — the test was assuming an outcome the
     * grading does not guarantee.
     */
    await playSession(page, 25);

    // Read from the strip, which derives the level from `xp_events`, rather
    // than from the summary that has just made a claim about it.
    const levelNow = async (): Promise<number> => {
      await page.goto('/dashboard');
      const strip = await page.getByTestId('today-strip').innerText();
      const level = Number(/Level (\d+)/.exec(strip)?.[1]);
      expect(level, `no level in the TODAY strip: ${strip}`).toBeGreaterThanOrEqual(1);
      return level;
    };

    const before = await levelNow();

    // Non-vacuous: with the account still on level 1 the mutation this test
    // exists to catch would not fire either, and it would pass proving nothing.
    expect(before, '25 spots did not reach level 2; the test below is vacuous').toBeGreaterThan(1);

    // A second, shorter session. Ten spots is at most 100 XP and level 3 needs
    // 300, so the level holds — but the assertion below does not rely on that.
    await playSession(page, 10);
    const badge = page.getByTestId('level-up');
    const claimed = (await badge.count())
      ? Number(/Level (\d+)/.exec(await badge.innerText())?.[1])
      : null;

    const after = await levelNow();

    /**
     * The invariant, both ways round. The badge appears exactly when the level
     * moved, and names where it moved to.
     *
     * Stated as a biconditional rather than as "absent" because what a session
     * pays depends on how its spots graded, and a test pinned to an exact total
     * would be pinned to today's charts.
     */
    if (after > before) {
      expect(claimed, 'the level moved and nothing said so').toBe(after);
    } else {
      expect(claimed, 'the summary celebrated a level it was already on').toBeNull();
    }
  });
});
