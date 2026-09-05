import { expect, test } from '@playwright/test';

/**
 * The app boots, serves a rendered page, and the design tokens are actually
 * applied — a build that compiles but ships an unstyled page is a green CI and
 * a broken product.
 */
test('the app boots and serves the signed-out shell', async ({ page }) => {
  await page.goto('/sign-in');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the tab carries a real icon', async ({ page }) => {
  /**
   * `app/icon.svg`, picked up by Next's metadata file convention — there is no
   * `<link>` written by hand anywhere, so a rename or a move stops emitting one
   * silently and the tab quietly falls back to the browser default.
   *
   * Asserted through the emitted tag rather than by fetching `/icon.svg`,
   * because the tag is the contract: Next generates the href, and a hard-coded
   * path here would keep passing after the convention stopped working.
   */
  await page.goto('/sign-in');

  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveCount(1);

  const href = await icon.getAttribute('href');
  expect(href, 'the icon link has no href').toBeTruthy();

  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('svg');
});

test('the design tokens reach the page', async ({ page }) => {
  await page.goto('/sign-in');

  const applied = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return {
      background: style.backgroundColor,
      // docs/05: tabular numerals are "non-negotiable" and set globally,
      // because frequency columns must align or the grid is unreadable.
      numeric: style.fontVariantNumeric,
    };
  });

  // #0b0f14 — the canvas. If Tailwind failed to build, this is white.
  expect(applied.background).toBe('rgb(11, 15, 20)');
  expect(applied.numeric).toContain('tabular-nums');
});

test('no design token shadows a built-in Tailwind size utility', async ({ page }) => {
  /**
   * A token named `base` makes Tailwind emit a colour utility called
   * `text-base`, silently overriding the built-in font-size one — which
   * rendered every card title in background-coloured text on the background.
   * Nothing failed; it just looked wrong.
   *
   * `text-*` is both a colour and a size namespace, so any token sharing a name
   * with a size step poisons it. This asserts the size utilities stay purely
   * sizes.
   */
  await page.goto('/sign-in');

  const sizeUtilities = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'];

  const results = await page.evaluate((utilities) => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);

    const baseline = getComputedStyle(probe).color;
    const out = utilities.map((utility) => {
      probe.className = utility;
      const style = getComputedStyle(probe);
      return { utility, color: style.color, fontSize: style.fontSize };
    });

    probe.remove();
    return { baseline, out };
  }, sizeUtilities);

  for (const { utility, color, fontSize } of results.out) {
    expect(Number.parseFloat(fontSize), `${utility} should set a font size`).toBeGreaterThan(0);
    expect(color, `${utility} must not also set a colour — a token is shadowing it`).toBe(
      results.baseline,
    );
  }
});

test('card titles are legible against their card', async ({ page }) => {
  // The concrete symptom of the collision above, asserted where a human saw it.
  await page.goto('/sign-in');

  const title = page.getByRole('heading', { name: 'Sign in' });
  await expect(title).toBeVisible();

  const contrast = await title.evaluate((node) => {
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number) as [number, number, number];
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    // Walk up for the nearest painted background.
    let el: Element | null = node;
    let background = 'rgba(0, 0, 0, 0)';
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        background = bg;
        break;
      }
      el = el.parentElement;
    }

    const a = luminance(getComputedStyle(node).color);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });

  // WCAG AA for large text is 3:1; docs/05 asks for AA. A title the same
  // colour as its card scores ~1.0, which is what the bug looked like.
  expect(contrast).toBeGreaterThan(4.5);
});
