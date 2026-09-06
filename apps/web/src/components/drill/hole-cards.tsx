'use client';

import { CARD_SIZES, CardBack, CardFace, describeCard, type CardSize } from './card-face';

/**
 * Two cards at a seat, with the hand notation under them.
 *
 * The drawing moved to `card-face.tsx` in 12b, when a board and five opponents
 * started needing the same card. What stays here is what is specific to a *pair
 * in somebody's hand*: the notation beneath, and the label that says whose it
 * is.
 *
 * The notation is kept because it is the key everything else in the app is
 * addressed by — the grid cell, the chart, the skill tag.
 */
export function HoleCards({
  hole,
  hand,
  size = 'lg',
  dealKey,
  owner,
}: {
  /** Two cards, or undefined for a seat still holding cards you cannot see. */
  hole: readonly [string, string] | undefined;
  /** Absent while the cards are face down — there is no notation to show. */
  hand?: string | undefined;
  size?: CardSize;
  /**
   * Changing this deals the cards again. Absent means no deal — the cards are
   * simply there, which is what Session Review's replay wants: a hand from
   * three weeks ago is not being dealt to you now.
   */
  dealKey?: string | undefined;
  /**
   * Whose hand this is, for the screen reader. Defaults to hero, because for
   * four phases hero's was the only pair on screen.
   */
  owner?: string | undefined;
}) {
  const scale = CARD_SIZES[size];
  const label = owner === undefined ? 'Your hand' : `${owner}’s hand`;

  return (
    <div className="flex flex-col items-center gap-1">
      {hole === undefined ? (
        // Face down. No `role="img"` and no label: the seat's own text already
        // says whether it is still in, and a per-seat "face-down cards" would
        // be read out six times for no information.
        <div className="flex gap-1" aria-hidden="true">
          <CardBack size={size} index={0} dealKey={dealKey} />
          <CardBack size={size} index={1} dealKey={dealKey} />
        </div>
      ) : (
        <div
          className="flex gap-1.5"
          role="img"
          aria-label={`${label}: ${hole.map(describeCard).join(' and ')}`}
        >
          {hole.map((card, index) => (
            <CardFace key={card} card={card} size={size} index={index} dealKey={dealKey} />
          ))}
        </div>
      )}

      {hand === undefined ? null : (
        <p className={`font-mono ${scale.hand} text-ink-muted`}>{hand}</p>
      )}
    </div>
  );
}
