import type { ReactNode } from 'react';

/**
 * docs/05-ui-ux.md on copy: "Empty states invite action: 'No weak spots yet —
 * drill 20 hands and check back.'" Plain, active, specific; never an apology
 * and never a shrug.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-muted">{children}</p>;
}
