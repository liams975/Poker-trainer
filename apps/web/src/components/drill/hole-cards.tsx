'use client';

import { m } from 'motion/react';

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

/**
 * Two sizes, because the cards moved onto the table.
 *
 * `sm` is what sits at hero's seat, where the card has to read at a glance
 * without swamping the seat it belongs to. `lg` is the standalone display.
 */
const SIZES = {
  lg: { card: 'h-24 w-16', rank: 'text-2xl', hand: 'text-sm' },
  sm: { card: 'h-11 w-8 @lg:h-14 @lg:w-10', rank: 'text-base @lg:text-xl', hand: 'text-xs' },
} as const;

export function HoleCards({
  hole,
  hand,
  size = 'lg',
  dealKey,
}: {
  hole: readonly [string, string];
  hand: string;
  size?: keyof typeof SIZES;
  /**
   * Changing this deals the cards again. Absent means no deal — the cards are
   * simply there, which is what Session Review's replay wants: a hand from
   * three weeks ago is not being dealt to you now.
   */
  dealKey?: string | undefined;
}) {
  const scale = SIZES[size];

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex gap-1.5"
        role="img"
        aria-label={`Your hand: ${hole.map(describeCard).join(' and ')}`}
      >
        {hole.map((card, index) => (
          /**
           * Dealt, one then the other, from the middle of the table.
           *
           * The single most satisfying 200ms available in a poker app, and the
           * reason the geometry was worth building: cards arriving *from the
           * dealer* is only legible once there is a table for them to come
           * from. `-24` on y is toward the centre, because hero sits at the
           * bottom of the ring.
           */
          <m.span
            key={dealKey === undefined ? card : `${dealKey}-${card}`}
            className={`flex ${scale.card} flex-col items-center justify-center rounded-[var(--radius)] border border-line bg-surface-raised font-mono text-ink`}
            {...(dealKey === undefined
              ? {}
              : {
                  initial: { opacity: 0, y: -24, scale: 0.8, rotate: index === 0 ? -7 : 7 },
                  animate: { opacity: 1, y: 0, scale: 1, rotate: 0 },
                  transition: {
                    duration: 0.3,
                    delay: index * 0.07,
                    ease: [0.22, 1, 0.36, 1] as const,
                  },
                })}
          >
            <span className={`${scale.rank} leading-none`}>{card[0]}</span>
            <span className={`${scale.rank} leading-none`} aria-hidden="true">
              {SUIT_PIPS[card[1] ?? ''] ?? card[1]}
            </span>
          </m.span>
        ))}
      </div>

      {/* The canonical notation, because it is the key everything else in the
          app is addressed by — the grid cell, the chart, the skill tag. */}
      <p className={`font-mono ${scale.hand} text-ink-muted`}>{hand}</p>
    </div>
  );
}
