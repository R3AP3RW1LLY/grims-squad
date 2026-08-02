import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { C } from './ui.js';

/**
 * Deliveries, stacked.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial", then
 * "add a charting library so our graphs and dashboard look really good please!", and then "we want
 * the who has hauled to be a stacked bar chart" — switchable between the two ways of cutting it.
 *
 * ★ THIS REPLACES A HAND-ROLLED SVG, AND THAT WAS A DELIBERATE REVERSAL ★
 *
 * The first version drew rectangles by hand, on the reasoning that a library was tens of kilobytes
 * in a renderer that was 43KB total, for a shape that is rectangles. The reasoning was sound about
 * SIZE and wrong about the thing that mattered: the owner looked at it and said it looked basic,
 * which it did. Tooltips, animation, legends and axis handling are most of what makes a chart feel
 * finished, and every one of them is work we were not going to do by hand.
 *
 * ★ REGISTERED PIECEMEAL, NOT `registerables` ★
 *
 * Chart.js ships every chart type, scale and plugin it has. Importing the lot pulls radar, polar,
 * doughnut, the time scale and its date adapter into a bundle that draws bars — `registerables` is
 * the convenient import and roughly three times the size of what is actually used here.
 */

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

/**
 * One bar of the time chart.
 *
 * `bySeries` rather than `byCommodity`: the same bar is stacked by commodity in one view and by
 * commander in the other, and a field named for one of them while holding the other is the kind of
 * lie that costs somebody an hour.
 */
export interface DeliveryBucket {
  readonly at: string;
  readonly bySeries: Record<string, number>;
  readonly total: number;
}

/** One commander's column: everything they have hauled, split by commodity. */
export interface HaulerStack {
  readonly commander: string;
  readonly byCommodity: Record<string, number>;
  readonly total: number;
}

/**
 * Colours for the stack.
 *
 * Assigned by position in an order sorted by total delivered, not hashed from the name: a hash is
 * stable but hands adjacent segments similar colours often enough to matter, where this guarantees
 * the biggest contributors are the most distinct — which is what somebody reads first.
 */
const PALETTE = [
  '#3fd0d4',
  '#ff7a33',
  '#a78bfa',
  '#4ade80',
  '#fbbf24',
  '#f87171',
  '#60a5fa',
  '#f472b6',
];

/**
 * A stacked bar chart over any two dimensions.
 *
 * Both charts on a project page are the same picture cut differently — time by commodity, time by
 * commander, commander by commodity — so they are one component. Three near-identical chart
 * configurations is three places for the tooltip to drift.
 */
function StackedBars({
  labels,
  stacks,
  note,
}: {
  labels: readonly string[];
  /** One record per label. Keys become the stack segments. */
  stacks: ReadonlyArray<Readonly<Record<string, number>>>;
  note: string;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const chart = useRef<Chart | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (element === null || labels.length === 0) return;

    // Ordered by total delivered, so the palette's most distinct colours land on the segments that
    // dominate the chart.
    const totals = new Map<string, number>();
    for (const stack of stacks) {
      for (const [series, amount] of Object.entries(stack)) {
        totals.set(series, (totals.get(series) ?? 0) + amount);
      }
    }
    const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: [...labels],
        datasets: order.map((series, i) => ({
          label: series,
          data: stacks.map((stack) => stack[series] ?? 0),
          backgroundColor: PALETTE[i % PALETTE.length] as string,
          borderRadius: 3,
          // Every dataset keeps its position in the stack across all bars, so a segment does not
          // move up and down the chart between one bar and the next.
          stack: 'deliveries',
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 320 },
        /*
         * `index` mode with `intersect: false` means hovering anywhere over a bar shows the WHOLE
         * stack — every segment in that column — rather than only the one the cursor happens to be
         * inside. That is the question somebody is asking when they point at a bar.
         */
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: C.faint, font: { size: 10 } },
            border: { color: C.hairline },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: C.hairline },
            border: { display: false },
            ticks: {
              color: C.faint,
              font: { size: 10 },
              // Tonnages run to tens of thousands; the raw numbers crowd the axis and add nothing.
              callback: (value) => {
                const n = Number(value);
                return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
              },
            },
          },
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: C.dim,
              font: { size: 11 },
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: 'rectRounded',
            },
          },
          tooltip: {
            backgroundColor: C.void,
            borderColor: C.hairline,
            borderWidth: 1,
            titleColor: C.text,
            bodyColor: C.dim,
            padding: 10,
            callbacks: {
              label: (item) => ` ${item.dataset.label}: ${Number(item.parsed.y).toLocaleString()} t`,
              /*
               * The slice total, appended. A stack of five segments is five lines that a reader
               * would otherwise have to add up in their head to answer "how much is that".
               */
              footer: (items) => {
                const total = items.reduce((sum, i) => sum + Number(i.parsed.y), 0);
                return `Total ${total.toLocaleString()} t`;
              },
            },
            // Segments that contributed nothing to this column are noise in a stacked tooltip.
            filter: (item) => Number(item.parsed.y) > 0,
          },
        },
      },
    };

    chart.current = new Chart(element, config);

    /*
     * Destroyed on every change, not updated in place.
     *
     * Chart.js keeps a registry keyed on the canvas element and THROWS if a second chart is created
     * on one it already owns — so a component that re-renders without cleaning up dies on its
     * second render with an error that names the canvas rather than the cause.
     */
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [labels, stacks]);

  return (
    <div>
      {/* A fixed height, because `maintainAspectRatio: false` means the canvas fills its parent and
          a parent with no height collapses to nothing. */}
      <div style={{ height: '200px' }}>
        <canvas ref={canvas} />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.faint }}>{note}</p>
    </div>
  );
}

