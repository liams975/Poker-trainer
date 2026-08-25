import { describe, expect, it } from 'vitest';

import { parseChartSet, validateChartSet } from '../src/ranges';

/**
 * Phase 2 exit criterion, from docs/02-roadmap.md: "Every chart in
 * packages/content validates against the schema and every range's frequencies
 * sum to 1.0 (± float tolerance)."
 *
 * This validator is hand-written rather than a Zod schema because CI asserts
 * `packages/engine` has zero runtime dependencies (docs/01-architecture.md).
 * The compensation for giving up Zod is that this one collects *every* error
 * with a domain-shaped path, instead of throwing on the first structural
 * problem — which is what you actually want when a chart edit breaks three
 * hands at once.
 */

function validSet(overrides: Record<string, unknown> = {}) {
  return {
    version: '2026.08-test',
    published: true,
    charts: [
      {
        tableSize: 6,
        stackDepth: 100,
        heroPosition: 'UTG',
        actionSequence: 'rfi',
        skillTags: ['preflop.rfi.utg'],
        ranges: {
          AA: [{ action: 'raise', size: 2.5, freq: 1 }],
          AJo: [
            { action: 'raise', size: 2.5, freq: 0.6 },
            { action: 'fold', freq: 0.4 },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function errorsFor(data: unknown): string[] {
  const result = validateChartSet(data);
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
}

describe('a valid set', () => {
  it('passes', () => {
    const result = validateChartSet(validSet());

    expect(result.ok).toBe(true);
  });

  it('returns the parsed value, typed', () => {
    const result = validateChartSet(validSet());

    if (!result.ok) throw new Error(result.errors.map((e) => e.path).join(', '));
    expect(result.value.charts[0]?.heroPosition).toBe('UTG');
    expect(result.value.version).toBe('2026.08-test');
  });

  it('accepts an optional notes field', () => {
    expect(validateChartSet(validSet({ notes: 'approximations, not solver output' })).ok).toBe(
      true,
    );
  });

  it('accepts two raise sizes for the same hand', () => {
    // A genuine mix, not a duplicate: raise small 50%, raise large 20%.
    const set = validSet();
    set.charts[0]!.ranges.AA = [
      { action: 'raise', size: 2.5, freq: 0.5 },
      { action: 'raise', size: 6, freq: 0.2 },
      { action: 'fold', freq: 0.3 },
    ] as never;

    expect(validateChartSet(set).ok).toBe(true);
  });
});

describe('structure', () => {
  it.each([null, undefined, 42, 'set', []])('rejects a root of %s', (data) => {
    expect(validateChartSet(data).ok).toBe(false);
  });

  it('rejects a missing or empty version', () => {
    expect(errorsFor(validSet({ version: '' })).join()).toMatch(/version/);
    expect(errorsFor(validSet({ version: undefined })).join()).toMatch(/version/);
  });

  it('rejects a non-boolean published flag', () => {
    expect(errorsFor(validSet({ published: 'yes' })).join()).toMatch(/published/);
  });

  it('rejects an empty chart list', () => {
    expect(errorsFor(validSet({ charts: [] })).join()).toMatch(/charts/);
  });
});

describe('chart key', () => {
  it.each([
    ['tableSize', 9],
    ['stackDepth', 200],
    ['heroPosition', 'MP'],
    ['actionSequence', 'BB vs BTN'],
  ])('rejects a bad %s', (field, value) => {
    const set = validSet();
    (set.charts[0] as Record<string, unknown>)[field] = value;

    expect(errorsFor(set).join()).toMatch(new RegExp(field));
  });

  it('rejects an action sequence that is not a slug', () => {
    for (const bad of ['vs BTN open', 'vs-btn-open', 'VS_BTN_OPEN', '']) {
      const set = validSet();
      set.charts[0]!.actionSequence = bad;
      expect(errorsFor(set).join()).toMatch(/actionSequence/);
    }
  });

  it('rejects two charts with the same key', () => {
    const set = validSet();
    set.charts = [set.charts[0]!, { ...set.charts[0]! }];

    expect(errorsFor(set).join()).toMatch(/duplicate/i);
  });

  it('rejects a skill tag that is not a slug', () => {
    const set = validSet();
    set.charts[0]!.skillTags = ['Preflop RFI UTG'] as never;

    expect(errorsFor(set).join()).toMatch(/skillTags/);
  });
});

describe('ranges', () => {
  function withRanges(ranges: unknown): unknown {
    const set = validSet();
    set.charts[0]!.ranges = ranges as never;
    return set;
  }

  it('rejects a hand outside the 169', () => {
    // The other half of the absent-means-fold convention: a typo cannot be
    // allowed to look like a deliberate omission.
    expect(errorsFor(withRanges({ AJ0: [{ action: 'fold', freq: 1 }] })).join()).toMatch(/AJ0/);
    expect(errorsFor(withRanges({ KAo: [{ action: 'fold', freq: 1 }] })).join()).toMatch(/KAo/);
    expect(errorsFor(withRanges({ AAs: [{ action: 'fold', freq: 1 }] })).join()).toMatch(/AAs/);
  });

  it('rejects frequencies that do not sum to one', () => {
    const messages = errorsFor(
      withRanges({
        AJo: [
          { action: 'raise', size: 2.5, freq: 0.6 },
          { action: 'fold', freq: 0.37 },
        ],
      }),
    ).join();

    expect(messages).toMatch(/AJo/);
    expect(messages).toMatch(/0\.97/);
  });

  it('accepts a sum inside float tolerance', () => {
    const set = withRanges({
      AJo: [
        { action: 'raise', size: 2.5, freq: 0.1 },
        { action: 'call', freq: 0.2 },
        { action: 'fold', freq: 0.7 },
      ],
    });

    expect(validateChartSet(set).ok).toBe(true);
  });

  it('rejects an empty ranges object', () => {
    // Not a chart where everything folds — not a chart. From Phase 4 this
    // validator runs on JSONB from Supabase, where a wiped blob is exactly the
    // failure worth catching.
    expect(errorsFor(withRanges({})).join()).toMatch(/at least one hand/);
  });

  it('rejects a hand listed as a pure fold', () => {
    // Same rule that rejects freq: 0. An all-fold entry says what absence
    // already says, and anything iterating chart.ranges directly can tell them
    // apart — so only one encoding may be legal.
    expect(errorsFor(withRanges({ AA: [{ action: 'fold', freq: 1 }] })).join()).toMatch(
      /omit the hand/,
    );
  });

  it('still reports a bad sum when the only other problem is a duplicate', () => {
    // The duplicate check is not an entry-level malformation, so it must not
    // suppress the sum error — otherwise fixing one surfaces the other on a
    // second round trip, against the collect-everything goal.
    const messages = errorsFor(
      withRanges({
        AA: [
          { action: 'raise', size: 2.5, freq: 0.75 },
          { action: 'raise', size: 2.5, freq: 0.75 },
        ],
      }),
    ).join();

    expect(messages).toMatch(/twice at the same size/);
    expect(messages).toMatch(/sum to 1\.5000/);
  });

  it('names the real value when a number is not JSON-representable', () => {
    // JSON.stringify(Infinity) is "null", which made this error unreadable.
    expect(
      errorsFor(withRanges({ AA: [{ action: 'raise', size: Infinity, freq: 1 }] })).join(),
    ).toMatch(/Infinity/);
  });

  it('rejects an empty distribution', () => {
    expect(errorsFor(withRanges({ AA: [] })).join()).toMatch(/AA/);
  });

  it.each([
    ['limp', 'unknown action'],
    ['Raise', 'wrong case'],
  ])('rejects the action %s (%s)', (action) => {
    expect(errorsFor(withRanges({ AA: [{ action, freq: 1 }] })).join()).toMatch(/action/);
  });

  it.each([0, -0.5, 1.5, Number.NaN])('rejects a frequency of %s', (freq) => {
    // Zero is rejected rather than tolerated: Phase 3 grades freq = 0 as a
    // blunder, so an explicit zero entry and an omitted one must not both be
    // expressible.
    expect(errorsFor(withRanges({ AA: [{ action: 'raise', size: 2.5, freq }] })).join()).toMatch(
      /freq/,
    );
  });

  it('requires a size on bet and raise', () => {
    expect(errorsFor(withRanges({ AA: [{ action: 'raise', freq: 1 }] })).join()).toMatch(/size/);
  });

  it('rejects a size on an action that cannot carry one', () => {
    expect(
      errorsFor(withRanges({ AA: [{ action: 'fold', size: 2.5, freq: 1 }] })).join(),
    ).toMatch(/size/);
  });

  it.each([0, -1])('rejects a size of %s', (size) => {
    expect(errorsFor(withRanges({ AA: [{ action: 'raise', size, freq: 1 }] })).join()).toMatch(
      /size/,
    );
  });

  it('rejects the same action at the same size twice', () => {
    const messages = errorsFor(
      withRanges({
        AA: [
          { action: 'raise', size: 2.5, freq: 0.5 },
          { action: 'raise', size: 2.5, freq: 0.5 },
        ],
      }),
    ).join();

    expect(messages).toMatch(/raise/);
  });
});

describe('error reporting', () => {
  it('collects every problem rather than stopping at the first', () => {
    const set = validSet();
    set.charts[0]!.ranges = {
      AA: [{ action: 'raise', size: 2.5, freq: 0.9 }],
      AJ0: [{ action: 'fold', freq: 1 }],
      KK: [{ action: 'limp', freq: 1 }],
    } as never;

    const errors = errorsFor(set);

    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.join()).toMatch(/AA/);
    expect(errors.join()).toMatch(/AJ0/);
    expect(errors.join()).toMatch(/KK/);
  });

  it('paths point at the offending hand inside the offending chart', () => {
    const set = validSet();
    set.charts[0]!.ranges.AA = [{ action: 'raise', size: 2.5, freq: 0.9 }] as never;

    expect(errorsFor(set)[0]).toMatch(/^charts\[0\]\.ranges\.AA:/);
  });
});

describe('parseChartSet', () => {
  it('returns the set when valid', () => {
    expect(parseChartSet(validSet()).charts).toHaveLength(1);
  });

  it('throws once, listing every error', () => {
    const set = validSet();
    set.charts[0]!.ranges = {
      AA: [{ action: 'raise', size: 2.5, freq: 0.9 }],
      KK: [{ action: 'limp', freq: 1 }],
    } as never;

    expect(() => parseChartSet(set)).toThrow(/AA[\s\S]*KK|KK[\s\S]*AA/);
  });
});
