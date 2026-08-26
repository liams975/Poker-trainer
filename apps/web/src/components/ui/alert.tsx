import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-[var(--radius)] border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'border-line bg-surface text-ink',
        // Borrows the raise hue rather than introducing a sixth colour. Paired
        // with an icon and text in every usage, so the state never depends on
        // colour alone.
        destructive: 'border-action-raise/40 bg-action-raise/10 text-ink [&>svg]:text-action-raise',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: ComponentProps<'h5'>) {
  return <h5 className={cn('mb-1 font-medium leading-none', className)} {...props} />;
}

function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-sm text-ink-muted', className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle };
