import { GRADE_TIERS } from '@poker/engine';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TIER_STYLES } from '@/components/drill/grade-tiers';
import { MistakeLog } from '@/components/review/mistake-log';
import { getCharts } from '@/lib/charts/registry';
import { skillLabel } from '@/lib/progress/skill-label';
import { fetchSessionDetail } from '@/lib/review/queries';

export const metadata = { title: 'Session · Poker Trainer' };

/**
 * One session: its tier split, where it went wrong by skill, and every answer.
 *
 * A session that does not exist and a session belonging to somebody else look
 * identical from here — RLS returns nothing for both — and both become a 404.
 * That is deliberate: a distinguishable "not yours" would confirm to a prober
 * that an id is real.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ session: string }>;
}) {
  const { session: sessionId } = await params;

  const [detail, { chartSet, registry }] = await Promise.all([
    fetchSessionDetail(sessionId),
    getCharts(),
  ]);

  if (detail === null) notFound();

  const { session, attempts, digest } = detail;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/review"
          className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          ← All sessions
        </Link>
        <h1 className="font-display text-lg font-semibold">
          {session.mode.replace(/_/g, ' ')} session
        </h1>
        {/* Deliberately no single accuracy percentage — docs/03: "Score by EV
            loss, not accuracy percentage." The same rule the live summary
            follows, so a session cannot read one way there and another here. */}
        <p className="text-sm text-ink-muted">
          {digest.spots} {digest.spots === 1 ? 'spot' : 'spots'} ·{' '}
          <span className="font-mono">{digest.totalEvLoss}bb</span> total EV lost ·{' '}
          <span className="font-mono">{digest.avgEvLoss}bb</span> per spot
          {session.completedAt === null ? ' · abandoned' : ''}
        </p>
      </header>

      <section aria-labelledby="tiers-heading" className="flex flex-col gap-2">
        <h2 id="tiers-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          How the answers landed
        </h2>
        <ul className="flex flex-wrap gap-4" data-testid="session-tiers">
          {GRADE_TIERS.map((tier) => (
            <li key={tier} className="flex items-center gap-2 text-sm" data-tier={tier}>
              <span aria-hidden="true" style={{ color: TIER_STYLES[tier].hex }}>
                {TIER_STYLES[tier].glyph}
              </span>
              <span>{TIER_STYLES[tier].label}</span>
              <span className="font-mono text-xs text-ink-muted">{digest.byTier[tier]}</span>
            </li>
          ))}
        </ul>
      </section>

      {digest.byTag.length > 0 ? (
        <section aria-labelledby="tags-heading" className="flex flex-col gap-2">
          <h2 id="tags-heading" className="text-xs uppercase tracking-wider text-ink-muted">
            By skill — weakest first
          </h2>
          <ul className="flex flex-col gap-1.5" data-testid="session-by-tag">
            {digest.byTag.map((tag) => (
              <li key={tag.skillTag} className="flex items-center gap-3 text-sm">
                <span className="w-48 shrink-0">{skillLabel(tag.skillTag, registry)}</span>
                <span className="h-2 w-40 overflow-hidden rounded-full bg-surface-raised">
                  <span
                    className="block h-full bg-ink-muted"
                    style={{ width: `${tag.accuracy * 100}%` }}
                  />
                </span>
                <span className="font-mono text-xs text-ink-muted">
                  {tag.passes} of {tag.attempts}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="answers-heading" className="flex flex-col gap-3">
        <h2 id="answers-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          Every answer, in order
        </h2>
        <MistakeLog
          attempts={attempts}
          currentChartVersion={chartSet.version}
          filtered={false}
        />
      </section>
    </div>
  );
}
