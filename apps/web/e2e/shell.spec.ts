import { expect, test } from '@playwright/test';

/**
 * The other two Phase 5 exit criteria: "Keyboard focus is visible everywhere.
 * Reduced motion respected."
 *
 * docs/05-ui-ux.md puts both in the quality floor and is explicit that they are
 * exit criteria rather than polish items, so they are asserted rather than
 * eyeballed.
 */

/**
 * Walks the page the way a keyboard user does, recording each stop.
 *
 * Deliberately driven by real Tab presses rather than by enumerating elements
 * and calling `focus()` on them: `:focus-visible` only engages for keyboard
 * interaction on buttons and links, and a programmatic `focus()` on a
 * non-focusable node silently leaves focus on `<body>` — which measures the
 * outline of an element nothing focused, and passes or fails at random.
 */
async function tabThrough(page: import('@playwright/test').Page, steps: number) {
  const stops: { label: string; outlineWidth: number; outlineStyle: string }[] = [];

  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab');

    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;

      /**
       * The tab order wraps through <body> and, in dev, through Next's
       * dev-overlay custom element, and neither is ordered predictably.
       * Both are outside the app's own UI — <body> reports `outline: 3px none`
       * and the overlay lives in a shadow root — so asserting on them would be
       * asserting on chrome this project neither owns nor can style. Skipped,
       * not treated as the end of the walk, because on the dashboard the
       * overlay comes first and stopping there would find nothing at all.
       */
      const isBoundary =
        el === document.body ||
        el === document.documentElement ||
        el.tagName.includes('-'); // custom element, i.e. nextjs-portal

      if (isBoundary) return 'skip' as const;

      const style = getComputedStyle(el);
      return {
        label:
          el.getAttribute('aria-label') ??
          el.getAttribute('name') ??
          el.textContent?.trim().slice(0, 40) ??
          el.tagName,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineStyle: style.outlineStyle,
      };
    });

    if (stop === 'skip' || stop === null) continue;
    stops.push(stop);
  }

  return stops;
}

test.describe('keyboard focus', () => {
  test('every tab stop on sign-in carries a visible ring', async ({ page }) => {
    await page.goto('/sign-in');

    const stops = await tabThrough(page, 10);

    // Sanity: the walk actually went somewhere. Without this the loop below
    // passes vacuously on an empty array.
    expect(stops.length).toBeGreaterThanOrEqual(5);

    for (const stop of stops) {
      expect(stop.outlineWidth, `no focus ring on "${stop.label}"`).toBeGreaterThan(0);
      expect(stop.outlineStyle, `outline suppressed on "${stop.label}"`).not.toBe('none');
    }
  });

  test('the whole sign-in form is reachable by keyboard alone', async ({ page }) => {
    await page.goto('/sign-in');

    const labels = (await tabThrough(page, 10)).map((s) => s.label.toLowerCase()).join(' | ');

    // Every control needed to actually sign in, plus the way out to sign-up.
    expect(labels).toContain('email');
    expect(labels).toContain('password');
    expect(labels).toContain('sign in');
    expect(labels).toContain('continue with google');
    expect(labels).toContain('create one');
  });

  test('the dashboard is operable by keyboard too', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(`e2e-focus-${Date.now()}@test.local`);
    await page.getByLabel('Password').fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Phase 8 puts the placement diagnostic in front of the dashboard for a new
    // account. Skipping is one click; the dashboard is what this test is about.
    await page.waitForURL(/\/(dashboard|onboarding)$/);
    await page.goto('/onboarding');
    if (new URL(page.url()).pathname === '/onboarding') {
      await page.getByRole('button', { name: /Skip, start at the beginning/ }).click();
      await page.waitForSelector('[data-testid="placement-result"]');
    }
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);

    const stops = await tabThrough(page, 6);

    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop.outlineWidth, `no focus ring on "${stop.label}"`).toBeGreaterThan(0);
    }

    // Sign out has to be keyboard-reachable — it is half the exit criterion.
    expect(stops.map((s) => s.label.toLowerCase()).join(' | ')).toContain('sign out');
  });
});

test.describe('reduced motion', () => {
  test('animations are flattened when the user asks for that', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/sign-in');

    // Guard first: if emulation silently stopped working, every assertion
    // below would pass against default styles and prove nothing.
    const queryMatches = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(queryMatches, 'reduced-motion emulation did not reach the page').toBe(true);

    const durations = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'animate-pulse transition-colors';
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const result = { animation: style.animationDuration, transition: style.transitionDuration };
      probe.remove();
      return result;
    });

    // The global rule collapses these to 0.01ms — under a frame either way.
    expect(Number.parseFloat(durations.animation)).toBeLessThan(0.01);
    expect(Number.parseFloat(durations.transition)).toBeLessThan(0.01);
  });

  test('animation is NOT flattened for users who did not ask', async ({ page }) => {
    // The complement of the test above. Without the pair, a stylesheet that
    // disabled all animation unconditionally would look identical to one that
    // respects the preference — and only one of those is correct.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/sign-in');

    const duration = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'animate-pulse';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).animationDuration;
      probe.remove();
      return value;
    });

    expect(Number.parseFloat(duration)).toBeGreaterThan(0.1);
  });
});
