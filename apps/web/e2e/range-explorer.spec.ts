import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CANONICAL_HANDS, diffCharts, handStrategy, parseChartSet } from '@poker/engine';
import { expect, test, type Page } from '@playwright/test';

import { describeMix, orderedMix } from '../src/components/range/mix-format';
import { chartLabel } from '../src/lib/charts/map';

/**
 * The chart JSON is read from disk rather than imported through
 * `@poker/content`, whose `import charts from './charts/rfi.json'` needs an
 * import attribute under Playwright's loader. Same bytes, same validator — the
 * expected values still come from the authored content, not from a copy.
 */
function authoredChartSet() {
  const dir = resolve(import.meta.dirname, '..', '..', '..', 'packages', 'content', 'src', 'charts');
  const read = (name: string): unknown[] =>
    JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as unknown[];

  return parseChartSet({
    version: 'e2e',
    published: true,
    charts: [...read('rfi.json'), ...read('bb-defense.json')],
  });
}

/**
 * Phase 6's exit criteria, against the real stack.
 *
 * The important one is the first: *every seeded chart renders correctly*. A
 * test that counts 169 cells would pass on a grid showing entirely the wrong
 * range, so this compares each cell's rendered mix against what the engine says
 * that hand's strategy is — the same comparison a user makes when they trust
 * the tool.
 *
 * Expected values come from `@poker/content`, so this also proves the round
 * trip: content -> `pnpm content:sync` -> Postgres -> RLS -> engine validation
 * -> DOM produces what was authored.
 */

const chartSet = authoredChartSet();
const PASSWORD = 'correct horse battery staple';

/**
 * Playwright runs the file in several worker processes, each with its own copy
 * of this module — so a plain counter restarts at 0 per worker and two workers
 * can mint the identical address within the same millisecond. The pid is what
 * makes it unique. (This is exactly the collision auth.spec.ts already hit.)
 */
let sequence = 0;

async function signIn(page: Page): Promise<void> {
  sequence += 1;
  await page.goto('/sign-up');
  await page
    .getByLabel('Email')
    .fill(`e2e-range-${Date.now()}-${process.pid}-${sequence}@test.local`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function openExplorer(page: Page): Promise<void> {
  await signIn(page);
  await page.goto('/range-explorer');
  await page.waitForSelector('[role="grid"]');
}

/** Every cell's rendered mix, keyed by hand, read out of the first grid. */
async function renderedMixes(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]')!;
    const out: Record<string, string> = {};
    for (const cell of grid.querySelectorAll('[data-hand]')) {
      out[cell.getAttribute('data-hand')!] = cell.getAttribute('data-mix')!;
    }
    return out;
  });
}

test.describe('every seeded chart renders correctly', () => {
  test('the dashboard now offers the explorer as a live mode', async ({ page }) => {
    await signIn(page);

    await page.getByRole('link', { name: /Range Explorer/ }).click();

    await expect(page).toHaveURL(/\/range-explorer$/);
    await expect(page.getByRole('heading', { name: 'Range Explorer' })).toBeVisible();
  });

  for (const chart of chartSet.charts) {
    const label = chartLabel(chart);

    test(`${label} matches the engine on all 169 hands`, async ({ page }) => {
      await openExplorer(page);
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('heading', { name: label })).toBeVisible();

      const rendered = await renderedMixes(page);

      expect(Object.keys(rendered)).toHaveLength(169);

      for (const hand of CANONICAL_HANDS) {
        expect(rendered[hand], `${label} renders ${hand} wrongly`).toBe(
          describeMix(hand, handStrategy(chart.ranges, hand)),
        );
      }
    });
  }
});

