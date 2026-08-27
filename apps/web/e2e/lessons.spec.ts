import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8's exit criteria, against the real stack:
 *
 *   1. A user completes a lesson.
 *   2. Progress persists across reload.
 *   3. The next lesson unlocks.
 *   4. The placement assessment routes a strong player past the basics.
 *
 * The unlock state is read from the rendered track as well as from Postgres,
 * because a course that shows a lesson as open while the server considers it
 * locked is broken in the direction nobody notices until someone clicks.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'correct horse battery staple';

/** The seeded track, in order. Mirrors packages/content. */
const FIRST = 'a-range-is-not-a-list';
const SECOND = 'playing-a-mixed-hand';
const THIRD = 'why-position-pays';
const LAST = 'defending-against-the-small-blind';

/**
 * The placement groups, mirroring `packages/content`: one per lesson that
 * teaches a drillable tag, in course order. Lesson-sized rather than one per
 * tag so a short diagnostic can actually fill them.
 */
const GROUPS: readonly { skillTag: string; members: readonly string[] }[] = [
  { skillTag: 'preflop.rfi.utg', members: ['preflop.rfi.utg', 'preflop.rfi.hj'] },
  { skillTag: 'preflop.rfi.co', members: ['preflop.rfi.co', 'preflop.rfi.btn'] },
  { skillTag: 'preflop.rfi.sb', members: ['preflop.rfi.sb'] },
  {
    skillTag: 'preflop.blind_defense.bb_vs_btn',
    members: ['preflop.blind_defense.bb_vs_btn', 'preflop.blind_defense.bb_vs_co'],
  },
  {
    skillTag: 'preflop.blind_defense.bb_vs_utg',
    members: ['preflop.blind_defense.bb_vs_utg', 'preflop.blind_defense.bb_vs_hj'],
  },
  { skillTag: 'preflop.blind_defense.bb_vs_sb', members: ['preflop.blind_defense.bb_vs_sb'] },
];

let sequence = 0;

async function signUp(page: Page): Promise<string> {
  sequence += 1;
  const email = `e2e-lesson-${Date.now()}-${process.pid}-${sequence}@test.local`;

  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/(dashboard|onboarding)$/);

  return email;
}

function admin() {
  return createClient(SUPABASE_URL!, SERVICE_KEY!);
}

async function userIdFor(email: string): Promise<string> {
  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`no user for ${email}`);
  return user.id;
}

/** Gets past onboarding without taking the diagnostic. */
async function skipOnboarding(page: Page): Promise<void> {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Skip, start at the beginning/ }).click();
  await expect(page.getByTestId('placement-result')).toBeVisible();
}

async function completeLesson(page: Page, slug: string): Promise<void> {
  await page.goto(`/learn/${slug}`);
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/lessons/progress') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Mark as complete' }).click();
  await saved;
  await expect(page.getByTestId('lesson-completed')).toBeVisible();
}

/** The rendered lock state for a lesson in the track nav. */
function navItem(page: Page, slug: string) {
  return page.locator(`nav[aria-label="Track contents"] a[href="/learn/${slug}"]`);
}

