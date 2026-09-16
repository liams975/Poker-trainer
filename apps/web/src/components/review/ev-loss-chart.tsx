import type { DayPoint } from '@poker/engine';

/**
 * EV lost per spot, per day.
 *
 * Phase 15 re-pointed this from accuracy. Accuracy was never the right measure
 * here and docs/03 says why: two of the four grade tiers are correct answers to
 * a mixed spot, so a percentage of "right" answers does not describe skill. The
 * v2 deck asks for the same thing in frame 2i — `0.52 → 0.19bb`.
 *
 * `accuracyOverTime` already returned `avgEvLoss` on every point, so nothing in
 * the engine changed; the chart had simply been drawing the other field.
 *
 * **Lower is better, so the axis is inverted** against the accuracy version:
 * zero sits at the top. A line falling across this chart is somebody improving,
 * which is the reading the deck's own caption assumes.
 *
 * Inline SVG, not canvas. `docs/01-architecture.md` says DOM over canvas for the
 * 169-cell grid and the reasoning generalises: a DOM chart inherits the theme,
 * can be asserted on by a test, and can carry real text for a screen reader.
 *
 * **A day with no practice draws a gap, not a zero.** Points are `null` for
 * those, and joining across them would draw a line plunging to zero every rest
 * day — which on *this* axis would read as a flawless session rather than as an
 * absence. The inversion makes the gap rule matter more, not less.
 */
const WIDTH = 720;
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

/** A floor for the axis, so a good week does not get a wildly magnified scale. */
const MIN_CEILING = 0.2;

function shortDay(day: string): string {
  // `2026-08-24` -> `24 Aug`, without pulling in a date library for one label.
  const [, month, date] = day.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(date)} ${months[Number(month) - 1] ?? ''}`;
}

export function EvLossChart({ points }: { points: readonly DayPoint[] }) {
  const played = points.filter((point) => point.avgEvLoss !== null);

  if (played.length === 0) {
    return (
      <p className="text-sm text-ink-muted" data-testid="ev-loss-chart-empty">
        No answers in this window yet. Drill a few spots and the trend appears here.
      </p>
    );
  }

  /**
   * The ceiling is the worst day, with a floor under it. Scaling tightly to a
   * strong week would turn a 0.02bb wobble into a mountain range.
   */
  const worst = played.reduce((max, point) => Math.max(max, point.avgEvLoss ?? 0), 0);
  const ceiling = Math.max(worst, MIN_CEILING);

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const x = (index: number) => PAD.left + index * step;
  // Inverted: zero — no EV given up — is the top of the chart.
  const y = (evLoss: number) => PAD.top + (evLoss / ceiling) * plotHeight;

  /**
   * Segments, not one path. A gap day breaks the line rather than being
   * interpolated across, so the chart cannot imply practice that did not happen.
   */
  const segments: string[] = [];
  let current: string[] = [];

  points.forEach((point, index) => {
    if (point.avgEvLoss === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(
      `${current.length === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.avgEvLoss).toFixed(1)}`,
    );
  });
  if (current.length > 1) segments.push(current.join(' '));

  return (
    <figure className="flex flex-col gap-3" data-testid="ev-loss-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-labelledby="ev-loss-chart-title ev-loss-chart-desc"
      >
        <title id="ev-loss-chart-title">EV lost per spot by day — lower is better</title>
        <desc id="ev-loss-chart-desc">
          {`${played.length} ${played.length === 1 ? 'day' : 'days'} with answers, between ` +
            `${shortDay(points[0]!.day)} and ${shortDay(points.at(-1)!.day)}. ` +
            'The table below lists every value.'}
        </desc>

        {[0, ceiling / 2, ceiling].map((line) => (
          <g key={line}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(line)}
              y2={y(line)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(line) + 4}
              textAnchor="end"
              className="fill-ink-muted"
              style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
            >
              {line.toFixed(2)}
            </text>
          </g>
        ))}

        {segments.map((path) => (
          <path key={path} d={path} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
        ))}

        {points.map((point, index) =>
          point.avgEvLoss === null ? null : (
            <circle
              key={point.day}
              cx={x(index)}
              cy={y(point.avgEvLoss)}
              // Bigger when it is the only point: one day of history draws no
              // line at all, so the dot is the whole chart and a 2.5px dot
              // reads as a rendering fault rather than as data.
              r={played.length === 1 ? 4 : 2.5}
              fill="var(--color-ink)"
            />
          ),
        )}

        {/*
          The ends of the *window*, not of the data.
          Labelling the first and last day with answers put both labels on top
          of each other the moment somebody had practised on only one day —
          which is every new account's first week. The window's ends are always
          apart, and they also say what the axis actually spans.
        */}
        <text
          x={x(0)}
          y={HEIGHT - 6}
          textAnchor="start"
          className="fill-ink-muted"
          style={{ fontSize: 10 }}
        >
          {shortDay(points[0]!.day)}
        </text>
        <text
          x={x(points.length - 1)}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-ink-muted"
          style={{ fontSize: 10 }}
        >
          {shortDay(points.at(-1)!.day)}
        </text>
      </svg>

      {/* The chart's accessible equivalent, and the reason `desc` above does
          not try to summarise a shape in a sentence. Visually hidden, fully
          navigable, and it is real data rather than a description of data. */}
      <figcaption className="sr-only">
        <table>
          <caption>EV lost per spot by day, in big blinds. Lower is better.</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Spots</th>
              <th scope="col">EV lost per spot</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.day}>
                <th scope="row">{point.day}</th>
                <td>{point.attempts}</td>
                <td>{point.avgEvLoss === null ? 'no answers' : `${point.avgEvLoss.toFixed(2)}bb`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
