// Relative, not `@/` — the same reason `drill/grade-tiers.ts` is: vitest's web
// project imports this module directly and does not resolve the Next path
// alias. A pure module the unit suite can read is worth the uglier import.
import { MODES } from '../dashboard/modes';

/**
 * Everywhere ⌘K can take you.
 *
 * Derived from `MODES` rather than restated, so a seventh mode appears in the
 * palette the moment it is added and an unbuilt one never does. The same
 * argument the shortcuts overlay makes about reading `SHORTCUTS`: a keyboard
 * interface that lists what it cannot do is worse than one that lists nothing.
 */
export interface Destination {
  id: string;
  label: string;
  href: string;
  /** Grouping header in the palette. */
  section: 'Go to' | 'Lessons';
  /** Extra words that should match this entry, beyond its label. */
  keywords?: readonly string[];
}

const FIXED: readonly Destination[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', section: 'Go to', keywords: ['home', 'today'] },
  { id: 'learn', label: 'Track overview', href: '/learn', section: 'Go to', keywords: ['course', 'lessons'] },
];

export interface LessonLink {
  slug: string;
  title: string;
  locked: boolean;
}

/**
 * Locked lessons are omitted, not greyed out.
 *
 * A palette entry that takes you to a page refusing to open is a worse
 * experience than no entry, and the unlock rule lives in the engine — this
 * just honours whatever it decided.
 */
export function buildDestinations(lessons: readonly LessonLink[] = []): readonly Destination[] {
  const modes: Destination[] = MODES.filter((mode) => mode.availableIn === null).map((mode) => ({
    id: `mode-${mode.slug}`,
    label: mode.title,
    href: mode.href,
    section: 'Go to',
    keywords: mode.description.toLowerCase().split(/\W+/).filter((word) => word.length > 3),
  }));

  const lessonLinks: Destination[] = lessons
    .filter((lesson) => !lesson.locked)
    .map((lesson) => ({
      id: `lesson-${lesson.slug}`,
      label: lesson.title,
      href: `/learn/${lesson.slug}`,
      section: 'Lessons',
    }));

  return [...FIXED, ...modes, ...lessonLinks];
}

/** Case-insensitive substring match over the label and its keywords. */
export function filterDestinations(
  destinations: readonly Destination[],
  query: string,
): readonly Destination[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return destinations;

  return destinations.filter((destination) => {
    if (destination.label.toLowerCase().includes(needle)) return true;
    return (destination.keywords ?? []).some((keyword) => keyword.includes(needle));
  });
}