test.describe('a lesson can be read and finished', () => {
  test('renders the authored content, not an empty shell', async ({ page }) => {
    await signUp(page);
    await skipOnboarding(page);
    await page.goto(`/learn/${FIRST}`);

    await expect(page.getByRole('heading', { name: 'A range is not a list' })).toBeVisible();

    // Prose, a real chart, and a practice block — the three block kinds that
    // would each fail differently if the renderer or the content were wrong.
    await expect(page.getByText(/combination-weighted/)).toBeVisible();
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Practice' })).toBeVisible();
  });

  test('renders a chart whose numbers match the prose beside it', async ({ page }) => {
    await signUp(page);
    await skipOnboarding(page);
    await page.goto(`/learn/${FIRST}`);

    // The lesson claims the button opens 43.4%; the grid it shows must be the
    // button's. A mismatched chart is the failure that teaches confidently.
    await expect(page.getByText(/The button opens 43\.4% of hands/)).toBeVisible();
    await expect(page.getByRole('grid', { name: /BTN open/ })).toBeVisible();
  });

  test('completes, persists across reload, and unlocks the next lesson', async ({ page }) => {
    await signUp(page);
    await skipOnboarding(page);

    // Locked before: the third lesson is not a link at all.
    await page.goto('/learn');
    await expect(navItem(page, SECOND)).toHaveCount(0);

    await completeLesson(page, FIRST);

    // Exit criterion 2: still complete after a full reload, not just in state.
    await page.reload();
    await expect(page.getByTestId('lesson-completed')).toBeVisible();

    // Exit criterion 3: the next one opens, and only the next one.
    await page.goto('/learn');
    await expect(navItem(page, SECOND)).toHaveCount(1);
    await expect(navItem(page, THIRD)).toHaveCount(0);
  });

  test('records the completion in Postgres, not only on screen', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read progress back');

    const email = await signUp(page);
    await skipOnboarding(page);
    await completeLesson(page, FIRST);

    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('lesson_progress')
      .select('status, completed_at')
      .eq('user_id', userId);

    expect(data).toHaveLength(1);
    expect(data![0]!.status).toBe('completed');
    expect(data![0]!.completed_at).not.toBeNull();
  });
});

