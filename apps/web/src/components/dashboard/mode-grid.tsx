import Link from 'next/link';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { MODES } from './modes';

/**
 * The six mode cards. Two columns, echoing the modular rhythm of the 13×13
 * grid that organises the rest of the product.
 *
 * An unavailable mode renders as a non-interactive <div>, not a disabled link:
 * a disabled anchor is still focusable in some browsers and still announced as
 * a link, which sends a keyboard user somewhere that does not exist. The phase
 * label is real text, so the state does not depend on the dimmed styling being
 * perceivable.
 */
export function ModeGrid() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {MODES.map((mode) => {
        const available = mode.availableIn === null;

        const card = (
          <Card
            className={cn(
              'h-full transition-colors',
              available
                ? 'hover:border-ink-muted hover:bg-surface-raised'
                : 'opacity-60',
            )}
          >
            <CardHeader>
              <CardTitle>{mode.title}</CardTitle>
              <CardDescription>{mode.description}</CardDescription>
              {available ? null : (
                <p className="pt-1 text-xs uppercase tracking-wider text-ink-muted">
                  Phase {mode.availableIn}
                </p>
              )}
            </CardHeader>
          </Card>
        );

        return (
          <li key={mode.slug}>
            {available ? (
              <Link href={mode.href} className="block h-full rounded-[var(--radius)]">
                {card}
              </Link>
            ) : (
              card
            )}
          </li>
        );
      })}
    </ul>
  );
}
