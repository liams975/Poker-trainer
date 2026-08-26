/**
 * The TODAY strip: streak, daily goal, XP level, accuracy trend.
 *
 * Every figure is a real zero, not a placeholder — a brand-new account genuinely
 * has no streak and no XP, so this is what the strip correctly shows on day
 * one. Phase 9 computes the numbers; nothing here fabricates them in the
 * meantime.
 *
 * The accent colour is used here and in the rail, and nowhere else. docs/05
 * reserves it for exactly this: "streak and XP rail ONLY. Never appears in a
 * range grid."
 */
function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className={`font-mono text-xl ${accent ? 'text-accent' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}

export function TodayStrip() {
  return (
    <section
      aria-labelledby="today-heading"
      className="rounded-[var(--radius)] border border-line bg-surface px-6 py-4"
    >
      <h2 id="today-heading" className="sr-only">
        Today
      </h2>
      <dl className="flex flex-wrap items-center gap-x-12 gap-y-4">
        <Stat label="Streak" value="0 days" accent />
        <Stat label="Daily goal" value="0 / 20" />
        <Stat label="XP" value="0" accent />
        {/* An em dash, not "0%": zero accuracy and no data are different
            claims, and the second one is the true one here. */}
        <Stat label="Accuracy" value="—" />
      </dl>
    </section>
  );
}
