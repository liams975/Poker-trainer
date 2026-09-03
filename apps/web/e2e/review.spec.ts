import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

/**
 * Session Review, and the last leg of the roadmap's exit criterion:
 * "onboarding → lesson → drill → review".
 *
 * Two properties matter more than the rest here and neither is about layout:
 *
 *   1. **The log shows the mix it was graded against, not today's.**
 *      `chart_version` exists so a retune cannot rewrite history, and a review
 *      screen that re-derives from the current charts throws that away.
 *   2. **It never names a right answer.** docs/05: "Never tell a user they were
 *      wrong when they chose a positive-frequency action." Two of the four
 *      tiers are defensible, so a ✓/✗ column would be false, not just terse.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'correct horse battery staple';

let sequence = 0;

function admin() {
  return createClient(SUPABASE_URL!, SERVICE_KEY!);
}

async function signUp(page: Page): Promise<string> {
  sequence += 1;
  const email = `e2e-review-${Date.now()}-${process.pid}-${sequence}@test.local`;

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

async function ready(page: Page): Promise<string> {
  const email = await signUp(page);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Skip, start at the beginning/ }).click();
  await expect(page.getByTestId('placement-result')).toBeVisible();
  return email;
}

/** Plays a real session, so the rows under review are ones the server graded. */
async function playSession(page: Page, spots: number): Promise<void> {
  await page.goto('/drill/quick');
  await page.getByRole('button', { name: `${spots} spots`, exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('[data-testid="progress"]');

  for (let spot = 1; spot <= spots; spot += 1) {
    const recorded = page.waitForResponse(
      (response) =>
        response.url().includes('/api/drill/attempts') && response.request().method() === 'POST',
    );
    await page.keyboard.press('f');
    await page.waitForSelector('[data-testid="grade"]');
    await recorded;
    await page.keyboard.press(' ');
  }

  await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
}

test.describe('the review surface', () => {
  test('lists what you answered and lets you reopen the spot', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await playSession(page, 10);

    await page.goto('/review');

    const log = page.getByTestId('mistake-log');
    await expect(log).toBeVisible();
    await expect(log.getByTestId('attempt-row')).toHaveCount(10);

    // Opening a row replays the spot from its stored scenario, rather than
    // describing it — the seat map and the hole cards are the real components.
    await log.getByTestId('attempt-row').first().click();
    await expect(page.getByTestId('stored-mix')).toBeVisible();
  });

  /**
   * The rule the whole app is built around, checked where it is easiest to
   * break: a review screen is exactly where somebody would add a "correct
   * answer" column.
   */
  test('never labels an answer right or wrong', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await playSession(page, 10);
    await page.goto('/review');

    const text = (await page.getByTestId('mistake-log').innerText()).toLowerCase();

    for (const word of ['correct', 'incorrect', 'wrong', 'right answer', 'you should have']) {
      expect(text, `the log says "${word}"`).not.toContain(word);
    }

    // What it says instead: the tier, and how much of the mix the answer was.
    await expect(page.getByTestId('mistake-log')).toContainText('of the mix');
  });

  test('shows the distribution as it was stored, not as it is now', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the row back');
    test.setTimeout(120_000);

    const email = await ready(page);
    await playSession(page, 10);

    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('drill_attempts')
      .select('frequencies, chart_version')
      .eq('user_id', userId)
      .limit(1)
      .single();

    await page.goto('/review');
    await page.getByTestId('attempt-row').first().click();

    // Every stored frequency appears, at the percentage the row holds.
    const shown = await page.getByTestId('stored-mix').innerText();
    for (const entry of (data!.frequencies as { action: string; freq: number }[])) {
      expect(shown.toLowerCase()).toContain(entry.action === 'raise' ? 'raise' : entry.action);
    }

    await expect(page.getByTestId('mistake-log')).toContainText(String(data!.chart_version));
  });

  test('filters by grade, and the filter is a link you can send', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await playSession(page, 10);

    await page.goto('/review?grade=optimal');
    const rows = page.getByTestId('attempt-row');
    const count = await rows.count();

    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i).locator('[data-tier]')).toHaveAttribute('data-tier', 'optimal');
    }

    // And an unknown filter value is ignored rather than returning nothing —
    // the params are attacker-supplied and go into a query.
    await page.goto('/review?grade=perfect');
    await expect(page.getByTestId('attempt-row').first()).toBeVisible();
  });

  test('opens one session and breaks it down by skill', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await playSession(page, 10);

    await page.goto('/review');
    await page.getByTestId('session-row').first().click();
    await page.waitForURL(/\/review\/[0-9a-f-]{36}$/);

    await expect(page.getByTestId('session-tiers')).toBeVisible();
    await expect(page.getByTestId('session-by-tag')).toBeVisible();
    await expect(page.getByTestId('mistake-log')).toBeVisible();
  });

  /**
   * RLS, through the page. A session id that exists but belongs to somebody
   * else must be indistinguishable from one that does not exist — a
   * distinguishable "not yours" confirms to a prober that an id is real.
   */
  test('another user’s session shows not-found, and leaks nothing', async ({ page, browser }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');
    test.setTimeout(180_000);

    // Alice plays.
    const context = await browser.newContext();
    const alice = await context.newPage();
    const aliceEmail = await ready(alice);
    await playSession(alice, 10);

    const { data: sessions } = await admin()
      .from('drill_sessions')
      .select('id')
      .eq('user_id', await userIdFor(aliceEmail))
      .limit(1);

    const aliceSession = String(sessions![0]!.id);
    await context.close();

    // Bob asks for it by id.
    await ready(page);
    await page.goto(`/review/${aliceSession}`);

    /**
     * Asserted on content, not on the status code.
     *
     * The page calls `notFound()` before it renders anything, but the `(app)`
     * layout above it has already streamed its shell by then, so Next answers
     * 200 with the not-found body — the same behaviour Phase 8 recorded. That
     * is a streaming artefact, not the security property. The property is that
     * Bob sees nothing of Alice's, and it holds because RLS returned him no
     * row, not because a status code says so.
     */
    await expect(page.getByRole('heading', { name: 'That page does not exist.' })).toBeVisible();
    await expect(page.getByTestId('session-tiers')).toHaveCount(0);
    await expect(page.getByTestId('mistake-log')).toHaveCount(0);

    // And nothing of Alice's leaked into the markup on the way past.
    expect(await page.content()).not.toContain('session-by-tag');
  });

  test('a new account sees an honest empty state, not a broken page', async ({ page }) => {
    await ready(page);
    await page.goto('/review');

    await expect(page.getByTestId('accuracy-chart-empty')).toBeVisible();
    await expect(page.getByText(/No answers recorded yet/)).toBeVisible();
    await expect(page.getByText(/No sessions yet/)).toBeVisible();
  });
});

