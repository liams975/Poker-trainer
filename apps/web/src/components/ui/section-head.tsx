import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A section head, as a book sets one: the section number, a statement in the
 * display face, a caption flush right, and a rule under the lot.
 *
 * The number is a reading aid rather than decoration — "§2" is how a page this
 * long says where you are in it — so it is real text, muted, before the title.
 */
export function SectionHead({
  n,
  title,
  caption,
  id,
  as: Heading = 'h2',
  className,
}: {
  n?: number | string | undefined;
  title: ReactNode;
  caption?: ReactNode;
  id?: string;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-line pb-4',
        className,
      )}
    >
      {n === undefined ? null : <span className="font-mono text-sm text-ink-muted">§{n}</span>}
      <Heading id={id} className="font-display text-4xl tracking-[-0.01em]">
        {title}
      </Heading>
      {caption ? <span className="ml-auto font-mono text-xs text-ink-muted">{caption}</span> : null}
    </div>
  );
}
