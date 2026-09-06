'use client';

import { CardFace, describeCard } from './card-face';

/**
 * The community cards, in the middle of the felt.
 *
 * **Revealed by street, not by array length.** The engine's `advanceHand`
 * records why this matters: when everyone is all-in, `applyAction` walks the
 * streets out on its own and the board arrives as five cards at once. Rendering
 * `state.board` directly would flash a whole runout in a single frame, at the
 * one moment in poker where the cards coming one at a time is the entire point.
 *
 * So the caller says how many are face up and this draws those, and the rest
 * follow as it counts up. `board[0..2]` is still the flop and `board[3]` still
 * the turn either way — same deck, same order — so slicing is safe.
 */

export function BoardCards({
  board,
  shown,
  dealKey,
}: {
  board: readonly string[];
  /** How many to reveal. Defaults to all of them. */
  shown?: number;
  dealKey?: string | undefined;
}) {
  const visible = board.slice(0, Math.max(0, Math.min(shown ?? board.length, board.length)));

  if (visible.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Board: ${visible.map(describeCard).join(', ')}`}
      data-testid="board"
    >
      {visible.map((card, index) => (
        <CardFace
          key={card}
          card={card}
          size="xs"
          index={index}
          dealKey={dealKey}
          // Board cards arrive from the middle of the table outward rather than
          // falling in from above: they are already at the dealer's position.
          dealFrom={0}
          className="@md:h-9 @md:w-[1.625rem]"
        />
      ))}
    </div>
  );
}
