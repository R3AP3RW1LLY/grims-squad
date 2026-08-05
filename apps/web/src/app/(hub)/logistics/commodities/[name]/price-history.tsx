'use client';

import type { HistoryPoint } from '../../../../../lib/api';
import {
  BRAND,
  ChartBox,
  GRID,
  RESPONSIVE,
  TICKS,
  TOOLTIP_DARK,
  crosshair,
  useChart,
} from '../../../../../components/chart-kit';

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
 * ★ THIS WAS A HAND-ROLLED SVG UNTIL 2026-08-02, AND THE REVERSAL WAS DELIBERATE ★
 *
 * The first version drew polylines by hand, justified on size: a library was tens of kilobytes on
 * a page that is otherwise server-rendered HTML, for axes we would restyle anyway. That reasoning
 * was sound about SIZE and wrong about the thing that mattered — it had no tooltips, so the one
 * question somebody actually brings to a price chart, "what was it worth on Tuesday", could not be
 * answered by pointing at Tuesday. The owner asked for a charting library across both apps, and
 * every honest behaviour below survived the move intact.
 */

/**
 * A series, with gaps where the galaxy stopped trading.
 *
 * ★ NaN IS THE GAP, AND IT HAS TO BE ★
 *
 * An hour nobody traded records a null. Joining across it would draw a straight line through a
 * hole — claiming a price held steady through an hour in which there was no price at all, which is
 * the single most misleading thing a price chart can do.
 *
 * The point still has to occupy its place on the time axis, so the gap cannot simply be dropped:
 * removing it would slide the following hours backwards and compress a two-day outage into
 * nothing. NaN keeps the x-position and breaks the line, which is exactly the shape of the truth.
 */
function series(points: readonly HistoryPoint[], pick: (p: HistoryPoint) => number | null) {
  return points.map((p) => {
    const v = pick(p);
    return { x: new Date(p.observedAt).getTime(), y: v === null ? Number.NaN : v };
  });
}

export function PriceHistory({ points }: { points: readonly HistoryPoint[] }) {
  const ts = points.map((p) => new Date(p.observedAt).getTime());
  const t0 = ts.length === 0 ? 0 : Math.min(...ts);
  const t1 = ts.length === 0 ? 0 : Math.max(...ts);
  const hours = Math.round((t1 - t0) / 3_600_000);
  const label = hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;

  const values = points.flatMap((p) => [p.avgBuy, p.avgSell].filter((v): v is number => v !== null));
  const lo = values.length === 0 ? 0 : Math.min(...values);
  const hi = values.length === 0 ? 0 : Math.max(...values);

  /*
   * ★ HOOKS RUN BEFORE THE EMPTY STATES, NOT AFTER ★
   *
   * The two "nothing to draw yet" returns below are real and stay. They sit AFTER this hook
   * because a component that returns early past a hook changes its hook count between renders,
   * which React refuses at exactly the moment the first reading arrives and the panel switches
   * from words to a chart. The hook is harmless when there is nothing to draw: no canvas is
   * mounted, so nothing is built.
   */
  const canvas = useChart<'line'>(
    () => ({
      type: 'line',
      data: {
        datasets: [
          {
            label: 'average buy',
            data: series(points, (p) => p.avgBuy),
            borderColor: BRAND.cyan,
            backgroundColor: BRAND.cyan,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            // Straight segments. A smoothed curve through hourly averages invents prices between
            // the readings, and on a market chart an invented price is a lie with a shape.
            tension: 0,
            spanGaps: false,
          },
          {
            label: 'average sell',
            data: series(points, (p) => p.avgSell),
            borderColor: BRAND.orange,
            backgroundColor: BRAND.orange,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0,
            spanGaps: false,
          },
        ],
      },
      options: {
        ...RESPONSIVE,
        interaction: { mode: 'index', intersect: false },
        scales: {
          /*
           * A LINEAR scale over timestamps, not a category scale over labels.
           *
           * Hourly readings are not evenly spaced — the rollup misses an hour whenever the worker
           * is down — and a category axis would draw a missing hour as no gap at all. This also
           * avoids Chart.js's time scale, which needs a date adapter as a second dependency to
           * format labels we are formatting ourselves anyway.
           */
          x: {
            type: 'linear',
            grid: { display: false },
            border: { color: BRAND.hairline },
            ticks: {
              ...TICKS,
              maxTicksLimit: 6,
              /*
               * ★ INSTANTS, LABELLED IN THE BROWSER'S OWN ZONE — AUDITED 2026-08-04 ★
               *
               * The axis is linear over epoch milliseconds, so every point's POSITION is
               * zone-independent — this chart had no yesterday-shift to fix. Only the labels
               * have a zone, and the browser's is the right one here: this is a client
               * component, so the machine rendering it is the one the reader is sitting at.
               * The one trap is below — across two days the label drops the clock, so a
               * reading taken near local midnight wears a bare day label. That is why the
               * tooltip title always keeps hour and minute, in this same zone: the day tick
               * is never the only witness to when a point was.
               */
              callback: (value) =>
                new Date(Number(value)).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  // The clock only when the whole window is inside two days. Across a fortnight
                  // "2 Aug 14:00" is four characters of noise per label.
                  ...(hours < 48 ? { hour: '2-digit', minute: '2-digit' } : {}),
                }),
            },
          },
          y: {
            grid: GRID,
            border: { display: false },
            ticks: {
              ...TICKS,
              count: 3,
              callback: (value) => Math.round(Number(value)).toLocaleString('en-GB'),
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_DARK,
            callbacks: {
              // The clock stays here even when the axis ticks have dropped it — a point near
              // local midnight is otherwise identified by a day label alone, and the day is the
              // one part of the timestamp that straddling midnight gets wrong.
              title: (items) =>
                new Date(Number(items[0]?.parsed.x ?? 0)).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              label: (item) =>
                ` ${item.dataset.label ?? ''}: ${Math.round(Number(item.parsed.y)).toLocaleString('en-GB')} cr`,
            },
            // An hour with no trade is a gap in the line, and a tooltip row reading "NaN" would
            // undo the honesty the gap exists to preserve.
            filter: (item) => Number.isFinite(item.parsed.y),
          },
        },
      },
      plugins: [crosshair],
    }),
    [points, hours],
  );

  /*
   * ★ ONE POINT IS NOT A LINE ★
   *
   * The first hour after the rollup job starts, every commodity has exactly one reading. A line
   * through one point draws nothing at all — a blank panel that reads as broken rather than as
   * new. Said in words instead.
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

  if (values.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nobody has traded this in the period we hold.
      </p>
    );
  }

  return (
    <div>
      <ChartBox
        height={220}
        label={`Average buy and sell price over the last ${label}, from ${lo.toLocaleString()} to ${hi.toLocaleString()} credits`}
        canvasRef={canvas}
      />

      <p className="m-0 mt-2 flex flex-wrap items-center gap-4 font-mono text-[11px] text-[var(--color-text-secondary)]">
        <span>
          <span
            aria-hidden
            className="mr-1.5 inline-block h-2 w-4 align-middle"
            style={{ background: BRAND.cyan }}
          />
          average buy
        </span>
        <span>
          <span
            aria-hidden
            className="mr-1.5 inline-block h-2 w-4 align-middle"
            style={{ background: BRAND.orange }}
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
