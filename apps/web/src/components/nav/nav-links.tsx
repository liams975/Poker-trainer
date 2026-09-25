'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * The sections, in the order somebody works through them.
 *
 * Until Phase 17 the header named only Mastery and left everything else to the
 * dashboard and ⌘K. A study app with seven destinations and one visible link
 * made every other screen a dead end without the keyboard.
 *
 * There is no /drill index — the three drills are modes of one runner — so
 * "Drill" opens the low-friction one. `match` decides what counts as being
 * inside a section: a lesson is under Learn, every drill under Drill.
 *
 * A client component only because the active state reads the pathname. The
 * header around it stays on the server.
 */
const SECTIONS = [
  { label: 'Desk', href: '/dashboard', match: ['/dashboard'] },
  { label: 'Learn', href: '/learn', match: ['/learn', '/onboarding'] },
  { label: 'Drill', href: '/drill/quick', match: ['/drill'] },
  { label: 'Play', href: '/play', match: ['/play'] },
  { label: 'Explorer', href: '/range-explorer', match: ['/range-explorer'] },
  { label: 'Review', href: '/review', match: ['/review'] },
  { label: 'Mastery', href: '/mastery', match: ['/mastery', '/achievements'] },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <ul className="flex h-full items-stretch gap-7">
      {SECTIONS.map((section) => {
        const active = section.match.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
        );

        return (
          <li key={section.href} className="flex">
            <Link
              href={section.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'label-caps flex items-center transition-colors',
                // The active section is underlined in ink at the header's own
                // edge. Not the accent: navigation is chrome.
                active
                  ? 'text-ink shadow-[inset_0_-1px_0_var(--color-ink)]'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {section.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
