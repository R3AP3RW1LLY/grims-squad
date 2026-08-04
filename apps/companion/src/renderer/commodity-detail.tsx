import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  Chart,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import type { CommodityDetail, HistoryPoint, TradePlace } from '../hub-trade.js';
import { Button, C, Card, Copy, Empty, Problem, Section, Stat, inputStyle, tonnes } from './ui.js';
import { useLive } from './use-live.js';

/**
 * One commodity: what it is worth, where to trade it, and how it has moved.
 *
 * The website's commodity detail page, through the device door — the standing rule that the app
 * mirrors the website, applied to the page the market index links to. Same endpoint family, same
 * filters passed through verbatim, so the two surfaces cannot give different numbers for the same
 * good. The app's one advantage stands here as it does on every trade page: leave the system box
 * blank and distances measure from where the ship actually is, because the device door always
 * knows its member.
 */

// `window.trade` is declared ONCE, in trade.tsx — the same rule window.colony documents: a second
// `declare global` for one object is a conflicting declaration, not an addition.

/*
 * ★ REGISTERED PIECEMEAL, NOT `registerables` ★ — delivery-chart.tsx's rule, applied to lines.
 * Only what a two-line price chart draws: no time scale (the x axis is linear over timestamps,
 * which also spares the date-adapter dependency), and no Legend because the legend is hand-rolled
 * HTML below the canvas, where it can wear the app's text tokens.
 */
Chart.register(LineController, LineElement, LinearScale, PointElement, Tooltip);

const TH: JSX.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px 6px 0',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: C.faint,
  whiteSpace: 'nowrap',
};

const TD: JSX.CSSProperties = {
  padding: '6px 10px 6px 0',
  borderTop: `1px solid ${C.hairline}`,
  fontSize: '12px',
  color: C.dim,
  verticalAlign: 'middle',
};

const NUM: JSX.CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const LABEL: JSX.CSSProperties = {
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: C.faint,
  display: 'block',
  marginBottom: '4px',
};

const cr = (n: number | null): string => (n === null ? '—' : n.toLocaleString());

/** Fleet carriers, which the member has explicitly asked to see if any are here at all. */
const CARRIER = 'Drake-Class Carrier';

/** Supply and demand arrive as strings because the totals run into the billions. */
function bulk(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}bn t`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m t`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k t`;
  return `${n.toLocaleString()} t`;
}

function ls(v: number | null): string {
  if (v === null) return '—';
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M Ls` : `${Math.round(v).toLocaleString()} Ls`;
}

/*
 * ★ FRESHNESS IS A COLUMN, NOT A FOOTNOTE ★ — the website's rule, kept word for word.
 *
 * Every price here was reported by a commander who flew there, and some of those flights were a
 * long time ago. A table that shows a price and not its age invites a member to fly forty light
 * years on a number from 2024. The age is words rather than a date — "3 days ago" is a judgement
 * somebody can make at a glance, and "2024-07-09" is arithmetic.
 */
function ago(iso: string | null): { text: string; stale: boolean } {
  if (iso === null) return { text: 'unknown', stale: true };

  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (!Number.isFinite(days)) return { text: 'unknown', stale: true };

  // Thirty days is the line, because that is roughly where a market has had time to be restocked,
  // repriced, or fought over. Under an hour reads as "now" rather than "0 days".
  const stale = days > 30;
  if (days < 0.04) return { text: 'just now', stale };
  if (days < 1) return { text: `${Math.round(days * 24)}h ago`, stale };
  if (days < 60) return { text: `${Math.round(days)}d ago`, stale };
  return { text: `${Math.round(days / 30)}mo ago`, stale };
}

/**
 * A series over time, with gaps where the galaxy stopped trading.
 *
 * ★ NaN IS THE GAP, AND IT HAS TO BE ★ — an hour nobody traded records a null, and joining across
 * it would draw a straight line through a hole: claiming a price held steady through an hour in
 * which there was no price at all. The point still has to occupy its place on the time axis, so
 * the gap cannot simply be dropped — removing it would slide the following hours backwards and
 * compress a two-day outage into nothing. NaN keeps the x-position and breaks the line.
 */
function series(
  points: readonly HistoryPoint[],
  pick: (p: HistoryPoint) => number | null,
): Array<{ x: number; y: number }> {
  return points.map((p) => {
    const v = pick(p);
    return { x: new Date(p.observedAt).getTime(), y: v === null ? Number.NaN : v };
  });
}

