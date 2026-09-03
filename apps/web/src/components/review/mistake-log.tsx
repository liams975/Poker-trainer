import { EmptyState } from '@/components/ui/empty-state';
import type { AttemptRow as Attempt } from '@/lib/review/filters';

import { AttemptRow } from './attempt-row';

/**
 * The log itself: a list of past answers, each replayable.
 *
 * Named "mistake log" in the roadmap, and it is deliberately **not** filtered
 * to mistakes by default. Two of the four tiers are defensible answers, so a
 * list that showed only the other two would be asserting a pass/fail split the
 * engine does not believe — and reviewing a spot you got right for the wrong
 * reason is worth as much as reviewing one you got wrong. The grade filter is
 * one click away for anyone who wants only the blunders.
 */
export function MistakeLog({
  attempts,
  currentChartVersion,
  filtered,
}: {
  attempts: readonly Attempt[];
  currentChartVersion: string;
  /** Whether any filter is active, so the empty state can say the right thing. */
  filtered: boolean;
}) {
  if (attempts.length === 0) {
    return (
      <EmptyState>
        {filtered
          ? 'Nothing matches those filters. Clear one and try again.'
          : 'No answers recorded yet. Run a drill and every spot lands here.'}
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="mistake-log">
      {attempts.map((attempt) => (
        <AttemptRow
          key={attempt.id}
          attempt={attempt}
          currentChartVersion={currentChartVersion}
        />
      ))}
    </ul>
  );
}
