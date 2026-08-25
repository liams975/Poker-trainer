import { describe, expect, it } from 'vitest';

import { parseDrillTemplates, validateDrillTemplates } from '../src/drills';
import type { Position, Range, RangeChart } from '../src/ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '../src/ranges';

/**
 * Templates are content, not code — `drill_templates` is a content table with a
 * `config jsonb` column, so they are authored as JSON in packages/content and
 * validated here. Same error-collecting shape as the chart validator: every
 * problem at once with a path, rather than throwing on the first.
 */

function valid(overrides: Record<string, unknown> = {}) {
  return [
    {
      slug: 'preflop-rfi-utg',
      title: 'Opening from under the gun',
      spot: 'rfi',
      positions: ['UTG'],
      sampling: { uniformShare: 0.3 },
      skillTags: ['preflop.rfi.utg'],
      published: true,
      ...overrides,
    },
  ];
}

function validDefence(overrides: Record<string, unknown> = {}) {
  return [
    {
      slug: 'bb-defence',
      title: 'Defending the big blind',
      spot: 'vs_open',
      positions: ['BB'],
      openers: ['UTG', 'BTN'],
      openSize: 2.5,
      skillTags: ['preflop.blind_defense.bb_vs_utg'],
      published: true,
      ...overrides,
    },
  ];
}

function errorsFor(data: unknown): string[] {
  const result = validateDrillTemplates(data);
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
}

describe('valid templates', () => {
  it('accepts an opening template', () => {
    expect(validateDrillTemplates(valid()).ok).toBe(true);
  });

  it('accepts a defence template', () => {
    expect(validateDrillTemplates(validDefence()).ok).toBe(true);
  });

  it('accepts a template with no sampling block', () => {
    const [first] = valid();
    delete (first as Record<string, unknown>).sampling;

    expect(validateDrillTemplates([first]).ok).toBe(true);
  });

  it('accepts an explicit hand list', () => {
    expect(validateDrillTemplates(valid({ sampling: { include: ['AA', 'AJo'] } })).ok).toBe(true);
  });

  it('returns the parsed value, typed', () => {
    const result = validateDrillTemplates(valid());

    if (!result.ok) throw new Error(result.errors.map((e) => e.path).join());
    expect(result.value[0]?.slug).toBe('preflop-rfi-utg');
  });
});

describe('structure', () => {
  it.each([null, undefined, 42, {}, 'templates'])('rejects a root of %s', (data) => {
    expect(validateDrillTemplates(data).ok).toBe(false);
  });

  it('rejects an empty list', () => {
    expect(errorsFor([]).join()).toMatch(/at least one/i);
  });

  it.each([
    ['slug', 'Preflop RFI'],
    ['slug', 'preflop_rfi'],
    ['title', ''],
    ['spot', 'postflop'],
    ['published', 'yes'],
  ])('rejects a bad %s', (field, value) => {
    expect(errorsFor(valid({ [field]: value })).join()).toMatch(new RegExp(field));
  });

  it('rejects duplicate slugs', () => {
    // `drill_templates.slug` is unique in Postgres; catch it at author time.
    const [first] = valid();
    expect(errorsFor([first, { ...first }]).join()).toMatch(/duplicate/i);
  });

  it('rejects a skill tag that is not a dotted slug', () => {
    expect(errorsFor(valid({ skillTags: ['Preflop RFI'] })).join()).toMatch(/skillTags/);
  });
});

describe('positions', () => {
  it('rejects an empty position list', () => {
    expect(errorsFor(valid({ positions: [] })).join()).toMatch(/positions/);
  });

  it('rejects an unknown position', () => {
    expect(errorsFor(valid({ positions: ['MP'] })).join()).toMatch(/positions/);
  });

  it('rejects duplicates', () => {
    expect(errorsFor(valid({ positions: ['UTG', 'UTG'] })).join()).toMatch(/positions/);
  });

  it('rejects the big blind as an opening position', () => {
    // The big blind is never first in — there is nobody left to fold behind it.
    expect(errorsFor(valid({ positions: ['BB'] })).join()).toMatch(/big blind/i);
  });

  it('requires the big blind for a defence template', () => {
    // Phase 2 seeded blind defence only; a CO-versus-open chart does not exist.
    expect(errorsFor(validDefence({ positions: ['CO'] })).join()).toMatch(/big blind/i);
  });
});

describe('openers and open size', () => {
  it('requires openers on a defence template', () => {
    const [first] = validDefence();
    delete (first as Record<string, unknown>).openers;

    expect(errorsFor([first]).join()).toMatch(/openers/);
  });

  it('forbids openers on an opening template', () => {
    expect(errorsFor(valid({ openers: ['UTG'] })).join()).toMatch(/openers/);
  });

  it('rejects the big blind as an opener', () => {
    expect(errorsFor(validDefence({ openers: ['BB'] })).join()).toMatch(/openers/);
  });

  it('rejects an empty opener list', () => {
    expect(errorsFor(validDefence({ openers: [] })).join()).toMatch(/openers/);
  });

  it('requires an open size on a defence template', () => {
    const [first] = validDefence();
    delete (first as Record<string, unknown>).openSize;

    expect(errorsFor([first]).join()).toMatch(/openSize/);
  });

  it('forbids an open size on an opening template', () => {
    expect(errorsFor(valid({ openSize: 2.5 })).join()).toMatch(/openSize/);
  });

  it.each([1, 0.5, 4.5, 100])('rejects an open size of %s', (openSize) => {
    // Must sit inside the band the seeded charts model, or the generated spot
    // would be one ChartStrategy then refuses to answer.
    expect(errorsFor(validDefence({ openSize })).join()).toMatch(/openSize/);
  });

  it.each([1.5, 2.5, 3, 4])('accepts an open size of %s', (openSize) => {
    expect(validateDrillTemplates(validDefence({ openSize })).ok).toBe(true);
  });
});

