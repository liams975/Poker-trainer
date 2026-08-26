'use client';

import { useQuery } from '@tanstack/react-query';

import type { Tier } from '@/lib/entitlement';
import { createClient } from '@/lib/supabase/client';

/**
 * Client-side half of the entitlement seam (docs/01-architecture.md §3).
 *
 * Read-only, and gates nothing in v1 — the wall is not built. It exists now so
 * that when v2 needs it, the call sites already read from one place instead of
 * being retrofitted through a mature app.
 *
 * Falls back to `'free'` on any error. A failed read must never grant access.
 */
export function useEntitlement(): { tier: Tier; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['entitlement'],
    queryFn: async (): Promise<Tier> => {
      const supabase = createClient();
      const { data: row, error } = await supabase.from('entitlements').select('tier').maybeSingle();

      if (error || !row) return 'free';
      return row.tier === 'pro' ? 'pro' : 'free';
    },
  });

  return { tier: data ?? 'free', isLoading };
}
