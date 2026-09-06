/**
 * Opponent profiles.
 *
 * A table of six identical bots is one opponent rendered six times, and the
 * thing that makes a cash game worth sitting at is that the seats play
 * differently. These are two numbers each, feeding the same
 * `createHeuristicStrategy` — not separate strategies, which would be three
 * times the surface for a difference the player experiences as "that one calls
 * a lot".
 *
 * Deliberately not content in `packages/content`. A chart is strategy the app
 * teaches and grades against; this is how an *opponent* behaves, and nothing is
 * ever graded against it. If profiles ever become something a user picks from a
 * list, that list is content and this becomes its schema.
 */

export interface BotProfile {
  id: string;
  label: string;
  /** Scales betting and raising. 1 is neutral. */
  aggression: number;
  /** Scales willingness to continue. 1 is neutral. */
  looseness: number;
}

export const BOT_PROFILES: readonly BotProfile[] = [
  {
    id: 'rock',
    label: 'Tight and passive',
    aggression: 0.55,
    looseness: 0.6,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    aggression: 1,
    looseness: 1,
  },
  {
    id: 'aggressor',
    label: 'Loose and aggressive',
    aggression: 1.7,
    looseness: 1.45,
  },
];

export function profileById(id: string): BotProfile {
  const profile = BOT_PROFILES.find((candidate) => candidate.id === id);
  if (profile === undefined) {
    throw new RangeError(
      `unknown bot profile "${id}". Known: ${BOT_PROFILES.map((p) => p.id).join(', ')}`,
    );
  }
  return profile;
}
