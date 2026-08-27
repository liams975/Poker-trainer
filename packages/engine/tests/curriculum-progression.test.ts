import { describe, expect, it } from 'vitest';

import type { ProgressRow, Track } from '../src/curriculum';
import { lessonStates, nextLesson, trackProgress } from '../src/curriculum';

/**
 * The unlock rule, as data.
 *
 * It lives in the engine rather than in a page because three screens read it —
 * the track rail, the lesson view, and the dashboard's Continue Learning card —
 * and a rule re-derived three times is a rule that will disagree with itself.
 *
 * Placement is honoured *here* rather than by writing `completed` rows for
 * lessons nobody opened. `lesson_progress` stays a truthful record of what the
 * user actually did, and "why is this unlocked" has one answer.
 */

function lesson(slug: string, sortOrder: number, skillTags: readonly string[]) {
  return {
    slug,
    title: slug,
    summary: 'x',
    sortOrder,
    version: '1',
    skillTags,
    blocks: [{ kind: 'prose' as const, text: 'x' }],
  };
}

const TRACK: Track = {
  slug: 'preflop-fundamentals',
  title: 'Preflop fundamentals',
  sortOrder: 0,
  published: true,
  modules: [
    {
      slug: 'position',
      title: 'Position',
      sortOrder: 0,
      lessons: [
        lesson('why-position-pays', 0, ['concept.position']),
        lesson('opening-utg', 1, ['preflop.rfi.utg']),
        lesson('opening-btn', 2, ['preflop.rfi.btn']),
      ],
    },
    {
      slug: 'blind-defence',
      title: 'Big blind defence',
      sortOrder: 1,
      lessons: [
        lesson('pot-odds', 0, ['concept.pot_odds']),
        lesson('defending-vs-btn', 1, ['preflop.blind_defense.bb_vs_btn']),
      ],
    },
  ],
};

const ORDER = [
  'why-position-pays',
  'opening-utg',
  'opening-btn',
  'pot-odds',
  'defending-vs-btn',
];

function states(progress: readonly ProgressRow[], placementSkillTag?: string | null) {
  return lessonStates({ track: TRACK, progress, placementSkillTag });
}

describe('lessonStates', () => {
  it('opens only the first lesson to a brand-new account', () => {
    const map = states([]);

    expect(map.get('why-position-pays')).toBe('available');
    expect(map.get('opening-utg')).toBe('locked');
    expect(map.get('defending-vs-btn')).toBe('locked');
  });

  it('covers every lesson in the track', () => {
    expect([...states([]).keys()].sort()).toEqual([...ORDER].sort());
  });

  /** The exit criterion: finishing one opens the next, and only the next. */
  it('unlocks exactly the next lesson when one is completed', () => {
    const map = states([{ lessonSlug: 'why-position-pays', status: 'completed' }]);

    expect(map.get('why-position-pays')).toBe('completed');
    expect(map.get('opening-utg')).toBe('available');
    expect(map.get('opening-btn')).toBe('locked');
  });

  it('carries on across a module boundary', () => {
    const map = states([
      { lessonSlug: 'why-position-pays', status: 'completed' },
      { lessonSlug: 'opening-utg', status: 'completed' },
      { lessonSlug: 'opening-btn', status: 'completed' },
    ]);

    expect(map.get('pot-odds')).toBe('available');
    expect(map.get('defending-vs-btn')).toBe('locked');
  });

  it('keeps an unlocked lesson open to revisit', () => {
    const map = states([
      { lessonSlug: 'why-position-pays', status: 'completed' },
      { lessonSlug: 'opening-utg', status: 'completed' },
    ]);

    // Not re-locked just because you moved past it.
    expect(map.get('why-position-pays')).toBe('completed');
    expect(map.get('opening-utg')).toBe('completed');
  });

  it('reports a started lesson as in progress', () => {
    const map = states([{ lessonSlug: 'why-position-pays', status: 'in_progress' }]);
    expect(map.get('why-position-pays')).toBe('in_progress');
  });

  it('does not re-lock a lesson completed out of order', () => {
    const map = states([{ lessonSlug: 'opening-btn', status: 'completed' }]);

    expect(map.get('why-position-pays')).toBe('available');
    expect(map.get('opening-utg')).toBe('available');
    expect(map.get('pot-odds')).toBe('available');
  });

  it('ignores progress rows for lessons the track no longer has', () => {
    const map = states([{ lessonSlug: 'retired-lesson', status: 'completed' }]);
    expect(map.get('opening-utg')).toBe('locked');
  });
});

