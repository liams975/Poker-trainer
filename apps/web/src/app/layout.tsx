import type { Metadata } from 'next';
import { Fragment_Mono, Old_Standard_TT, Schibsted_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';

import { Providers } from './providers';

import './globals.css';

/**
 * Three faces, each with a job, per docs/05-ui-ux.md:
 *   display — statements and big figures: Old Standard TT, the Modern face of
 *             19th-century scientific books
 *   body    — every interface surface and all prose: Schibsted Grotesk
 *   data    — every frequency, percentage, EV figure, hand and log line:
 *             Fragment Mono
 *
 * Loaded through next/font so they self-host: no render-blocking request to
 * Google, and no layout shift from a late swap.
 *
 * Only Schibsted Grotesk is a variable font. The other two ship discrete
 * weights, and next/font throws at build time if a non-variable family arrives
 * without an explicit `weight` — so those lists are required, not decoration.
 * The italics are real: the display face's italic carries half the statements.
 */
const schibsted = Schibsted_Grotesk({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-schibsted',
  display: 'swap',
});

const oldStandard = Old_Standard_TT({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-old-standard',
  display: 'swap',
});

const fragmentMono = Fragment_Mono({
  subsets: ['latin'],
  weight: '400', // the only weight this family has
  style: ['normal', 'italic'],
  variable: '--font-fragment-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Poker Trainer',
  description: '6-max cash game training for experienced beginners.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Dark only — docs/05 specifies one palette, so there is no toggle and no
    // flash-of-wrong-theme problem to solve.
    //
    // The font variables go on <html>, not <body>. Tailwind emits the theme at
    // `:root`, where `--font-display: var(--font-old-standard), …` is resolved
    // — and a custom property resolves where it is declared, not where it is
    // used. With the next/font classes on <body>, `--font-old-standard` did not
    // exist yet at `:root`, `--font-display` computed to nothing, and every
    // face fell through to the system font. That is how Phases 14–16 shipped:
    // Instrument Serif and Sans were loaded and never drawn. `e2e/smoke.spec.ts`
    // now reads the rendered face back.
    <html
      lang="en"
      className={`dark ${schibsted.variable} ${oldStandard.variable} ${fragmentMono.variable}`}
    >
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
