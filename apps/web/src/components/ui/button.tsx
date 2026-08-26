import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Note what is missing from these variants: the action colours.
 *
 * docs/05-ui-ux.md reserves saturated colour for strategy data, so buttons are
 * drawn from the monochrome ramp. `destructive` is the single exception and
 * borrows the raise hue, because a destructive confirmation is genuinely the
 * one piece of chrome that has to shout.
 *
 * No `focus-visible:` styles here either — globals.css applies the ring to
 * every focusable element at once, so a control cannot ship without one.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-ink text-canvas hover:bg-ink/90',
        secondary: 'bg-surface-raised text-ink hover:bg-surface-raised/80',
        outline: 'border border-line bg-transparent text-ink hover:bg-surface-raised',
        ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink',
        destructive: 'bg-action-raise text-ink hover:bg-action-raise/90',
        link: 'text-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-[var(--radius)] px-3 text-xs',
        lg: 'h-10 rounded-[var(--radius)] px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';

  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