describe('placement', () => {
  /** "Routes a strong player past basics" — the second half of the exit criterion. */
  it('opens everything up to the lesson teaching the placed tag', () => {
    const map = states([], 'preflop.blind_defense.bb_vs_btn');

    expect(map.get('why-position-pays')).toBe('available');
    expect(map.get('opening-utg')).toBe('available');
    expect(map.get('opening-btn')).toBe('available');
    expect(map.get('pot-odds')).toBe('available');
    expect(map.get('defending-vs-btn')).toBe('available');
  });

  it('stops at the placed lesson rather than opening the whole track', () => {
    const map = states([], 'preflop.rfi.btn');

    expect(map.get('opening-btn')).toBe('available');
    expect(map.get('pot-odds')).toBe('locked');
  });

  it('marks nothing as completed — placement is not a claim about what you read', () => {
    const map = states([], 'preflop.rfi.btn');
    expect([...map.values()].every((status) => status !== 'completed')).toBe(true);
  });

  it('falls back to the first lesson when the tag matches nothing', () => {
    const map = states([], 'concept.blockers');

    expect(map.get('why-position-pays')).toBe('available');
    expect(map.get('opening-utg')).toBe('locked');
  });

  it('never walks a placed user backwards from what they have completed', () => {
    const map = states(
      [
        { lessonSlug: 'why-position-pays', status: 'completed' },
        { lessonSlug: 'opening-utg', status: 'completed' },
        { lessonSlug: 'opening-btn', status: 'completed' },
        { lessonSlug: 'pot-odds', status: 'completed' },
      ],
      // A later, weaker placement must not re-lock what they finished.
      'concept.position',
    );

    expect(map.get('defending-vs-btn')).toBe('available');
  });

  it('treats a null placement as no placement', () => {
    expect(states([], null).get('opening-utg')).toBe('locked');
  });
});

describe('nextLesson', () => {
  it('is the first lesson for a new account', () => {
    expect(nextLesson({ track: TRACK, progress: [] })?.slug).toBe('why-position-pays');
  });

  it('skips what is already completed', () => {
    const next = nextLesson({
      track: TRACK,
      progress: [
        { lessonSlug: 'why-position-pays', status: 'completed' },
        { lessonSlug: 'opening-utg', status: 'completed' },
      ],
    });

    expect(next?.slug).toBe('opening-btn');
  });

  it('resumes an in-progress lesson rather than moving past it', () => {
    const next = nextLesson({
      track: TRACK,
      progress: [
        { lessonSlug: 'why-position-pays', status: 'completed' },
        { lessonSlug: 'opening-utg', status: 'in_progress' },
      ],
    });

    expect(next?.slug).toBe('opening-utg');
  });

  it('is undefined once the track is finished', () => {
    const progress = ORDER.map((lessonSlug) => ({ lessonSlug, status: 'completed' as const }));
    expect(nextLesson({ track: TRACK, progress })).toBeUndefined();
  });

  it('starts a placed user at the lesson they were placed into', () => {
    const next = nextLesson({
      track: TRACK,
      progress: [],
      placementSkillTag: 'preflop.blind_defense.bb_vs_btn',
    });

    expect(next?.slug).toBe('defending-vs-btn');
  });
});

describe('trackProgress', () => {
  it('counts completed against the whole track', () => {
    const summary = trackProgress({
      track: TRACK,
      progress: [
        { lessonSlug: 'why-position-pays', status: 'completed' },
        { lessonSlug: 'opening-utg', status: 'in_progress' },
      ],
    });

    expect(summary.total).toBe(5);
    expect(summary.completed).toBe(1);
    expect(summary.next?.slug).toBe('opening-utg');
  });

  it('reports a finished track with no next lesson', () => {
    const progress = ORDER.map((lessonSlug) => ({ lessonSlug, status: 'completed' as const }));
    const summary = trackProgress({ track: TRACK, progress });

    expect(summary.completed).toBe(5);
    expect(summary.next).toBeUndefined();
  });
});
