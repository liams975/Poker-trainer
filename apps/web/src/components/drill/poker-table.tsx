'use client';

import type { HandState, Position, SeatView } from '@poker/engine';
import { potSize, seatRing } from '@poker/engine';
import { m } from 'motion/react';

import { cn } from '@/lib/utils';

import { HoleCards } from './hole-cards';

/**
 * The spot, as a table.
 *
 * This replaced a horizontal strip of six boxes, and the reason is the one
 * thing the strip could not express: **position is geometry.** "You are on the
 * button" means the blinds are to your left and act after you — a fact you read
 * off a ring at a glance and can only reconstruct from a strip by remembering
 * the order. Preflop poker is almost entirely about that fact.
 *
 * docs/05-ui-ux.md opens with "a lab, not a casino" and the earlier version of
 * this file cited it as grounds for refusing a table shape at all. That went
 * one step too far. What the thesis protects is the palette rule — *saturated
 * colour is reserved exclusively for strategy data* — and the range grid's five
 * hues only read as data because nothing else on screen competes with them.
 * **So this is a table in geometry and monochrome in colour.** No felt green,
 * no gold, no action hues, and no accent either: amber is the streak and XP
 * rail and nothing else.
 *
 * Every seat's action is rendered in words at the seat. That is both what makes
 * it readable and what makes it accessible — there is no separate description
 * for a screen reader, because the visible text already is one.
 */

/** Where hero sits, in degrees. 90° is the bottom of the screen: y grows down. */
const HERO_ANGLE = 90;

/**
 * Seat centres, as a share of the box.
 *
 * Deliberately *outside* the felt below, so each seat straddles its edge the
 * way a player sits at a table rather than floating in the middle of it. The
 * first version put the seats inside the rail, which hid the top and bottom of
 * the ellipse behind two boxes and left the thing looking like a pair of
 * parentheses rather than a table.
 */
const SEAT_RADIUS = { x: 41, y: 37 };

/** Chips sit inside the felt, between their seat and the pot, on the same angle. */
const CHIP_RADIUS = { x: 26, y: 20 };

function angleOf(ringIndex: number, count: number): number {
  return ((HERO_ANGLE + (ringIndex * 360) / count) * Math.PI) / 180;
}

function polar(ringIndex: number, count: number, radius: { x: number; y: number }) {
  const angle = angleOf(ringIndex, count);

  return {
    left: `${50 + radius.x * Math.cos(angle)}%`,
    top: `${50 + radius.y * Math.sin(angle)}%`,
  };
}

/**
 * How far a chip starts from where it lands, in pixels, pointing back at the
 * seat that put it in.
 *
 * So a chip travels *from its owner toward the pot* rather than simply
 * appearing. Which chips move and how far is a fact about the hand, so the
 * direction is derived from the same angle the layout uses rather than picked.
 */
function chipOrigin(ringIndex: number, count: number) {
  const angle = angleOf(ringIndex, count);
  return { x: Math.cos(angle) * 26, y: Math.sin(angle) * 20 };
}

/**
 * What a seat has done, in words.
 *
 * Deliberately a sentence fragment rather than a number. The strip showed
 * `2.5bb`, which is the *amount* and not the *act* — "raised to 2.5bb" and
 * "called 2.5bb" are the same number and completely different spots.
 */
function seatActivity(view: SeatView): string {
  const { seat, lastAction, postedBlind, isToAct } = view;

  if (seat.status === 'folded') return 'Folded';

  if (lastAction !== undefined) {
    const { action, size } = lastAction;

    switch (action) {
      case 'fold':
        return 'Folded';
      case 'check':
        return 'Checked';
      case 'call':
        return `Called ${seat.committed}bb`;
      case 'bet':
        return `Bet ${size ?? seat.committed}bb`;
      case 'raise':
        return `Raised to ${size ?? seat.committed}bb`;
      case 'allin':
        return `All in ${size ?? seat.committed}bb`;
    }
  }

  if (seat.status === 'allin') return `All in ${seat.totalCommitted}bb`;
  if (postedBlind) return `Posted ${seat.committed}bb`;
  if (isToAct) return 'To act';

  return 'Waiting';
}

