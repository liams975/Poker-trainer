import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-12 w-full border border-line bg-canvas px-4 text-base text-ink transition-colors',
        'placeholder:text-ink-muted hover:border-ink-muted',
        // aria-invalid rather than a prop: the field is marked invalid for
        // assistive tech and styled from the same signal, so the two cannot
        // disagree. Ink and dashed, not the raise hue — an action colour on a
        // form field would be chrome borrowing strategy's meaning. The error
        // text beside it is what actually says what is wrong.
        'aria-invalid:border-dashed aria-invalid:border-ink',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
