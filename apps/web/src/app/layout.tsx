import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Sans, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';

import { Providers } from './providers';

import './globals.css';

/**
 * Three faces, each with a job, per docs/05-ui-ux.md:
 *   display — statements: the landing argument, the summary headline
 *   body    — every interface surface
 *   data    — every frequency, percentage, EV figure and the range grid
 *
 * Loaded through next/font so they self-host: no render-blocking request to
 * Google, and no layout shift from a late swap.
 *
 * Only Instrument Sans is a variable font. The other two ship discrete weights,
 * and next/font throws at build time if a non-variable family arrives without
 * an explicit `weight` — so those lists are required, not decoration.
 */
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400', // the only weight this family has
  variable: '--font-instrument-serif',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
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
    <html lang="en" className="dark">
      <body
        className={`${instrumentSans.variable} ${instrumentSerif.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
