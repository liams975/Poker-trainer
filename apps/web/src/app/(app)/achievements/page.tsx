import { BadgeGallery } from '@/components/progress/badge-gallery';
import { fetchAchievementGallery } from '@/lib/progress/queries';
import type { AchievementGallery } from '@/lib/progress/types';

export const metadata = { title: 'Achievements · Poker Trainer' };

/**
 * The badge gallery — frame 2h of the v2 deck.
 *
 * Nothing here is stored. Whether a badge is earned comes from
 * `user_achievements`; how far along a locked one is, is derived on read from
 * the same snapshot the award path evaluates. So a badge that should have
 * unlocked shows as complete the moment the page is opened, even if the session
 * that earned it has not been closed yet.
 */
export default async function AchievementsPage() {
  let gallery: AchievementGallery | null;

  /**
   * Degrades rather than errors, like the dashboard and the mastery map. This
   * is a reflective screen; a stats query that times out is not worth an error
   * page.
   */
  try {
    gallery = await fetchAchievementGallery();
  } catch {
    gallery = null;
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">Achievements</h1>

      {gallery === null ? (
        <p className="text-sm text-ink-muted">
          Your achievements could not be loaded just now. Nothing has been lost — these are
          derived from your history every time this page opens, so a reload is all it takes.
        </p>
      ) : (
        <BadgeGallery badges={gallery.badges} unlockedCount={gallery.unlockedCount} />
      )}
    </div>
  );
}
