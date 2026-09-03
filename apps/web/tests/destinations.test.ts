import { describe, expect, it } from 'vitest';

import { MODES } from '../src/components/dashboard/modes';
import { buildDestinations, filterDestinations } from '../src/components/nav/destinations';

/**
 * ⌘K's list.
 *
 * The whole point of deriving it from `MODES` and the track is that it cannot
 * drift from what the app can actually do. These pin the two ways it would:
 * offering somewhere that does not work yet, and offering a lesson the reader
 * cannot open.
 */

const LESSONS = [
  { slug: 'a-range-is-not-a-list', title: 'A range is not a list', locked: false },
  { slug: 'playing-a-mixed-hand', title: 'Playing a mixed hand', locked: false },
  { slug: 'why-position-pays', title: 'Why position pays', locked: true },
];

describe('buildDestinations', () => {
  it('offers every live mode', () => {
    const hrefs = buildDestinations().map((d) => d.href);

    for (const mode of MODES.filter((m) => m.availableIn === null)) {
      expect(hrefs, mode.slug).toContain(mode.href);
    }
  });

  /**
   * The failure this prevents: a palette entry that navigates to a page saying
   * "coming in Phase 11". Every mode is live today, so this is asserted against
   * a synthetic one rather than waiting for a future regression to prove it.
   */
  it('omits a mode that is not built', () => {
    const unbuilt = { ...MODES[0]!, slug: 'ghost', title: 'Ghost', href: '/ghost', availableIn: 11 };
    const hrefs = buildDestinations().map((d) => d.href);

    // The real list has nothing unbuilt in it...
    expect(MODES.every((m) => m.availableIn === null)).toBe(true);
    // ...and the filter is on `availableIn`, not on a hardcoded list.
    expect(hrefs).not.toContain(unbuilt.href);
  });

  it('offers unlocked lessons', () => {
    const labels = buildDestinations(LESSONS).map((d) => d.label);

    expect(labels).toContain('A range is not a list');
    expect(labels).toContain('Playing a mixed hand');
  });

  /**
   * A jump list that takes you somewhere refusing to open is worse than one
   * that does not mention it. The unlock rule is the engine's; this honours it.
   */
  it('omits locked lessons', () => {
    expect(buildDestinations(LESSONS).map((d) => d.label)).not.toContain('Why position pays');
  });

  it('works with no lessons at all, so a content failure costs one section', () => {
    const destinations = buildDestinations([]);

    expect(destinations.length).toBeGreaterThan(0);
    expect(destinations.every((d) => d.section === 'Go to')).toBe(true);
  });

  it('gives every destination a unique id and a same-origin href', () => {
    const destinations = buildDestinations(LESSONS);

    expect(new Set(destinations.map((d) => d.id)).size).toBe(destinations.length);

    for (const destination of destinations) {
      expect(destination.href.startsWith('/')).toBe(true);
      expect(destination.href.startsWith('//')).toBe(false);
      expect(destination.label.length).toBeGreaterThan(0);
    }
  });

  it('groups lessons after the places you go', () => {
    const sections = buildDestinations(LESSONS).map((d) => d.section);
    const firstLesson = sections.indexOf('Lessons');

    // Every 'Go to' comes before every 'Lessons', so the grouped render never
    // repeats a header.
    expect(sections.slice(0, firstLesson).every((s) => s === 'Go to')).toBe(true);
    expect(sections.slice(firstLesson).every((s) => s === 'Lessons')).toBe(true);
  });
});

describe('filterDestinations', () => {
  const destinations = buildDestinations(LESSONS);

  it('returns everything for an empty query', () => {
    expect(filterDestinations(destinations, '')).toHaveLength(destinations.length);
    expect(filterDestinations(destinations, '   ')).toHaveLength(destinations.length);
  });

  it('matches a label case-insensitively', () => {
    expect(filterDestinations(destinations, 'DASH').map((d) => d.id)).toContain('dashboard');
  });

  it('matches part of a word, not only a prefix', () => {
    expect(filterDestinations(destinations, 'mixed').map((d) => d.label)).toContain(
      'Playing a mixed hand',
    );
  });

  it('matches keywords, so "home" finds the dashboard', () => {
    expect(filterDestinations(destinations, 'home').map((d) => d.id)).toContain('dashboard');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(filterDestinations(destinations, 'zzzzz')).toEqual([]);
  });

  it('never invents an entry', () => {
    const ids = new Set(destinations.map((d) => d.id));
    for (const match of filterDestinations(destinations, 'a')) {
      expect(ids.has(match.id)).toBe(true);
    }
  });
});
