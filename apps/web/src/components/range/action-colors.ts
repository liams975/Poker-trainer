import type { Action } from '@poker/engine';

/**
 * Action → colour, glyph and label.
 *
 * The hex values must stay identical to the `--color-action-*` tokens in
 * globals.css. They are duplicated here rather than read from CSS because the
 * colourblind-safety test needs them in JS, and a test that reads the value it
 * is checking from the same place the app does would be checking nothing. If
 * these drift from the stylesheet, `action-colors.test.ts` fails.
 *
 * Palette is Okabe–Ito, chosen because it stays distinguishable under all
 * common forms of colour vision deficiency. With a male-skewed poker audience —
 * roughly 1 in 12 with some CVD — that is a functional requirement.
 *
 * CLAUDE.md: "Never use color alone to encode strategy actions." Hence the
 * glyph and label here, and the fixed `ACTION_ORDER` below: a segment's
 * position in the bar encodes its action independently of hue.
 */
export interface ActionStyle {
  /** Must match --color-action-* in globals.css. */
  hex: string;
  /** Rendered in the legend and the hand detail, never colour alone. */
  glyph: string;
  label: string;
}

export const ACTION_STYLES: Readonly<Record<Action, ActionStyle>> = {
  fold: { hex: '#55606b', glyph: '×', label: 'Fold' },
  check: { hex: '#009e73', glyph: '✓', label: 'Check' },
  call: { hex: '#0072b2', glyph: '=', label: 'Call' },
  bet: { hex: '#d55e00', glyph: '▲', label: 'Bet' },
  raise: { hex: '#d55e00', glyph: '▲', label: 'Raise' },
  allin: { hex: '#cc79a7', glyph: '★', label: 'All-in' },
};

/**
 * Segment order within every cell, fixed across the whole grid.
 *
 * This is the non-colour redundancy that works at a 44px cell where a glyph
 * would not: passive actions on the left, aggressive on the right, always. A
 * user who cannot separate the hues still reads "this hand is mostly the
 * right-hand thing" consistently across all 169 cells and every chart.
 */
export const ACTION_ORDER: readonly Action[] = [
  'fold',
  'check',
  'call',
  'bet',
  'raise',
  'allin',
];

export function actionStyle(action: Action): ActionStyle {
  return ACTION_STYLES[action];
}

/** e.g. "Raise 2.5bb". Sizes belong in the label, not implied by shade. */
export function actionLabel(action: Action, size?: number): string {
  const { label } = ACTION_STYLES[action];
  return size === undefined ? label : `${label} ${size}bb`;
}
