import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * `clsx` handles conditionals; `twMerge` resolves conflicts, so a caller
 * passing `className="p-6"` to a component whose default is `p-4` gets `p-6`
 * rather than both classes and whichever the stylesheet happens to order last.
 * The shadcn/ui convention, and every copied-in component expects it here.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
