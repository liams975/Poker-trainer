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