/** Deliveries over time, stacked by commodity or by commander. */
export function DeliveryChart({
  buckets,
  bucket,
  by,
}: {
  buckets: readonly DeliveryBucket[];
  bucket: 'hour' | 'day';
  by: 'commodity' | 'commander';
}): JSX.Element {
  /*
   * ★ MEMOISED, AND NOT AS AN OPTIMISATION ★
   *
   * `StackedBars` rebuilds its chart whenever these arrays change identity, and a fresh
   * `buckets.map(...)` on every render changes identity on every render — which is a chart torn
   * down and reconstructed on each one, animating from zero every time anything on the page moves.
   * That is the same shape of bug as the overlay rebuild loop: correct-looking code whose only
   * symptom is that something never settles.
   */
  const labels = useMemo(
    () =>
      buckets.map((b) => {
        const d = new Date(b.at);
        return bucket === 'hour'
          ? `${String(d.getHours()).padStart(2, '0')}:00`
          : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      }),
    [buckets, bucket],
  );
  const stacks = useMemo(() => buckets.map((b) => b.bySeries), [buckets]);

  if (buckets.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
        Nothing delivered yet. Bars appear here as cargo is handed over.
      </p>
    );
  }

  return (
    <StackedBars
      labels={labels}
      stacks={stacks}
      /* The bucket is stated: a chart whose bars mean "an hour" and one whose bars mean "a day"
         look identical and describe very different builds. So is the stacking, because the two
         views have the same axes and completely different meanings. */
      note={`One bar per ${bucket} · stacked by ${by} · ${buckets.length} ${
        bucket === 'hour' ? 'hours' : 'days'
      } with deliveries`}
    />
  );
}

/**
 * One column per commander, stacked by commodity.
 *
 * ★ WHAT A PLAIN TALLY CANNOT SAY ★
 *
 * "Who has hauled" as a list of totals says one person brought 40,000 tonnes. It does not say
 * whether that was forty thousand tonnes of steel or a share of everything — the difference
 * between somebody who covered a commodity and somebody who did a bit of each run.
 */
export function HaulerChart({ haulers }: { haulers: readonly HaulerStack[] }): JSX.Element {
  const labels = useMemo(() => haulers.map((h) => h.commander), [haulers]);
  const stacks = useMemo(() => haulers.map((h) => h.byCommodity), [haulers]);

  if (haulers.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
        No deliveries recorded yet.
      </p>
    );
  }

  return (
    <StackedBars
      labels={labels}
      stacks={stacks}
      note={`${haulers.length} commander${haulers.length === 1 ? '' : 's'} · stacked by commodity`}
    />
  );
}