/** The website's price chart, drawn with the pieces delivery-chart.tsx already established. */
function PriceHistoryChart({ points }: { points: readonly HistoryPoint[] }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const chart = useRef<Chart | null>(null);

  const ts = points.map((p) => new Date(p.observedAt).getTime());
  const t0 = ts.length === 0 ? 0 : Math.min(...ts);
  const t1 = ts.length === 0 ? 0 : Math.max(...ts);
  const hours = Math.round((t1 - t0) / 3_600_000);
  const label = hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;

  const values = points.flatMap((p) => [p.avgBuy, p.avgSell].filter((v): v is number => v !== null));
  const lo = values.length === 0 ? 0 : Math.min(...values);
  const hi = values.length === 0 ? 0 : Math.max(...values);

  /*
   * ★ THE EFFECT RUNS BEFORE THE EMPTY STATES, NOT AFTER ★
   *
   * The "nothing to draw yet" returns below are real and stay. They sit AFTER this hook because a
   * component that returns early past a hook changes its hook count between renders — refused at
   * exactly the moment the first reading arrives and the panel switches from words to a chart.
   * The hook is harmless when there is nothing to draw: no canvas is mounted, so nothing is built.
   */
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'average buy',
            data: series(points, (p) => p.avgBuy),
            borderColor: C.cyanCore,
            backgroundColor: C.cyanCore,
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
            borderColor: C.orange,
            backgroundColor: C.orange,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 320 },
        // Hovering anywhere on an hour shows both series for that hour — the question somebody is
        // asking when they point at a price chart is "what was it worth then", not "which pixel".
        interaction: { mode: 'index', intersect: false },
        scales: {
          /*
           * A LINEAR scale over timestamps, not a category scale over labels. Hourly readings are
           * not evenly spaced — the rollup misses an hour whenever the worker is down — and a
           * category axis would draw a missing hour as no gap at all.
           */
          x: {
            type: 'linear',
            grid: { display: false },
            border: { color: C.hairline },
            ticks: {
              color: C.faint,
              font: { size: 10 },
              maxTicksLimit: 6,
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
            // The NEUTRAL border token, not the orange hairline — delivery-chart's rule: a warm
            // gridline reads as data on a chart whose sell line is brand orange.
            grid: { color: C.subtle },
            border: { display: false },
            ticks: {
              color: C.faint,
              font: { size: 10 },
              count: 3,
              callback: (value) => Math.round(Number(value)).toLocaleString('en-GB'),
            },
          },
        },
        plugins: {
          // delivery-chart registers the Legend plugin globally, so it must be told to stand down
          // here — the legend is the HTML caption under the canvas, in the app's own text tokens.
          legend: { display: false },
          tooltip: {
            backgroundColor: C.void,
            borderColor: C.hairline,
            borderWidth: 1,
            titleColor: C.text,
            bodyColor: C.dim,
            padding: 10,
            callbacks: {
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
    };

    chart.current = new Chart(element, config);

    /*
     * Destroyed on every change, not updated in place. Chart.js keeps a registry keyed on the
     * canvas element and THROWS if a second chart is created on one it already owns.
     */
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [points]);

  /*
   * ★ ONE POINT IS NOT A LINE ★ — the first hour after the rollup job starts, every commodity has
   * exactly one reading, and a line through one point draws a blank panel that reads as broken
   * rather than as new. Said in words instead, with how much data there is and since when.
   */
  if (points.length < 2) {
    return (
      <Empty>
        {points.length === 0
          ? 'No price history recorded yet.'
          : 'Only one hour recorded so far — the chart appears once there are two.'}{' '}
        We began keeping hourly prices on 2 August 2026, and this fills in from there.
      </Empty>
    );
  }

  if (values.length === 0) {
    return <Empty>Nobody has traded this in the period we hold.</Empty>;
  }

  return (
    <div>
      {/* A fixed height: `maintainAspectRatio: false` means the canvas fills its parent, and a
          parent with no height collapses to nothing. */}
      <div
        style={{ height: '220px' }}
        role="img"
        aria-label={`Average buy and sell price over the last ${label}, from ${lo.toLocaleString()} to ${hi.toLocaleString()} credits`}
      >
        <canvas ref={canvas} />
      </div>
      <p
        style={{
          margin: '8px 0 0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '16px',
          fontSize: '11px',
          color: C.dim,
        }}
      >
        <span>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '16px',
              height: '8px',
              marginRight: '6px',
              verticalAlign: 'middle',
              background: C.cyanCore,
            }}
          />
          average buy
        </span>
        <span>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '16px',
              height: '8px',
              marginRight: '6px',
              verticalAlign: 'middle',
              background: C.orange,
            }}
          />
          average sell
        </span>
        {/* The sample size, stated. A reader deciding whether to trust the shape of a line needs
            to know whether it is drawn from nine hours or ninety days. */}
        <span style={{ color: C.faint }}>
          {points.length.toLocaleString()} hourly readings over {label}
        </span>
      </p>
    </div>
  );
}

