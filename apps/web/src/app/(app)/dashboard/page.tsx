import { ModeGrid } from '@/components/dashboard/mode-grid';
import { ProgressRail } from '@/components/dashboard/progress-rail';
import { TodayStrip } from '@/components/dashboard/today-strip';

export const metadata = { title: 'Dashboard · Poker Trainer' };

/**
 * The study desk (docs/05-ui-ux.md).
 *
 * Six entry points rather than one linear journey, with progress present in
 * the rail but not dictating. Everything reads empty because a new account is
 * empty — the numbers arrive in Phases 7-9 and the modes light up as their
 * phases land.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">Dashboard</h1>

      <TodayStrip />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_18rem]">
        <ModeGrid />
        <ProgressRail />
      </div>
    </div>
  );
}
