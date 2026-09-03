'use client';

import { GRADE_TIERS } from '@poker/engine';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { TIER_STYLES } from '@/components/drill/grade-tiers';
// From `filters`, not `queries`: `queries` imports the server Supabase
// client, and a value import of it from a client component bundles
// `next/headers` for the browser and 500s the route.
import { REVIEW_MODES } from '@/lib/review/filters';

/**
 * Filters, as links.
 *
 * Every filter is a URL search param and every control is an `<a>`, not a
 * `<select>` with an `onChange`. Three consequences, all of them wanted: a
 * filtered view is a link you can send yourself, the back button does what it
 * looks like it does, and the whole thing works before any JavaScript loads.
 *
 * The mode labels are the reader's words, not the enum's — `weak_spots` is a
 * database value and "Weak spots" is what it is called everywhere else.
 */
const MODE_LABELS: Readonly<Record<string, string>> = {
  quick: 'Quick',
  focused: 'Focused',
  weak_spots: 'Weak spots',
  lesson: 'Lesson',
  study: 'Study',
  placement: 'Placement',
};

function Chip({
  href,
  active,
  children,
  swatch,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  swatch?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-ink bg-surface-raised text-ink'
          : 'border-line text-ink-muted hover:text-ink'
      }`}
    >
      {swatch ? (
        <span aria-hidden="true" style={{ color: swatch }}>
          ●
        </span>
      ) : null}
      {children}
    </Link>
  );
}

export function FilterBar() {
  const pathname = usePathname();
  const params = useSearchParams();

  /** A link with one param changed, and the same param toggled off if repeated. */
  function toggle(key: string, value: string): string {
    const next = new URLSearchParams(params.toString());
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);

    const query = next.toString();
    return query.length > 0 ? `${pathname}?${query}` : pathname;
  }

  const anyActive = ['mode', 'grade', 'tag'].some((key) => params.get(key) !== null);

  return (
    <div className="flex flex-col gap-3" data-testid="filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-ink-muted">Mode</span>
        {REVIEW_MODES.map((mode) => (
          <Chip key={mode} href={toggle('mode', mode)} active={params.get('mode') === mode}>
            {MODE_LABELS[mode] ?? mode}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-ink-muted">Grade</span>
        {GRADE_TIERS.map((tier) => (
          <Chip
            key={tier}
            href={toggle('grade', tier)}
            active={params.get('grade') === tier}
            swatch={TIER_STYLES[tier].hex}
          >
            {TIER_STYLES[tier].label}
          </Chip>
        ))}
      </div>

      {anyActive ? (
        <div>
          <Link
            href={pathname}
            className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            Clear filters
          </Link>
        </div>
      ) : null}
    </div>
  );
}
