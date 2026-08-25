import { describe, expect, it } from 'vitest';

import type { DrillTemplate, Position } from '@poker/engine';
import {
  CANONICAL_HANDS,
  comboCountOf,
  createChartStrategy,
  generateSpot,
  generateSpots,
  gradeAnswer,
  handStrategy,
  lookupChart,
  potSize,
  primaryAction,
  rebuildSpot,
  validateDrillTemplates,
} from '@poker/engine';

import { CHART_SET_VERSION, loadChartRegistry, loadChartSet } from '../src/chart-set';
import { findDrillTemplate, loadDrillTemplates, rawDrillTemplates } from '../src/drill-templates';
import { isSkillTag } from '../src/skill-tags';

/**
 * The seeded templates against the real seeded charts — the only place the two
 * meet, since the engine cannot import packages/content.
 *
 * This carries the roadmap's Phase 3 exit criteria end to end: reproducible
 * generation, and grading that handles mixed strategies.
 */

const templates = loadDrillTemplates();
const registry = loadChartRegistry();
const set = loadChartSet();
const strategy = createChartStrategy({ registry, chartVersion: CHART_SET_VERSION });

function spotsFor(template: DrillTemplate, count: number) {
  return generateSpots({ template, seed: 20260825, registry, count });
}

describe('the seeded templates', () => {
  it('all validate, against the real charts', () => {
    // The registry is the point: it is what catches a template presenting an
    // open size no chart was authored for, which validates structurally.
    const result = validateDrillTemplates(rawDrillTemplates, registry);
    const detail = result.ok ? '' : result.errors.map((e) => `${e.path}: ${e.message}`).join('\n');

    expect(detail).toBe('');
  });

  it('covers opening and blind defence', () => {
    // Exact, so losing or quietly adding one is a failing test rather than a
    // silent change in what the product drills.
    expect(templates).toHaveLength(8);
    expect(templates.some((t) => t.spot === 'rfi')).toBe(true);
    expect(templates.some((t) => t.spot === 'vs_open')).toBe(true);
  });

  it('has a focused template for every opening position', () => {
    for (const position of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      const focused = templates.find(
        (t) => t.spot === 'rfi' && t.positions.length === 1 && t.positions[0] === position,
      );
      expect(focused, `no focused template for ${position}`).toBeDefined();
    }
  });

  it('only uses tags from the declared vocabulary', () => {
    for (const template of templates) {
      for (const tag of template.skillTags) {
        expect(isSkillTag(tag), `${template.slug}: ${tag}`).toBe(true);
      }
    }
  });

  it('finds a template by slug', () => {
    expect(findDrillTemplate('preflop-rfi')?.spot).toBe('rfi');
    expect(findDrillTemplate('nope')).toBeUndefined();
  });
});

describe('templates and charts agree', () => {
  it('names only positions the charts cover', () => {
    for (const template of templates) {
      for (const position of template.positions) {
        const sequences =
          template.spot === 'rfi'
            ? ['rfi']
            : (template.openers ?? []).map((o) => `vs_${o.toLowerCase()}_open`);

        for (const actionSequence of sequences) {
          const chart = lookupChart(registry, {
            tableSize: 6,
            stackDepth: 100,
            heroPosition: position,
            actionSequence,
          });
          expect(chart, `${template.slug}: no chart for ${position}/${actionSequence}`).toBeDefined();
        }
      }
    }
  });

  it('presents the open size the defence chart was authored against', () => {
    // The cross-check that matters: the small blind opens 3bb and everyone else
    // 2.5bb, so a single defence template covering all five would drill the SB
    // spot against a chart written for a different open.
    for (const template of templates.filter((t) => t.spot === 'vs_open')) {
      for (const opener of template.openers ?? []) {
        const rfi = set.charts.find(
          (c) => c.heroPosition === opener && c.actionSequence === 'rfi',
        )!;
        const openSize = primaryAction(handStrategy(rfi.ranges, 'AA')).size;

        expect(template.openSize, `${template.slug} vs ${opener}`).toBe(openSize);
      }
    }
  });
});

