import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * WCAG contrast for the *chrome* tokens, measured against every ground they can
 * be painted on.
 *
 * `action-colors.test.ts` next door covers the five strategy hues, where the
 * question is hue discriminability under colour vision deficiency. This file
 * asks the other question — is the text readable — for the monochrome layer and
 * the accent.
 *
 * It exists because Phase 14 changed the ground. The deck specified muted text
 * as `rgba(233,233,237,.55)`, which composites to #8a8b93 and measured **4.48**
 * against `surface-raised`: under AA by 0.02, on the token carrying 170 of the
 * app's body-text usages. Nothing in the suite would have noticed, because
 * nothing in the suite was looking. Phase 17 moved the ground again, and this
 * file is why that did not need an audit by eye.
 *
 * Values are read from globals.css rather than pasted, so the assertion cannot
 * outlive the palette it is describing.
 */

const GLOBALS_CSS = readFileSync(
  resolve(import.meta.dirname, '..', 'src', 'app', 'globals.css'),
  'utf8',
);

function token(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(GLOBALS_CSS);
  if (!match?.[1]) throw new Error(`${name} is not defined in globals.css`);
  return match[1];
}

/** sRGB channel -> linear. The 0.03928 knee is WCAG's, not sRGB's 0.04045. */
function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every ground a token can land on. The worst of the three is what counts. */
const GROUNDS = ['--color-canvas', '--color-surface', '--color-surface-raised'] as const;

function worstContrast(foreground: string): { ratio: number; ground: string } {
  let worst = { ratio: Infinity, ground: '' };
  for (const name of GROUNDS) {
    const ratio = contrast(foreground, token(name));
    if (ratio < worst.ratio) worst = { ratio, ground: name };
  }
  return worst;
}

describe('text is readable on every ground it can be painted on', () => {
  /** WCAG 2.1 AA, normal-size text. */
  const AA_TEXT = 4.5;

  it.each([['--color-ink'], ['--color-ink-muted'], ['--color-accent']])(
    '%s clears AA for body text',
    (name) => {
      const { ratio, ground } = worstContrast(token(name));
      expect(ratio, `${name} measures ${ratio.toFixed(2)} on ${ground}`).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    },
  );

  it('keeps ink-muted above AA rather than merely close to it', () => {
    /**
     * Pinned with a margin. Phase 14's deck put this token at 4.48 and a
     * reviewer reading "about four and a half" would have waved it through, so
     * the margin is the assertion: this token is the one that was once wrong.
     */
    const { ratio } = worstContrast(token('--color-ink-muted'));
    expect(ratio).toBeGreaterThan(4.6);
  });
});

describe('the accent carries its own weight', () => {
  /**
   * Phase 14's accent measured 4.71 and needed `--color-accent-hi` as a
   * brighter emphasis step. Phase 17's is Okabe–Ito yellow at over 12:1, so
   * the step is gone — and so that nobody reintroduces a dim accent that only
   * *looks* bright, the margin is the assertion: comfortably past AAA.
   */
  it('clears AAA for body text on every ground', () => {
    expect(worstContrast(token('--color-accent')).ratio).toBeGreaterThanOrEqual(7);
  });

  it('carries readable text when it is the ground — the yellow key', () => {
    /**
     * The primary control is a filled yellow key with `accent-ink` on it. A
     * pale accent under white text is the commonest way this pattern fails, so
     * the label on the key is measured like any other text.
     */
    expect(contrast(token('--color-accent-ink'), token('--color-accent'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe('a card is readable', () => {
  /**
   * Cards are the one light surface in the app. Rank and pip are drawn in the
   * canvas colour on paper, so they are measured as text.
   */
  it('keeps canvas ink legible on paper', () => {
    expect(contrast(token('--color-canvas'), token('--color-paper'))).toBeGreaterThanOrEqual(7);
  });
});

describe('the one place that cannot use tokens still matches them', () => {
  /**
   * `global-error.tsx` replaces the root layout, so it never gets Tailwind and
   * has to inline its hexes. That makes it the single file where the palette
   * can drift without anything failing — and it did drift in Phase 14, found by
   * grep rather than by test.
   */
  it('keeps global-error.tsx in step with globals.css', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '..', 'src', 'app', 'global-error.tsx'),
      'utf8',
    ).toLowerCase();

    for (const name of ['--color-canvas', '--color-ink', '--color-ink-muted'] as const) {
      const hex = token(name).toLowerCase();
      expect(source, `${name} (${hex}) has drifted out of global-error.tsx`).toContain(hex);
    }
  });
});

describe('the grounds stay ordered', () => {
  it('gets lighter from canvas to raised', () => {
    /**
     * Elevation is encoded as lightness. If a palette edit ever inverts two of
     * these, every raised surface in the app silently reads as a recess.
     */
    const [canvas, surface, raised] = GROUNDS.map((name) => luminance(token(name))) as [
      number,
      number,
      number,
    ];

    expect(canvas).toBeLessThan(surface);
    expect(surface).toBeLessThan(raised);
  });
});
