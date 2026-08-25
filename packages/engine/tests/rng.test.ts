import { describe, expect, it } from 'vitest';

import { mulberry32, rngFrom, shuffle } from '../src/rng';

/**
 * docs/03-poker-engine.md, test plan: "Same seed → same sequence. Distribution
 * sanity."
 *
 * Determinism is not a nicety here. It is what makes a drill replayable from
 * its stored seed, what makes a shared spot resolve to the same spot for both
 * people, and what keeps every other engine test from being flaky.
 */

/**
 * The published mulberry32, verbatim, as an independent oracle.
 *
 * `src/rng` deliberately does NOT use this form: its accumulator `a` is an
 * unbounded float, and past ~5M draws it exceeds 2^53 and starts losing
 * integer precision. Ours truncates to uint32 each step. That refactor is only
 * safe if it is bit-identical below the precision cliff — which is exactly what
 * this oracle checks. Drawing well under 5M keeps the oracle itself valid.
 */
function publishedMulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('mulberry32', () => {
  it('matches the published algorithm draw for draw', () => {
    const ours = mulberry32(12345);
    const reference = publishedMulberry32(12345);

    for (let i = 0; i < 100_000; i++) {
      expect(ours.nextFloat()).toBe(reference());
    }
  });

  it('produces the same sequence from the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);

    const first = Array.from({ length: 1000 }, () => a.nextUint32());
    const second = Array.from({ length: 1000 }, () => b.nextUint32());

    expect(first).toEqual(second);
  });

  it('produces different sequences from different seeds', () => {
    const a = Array.from({ length: 100 }, (_v, i) => mulberry32(i).nextUint32());

    expect(new Set(a).size).toBe(a.length);
  });

  it('keeps its state exact across millions of draws', () => {
    // The whole reason for the uint32 accumulator. With the published float
    // accumulator this run passes 2^53 and the stream silently degrades.
    const rng = mulberry32(7);

    for (let i = 0; i < 6_000_000; i++) {
      const x = rng.nextUint32();
      if (!Number.isInteger(x) || x < 0 || x >= 0x1_0000_0000) {
        throw new Error(`draw ${i} left uint32 range: ${x}`);
      }
    }

    // And it is still reproducible at that depth.
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 6_000_000; i++) a.nextUint32();
    for (let i = 0; i < 6_000_000; i++) b.nextUint32();

    expect(a.nextUint32()).toBe(b.nextUint32());
  }, 60_000);

  it.each([1.5, -1, Number.NaN, Infinity, 2 ** 32, 2 ** 32 + 5])(
    'rejects a seed of %s',
    (seed) => {
      // Coercing instead of rejecting would make these collide with valid
      // seeds, and from Phase 3 a stored seed is what replays a drill spot.
      expect(() => mulberry32(seed)).toThrow(RangeError);
    },
  );

  it('accepts the whole uint32 range', () => {
    expect(() => mulberry32(0)).not.toThrow();
    expect(() => mulberry32(0xffff_ffff)).not.toThrow();
  });

  it('emits uint32 values, not floats or negatives', () => {
    const rng = mulberry32(99);

    for (let i = 0; i < 10_000; i++) {
      const x = rng.nextUint32();
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(0x1_0000_0000);
    }
  });

  it('emits floats in [0, 1)', () => {
    const rng = mulberry32(3);

    for (let i = 0; i < 10_000; i++) {
      const x = rng.nextFloat();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('nextInt', () => {
  it('stays within [0, maxExclusive)', () => {
    const rng = mulberry32(5);

    for (const bound of [1, 2, 3, 7, 52, 1326]) {
      for (let i = 0; i < 5_000; i++) {
        const x = rng.nextInt(bound);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(bound);
      }
    }
  });

  it('always returns 0 for a bound of 1', () => {
    const rng = mulberry32(5);

    for (let i = 0; i < 100; i++) expect(rng.nextInt(1)).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, 0x1_0000_0001])('rejects a bound of %s', (bound) => {
    expect(() => mulberry32(5).nextInt(bound)).toThrow(RangeError);
  });

  // Rejection sampling, observed directly. A statistical test cannot see this:
  // at a 2^32 source the modulo bias for small bounds is ~1e-9, so a biased
  // implementation passes any feasible uniformity check. Feeding the source by
  // hand is the only way to prove the rejection branch exists.
  it('rejects source values in the biased tail rather than folding them in', () => {
    const bound = 3;
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound); // 4294967295

    // The first two draws are inside the biased tail and must be discarded;
    // only the third should reach the caller.
    const source = [limit, limit + 1, 7];
    let i = 0;
    const rng = rngFrom(() => source[i++]!);

    expect(rng.nextInt(bound)).toBe(7 % bound);
    expect(i).toBe(3);
  });

  it('is close to uniform', () => {
    const rng = mulberry32(2024);
    const bound = 3; // does not divide 2^32
    const draws = 300_000;
    const counts = [0, 0, 0];

    for (let i = 0; i < draws; i++) counts[rng.nextInt(bound)]! += 1;

    const expected = draws / bound;
    for (const count of counts) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.02);
    }
  });
});

describe('shuffle', () => {
  const source = Array.from({ length: 52 }, (_v, i) => i);

  it('returns a permutation, not a resampling', () => {
    const shuffled = shuffle(mulberry32(1), source);

    expect(shuffled).toHaveLength(source.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
  });

  it('does not mutate its input', () => {
    const input = [...source];
    shuffle(mulberry32(1), input);

    expect(input).toEqual(source);
  });

  it('is deterministic under seed', () => {
    expect(shuffle(mulberry32(77), source)).toEqual(shuffle(mulberry32(77), source));
  });

  it('actually reorders', () => {
    expect(shuffle(mulberry32(77), source)).not.toEqual(source);
  });

  it('handles empty and single-element inputs', () => {
    expect(shuffle(mulberry32(1), [])).toEqual([]);
    expect(shuffle(mulberry32(1), ['x'])).toEqual(['x']);
  });

  // Fisher-Yates is easy to write in a form that cannot produce some
  // permutations (the classic bug: sampling j from the full range each step).
  // With 3 elements all 6 orderings must appear, and at roughly equal rates.
  it('reaches every permutation of a 3-element input at equal rates', () => {
    const rng = mulberry32(31337);
    const seen = new Map<string, number>();
    const trials = 60_000;

    for (let i = 0; i < trials; i++) {
      const key = shuffle(rng, ['a', 'b', 'c']).join('');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    expect(seen.size).toBe(6);
    for (const count of seen.values()) {
      expect(Math.abs(count - trials / 6) / (trials / 6)).toBeLessThan(0.05);
    }
  });
});
