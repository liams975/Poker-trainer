import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The signed-out shell: no nav, no rail, nothing to navigate to yet. Centred
 * on a single card, because there is exactly one thing to do on these pages.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <Link href="/" className="font-display text-lg font-semibold tracking-tight">
        Poker Trainer
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
