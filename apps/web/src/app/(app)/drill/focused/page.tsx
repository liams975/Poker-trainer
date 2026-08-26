import { DrillPage } from '@/components/drill/drill-page';

/**
 * Focused Drill: the same runner, with the template filters shown.
 *
 * The eight seeded templates already partition by position and by opener, which
 * is exactly the "filter by position or scenario" the roadmap asks for — so the
 * filter is a choice among templates rather than a second axis over them.
 */
export const metadata = { title: 'Focused Drill' };

export default function Page() {
  return <DrillPage mode="focused" />;
}
