import type { ChartRegistry } from '@poker/engine';

import { skillLabel } from '@/lib/progress/skill-label';
import type { TagCost } from '@/lib/review/queries';

/**
 * Where the chips went — frame 2i.
 *
 * Total EV given up per skill across the window, worst first. Total rather than
 * per-spot on purpose: the question this answers is "what is costing me the
 * most", and a skill drilled twice badly has not cost much however bad the
 * average looks.
 *
 * **Vermilion, because this is strategy data.** The deck says so explicitly,
 * and it is the one place on the review screen where the action palette is the
 * right vocabulary rather than the chrome accent — these are chips lost to
 * mistakes, not progress toward a goal.
 */
export function TagCosts({
  costs,
  registry,
}: {
  costs: readonly TagCost[];
  registry: ChartRegistry;
}) {
  if (costs.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing has cost you chips in this window yet.
      </p>
    );
  }

  const worst = costs[0]!.totalEvLoss;

  return (
    <section aria-labelledby="tag-costs-heading" className="flex flex-col gap-3">
      <h2 id="tag-costs-heading" className="font-display text-lg">
        Where the chips went
      </h2>

      <ul className="flex flex-col gap-2">
        {costs.map((cost) => (
          <li key={cost.skillTag} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{skillLabel(cost.skillTag, registry)}</span>
              <span className="shrink-0 font-mono text-xs text-ink-muted">
                −{cost.totalEvLoss.toFixed(2)}bb
                <span className="ml-2">{cost.attempts} spots</span>
              </span>
            </div>
            {/* Flat, and proportional to the worst skill rather than to a fixed
                scale — the comparison between skills is the information. */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-line">
              <span
                className="block h-full bg-action-raise"
                style={{ width: `${worst === 0 ? 0 : (cost.totalEvLoss / worst) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
