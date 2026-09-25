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
 * Phase 17 drew it as a dot plot: one dot a day, the seven-day mean as a dash
 * behind it, rest days hatched. A line joined days the reader had to trust
 * were comparable; dots let each day stand as its own sample.
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
const WIDTH = 980;
const HEIGHT = 240;
const PAD = { top: 14, right: 12, bottom: 30, left: 44 };

/** A floor for the axis, so a good week does not get a wildly magnified scale. */
const MIN_CEILING = 0.2;

/** How many days the mean behind the dots looks back over. */
const MEAN_WINDOW = 7;

function shortDay(day: string): string {
  // `2026-08-24` -> `24 Aug`, without pulling in a date library for one label.
  const [, month, date] = day.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(date)} ${months[Number(month) - 1] ?? ''}`;
}

/**
 * The trailing mean at each day that has answers, weighted by how many answers
 * each day carried — a day of three spots does not pull as hard as a day of
 * forty. `null` on a rest day, for the same reason the dot is.
 */
function trailingMean(points: readonly DayPoint[]): (number | null)[] {
  return points.map((point, index) => {
    if (point.avgEvLoss === null) return null;
    let lost = 0;
    let spots = 0;
    for (const day of points.slice(Math.max(0, index - MEAN_WINDOW + 1), index + 1)) {
      if (day.avgEvLoss === null) continue;
      lost += day.avgEvLoss * day.attempts;
      spots += day.attempts;
    }
    return spots === 0 ? null : lost / spots;
  });
}

export function EvLossChart({
  points,
  id = 'ev-loss-chart',
  caption,
}: {
  points: readonly DayPoint[];
  /** Unique per page: the hatching pattern and the title are referenced by id. */
  id?: string;
  /** A visible figure caption, beside the figure number. */
  caption?: { figure: string; text: string } | undefined;
}) {
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
  const column = plotWidth / Math.max(points.length, 1);

  // Each day owns a column; its dot sits in the middle of it.
  const x = (index: number) => PAD.left + index * column + column / 2;
  // Inverted: zero — no EV given up — is the top of the chart.
  const y = (evLoss: number) => PAD.top + (evLoss / ceiling) * plotHeight;

  const means = trailingMean(points);
  const lastPlayed = points.reduce((last, point, index) => (point.avgEvLoss === null ? last : index), -1);
  const hatch = `${id}-hatch`;

  return (
    <figure className="m-0 flex flex-col gap-4" data-testid="ev-loss-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
      >
        <title id={`${id}-title`}>EV lost per spot by day — lower is better</title>
        <desc id={`${id}-desc`}>
          {`${played.length} ${played.length === 1 ? 'day' : 'days'} with answers, between ` +
            `${shortDay(points[0]!.day)} and ${shortDay(points.at(-1)!.day)}. ` +
            'The table below lists every value.'}
        </desc>

        <defs>
          {/* Hatching: the app's one mark for *unknown*. A day with no answers
              is not a zero and must not be drawn as one. */}
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-line-soft)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {points.map((point, index) =>
          point.avgEvLoss === null ? (
            <rect
              key={`rest-${point.day}`}
              x={PAD.left + index * column + 1.5}
              y={PAD.top}
              width={Math.max(column - 3, 1)}
              height={plotHeight}
              fill={`url(#${hatch})`}
            />
          ) : null,
        )}

        {[0, ceiling / 2, ceiling].map((line, index) => (
          <g key={line}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(line)}
              y2={y(line)}
              stroke={index === 0 ? 'var(--color-line)' : 'var(--color-line-soft)'}
              strokeDasharray={index === 0 ? undefined : '2 4'}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 10}
              y={y(line) + 4}
              textAnchor="end"
              className="fill-ink-muted font-mono"
              style={{ fontSize: 11 }}
            >
              {line.toFixed(2)}
            </text>
          </g>
        ))}

        {/* The seven-day mean, as a short dash behind each day: the trend,
            without joining across a gap the way a line would. */}
        {means.map((mean, index) =>
          mean === null ? null : (
            <line
              key={`mean-${points[index]!.day}`}
              x1={x(index) - column * 0.32}
              x2={x(index) + column * 0.32}
              y1={y(mean)}
              y2={y(mean)}
              stroke="var(--color-ink-muted)"
              strokeOpacity={0.6}
              strokeWidth={2}
            />
          ),
        )}

        {points.map((point, index) =>
          point.avgEvLoss === null ? null : (
            <circle
              key={point.day}
              cx={x(index)}
              cy={y(point.avgEvLoss)}
              // The latest day is the reader's own "now", so it is the one mark
              // on the chart in the game layer's accent.
              r={index === lastPlayed ? 5.5 : 3.5}
              fill={index === lastPlayed ? 'var(--color-accent)' : 'var(--color-ink)'}
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
          x={PAD.left}
          y={HEIGHT - 8}
          textAnchor="start"
          className="fill-ink-muted font-mono"
          style={{ fontSize: 11 }}
        >
          {shortDay(points[0]!.day)}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 8}
          textAnchor="end"
          className="fill-ink-muted font-mono"
          style={{ fontSize: 11 }}
        >
          {shortDay(points.at(-1)!.day)}
        </text>
      </svg>

      {caption ? (
        <p className="flex items-baseline gap-6 pl-11" aria-hidden="true">
          <span className="shrink-0 font-mono text-xs text-ink-muted">{caption.figure}</span>
          <span className="max-w-[48rem] text-sm text-ink-muted">{caption.text}</span>
        </p>
      ) : null}

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
