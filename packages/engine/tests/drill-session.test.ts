import { describe, expect, it } from 'vitest';

import type { DrillTemplate, GradeTier } from '../src/drills';
import type { DrillScenario } from '../src/drills';
import {
  generateSession,
  generateSpot,
  raiseSizeOptions,
  skillTagsFor,
  summariseSession,
} from '../src/drills';
import type { Position, Range, RangeChart } from '../src/ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '../src/ranges';

/**
 * Phase 7 runs a *session*: many spots, drawn across several templates, each
 * one recorded as a `drill_attempts` row.
 *
 * `generateSpots` already produces distinct spots from ONE template, but it
 * keeps its per-spot seeds to itself. `drill_attempts.seed` is `not null` and
 * exists so a historical attempt can be regenerated exactly, so a session has
 * to hand back the seed it used for each spot. That, plus mixing templates, is
 * what this module adds.
 */

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  KK: [{ action: 'raise', size: 2.5, freq: 1 }],
  AKs: [{ action: 'raise', size: 2.5, freq: 1 }],
  AJo: [
    { action: 'raise', size: 2.5, freq: 0.6 },
    { action: 'fold', freq: 0.4 },
  ],
  KQo: [
    { action: 'raise', size: 2.5, freq: 0.5 },
    { action: 'fold', freq: 0.5 },
  ],
  T9s: [
    { action: 'raise', size: 2.5, freq: 0.35 },
    { action: 'fold', freq: 0.65 },
  ],
};

const DEFEND: Range = {
  AA: [{ action: 'raise', size: 11, freq: 1 }],
  KQo: [
    { action: 'call', freq: 0.7 },
    { action: 'fold', freq: 0.3 },
  ],
  T9s: [
    { action: 'call', freq: 0.6 },
    { action: 'fold', freq: 0.4 },
  ],
};

function chart(
  heroPosition: Position,
  actionSequence: string,
  ranges: Range,
  skillTags: readonly string[],
): RangeChart {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition,
    actionSequence,
    skillTags,
    ranges,
  };
}

/** SB opens larger, and defence against it 3-bets smaller. Mirrors the seeded
 *  charts, and it is what gives the size options more than one entry. */
function resized(range: Range, size: number): Range {
  return Object.fromEntries(
    Object.entries(range).map(([hand, entries]) => [
      hand,
      entries.map((entry) =>
        entry.action === 'raise' ? { ...entry, size } : entry,
      ),
    ]),
  ) as Range;
}

const registry = createChartRegistry({
  version: 'test-7',
  published: true,
  charts: [
    chart('UTG', 'rfi', OPEN, ['preflop.rfi.utg']),
    chart('CO', 'rfi', OPEN, ['preflop.rfi.co']),
    chart('BTN', 'rfi', OPEN, ['preflop.rfi.btn']),
    chart('SB', 'rfi', resized(OPEN, 3), ['preflop.rfi.sb']),
    chart('BB', 'vs_utg_open', DEFEND, ['preflop.blind_defense.bb_vs_utg']),
    chart('BB', 'vs_btn_open', DEFEND, ['preflop.blind_defense.bb_vs_btn']),
    chart('BB', 'vs_sb_open', resized(DEFEND, 10), ['preflop.blind_defense.bb_vs_sb']),
  ],
});

/** A minimal scenario, for the lookups that only read the chart key. */
function scenarioAt(heroPosition: Position, actionSequence: string): DrillScenario {
  return {
    templateSlug: 'test',
    heroPosition,
    actionSequence,
    hand: 'AA',
    hole: ['As', 'Ah'],
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
  };
}

const RFI: DrillTemplate = {
  slug: 'rfi',
  title: 'Opening',
  spot: 'rfi',
  positions: ['UTG', 'CO', 'BTN'],
  skillTags: ['preflop.rfi.utg', 'preflop.rfi.co', 'preflop.rfi.btn'],
  published: true,
};

const DEFENCE: DrillTemplate = {
  slug: 'bb-defence',
  title: 'Defending the big blind',
  spot: 'vs_open',
  positions: ['BB'],
  openers: ['UTG', 'BTN'],
  openSize: 2.5,
  skillTags: ['preflop.blind_defense.bb_vs_utg', 'preflop.blind_defense.bb_vs_btn'],
  published: true,
};

