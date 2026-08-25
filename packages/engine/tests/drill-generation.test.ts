import { describe, expect, it } from 'vitest';

import { CANONICAL_HANDS, handNotationOf, parseCard } from '../src/cards';
import type { DrillTemplate } from '../src/drills';
import { generateSpot, generateSpots, rebuildSpot } from '../src/drills';
import { seatAt } from '../src/game';
import type { Position, Range, RangeChart } from '../src/ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '../src/ranges';
import { createChartStrategy, deriveActionSequence } from '../src/strategy';

/**
 * The roadmap's Phase 3 exit criterion: "Given a seed, drill generation is
 * fully reproducible."
 *
 * Reproducibility is not cosmetic. docs/03-poker-engine.md: it buys replayable
 * drills, shareable spots, and the ability to regenerate a historical attempt
 * exactly from its stored seed — which is why `drill_attempts` stores one.
 */

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  AJo: [
    { action: 'raise', size: 2.5, freq: 0.6 },
    { action: 'fold', freq: 0.4 },
  ],
  KQo: [
    { action: 'raise', size: 2.5, freq: 0.5 },
    { action: 'fold', freq: 0.5 },
  ],
};

const DEFEND: Range = {
  AA: [{ action: 'raise', size: 11, freq: 1 }],
  KQo: [
    { action: 'call', freq: 0.7 },
    { action: 'fold', freq: 0.3 },
  ],
};

function chart(heroPosition: Position, actionSequence: string, ranges: Range): RangeChart {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition,
    actionSequence,
    skillTags: [],
    ranges,
  };
}

const registry = createChartRegistry({
  version: 'test-3b',
  published: true,
  charts: [
    chart('UTG', 'rfi', OPEN),
    chart('CO', 'rfi', OPEN),
    chart('BTN', 'rfi', OPEN),
    chart('BB', 'vs_utg_open', DEFEND),
    chart('BB', 'vs_btn_open', DEFEND),
  ],
});

const strategy = createChartStrategy({ registry, chartVersion: 'test-3b' });

const RFI: DrillTemplate = {
  slug: 'rfi',
  title: 'Opening',
  spot: 'rfi',
  positions: ['UTG', 'CO', 'BTN'],
  skillTags: [],
  published: true,
};

const DEFENCE: DrillTemplate = {
  slug: 'defence',
  title: 'Defending',
  spot: 'vs_open',
  positions: ['BB'],
  openers: ['UTG', 'BTN'],
  openSize: 2.5,
  skillTags: [],
  published: true,
};

describe('generateSpot', () => {
  it('puts hero on the button of its own decision', () => {
    const spot = generateSpot({ template: RFI, seed: 1, registry });

    expect(spot.state.toAct).toBe(spot.hero);
    expect(spot.scenario.heroPosition).toBe(spot.hero);
  });

  it('only draws positions the template allows', () => {
    for (let seed = 0; seed < 60; seed++) {
      expect(RFI.positions).toContain(generateSpot({ template: RFI, seed, registry }).hero);
    }
  });

  it('deals hero the hand the scenario names', () => {
    const spot = generateSpot({ template: RFI, seed: 3, registry });
    const hole = seatAt(spot.state, spot.hero).hole!;

    expect(handNotationOf(hole[0], hole[1])).toBe(spot.scenario.hand);
    expect(CANONICAL_HANDS).toContain(spot.scenario.hand);
  });

  it('produces a spot the strategy can actually answer', () => {
    // The join that matters: a template must not generate spots
    // `deriveActionSequence` then refuses.
    for (let seed = 0; seed < 40; seed++) {
      for (const template of [RFI, DEFENCE]) {
        const spot = generateSpot({ template, seed, registry });

        expect(deriveActionSequence(spot.state, spot.hero)).toBe(spot.scenario.actionSequence);
        expect(() => strategy.recommend(spot.state, spot.hero)).not.toThrow();
      }
    }
  });

  it('sets up a defence spot with a real open in front of hero', () => {
    const spot = generateSpot({ template: DEFENCE, seed: 7, registry });

    expect(spot.hero).toBe('BB');
    expect(spot.scenario.actionSequence).toMatch(/^vs_(utg|btn)_open$/);
    expect(spot.scenario.openSize).toBe(2.5);

    const opener = spot.scenario.actionSequence.slice(3, -5).toUpperCase() as Position;
    expect(seatAt(spot.state, opener).totalCommitted).toBe(2.5);
  });

  it('leaves no open size on an rfi spot', () => {
    expect(generateSpot({ template: RFI, seed: 2, registry }).scenario.openSize).toBeUndefined();
  });

  it('throws when the template names a spot the registry has no chart for', () => {
    const orphan: DrillTemplate = { ...RFI, positions: ['SB'] };

    expect(() => generateSpot({ template: orphan, seed: 1, registry })).toThrow(/chart/i);
  });
});

