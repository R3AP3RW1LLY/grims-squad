'use client';

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * The dashboard's charts.
 *
 * ★ WHY THIS FILE IS A CLIENT COMPONENT AND THE PAGE IS NOT ★
 *
 * Recharts measures the DOM to lay itself out, so it cannot render on the
 * server. Isolating it here keeps the page a server component: the data is
 * fetched and reduced server-side, and only the drawing ships to the browser.
 *
 * ★ THE PALETTE IS READ, NOT REDECLARED ★
 *
 * Recharts takes colours as strings and cannot resolve a CSS variable, so the
 * hex values appear literally below — the one place in the app where that is
 * true. They are pulled from the generated theme and pinned by a test, because
 * a chart quietly drifting from the brand is exactly the kind of thing nobody
 * notices until it looks wrong beside everything else.
 */

export const BRAND = {
  orange: '#ff7100',
  orangeBright: '#ff9d3f',
  orangeDim: '#b34f00',
  cyan: '#00c8ff',
  cyanBright: '#5cd9ff',
  success: '#3dff8f',
  warning: '#ffc400',
  hostile: '#ff7a7a',
  panel: '#0b0f14',
  panelRaised: '#121820',
  hairline: 'rgba(255, 113, 0, 0.18)',
  text: '#e8eef5',
  textSecondary: '#93a4b8',
} as const;

/**
 * A rotation for categorical series.
 *
 * Ordered so ADJACENT entries are far apart in hue and brightness. A palette
 * that steps evenly through a gradient looks elegant in isolation and becomes
 * unreadable the moment two neighbouring slices are the same size — which is
 * the normal case for a rank distribution.
 */
/** Picks a series colour, wrapping. Total by construction, so no undefined escapes. */
export function seriesColour(i: number): string {
  return SERIES[i % SERIES.length] ?? BRAND.orange;
}

export const SERIES = [
  BRAND.orange,
  BRAND.cyan,
  BRAND.success,
  BRAND.orangeBright,
  BRAND.warning,
  BRAND.cyanBright,
  BRAND.hostile,
  BRAND.orangeDim,
] as const;

const TOOLTIP_STYLE = {
  backgroundColor: BRAND.panelRaised,
  border: `1px solid ${BRAND.hairline}`,
  borderRadius: 4,
  fontSize: 12,
  color: BRAND.text,
} as const;

/* ------------------------------------------------------------------ heatmap */

export interface HeatDay {
  /** Day of the month, 1-indexed. */
  readonly day: number;
  readonly messages: number;
  readonly members: number;
  /** 0 = Sunday, matching Date.getUTCDay(). */
  readonly weekday: number;
}

/**
 * Five buckets, GitHub's scheme.
 *
 * ★ QUANTILES, NOT EVEN SLICES OF THE RANGE ★
 *
 * Activity is heavily skewed — one day at 1,203 messages against a median near
 * 250. Splitting the RANGE into five equal bands puts almost every day in the
 * bottom bucket and produces a chart that is one bright square and thirty dark
 * ones. Ranking the days and cutting by position spreads them across the scale,
 * which is what makes the shape of the month visible at all.
 */
function bucketise(values: readonly number[]): (v: number) => number {
  const active = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (active.length === 0) return () => 0;

  const at = (q: number) => active[Math.min(active.length - 1, Math.floor(active.length * q))] ?? 0;
  const [q25, q50, q75, q90] = [at(0.25), at(0.5), at(0.75), at(0.9)];

  return (v: number) => {
    if (v <= 0) return 0;
    // Strictly greater, so the quietest active day is bucket 1 rather than 0 —
    // "somebody was here" and "nobody was here" must never look the same.
    if (v > (q90 ?? 0)) return 4;
    if (v > (q75 ?? 0)) return 3;
    if (v > (q50 ?? 0)) return 2;
    // q25 is read for symmetry with the bands above; everything at or below it
    // is bucket 1, which is the fallthrough.
    void q25;
    return 1;
  };
}

