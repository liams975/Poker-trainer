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
 * It exists because Phase 14 changed the ground. The deck specifies muted text
 * as `rgba(233,233,237,.55)`, which composites to #8a8b93 and measures **4.48**
 * against `surface-raised`: under AA by 0.02, on the token carrying 170 of the
 * app's body-text usages. Nothing in the suite would have noticed, because
 * nothing in the suite was looking. Now something is.
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

  it.each([['--color-ink'], ['--color-ink-muted'], ['--color-accent-hi']])(
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
     * Pinned deliberately tight. The deck's literal .55 alpha lands at 4.48 and
     * a reviewer reading "about four and a half" would wave it through, so the
     * margin is the assertion: this token is the one that was actually wrong.
     */
    const { ratio } = worstContrast(token('--color-ink-muted'));
    expect(ratio).toBeGreaterThan(4.6);
  });
});

describe('the accent carries its own weight', () => {
  /**
   * Nocturne's readme says this pair is "tuned to at least 3:1 — enough for
   * icons, large text and interface chrome, not for body copy", and Phase 14
   * initially took that as the measurement. It is not: it is a conservative
   * floor written for the system generally. Measured against these three
   * grounds the accent lands at **4.71**, clearing AA for body text outright.
   *
   * Recorded here because the prose is the more memorable of the two, and the
   * next person to read the readme will reach the same wrong conclusion.
   */
  it('clears AA for body text, not merely 3:1 for chrome', () => {
    expect(worstContrast(token('--color-accent')).ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps accent-hi brighter than the accent', () => {
    /**
     * So --color-accent-hi earns its place as the deck's emphasis step (28 uses
     * across the frames), not as a contrast rescue. The ordering is the whole
     * contract: swap them and every emphasised figure recedes.
     */
    const accent = worstContrast(token('--color-accent')).ratio;
    const accentHi = worstContrast(token('--color-accent-hi')).ratio;

    expect(accentHi).toBeGreaterThan(accent);
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
