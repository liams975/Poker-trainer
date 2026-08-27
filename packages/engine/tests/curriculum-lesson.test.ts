import { describe, expect, it } from 'vitest';

import { parseTracks, validateTracks } from '../src/curriculum';
import type { DrillTemplate } from '../src/drills';
import type { Position, Range, RangeChart } from '../src/ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '../src/ranges';

/**
 * A lesson that references a chart nobody authored, or a drill template that
 * does not exist, does not crash — it renders an empty box to a student who
 * assumes the gap is the point. Structural validation cannot see that, which is
 * why the validator takes the registry and the template list.
 *
 * Same argument as `drill-template.test.ts`: the open-size check there exists
 * because a template that lies still resolves to a plausible spot.
 */

const OPEN: Range = {
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
    ranges: OPEN,
  };
}

const registry = createChartRegistry({
  version: 'test-8',
  published: true,
  charts: [chart('UTG', 'rfi'), chart('BTN', 'rfi'), chart('BB', 'vs_btn_open')],
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

function lesson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'why-position-pays',
    title: 'Why position pays',
    summary: 'Acting last is information, and information is money.',
    sortOrder: 0,
    version: '1',
    skillTags: ['preflop.rfi.btn'],
    blocks: [{ kind: 'prose', text: 'The button acts last on every street after the flop.' }],
    ...overrides,
  };
}

function track(lessons: readonly unknown[]): readonly unknown[] {
  return [
    {
      slug: 'preflop-fundamentals',
      title: 'Preflop fundamentals',
      description: 'The ten charts, and the ideas underneath them.',
      sortOrder: 0,
      published: true,
      modules: [{ slug: 'position', title: 'Position', sortOrder: 0, lessons }],
    },
  ];
}

describe('parseTracks', () => {
  it('accepts a well-formed track', () => {
    const [parsed] = parseTracks(track([lesson()]), context);

    expect(parsed?.slug).toBe('preflop-fundamentals');
    expect(parsed?.modules[0]?.lessons[0]?.title).toBe('Why position pays');
  });

  it('accepts every block kind', () => {
    const blocks = [
      { kind: 'prose', text: 'Position is the single biggest edge preflop.' },
      { kind: 'key_points', points: ['Open tighter early', 'Open wider late'] },
      { kind: 'callout', tone: 'warning', text: 'Never open the big blind first in.' },
      { kind: 'range', heroPosition: 'BTN', actionSequence: 'rfi', caption: 'The button open' },
      { kind: 'hands', hands: ['AJo', 'AA'], caption: 'Two very different hands' },
      { kind: 'drill', templateSlug: 'preflop-rfi-btn', spots: 5 },
    ];

    const parsed = parseTracks(track([lesson({ blocks })]), context);
    expect(parsed[0]?.modules[0]?.lessons[0]?.blocks).toHaveLength(6);
  });

  it('rejects a lesson with no blocks', () => {
    expect(() => parseTracks(track([lesson({ blocks: [] })]), context)).toThrow(/blocks/);
  });

  it('rejects an unknown block kind', () => {
    const blocks = [{ kind: 'video', url: 'https://example.com' }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).toThrow(/video/);
  });

  /** The check that needs the registry. */
  it('rejects a range block naming a chart that was never authored', () => {
    const blocks = [{ kind: 'range', heroPosition: 'HJ', actionSequence: 'rfi' }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).toThrow(/HJ/);
  });

  it('accepts a range block naming a chart that exists', () => {
    const blocks = [{ kind: 'range', heroPosition: 'BB', actionSequence: 'vs_btn_open' }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).not.toThrow();
  });

  /** The check that needs the template list. */
  it('rejects a drill block naming a template that does not exist', () => {
    const blocks = [{ kind: 'drill', templateSlug: 'preflop-rfi-utg', spots: 5 }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).toThrow(/preflop-rfi-utg/);
  });

  it('rejects a non-canonical hand', () => {
    const blocks = [{ kind: 'hands', hands: ['AKx'] }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).toThrow(/AKx/);
  });

  it('rejects a duplicated hand, which would silently double its emphasis', () => {
    const blocks = [{ kind: 'hands', hands: ['AA', 'AA'] }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).toThrow(/AA/);
  });

  it('rejects an out-of-range drill length', () => {
    const blocks = [{ kind: 'drill', templateSlug: 'preflop-rfi-btn', spots: 0 }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).toThrow(/spots/);
  });

  it('rejects an unknown callout tone', () => {
    const blocks = [{ kind: 'callout', tone: 'danger', text: 'Careful.' }];
    expect(() => parseTracks(track([lesson({ blocks })]), context)).toThrow(/danger/);
  });

  /**
   * A lesson with no skill tag cannot be placed into and cannot be linked to a
   * weakness, which is the whole point of the vocabulary.
   */
  it('rejects a lesson with no skill tags', () => {
    expect(() => parseTracks(track([lesson({ skillTags: [] })]), context)).toThrow(/skillTags/);
  });

  it('rejects a duplicate lesson slug within a module', () => {
    expect(() => parseTracks(track([lesson(), lesson()]), context)).toThrow(/duplicate/i);
  });

  it('reports every problem at once rather than the first', () => {
    const result = validateTracks(
      track([lesson({ slug: 'Bad Slug', skillTags: [], blocks: [] })]),
      context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.every((error) => error.path.length > 0)).toBe(true);
  });

  it('validates structurally when no registry is supplied', () => {
    // The web mapper has a registry; a unit test editing prose may not.
    const blocks = [{ kind: 'range', heroPosition: 'HJ', actionSequence: 'rfi' }];
    expect(() => parseTracks(track([lesson({ blocks })]))).not.toThrow();
  });

  it('rejects a track that is not an array', () => {
    expect(() => parseTracks({ slug: 'x' }, context)).toThrow(/array/);
  });

  it('rejects a module with no lessons', () => {
    expect(() => parseTracks(track([]), context)).toThrow(/lessons/);
  });
});
