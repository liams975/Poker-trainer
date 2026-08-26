import { createClient } from '@/lib/supabase/server';

/**
 * The entitlement seam.
 *
 * docs/01-architecture.md §3: "Ship the entitlements table and a
 * useEntitlement() hook returning 'free' | 'pro'. In v1 everything is unlocked
 * and there is no paywall UI. Build the seam, skip the wall."
 *
 * So this reads the row and nothing in the app branches on it yet. That is
 * deliberate — retrofitting gating into a mature app is painful, shipping a
 * paywall on an unproven product is worse.
 *
 * The client NEVER writes here. Phase 4 granted `authenticated` SELECT only on
 * `entitlements`; an insert or update returns 42501, proven by both database
 * suites. In v2 a RevenueCat webhook hits an Edge Function which writes the row
 * with the service role. CLAUDE.md: "Never let the client decide entitlement."
 */
export type Tier = 'free' | 'pro';

export async function getEntitlement(): Promise<Tier> {
  const supabase = await createClient();

  const { data, error } = await supabase.from('entitlements').select('tier').maybeSingle();

  // RLS scopes this to the caller's own row, so no user_id filter is needed —
  // and adding one would not make it safer, since the policy is what enforces
  // it. Any failure falls back to `free`: the safe direction is always less
  // access, never more.
  if (error || !data) return 'free';

  return data.tier === 'pro' ? 'pro' : 'free';
}
