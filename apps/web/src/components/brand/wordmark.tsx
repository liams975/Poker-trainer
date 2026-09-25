import { cn } from '@/lib/utils';

/**
 * The mark: one split cell.
 *
 * The whole product argues that a range is a frequency — `A5o` on the button
 * is half raise, half fold — so the logo is a cell doing exactly that. Drawn in
 * ink and hatching, never in an action hue: a logo is chrome, and the Okabe–Ito
 * set means strategy everywhere it appears.
 *
 * `aria-hidden`, because the words beside it already name the product, and the
 * link that wraps them must keep the accessible name "Poker Trainer" — the e2e
 * suite parks focus on it by that name.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex size-4 shrink-0 border border-ink', className)}
    >
      <span className="hatch w-[38%]" />
      <span className="w-[62%] bg-ink" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-3 text-ink', className)}>
      <Mark />
      <span className="font-display text-xl leading-none tracking-[-0.01em]">
        Poker <i>Trainer</i>
      </span>
    </span>
  );
}