/** Empty through busiest. Bucket 0 is a panel-coloured square, not a hole. */
const HEAT = [
  'rgba(147,164,184,0.07)',
  'rgba(0,200,255,0.25)',
  'rgba(0,200,255,0.45)',
  'rgba(92,217,255,0.7)',
  '#5cd9ff',
] as const;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function ActivityHeatmap({ days, monthLabel }: { days: HeatDay[]; monthLabel: string }) {
  const bucket = bucketise(days.map((d) => d.messages));

  /*
   * Laid out as a CALENDAR — weeks down, weekdays across — rather than as
   * GitHub's single ribbon of columns.
   *
   * GitHub's shape exists to fit a whole YEAR in one strip. For one month it
   * produces five thin columns in the corner of a wide panel. A calendar fills
   * the width, gives every day a cell big enough to carry its own number, and
   * is a shape everybody already knows how to read.
   *
   * Monday-first: the squadron's week, and it keeps the weekend together
   * instead of splitting it across both ends.
   */
  // Monday-first, so the leading blanks are counted from Monday rather than
  // from Sunday, which is what (weekday + 6) % 7 does.
  const first = days[0];
  const leading = first === undefined ? 0 : (first.weekday + 6) % 7;
  const cells: Array<HeatDay | null> = [...Array.from({ length: leading }, () => null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<HeatDay | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  /*
   * No seed. Reducing with `days[0]` as the initial value types the accumulator
   * as possibly-undefined for the empty case, and the caller already guarantees
   * a non-empty month — but stating it as a guard is honest, and cheaper than
   * asserting it away.
   */
  const busiest = days.length === 0 ? undefined : days.reduce((a, b) => (b.messages > a.messages ? b : a));

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]"
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {weeks.flat().map((d, i) =>
              d === null ? (
                // A day belonging to the neighbouring month. Kept as an empty
                // slot so the weekday columns stay aligned.
                <div key={`pad-${i}`} aria-hidden="true" className="aspect-square" />
              ) : (
                <div
                  key={d.day}
                  className="group relative aspect-square rounded-sm ring-1 ring-inset ring-[rgba(255,255,255,0.04)] transition-transform hover:scale-105 hover:ring-[var(--color-brand-orange)]"
                  style={{ backgroundColor: HEAT[bucket(d.messages)] ?? HEAT[0] }}
                  title={`${d.day} ${monthLabel}: ${d.messages.toLocaleString('en-GB')} actions from ${d.members} ${d.members === 1 ? 'member' : 'members'}`}
                >
                  <span
                    className={`absolute left-1 top-0.5 font-mono text-[10px] ${
                      bucket(d.messages) >= 3
                        ? 'text-[var(--color-surface-void)]'
                        : 'text-[var(--color-text-dim)]'
                    }`}
                  >
                    {d.day}
                  </span>
                  {/*
                    The member count, only where the square is big enough and
                    the day busy enough to be worth reading. On a quiet day it
                    is noise; on a busy one it is the second half of the story.
                  */}
                  {d.members > 0 && (
                    <span
                      className={`absolute inset-x-0 bottom-1 text-center font-mono text-[10px] ${
                        bucket(d.messages) >= 3
                          ? 'text-[var(--color-surface-void)]'
                          : 'text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {d.members}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        </div>

        {/* ------------------------------------------------------- legend */}
        <aside className="shrink-0 sm:w-44 sm:border-l sm:border-[var(--color-border-hairline)] sm:pl-5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
            Activity
          </p>
          <div className="mb-1 flex items-center gap-1">
            <span className="mr-1 font-mono text-[10px] text-[var(--color-text-dim)]">Less</span>
            {HEAT.map((c, i) => (
              <span
                key={i}
                className="size-3.5 rounded-sm ring-1 ring-inset ring-[rgba(255,255,255,0.04)]"
                style={{ backgroundColor: c }}
              />
            ))}
            <span className="ml-1 font-mono text-[10px] text-[var(--color-text-dim)]">More</span>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            Each square is a day. The small number is how many members were
            active; hover for the total.
          </p>

          {busiest !== undefined && busiest.messages > 0 && (
            <dl className="mt-4 space-y-1.5 border-t border-[var(--color-border-hairline)] pt-3 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-secondary)]">Busiest</dt>
                <dd className="font-mono text-[var(--color-brand-cyan-bright)]">
                  {busiest.day} {monthLabel.split(' ')[0]}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-secondary)]">Peak</dt>
                <dd className="font-mono text-[var(--color-text-primary)]">
                  {busiest.messages.toLocaleString('en-GB')}
                </dd>
              </div>
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- bar charts */

export interface Datum {
  readonly label: string;
  readonly value: number;
  readonly hint?: string | undefined;
}

/**
 * A horizontal bar chart, for rankings with long labels.
 *
 * Horizontal because commander names and ship types do not fit under a vertical
 * bar — they end up rotated forty-five degrees, which is unreadable at ten rows.
 */
export function RankedBars({
  data,
  unit,
  colour = BRAND.cyan,
  colourful = false,
}: {
  data: Datum[];
  unit: string;
  colour?: string;
  /** Give every bar its own colour. For categories, never for a ranking. */
  colourful?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={150}
          tick={{ fill: BRAND.textSecondary, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          // The default hover fill is a pale grey box that looks like a
          // rendering artefact on a dark panel.
          cursor={{ fill: 'rgba(255,113,0,0.08)' }}
          /*
            Recharts types the formatter's value as its own ValueType union, so
            a `(v: number)` signature does not satisfy it. Narrowed at the call
            rather than cast, because the value genuinely can be a string or an
            array and pretending otherwise would crash on the day it is.
          */
          formatter={(v) => [`${Number(v).toLocaleString('en-GB')} ${unit}`, '']}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={colourful ? seriesColour(i) : colour} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* --------------------------------------------------------------------- donut */

export function Donut({ data, unit }: { data: Datum[]; unit: string }) {
  const total = data.reduce((a, d) => a + d.value, 0);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={d.label} fill={seriesColour(i)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v, n) => [`${Number(v).toLocaleString('en-GB')} ${unit}`, n]}
            />
          </PieChart>
        </ResponsiveContainer>

        {/*
          The total in the hole. A donut answers "what is the split"; the one
          question it cannot answer on its own is "out of how many", and putting
          it here costs no space at all.
        */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl text-[var(--color-text-primary)]">
            {total.toLocaleString('en-GB')}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
            {unit}
          </span>
        </div>
      </div>

      {/*
        A written legend rather than Recharts' own. Its built-in one wraps into
        an unreadable line at ten entries and cannot show the value beside the
        name, which is half of what somebody is looking for.
      */}
      <ol className="m-0 min-w-0 flex-1 list-none space-y-1 p-0">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: seriesColour(i) }}
            />
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">
              {d.label}
            </span>
            <span className="shrink-0 font-mono text-[var(--color-text-secondary)]">
              {d.value.toLocaleString('en-GB')}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------- stacked strip */

/**
 * One bar, segmented — for a small set that adds to a meaningful whole.
 *
 * Asked for by name for the leadership appointments, and it is the right shape
 * for them: nine people across a handful of offices is a composition, not a
 * ranking, and stacking it says "this is the leadership" in a way nine separate
 * bars do not.
 */
export function StackedStrip({ data, unit }: { data: Datum[]; unit: string }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total === 0) return null;

  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded ring-1 ring-inset ring-[var(--color-border-hairline)]">
        {data.map((d, i) => (
          <div
            key={d.label}
            className="group relative flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              width: `${(d.value / total) * 100}%`,
              backgroundColor: seriesColour(i),
            }}
            title={`${d.label}: ${d.value} ${unit}`}
          >
            {/*
              The count sits inside its own segment, but ONLY when the segment
              is wide enough to hold it. A number overflowing a 3% sliver is
              worse than no number, and the legend below carries it anyway.
            */}
            {d.value / total > 0.12 && (
              <span className="font-mono text-xs font-semibold text-[var(--color-surface-void)]">
                {d.value}
              </span>
            )}
          </div>
        ))}
      </div>

      <ol className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: seriesColour(i) }}
            />
            <span className="text-[var(--color-text-primary)]">{d.label}</span>
            <span className="font-mono text-[var(--color-text-secondary)]">{d.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
