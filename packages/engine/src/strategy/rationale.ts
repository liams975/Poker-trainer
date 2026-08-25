/**
 * Why a recommendation is what it is — as structured data.
 *
 * docs/03-poker-engine.md: "`Rationale` must be structured data, not a string.
 * Structured rationale lets the UI render it as chips, highlights, or verbose
 * prose depending on Study vs Drill mode — without engine changes. Prose
 * strings lock you into one presentation and can't be styled or filtered."
 *
 * `factor()` enforces that at runtime rather than trusting the convention: a
 * detail value must be a short token or a finite number. Prose does not fit,
 * and a sentence is rejected outright. The engine states facts; the UI writes
 * the sentences.
 */

export const FACTOR_KINDS = [
  'position',
  'hand_class',
  'action_sequence',
  'range_shape',
  'mix',
  'pot_odds',
  'board_texture',
  'spr',
] as const;

export type FactorKind = (typeof FACTOR_KINDS)[number];

export const FACTOR_WEIGHTS = ['high', 'medium', 'low'] as const;

export type FactorWeight = (typeof FACTOR_WEIGHTS)[number];

export type FactorDetail = Readonly<Record<string, string | number>>;

export interface RationaleFactor {
  kind: FactorKind;
  weight: FactorWeight;
  detail: FactorDetail;
}

export interface Rationale {
  factors: readonly RationaleFactor[];
}

/**
 * A token, not a phrase. The cap is the real guard — a sentence does not fit in
 * 32 characters, and the punctuation check catches the short ones that do.
 */
const MAX_DETAIL_LENGTH = 32;
const MAX_DETAIL_WORDS = 3;

export function isFactorKind(value: unknown): value is FactorKind {
  return typeof value === 'string' && (FACTOR_KINDS as readonly string[]).includes(value);
}

export function isFactorWeight(value: unknown): value is FactorWeight {
  return typeof value === 'string' && (FACTOR_WEIGHTS as readonly string[]).includes(value);
}

function checkDetailValue(key: string, value: string | number): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`rationale detail "${key}" must be a finite number, got ${value}`);
    }
    return;
  }

  if (value.trim().length === 0) {
    throw new RangeError(`rationale detail "${key}" is empty`);
  }
  if (value.length > MAX_DETAIL_LENGTH) {
    throw new RangeError(
      `rationale detail "${key}" is ${value.length} characters — details are facts, not prose`,
    );
  }
  // Checked by code point rather than by regex: a control-character class trips
  // `no-control-regex`, and the engine config sets `noInlineConfig` so the rule
  // cannot be waived inline — deliberately, since that gate has no opt-out.
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) {
      throw new RangeError(`rationale detail "${key}" contains control characters`);
    }
  }
  if (/[.!?](\s|$)/.test(value)) {
    throw new RangeError(`rationale detail "${key}" reads as prose; state the fact instead`);
  }
  // The length cap alone let short sentences through — "open tight from under
  // the gun" is 29 characters. A fact is a token or a short label, not a clause.
  if (value.trim().split(/\s+/).length > MAX_DETAIL_WORDS) {
    throw new RangeError(
      `rationale detail "${key}" reads as prose; state the fact instead`,
    );
  }
}

export function factor(
  kind: FactorKind,
  weight: FactorWeight,
  detail: FactorDetail,
): RationaleFactor {
  if (!isFactorKind(kind)) {
    throw new RangeError(`unknown rationale factor kind ${JSON.stringify(kind)}`);
  }
  if (!isFactorWeight(weight)) {
    throw new RangeError(`unknown rationale weight ${JSON.stringify(weight)}`);
  }

  const entries = Object.entries(detail);
  if (entries.length === 0) {
    throw new RangeError(`a ${kind} factor with no detail explains nothing`);
  }
  for (const [key, value] of entries) checkDetailValue(key, value);

  return Object.freeze({ kind, weight, detail: Object.freeze({ ...detail }) });
}

export function rationale(factors: readonly RationaleFactor[]): Rationale {
  if (factors.length === 0) {
    throw new RangeError('a rationale with no factors explains nothing');
  }

  return Object.freeze({ factors: Object.freeze([...factors]) });
}
