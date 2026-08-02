'use client';

import {
  BRAND,
  ChartBox,
  GRID,
  RESPONSIVE,
  SERIES,
  TICKS,
  TOOLTIP_DARK,
  TOOLTIP_LIGHT,
  crosshair,
  seriesColour,
  useChart,
} from '../../../components/chart-kit';

/**
 * The dashboard's charts.
 *
 * ★ WHY THIS FILE IS A CLIENT COMPONENT AND THE PAGE IS NOT ★
 *
 * A chart measures the DOM and draws to a canvas, so it cannot render on the server. Isolating it
 * here keeps the page a server component: the data is fetched and reduced server-side, and only
 * the drawing ships to the browser.
 *
 * ★ THESE WERE RECHARTS UNTIL 2026-08-02 ★
 *
 * They moved to Chart.js when the owner asked for one library across the website and the companion
 * app. The reasoning is in chart-kit.tsx; what matters here is that every decision the owner made
 * about these charts survived the move — the colours, which series sits on which axis, the two
 * tooltip treatments, the spelled-out month, the hand-written legends. A library change is not a
 * licence to redesign a page somebody already tuned.
 */

export { BRAND, SERIES, seriesColour };

/* ----------------------------------------------------------- activity chart */

/** Bar labels for the year view. Index 0 is January, matching EXTRACT(MONTH) minus one. */
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;

/** Full names, for the tooltip — there is room there, and "Jul" beside a figure reads as clipped. */
const MONTH_NAME = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
] as const;

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
 * The five series, in draw order.
 *
 * ★ WHICH AXIS A SERIES SITS ON IS A DECISION, NOT A DETAIL ★
 *
 * Messages, voice and forum posts are the same kind of quantity — things people did — so they
 * share an axis and can be compared directly. That is the whole reason they were split apart: a
 * quiet week of chat with a big voice night used to look identical to a steady week of typing.
 *
 * Members and Elite sign-ins are counts of PEOPLE, in tens where actions run to hundreds. On the
 * actions axis they would press flat against the floor and read as "nobody plays".
 */
const ACTIVITY_SERIES = [
  /*
   * ORANGE, per the owner: "keep the message color orange". It was cyan, and the member line was
   * orange — so the colour they associated with messages was on the wrong series.
   */
  { key: 'messages', name: 'Discord messages', colour: BRAND.orange, axis: 'actions' },
  { key: 'voice', name: 'Voice joins', colour: BRAND.magenta, axis: 'actions' },
  /*
   * Forum posts are counted in ones and twos next to hundreds of messages, so this usually sits
   * near the floor — which is honest. Its own axis would inflate three posts into a mountain.
   */
  { key: 'forum', name: 'Forum posts', colour: BRAND.violet, axis: 'actions' },
  // Moved off orange, which now belongs to messages. Gold is the nearest unused warm tone, so the
  // chart still reads the same way at a glance.
  { key: 'members', name: 'Members active', colour: BRAND.warning, axis: 'members' },
  { key: 'signIns', name: 'Elite sign-ins', colour: BRAND.success, axis: 'members' },
] as const;

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
 * ★ LINES ONLY ★
 *
 * Squadron owner, 2026-07-31: "the discord orange line, with the blue filling, lets remove the
 * blue filling, use lines only please." It was an area with an orange stroke over a CYAN gradient
 * — so the fill did not even match its own line, and on a chart carrying five series it read as a
 * coloured region behind four unrelated lines rather than as one of them.
 */