const TEMPLATES = [RFI, DEFENCE];

function spotKey(entry: { spot: { scenario: { heroPosition: string; actionSequence: string; hand: string } } }): string {
  const { heroPosition, actionSequence, hand } = entry.spot.scenario;
  return `${heroPosition}|${actionSequence}|${hand}`;
}

describe('generateSession', () => {
  it('is fully reproducible from its seed', () => {
    const a = generateSession({ templates: TEMPLATES, seed: 4242, count: 12, registry });
    const b = generateSession({ templates: TEMPLATES, seed: 4242, count: 12, registry });

    expect(a).toEqual(b);
  });

  it('produces a different session for a different seed', () => {
    const a = generateSession({ templates: TEMPLATES, seed: 1, count: 12, registry });
    const b = generateSession({ templates: TEMPLATES, seed: 2, count: 12, registry });

    expect(a.map(spotKey)).not.toEqual(b.map(spotKey));
  });

  it('never repeats a spot within a session', () => {
    const session = generateSession({ templates: TEMPLATES, seed: 99, count: 16, registry });

    expect(new Set(session.map(spotKey)).size).toBe(session.length);
  });

  it('draws from every template it is given', () => {
    const session = generateSession({ templates: TEMPLATES, seed: 7, count: 20, registry });
    const slugs = new Set(session.map((entry) => entry.template.slug));

    expect(slugs).toEqual(new Set(['rfi', 'bb-defence']));
  });

  /**
   * The contract that makes `drill_attempts.seed` worth storing. Without it the
   * column records a number that regenerates nothing.
   */
  it('returns a seed that regenerates that exact spot', () => {
    const session = generateSession({ templates: TEMPLATES, seed: 31337, count: 8, registry });

    for (const entry of session) {
      const again = generateSpot({ template: entry.template, seed: entry.seed, registry });
      expect(again.scenario).toEqual(entry.spot.scenario);
    }
  });

  it('pairs each spot with the template that actually produced it', () => {
    const session = generateSession({ templates: TEMPLATES, seed: 555, count: 20, registry });

    for (const entry of session) {
      expect(entry.template.positions).toContain(entry.spot.scenario.heroPosition);
    }
  });

  it('skips unpublished templates', () => {
    const draft: DrillTemplate = { ...DEFENCE, slug: 'draft', published: false };
    const session = generateSession({
      templates: [RFI, draft],
      seed: 12,
      count: 10,
      registry,
    });

    expect(session.every((entry) => entry.template.slug === 'rfi')).toBe(true);
  });

  it('refuses a session with nothing published to draw from', () => {
    expect(() =>
      generateSession({
        templates: [{ ...RFI, published: false }],
        seed: 1,
        count: 5,
        registry,
      }),
    ).toThrow(/at least one published/i);
  });

  it('refuses a non-positive count', () => {
    expect(() => generateSession({ templates: TEMPLATES, seed: 1, count: 0, registry })).toThrow(
      /positive integer/,
    );
  });

  it('reports which templates fell short rather than silently returning fewer', () => {
    expect(() =>
      generateSession({ templates: [DEFENCE], seed: 1, count: 500, registry }),
    ).toThrow(/distinct spots/);
  });
});

describe('skillTagsFor', () => {
  it('returns the tag for the spot, not the template', () => {
    const session = generateSession({ templates: [RFI], seed: 8, count: 6, registry });

    for (const entry of session) {
      const tags = skillTagsFor(entry.spot.scenario, registry);
      // One tag, matching hero's own position — never the template's full list.
      expect(tags).toEqual([`preflop.rfi.${entry.spot.scenario.heroPosition.toLowerCase()}`]);
    }
  });

  it('resolves defence tags by the opener', () => {
    const session = generateSession({ templates: [DEFENCE], seed: 21, count: 6, registry });

    for (const entry of session) {
      const opener = /^vs_([a-z]+)_open$/.exec(entry.spot.scenario.actionSequence)![1]!;
      expect(skillTagsFor(entry.spot.scenario, registry)).toEqual([
        `preflop.blind_defense.bb_vs_${opener}`,
      ]);
    }
  });

  it('throws rather than returning nothing when no chart covers the spot', () => {
    const orphan = {
      templateSlug: 'rfi',
      heroPosition: 'HJ' as Position,
      actionSequence: 'rfi',
      hand: 'AA' as const,
      hole: ['As', 'Ah'] as const,
      tableSize: TABLE_SIZE_6MAX,
      stackDepth: STACK_DEPTH_100BB,
    };

    expect(() => skillTagsFor(orphan, registry)).toThrow(/no chart/i);
  });
});

