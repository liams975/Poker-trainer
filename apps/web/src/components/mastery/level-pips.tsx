import { MASTERY_LEVELS } from '@poker/engine';

import { cn } from '@/lib/utils';

/**
 * Five segments, filled to the level reached.
 *
 * Never the only encoding. The level is printed as text beside these ("L4"),
 * so the pips are a second reading of a fact already stated — the same
 * discipline the range grid applies to action colour, for the same reason.
 *
 * `aria-hidden`, because the text is the accessible version and a screen reader
 * announcing five list items called "pip" would be noise, not information.
 */
export function LevelPips({ level }: { level: number }) {
  return (
    <span aria-hidden className="inline-flex gap-1">
      {Array.from({ length: MASTERY_LEVELS }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-1.5 w-5 rounded-full',
            // Flat fills. The deck is explicit that progress is data and gets
            // no gradient, no glow and no shimmer.
            index < level ? 'bg-accent' : 'bg-line',
          )}
        />
      ))}
    </span>
  );
}
