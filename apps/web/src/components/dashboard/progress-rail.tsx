import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/empty-state';

/**
 * The right rail: progress, weak spots, recent sessions.
 *
 * docs/05: the progression path lives here — "present and motivating, but not
 * the only door." Every section is genuinely empty for a new account, and the
 * copy invites the action that would fill it rather than reporting nothing.
 *
 * Phase 8 fills Progress, Phase 9 fills Weak Spots and Recent.
 */
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = `rail-${title.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-xs uppercase tracking-wider text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ProgressRail() {
  return (
    <aside className="flex flex-col gap-8 rounded-[var(--radius)] border border-line bg-surface p-6">
      <RailSection title="Progress">
        <EmptyState>The track opens in Phase 8. Nothing to resume yet.</EmptyState>
      </RailSection>

      <RailSection title="Weak spots">
        <EmptyState>No weak spots yet — drill 20 hands and check back.</EmptyState>
      </RailSection>

      <RailSection title="Recent">
        <EmptyState>No sessions yet. Your last five will show up here.</EmptyState>
      </RailSection>
    </aside>
  );
}
