/**
 * Hero's two cards.
 *
 * Monochrome, deliberately. docs/05-ui-ux.md's governing rule is that
 * "saturated color is reserved exclusively for strategy data" — the traditional
 * red/black suit colouring would spend hue on something that is not strategy,
 * right next to a grid where hue means action. The suit pips are distinguishable
 * by shape alone, so nothing is lost, and the display stays readable under any
 * colour vision deficiency without a second encoding.
 */
const SUIT_PIPS: Readonly<Record<string, string>> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

const SUIT_NAMES: Readonly<Record<string, string>> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

const RANK_NAMES: Readonly<Record<string, string>> = {
  A: 'ace',
  K: 'king',
  Q: 'queen',
  J: 'jack',
  T: 'ten',
};

/** `As` -> "ace of spades", `7d` -> "7 of diamonds". */
function describeCard(card: string): string {
  const rank = card[0] ?? '';
  const suit = card[1] ?? '';
  return `${RANK_NAMES[rank] ?? rank} of ${SUIT_NAMES[suit] ?? suit}`;
}

export function HoleCards({ hole, hand }: { hole: readonly [string, string]; hand: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex gap-2"
        role="img"
        aria-label={`Your hand: ${hole.map(describeCard).join(' and ')}`}
      >
        {hole.map((card) => (
          <span
            key={card}
            className="flex h-24 w-16 flex-col items-center justify-center rounded-[var(--radius)] border border-line bg-surface-raised font-mono text-ink"
          >
            <span className="text-2xl leading-none">{card[0]}</span>
            <span className="text-2xl leading-none" aria-hidden="true">
              {SUIT_PIPS[card[1] ?? ''] ?? card[1]}
            </span>
          </span>
        ))}
      </div>

      {/* The canonical notation, because it is the key everything else in the
          app is addressed by — the grid cell, the chart, the skill tag. */}
      <p className="font-mono text-sm text-ink-muted">{hand}</p>
    </div>
  );
}
