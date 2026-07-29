'use client';

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
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

/* ----------------------------------------------------------- activity chart */

export interface HeatDay {
  /** Day of the month, 1-indexed. */
  readonly day: number;
  readonly messages: number;
  readonly members: number;
  /** 0 = Sunday, matching Date.getUTCDay(). Retained for weekend shading. */
  readonly weekday: number;
}

/**
 * The month, as a time series.
 *
 * ★ WHY THIS REPLACED A CALENDAR HEATMAP ★
 *
 * The calendar was thirty-one squares each big enough to hold two numbers, and
 * at full width that is an enormous block of colour for one panel — reported as
 * "way too big, really hard to look at". It was also the wrong tool: a grid of
 * shaded squares makes you compare colours to answer "is the squadron getting
 * busier", which is a question a LINE answers instantly.
 *
 * Two series, because they are genuinely different questions and one loud
 * member should not look like a crowd:
 *
 *   area   total actions — how much happened
 *   line   distinct members — how many people it was
 *
 * Separate axes, since the two are orders of magnitude apart. Sharing one would
 * flatten the member line onto the floor.
 */
export function ActivityChart({ days, monthLabel }: { days: HeatDay[]; monthLabel: string }) {
  const busiest = days.length === 0 ? undefined : days.reduce((a, b) => (b.messages > a.messages ? b : a));
  const active = days.filter((d) => d.messages > 0);
  const busiestMembers =
    days.length === 0 ? undefined : days.reduce((a, b) => (b.members > a.members ? b : a));

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            {/*
              A gradient, not a flat fill. At 200px tall a solid block hides the
              line crossing it; fading to nothing keeps both readable.
            */}
            <linearGradient id="actionsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND.cyan} stopOpacity={0.5} />
              <stop offset="100%" stopColor={BRAND.cyan} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(147,164,184,0.08)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: BRAND.textSecondary, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            // Every other day. Thirty-one labels on a narrow panel overlap into
            // a smear, and the shape is what matters here rather than the dates.
            interval={1}
          />
          <YAxis
            yAxisId="actions"
            tick={{ fill: BRAND.textSecondary, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <YAxis
            yAxisId="members"
            orientation="right"
            tick={{ fill: BRAND.orangeBright, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ stroke: BRAND.orange, strokeWidth: 1, strokeDasharray: '3 3' }}
            labelFormatter={(d) => `${String(d)} ${monthLabel}`}
            formatter={(v, n) => [Number(v).toLocaleString('en-GB'), n === 'messages' ? 'Actions' : 'Members']}
          />
          <Area
            yAxisId="actions"
            type="monotone"
            dataKey="messages"
            stroke={BRAND.cyanBright}
            strokeWidth={2}
            fill="url(#actionsFill)"
          />
          <Line
            yAxisId="members"
            type="monotone"
            dataKey="members"
            stroke={BRAND.orange}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ------------------------------------------------------------ legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--color-border-hairline)] pt-3 text-[11px]">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5 rounded"
            style={{ backgroundColor: BRAND.cyanBright }}
          />
          <span className="text-[var(--color-text-secondary)]">Actions</span>
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5 rounded"
            style={{ backgroundColor: BRAND.orange }}
          />
          <span className="text-[var(--color-text-secondary)]">Members active</span>
        </span>

        {busiest !== undefined && busiest.messages > 0 && (
          <span className="text-[var(--color-text-secondary)]">
            Busiest{' '}
            <span className="font-mono text-[var(--color-brand-cyan-bright)]">
              {busiest.day} {monthLabel.split(' ')[0]}
            </span>{' '}
            at{' '}
            <span className="font-mono text-[var(--color-text-primary)]">
              {busiest.messages.toLocaleString('en-GB')}
            </span>
          </span>
        )}
        {busiestMembers !== undefined && busiestMembers.members > 0 && (
          <span className="text-[var(--color-text-secondary)]">
            Most people{' '}
            <span className="font-mono text-[var(--color-brand-orange)]">
              {busiestMembers.members}
            </span>{' '}
            on the{' '}
            <span className="font-mono text-[var(--color-text-primary)]">
              {busiestMembers.day}
            </span>
          </span>
        )}
        <span className="text-[var(--color-text-secondary)]">
          <span className="font-mono text-[var(--color-text-primary)]">{active.length}</span> active
          {' '}
          {active.length === 1 ? 'day' : 'days'}
        </span>
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

              6%, not 12%. At half a column the old threshold hid the three
              single-officer segments and left a bare "2" and "4" floating above
              a legend that then repeated them — numbers with nothing to attach
              them to. Full width gives a 6% segment ample room for one digit.
            */}
            {d.value / total > 0.06 && (
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
