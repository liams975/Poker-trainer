import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Note what is missing from these variants: the action colours.
 *
 * docs/05-ui-ux.md reserves saturated colour for strategy data, so buttons are
 * drawn from the monochrome ramp — with one exception, and it is not an action
 * hue. `default` is **the yellow key**: after the Braun ET66's equals key, the
 * one control on the screen you press next. One per screen. Everything else is
 * `outline` or `ghost`.
 *
 * `destructive` used to borrow the raise hue, which put an action colour on
 * chrome — the one crossing the governing rule forbids. It is ink now, and a
 * destructive control says what it does in words.
 *
 * No `focus-visible:` styles here either — globals.css applies the ring to
 * every focusable element at once, so a control cannot ship without one.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-3 whitespace-nowrap text-base font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Disabled, the key goes unlit rather than half-transparent: yellow at
        // 50% over this ground is an olive nobody chose.
        default:
          'bg-accent font-semibold text-accent-ink hover:bg-accent/90 disabled:bg-surface-raised disabled:text-ink-muted disabled:opacity-100',
        secondary: 'border border-line bg-surface-raised text-ink hover:border-ink',
        outline: 'border border-line bg-transparent text-ink hover:border-ink',
        ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink',
        destructive: 'border border-ink bg-transparent text-ink hover:bg-ink hover:text-canvas',
        link: 'text-ink underline decoration-line underline-offset-4 hover:decoration-ink',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 px-3.5 text-sm',
        lg: 'h-13 px-6',
        icon: 'size-10',
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
