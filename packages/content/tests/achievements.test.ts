import { orderedLessons, parseAchievements } from '@poker/engine';
import { describe, expect, it } from 'vitest';

import { loadAchievements, rawAchievements } from '../src/achievements';
import { loadTracks } from '../src/lessons';

/**
 * An achievement nobody can ever earn is invisible.
 *
 * It syncs without complaint, sits in the table, and simply never unlocks —
 * no error, no empty box on a page, nothing to notice. The engine's validator
 * catches a criteria *shape* it cannot evaluate; what it cannot see is a
 * threshold that is unreachable given the content that actually shipped. That
 * is what this file is for.
 */

const achievements = () => loadAchievements();

describe('the seeded achievements', () => {
  it('validates against the engine criteria vocabulary', () => {
    const result = parseAchievements(rawAchievements);

    if (!result.ok) {
      throw new Error(
        `achievements are invalid:\n${result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it('covers every kind, so no evaluator branch ships untested by content', () => {
    const kinds = new Set(achievements().map((entry) => entry.criteria.kind));
    expect([...kinds].sort()).toEqual(['lessons', 'mastery', 'spots', 'streak']);
  });

  /**
   * The check the shape validator cannot make.
   *
   * A `lessons` threshold above the number of lessons the track actually holds
   * is permanently unearnable, and nothing anywhere would say so. This is the
   * same argument as Phase 8's chart-figure check: content validated against
   * the other content it makes claims about.
   */
  it('never asks for more lessons than the track contains', () => {
    const total = loadTracks().reduce((sum, track) => sum + orderedLessons(track).length, 0);

    for (const entry of achievements()) {
      if (entry.criteria.kind !== 'lessons') continue;
      expect(
        entry.criteria.count,
        `${entry.id} needs ${entry.criteria.count} lessons and the track has ${total}`,
      ).toBeLessThanOrEqual(total);
    }
  });

  it('has a lessons achievement that lands exactly on the whole track', () => {
    const total = loadTracks().reduce((sum, track) => sum + orderedLessons(track).length, 0);
    const counts = achievements()
      .filter((entry) => entry.criteria.kind === 'lessons')
      .map((entry) => (entry.criteria.kind === 'lessons' ? entry.criteria.count : 0));

    // Finishing the course must be worth something, and "something" has to be
    // the real length rather than a number that was true when it was written.
    expect(counts).toContain(total);
  });

  it('has a lessons achievement matching the first module exactly', () => {
    const first = loadTracks()[0]?.modules[0];
    expect(first, 'the track has at least one module').toBeDefined();

    const counts = achievements()
      .filter((entry) => entry.criteria.kind === 'lessons')
      .map((entry) => (entry.criteria.kind === 'lessons' ? entry.criteria.count : 0));

    expect(counts).toContain(first!.lessons.length);
  });

  it('sets thresholds that climb within each kind', () => {
    const byKind = new Map<string, number[]>();

    for (const entry of achievements()) {
      const threshold =
        entry.criteria.kind === 'streak'
          ? entry.criteria.days
          : entry.criteria.kind === 'mastery'
            ? entry.criteria.minAttempts
            : entry.criteria.count;

      byKind.set(entry.criteria.kind, [...(byKind.get(entry.criteria.kind) ?? []), threshold]);
    }

    for (const [kind, thresholds] of byKind) {
      // Two achievements at the same bar unlock together and read as a bug.
      expect(new Set(thresholds).size, `${kind} has a repeated threshold`).toBe(thresholds.length);
    }
  });

  it('starts each ladder somewhere a real beginner reaches', () => {
    const lowest = (kind: string): number =>
      Math.min(
        ...achievements()
          .filter((entry) => entry.criteria.kind === kind)
          .map((entry) =>
            entry.criteria.kind === 'streak'
              ? entry.criteria.days
              : entry.criteria.kind === 'lessons' || entry.criteria.kind === 'spots'
                ? entry.criteria.count
                : Number.POSITIVE_INFINITY,
          ),
      );

    // A first badge nobody sees in their first week is a first badge nobody
    // sees. docs/05: moderate depth, and the tone of a coach, not a grind.
    expect(lowest('lessons')).toBe(1);
    expect(lowest('streak')).toBeLessThanOrEqual(3);
    expect(lowest('spots')).toBeLessThanOrEqual(100);
  });

  it('gives every achievement its own title and description', () => {
    const titles = achievements().map((entry) => entry.title);
    const descriptions = achievements().map((entry) => entry.description);

    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('describes what to do, not merely that it happened', () => {
    for (const entry of achievements()) {
      // The description is the only place the criteria is stated in words. A
      // one-word blurb leaves a locked badge unexplained, which is the state
      // most of them are in most of the time.
      expect(entry.description.length, entry.id).toBeGreaterThan(15);
      expect(entry.description.trim().endsWith('.'), `${entry.id} reads as a sentence`).toBe(true);
    }
  });
});
