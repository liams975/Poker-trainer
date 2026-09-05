import { expect, test, type Page } from '@playwright/test';

/**
 * Motion, and the reason this file exists separately from `shell.spec.ts`.
 *
 * `globals.css` collapses animation and transition durations under
 * `prefers-reduced-motion: reduce`, globally, and `shell.spec.ts` proves it by
 * probing a `div.animate-pulse`. **That block has no effect on anything Motion
 * does.** Motion animates by writing inline styles frame by frame, which no
 * stylesheet can reach — so as of Phase 11 the existing test guards a path that
 * covers a shrinking fraction of the animation in the app, and would have gone
 * on passing while every new animation ignored the user's stated preference.
 *
 * A test that keeps passing after the thing it names stops being true is worse
 * than no test. So this one watches a real Motion element.
 *
 * **Method: count distinct computed transforms across the first 600ms.** Not a
 * sample at a fixed moment — that is a race with the frame clock and reads as
 * flake. A tween produces a new matrix every frame; a suppressed one produces
 * the declared start and then the end. Measured on this machine: 20 distinct
 * values with motion allowed, 2 with it reduced. The thresholds below leave
 * both sides most of that gap.
 *
 * The pair is the point, exactly as in `shell.spec.ts`: without the second
 * test, deleting every animation in the app would pass the first one perfectly.
 */

const PASSWORD = 'correct horse battery staple';

let sequence = 0;

async function ready(page: Page): Promise<void> {
  sequence += 1;
  const email = `e2e-motion-${Date.now()}-${process.pid}-${sequence}@test.local`;

  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/(dashboard|onboarding)$/);

  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Skip, start at the beginning/ }).click();
  await expect(page.getByTestId('placement-result')).toBeVisible();
}

/**
 * Starts a drill and records every distinct transform hero's first hole card
 * takes while it is dealt.
 */
async function dealFrames(page: Page): Promise<number> {
  await page.goto('/drill/quick');
  await page.getByRole('button', { name: '10 spots', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();

  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const seen: string[] = [];

        /**
         * The window opens when the card *appears*, not when sampling starts.
         *
         * Fixed at 600ms from the click, this returned 0 whenever the spot took
         * longer than that to render — which under a fully parallel suite is
         * often. Waiting for the selector outside `evaluate` would instead miss
         * the opening frames, since the deal begins the instant it mounts.
         */
        const deadline = performance.now() + 10_000;
        let firstSeen: number | undefined;

        const tick = () => {
          const card = document
            .querySelector('[data-testid="seat"][data-hero="true"]')
            ?.querySelector('span');

          if (card) {
            firstSeen ??= performance.now();
            const transform = getComputedStyle(card).transform;
            if (seen[seen.length - 1] !== transform) seen.push(transform);
          }

          const done =
            (firstSeen !== undefined && performance.now() - firstSeen > 600) ||
            performance.now() > deadline;

          if (done) resolve(seen.length);
          else requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      }),
    undefined,
  );
}

test.describe('reduced motion reaches Motion, not just the stylesheet', () => {
  test('the deal does not tween when the user asked for that', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Guard first: if emulation silently stopped working, the assertion below
    // would be measuring the default and proving nothing.
    await page.goto('/sign-in');
    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      'reduced-motion emulation did not reach the page',
    ).toBe(true);

    await ready(page);

    // The declared start still paints for one frame before Motion jumps to the
    // end — that is its documented behaviour and it is a jump, not a tween.
    expect(await dealFrames(page)).toBeLessThanOrEqual(4);
  });

  test('the deal DOES tween for users who did not ask', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await ready(page);

    expect(await dealFrames(page)).toBeGreaterThanOrEqual(8);
  });
});

test.describe('the table', () => {
  test('seats read in action order however they are placed', async ({ page }) => {
    test.setTimeout(120_000);
    await ready(page);

    await page.goto('/drill/quick');
    await page.getByRole('button', { name: '10 spots', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('[data-testid="seat"]');

    /**
     * The ring is positioned by angle and read in the order play happens. A
     * screen reader walks the DOM, so those two must be decided separately —
     * and this is the assertion that keeps them separate, because swapping the
     * list to ring order looks identical on screen and breaks nothing visible.
     */
    const order = await page
      .locator('[data-testid="seat"]')
      .evaluateAll((seats) => seats.map((seat) => seat.getAttribute('data-position')));

    const PREFLOP = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    expect(order).toEqual(PREFLOP.filter((position) => order.includes(position)));

    // And hero is exactly one seat, wherever in that order it falls.
    await expect(page.locator('[data-testid="seat"][data-hero="true"]')).toHaveCount(1);
  });

  test('folded seats recede by colour, never by opacity', async ({ page }) => {
    test.setTimeout(120_000);
    await ready(page);

    await page.goto('/drill/quick');
    await page.getByRole('button', { name: '10 spots', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('[data-testid="seat"]');

    // After the deal has settled. The cards fade in from zero, so sampling
    // while that runs reads a transient 0.11 and fails on the animation rather
    // than on the thing being tested.
    await page.waitForTimeout(900);

    /**
     * Phase 10's axe run found `opacity-40` on folded seats sitting near 2:1
     * against the surface, under the 4.5:1 floor. `a11y.spec.ts` would catch a
     * contrast regression, but only once a spot happened to contain a folded
     * seat — this says the rule outright so the reason survives.
     */
    const opacities = await page
      .locator('[data-testid="seat"]')
      .evaluateAll((seats) =>
        seats.flatMap((seat) =>
          [seat, ...seat.querySelectorAll('*')].map((node) =>
            Number.parseFloat(getComputedStyle(node).opacity),
          ),
        ),
      );

    for (const opacity of opacities) {
      expect(opacity, 'a seat is faded with opacity rather than colour').toBeGreaterThan(0.95);
    }
  });
});
