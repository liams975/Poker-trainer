import type { Metadata } from 'next';
import { Inter, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import { Providers } from './providers';

import './globals.css';

/**
 * Three faces, each with a job, per docs/05-ui-ux.md:
 *   display — headings and mode cards, used with restraint
 *   body    — everything else
 *   data    — every frequency, percentage, EV figure and the range grid
 *
 * Loaded through next/font so they self-host: no render-blocking request to
 * Google, and no layout shift from a late swap.
 */
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
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
        className={`${instrumentSans.variable} ${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
