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
  void: '#05070a',
  /*
   * ★ TWO COLOURS ADDED FOR THE SPLIT ACTIVITY SERIES — owner, 2026-07-30 ★
   *
   * "make this line purple" for forum activity, and for voice "choose a seperate color for the
   * voice activity that doesnt match other colors used".
   *
   * Both were picked against the EXISTING palette rather than in isolation: orange, orangeBright,
   * orangeDim, cyan, cyanBright, success green, warning gold and hostile salmon are all already in
   * play. Violet and magenta are the two hue regions nothing else occupies, and they are far
   * enough apart from each other to stay distinguishable at a 2px stroke — which is the only width
   * anybody will actually see them at.
   */
  violet: '#a97bff',
  magenta: '#ff4fd8',
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

/**
 * The hover tooltip on every chart.
 *
 * ★ LIGHT ON DARK, NOT DARK ON DARK ★
 *
 * Squadron owner, 2026-07-30: "the tool tip color is a dark color, the dark colors are hard to
 * read, can we lighten this up".
 *
 * It used to be `panelRaised` (#121820) — a panel colour, one shade off the panel BEHIND it. That
 * is the actual problem: a tooltip has to read as floating ABOVE the chart, and a surface within a
 * few percent of its background reads as part of it, with the numbers competing against gridlines
 * and bars showing through the edges.
 *
 * So it inverts: the near-white text token becomes the surface, and the void token becomes the
 * ink. Both are existing tokens and the pairing is already used elsewhere for accent-filled chips,
 * so this stays inside the palette rather than introducing a colour.
 *
 * ★ THE ITEM COLOUR HAS TO BE OVERRIDDEN, AND THAT IS THE SUBTLE PART ★
 *
 * Recharts colours each tooltip row with its SERIES colour by default. Those are chosen to be
 * legible on a near-black chart — cyan-bright (#5cd9ff) and success (#3dff8f) on near-white are
 * close to invisible. Inverting the surface without also pinning `itemStyle` would have swapped one
 * unreadable tooltip for a worse one, and only on the coloured charts.
 */
const TOOLTIP_STYLE = {
  backgroundColor: BRAND.text,
  border: `1px solid ${BRAND.orange}`,
  borderRadius: 4,
  fontSize: 12,
  color: BRAND.void,
  // Lifts it off the chart. Without a shadow an inverted box looks pasted on rather than floating.
  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.55)',
} as const;

/** Forces every row's text to the dark ink — see the note above on series colours. */
const TOOLTIP_ITEM_STYLE = { color: BRAND.void } as const;

/** The label row (the x-axis value). Slightly muted so it reads as a heading, not as data. */
const TOOLTIP_LABEL_STYLE = { color: BRAND.void, fontWeight: 600 } as const;

/* ----------------------------------------------------------- activity chart */

export interface HeatDay {
  /** Day of the month, 1-indexed. */
  readonly day: number;
  readonly messages: number;
  readonly members: number;
  /**
   * Elite sign-ins that day — `LoadGame` in the journal.
   *
   * Squadron owner, 2026-07-29. A THIRD question the other two cannot answer:
   * Discord activity says who is talking, and this says who is actually flying.
   * A squadron can be loud in chat and empty in the black, or the reverse, and
   * only one of those is a problem an officer can do anything about.
   */
  readonly signIns: number;
  /** Voice channel joins that day. Separate from messages — see the note on the series. */
  readonly voice: number;
  /** Forum posts that day. */
  readonly forum: number;
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
            itemStyle={TOOLTIP_ITEM_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            cursor={{ stroke: BRAND.orange, strokeWidth: 1, strokeDasharray: '3 3' }}
            labelFormatter={(d) => `${String(d)} ${monthLabel}`}
            /*
              A lookup rather than a ternary. With three series the ternary read
              "messages ? Actions : Members" and would have labelled the new
              green line "Members" — two lines in one tooltip claiming to be the
              same thing.
            */
            formatter={(v, n) => [
              Number(v).toLocaleString('en-GB'),
              {
                messages: 'Discord messages',
                voice: 'Voice joins',
                forum: 'Forum posts',
                members: 'Members',
                signIns: 'Elite sign-ins',
              }[String(n)] ??
                String(n),
            ]}
          />
          <Area
            yAxisId="actions"
            type="monotone"
            dataKey="messages"
            /*
             * ORANGE, per the owner: "keep the message color orange". It was cyan, and the member
             * line was orange — so the colour they associated with messages was on the wrong
             * series. The member line moves to gold below rather than staying orange, because two
             * orange lines on one chart is worse than either arrangement.
             */
            stroke={BRAND.orange}
            strokeWidth={2}
            fill="url(#actionsFill)"
          />
          {/*
            ★ VOICE, SPLIT OUT OF THE OLD COMBINED FIGURE ★

            On the ACTIONS axis with messages, because they are the same kind of quantity and the
            whole point of splitting them is to compare them. A quiet week of chat with a big voice
            night used to look identical to a steady week of typing.
          */}
          <Line
            yAxisId="actions"
            type="monotone"
            dataKey="voice"
            stroke={BRAND.magenta}
            strokeWidth={2}
            dot={false}
          />
          {/*
            ★ FORUM ACTIVITY — purple, as asked ★

            Also on the actions axis. Forum posts are counted in ones and twos next to hundreds of
            messages, so this will usually sit near the floor — which is honest. Giving it its own
            axis would inflate three posts into a mountain and imply the forum is as busy as
            Discord.
          */}
          <Line
            yAxisId="actions"
            type="monotone"
            dataKey="forum"
            stroke={BRAND.violet}
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="members"
            type="monotone"
            dataKey="members"
            // Moved off orange, which now belongs to messages. Gold is the nearest unused warm
            // tone, so the chart still reads the same way at a glance.
            stroke={BRAND.warning}
            strokeWidth={2}
            dot={false}
          />
          {/*
            ★ ELITE SIGN-INS — squadron owner, 2026-07-29 ★

            Green, and on the MEMBERS axis rather than the actions one. Sign-ins
            are counted in tens like the member line, while actions run into the
            hundreds; sharing the actions axis would press this flat against the
            floor and it would read as "nobody plays".
          */}
          <Line
            yAxisId="members"
            type="monotone"
            dataKey="signIns"
            stroke={BRAND.success}
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
            style={{ backgroundColor: BRAND.orange }}
          />
          <span className="text-[var(--color-text-secondary)]">Discord messages</span>
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5 rounded"
            style={{ backgroundColor: BRAND.magenta }}
          />
          <span className="text-[var(--color-text-secondary)]">Voice joins</span>
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5 rounded"
            style={{ backgroundColor: BRAND.violet }}
          />
          <span className="text-[var(--color-text-secondary)]">Forum posts</span>
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5 rounded"
            style={{ backgroundColor: BRAND.warning }}
          />
          <span className="text-[var(--color-text-secondary)]">Members active</span>
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5 rounded"
            style={{ backgroundColor: BRAND.success }}
          />
          {/*
            "Elite sign-ins", not "sign-ins". The hub has its own sign-in, and a
            legend on the admin console reading just "Sign-ins" beside two
            Discord series would be read as website logins by anybody who had
            not written it.
          */}
          <span className="text-[var(--color-text-secondary)]">Elite sign-ins</span>
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
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
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
              itemStyle={TOOLTIP_ITEM_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
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