test.describe('the grid teaches the mix, not one action', () => {
  /**
   * Asserts on the pixels, not on the data attribute.
   *
   * `data-mix` and `aria-label` are both computed from the same `frequencies`
   * prop the bar is drawn from, so they agree with each other even when the bar
   * is wrong. Mutation-tested: painting only the dominant action left all 23
   * other tests green while every cell rendered as one solid colour — which is
   * exactly the lie docs/05 says most range UIs tell.
   *
   * So this measures the rendered segment widths.
   */
  test('a mixed cell is drawn as two proportional bands, not one solid colour', async ({
    page,
  }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'BTN open', exact: true }).click();

    const widths = async (hand: string) =>
      page.evaluate((h) => {
        const cell = document.querySelector(`[data-hand="${h}"]`)!;
        const bar = cell.querySelector('span[aria-hidden="true"]')!;
        const total = bar.getBoundingClientRect().width;
        return [...bar.children].map((seg) => ({
          fraction: seg.getBoundingClientRect().width / total,
          color: getComputedStyle(seg).backgroundColor,
        }));
      }, hand);

    // A7o is 50/50 raise-fold from the button.
    const mixed = await widths('A7o');
    expect(mixed, 'a 50/50 hand must draw two bands').toHaveLength(2);
    expect(mixed[0]!.fraction).toBeCloseTo(0.5, 1);
    expect(mixed[1]!.fraction).toBeCloseTo(0.5, 1);
    // Fold is grey and sorts left; raise is vermilion and sorts right.
    expect(mixed[0]!.color).toBe('rgb(85, 96, 107)');
    expect(mixed[1]!.color).toBe('rgb(213, 94, 0)');

    // A pure hand is genuinely one band, so the check above is about the mix
    // and not merely about counting children.
    const pure = await widths('AA');
    expect(pure).toHaveLength(1);
    expect(pure[0]!.fraction).toBeCloseTo(1, 2);
    expect(pure[0]!.color).toBe('rgb(213, 94, 0)');
  });

  test('every mixed hand in the chart draws its true proportions', async ({ page }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'BTN open', exact: true }).click();

    const btn = chartSet.charts.find(
      (c) => c.heroPosition === 'BTN' && c.actionSequence === 'rfi',
    )!;

    // Every hand the chart plays as a genuine mix. If any renders as a single
    // band, the grid is teaching a pure strategy that does not exist.
    const mixedHands = CANONICAL_HANDS.filter(
      (hand) => handStrategy(btn.ranges, hand).length > 1,
    );
    expect(mixedHands.length).toBeGreaterThan(5);

    const rendered = await page.evaluate((hands) => {
      const out: Record<string, number[]> = {};
      for (const hand of hands) {
        const bar = document.querySelector(`[data-hand="${hand}"] span[aria-hidden="true"]`)!;
        const total = bar.getBoundingClientRect().width;
        out[hand] = [...bar.children].map((s) => s.getBoundingClientRect().width / total);
      }
      return out;
    }, mixedHands as string[]);

    for (const hand of mixedHands) {
      const expected = orderedMix(handStrategy(btn.ranges, hand)).map((e) => e.freq);
      const actual = rendered[hand]!;

      expect(actual, `${hand} drew ${actual.length} bands, expected ${expected.length}`).toHaveLength(
        expected.length,
      );
      expected.forEach((freq, i) => {
        expect(actual[i], `${hand} band ${i} is the wrong width`).toBeCloseTo(freq, 1);
      });
    }
  });

  test('a mixed hand shows both actions with their frequencies', async ({ page }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'BTN open', exact: true }).click();

    // A7o is 50/50 raise-fold from the button in the seeded chart. A UI that
    // showed only the dominant action would render this as a pure raise.
    await page.locator('[data-hand="A7o"]').first().click();

    const detail = page.getByRole('heading', { name: 'A7o' }).locator('..').locator('..');
    await expect(detail.getByText('Raise 2.5bb')).toBeVisible();
    await expect(detail.getByText('Fold')).toBeVisible();
    await expect(detail.getByText('50.0%').first()).toBeVisible();
  });

  test('shows combo counts, which is why AKs and AKo are different cells', async ({ page }) => {
    await openExplorer(page);

    await page.locator('[data-hand="AKs"]').first().click();
    await expect(page.getByText('4 combos')).toBeVisible();

    await page.locator('[data-hand="AKo"]').first().click();
    await expect(page.getByText('12 combos')).toBeVisible();

    await page.locator('[data-hand="AA"]').first().click();
    await expect(page.getByText('6 combos')).toBeVisible();
  });

  test('explains the spot with structured factors, not prose', async ({ page }) => {
    await openExplorer(page);
    await page.locator('[data-hand="AJo"]').first().click();

    await expect(page.getByText('Why')).toBeVisible();
    await expect(page.getByText('Position', { exact: false }).first()).toBeVisible();
  });
});

test.describe('the grid is keyboard-navigable', () => {
  test('reaches the grid by Tab and moves with the arrow keys', async ({ page }) => {
    await openExplorer(page);

    // Tab until focus lands inside the grid. The grid is one tab stop, which is
    // the point: 169 stops would technically be "navigable" and unusable.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="grid"]') !== null,
      );
      if (inside) break;
    }

    const start = await page.evaluate(() => document.activeElement?.getAttribute('data-hand'));
    expect(start, 'Tab never reached the grid').toBe('AA');

    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-hand'))).toBe(
      'AKs',
    );

    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-hand'))).toBe(
      'KK',
    );

    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-hand'))).toBe(
      'AKo',
    );

    // Row 1 is [AKo, KK, KQs, ... K2s], so End lands on K2s. (K2o is in the
    // K column of the offsuit half, further down — an easy one to get wrong.)
    await page.keyboard.press('End');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-hand'))).toBe(
      'K2s',
    );

    await page.keyboard.press('Home');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-hand'))).toBe(
      'AKo',
    );
  });

  test('opens a hand with Enter, so selection needs no mouse', async ({ page }) => {
    await openExplorer(page);

    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="grid"]') !== null,
      );
      if (inside) break;
    }

    // Tab lands on AA, the top-left corner. Column 0 is the offsuit ace column
    // (AA, AKo, AQo...), not the pair diagonal — so one step down is AKo.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('heading', { name: 'AKo' })).toHaveCount(0);

    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'AKo' })).toBeVisible();
  });

  test('does not run off the edge of the matrix', async ({ page }) => {
    await openExplorer(page);

    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="grid"]') !== null,
      );
      if (inside) break;
    }

    // AA is the top-left corner; up and left must be no-ops rather than
    // wrapping to the far side, which would be disorienting.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');

    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-hand'))).toBe(
      'AA',
    );
  });
});

