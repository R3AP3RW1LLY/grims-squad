import type { HistoryPoint } from '../../../../../lib/api';

/**
 * How a commodity's price has moved.
 *
 * ★ IT WILL BE NEARLY EMPTY AT FIRST, AND IT SAYS SO ★
 *
 * Squadron owner, 2026-08-02, told the history table had never once been written to: "start
 * recording now, show charts as they fill".
 *
 * So this has to be honest about a thing most charts hide. It draws what we hold and states how
 * much that is — a line across two points is not a trend, and a chart that looks the same whether
 * it has two points or two thousand is one that misleads for a fortnight and then quietly becomes
 * useful with nobody the wiser.
 *
 * ★ AN INLINE SVG, NOT A CHARTING LIBRARY ★
 *
 * Two series over at most 2,160 hourly points is a polyline. A library would be ~50KB on a page
 * that is otherwise server-rendered HTML, for axes we would restyle anyway to match the site.
 */

const W = 960;
const H = 220;
const PAD = { top: 12, right: 16, bottom: 26, left: 56 };

export function PriceHistory({ points }: { points: readonly HistoryPoint[] }) {
  /*
   * ★ ONE POINT IS NOT A LINE ★
   *
   * The first hour after the rollup job starts, every commodity has exactly one reading. An SVG
   * polyline through one point draws nothing at all — a blank panel that reads as broken rather
   * than as new. Said in words instead.
   */
  if (points.length < 2) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        {points.length === 0
          ? 'No price history recorded yet.'
          : 'Only one hour recorded so far — the chart appears once there are two.'}{' '}
        We began keeping hourly prices on 2 August 2026, and this fills in from there.
      </p>
    );
  }

  const ts = points.map((p) => new Date(p.observedAt).getTime());
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);

  const values = points.flatMap((p) => [p.avgBuy, p.avgSell].filter((v): v is number => v !== null));
  if (values.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nobody has traded this in the period we hold.
      </p>
    );
  }

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  /*
   * A flat series would give hi === lo and divide by zero, painting the line off the top of the
   * box. Widening by 1 keeps a genuinely steady price as a straight line through the middle, which
   * is what it is.
   */
  const span = hi - lo === 0 ? 1 : hi - lo;

  const x = (t: number): number =>
    PAD.left + ((t - t0) / (t1 - t0 === 0 ? 1 : t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number): number =>
    PAD.top + (1 - (v - lo) / span) * (H - PAD.top - PAD.bottom);

  /**
   * A polyline for one series, BROKEN wherever the data is.
   *
   * An hour nobody traded records a null, and joining across it would draw a straight line through
   * a gap — claiming a price held steady through an hour in which there was no price at all. The
   * series is emitted as separate segments so a gap looks like a gap.
   */
  const segments = (pick: (p: HistoryPoint) => number | null): string[] => {
    const out: string[] = [];
    let run: string[] = [];

    points.forEach((p, i) => {
      const v = pick(p);
      if (v === null) {
        if (run.length > 1) out.push(run.join(' '));
        run = [];
        return;
      }
      run.push(`${x(ts[i] ?? t0).toFixed(1)},${y(v).toFixed(1)}`);
    });

    if (run.length > 1) out.push(run.join(' '));
    return out;
  };

  const buy = segments((p) => p.avgBuy);
  const sell = segments((p) => p.avgSell);

  const hours = Math.round((t1 - t0) / 3_600_000);
  const label = hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Average buy and sell price over the last ${label}, from ${lo.toLocaleString()} to ${hi.toLocaleString()} credits`}
      >
        {[0, 0.5, 1].map((f) => {
          const v = lo + f * span;
          const yy = y(v);
          return (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yy}
                y2={yy}
                stroke="var(--color-border-hairline)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={yy + 4}
                textAnchor="end"
                className="font-mono"
                fontSize="11"
                fill="var(--color-text-dim)"
              >
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}

        {sell.map((d, i) => (
          <polyline
            key={`s${i}`}
            points={d}
            fill="none"
            stroke="var(--color-brand-orange)"
            strokeWidth="2"
          />
        ))}
        {buy.map((d, i) => (
          <polyline
            key={`b${i}`}
            points={d}
            fill="none"
            stroke="var(--color-brand-cyan)"
            strokeWidth="2"
          />
        ))}
      </svg>

      <p className="m-0 mt-2 flex flex-wrap items-center gap-4 font-mono text-[11px] text-[var(--color-text-secondary)]">
        <span>
          <span
            aria-hidden
            className="mr-1.5 inline-block h-2 w-4 align-middle"
            style={{ background: 'var(--color-brand-cyan)' }}
          />
          average buy
        </span>
        <span>
          <span
            aria-hidden
            className="mr-1.5 inline-block h-2 w-4 align-middle"
            style={{ background: 'var(--color-brand-orange)' }}
          />
          average sell
        </span>
        {/*
          The sample size, stated. A reader deciding whether to trust the shape of a line needs to
          know whether it is drawn from nine hours or ninety days, and this is the only place that
          can tell them.
        */}
        <span>
          {points.length.toLocaleString()} hourly readings over {label}
        </span>
      </p>
    </div>
  );
}
