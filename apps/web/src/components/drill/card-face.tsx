'use client';

import { m } from 'motion/react';

import { cn } from '@/lib/utils';

/**
 * One playing card, face up or face down.
 *
 * Extracted in 12b, when the table stopped showing only hero's two cards: a
 * board has five, opponents hold two each face-down while a hand is live, and a
 * showdown turns some of them over. Four places drawing a card is four places to
 * get the pip set or the size ramp subtly different.
 *
 * Monochrome, deliberately, and this is the rule with the most force behind it
 * in `docs/05-ui-ux.md`: "saturated color is reserved exclusively for strategy
 * data". The traditional red/black suit colouring would spend hue on something
 * that is not strategy, on the same screen as a grid where hue *means* action.
 * The pips are distinguishable by shape alone, so nothing is lost, and the
 * display stays readable under any colour vision deficiency without a second
 * encoding.
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
export function describeCard(card: string): string {
  const rank = card[0] ?? '';
  const suit = card[1] ?? '';
  return `${RANK_NAMES[rank] ?? rank} of ${SUIT_NAMES[suit] ?? suit}`;
}

/**
 * Three sizes, each earned by a place it is used.
 *
 * `lg` is the standalone display. `sm` is what sits at hero's seat, where the
 * card has to read at a glance without swamping the seat it belongs to. `xs` is
 * an opponent's face-down pair, which only has to say "this seat is still in".
 */
export const CARD_SIZES = {
  lg: { card: 'h-24 w-16', rank: 'text-2xl', hand: 'text-sm' },
  md: { card: 'h-14 w-10 @lg:h-16 @lg:w-11', rank: 'text-xl @lg:text-2xl', hand: 'text-sm' },
  sm: { card: 'h-11 w-8 @lg:h-14 @lg:w-10', rank: 'text-base @lg:text-xl', hand: 'text-xs' },
  xs: { card: 'h-6 w-[1.125rem] @lg:h-7 @lg:w-5', rank: 'text-[0.625rem] @lg:text-xs', hand: 'text-[0.625rem]' },
} as const;

export type CardSize = keyof typeof CARD_SIZES;

/**
 * The deal, as motion.
 *
 * The single most satisfying 200ms available in a poker app, and the reason the
 * geometry was worth building in Phase 11: cards arriving *from the dealer* is
 * only legible once there is a table for them to come from.
 *
 * `dealKey` absent means no deal — the card simply is, which is what Session
 * Review's replay wants. A hand from three weeks ago is not being dealt to you
 * now, and animating it as one would say something false about the screen.
 */
function dealMotion(index: number, from: number) {
  return {
    initial: { opacity: 0, y: from, scale: 0.8, rotate: index % 2 === 0 ? -7 : 7 },
    animate: { opacity: 1, y: 0, scale: 1, rotate: 0 },
    transition: {
      duration: 0.3,
      delay: index * 0.07,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  };
}

export function CardFace({
  card,
  size = 'lg',
  index = 0,
  dealKey,
  dealFrom = -24,
  className,
}: {
  card: string;
  size?: CardSize;
  /** Position in its group, for the stagger and the tilt direction. */
  index?: number;
  dealKey?: string | undefined;
  /** Pixels the card travels from, on y. Negative is toward the table centre. */
  dealFrom?: number;
  className?: string;
}) {
  const scale = CARD_SIZES[size];

  return (
    <m.span
      key={dealKey === undefined ? card : `${dealKey}-${card}`}
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius)] border border-line bg-surface-raised font-mono text-ink',
        scale.card,
        className,
      )}
      {...(dealKey === undefined ? {} : dealMotion(index, dealFrom))}
    >
      <span className={`${scale.rank} leading-none`}>{card[0]}</span>
      <span className={`${scale.rank} leading-none`} aria-hidden="true">
        {SUIT_PIPS[card[1] ?? ''] ?? card[1]}
      </span>
    </m.span>
  );
}

/**
 * A card somebody is holding that you cannot see.
 *
 * Drawn as a surface rather than a patterned back — a casino card back is
 * exactly the kind of ornament `docs/05` rules out, and the only job here is to
 * say "this seat is still in the hand". Always `aria-hidden`: the seat's own
 * text already reports its status, and "face-down card, face-down card" at every
 * seat is noise rather than information.
 */
export function CardBack({
  size = 'xs',
  index = 0,
  dealKey,
  dealFrom = -24,
}: {
  size?: CardSize;
  index?: number;
  dealKey?: string | undefined;
  dealFrom?: number;
}) {
  return (
    <m.span
      key={dealKey === undefined ? `back-${index}` : `${dealKey}-back-${index}`}
      aria-hidden="true"
      className={cn(
        'block rounded-[var(--radius)] border border-line bg-surface',
        CARD_SIZES[size].card,
      )}
      {...(dealKey === undefined ? {} : dealMotion(index, dealFrom))}
    />
  );
}