test.describe('compare mode', () => {
  test('reports no differences when a chart is compared with itself', async ({ page }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'Compare charts' }).click();

    // Both sides to BTN open.
    const buttons = page.getByRole('button', { name: 'BTN open', exact: true });
    await buttons.first().click();
    await buttons.last().click();

    await expect(page.getByTestId('diff-summary')).toHaveText('These two charts are identical.');
  });

  test('counts the differing hands exactly as the engine does', async ({ page }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'Compare charts' }).click();

    const btn = chartSet.charts.find(
      (c) => c.heroPosition === 'BTN' && c.actionSequence === 'rfi',
    )!;
    const co = chartSet.charts.find((c) => c.heroPosition === 'CO' && c.actionSequence === 'rfi')!;
    const expected = diffCharts(btn, co).changedCount;

    // Sanity: these two charts genuinely differ, or the assertion is empty.
    expect(expected).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'BTN open', exact: true }).first().click();
    await page.getByRole('button', { name: 'CO open', exact: true }).last().click();

    await expect(page.getByTestId('diff-summary')).toHaveText(
      `${expected} of 169 hands play differently.`,
    );
  });

  test('shows the per-hand change for a hand that differs', async ({ page }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'Compare charts' }).click();

    await page.getByRole('button', { name: 'BTN open', exact: true }).first().click();
    await page.getByRole('button', { name: 'UTG open', exact: true }).last().click();

    // A2s opens from the button and folds under the gun, so the delta is total.
    // (22 opens from both, which is why it makes a poor example here.)
    await page.locator('[data-hand="A2s"]').first().click();

    await expect(page.getByText(/^Change vs/)).toBeVisible();
    await expect(page.getByText('The most common action differs.')).toBeVisible();
  });

  test('renders two grids side by side', async ({ page }) => {
    await openExplorer(page);
    await expect(page.locator('[role="grid"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Compare charts' }).click();
    await expect(page.locator('[role="grid"]')).toHaveCount(2);

    await page.getByRole('button', { name: 'Exit compare' }).click();
    await expect(page.locator('[role="grid"]')).toHaveCount(1);
  });
});

test.describe('the grid never borrows the accent colour', () => {
  /**
   * docs/05-ui-ux.md: "Accent (chrome) #E8B04B — streak and XP rail ONLY.
   * Never appears in a range grid."
   *
   * The first version of compare mode washed every changed cell in amber,
   * which put a sixth colour into a grid whose whole premise is that hue means
   * action. Nothing failed; it just quietly broke the palette's meaning. This
   * is the guard.
   *
   * The keyboard focus ring is the one deliberate exception — it is transient,
   * app-wide, and follows the caret rather than encoding anything about a hand
   * — so focus is parked outside the grid before measuring.
   */
  const ACCENT = 'rgb(232, 176, 75)';

  async function accentInsideGrids(page: Page): Promise<string[]> {
    await page.getByRole('link', { name: 'Poker Trainer' }).focus();

    return page.evaluate((accent) => {
      const found: string[] = [];
      for (const grid of document.querySelectorAll('[role="grid"]')) {
        // Include the grid element itself, not only its descendants.
        for (const node of [grid, ...grid.querySelectorAll('*')]) {
          const s = getComputedStyle(node);

          for (const prop of [
            'color',
            'backgroundColor',
            'borderTopColor',
            'borderLeftColor',
            'outlineColor',
          ] as const) {
            if (s[prop] === accent) found.push(`${node.tagName} ${prop}`);
          }

          // Tailwind's `ring-*` compiles to a box-shadow, not to an outline or
          // a border — checking only the four properties above let an amber
          // selection ring through, which is how the first version of this
          // guard passed while the rule was being broken.
          if (s.boxShadow.includes(accent)) found.push(`${node.tagName} boxShadow`);
        }
      }
      return found;
    }, ACCENT);
  }

  test('not while browsing a single chart', async ({ page }) => {
    await openExplorer(page);
    await page.locator('[data-hand="AA"]').first().click();

    expect(await accentInsideGrids(page)).toEqual([]);
  });

  test('and not while comparing, where 73 cells differ', async ({ page }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'Compare charts' }).click();
    await page.getByRole('button', { name: 'BTN open', exact: true }).first().click();
    await page.getByRole('button', { name: 'UTG open', exact: true }).last().click();
    await page.locator('[data-hand="A2s"]').first().click();

    expect(await accentInsideGrids(page)).toEqual([]);
  });
});
