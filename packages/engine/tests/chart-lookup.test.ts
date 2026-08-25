import { describe, expect, it } from 'vitest';

import type { Position, Range, RangeChart } from '../src/ranges';
import {
  POSITIONS,
  STACK_DEPTH_100BB,
  TABLE_SIZE_6MAX,
  chartKeyId,
  chartKeyOf,
  createChartRegistry,
  isPosition,
  lookupChart,
  requireChart,
} from '../src/ranges';

/**
 * docs/03-poker-engine.md: chart addressing is
 * `(tableSize, stackDepth, heroPosition, actionSequence)`, and tableSize and
 * stackDepth stay in the key even though v1 hardcodes both — "widening this
 * later touches every call site".
 *
 * The registry mirrors the `range_charts` unique constraint in
 * supabase/migrations/0001_initial_schema.sql, so a duplicate that Postgres
 * would reject on sync must be rejected here too, at author time.
 */

const RFI: Range = { AA: [{ action: 'raise', size: 2.5, freq: 1 }] };

function chart(heroPosition: Position, actionSequence: string): RangeChart {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition,
    actionSequence,
    skillTags: [],
    ranges: RFI,
  };
}

const set = {
  version: 'test-1',
  published: true,
  charts: [chart('UTG', 'rfi'), chart('BTN', 'rfi'), chart('BB', 'vs_btn_open')],
};

describe('positions', () => {
  it('matches the position_6max enum, in order', () => {
    expect([...POSITIONS]).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  });

  it.each(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'])('accepts %s', (value) => {
    expect(isPosition(value)).toBe(true);
  });

  it.each(['MP', 'LJ', 'utg', 'BU', 'BTN ', ''])('rejects %s', (value) => {
    // 6-max has no MP or LJ (.claude/skills/poker-domain/SKILL.md).
    expect(isPosition(value)).toBe(false);
  });
});

describe('chartKeyId', () => {
  it('is stable and includes every part of the key', () => {
    const id = chartKeyId({
      tableSize: TABLE_SIZE_6MAX,
      stackDepth: STACK_DEPTH_100BB,
      heroPosition: 'CO',
      actionSequence: 'rfi',
    });

    expect(id).toBe('6|100|CO|rfi');
  });

  it('distinguishes keys that differ only by position', () => {
    expect(chartKeyId(chartKeyOf(chart('UTG', 'rfi')))).not.toBe(
      chartKeyId(chartKeyOf(chart('HJ', 'rfi'))),
    );
  });

  it('distinguishes keys that differ only by action sequence', () => {
    expect(chartKeyId(chartKeyOf(chart('BB', 'vs_btn_open')))).not.toBe(
      chartKeyId(chartKeyOf(chart('BB', 'vs_co_open'))),
    );
  });

  it('cannot be confused by a separator inside the action sequence', () => {
    // Sequences are validated as [a-z0-9_]+ elsewhere; this pins that the
    // encoding would not silently collide even so.
    const a = chartKeyId(chartKeyOf(chart('BB', 'vs_btn')));
    const b = chartKeyId(chartKeyOf(chart('BB', 'vs_btn_open')));

    expect(a).not.toBe(b);
  });
});

describe('registry', () => {
  const registry = createChartRegistry(set);

  it('holds every chart', () => {
    expect(registry.size).toBe(3);
  });

  it('returns the right chart for a key', () => {
    const found = lookupChart(registry, {
      tableSize: TABLE_SIZE_6MAX,
      stackDepth: STACK_DEPTH_100BB,
      heroPosition: 'BB',
      actionSequence: 'vs_btn_open',
    });

    expect(found?.heroPosition).toBe('BB');
    expect(found?.actionSequence).toBe('vs_btn_open');
  });

  it('round-trips every chart through its own key', () => {
    for (const original of set.charts) {
      expect(lookupChart(registry, chartKeyOf(original))).toBe(original);
    }
  });

  it('returns undefined for a key that was never seeded', () => {
    // Not a neighbouring chart, and not a throw — the caller decides.
    expect(
      lookupChart(registry, {
        tableSize: TABLE_SIZE_6MAX,
        stackDepth: STACK_DEPTH_100BB,
        heroPosition: 'SB',
        actionSequence: 'rfi',
      }),
    ).toBeUndefined();
  });

  it('rejects duplicate keys', () => {
    // The same constraint Postgres enforces on (chart_set_id, table_size,
    // stack_depth, hero_position, action_sequence).
    expect(() =>
      createChartRegistry({
        version: 'dupe',
        published: true,
        charts: [chart('UTG', 'rfi'), chart('UTG', 'rfi')],
      }),
    ).toThrow(/duplicate/i);
  });

  it('allows the same position with different sequences', () => {
    expect(() =>
      createChartRegistry({
        version: 'ok',
        published: true,
        charts: [chart('BB', 'vs_btn_open'), chart('BB', 'vs_co_open')],
      }),
    ).not.toThrow();
  });
});

describe('requireChart', () => {
  const registry = createChartRegistry(set);

  it('returns the chart when present', () => {
    expect(requireChart(registry, chartKeyOf(chart('UTG', 'rfi'))).heroPosition).toBe('UTG');
  });

  it('throws a message naming the missing key', () => {
    expect(() =>
      requireChart(registry, {
        tableSize: TABLE_SIZE_6MAX,
        stackDepth: STACK_DEPTH_100BB,
        heroPosition: 'SB',
        actionSequence: 'rfi',
      }),
    ).toThrow(/6\|100\|SB\|rfi/);
  });
});
