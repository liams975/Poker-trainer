import type { DayPoint } from '@poker/engine';

/**
 * Accuracy per day.
 *
 * Inline SVG, not canvas. `docs/01-architecture.md` says DOM over canvas for
 * the 169-cell grid and the reasoning generalises: a DOM chart inherits the
 * theme, can be asserted on by a test, and can carry real text for a screen
 * reader. A canvas is an opaque rectangle to all three.
 *
 * **A day with no practice draws a gap, not a zero.** `accuracyOverTime`
 * returns `null` for those, and joining across them would draw a line plunging
 * to the floor every rest day — which reads as "got much worse" rather than
 * "did not play".
 *
 * Colour carries nothing here. The line is one hue, and the numbers live in the
 * table beneath, so this satisfies the palette rule by not participating in it.
 */
const WIDTH = 720;
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 32 };

function shortDay(day: string): string {
  // `2026-08-24` -> `24 Aug`, without pulling in a date library for one label.
  const [, month, date] = day.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(date)} ${months[Number(month) - 1] ?? ''}`;
}

export function AccuracyChart({ points }: { points: readonly DayPoint[] }) {
  const played = points.filter((point) => point.accuracy !== null);

  if (played.length === 0) {
    return (
      <p className="text-sm text-ink-muted" data-testid="accuracy-chart-empty">
        No answers in this window yet. Drill a few spots and the trend appears here.
      </p>
    );
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const x = (index: number) => PAD.left + index * step;
  const y = (accuracy: number) => PAD.top + (1 - accuracy) * plotHeight;

  /**
   * Segments, not one path. A gap day breaks the line rather than being
   * interpolated across, so the chart cannot imply practice that did not happen.
   */
  const segments: string[] = [];
  let current: string[] = [];

  points.forEach((point, index) => {
    if (point.accuracy === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.accuracy).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  return (
    <figure className="flex flex-col gap-3" data-testid="accuracy-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-labelledby="accuracy-chart-title accuracy-chart-desc"
      >
        <title id="accuracy-chart-title">Recent accuracy by day</title>
        <desc id="accuracy-chart-desc">
          {`${played.length} ${played.length === 1 ? 'day' : 'days'} with answers, between ` +
            `${shortDay(points[0]!.day)} and ${shortDay(points.at(-1)!.day)}. ` +
            'The table below lists every value.'}
        </desc>

        {[0, 0.5, 1].map((line) => (
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
              {line * 100}
            </text>
          </g>
        ))}

        {segments.map((path) => (
          <path key={path} d={path} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
        ))}

        {points.map((point, index) =>
          point.accuracy === null ? null : (
            <circle
              key={point.day}
              cx={x(index)}
              cy={y(point.accuracy)}
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
          <caption>Accuracy by day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Spots</th>
              <th scope="col">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.day}>
                <th scope="row">{point.day}</th>
                <td>{point.attempts}</td>
                <td>
                  {point.accuracy === null
                    ? 'no answers'
                    : `${Math.round(point.accuracy * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
