import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import type { SessionRow } from '@/lib/review/filters';

/**
 * Every session, newest first.
 *
 * Abandoned sessions are listed alongside finished ones rather than hidden.
 * `completed_at` being null is a real thing that happened — a tab closed
 * mid-drill — and a history that quietly omits them would leave someone
 * counting sessions they cannot find.
 */
const MODE_LABELS: Readonly<Record<string, string>> = {
  quick: 'Quick drill',
  focused: 'Focused drill',
  weak_spots: 'Weak spots',
  lesson: 'Lesson drill',
  study: 'Study',
  placement: 'Placement',
};

function when(iso: string): string {
  // The reader's own locale and zone, resolved in the browser. A server-rendered
  // absolute time would be in the server's zone, which is nobody's.
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

export function SessionList({ sessions }: { sessions: readonly SessionRow[] }) {
  if (sessions.length === 0) {
    return <EmptyState>No sessions yet. Every drill you run shows up here.</EmptyState>;
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="session-list">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            href={`/review/${session.id}`}
            className="flex items-center gap-4 rounded-[var(--radius)] border border-line bg-surface px-4 py-3 hover:border-ink-muted"
            data-testid="session-row"
            data-mode={session.mode}
          >
            <span className="w-32 shrink-0 text-sm text-ink">
              {MODE_LABELS[session.mode] ?? session.mode}
            </span>

            <span className="flex-1 font-mono text-xs text-ink-muted">
              {when(session.startedAt)}
            </span>

            <span className="w-24 shrink-0 text-right font-mono text-xs text-ink-muted">
              {session.spots} {session.spots === 1 ? 'spot' : 'spots'}
            </span>

            <span className="w-24 shrink-0 text-right text-xs text-ink-muted">
              {session.completedAt === null ? 'Abandoned' : 'Finished'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