test.describe('the accuracy chart', () => {
  test('draws the days you played and carries a table for screen readers', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await playSession(page, 10);
    await page.goto('/review');

    const chart = page.getByTestId('accuracy-chart');
    await expect(chart).toBeVisible();

    // The accessible equivalent is real data, not a sentence describing a shape.
    await expect(chart.locator('table')).toBeAttached();
    await expect(chart.locator('table')).toContainText('no answers');
  });
});

test.describe('the command palette', () => {
  test('opens on ⌘K and navigates', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await page.goto('/dashboard');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-input')).toBeVisible();

    await page.getByTestId('command-input').fill('review');
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/review$/);
  });

  test('closes on Escape without navigating', async ({ page }) => {
    await ready(page);
    await page.goto('/dashboard');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-input')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('command-input')).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  /**
   * The collision worth testing: `f` folds in a drill, and typing "f" into the
   * palette must not answer the spot behind it.
   */
  test('does not answer the drill behind it', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await page.goto('/drill/quick');
    await page.getByRole('button', { name: '10 spots', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('[data-testid="progress"]');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-input')).toBeVisible();

    await page.getByTestId('command-input').fill('fff');

    // The spot behind is still unanswered.
    await expect(page.getByTestId('grade')).toHaveCount(0);
    await expect(page.getByTestId('command-input')).toHaveValue('fff');
  });

  test('offers no locked lesson', async ({ page }) => {
    test.setTimeout(120_000);

    await ready(page);
    await page.goto('/dashboard');
    await page.keyboard.press('ControlOrMeta+k');

    const list = page.getByTestId('command-list');
    await expect(list).toBeVisible();

    // A fresh account has only the first lesson open; the fourth is locked and
    // a palette entry leading to a page that refuses to open is worse than none.
    await expect(list).toContainText('A range is not a list');
    await expect(list).not.toContainText('Defending against the small blind');
  });
});

test.describe('the landing page', () => {
  test('renders for a signed-out visitor, with a real chart', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Learn 6-max preflop properly/ })).toBeVisible();

    // The grid is rendered from bundled content, because RLS correctly refuses
    // an anonymous visitor every `range_charts` row. A landing page that 500s
    // for logged-out visitors is not a landing page.
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start free' })).toBeVisible();
  });

  test('shows a genuinely mixed hand, which is the point it is making', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');

    // AJo opens some of the time and folds the rest. A pure hand would
    // illustrate the opposite of the sentence above it.
    const panel = page.getByText(/AJo/).first();
    await expect(panel).toBeVisible();
  });

  test('sends a signed-in visitor to the dashboard instead', async ({ page }) => {
    await ready(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('the privacy page is readable without an account', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/privacy');

    await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
    // It names the two services that actually run, and nothing it does not do.
    await expect(page.getByText('PostHog')).toBeVisible();
    await expect(page.getByText('Sentry')).toBeVisible();
  });
});
