import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-start justify-center gap-6 px-14">
      <p className="label-caps text-ink-muted">404 · not in the index</p>
      <h1 className="font-display text-6xl tracking-[-0.02em]">That page does not exist.</h1>
      <Link
        href="/dashboard"
        className="text-base text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
