import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * The pulse is a CSS animation, so the global prefers-reduced-motion block in
 * globals.css already flattens it to a static block for users who ask for
 * that. Nothing to do per-instance.
 */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('animate-pulse rounded-[var(--radius)] bg-surface-raised', className)}
      {...props}
    />
  );
}

export { Skeleton };
