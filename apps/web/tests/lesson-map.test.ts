import type { DrillTemplate, Position, Range, RangeChart } from '@poker/engine';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '@poker/engine';
import { describe, expect, it } from 'vitest';

import { toTrack, type TrackRow } from '../src/lib/lessons/map';

/**
 * `lessons.body` is an opaque jsonb blob written by a service-role script, so
 * it is validated rather than trusted — the same rule as charts and templates.
 *
 * It matters more here. A malformed chart renders a wrong range and a careful
 * reader might notice; a lesson block naming a chart that does not exist
 * renders an empty box, and the reader assumes the blank space is deliberate.
 */

const RANGES: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  AJo: [
    { action: 'raise', size: 2.5, freq: 0.6 },
    { action: 'fold', freq: 0.4 },
  ],
};

function chart(heroPosition: Position, actionSequence: string): RangeChart {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition,
    actionSequence,
    skillTags: [],
    ranges: RANGES,
  };
}

const registry = createChartRegistry({
  version: 'test',
  published: true,
  charts: [chart('BTN', 'rfi')],
});

const templates: readonly DrillTemplate[] = [
  {
    slug: 'preflop-rfi-btn',
    title: 'Opening from the button',
    spot: 'rfi',
    positions: ['BTN'],
    skillTags: ['preflop.rfi.btn'],
    published: true,
  },
];

const context = { registry, templates };

function row(overrides: Partial<TrackRow> = {}, body?: unknown): TrackRow {
  return {
    slug: 'preflop-fundamentals',
    title: 'Preflop fundamentals',
    description: 'A track',
    sort_order: 0,
    published: true,
    modules: [
      {
        slug: 'opening',
        title: 'Opening',
        sort_order: 0,
        lessons: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            slug: 'opening-in-late-position',
            title: 'Opening from late position',
            body: body ?? {
              summary: 'Where the money is.',
              blocks: [{ kind: 'prose', text: 'The button opens widest.' }],
            },
            skill_tags: ['preflop.rfi.btn'],
            sort_order: 0,
            version: '1',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('toTrack', () => {
  it('maps a well-formed row', () => {
    const { track } = toTrack(row(), context);

    expect(track.slug).toBe('preflop-fundamentals');
    expect(track.modules[0]?.lessons[0]?.title).toBe('Opening from late position');
    expect(track.modules[0]?.lessons[0]?.summary).toBe('Where the money is.');
  });

  it('returns the lesson ids progress rows have to reference', () => {
    const { lessonIds } = toTrack(row(), context);

    expect(lessonIds.get('opening-in-late-position')).toBe(
      '44444444-4444-4444-8444-444444444444',
    );
  });

  it('rejects a body that is not an object', () => {
    expect(() => toTrack(row({}, 'nonsense'), context)).toThrow(/invalid/i);
  });

  it('rejects a body with no blocks', () => {
    expect(() => toTrack(row({}, { summary: 'x', blocks: [] }), context)).toThrow(/blocks/);
  });

  it('rejects an unknown block kind rather than skipping it', () => {
    const body = { summary: 'x', blocks: [{ kind: 'video', url: 'https://example.com' }] };
    expect(() => toTrack(row({}, body), context)).toThrow(/video/);
  });

  /**
   * The check that needs the registry, and the reason it is threaded through.
   * A structural validator accepts this happily: `HJ` is a real position and
   * `rfi` a real sequence. Only the registry knows nobody authored that chart.
   */
  it('rejects a range block naming a chart that was never authored', () => {
    const body = {
      summary: 'x',
      blocks: [{ kind: 'range', heroPosition: 'HJ', actionSequence: 'rfi' }],
    };

    expect(() => toTrack(row({}, body), context)).toThrow(/HJ/);
  });

  it('accepts a range block naming a chart that exists', () => {
    const body = {
      summary: 'x',
      blocks: [{ kind: 'range', heroPosition: 'BTN', actionSequence: 'rfi' }],
    };

    expect(() => toTrack(row({}, body), context)).not.toThrow();
  });

  it('rejects a drill block naming a template that does not exist', () => {
    const body = {
      summary: 'x',
      blocks: [{ kind: 'drill', templateSlug: 'preflop-rfi-utg', spots: 5 }],
    };

    expect(() => toTrack(row({}, body), context)).toThrow(/preflop-rfi-utg/);
  });

  /**
   * `body` is spread into nothing — `summary` and `blocks` are read from it by
   * name, and everything else comes from a real column. A blob carrying its own
   * `slug` or `skillTags` must not be able to rewrite the identity of the row
   * it lives in.
   */
  it('does not let the body blob rewrite the row’s own columns', () => {
    const body = {
      summary: 'x',
      blocks: [{ kind: 'prose', text: 'y' }],
      slug: 'hijacked',
      skillTags: ['concept.position'],
      version: '99',
    };

    const { track } = toTrack(row({}, body), context);
    const lesson = track.modules[0]?.lessons[0];

    expect(lesson?.slug).toBe('opening-in-late-position');
    expect(lesson?.skillTags).toEqual(['preflop.rfi.btn']);
    expect(lesson?.version).toBe('1');
  });

  it('treats null skill_tags as none, which the validator then rejects', () => {
    const bare = row();
    bare.modules[0]!.lessons[0]!.skill_tags = null;

    // A lesson with no tag cannot be placed into or linked to a weakness.
    expect(() => toTrack(bare, context)).toThrow(/skillTags/);
  });

  it('validates structurally when no registry is supplied', () => {
    const body = {
      summary: 'x',
      blocks: [{ kind: 'range', heroPosition: 'HJ', actionSequence: 'rfi' }],
    };

    expect(() => toTrack(row({}, body))).not.toThrow();
  });
});
