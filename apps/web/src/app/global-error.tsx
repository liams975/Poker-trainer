'use client';

/**
 * Catches errors thrown by the root layout itself, which error.tsx cannot —
 * it renders *inside* that layout. So this file has to supply its own <html>
 * and <body>, and cannot rely on globals.css having loaded. Hence inline
 * styles rather than Tailwind classes: this is the one place in the app where
 * the stylesheet may be the thing that failed.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          background: '#0b0f14',
          color: '#e6edf3',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          display: 'flex',
          minHeight: '100dvh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '1.125rem', fontWeight: 600 }}>The app failed to start.</h1>
        <p style={{ color: '#8b9aa8', maxWidth: '28rem', fontSize: '0.875rem' }}>
          Reload the page. If it keeps happening, the reference below will help us find it.
        </p>
        {error.digest ? (
          <p style={{ color: '#8b9aa8', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
            Reference {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
