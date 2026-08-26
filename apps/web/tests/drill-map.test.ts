import type { Position, Range, RangeChart } from '@poker/engine';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '@poker/engine';
import { describe, expect, it } from 'vitest';

import { toDrillTemplates, type DrillTemplateRow } from '../src/lib/drills/map';

/**
 * `drill_templates.config` is an opaque jsonb blob written by a service-role
 * script. A template that lies about its open size does not crash — it
 * generates a plausible spot and grades the answer against a chart written for
 * a different one, which is the failure mode this codebase treats as worse than
 * an error. So the mapper validates rather than trusts, and this pins that.
 */

function chart(heroPosition: Position, actionSequence: string, size: number): RangeChart {
  const ranges: Range = {
    AA: [{ action: 'raise', size, freq: 1 }],
    KQo: [
      { action: 'raise', size, freq: 0.5 },
      { action: 'fold', freq: 0.5 },
    ],
  };

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
  version: 'test',
  published: true,
  charts: [
    chart('UTG', 'rfi', 2.5),
    chart('BTN', 'rfi', 2.5),
    chart('SB', 'rfi', 3),
    chart('BB', 'vs_utg_open', 11),
  ],
});

function row(overrides: Partial<DrillTemplateRow> = {}): DrillTemplateRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'preflop-rfi',
    title: 'Opening ranges',
    config: { spot: 'rfi', positions: ['UTG', 'BTN'], sampling: { uniformShare: 0.3 } },
    skill_tags: ['preflop.rfi.utg'],
    published: true,
    ...overrides,
  };
}

describe('toDrillTemplates', () => {
  it('maps a well-formed row', () => {
    const [entry] = toDrillTemplates([row()], registry);

    expect(entry?.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(entry?.template.slug).toBe('preflop-rfi');
    expect(entry?.template.positions).toEqual(['UTG', 'BTN']);
    expect(entry?.template.skillTags).toEqual(['preflop.rfi.utg']);
  });

  it('keeps ids paired with the template they came from', () => {
    const mapped = toDrillTemplates(
      [
        row(),
        row({
          id: '22222222-2222-4222-8222-222222222222',
          slug: 'preflop-rfi-sb',
          config: { spot: 'rfi', positions: ['SB'] },
        }),
      ],
      registry,
    );

    expect(mapped.map((entry) => [entry.id, entry.template.slug])).toEqual([
      ['11111111-1111-4111-8111-111111111111', 'preflop-rfi'],
      ['22222222-2222-4222-8222-222222222222', 'preflop-rfi-sb'],
    ]);
  });

  it('treats null skill_tags as none, not as invalid', () => {
    const [entry] = toDrillTemplates([row({ skill_tags: null })], registry);
    expect(entry?.template.skillTags).toEqual([]);
  });

  it('rejects a config that is not an object', () => {
    expect(() => toDrillTemplates([row({ config: 'nonsense' })], registry)).toThrow(/invalid/i);
  });

  it('rejects an unknown position rather than silently dropping it', () => {
    expect(() =>
      toDrillTemplates([row({ config: { spot: 'rfi', positions: ['MP'] } })], registry),
    ).toThrow(/MP/);
  });

  /**
   * The registry check, and the reason the registry is threaded through at all.
   * A structural validator accepts this: 3bb is a legal-looking open size. Only
   * comparing it against the opener's actual chart catches it.
   */
  it('rejects an open size the opener’s chart was not authored for', () => {
    expect(() =>
      toDrillTemplates(
        [
          row({
            slug: 'bb-defence',
            config: {
              spot: 'vs_open',
              positions: ['BB'],
              openers: ['UTG'],
              openSize: 3,
            },
            skill_tags: ['preflop.blind_defense.bb_vs_utg'],
          }),
        ],
        registry,
      ),
    ).toThrow(/2\.5bb/);
  });

  it('accepts the open size that chart does use', () => {
    const [entry] = toDrillTemplates(
      [
        row({
          slug: 'bb-defence',
          config: { spot: 'vs_open', positions: ['BB'], openers: ['UTG'], openSize: 2.5 },
          skill_tags: ['preflop.blind_defense.bb_vs_utg'],
        }),
      ],
      registry,
    );

    expect(entry?.template.openSize).toBe(2.5);
  });

  /**
   * `config` is spread first so the row's own columns win. A blob carrying its
   * own `published: true` must not be able to publish a row the database has
   * marked as a draft — that is the column RLS gates visibility on.
   */
  it('does not let the config blob rewrite the row’s own columns', () => {
    const [entry] = toDrillTemplates(
      [
        row({
          published: false,
          config: {
            spot: 'rfi',
            positions: ['UTG'],
            published: true,
            slug: 'something-else',
            title: 'Hijacked',
          },
        }),
      ],
      registry,
    );

    expect(entry?.template.published).toBe(false);
    expect(entry?.template.slug).toBe('preflop-rfi');
    expect(entry?.template.title).toBe('Opening ranges');
  });

  it('reports every problem at once, not just the first', () => {
    try {
      toDrillTemplates(
        [row({ config: { spot: 'rfi', positions: ['MP'], sampling: { uniformShare: 5 } } })],
        registry,
      );
      expect.unreachable('expected the mapper to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/MP/);
      expect(message).toMatch(/uniformShare/);
    }
  });
});
