'use client';

import { useMemo, useState } from 'react';
import type { ColonyCharts } from '../../../../lib/api';
import {
  ChartBox,
  GRID,
  RESPONSIVE,
  TICKS,
  TOOLTIP_DARK,
  seriesColour,
  useChart,
} from '../../../../components/chart-kit';

/**
 * What went into this build, and who put it there.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial", "we
 * want the who has hauled to be a stacked bar chart", and — on whether that meant one chart or two
 * — both, switchable. Then: "people should be able to have full interaction with colonization
 * either from the website or from the app."
 *
 * That last one is why these exist here at all. The companion app has had them since they were
 * built, and a member without the app could see the same build with less of the picture.
 */

/** A stacked bar chart over any two dimensions. Both charts here are the same shape, cut twice. */
function StackedBars({
  labels,
  stacks,
  note,
  height,
}: {
  labels: readonly string[];
  /** One record per label. Keys become the stack segments. */
  stacks: ReadonlyArray<Readonly<Record<string, number>>>;
  note: string;
  height: number;
}) {
  const canvas = useChart<'bar'>(
    () => {
      /*
       * Ordered by total delivered, so the palette's most distinct colours land on the segments
       * that dominate the chart. Sorted rather than hashed from the name: a hash is stable but
       * hands adjacent segments similar colours often enough to matter.
       */
      const totals = new Map<string, number>();
      for (const stack of stacks) {
        for (const [series, amount] of Object.entries(stack)) {
          totals.set(series, (totals.get(series) ?? 0) + amount);
        }
      }
      const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);

      return {
        type: 'bar',
        data: {
          labels: [...labels],
          datasets: order.map((series, i) => ({
            label: series,
            data: stacks.map((stack) => stack[series] ?? 0),
            backgroundColor: seriesColour(i),
            borderRadius: 3,
            // Every dataset keeps its place in the stack across all bars, so a segment does not
            // move up and down the chart between one bar and the next.
            stack: 'deliveries',
          })),
        },
        options: {
          ...RESPONSIVE,
          // Hovering anywhere over a bar reports the WHOLE stack rather than only the segment the
          // cursor is inside, which is the question somebody has when they point at a bar.
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              stacked: true,
              grid: { display: false },
              border: { display: false },
              ticks: { ...TICKS, autoSkip: true, maxRotation: 0 },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              grid: GRID,
              border: { display: false },
              ticks: {
                ...TICKS,
                // Tonnages run to tens of thousands; the raw numbers crowd the axis and add
                // nothing the tooltip does not say exactly.
                callback: (value) => {
                  const n = Number(value);
                  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
                },
              },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...TOOLTIP_DARK,
              callbacks: {
                label: (item) =>
                  ` ${item.dataset.label ?? ''}: ${Number(item.parsed.y).toLocaleString()} t`,
                /*
                 * The column total, appended. A stack of five segments is five lines a reader
                 * would otherwise have to add up in their head.
                 */
                footer: (items) =>
                  `Total ${items.reduce((sum, i) => sum + Number(i.parsed.y), 0).toLocaleString()} t`,
              },
              // Segments contributing nothing to this column are noise in a stacked tooltip.
              filter: (item) => Number(item.parsed.y) > 0,
            },
          },
        },
      };
    },
    [labels, stacks],
  );

  return (
    <div>
      <ChartBox height={height} label={note} canvasRef={canvas} />
      <p className="m-0 mt-2 font-mono text-[11px] text-[var(--color-text-secondary)]">{note}</p>
    </div>
  );
}

/**
 * Deliveries over time, stacked by commodity or by commander.
 *
 * Both stackings arrive in the same payload, so the switch is instant. A toggle that waits on the
 * network to redraw bars the page already holds reads as broken.
 */
/**
 * How the chart is cut.
 *
 *   commodity     time on the x-axis, stacked by what went in
 *   commander     the same bars, stacked by who put it in
 *   perCommander  one bar per person, stacked by what they brought
 *
 * ★ THE THIRD USED TO BE ITS OWN CHART ON ITS OWN TAB — SQUADRON OWNER, 2026-08-03 ★
 *
 * "it looks like we're giving duplicate charts in the Deliveries and in the Haulers tabs."
 *
 * They were not the same picture — one had time on the x-axis and the other had people — but they
 * were two stacked bar charts with commander names in both, sitting next to each other, and that
 * reads as duplication whatever the axes say. All three cuts live on one toggle now, and the
 * leaderboard stays where it was because a chart cannot answer "am I third or fourth".
 */
type StackBy = 'commodity' | 'commander' | 'perCommander';

export function DeliveryTimeline({ chart }: { chart: ColonyCharts }) {
  const [stackBy, setStackBy] = useState<StackBy>('commodity');
  const buckets = stackBy === 'commodity' ? chart.byCommodity : chart.byCommander;

  /*
   * ★ MEMOISED, AND NOT AS AN OPTIMISATION ★
   *
   * `StackedBars` rebuilds its chart whenever these arrays change identity, and a fresh
   * `buckets.map(...)` on every render changes identity on every render — a chart torn down and
   * reconstructed each time, animating from zero whenever anything on the page moves. The hooks
   * also sit above the empty state below, because a component that returns early past a hook
   * changes its hook count between renders and React refuses at exactly the moment the first
   * delivery lands and the panel switches from words to a chart.
   */
  const labels = useMemo(
    () =>
      buckets.map((b) => {
        const d = new Date(b.at);
        return chart.bucket === 'hour'
          ? `${String(d.getHours()).padStart(2, '0')}:00`
          : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      }),
    [buckets, chart.bucket],
  );
  const stacks = useMemo(() => buckets.map((b) => b.bySeries), [buckets]);

  if (buckets.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing delivered yet. Bars appear here as cargo is handed over.
      </p>
    );
  }

  return (
    <div>
      {/*
        Two words rather than a dropdown: there are exactly two answers, and a select box that has
        to be opened to find out what the alternative is hides half the feature.
      */}
      <div className="mb-3 flex gap-1">
        {(['commodity', 'commander', 'perCommander'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStackBy(option)}
            aria-pressed={stackBy === option}
            className={
              stackBy === option
                ? 'rounded border border-[var(--color-border-active)] bg-[var(--color-surface-panel-raised)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-text-primary)]'
                : 'rounded border border-transparent px-2.5 py-1 font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }
          >
            {/* "per commander" rather than "perCommander" — the key is code, the label is English. */}
            {option === 'perCommander' ? 'per commander' : `by ${option}`}
          </button>
        ))}
      </div>

      {stackBy === 'perCommander' ? (
        <StackedBars
          labels={chart.haulers.map((h) => h.commander)}
          stacks={chart.haulers.map((h) => h.byCommodity)}
          height={Math.max(180, Math.min(320, chart.haulers.length * 46))}
          note={`${chart.haulers.length} commander${
            chart.haulers.length === 1 ? '' : 's'
          } · stacked by commodity`}
        />
      ) : (
        <StackedBars
          labels={labels}
          stacks={stacks}
          height={220}
          /* The bucket is stated: a chart whose bars mean "an hour" and one whose bars mean "a
             day" look identical and describe very different builds. So is the stacking, because
             the two views share their axes and mean completely different things. */
          note={`One bar per ${chart.bucket} · stacked by ${stackBy} · ${buckets.length} ${
            chart.bucket === 'hour' ? 'hours' : 'days'
          } with deliveries`}
        />
      )}
    </div>
  );
}

