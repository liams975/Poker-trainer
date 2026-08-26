import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-sm text-ink-muted">404</p>
      <h1 className="font-display text-lg font-semibold">That page does not exist.</h1>
      <Link href="/dashboard" className="text-sm text-ink underline underline-offset-4">
        Back to the dashboard
      </Link>
    </div>
  );
}