describe('reproducibility', () => {
  it('gives an identical spot for the same seed', () => {
    expect(generateSpot({ template: RFI, seed: 42, registry })).toEqual(
      generateSpot({ template: RFI, seed: 42, registry }),
    );
  });

  it('gives different spots for different seeds', () => {
    const scenarios = Array.from({ length: 40 }, (_v, seed) =>
      JSON.stringify(generateSpot({ template: RFI, seed, registry }).scenario),
    );

    expect(new Set(scenarios).size).toBeGreaterThan(20);
  });

  it('rebuilds the identical state from the scenario alone', () => {
    // The load-bearing one. `drill_attempts.scenario` is a compact descriptor,
    // and replay must not need the seed, the template or the registry.
    for (let seed = 0; seed < 40; seed++) {
      for (const template of [RFI, DEFENCE]) {
        const spot = generateSpot({ template, seed, registry });

        expect(rebuildSpot(spot.scenario)).toEqual(spot);
      }
    }
  });

  it('rebuilds from a scenario that has been through JSON', () => {
    const spot = generateSpot({ template: DEFENCE, seed: 5, registry });
    const roundTripped = JSON.parse(JSON.stringify(spot.scenario)) as typeof spot.scenario;

    expect(rebuildSpot(roundTripped)).toEqual(spot);
  });

  it('rejects a scenario whose hole cards do not match its hand', () => {
    const spot = generateSpot({ template: RFI, seed: 8, registry });
    const tampered = { ...spot.scenario, hand: spot.scenario.hand === 'AA' ? 'KK' : 'AA' };

    expect(() => rebuildSpot(tampered)).toThrow();
  });

  it('rejects a scenario whose hero never reaches the action', () => {
    const spot = generateSpot({ template: RFI, seed: 9, registry });
    const tampered = { ...spot.scenario, actionSequence: 'vs_btn_open' as const };

    expect(() => rebuildSpot(tampered)).toThrow();
  });
});

describe('generateSpots', () => {
  it('produces the requested number of spots', () => {
    expect(generateSpots({ template: RFI, seed: 1, registry, count: 25 })).toHaveLength(25);
  });

  it('replays a whole session identically', () => {
    // A 25-spot session is a much stronger reproducibility check than one spot.
    const a = generateSpots({ template: RFI, seed: 314, registry, count: 25 });
    const b = generateSpots({ template: RFI, seed: 314, registry, count: 25 });

    expect(a).toEqual(b);
  });

  it('never repeats a spot within a session', () => {
    const spots = generateSpots({ template: RFI, seed: 2, registry, count: 40 });
    const keys = spots.map(
      (s) => `${s.scenario.heroPosition}|${s.scenario.actionSequence}|${s.scenario.hand}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every spot the same treatment as a single one', () => {
    for (const spot of generateSpots({ template: DEFENCE, seed: 6, registry, count: 15 })) {
      expect(spot.state.toAct).toBe(spot.hero);
      expect(() => strategy.recommend(spot.state, spot.hero)).not.toThrow();
      expect(rebuildSpot(spot.scenario)).toEqual(spot);
    }
  });

  it.each([0, -1, 2.5])('rejects a count of %s', (count) => {
    expect(() => generateSpots({ template: RFI, seed: 1, registry, count })).toThrow(RangeError);
  });

  it('says so rather than looping forever when it cannot fill the session', () => {
    // One position, three listed hands: there are not 200 distinct spots.
    const narrow: DrillTemplate = {
      ...RFI,
      positions: ['UTG'],
      sampling: { include: ['AA', 'AJo', 'KQo'] },
    };

    expect(() => generateSpots({ template: narrow, seed: 1, registry, count: 200 })).toThrow(
      /distinct/i,
    );
  });
});

describe('the scenario descriptor', () => {
  it('carries only JSON-friendly values', () => {
    const { scenario } = generateSpot({ template: DEFENCE, seed: 11, registry });

    expect(JSON.parse(JSON.stringify(scenario))).toEqual(scenario);
    expect(scenario.hole.map((card) => parseCard(card))).toHaveLength(2);
  });

  it('names the template it came from', () => {
    expect(generateSpot({ template: DEFENCE, seed: 1, registry }).scenario.templateSlug).toBe(
      'defence',
    );
  });

  it('records the table it was played on', () => {
    const { scenario } = generateSpot({ template: RFI, seed: 1, registry });

    expect(scenario.tableSize).toBe(6);
    expect(scenario.stackDepth).toBe(100);
  });
});

describe('a scenario cannot contradict itself', () => {
  // From Phase 4 the scenario is a client-writable jsonb column, so `rebuildSpot`
  // must not accept a descriptor whose label disagrees with the betting it
  // replays. Each of these built a plausible-but-wrong state before the check.
  const base = () => generateSpot({ template: DEFENCE, seed: 3, registry }).scenario;

  it('rejects an action sequence the replay does not produce', () => {
    // UTG is first to act, so this replays an unopened pot labelled as defence.
    expect(() =>
      rebuildSpot({ ...base(), heroPosition: 'UTG', actionSequence: 'vs_bb_open' }),
    ).toThrow(/vs_bb_open/);
  });

  it('rejects a sequence no chart family covers', () => {
    // `3bet_pot` matches no `vs_<pos>_open` pattern, so everyone folds to hero
    // and an rfi spot gets labelled a three-bet pot.
    // An rfi scenario carries no open size, so relabelling it is the whole test.
    const opening = generateSpot({ template: RFI, seed: 3, registry }).scenario;

    expect(() => rebuildSpot({ ...opening, actionSequence: '3bet_pot' })).toThrow(/3bet_pot/);
  });

  it('still accepts every scenario it generates', () => {
    for (const template of [RFI, DEFENCE]) {
      for (const spot of generateSpots({ template, seed: 909, registry, count: 10 })) {
        expect(rebuildSpot(spot.scenario)).toEqual(spot);
      }
    }
  });

  it('does not catch an open size inside the resolvable band', () => {
    // Documented, not desired. `deriveActionSequence` accepts any open up to
    // MAX_OPEN_BLINDS, so a tampered size still replays as the same sequence —
    // only with an inflated pot. Closing this needs the chart's authored size,
    // which a scenario deliberately does not carry; `validateDrillTemplates`
    // takes a registry for exactly that reason, and Phase 4 must re-derive the
    // size from the template rather than trusting the stored one.
    const spot = rebuildSpot({ ...base(), openSize: 3.9 });

    expect(spot.state).not.toEqual(rebuildSpot(base()).state);
  });
});