describe('raiseSizeOptions', () => {
  /**
   * The anti-leak property. Each chart raises to exactly one size, so options
   * built from hero's own chart would be the answer key.
   */
  it('offers the same sizes whichever seat hero is in', () => {
    const utg = raiseSizeOptions(scenarioAt('UTG', 'rfi'), registry);
    const btn = raiseSizeOptions(scenarioAt('BTN', 'rfi'), registry);

    expect(utg).toEqual(btn);
    expect(utg.length).toBeGreaterThan(1);
  });

  it('always includes the size hero’s own chart actually uses', () => {
    for (const [position, sequence, size] of [
      ['UTG', 'rfi', 2.5],
      ['BB', 'vs_utg_open', 11],
    ] as const) {
      expect(raiseSizeOptions(scenarioAt(position, sequence), registry)).toContain(size);
    }
  });

  it('keeps opening and defence sizes apart', () => {
    const opens = raiseSizeOptions(scenarioAt('UTG', 'rfi'), registry);
    const defends = raiseSizeOptions(scenarioAt('BB', 'vs_utg_open'), registry);

    expect(opens.some((size) => defends.includes(size))).toBe(false);
  });

  it('pools every chart in the defence family, not just the one faced', () => {
    // vs_utg_open and vs_btn_open are different charts but the same decision.
    expect(raiseSizeOptions(scenarioAt('BB', 'vs_utg_open'), registry)).toEqual(
      raiseSizeOptions(scenarioAt('BB', 'vs_btn_open'), registry),
    );
  });

  it('sorts ascending, so the number keys are in a stable order', () => {
    const sizes = raiseSizeOptions(scenarioAt('UTG', 'rfi'), registry);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });
});

describe('summariseSession', () => {
  const results = [
    { tier: 'optimal' as GradeTier, evLoss: 0 },
    { tier: 'optimal' as GradeTier, evLoss: 0.25 },
    { tier: 'acceptable' as GradeTier, evLoss: 0.5 },
    { tier: 'blunder' as GradeTier, evLoss: 2.25 },
  ];

  it('counts every tier, including the ones that did not occur', () => {
    expect(summariseSession(results).byTier).toEqual({
      optimal: 2,
      acceptable: 1,
      inaccurate: 0,
      blunder: 1,
    });
  });

  it('scores by EV loss', () => {
    const summary = summariseSession(results);

    expect(summary.spots).toBe(4);
    expect(summary.totalEvLoss).toBe(3);
    expect(summary.avgEvLoss).toBe(0.75);
  });

  /**
   * docs/03-poker-engine.md: "Score by EV loss, not accuracy percentage." A
   * single percentage over four tiers is the binary framing the tiers exist to
   * avoid — two of them are defensible answers, not partial credit.
   */
  it('exposes no single accuracy score', () => {
    const summary = summariseSession(results);

    expect(Object.keys(summary).sort()).toEqual(['avgEvLoss', 'byTier', 'spots', 'totalEvLoss']);
  });

  it('summarises an abandoned session without dividing by zero', () => {
    const summary = summariseSession([]);

    expect(summary.spots).toBe(0);
    expect(summary.avgEvLoss).toBe(0);
    expect(summary.byTier.optimal).toBe(0);
  });

  it('rounds money the way the numeric(8,4) column stores it', () => {
    const summary = summariseSession([
      { tier: 'inaccurate', evLoss: 0.1 },
      { tier: 'inaccurate', evLoss: 0.2 },
    ]);

    expect(summary.totalEvLoss).toBe(0.3);
  });
});
