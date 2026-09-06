import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 12b's exit criterion: a hand of poker, played by a person, start to
 * finish, and written down.
 *
 * The rows are read back with the service role rather than inferred from the
 * screen, for the reason `drill-runner.spec.ts` gives: a table that renders a
 * perfect hand and stores nothing would pass every visual assertion. And here
 * the stored row is not even the client's — `lib/bot/record.ts` replays the
 * hand server-side and writes what *it* derives, so what landed in Postgres is
 * the only evidence that both ends of the engine agree.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'correct horse battery staple';

/** Per-worker unique, for the same reason the other specs are. */
let sequence = 0;

async function signIn(page: Page): Promise<string> {
  sequence += 1;
  const email = `e2e-play-${Date.now()}-${process.pid}-${sequence}@test.local`;

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

/**
 * Plays one hand to its end, always taking the most passive legal line.
 *
 * Check when it is free, call when it is not, and never raise — so the hand
 * terminates without the test having to reason about sizing, and it reaches a
 * showdown often enough to exercise the reveal.
 */
async function playOneHand(page: Page): Promise<void> {
  await expect(page.getByTestId('seat').first()).toBeVisible({ timeout: 20_000 });

  for (let guard = 0; guard < 40; guard++) {
    const summary = page.getByTestId('hand-summary');
    if (await summary.isVisible().catch(() => false)) return;

    const check = page.getByTestId('choice-check');
    const call = page.getByTestId('choice-call');
    const fold = page.getByTestId('choice-fold');

    if (await check.isVisible().catch(() => false)) {
      await check.click();
    } else if (await call.isVisible().catch(() => false)) {
      await call.click();
    } else if (await fold.isVisible().catch(() => false)) {
      await fold.click();
    } else {
      // Bots are acting. The beat is 620ms, so this is a beat and a bit.
      await page.waitForTimeout(400);
    }
  }

  await expect(page.getByTestId('hand-summary')).toBeVisible({ timeout: 20_000 });
}

test.describe('bot play', () => {
  test('deals a hand, plays it out, and reports what happened', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/play');

    // Six seats on a ring, hero at the bottom, and hero is the only one whose
    // cards are face up.
    await expect(page.getByTestId('seat')).toHaveCount(6, { timeout: 20_000 });
    await expect(page.locator('[data-testid="seat"][data-hero="true"]')).toHaveCount(1);

    await playOneHand(page);

    const summary = page.getByTestId('hand-summary');
    await expect(summary).toBeVisible();
    await expect(page.getByTestId('hero-net')).toBeVisible();

    // Every decision hero made is reported. Some carry a tier, some carry a
    // reason — both are correct outcomes and neither is a failure.
    const decisions = page.getByTestId('hand-decision');
    const count = await decisions.count();

    for (let index = 0; index < count; index++) {
      const decision = decisions.nth(index);
      const graded = (await decision.getAttribute('data-graded')) !== null;

      if (graded) {
        await expect(decision.locator('[data-tier]')).toBeVisible();
      } else {
        await expect(decision.getByTestId('uncharted')).toBeVisible();
      }
    }
  });

  test('never grades a postflop decision', async ({ page }) => {
    /**
     * The rule this phase exists to hold. The bot's postflop play is a
     * heuristic — invented logic — and `heuristics.ts` refused to ship one for
     * four phases precisely because a strategy that can play can also grade.
     *
     * Asserted over however many postflop decisions this hand happens to
     * contain, including none: the claim is that no postflop row *ever* carries
     * a tier, which is exactly what the loop below checks.
     */
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/play');

    // A few hands, so at least one is likely to see a flop.
    for (let hand = 0; hand < 3; hand++) {
      await playOneHand(page);

      const postflop = page.locator(
        '[data-testid="hand-decision"]:not([data-street="preflop"])',
      );

      for (let index = 0; index < (await postflop.count()); index++) {
        await expect(postflop.nth(index)).not.toHaveAttribute('data-graded', '');
        await expect(postflop.nth(index).getByTestId('uncharted')).toBeVisible();
      }

      if (hand < 2) await page.getByTestId('next-hand').click();
    }
  });

  test('writes the hand the server replayed, not the one the client claimed', async ({ page }) => {
    test.setTimeout(120_000);

    const email = await signIn(page);
    await page.goto('/play');
    await playOneHand(page);

    // The write is a fetch that lands after the summary renders.
    await expect(page.getByTestId('recording-error')).toHaveCount(0);

    const userId = await userIdFor(email);

    await expect
      .poll(
        async () => {
          const { data } = await admin()
            .from('bot_hands')
            .select('seed, actions, hero_position, heuristic_version')
            .eq('user_id', userId);
          return data?.length ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    const { data } = await admin()
      .from('bot_hands')
      .select('seed, actions, hero_position, heuristic_version, chart_version')
      .eq('user_id', userId);

    const row = data![0]!;

    // The actions are the server's replay. A hand always has some — the blinds
    // are posted before anyone acts, and somebody has to act after them.
    expect(Array.isArray(row.actions)).toBe(true);
    expect((row.actions as unknown[]).length).toBeGreaterThan(0);
    expect(row.hero_position).toMatch(/^(UTG|HJ|CO|BTN|SB|BB)$/);
    // Recorded so a stored hand stays interpretable when either moves.
    expect(row.heuristic_version).toBe('heuristic');
    expect(row.chart_version).toBeTruthy();
  });

  test('the next hand moves the button', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/play');
    await playOneHand(page);

    const first = await page
      .locator('[data-testid="seat"][data-hero="true"]')
      .getAttribute('data-position');

    await page.getByTestId('next-hand').click();
    await expect(page.getByTestId('hand-count')).toContainText('Hand 2');

    await expect
      .poll(
        async () =>
          page.locator('[data-testid="seat"][data-hero="true"]').getAttribute('data-position'),
        { timeout: 20_000 },
      )
      .not.toBe(first);
  });
});
