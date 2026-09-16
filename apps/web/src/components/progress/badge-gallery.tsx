import type { GalleryBadge } from '@/lib/progress/types';
import { cn } from '@/lib/utils';

/**
 * The achievement gallery — frame 2h.
 *
 * The deck's rule, and the whole reason this screen exists: *"Locked badges say
 * what they need and how far along you are — a badge you cannot see the shape
 * of is not a goal."* So a locked badge is not a greyed-out silhouette here. It
 * shows its title, what it wants, and how far along the reader is.
 *
 * Progress comes from `achievementProgress`, which shares its reading of the
 * criteria with the function that actually awards the badge. That agreement is
 * tested in the engine, because a full bar beside a locked badge would read as
 * a bug in the award, not in the bar.
 */
export function BadgeGallery({
  badges,
  unlockedCount,
}: {
  badges: readonly GalleryBadge[];
  unlockedCount: number;
}) {
  return (
    <section aria-labelledby="badges-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="badges-heading" className="font-display text-2xl">
          Achievements
        </h2>
        <p className="font-mono text-xs text-ink-muted">
          {unlockedCount} / {badges.length}
        </p>
      </header>

      <p className="max-w-prose text-sm text-ink-muted">
        Locked badges say what they need and how far along you are — a badge you cannot see the
        shape of is not a goal.
      </p>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {badges.map(({ achievement, unlocked, progress }) => (
          <li
            key={achievement.id}
            className={cn(
              'flex flex-col gap-2 rounded-[var(--radius)] border p-4',
              unlocked ? 'border-accent/40 bg-surface' : 'border-line',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className={cn('text-sm', unlocked ? 'text-accent-hi' : 'text-ink')}>
                {achievement.title}
              </h3>
              {/* The word, not just the tint — colour is never the only signal. */}
              <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-wider text-ink-muted">
                {unlocked ? 'earned' : `${progress.current} / ${progress.target}`}
              </span>
            </div>

            <p className="text-xs text-ink-muted">{achievement.description}</p>

            {unlocked ? null : (
              <div
                role="progressbar"
                aria-valuenow={progress.current}
                aria-valuemin={0}
                aria-valuemax={progress.target}
                aria-label={`${achievement.title} progress`}
                className="h-1 w-full overflow-hidden rounded-full bg-line"
              >
                {/* Flat. The deck is explicit that a bar is data, so it gets no
                    gradient, no glow and no shimmer. */}
                <span
                  className="block h-full bg-accent"
                  style={{
                    width: `${progress.target === 0 ? 0 : (progress.current / progress.target) * 100}%`,
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
