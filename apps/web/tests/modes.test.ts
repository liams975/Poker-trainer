import { describe, expect, it } from 'vitest';

import { MODES } from '../src/components/dashboard/modes';

describe('dashboard modes', () => {
  it('has the six entry points docs/05-ui-ux.md specifies', () => {
    expect(MODES).toHaveLength(6);
  });

  it('gives every mode a unique slug and a same-origin href', () => {
    expect(new Set(MODES.map((m) => m.slug)).size).toBe(MODES.length);

    for (const mode of MODES) {
      expect(mode.href.startsWith('/')).toBe(true);
      expect(mode.href.startsWith('//')).toBe(false);
      expect(mode.title.length).toBeGreaterThan(0);
      expect(mode.description.length).toBeGreaterThan(0);
    }
  });

  /**
   * The card is the only route into the drill runner from the dashboard, so a
   * mode left marked "coming in Phase 7" would hide a shipped feature.
   */
  it('has the shipped modes live', () => {
    for (const slug of [
      'quick-drill',
      'focused-drill',
      'range-explorer',
      'continue-learning',
      // Phase 9.
      'weak-spots',
    ]) {
      const mode = MODES.find((m) => m.slug === slug);
      expect(mode?.availableIn, slug).toBeNull();
    }
  });

  it('still gates the modes that are not built', () => {
    for (const slug of ['session-review']) {
      const mode = MODES.find((m) => m.slug === slug);
      expect(mode?.availableIn, slug).not.toBeNull();
    }
  });

  /**
   * Session Review was marked 9 while docs/02-roadmap.md put session history,
   * the mistake log and accuracy-over-time in Phase 10. Pinning it here rather
   * than leaving "not null" to cover both readings, because a card that says
   * the wrong phase is the same kind of lie as one that says the wrong feature.
   */
  it('dates Session Review to the phase the roadmap gives it', () => {
    expect(MODES.find((m) => m.slug === 'session-review')?.availableIn).toBe(10);
  });

  it('points every unavailable mode at a real roadmap phase', () => {
    for (const mode of MODES) {
      if (mode.availableIn !== null) {
        // docs/02-roadmap.md runs 0-11, and nothing here lands before Phase 6.
        expect(mode.availableIn).toBeGreaterThanOrEqual(6);
        expect(mode.availableIn).toBeLessThanOrEqual(11);
      }
    }
  });
});
