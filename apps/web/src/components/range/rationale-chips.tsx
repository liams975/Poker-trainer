import type { FactorDetail, Rationale, RationaleFactor } from '@poker/engine';

/**
 * A structured rationale, rendered as chips.
 *
 * docs/03-poker-engine.md: "Structured rationale lets the UI render it as
 * chips, highlights, or verbose prose depending on Study vs Drill mode —
 * without engine changes." This is that seam. The engine states facts as
 * `{kind, weight, detail}` and refuses to accept prose; the sentences are
 * written here.
 *
 * Shared by the Range Explorer's detail panel and the drill's feedback panel,
 * so the two cannot drift into describing the same factor differently — the
 * same reason `mix-format.ts` was extracted in Phase 6.
 */
const FACTOR_TITLES: Readonly<Record<string, string>> = {
  position: 'Position',
  hand_class: 'Hand',
  action_sequence: 'Action',
  range_shape: 'Range shape',
  mix: 'Mixed strategy',
  pot_odds: 'Pot odds',
  board_texture: 'Board',
  spr: 'SPR',
};

/** Turns a factor's structured detail into a chip's text. */
export function factorText(detail: FactorDetail): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${value}`)
    .join(' · ');
}

/**
 * Drill Mode shows "the key factor", per docs/05's Study/Drill table — the
 * high-weight ones. If the engine weighted nothing high, showing the first
 * factor beats showing an empty panel and claiming there was no reason.
 */
export function keyFactors(factors: readonly RationaleFactor[]): readonly RationaleFactor[] {
  const high = factors.filter((item) => item.weight === 'high');
  return high.length > 0 ? high : factors.slice(0, 1);
}

export interface RationaleChipsProps {
  rationale: Rationale;
  /** Study Mode shows every factor. Drill Mode shows only the decisive ones. */
  verbose?: boolean;
}

export function RationaleChips({ rationale, verbose = true }: RationaleChipsProps) {
  const factors = verbose ? rationale.factors : keyFactors(rationale.factors);

  if (factors.length === 0) return null;

  return (
    // A grid of labelled factors rather than a row of pills: each is a small
    // table cell — what kind of reason, then the reason — so they read in
    // columns and line up with one another.
    <ul className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2">
      {factors.map((item) => (
        <li
          key={`${item.kind}-${JSON.stringify(item.detail)}`}
          className="flex flex-col gap-1.5 bg-surface px-4 py-3"
        >
          <span className="label-caps text-2xs text-ink-muted">
            {FACTOR_TITLES[item.kind] ?? item.kind}
          </span>
          <span className="text-sm text-ink">{factorText(item.detail)}</span>
        </li>
      ))}
    </ul>
  );
}