export function ActivityChart({
  days,
  monthLabel,
  granularity = 'day',
}: {
  days: HeatDay[];
  monthLabel: string;
  /*
   * What one bar covers. The year view buckets by MONTH — 365 points on a panel that already thins
   * 31 labels would be a solid block of ink answering nothing — and a month bucket labelled
   * "day 7" is the kind of wrong nobody spots for months.
   */
  granularity?: 'day' | 'month';
}) {
  const busiest = days.length === 0 ? undefined : days.reduce((a, b) => (b.messages > a.messages ? b : a));
  const active = days.filter((d) => d.messages > 0);
  const busiestMembers =
    days.length === 0 ? undefined : days.reduce((a, b) => (b.members > a.members ? b : a));

  /** `7` as `July 2026` in the year view, `7 July 2026` in the month view. */
  const bucketLabel = (day: number): string =>
    granularity === 'month'
      ? `${MONTH_NAME[day - 1] ?? String(day)} ${monthLabel}`
      : `${String(day)} ${monthLabel}`;

  const canvas = useChart<'line'>(
    () => ({
      type: 'line',
      data: {
        labels: days.map((d) => d.day),
        datasets: ACTIVITY_SERIES.map((s) => ({
          label: s.name,
          data: days.map((d) => d[s.key]),
          borderColor: s.colour,
          backgroundColor: s.colour,
          borderWidth: 2,
          // The Recharts curve was `type="monotone"`; this is the same interpolation, and it
          // matters because a plain cubic overshoots into negative territory on a spiky series.
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          // Nothing until you hover, then a dot on the line you are reading about.
          pointHoverRadius: 3,
          yAxisID: s.axis,
        })),
      },
      options: {
        ...RESPONSIVE,
        // Hovering anywhere in a column reports every series at that point, which is the question
        // somebody has when they point at a date.
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              ...TICKS,
              autoSkip: false,
              /*
               * Every other DAY, but every MONTH. Twelve labels fit comfortably; thirty-one do
               * not, and the shape is what matters across a month rather than the exact dates.
               */
              callback: (_value, index) => {
                const day = days[index]?.day;
                if (day === undefined) return '';
                if (granularity === 'month') return MONTH_ABBR[day - 1] ?? String(day);
                return index % 2 === 0 ? String(day) : '';
              },
            },
          },
          actions: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            grid: GRID,
            border: { display: false },
            ticks: TICKS,
          },
          members: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            // No gridlines from the right axis: two sets of horizontal lines at different spacings
            // is a moiré, not a scale.
            grid: { display: false },
            border: { display: false },
            ticks: { ...TICKS, color: BRAND.orangeBright },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_DARK,
            callbacks: {
              /*
               * ★ THE MONTH SPELLED OUT IN THE YEAR VIEW ★
               *
               * Squadron owner: "replace the month number with the actual spelling of the month
               * please! this is confusing to spell!" — and it was: a bucket labelled "7 2026" is
               * genuinely ambiguous between the 7th of a month and July.
               *
               * Days stay numeric, because "15 July" is unambiguous and spelling a day out would
               * be noise.
               */
              title: (items) => bucketLabel(days[items[0]?.dataIndex ?? 0]?.day ?? 0),
              label: (item) =>
                ` ${item.dataset.label ?? ''}: ${Number(item.parsed.y).toLocaleString('en-GB')}`,
            },
          },
        },
      },
      plugins: [crosshair],
    }),
    [days, monthLabel, granularity],
  );

  return (
    <div>
      <ChartBox
        height={200}
        label={`Squadron activity across ${days.length} ${granularity === 'month' ? 'months' : 'days'} of ${monthLabel}`}
        canvasRef={canvas}
      />

      {/* ------------------------------------------------------------ legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--color-border-hairline)] pt-3 text-[11px]">
        {ACTIVITY_SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-0.5 w-5 rounded"
              style={{ backgroundColor: s.colour }}
            />
            {/*
              "Elite sign-ins", not "sign-ins". The hub has its own sign-in, and a legend on the
              admin console reading just "Sign-ins" beside two Discord series would be read as
              website logins by anybody who had not written it.
            */}
            <span className="text-[var(--color-text-secondary)]">{s.name}</span>
          </span>
        ))}

        {busiest !== undefined && busiest.messages > 0 && (
          <span className="text-[var(--color-text-secondary)]">
            Busiest{' '}
            <span className="font-mono text-[var(--color-brand-cyan-bright)]">
              {granularity === 'month'
                ? `${MONTH_ABBR[busiest.day - 1] ?? busiest.day} ${monthLabel}`
                : `${busiest.day} ${monthLabel.split(' ')[0]}`}
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
 * Horizontal because commander names and ship types do not fit under a vertical bar — they end up
 * rotated forty-five degrees, which is unreadable at ten rows.
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
  const canvas = useChart<'bar'>(
    () => ({
      type: 'bar',
      data: {
        labels: data.map((d) => d.label),
        datasets: [
          {
            label: unit,
            data: data.map((d) => d.value),
            backgroundColor: data.map((_d, i) => (colourful ? seriesColour(i) : colour)),
            // Rounded on the growing end only. A bar rounded at its origin looks detached from the
            // axis it is measured from.
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 3, bottomRight: 3 },
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        ...RESPONSIVE,
        indexAxis: 'y',
        interaction: { mode: 'index', intersect: false },
        scales: {
          // Hidden. The bar lengths carry the comparison and the tooltip carries the number; an
          // axis of round figures underneath adds a third way to read the same thing.
          x: { display: false, beginAtZero: true },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              ...TICKS,
              font: { size: 11 },
              autoSkip: false,
              /*
               * Truncated rather than wrapped. A canvas cannot reflow a label, so a long ship name
               * would otherwise push the plot area down to nothing on a ten-row chart.
               */
              callback: (_v, index) => {
                const label = data[index]?.label ?? '';
                return label.length > 22 ? `${label.slice(0, 21)}…` : label;
              },
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_LIGHT,
            callbacks: {
              // The full label, even when the axis truncated it — this is where somebody looks to
              // find out what the clipped row actually said.
              title: (items) => data[items[0]?.dataIndex ?? 0]?.label ?? '',
              label: (item) => ` ${Number(item.parsed.x).toLocaleString('en-GB')} ${unit}`,
            },
          },
        },
      },
    }),
    [data, unit, colour, colourful],
  );

  return (
    <ChartBox
      height={Math.max(160, data.length * 34)}
      label={`${data.length} ranked by ${unit}`}
      canvasRef={canvas}
    />
  );
}

/* --------------------------------------------------------------------- donut */

export function Donut({ data, unit }: { data: Datum[]; unit: string }) {
  const total = data.reduce((a, d) => a + d.value, 0);

  const canvas = useChart<'doughnut'>(
    () => ({
      type: 'doughnut',
      data: {
        labels: data.map((d) => d.label),
        datasets: [
          {
            data: data.map((d) => d.value),
            backgroundColor: data.map((_d, i) => seriesColour(i)),
            borderWidth: 0,
            // A hairline of background between segments, so two adjacent slices of similar
            // lightness still read as two.
            spacing: 2,
            // Leaves room for the total in the middle — see below.
            cutout: '66%',
          },
        ],
      },
      options: {
        ...RESPONSIVE,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_DARK,
            callbacks: {
              title: () => '',
              label: (item) =>
                ` ${item.label}: ${Number(item.parsed).toLocaleString('en-GB')} ${unit}`,
            },
          },
        },
      },
    }),
    [data, unit],
  );

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-52 w-52 shrink-0">
        <ChartBox height={208} label={`Split of ${total.toLocaleString('en-GB')} ${unit}`} canvasRef={canvas} />

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
        A written legend rather than the library's own. Built-in legends wrap into an unreadable
        line at ten entries and cannot show the value beside the name, which is half of what
        somebody is looking for.
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
 *
 * ★ NOT A CHART.JS CHART, AND THAT IS NOT AN INCONSISTENCY ★
 *
 * It is four divs with percentage widths. A charting library adds nothing to a single bar with no
 * axes and no scale — it would replace text a screen reader can read with a canvas it cannot.
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
