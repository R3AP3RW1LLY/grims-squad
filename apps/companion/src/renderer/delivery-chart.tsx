import type { JSX } from 'preact';
import { C } from './ui.js';

/**
 * Deliveries over time, stacked by commodity.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial."
 *
 * ★ AN INLINE SVG, AND THE BUCKET IS THE SERVER'S CHOICE ★
 *
 * A charting library would be tens of kilobytes in a desktop app whose whole renderer is 35, for a
 * shape that is rectangles. And the hour-or-day decision is made where the data is — a build that
 * started this morning wants hours, one running three weeks wants days, and the client should not
 * be re-deriving that from rows it would have to fetch in full to see.
 */

export interface DeliveryBucket {
  readonly at: string;
  readonly byCommodity: Record<string, number>;
  readonly total: number;
}

/**
 * Colours for the stack.
 *
 * ★ ASSIGNED BY POSITION IN A STABLE ORDER, NOT HASHED ★
 *
 * A hash of the commodity name would be stable across renders and would also give two adjacent
 * segments the same colour often enough to matter. Ordering the commodities by how much was
 * delivered and taking colours in sequence means the biggest contributors are always the most
 * distinct, which is what somebody reads first.
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

const H = 130;
const PAD = { top: 8, bottom: 22, left: 44, right: 8 };

export function DeliveryChart({
  buckets,
  bucket,
}: {
  buckets: readonly DeliveryBucket[];
  bucket: 'hour' | 'day';
}): JSX.Element {
  if (buckets.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
        Nothing delivered yet. Bars appear here as cargo is handed over.
      </p>
    );
  }

  // Ordered by total delivered, so the palette's most distinct colours land on the commodities that
  // dominate the chart.
  const totals = new Map<string, number>();
  for (const b of buckets) {
    for (const [commodity, amount] of Object.entries(b.byCommodity)) {
      totals.set(commodity, (totals.get(commodity) ?? 0) + amount);
    }
  }
  const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const colour = new Map(order.map((c, i) => [c, PALETTE[i % PALETTE.length] as string]));

  const peak = Math.max(...buckets.map((b) => b.total));
  const W = Math.max(320, PAD.left + PAD.right + buckets.length * 22);
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  // Capped so a chart with three bars does not draw them a third of the width of the panel.
  const barW = Math.min(28, (plotW / buckets.length) * 0.72);

  const label = (iso: string): string => {
    const d = new Date(iso);
    return bucket === 'hour'
      ? `${d.getHours()}:00`
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', minWidth: `${Math.min(W, 640)}px` }}
          role="img"
          aria-label={`Deliveries per ${bucket}, stacked by commodity. Peak ${peak.toLocaleString()} tonnes.`}
        >
          {[0, 0.5, 1].map((f) => {
            const y = PAD.top + plotH * (1 - f);
            return (
              <g key={f}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={C.hairline} strokeWidth="1" />
                <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill={C.faint}>
                  {Math.round(peak * f).toLocaleString()}
                </text>
              </g>
            );
          })}

          {buckets.map((b, i) => {
            const x = PAD.left + (plotW / buckets.length) * (i + 0.5) - barW / 2;
            let y = PAD.top + plotH;

            /*
             * Stacked in the SAME order for every bar, so a commodity keeps its vertical position
             * across the chart. Sorting each bar by its own amounts would make the segments jump
             * between bars and the shape unreadable.
             */
            const segments = order
              .filter((c) => (b.byCommodity[c] ?? 0) > 0)
              .map((c) => {
                const amount = b.byCommodity[c] ?? 0;
                const h = peak > 0 ? (amount / peak) * plotH : 0;
                y -= h;
                return { c, amount, h, y };
              });

            return (
              <g key={b.at}>
                {segments.map((s) => (
                  <rect
                    key={s.c}
                    x={x}
                    y={s.y}
                    width={barW}
                    // A hairline minimum, so a small delivery is still visible rather than rounding
                    // away to a bar that looks like nothing was hauled at all.
                    height={Math.max(1, s.h)}
                    fill={colour.get(s.c)}
                  >
                    <title>{`${label(b.at)} · ${s.c} · ${s.amount.toLocaleString()} t`}</title>
                  </rect>
                ))}
                <text
                  x={x + barW / 2}
                  y={H - 7}
                  textAnchor="middle"
                  fontSize="9"
                  fill={C.faint}
                >
                  {label(b.at)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '8px' }}>
        {order.slice(0, 8).map((c) => (
          <span key={c} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: C.dim }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: colour.get(c) }} />
            {c}
            <span style={{ color: C.faint }}>{(totals.get(c) ?? 0).toLocaleString()} t</span>
          </span>
        ))}
      </div>

      <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.faint }}>
        {/* The bucket is stated, because a chart whose bars mean "an hour" and one whose bars mean
            "a day" look identical and describe very different builds. */}
        One bar per {bucket} · {buckets.length} {bucket === 'hour' ? 'hours' : 'days'} with
        deliveries
      </p>
    </div>
  );
}