function Seat({
  view,
  hole,
  hand,
  count,
  stackDepth,
  dealKey,
}: {
  view: SeatView;
  /** Hero's cards, which sit at hero's seat. Undefined for everyone else. */
  hole?: readonly [string, string] | undefined;
  hand?: string | undefined;
  count: number;
  stackDepth: number;
  dealKey?: string | undefined;
}) {
  const { seat, isHero, isToAct } = view;
  const folded = seat.status === 'folded';

  /**
   * The stack, shown only when it is not the one the header already states.
   *
   * Six seats reading `100bb` in a 100bb game is four repetitions of a number
   * printed above the table, and it cost each box a third line. Once somebody
   * has put chips in, their stack is the interesting figure and it appears.
   */
  const showStack = !folded && seat.stack !== stackDepth;

  return (
    <li
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={polar(view.ringIndex, count, SEAT_RADIUS)}
      data-testid="seat"
      data-position={seat.position}
      data-hero={isHero || undefined}
      data-status={seat.status}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-[var(--radius)] border px-2 py-1.5 @md:px-2.5',
          isHero ? 'border-ink bg-surface-raised' : 'border-line bg-surface',
          // A seat still owed an action gets a brighter edge. Border only —
          // the accent belongs to the streak and XP rail.
          isToAct && !isHero && 'border-ink-muted',
          // Folded seats recede **by colour, never opacity**. `opacity-40` over
          // already-muted text lands near 2:1 against this surface, under the
          // 4.5:1 floor — an axe violation Phase 10 found and fixed once
          // already, and `e2e/a11y.spec.ts` would find it again.
          folded && 'border-line/40',
        )}
      >
        {/* Hero's cards sit beside the label rather than under it. Stacked, the
            box grew tall enough to push the bottom of the ring off the table. */}
        {hole && hand ? <HoleCards hole={hole} hand={hand} size="sm" dealKey={dealKey} /> : null}

        <div className="flex min-w-[3.75rem] flex-col items-start gap-0.5 @md:min-w-[4.5rem]">
          <span className="flex items-baseline gap-1">
            <span
              className={cn(
                'font-display text-xs font-semibold @md:text-sm',
                folded ? 'text-ink-muted' : 'text-ink',
              )}
            >
              {seat.position}
            </span>
            {isHero ? (
              <span className="text-[0.5625rem] uppercase tracking-wider text-ink-muted">you</span>
            ) : null}
            {seat.position === 'BTN' ? (
              <span
                className="flex size-3.5 items-center justify-center rounded-full border border-ink-muted font-mono text-[0.5rem] leading-none text-ink-muted"
                // The dealer button restates the seat label beside it, so
                // naming it again would have a screen reader read "BTN, D".
                aria-hidden="true"
              >
                D
              </span>
            ) : null}
          </span>

          <span className="whitespace-nowrap font-mono text-[0.625rem] text-ink-muted @md:text-[0.6875rem]">
            {seatActivity(view)}
          </span>

          {showStack ? (
            <span className="font-mono text-[0.5625rem] text-ink-muted">{seat.stack}bb</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function PokerTable({
  state,
  hero,
  hole,
  hand,
  dealKey,
}: {
  state: HandState;
  hero: Position;
  /** Hero's cards, drawn at hero's seat. */
  hole: readonly [string, string];
  hand: string;
  /**
   * Identifies the hand on the table. Changing it re-deals; omitting it means
   * the table simply is, which is what a replay of an old attempt wants.
   */
  dealKey?: string | undefined;
}) {
  const ring = seatRing(state, hero);
  const count = ring.length;
  const pot = potSize(state);

  return (
    // `@container`, not a viewport breakpoint. This renders full width on the
    // drill page below 2xl, at roughly half that beside the feedback panel, and
    // narrower again inside a collapsed Session Review row — three different
    // widths at one viewport size, so the type has to scale to its own box.
    <div className="@container w-full">
      <div className="relative mx-auto aspect-[16/10] w-full max-w-2xl">
        {/**
         * The felt: a filled ellipse the seats sit around.
         *
         * Filled rather than outlined. An unfilled ring is invisible at this
         * contrast and reads as a stray arc wherever a seat box crosses it —
         * which is what the first attempt looked like. The inner hairline is
         * the one piece of table iconography kept, because it is what makes an
         * ellipse read as a *table* rather than as a container.
         *
         * The felt is the **darkest** surface here, not a raised one. Filled in
         * `surface-raised` it sat a shade off the card behind it and the whole
         * thing read as muddy overlapping rectangles. Sunk to `canvas` it gives
         * three unambiguous levels — felt, then seats, then hero — which is
         * also how a real table reads: players sit above the cloth.
         */}
        <div
          aria-hidden="true"
          className="absolute inset-x-[11%] inset-y-[16%] rounded-[50%] border border-line bg-canvas"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-[15%] inset-y-[24%] rounded-[50%] border border-line/50"
        />

        {/* The pot, in the middle, where the chips are heading. */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5">
          <span className="text-[0.5625rem] uppercase tracking-wider text-ink-muted">Pot</span>
          <span className="font-mono text-sm text-ink @md:text-base" data-testid="pot">
            {pot}bb
          </span>
        </div>

        {/* Chips in front of each seat. Separate from the seat list so they can
            sit inside the felt without nesting in a positioned <li>, and
            `aria-hidden` because the same amount is already in the seat's own
            text — announcing it twice is noise, not redundancy. */}
        <div aria-hidden="true">
          {ring
            .filter((view) => view.seat.committed > 0)
            .map((view) => {
              const from = chipOrigin(view.ringIndex, count);

              return (
                <m.span
                  // Keyed on the spot as well as the seat, so a new hand deals
                  // rather than the previous hand's chips staying put.
                  key={`${dealKey}-${view.position}`}
                  className="absolute flex items-center gap-1 rounded-full border border-line bg-canvas px-1.5 py-px font-mono text-[0.5625rem] text-ink-muted"
                  style={polar(view.ringIndex, count, CHIP_RADIUS)}
                  initial={
                    dealKey === undefined
                      ? false
                      : { opacity: 0, x: `calc(-50% + ${from.x}px)`, y: `calc(-50% + ${from.y}px)` }
                  }
                  animate={{ opacity: 1, x: '-50%', y: '-50%' }}
                  transition={{ duration: 0.34, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                  data-testid="seat-chips"
                  data-position={view.position}
                >
                  <span className="size-1.5 rounded-full bg-ink-muted" />
                  {view.seat.committed}
                </m.span>
              );
            })}
        </div>

        {/**
         * The seats.
         *
         * **In action order, positioned by `ringIndex`.** The DOM a screen
         * reader walks is the order the hand happens in; only the pixels move.
         * Phase 10's audit found a `role="grid"` with no rows that had shipped
         * for four phases, and the lesson was that visual structure and
         * document structure have to be decided together rather than one
         * falling out of the other — so this one is decided here.
         *
         * The list is `absolute inset-0` rather than `display: contents`.
         * `display: contents` on an `<ol>` is known to drop list semantics in
         * some engines, which is precisely the bug Phase 10 hit from the other
         * direction where `role="listbox"` stripped a `<ul>`'s. Positioning the
         * list itself gives the seats the same containing block and leaves the
         * `<ol>` an ordinary list.
         */}
        <ol className="absolute inset-0" aria-label="Seats, in order of action">
          {ring.map((view) => (
            <Seat
              key={view.position}
              view={view}
              count={count}
              stackDepth={state.stackDepth}
              {...(view.isHero ? { hole, hand, dealKey } : {})}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
