import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Cookie, type Page } from '@playwright/test';

/**
 * Accessibility, as a test rather than an audit.
 *
 * `docs/02-roadmap.md` lists an "accessibility audit" in this phase. An audit
 * is a claim about one afternoon; the next component someone writes can undo it
 * and nothing says so. This runs axe over every route on every CI run, which is
 * a claim that keeps holding.
 *
 * `eslint-plugin-jsx-a11y` already runs and catches none of what axe does — it
 * reads JSX in isolation, so it cannot see a contrast failure, a duplicate id,
 * a landmark that is missing once the page is assembled, or a heading level
 * that skips because two components were composed.
 *
 * Scoped to WCAG 2.1 A and AA. `docs/05-ui-ux.md` sets the quality floor at
 * "visible keyboard focus, full keyboard navigation, contrast checked" and AA
 * is the standard those come from.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PASSWORD = 'correct horse battery staple';

/**
 * One account, reused by every signed-in scan.
 *
 * Signing up per test meant thirteen sign-ups and thirteen placement skips for
 * a suite that renders no forms it is testing — it took eight minutes and the
 * later tests timed out waiting on a dev server busy compiling for the earlier
 * ones. The cookies are captured once and replayed, which is what Playwright's
 * storage state is for.
 *
 * Each scan still gets a fresh page and a fresh navigation; only the sign-up is
 * shared, and no test here writes anything that another could observe.
 */
let session: Promise<readonly Cookie[]> | undefined;

async function signedInCookies(page: Page) {
  session ??= (async () => {
    const email = `e2e-a11y-${Date.now()}-${process.pid}@test.local`;

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/(dashboard|onboarding)$/);

    await page.goto('/onboarding');
    await page.getByRole('button', { name: /Skip, start at the beginning/ }).click();
    await expect(page.getByTestId('placement-result')).toBeVisible();

    return page.context().cookies();
  })();

  return session;
}

/** Puts the shared session's cookies on this page's context. */
async function signIn(page: Page): Promise<void> {
  await page.context().addCookies(await signedInCookies(page));
}

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

/** Names the rule and the element, so a failure says what to fix. */
function report(violations: Awaited<ReturnType<typeof scan>>['violations']): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n'),
    )
    .join('\n');
}

test.describe('signed out', () => {
  for (const path of ['/', '/sign-in', '/sign-up', '/privacy']) {
    test(`${path} has no accessibility violations`, async ({ page }) => {
      await page.goto(path);
      const { violations } = await scan(page);

      expect(report(violations), report(violations)).toBe('');
    });
  }
});

test.describe('signed in', () => {
  for (const path of [
    '/dashboard',
    '/learn',
    '/range-explorer',
    '/drill/quick',
    '/drill/weak-spots',
    '/review',
  ]) {
    test(`${path} has no accessibility violations`, async ({ page }) => {
      test.setTimeout(120_000);

      await signIn(page);
      await page.goto(path);

      // Every one of these renders something asynchronously; scanning before it
      // lands would pass by measuring a skeleton.
      await page.waitForLoadState('networkidle');

      const { violations } = await scan(page);
      expect(report(violations), report(violations)).toBe('');
    });
  }

  test('a lesson page has no accessibility violations', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/learn/a-range-is-not-a-list');
    await page.waitForLoadState('networkidle');

    const { violations } = await scan(page);
    expect(report(violations), report(violations)).toBe('');
  });

  /**
   * A drill mid-spot, which is a different DOM from the config screen — the
   * grid, the seat map and the decision controls only exist here.
   */
  test('a drill in progress has no accessibility violations', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/drill/quick');
    await page.getByRole('button', { name: '10 spots', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('[data-testid="progress"]');

    const { violations } = await scan(page);
    expect(report(violations), report(violations)).toBe('');
  });

  /** And after answering, when the chart and the feedback panel appear. */
  test('the feedback moment has no accessibility violations', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/drill/quick');
    await page.getByRole('button', { name: '10 spots', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('[data-testid="progress"]');
    await page.keyboard.press('f');
    await page.waitForSelector('[data-testid="grade"]');

    const { violations } = await scan(page);
    expect(report(violations), report(violations)).toBe('');
  });

  /**
   * The command palette is a modal dialog built by hand rather than taken from
   * a library, so it is the most likely thing in the app to get focus handling
   * or roles wrong.
   */
  test('the command palette has no accessibility violations', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/dashboard');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-input')).toBeVisible();

    const { violations } = await scan(page);
    expect(report(violations), report(violations)).toBe('');
  });
});
