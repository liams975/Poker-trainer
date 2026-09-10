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

/** The six seats, for checking that a stored action names one of them. */
const SEATS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

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
 * Sits down at the table, with the beat collapsed.
 *
 * `page.emulateMedia({ reducedMotion: 'reduce' })` is not a test backdoor: the
 * runner reads `useReducedMotion()` and sets its beat to zero, so this is the
 * path a real reader with that preference takes. What it buys is a hand that
 * plays out in milliseconds instead of the twenty-odd seconds twenty-one bot
 * actions at 620ms take — and this suite runs `fullyParallel` with `retries: 0`
 * against a cold Turbopack dev server, which is exactly the combination that
 * broke the ⌘K test in Phase 12a.
 *
 * `motion.spec.ts` sets the same media per test rather than globally, so
 * nothing here changes what it measures. One test below deliberately does not
 * call this, and asserts the pacing is still there.
 */
async function sitDown(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/play');
  await expect(page.getByTestId('seat').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Plays one hand to its end, always taking the most passive legal line.
 *
 * Check when it is free, call when it is not, fold only when neither is — so
 * the hand terminates without the test having to reason about sizing, and it
 * reaches a showdown often enough to exercise the reveal.
 *
 * **Hero does not necessarily act.** In the big blind against a round of folds
 * there is no decision to make, and the hand ends without a single click. So
 * this waits on "a choice or the summary", never on a choice alone.
 */
async function playOneHand(page: Page): Promise<void> {
  const summary = page.getByTestId('hand-summary');
  const choices = page.locator('[data-testid^="choice-"]');

  for (let guard = 0; guard < 80; guard++) {
    // Whichever comes first. `.or()` auto-waits, so there is no polling
    // interval here to be wrong about.
    await expect(summary.or(choices.first())).toBeVisible({ timeout: 30_000 });

    if (await summary.isVisible()) return;

    for (const id of ['choice-check', 'choice-call', 'choice-fold']) {
      const choice = page.getByTestId(id);
      if (await choice.isVisible()) {
        await choice.click();
        break;
      }
    }
  }

  throw new Error('the hand did not end within 80 decisions');
}

test.describe('bot play', () => {
  test('deals a hand, plays it out, and reports what happened', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await sitDown(page);

    // Six seats on a ring, and hero is the only one whose cards are face up.
    await expect(page.getByTestId('seat')).toHaveCount(6);
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
    await sitDown(page);

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
    await sitDown(page);
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

    expect(Array.isArray(row.actions)).toBe(true);
    expect(row.hero_position).toMatch(/^(UTG|HJ|CO|BTN|SB|BB)$/);

    /**
     * **The stored actions include seats the client never sent.**
     *
     * This is the assertion that makes the whole write path mean something. The
     * browser posts hero's actions and nothing else — no board, no opponents —
     * so an action attributed to another seat can only have come from the
     * server replaying the hand from the seed. "The array is non-empty" would
     * have passed just as happily against a server that stored the client's
     * claim verbatim, which is the exact thing this design refuses to do.
     */
    const actions = row.actions as { position?: string; street?: string }[];
    expect(actions.length).toBeGreaterThan(0);

    /**
     * Every entry has to be a real `BettingAction` — a seat and a street.
     *
     * That check is the load-bearing half, and it is not obvious why. The
     * client's payload is `{ action, size? }` with **no position field at all**,
     * so an earlier version of this test that only asked "is some action
     * attributed to a seat other than hero's" passed vacuously against a server
     * storing the claim verbatim: `undefined !== 'BTN'` is perfectly true. The
     * mutation that swaps `replay.actions` for the posted actions survived it.
     */
    for (const action of actions) {
      expect(SEATS, `an action with no seat: ${JSON.stringify(action)}`).toContain(
        action.position,
      );
      expect(action.street, `an action with no street: ${JSON.stringify(action)}`).toBeTruthy();
    }

    const others = actions.filter((action) => action.position !== row.hero_position);
    expect(others.length, 'no opponent action was reconstructed').toBeGreaterThan(0);
    // Recorded so a stored hand stays interpretable when either moves.
    expect(row.heuristic_version).toBe('heuristic');
    expect(row.chart_version).toBeTruthy();
  });

  test('the next hand moves the button', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await sitDown(page);
    await playOneHand(page);

    const hero = page.locator('[data-testid="seat"][data-hero="true"]');
    const first = await hero.getAttribute('data-position');

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

  /**
   * Cards are turned over only when the hand actually produced a showdown.
   *
   * `settle.ts` makes this a rule rather than an absence of data:
   * "`HandResult.showdown` is `undefined` rather than empty, so a caller cannot
   * accidentally treat 'nobody had to show' as 'nobody had anything'." Revealing
   * a winner's cards on a folded-out pot hands out information the hand never
   * produced — and it is invisible in a screenshot, because the table looks
   * perfectly reasonable either way.
   *
   * Asserted as the invariant rather than by contriving a folded-out pot: the
   * summary says which kind of ending it was, so whichever this hand gives, the
   * seats have to agree with it.
   */
  test('shows opponents’ cards only when there was a showdown', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await sitDown(page);

    // Opponents' hands carry "<POS>’s hand:"; hero's carries "Your hand:", and
    // hero may see their own cards after folding — that is their information.
    const OPPONENT_CARDS = '[role="img"][aria-label*="hand:"]:not([aria-label^="Your"])';
    const revealed = page.locator(OPPONENT_CARDS);

    /**
     * A folded seat never shows cards. **This is the assertion that bites.**
     *
     * `HandResult.payouts` maps over *every* seat, folded ones included, so a
     * reveal keyed on payouts rather than on `showdown` turns over the cards of
     * players who mucked — on essentially every hand. Checking only the
     * folded-out-pot case missed it entirely, because hero calling everything
     * reaches a showdown nearly every time and the branch never ran.
     */
    const foldedShowing = page.locator(
      `[data-testid="seat"][data-status="folded"] ${OPPONENT_CARDS}`,
    );

    for (let hand = 0; hand < 4; hand++) {
      await playOneHand(page);

      await expect(
        foldedShowing,
        'a seat that folded is showing its cards',
      ).toHaveCount(0);

      const summary = page.getByTestId('hand-summary');
      const wentToShowdown = (await summary.textContent())?.includes('Showdown') ?? false;

      if (wentToShowdown) {
        await expect(revealed.first()).toBeVisible();
      } else {
        await expect(
          revealed,
          'everyone folded, so no opponent should be showing cards',
        ).toHaveCount(0);
      }

      if (hand < 3) await page.getByTestId('next-hand').click();
    }
  });

  /**
   * The one test that does **not** collapse the beat.
   *
   * Everything above runs under `reducedMotion: 'reduce'` so a hand finishes in
   * milliseconds, which means a regression that set the beat to zero for
   * everybody would pass the whole suite unnoticed — and the table would become
   * six seats' worth of actions appearing in a single frame, which is
   * unreadable and is the reason the pacing exists.
   *
   * So: at full motion, the hand must still be in progress a moment after the
   * seats appear.
   */
  test('paces the bots, so the ring can be read', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/play');

    await expect(page.getByTestId('seat').first()).toBeVisible({ timeout: 30_000 });

    // One beat is 620ms. Half of one is not enough time for a whole hand, and
    // the runner is waiting on the other seats rather than on hero.
    await page.waitForTimeout(300);
    await expect(page.getByTestId('hand-summary')).toHaveCount(0);
  });
});
