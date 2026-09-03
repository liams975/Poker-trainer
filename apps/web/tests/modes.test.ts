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
  /**
   * Phase 10 is the last one, and Session Review was the last card still
   * marked "not yet". Every mode docs/05-ui-ux.md specifies is now built.
   *
   * Asserted over the whole list rather than a named subset: a seventh mode
   * added later must either be live or carry a real phase number, and the
   * next test is what enforces the second half of that.
   */
  it('has every mode live, which is what finishing the roadmap means', () => {
    for (const mode of MODES) {
      expect(mode.availableIn, mode.slug).toBeNull();
    }
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
