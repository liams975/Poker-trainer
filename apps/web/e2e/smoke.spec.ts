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

  const applied = await page.evaluate(async () => {
    await document.fonts.ready;

    /**
     * docs/05: tabular numerals are "non-negotiable", because frequency
     * columns must align or the grid is unreadable. Measured rather than read
     * off a property: Phase 17 gets alignment from a monospaced face, not from
     * a `tnum` flag on body (which spaced out the sans's punctuation), so the
     * claim worth testing is that a narrow figure and a wide one take the
     * same room where figures are set.
     */
    const width = (text: string) => {
      const probe = document.createElement('span');
      probe.className = 'font-mono';
      probe.style.cssText = 'position:absolute;font-size:40px;white-space:pre';
      probe.textContent = text;
      document.body.appendChild(probe);
      const measured = probe.getBoundingClientRect().width;
      probe.remove();
      return measured;
    };

    return {
      background: getComputedStyle(document.body).backgroundColor,
      ones: width('1111.11'),
      eights: width('8888.88'),
    };
  });

  // #12110f — the canvas. If Tailwind failed to build, this is white.
  expect(applied.background).toBe('rgb(18, 17, 15)');
  expect(applied.ones, 'figures do not align in the data face').toBeCloseTo(applied.eights, 1);
});

test('the three faces are the ones actually drawn', async ({ page }) => {
  /**
   * Phases 14 to 16 loaded Instrument Serif and Instrument Sans and never drew
   * either. next/font put its variables on <body>; Tailwind resolves
   * `--font-display: var(--font-…)` at `:root`, where that variable did not yet
   * exist, so the theme's font stacks computed to nothing and every heading
   * fell through to the system face. Every test was green, because nothing
   * asked which face was on the screen.
   *
   * So this asks, three times, and waits for the files: a family name in the
   * computed stack is not proof the face loaded, and a loaded face nobody's
   * stack names is not proof it is drawn.
   */
  await page.goto('/');

  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    const family = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!)
        .fontFamily.split(',')[0]!
        .replace(/"/g, '');
    const loaded = new Set(
      [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family.replace(/"/g, '')),
    );
    return {
      display: family('h1'),
      body: family('body'),
      mono: (() => {
        const probe = document.createElement('span');
        probe.className = 'font-mono';
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).fontFamily.split(',')[0]!.replace(/"/g, '');
        probe.remove();
        return value;
      })(),
      loaded: [...loaded],
    };
  });

  expect(faces.display).toBe('Old Standard TT');
  expect(faces.body).toBe('Schibsted Grotesk');
  expect(faces.mono).toBe('Fragment Mono');
  for (const face of ['Old Standard TT', 'Schibsted Grotesk']) {
    expect(faces.loaded, `${face} is named but its file never loaded`).toContain(face);
  }
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
