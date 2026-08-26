import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-1 text-sm text-ink shadow-sm transition-colors',
        'placeholder:text-ink-muted',
        // aria-invalid rather than a prop: the field is marked invalid for
        // assistive tech and styled from the same signal, so the two cannot
        // disagree.
        'aria-invalid:border-action-raise',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
