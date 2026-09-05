import type { DrillSpot } from '@poker/engine';

import { ActionHistory } from './action-history';
import { PokerTable } from './poker-table';

/**
 * The left column: the spot itself.
 *
 * docs/05-ui-ux.md's first named desktop advantage is that this stays on screen
 * while the feedback appears beside it — "on mobile this must be a modal that
 * hides the spot. Here the user sees the decision *and* the chart
 * simultaneously." So nothing in here collapses or is replaced on reveal.
 *
 * This is the single seam for the spot display: it is imported by the drill
 * runner and by Session Review's attempt row, and through those two by every
 * drill mode, the lesson's embedded drill, the placement test and the replay.
 * One component, six surfaces — which is why the table landed here rather than
 * in the runner.
 */
export function SpotView({
  spot,
  children,
  deal = false,
}: {
  spot: DrillSpot;
  children?: React.ReactNode;
  /**
   * Whether a new spot is being dealt to the reader right now.
   *
   * The drill runner sets it; Session Review does not. Replaying an answer
   * from three weeks ago is not a hand being dealt, and animating it as one
   * would say something false about what the screen is showing.
   */
  deal?: boolean;
}) {
  const { state, hero, scenario } = spot;

  // Identifies the hand on the table. Two spots in a batch cannot repeat a
  // hand in the same seat and sequence, so this changes exactly when the spot
  // does — which is what re-triggers the deal.
  const dealKey = `${hero}-${scenario.actionSequence}-${scenario.hole.join('')}`;

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-5">
      {/* The hand notation is NOT repeated here. It sits under hero's cards on
          the table, and a second copy in the corner of the header read as a
          timer — `54s` is a suited five-four, and looked exactly like fifty-four
          seconds next to a drill that has an optional clock. */}
      <h2 className="font-display text-sm font-semibold">
        You are {hero} · {scenario.stackDepth}bb
      </h2>

      <PokerTable
        state={state}
        hero={hero}
        hole={scenario.hole}
        hand={scenario.hand}
        {...(deal ? { dealKey } : {})}
      />

      {/*
        Kept, and demoted beneath the table rather than replaced by it.

        The ring shows *state* — who is in, what each seat's latest act was.
        The list shows *sequence*, and "UTG opened, HJ 3-bet" is not recoverable
        from a ring that only ever shows the latest action per seat. They are
        two projections of `state.history` now, where the old strip read from
        `seats` and the list read from `history`; two readings of one fact from
        two different sources is how a screen ends up disagreeing with itself.
      */}
      <ActionHistory state={state} />

      {children}
    </div>
  );
}