describe('sampling block', () => {
  it.each([-0.1, 1.1, 'half'])('rejects a uniformShare of %s', (uniformShare) => {
    expect(errorsFor(valid({ sampling: { uniformShare } })).join()).toMatch(/uniformShare/);
  });

  it('rejects a hand outside the 169', () => {
    expect(errorsFor(valid({ sampling: { include: ['AJ0'] } })).join()).toMatch(/include/);
  });

  it('rejects an empty include list', () => {
    expect(errorsFor(valid({ sampling: { include: [] } })).join()).toMatch(/include/);
  });
});

describe('error reporting', () => {
  it('collects every problem rather than stopping at the first', () => {
    const errors = errorsFor(valid({ slug: 'Bad Slug', positions: [], skillTags: ['Nope'] }));

    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('paths point at the offending template', () => {
    expect(errorsFor(valid({ slug: 'Bad Slug' }))[0]).toMatch(/^\[0\]\.slug:/);
  });
});

describe('parseDrillTemplates', () => {
  it('returns the templates when valid', () => {
    expect(parseDrillTemplates(valid())).toHaveLength(1);
  });

  it('throws once, listing every error', () => {
    expect(() => parseDrillTemplates(valid({ slug: 'Bad', positions: [] }))).toThrow(
      /slug[\s\S]*positions|positions[\s\S]*slug/,
    );
  });
});

describe('checked against the charts', () => {
  // The structural band (1, MAX_OPEN_BLINDS] only guarantees the spot resolves.
  // Whether it resolves against the *right* chart is a question only the
  // registry can answer, and it is the exact mistake that forced blind defence
  // to be split into a 2.5bb and a 3bb template.
  const OPEN_25: Range = {
    AA: [{ action: 'raise', size: 2.5, freq: 1 }],
    AJo: [
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'fold', freq: 0.4 },
    ],
  };
  const OPEN_3: Range = { AA: [{ action: 'raise', size: 3, freq: 1 }] };

  function chart(heroPosition: Position, ranges: Range): RangeChart {
    return {
      tableSize: TABLE_SIZE_6MAX,
      stackDepth: STACK_DEPTH_100BB,
      heroPosition,
      actionSequence: 'rfi',
      skillTags: [],
      ranges,
    };
  }

  const registry = createChartRegistry({
    version: 'test',
    published: true,
    charts: [chart('UTG', OPEN_25), chart('BTN', OPEN_25), chart('SB', OPEN_3)],
  });

  function registryErrors(data: unknown): string[] {
    const result = validateDrillTemplates(data, registry);
    return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
  }

  it('accepts a template that matches its openers', () => {
    expect(registryErrors(validDefence({ openers: ['UTG', 'BTN'], openSize: 2.5 }))).toEqual([]);
    expect(registryErrors(validDefence({ openers: ['SB'], openSize: 3 }))).toEqual([]);
  });

  it('rejects the small blind at the size everyone else opens', () => {
    expect(registryErrors(validDefence({ openers: ['SB'], openSize: 2.5 })).join()).toMatch(
      /SB opens to 3bb/,
    );
  });

  it('rejects a structurally legal size no chart was authored for', () => {
    // Passes the band, resolves through `deriveActionSequence`, and would grade
    // a 4bb open against a chart written for 2.5bb.
    expect(registryErrors(validDefence({ openers: ['BTN'], openSize: 4 })).join()).toMatch(
      /BTN opens to 2.5bb/,
    );
  });

  it('reports an opener with no seeded chart', () => {
    expect(registryErrors(validDefence({ openers: ['CO'], openSize: 2.5 })).join()).toMatch(
      /no rfi chart is seeded for CO/,
    );
  });

  it('accepts the same template structurally when no registry is given', () => {
    // Without a registry the check is skipped, not silently passed — this is
    // why packages/content always supplies one.
    expect(validateDrillTemplates(validDefence({ openers: ['SB'], openSize: 2.5 })).ok).toBe(true);
  });
});

describe('the include list', () => {
  it('rejects a hand listed twice', () => {
    // Double-counted in the normalisation totals but keyed once, so a duplicate
    // silently under-weights the hand the author asked to see more of.
    expect(errorsFor(valid({ sampling: { include: ['AA', 'AA', 'KK'] } })).join()).toMatch(
      /AA listed twice/,
    );
  });

  it('accepts a list with no duplicates', () => {
    expect(validateDrillTemplates(valid({ sampling: { include: ['AA', 'KK'] } })).ok).toBe(true);
  });
});
