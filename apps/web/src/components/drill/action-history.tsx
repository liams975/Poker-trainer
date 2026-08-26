import type { HandState } from '@poker/engine';

import { actionLabel } from '@/components/range/action-colors';

/**
 * What has happened so far, in words.
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
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs uppercase tracking-wider text-ink-muted">Action</h3>

      {preflop.length === 0 ? (
        <p className="text-sm text-ink-muted">Folded to you.</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {preflop.map((entry, index) => (
            <li
              key={`${entry.position}-${index}`}
              className="flex items-baseline gap-2 font-mono text-sm"
            >
              <span className="w-10 shrink-0 text-ink-muted">{entry.position}</span>
              <span className="text-ink">
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
