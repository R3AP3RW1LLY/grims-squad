import { useEffect, useRef } from 'preact/hooks';
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
 * Deliveries over time, stacked by commodity.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial", and
 * then: "add a charting library so our graphs and dashboard look really good please!"
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

export interface DeliveryBucket {
  readonly at: string;
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

export function DeliveryChart({
  buckets,
  bucket,
}: {
  buckets: readonly DeliveryBucket[];
  bucket: 'hour' | 'day';
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const chart = useRef<Chart | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (element === null || buckets.length === 0) return;

    // Ordered by total delivered, so the palette's most distinct colours land on the commodities
    // that dominate the chart.
    const totals = new Map<string, number>();
    for (const b of buckets) {
      for (const [commodity, amount] of Object.entries(b.byCommodity)) {
        totals.set(commodity, (totals.get(commodity) ?? 0) + amount);
      }
    }
    const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

    const labels = buckets.map((b) => {
      const d = new Date(b.at);
      return bucket === 'hour'
        ? `${String(d.getHours()).padStart(2, '0')}:00`
        : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    });

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: order.map((commodity, i) => ({
          label: commodity,
          data: buckets.map((b) => b.byCommodity[commodity] ?? 0),
          backgroundColor: PALETTE[i % PALETTE.length] as string,
          borderRadius: 3,
          // Every dataset keeps its position in the stack across all bars, so a commodity does not
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
         * stack — every commodity delivered in that slice — rather than only the segment the
         * cursor happens to be inside. That is the question somebody is asking when they point at
         * a bar.
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
               * The slice total, appended. A stack of five commodities is five lines that a reader
               * would otherwise have to add up in their head to answer "how much went in that day".
               */
              footer: (items) => {
                const total = items.reduce((sum, i) => sum + Number(i.parsed.y), 0);
                return `Total ${total.toLocaleString()} t`;
              },
            },
            // Segments that contributed nothing to this slice are noise in a stacked tooltip.
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
  }, [buckets, bucket]);

  if (buckets.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
        Nothing delivered yet. Bars appear here as cargo is handed over.
      </p>
    );
  }

  return (
    <div>
      {/* A fixed height, because `maintainAspectRatio: false` means the canvas fills its parent and
          a parent with no height collapses to nothing. */}
      <div style={{ height: '200px' }}>
        <canvas ref={canvas} />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.faint }}>
        {/* The bucket is stated: a chart whose bars mean "an hour" and one whose bars mean "a day"
            look identical and describe very different builds. */}
        One bar per {bucket} · {buckets.length} {bucket === 'hour' ? 'hours' : 'days'} with
        deliveries
      </p>
    </div>
  );
}