describe('exit criterion: generation is reproducible', () => {
  it.each(templates.map((t) => [t.slug, t] as const))('%s replays identically', (_slug, template) => {
    expect(spotsFor(template, 12)).toEqual(spotsFor(template, 12));
  });

  it('rebuilds every spot from its scenario alone', () => {
    for (const template of templates) {
      for (const spot of spotsFor(template, 12)) {
        expect(rebuildSpot(spot.scenario)).toEqual(spot);
        expect(rebuildSpot(JSON.parse(JSON.stringify(spot.scenario)))).toEqual(spot);
      }
    }
  });

  it('runs a full 25-spot session for the broad templates', () => {
    for (const slug of ['preflop-rfi', 'preflop-bb-defense']) {
      const session = spotsFor(findDrillTemplate(slug)!, 25);

      expect(session).toHaveLength(25);
      expect(new Set(session.map((s) => JSON.stringify(s.scenario))).size).toBe(25);
    }
  });
});

describe('every generated spot is answerable', () => {
  it('resolves through ChartStrategy for every template', () => {
    for (const template of templates) {
      for (const spot of spotsFor(template, 20)) {
        const rec = strategy.recommend(spot.state, spot.hero);

        expect(rec.chartVersion).toBe(CHART_SET_VERSION);
        expect(rec.frequencies.reduce((sum, f) => sum + f.freq, 0)).toBeCloseTo(1, 6);
        expect(rec.rationale.factors.length).toBeGreaterThan(0);
      }
    }
  });

  it('grades an answer end to end', () => {
    const spot = generateSpot({ template: findDrillTemplate('preflop-rfi')!, seed: 5, registry });
    const rec = strategy.recommend(spot.state, spot.hero);
    const grade = gradeAnswer(rec.frequencies, { action: 'fold' }, potSize(spot.state));

    expect(['optimal', 'acceptable', 'inaccurate', 'blunder']).toContain(grade.tier);
    expect(grade.evLoss).toBeGreaterThanOrEqual(0);
    expect(grade.frequencies).toEqual(rec.frequencies);
  });

  it('grades the primary action optimal, always', () => {
    for (const template of templates) {
      for (const spot of spotsFor(template, 10)) {
        const rec = strategy.recommend(spot.state, spot.hero);
        const answer =
          rec.primarySize !== undefined
            ? { action: rec.primary, size: rec.primarySize }
            : { action: rec.primary };

        const grade = gradeAnswer(rec.frequencies, answer, potSize(spot.state));

        expect(grade.tier, `${template.slug} ${spot.scenario.hand}`).toBe('optimal');
        expect(grade.evLoss).toBe(0);
      }
    }
  });
});

describe('exit criterion: sampling concentrates on what teaches', () => {
  it('surfaces mixed hands far more often than their share of the deck', () => {
    // The single highest-leverage choice in the product, asserted as a
    // measurement. Without this, the weighting could quietly do nothing and no
    // schema or type check would notice.
    const template = findDrillTemplate('preflop-rfi-co')!;
    const chart = set.charts.find((c) => c.heroPosition === 'CO' && c.actionSequence === 'rfi')!;

    const mixed = new Set(
      CANONICAL_HANDS.filter((hand) => handStrategy(chart.ranges, hand).length > 1),
    );
    const naturalShare =
      [...mixed].reduce((combos, hand) => combos + comboCountOf(hand), 0) / 1326;

    const drawn = spotsFor(template, 120);
    const hitRate = drawn.filter((spot) => mixed.has(spot.scenario.hand)).length / drawn.length;

    expect(mixed.size).toBeGreaterThan(5);
    expect(hitRate).toBeGreaterThan(naturalShare * 2);
  });

  it('still shows unmixed hands, so the prior is not distorted', () => {
    // The counterweight docs/03 asks for: reserve some realistic sampling.
    const template = findDrillTemplate('preflop-rfi')!;
    const chart = set.charts.find((c) => c.heroPosition === 'UTG' && c.actionSequence === 'rfi')!;
    const pure = spotsFor(template, 120).filter(
      (spot) =>
        spot.scenario.heroPosition === 'UTG' &&
        handStrategy(chart.ranges, spot.scenario.hand).length === 1,
    );

    expect(pure.length).toBeGreaterThan(0);
  });

  it('draws a spread of positions from a broad template', () => {
    const seen = new Set<Position>(
      spotsFor(findDrillTemplate('preflop-rfi')!, 60).map((s) => s.scenario.heroPosition),
    );

    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});
