/**
 * The six entry points from docs/05-ui-ux.md.
 *
 * Data, not markup, so that enabling one in a later phase is a one-line change
 * here rather than an edit to the dashboard's layout. `availableIn` records the
 * phase that lights it up, which keeps the "not yet" copy honest instead of
 * six cards claiming to work.
 *
 * docs/05's model is a study desk, not a linear path: "A returning intermediate
 * player who wants to grind blind-defense spots for 40 minutes can do that in
 * one click without walking a path designed for someone else."
 */
export interface Mode {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  /** The roadmap phase that makes this real. `null` once it is live. */
  readonly availableIn: number | null;
}

export const MODES: readonly Mode[] = [
  {
    slug: 'continue-learning',
    title: 'Continue Learning',
    description: 'Resume the track — next lesson and its drills.',
    href: '/learn',
    // Live from Phase 8.
    availableIn: null,
  },
  {
    slug: 'quick-drill',
    title: 'Quick Drill',
    description: '20 mixed spots from unlocked material. Low friction.',
    href: '/drill/quick',
    // Live from Phase 7.
    availableIn: null,
  },
  {
    slug: 'focused-drill',
    title: 'Focused Drill',
    description: 'Filter by position or scenario. Deliberate practice.',
    href: '/drill/focused',
    availableIn: null,
  },
  {
    slug: 'weak-spots',
    title: 'Weak Spots',
    description: 'Adaptive sampling from your lowest-accuracy skills.',
    href: '/drill/weak-spots',
    // Live from Phase 9.
    availableIn: null,
  },
  {
    slug: 'range-explorer',
    title: 'Range Explorer',
    description: 'Free-form chart study and comparison. No grading.',
    href: '/range-explorer',
    // The first mode to go live, Phase 6.
    availableIn: null,
  },
  {
    slug: 'session-review',
    title: 'Session Review',
    description: 'History, mistake log, accuracy over time.',
    href: '/review',
    // Live from Phase 10, the last of the six.
    availableIn: null,
  },
];