/** Where to buy or sell this, best price first — the website's table in the app's idiom. */
function PlaceTable({
  places,
  side,
  emptyMessage,
}: {
  places: readonly TradePlace[];
  side: 'buy' | 'sell';
  emptyMessage: string;
}): JSX.Element {
  if (places.length === 0) return <Empty>{emptyMessage}</Empty>;

  const anyDistance = places.some((p) => p.distance !== null);
  const anyArrival = places.some((p) => p.arrivalLs !== null);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
        <thead>
          <tr>
            <th style={TH}>Station</th>
            <th style={TH}>System</th>
            <th style={{ ...TH, textAlign: 'right' }}>Price</th>
            <th style={{ ...TH, textAlign: 'right' }}>{side === 'buy' ? 'Supply' : 'Demand'}</th>
            {anyDistance ? <th style={{ ...TH, textAlign: 'right' }}>Distance</th> : null}
            {anyArrival ? <th style={{ ...TH, textAlign: 'right' }}>Arrival</th> : null}
            <th style={{ ...TH, textAlign: 'right' }}>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {places.map((p) => {
            const seen = ago(p.seenAt);
            return (
              <tr key={`${p.systemName}/${p.stationName}`}>
                <td style={{ ...TD, color: C.text }}>
                  {p.stationName}
                  <span
                    style={{
                      marginLeft: '8px',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      color: C.faint,
                    }}
                  >
                    {p.stationType === CARRIER ? 'carrier' : p.largePads > 0 ? 'L pad' : 'no L pad'}
                  </span>
                </td>
                <td style={TD}>
                  {p.systemName} <Copy value={p.systemName} />
                </td>
                <td style={{ ...NUM, color: C.text }}>{p.price.toLocaleString()}</td>
                <td style={NUM}>{tonnes(p.quantity)}</td>
                {anyDistance ? (
                  <td style={NUM}>{p.distance === null ? '—' : `${p.distance.toFixed(1)} ly`}</td>
                ) : null}
                {anyArrival ? <td style={NUM}>{ls(p.arrivalLs)}</td> : null}
                <td
                  style={{ ...NUM, fontSize: '11px', color: seen.stale ? C.warn : C.dim }}
                  // Spelled out for anybody who wants the actual date, without spending a column.
                  title={p.seenAt ?? 'never reported'}
                >
                  {seen.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CommodityDetailPage({
  name,
  onBack,
}: {
  name: string;
  onBack: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<CommodityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The website's filter set, held in state where the website holds it in the URL — the app has
  // no address bar to make a result shareable, so state is what is left.
  const [near, setNear] = useState('');
  const [withinLy, setWithinLy] = useState('50');
  const [freshDays, setFreshDays] = useState('0');
  const [minQty, setMinQty] = useState('');
  const [largePad, setLargePad] = useState(false);
  const [carriers, setCarriers] = useState(false);

  /*
   * ★ THE INTERVAL READS THROUGH A REF, NOT A CLOSURE ★
   *
   * useLive subscribes once and keeps the first render's loader. If that closure read the filter
   * state directly it would refetch with the mount-time defaults forever — quietly undoing every
   * filter the member set, sixty seconds after they set it. The ref is rewritten on every render,
   * so the one captured loader always reads what is on screen now.
   */
  const filters = useRef({ near, withinLy, freshDays, minQty, largePad, carriers });
  filters.current = { near, withinLy, freshDays, minQty, largePad, carriers };

  const load = (): void => {
    const f = filters.current;
    // Passed through verbatim rather than re-derived: the hub owns the defaults and the clamping,
    // and a second set of rules here would be one free to disagree with the first.
    const query: Record<string, string> = { withinLy: f.withinLy, freshDays: f.freshDays };
    if (f.near.trim() !== '') query['near'] = f.near.trim();
    if (f.minQty.trim() !== '') query['minQty'] = f.minQty.trim();
    if (f.largePad) query['largePad'] = '1';
    if (f.carriers) query['carriers'] = '1';

    setBusy(true);
    void window.trade.commodity(name, query).then((a) => {
      setBusy(false);
      if (a.ok) {
        setDetail(a.data);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  // The first read needs nothing typed — the journal knows where the ship is. Again per commodity,
  // because a reused component handed a new name must not keep showing the old good's numbers.
  useEffect(() => {
    setDetail(null);
    load();
  }, [name]);

  // Prices move on the EDDN relay's pace — the page re-reads itself every minute and on focus,
  // with whatever filters are set at that moment.
  useLive(load);

  const back = <Button onClick={onBack}>← Back</Button>;

  if (detail === null) {
    return (
      <div>
        {back}
        <div style={{ marginTop: '14px' }}>
          {error !== null ? <Problem>{error}</Problem> : <Empty>Reading the market…</Empty>}
        </div>
      </div>
    );
  }

  const c = detail.commodity;

  if (c === null) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          {back}
          <span style={{ fontSize: '15px', textTransform: 'uppercase' }}>{name}</span>
        </div>
        <Section title="Not a commodity we hold">
          <Card>
            <Empty>Nobody has reported a market for “{name}”.</Empty>
          </Card>
        </Section>
      </div>
    );
  }

  const spread = c.avgBuy !== null && c.avgSell !== null ? c.avgSell - c.avgBuy : null;
  const origin = detail.origin;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
          flexWrap: 'wrap',
        }}
      >
        {back}
        <span style={{ fontSize: '15px', textTransform: 'uppercase' }}>{c.commodity}</span>
        <span style={{ fontSize: '11px', color: C.faint }}>
          {c.category ?? 'Logistics & Trade'} · traded at{' '}
          {(c.buyMarkets + c.sellMarkets).toLocaleString()} markets
        </span>
      </div>

      {/* A refresh that failed says so above numbers that are now a minute older than they look. */}
      {error !== null ? (
        <div style={{ marginBottom: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      ) : null}

      <Card hud>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          <Stat label="Average buy" value={cr(c.avgBuy)} />
          <Stat label="Average sell" value={cr(c.avgSell)} />
          <Stat
            label="Margin per tonne"
            value={spread === null ? '—' : `${spread > 0 ? '+' : ''}${spread.toLocaleString()}`}
            tone={spread !== null && spread > 0 ? C.good : C.dim}
          />
          <Stat
            label="24h sell move"
            value={
              c.sellTrend === null
                ? '—'
                : `${c.sellTrend > 0 ? '▲ ' : c.sellTrend < 0 ? '▼ ' : ''}${(Math.abs(c.sellTrend) * 100).toFixed(1)}%`
            }
            tone={c.sellTrend === null ? C.dim : c.sellTrend >= 0 ? C.cyan : C.warn}
          />
          <Stat label="Cheapest buy" value={cr(c.minBuy)} />
          <Stat label="Best sell seen" value={cr(c.maxSell)} />
          <Stat label="Supply" value={bulk(c.supply)} />
          <Stat label="Demand" value={bulk(c.demand)} />
        </div>
        {/* The website carries these as hover titles on the index; the tiles above are galaxy-wide
            aggregates, and this is what they aggregate over. */}
        <p style={{ margin: '12px 0 0', fontSize: '11px', color: C.faint }}>
          {c.buyMarkets.toLocaleString()} markets selling · {c.sellMarkets.toLocaleString()} markets
          buying.
        </p>
      </Card>

      <div style={{ marginTop: '20px' }}>
        <Section title="Where you are">
          <Card>
            {/*
              ★ IT SAYS WHERE THE NUMBER CAME FROM ★ — "within 50 ly of Deciat, which you typed"
              and "within 50 ly of Deciat, where your ship is" are different claims, and a stale
              journal is the one way the second can be confidently wrong.
            */}
            {origin !== null ? (
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: C.faint }}>
                Measuring from <span style={{ color: C.dim }}>{origin.system}</span>
                {origin.station === null ? '' : ` (${origin.station})`}
                {origin.from === 'journal'
                  ? ` — where your ship last was${origin.age === undefined ? '' : `, ${origin.age}`}.`
                  : ' — the system you named.'}{' '}
                Name another system to measure from somewhere else.
                {origin.stale === true ? (
                  <span style={{ color: C.warn }}>
                    {' '}
                    That is a while ago — if you have moved, name your system.
                  </span>
                ) : null}
              </p>
            ) : detail.unknownSystem === null ? (
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: C.faint }}>
                Showing the whole bubble. Name a system to see what is close to you.
              </p>
            ) : null}

            {/*
              ★ THE FAILURE THAT USED TO BE SILENT ★ — a system we cannot place means no radius
              was applied and these results are galaxy-wide, which looks exactly like a correct
              answer and will send somebody thousands of light years.
            */}
            {detail.unknownSystem === null ? null : (
              <div style={{ marginBottom: '12px' }}>
                <Problem>
                  We hold no system called “{detail.unknownSystem}”, so the distance limit was not
                  applied — these results cover the whole bubble. Check the spelling, or clear the
                  box.
                </Problem>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label>
                <span style={LABEL}>Near system</span>
                <input
                  style={{ ...inputStyle, width: '160px' }}
                  value={near}
                  onInput={(e) => setNear((e.target as HTMLInputElement).value)}
                  placeholder="where your ship is"
                />
              </label>
              <label>
                <span style={LABEL}>Within</span>
                <select
                  style={{ ...inputStyle, width: '90px' }}
                  value={withinLy}
                  onChange={(e) => setWithinLy((e.target as HTMLSelectElement).value)}
                >
                  {['20', '50', '100', '250', '500'].map((ly) => (
                    <option key={ly} value={ly}>
                      {ly} ly
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span style={LABEL}>Seen within</span>
                <select
                  style={{ ...inputStyle, width: '100px' }}
                  value={freshDays}
                  onChange={(e) => setFreshDays((e.target as HTMLSelectElement).value)}
                >
                  <option value="0">Any age</option>
                  <option value="1">A day</option>
                  <option value="7">A week</option>
                  <option value="30">A month</option>
                </select>
              </label>
              <label>
                <span style={LABEL}>Min quantity (t)</span>
                <input
                  style={{ ...inputStyle, width: '90px' }}
                  type="number"
                  min={0}
                  value={minQty}
                  onInput={(e) => setMinQty((e.target as HTMLInputElement).value)}
                  placeholder="any"
                />
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: C.dim,
                  paddingBottom: '8px',
                }}
              >
                <input
                  type="checkbox"
                  checked={largePad}
                  onChange={(e) => setLargePad((e.target as HTMLInputElement).checked)}
                />
                Large pad only
              </label>
              {/*
                Off by default, like the website, and for the website's reason: carriers hold both
                the cheapest and the dearest prices in the galaxy, all set by hand, and can be
                somewhere else tomorrow.
              */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: C.dim,
                  paddingBottom: '8px',
                }}
              >
                <input
                  type="checkbox"
                  checked={carriers}
                  onChange={(e) => setCarriers((e.target as HTMLInputElement).checked)}
                />
                Include fleet carriers
              </label>
              <Button onClick={load} disabled={busy}>
                {busy ? 'Updating…' : 'Update'}
              </Button>
            </div>
          </Card>
        </Section>

        <Section title="Price over time">
          <Card>
            <PriceHistoryChart points={detail.history} />
          </Card>
        </Section>

        <Section title="Best places to buy">
          <Card>
            <PlaceTable
              places={detail.buys}
              side="buy"
              emptyMessage={
                origin === null
                  ? 'Nobody is selling this anywhere we have a price for.'
                  : `Nobody is selling this within range of ${origin.system}. Widen the radius, or clear it to search the whole bubble.`
              }
            />
          </Card>
        </Section>

        <Section title="Best places to sell">
          <Card>
            <PlaceTable
              places={detail.sells}
              side="sell"
              emptyMessage={
                origin === null
                  ? 'Nobody is buying this anywhere we have a price for.'
                  : `Nobody is buying this within range of ${origin.system}.`
              }
            />
          </Card>
        </Section>
      </div>
    </div>
  );
}
