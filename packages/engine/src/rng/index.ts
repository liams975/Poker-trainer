/**
 * Seeded, injectable randomness.
 *
 * Everything random in the engine goes through here (docs/03-poker-engine.md).
 * Bare `Math.random()` is banned package-wide by the `engine/seeded-rng` ESLint
 * rule — tests included, because an irreproducible test failure is worse than
 * no test.
 *
 * What determinism buys: a drill can be replayed exactly from its stored seed,
 * a shared spot resolves to the same spot for both people, and equity results
 * are stable across runs.
 */

export interface Rng {
  /** Uniform in [0, 2^32). The primitive; the others derive from it. */
  nextUint32(): number;
  /** Uniform in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [0, maxExclusive). Unbiased. */
  nextInt(maxExclusive: number): number;
}

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Builds an `Rng` over any uint32 source. Exported so that tests can drive the
 * derived operations from a controlled sequence — the rejection branch in
 * `nextInt` is unobservable statistically and can only be proven this way.
 */
export function rngFrom(nextUint32: () => number): Rng {
  return {
    nextUint32,

    nextFloat(): number {
      return nextUint32() / UINT32_RANGE;
    },

    nextInt(maxExclusive: number): number {
      if (
        !Number.isInteger(maxExclusive) ||
        maxExclusive < 1 ||
        maxExclusive > UINT32_RANGE
      ) {
        throw new RangeError(
          `nextInt bound must be an integer in [1, 2^32], got ${maxExclusive}`,
        );
      }

      // Rejection sampling. A bare `% maxExclusive` over-represents the low
      // residues whenever the bound does not divide 2^32. The resulting bias is
      // invisible — no test fails, cards are simply dealt slightly wrong and
      // every equity number is quietly off.
      const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
      let x = nextUint32();
      while (x >= limit) x = nextUint32();
      return x % maxExclusive;
    },
  };
}

/**
 * mulberry32. Small, fast, and adequate for drill spots and Monte Carlo
 * sampling — this is not a CSPRNG and nothing here needs one.
 */
export function mulberry32(seed: number): Rng {
  // Validated rather than coerced. `seed >>> 0` would silently fold NaN to 0,
  // truncate 5.9 to 5, and alias -1 onto 4294967295 — three distinct seeds
  // replaying as one. From Phase 3 every drill_attempt stores its seed and
  // regenerates the spot from it (docs/03-poker-engine.md), so a seed that
  // round-trips badly through JSON or Postgres must fail loudly here instead of
  // replaying a different but entirely plausible-looking spot.
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    throw new RangeError(`seed must be an integer in [0, 2^32), got ${seed}`);
  }

  let a = seed;

  return rngFrom((): number => {
    // The published version accumulates into an unbounded float. Past roughly
    // 5M draws that exceeds 2^53 and starts losing integer precision, which the
    // exhaustive evaluator run would hit. Truncating to uint32 each step is
    // equivalent modulo 2^32 — all the bitwise operations below observe — and
    // stays exact forever. tests/rng.test.ts pins the two forms together.
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  });
}

/** Fisher-Yates. Returns a new array; the input is not mutated. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();

  for (let i = out.length - 1; i > 0; i--) {
    // j is drawn from [0, i], not [0, length). Drawing from the full range on
    // every step is the classic bug that makes some permutations unreachable.
    const j = rng.nextInt(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }

  return out;
}
