import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Action } from '@poker/engine';
import { ACTIONS } from '@poker/engine';
import { describe, expect, it } from 'vitest';

import { ACTION_ORDER, ACTION_STYLES, actionLabel } from '../src/components/range/action-colors';

/**
 * docs/02-roadmap.md makes "verified against a colorblind simulator" a Phase 6
 * exit criterion. Eyeballing a simulator once verifies today's palette and
 * nothing else — the failure this needs to catch is a *future* colour, added in
 * Phase 7 or later, that collides under deuteranopia and ships because nobody
 * re-ran the check.
 *
 * So the simulation runs here. Okabe–Ito is designed to survive it, so this
 * should be green on day one; its job is to stay green only while that is true.
 */

type RGB = readonly [number, number, number];

function hexToRgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** sRGB -> linear. Gamma matters: averaging gamma-encoded channels is wrong. */
function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function toLinear(rgb: RGB): RGB {
  return [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
}

/**
 * Brettel/Viénot-style dichromat simulation matrices, applied in linear RGB.
 *
 * These are the standard approximations used by simulators such as Coblis. They
 * model the three dichromacies: protanopia (no L cones, ~1% of men),
 * deuteranopia (no M cones, ~1%), tritanopia (no S cones, rare).
 */
const CVD_MATRICES: Readonly<Record<string, readonly RGB[]>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
};

function simulate(rgb: RGB, matrix: readonly RGB[]): RGB {
  const lin = toLinear(rgb);
  return matrix.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]) as unknown as RGB;
}

/** CIE luminance of a linear-RGB colour. */
function luminance(lin: RGB): number {
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * Distance in linear RGB, scaled to roughly 0-100.
 *
 * Not a true CIEDE2000 — that would need a full Lab conversion for marginal
 * benefit here. What this has to detect is two colours collapsing onto each
 * other under simulation, and a plain Euclidean distance in linear space does
 * that unambiguously.
 */
function distance(a: RGB, b: RGB): number {
  return (
    Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) * 100
  );
}

/** The colours that carry strategy meaning, deduplicated. bet and raise share a hue. */
const STRATEGY_HEXES = [...new Set(ACTIONS.map((a) => ACTION_STYLES[a].hex))];

describe('the action palette survives colour vision deficiency', () => {
  it.each(Object.keys(CVD_MATRICES))('stays distinguishable under %s', (kind) => {
    const matrix = CVD_MATRICES[kind]!;
    const simulated = STRATEGY_HEXES.map((hex) => simulate(hexToRgb(hex), matrix));

    for (let i = 0; i < simulated.length; i += 1) {
      for (let j = i + 1; j < simulated.length; j += 1) {
        const d = distance(simulated[i]!, simulated[j]!);

        expect(
          d,
          `${STRATEGY_HEXES[i]} and ${STRATEGY_HEXES[j]} collapse under ${kind} (distance ${d.toFixed(1)})`,
        ).toBeGreaterThan(8);
      }
    }
  });

  it('stays distinguishable to normal colour vision too', () => {
    const normal = STRATEGY_HEXES.map((hex) => toLinear(hexToRgb(hex)));

    for (let i = 0; i < normal.length; i += 1) {
      for (let j = i + 1; j < normal.length; j += 1) {
        expect(distance(normal[i]!, normal[j]!)).toBeGreaterThan(8);
      }
    }
  });

  it('keeps every action legible against the surface it is drawn on', () => {
    // Cells sit on --color-surface. A segment the same luminance as its
    // background is invisible regardless of hue.
    const surface = luminance(toLinear(hexToRgb('#141a21')));

    for (const hex of STRATEGY_HEXES) {
      const contrast =
        (Math.max(luminance(toLinear(hexToRgb(hex))), surface) + 0.05) /
        (Math.min(luminance(toLinear(hexToRgb(hex))), surface) + 0.05);

      expect(contrast, `${hex} is invisible against the card surface`).toBeGreaterThan(1.4);
    }
  });
});

describe('colour is never the only encoding', () => {
  it('gives every action a glyph and a label', () => {
    for (const action of ACTIONS) {
      const style = ACTION_STYLES[action];
      expect(style.glyph.length).toBeGreaterThan(0);
      expect(style.label.length).toBeGreaterThan(0);
    }
  });

  it('orders segments identically for every cell, so position encodes action', () => {
    // The redundancy that works at a 44px cell where a glyph does not.
    expect([...ACTION_ORDER].sort()).toEqual([...ACTIONS].sort());
  });

  it('puts the size in the label rather than implying it with a shade', () => {
    expect(actionLabel('raise', 2.5)).toBe('Raise 2.5bb');
    expect(actionLabel('fold')).toBe('Fold');
  });
});

describe('the palette matches the stylesheet', () => {
  /**
   * These hexes are duplicated from globals.css so the simulation above can run
   * in Node. Duplication is only safe while it is checked — otherwise the test
   * verifies a palette the app does not actually use.
   */
  it('every action hex appears in globals.css', () => {
    const css = readFileSync(
      resolve(import.meta.dirname, '..', 'src', 'app', 'globals.css'),
      'utf8',
    ).toLowerCase();

    for (const action of ACTIONS as readonly Action[]) {
      const { hex } = ACTION_STYLES[action];
      expect(css, `${hex} (${action}) is not defined in globals.css`).toContain(hex);
    }
  });
});