test.describe('the ordering is enforced by the server, not the links', () => {
  test('shows the not-found page for a locked lesson rather than its content', async ({
    page,
  }) => {
    await signUp(page);
    await skipOnboarding(page);

    await page.goto(`/learn/${LAST}`);

    // Asserted on what renders, not on the status code: these pages are
    // dynamic and streaming has already begun by the time `notFound()` is
    // reached, so Next has committed a 200 header. The content is what matters
    // — a locked lesson must not be readable by typing its URL.
    await expect(page.getByRole('heading', { name: /does not exist/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as complete' })).toHaveCount(0);
    await expect(page.getByText(/widest defence anywhere in this track/)).toHaveCount(0);
  });

  /**
   * The mutation this guards against: without the server-side check, posting a
   * completion for the final lesson unlocks the entire track, and the ordering
   * is enforced only by which links the UI happened to render.
   */
  test('refuses a completion posted for a locked lesson', async ({ page }) => {
    await signUp(page);
    await skipOnboarding(page);

    const response = await page.request.post('/api/lessons/progress', {
      data: { lessonSlug: LAST, status: 'completed' },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).toMatch(/not unlocked/);
  });

  test('rejects a lesson slug that does not exist', async ({ page }) => {
    await signUp(page);
    await skipOnboarding(page);

    const response = await page.request.post('/api/lessons/progress', {
      data: { lessonSlug: 'made-up-lesson', status: 'completed' },
    });

    expect(response.status()).toBe(400);
  });
});

test.describe('placement', () => {
  test('runs the diagnostic and places from the answers the server graded', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the placement back');
    test.setTimeout(180_000);

    const email = await signUp(page);
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Start the diagnostic' }).click();
    await page.waitForSelector('[data-testid="progress"]');

    // Fold everything. Note this is *not* uniformly bad: folding is correct in
    // most opening spots and wrong in most big-blind defence spots, so a
    // correctly wired placement should pass the opening groups and stop at
    // defence. Asserting a fixed answer would be asserting the sampler.
    for (let spot = 0; spot < 24; spot += 1) {
      await page.keyboard.press('f');
      await page.waitForSelector('[data-testid="grade"]');
      await page.keyboard.press(' ');
    }

    await expect(page.getByTestId('placement-result')).toBeVisible({ timeout: 30_000 });

    const userId = await userIdFor(email);
    const { data: profile } = await admin()
      .from('profiles')
      .select('placement_skill_tag, onboarding_completed_at')
      .eq('id', userId)
      .single();

    expect(profile!.onboarding_completed_at).not.toBeNull();

    /**
     * The defining property, checked against the answers the server itself
     * graded: every group *before* the placement was demonstrated, and the
     * placement group was not. That is what makes the placement derived rather
     * than asserted, and it holds whatever the sampler happened to draw.
     */
    const { data: attempts } = await admin()
      .from('drill_attempts')
      .select('grade, skill_tags')
      .eq('user_id', userId);

    const evidence = GROUPS.map((group) => {
      const forGroup = (attempts ?? []).filter((row) =>
        ((row.skill_tags ?? []) as string[]).some((tag) => group.members.includes(tag)),
      );
      const passes = forGroup.filter((row) =>
        ['optimal', 'acceptable'].includes(row.grade as string),
      ).length;

      return {
        skillTag: group.skillTag,
        demonstrated: forGroup.length >= 3 && passes / forGroup.length >= 0.75,
      };
    });

    const firstGap = evidence.find((entry) => !entry.demonstrated);
    expect(profile!.placement_skill_tag).toBe(firstGap?.skillTag ?? null);

    // Recorded as its own mode, so Phase 9 can keep it out of accuracy stats.
    const { data: session } = await admin()
      .from('drill_sessions')
      .select('mode')
      .eq('user_id', userId)
      .single();
    expect(session!.mode).toBe('placement');
  });

  /**
   * The security property. Placement unlocks content, so per
   * docs/01-architecture.md §3 it must never be a value the client states.
   */
  test('ignores a placement the client tries to declare', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the profile back');

    const email = await signUp(page);
    await skipOnboarding(page);

    // A session with no attempts at all, plus a flattering claim alongside it.
    const start = await page.request.post('/api/drill/sessions', {
      data: { mode: 'placement', seed: 7, spotsPlanned: 24, templateSlugs: [] },
    });
    const { sessionId } = (await start.json()) as { sessionId: string };

    await page.request.post('/api/onboarding/placement', {
      data: {
        sessionId,
        placementSkillTag: 'preflop.blind_defense.bb_vs_sb',
        skillTag: 'preflop.blind_defense.bb_vs_sb',
      },
    });

    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('profiles')
      .select('placement_skill_tag')
      .eq('id', userId)
      .single();

    // No attempts means nothing demonstrated, which places at the very start —
    // whatever the request claimed.
    expect(data!.placement_skill_tag).toBe('preflop.rfi.utg');
  });

  test('skipping leaves the reader at the beginning with onboarding done', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');

    const email = await signUp(page);
    await skipOnboarding(page);

    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('profiles')
      .select('placement_skill_tag, onboarding_completed_at')
      .eq('id', userId)
      .single();

    expect(data!.onboarding_completed_at).not.toBeNull();
    expect(data!.placement_skill_tag).toBeNull();

    await page.goto('/learn');
    await expect(navItem(page, FIRST)).toHaveCount(1);
    await expect(navItem(page, SECOND)).toHaveCount(0);
  });

  test('sends a new account to onboarding, and only once', async ({ page }) => {
    await signUp(page);

    await page.goto('/dashboard');
    await page.waitForURL(/\/onboarding$/);

    await skipOnboarding(page);

    // Second visit: already placed, so no diagnostic to re-run.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe('the dashboard reflects the track', () => {
  test('shows real progress in the rail once a lesson is done', async ({ page }) => {
    await signUp(page);
    await skipOnboarding(page);

    await page.goto('/dashboard');
    await expect(page.getByTestId('rail-progress')).toContainText('0 of 10 lessons');

    await completeLesson(page, FIRST);

    await page.goto('/dashboard');
    await expect(page.getByTestId('rail-progress')).toContainText('1 of 10 lessons');
  });

  test('offers Continue Learning as a live mode', async ({ page }) => {
    await signUp(page);
    await skipOnboarding(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('link', { name: /Continue Learning/ })).toBeVisible();
  });
});
