import type { HandState } from '@poker/engine';

import { actionLabel } from '@/components/range/action-colors';

/**
 * What has happened so far, in words — set as a hand history, the one piece of
 * typography poker already had: a position, then what it did, in mono.
 *
 * Read from `state.history`, which the engine built by replaying real
 * `applyAction` calls — never from the scenario's `actionSequence` string. The
 * string is a chart key; the history is what actually occurred. Deriving the
 * display from the key would let the two disagree, and the whole reason
 * `rebuildSpot` re-derives and checks the sequence is that a spot mislabelling
 * itself is the failure this codebase treats as worse than a crash.
 */
export function ActionHistory({ state }: { state: HandState }) {
  const preflop = state.history.filter((entry) => entry.street === 'preflop');

  return (
    <div className="flex flex-col gap-3">
      <h3 className="label-caps text-ink-muted">The hand</h3>

      {preflop.length === 0 ? (
        <p className="font-mono text-sm text-ink-muted">Folded to you.</p>
      ) : (
        <ol className="flex flex-col">
          {preflop.map((entry, index) => (
            <li
              key={`${entry.position}-${index}`}
              className="grid grid-cols-[3.5rem_1fr] items-baseline border-b border-dotted border-line-soft py-1.5 font-mono text-sm"
            >
              <span className="text-ink">{entry.position}</span>
              <span className="text-ink-muted">
                {entry.size === undefined
                  ? actionLabel(entry.action)
                  : `${actionLabel(entry.action)} to ${entry.size}bb`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
