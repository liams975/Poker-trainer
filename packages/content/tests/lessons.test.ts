import { CANONICAL_HANDS, frequencyOf, handStrategy, orderedLessons, validateTracks } from '@poker/engine';
import { describe, expect, it } from 'vitest';

import { loadChartRegistry, loadChartSet } from '../src/chart-set';
import { loadDrillTemplates } from '../src/drill-templates';
import { loadTracks, placementOrder, rawTracks } from '../src/lessons';
import { SKILL_TAGS } from '../src/skill-tags';

/**
 * A wrong chart teaches one spot wrong. A wrong lesson teaches a *model* wrong,
 * and the reader carries it into every spot afterwards. So the content is
 * checked against the data it describes, not merely against a schema.
 */

describe('the seeded track', () => {
  it('validates against the charts and templates', () => {
    const result = validateTracks(rawTracks, {
      registry: loadChartRegistry(),
      templates: loadDrillTemplates(),
    });

    if (!result.ok) {
      throw new Error(
        `lesson content is invalid:\n${result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it('uses only skill tags the database vocabulary knows', () => {
    const known = new Set<string>(SKILL_TAGS);

    for (const track of loadTracks()) {
      for (const lesson of orderedLessons(track)) {
        for (const tag of lesson.skillTags) {
          // The `lessons_skill_tags_valid` trigger rejects anything else at
          // sync time; failing here is the same check, several minutes earlier.
          expect(known, `${lesson.slug} uses ${tag}`).toContain(tag);
        }
      }
    }
  });

  it('teaches every skill tag the seeded charts carry', () => {
    const taught = new Set(
      loadTracks().flatMap((track) => orderedLessons(track).flatMap((l) => [...l.skillTags])),
    );

    // A chart nothing teaches is a hole in the course, and weak-spot detection
    // in Phase 9 would point at material that does not exist.
    for (const chart of loadChartSet().charts) {
      for (const tag of chart.skillTags) {
        expect(taught, `nothing teaches ${tag}`).toContain(tag);
      }
    }
  });

  it('gives every lesson a unique slug across the whole track', () => {
    const slugs = loadTracks().flatMap((t) => orderedLessons(t).map((l) => l.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('orders modules and lessons without ties', () => {
    for (const track of loadTracks()) {
      const moduleOrders = track.modules.map((m) => m.sortOrder);
      expect(new Set(moduleOrders).size).toBe(moduleOrders.length);

      for (const module of track.modules) {
        const orders = module.lessons.map((l) => l.sortOrder);
        expect(new Set(orders).size, `${module.slug} has tied lesson order`).toBe(orders.length);
      }
    }
  });
});

describe('the prose matches the charts it describes', () => {
  /**
   * Every hand named in a `hands` block must actually be mixed in a chart the
   * same lesson shows. The lessons use these blocks to say "look, these are the
   * close ones" — naming a hand that is pure would be teaching the opposite of
   * the point.
   */
  it('only highlights hands that are genuinely mixed', () => {
    const registry = loadChartRegistry();
    const all = [...registry.values()];

    for (const track of loadTracks()) {
      for (const lesson of orderedLessons(track)) {
        const shown = lesson.blocks
          .filter((block) => block.kind === 'range')
          .flatMap((block) =>
            all.filter(
              (chart) =>
                chart.heroPosition === block.heroPosition &&
                chart.actionSequence === block.actionSequence,
            ),
          );

        // A lesson that shows charts must justify its hands from *those*. One
        // that shows none (the mixed-strategy lesson names hands in prose) still
        // has to name a hand that is mixed somewhere — skipping those lessons
        // was how a pure hand slipped past this check.
        const candidates = shown.length > 0 ? shown : all;

        for (const block of lesson.blocks) {
          if (block.kind !== 'hands') continue;

          for (const hand of block.hands) {
            const mixed = candidates.some((chart) => handStrategy(chart.ranges, hand).length > 1);
            expect(mixed, `${lesson.slug} highlights ${hand}, which is not mixed`).toBe(true);
          }
        }
      }
    }
  });

  /**
   * Percentages written into the prose are checked against the charts. This is
   * the assertion that would have caught a copy-edit changing "43.4%" to a
   * number that reads better and is wrong.
   */
  it('quotes opening frequencies that the charts actually produce', () => {
    const registry = loadChartRegistry();
    const TOTAL_COMBOS = 1326;
    const combos = (hand: string): number =>
      hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12;

    const openPercent = (
      heroPosition: string,
      actionSequence: string,
      which: 'continue' | 'raise' = 'continue',
    ): number => {
      const chart = [...registry.values()].find(
        (c) => c.heroPosition === heroPosition && c.actionSequence === actionSequence,
      );
      if (chart === undefined) throw new Error(`no chart for ${heroPosition}/${actionSequence}`);

      let weighted = 0;
      for (const hand of CANONICAL_HANDS) {
        const mix = handStrategy(chart.ranges, hand);
        const live =
          which === 'raise'
            ? frequencyOf(mix, 'raise')
            : frequencyOf(mix, 'raise') + frequencyOf(mix, 'call');
        weighted += live * combos(hand);
      }
      return Math.round((weighted / TOTAL_COMBOS) * 1000) / 10;
    };

    /**
     * Every one-decimal percentage the charts can justify — continuing, and
     * raising alone, for each of the ten.
     */
    const legitimate = new Set<string>();
    for (const chart of [...registry.values()]) {
      for (const action of ['continue', 'raise'] as const) {
        legitimate.add(openPercent(chart.heroPosition, chart.actionSequence, action).toFixed(1));
      }
    }

    const prose = JSON.stringify(rawTracks);

    /**
     * Checked in the direction that actually catches a bad edit: every
     * one-decimal percentage *written in the prose* has to be a figure some
     * chart produces.
     *
     * Asserting the other way — "43.4% appears somewhere" — is what an earlier
     * version did, and it passed with the number changed to 48.0% because the
     * same figure was quoted in a second lesson. Presence is not accuracy.
     */
    const written = [...prose.matchAll(/(\d+\.\d)%/g)].map((match) => match[1]!);
    expect(written.length).toBeGreaterThan(8);

    for (const figure of written) {
      expect(
        legitimate.has(figure),
        `the prose quotes ${figure}%, which no seeded chart produces`,
      ).toBe(true);
    }

    // And the headline figures are still the ones the lessons lean on.
    for (const [position, sequence, expected] of [
      ['UTG', 'rfi', 14.9],
      ['BTN', 'rfi', 43.4],
      ['BB', 'vs_btn_open', 54.8],
    ] as const) {
      expect(openPercent(position, sequence), `${position}/${sequence}`).toBeCloseTo(expected, 1);
      expect(prose).toContain(`${expected.toFixed(1)}%`);
    }
  });
});

describe('placementOrder', () => {
  it('excludes concept tags, which no diagnostic can test', () => {
    const tags = placementOrder().flatMap((group) => [...group.members]);
    expect(tags.every((tag) => !tag.startsWith('concept.'))).toBe(true);
  });

  it('covers every drillable tag the track teaches', () => {
    const tags = placementOrder().flatMap((group) => [...group.members]);
    const drillable = new Set(loadDrillTemplates().flatMap((t) => t.skillTags));

    for (const tag of tags) expect(drillable).toContain(tag);
    expect(new Set(tags).size).toBe(10);
  });

  it('is in course order, so placement lands earlier for a weaker player', () => {
    const groups = placementOrder();

    expect(groups[0]?.skillTag).toBe('preflop.rfi.utg');
    expect(groups.at(-1)?.skillTag).toBe('preflop.blind_defense.bb_vs_sb');
  });

  /**
   * Groups are lesson-sized so a short diagnostic can actually fill them. Ten
   * one-tag groups would need thirty answers before anything was demonstrated,
   * and a shorter run would place everyone at lesson one while looking fine.
   */
  it('groups tags by lesson, not one group per tag', () => {
    const groups = placementOrder();

    expect(groups.length).toBeLessThan(10);
    expect(groups.some((group) => group.members.length > 1)).toBe(true);
  });

  it('never counts one tag towards two groups', () => {
    const tags = placementOrder().flatMap((group) => [...group.members]);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
