import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { depthOf } from '@grims/shared/market-depth';
import type { TradePlan, TradeRoute } from '../hub-trade.js';
import { Button, C, Card, Empty, Problem, R, Section, inputStyle } from './ui.js';
import { writeTradePlan, type PickedRun } from '../trade-plan.js';
import { useLive } from './use-live.js';

/**
 * The Freight Office, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "add this to the companion app too please so we have full feature parridy." Until now this tab
 * was a signpost to the website; this is the planner itself, through the device door.
 *
 * ★ THE APP'S ONE ADVANTAGE: IT KNOWS WHERE YOU ARE ★
 *
 * The website has to ask, or trust a last-known position with an age on it. The app rides with the
 * journal — leave the starting system blank and the plan starts from where the ship actually is,
 * which is the answer the website can only approximate.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly trade: {
      routes(query: unknown): Promise<Answer<TradePlan>>;
      /*
       * The commodities page's half of the bridge, declared here with the rest of `window.trade`
       * for the same reason window.colony keeps one declaration: a second `declare global` for
       * one object conflicts rather than adds.
       */
      commodities(
        near?: string,
      ): Promise<Answer<import('../hub-trade.js').CommoditiesIndex>>;
      commodity(
        name: string,
        query?: unknown,
      ): Promise<Answer<import('../hub-trade.js').CommodityDetail>>;
    };
  }
}

const LABEL: JSX.CSSProperties = {
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: C.faint,
  display: 'block',
  marginBottom: '4px',
};

function ls(v: number | null): string {
  if (v === null) return '';
  const text = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M Ls` : `${Math.round(v).toLocaleString()} Ls`;
  return ` · ${text}`;
}

const CAP: Record<TradeRoute['limitedBy'], string> = {
  hold: 'your hold',
  supply: 'the shelf',
  demand: 'the buyer',
  budget: 'your credits',
};

/** A stable identity for a route, so a pick survives a re-render. */
function keyOf(r: TradeRoute): string {
  return `${r.commodity}/${r.buy.stationName}/${r.sell.stationName}`;
}

/**
 * The picked runs, and the one button that puts them on the overlay.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add an option to choose the trade route and display them in the overlay please so we can group
 * multiple routes together if there are several that are going to the same destination, and show
 * the optimized order"
 *
 * ★ THE ORDER IS WORKED OUT WHERE THE HOLD IS KNOWN ★
 *
 * This sends the PICKS, not a manifest. The overlay plans against the hold the app can currently
 * see, so swapping ship re-plans the run instead of quoting tonnages for a ship the member sold.
 */
function Basket({
  plan,
  picked,
  sent,
  onSent,
  onClear,
}: {
  plan: TradePlan;
  picked: ReadonlySet<string>;
  sent: boolean;
  onSent: () => void;
  onClear: () => void;
}): JSX.Element | null {
  const chosen = plan.routes.filter((r) => picked.has(keyOf(r)));
  if (chosen.length === 0) return null;

  const send = (): void => {
    const picks: PickedRun[] = chosen.map((r) => ({
      commodity: r.commodity,
      buyStation: r.buy.stationName,
      buySystem: r.buy.systemName,
      sellStation: r.sell.stationName,
      sellSystem: r.sell.systemName,
      buyPrice: r.buy.price,
      profitPerTonne: r.profitPerTonne,
      supply: r.buy.quantity,
      demand: r.sell.quantity,
      buyDistanceLy: r.buy.distance ?? 0,
      buyCoords: r.buy.coords ?? null,
    }));

    void window.companion
      .setTradePlan(writeTradePlan(picks, plan.origin?.coords ?? null))
      .then(onSent);
  };

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          fontSize: '13px',
          color: C.text,
        }}
      >
        <strong>
          {chosen.length} run{chosen.length === 1 ? '' : 's'} picked
        </strong>
        <span style={{ color: C.dim, fontSize: '12px' }}>
          {chosen.map((r) => r.commodity).join(' · ')}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/*
            Confirmed in words after the fact. The overlay may not even be enabled, so a silent
            success would leave a member pressing a button that appears to do nothing.
          */}
          {sent ? (
            <span style={{ color: C.good, fontSize: '12px' }}>
              On the Trade run overlay
            </span>
          ) : null}
          <Button onClick={send}>{sent ? 'Send again' : 'Send to overlay'}</Button>
          <Button onClick={onClear}>Clear</Button>
        </span>
      </div>
    </Card>
  );
}

function RouteCard({
  r,
  picked,
  onToggle,
}: {
  r: TradeRoute;
  picked: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        {/*
          ★ SQUADRON OWNER, 2026-08-06 ★

          "add a clickable picker icon to each traderoute and use those to plan with etc"

          A button, not a checkbox: it is an action with a consequence somewhere else on screen, and
          it says which state it is in with a word as well as a mark — a lone tick against a dark
          card is the kind of thing a member misses and then wonders why their overlay is empty.
        */}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={picked}
          style={{
            background: picked ? C.orangeTint : 'transparent',
            border: `1px solid ${picked ? C.orange : C.subtle}`,
            color: picked ? C.orangeBright : C.dim,
            borderRadius: R.control,
            cursor: 'pointer',
            fontSize: '11px',
            padding: '2px 8px',
          }}
        >
          {picked ? '✓ Picked' : '+ Pick'}
        </button>
        <strong style={{ color: C.text, fontSize: '14px' }}>{r.commodity}</strong>
        <span style={{ color: C.good, fontVariantNumeric: 'tabular-nums', fontSize: '15px' }}>
          {r.totalProfit.toLocaleString()} cr
        </span>
      </div>
      <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: '12px', color: C.dim }}>
        <div>
          <span style={LABEL}>Load at</span>
          <span style={{ color: C.text }}>{r.buy.stationName}</span>
          <br />
          {r.buy.systemName} · {r.buy.distance === null ? '—' : `${r.buy.distance.toFixed(1)} ly`}
          {ls(r.buy.arrivalLs)} · {r.buy.price.toLocaleString()} cr/t ·{' '}
          <Depth quantity={r.buy.quantity} tonnes={r.tonnes} noun="in stock" />
        </div>
        <div>
          <span style={LABEL}>Sell at</span>
          <span style={{ color: C.text }}>{r.sell.stationName}</span>
          <br />
          {r.sell.systemName} · {r.sell.distance === null ? '—' : `${r.sell.distance.toFixed(1)} ly`}
          {ls(r.sell.arrivalLs)} · {r.sell.price.toLocaleString()} cr/t ·{' '}
          <Depth quantity={r.sell.quantity} tonnes={r.tonnes} noun="wanted" />
        </div>
        <div>
          <span style={LABEL}>Carrying</span>
          <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
            {r.tonnes.toLocaleString()} t
          </span>{' '}
          — capped by {CAP[r.limitedBy]}
        </div>
        <div>
          <span style={LABEL}>The other numbers</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            +{r.profitPerTonne.toLocaleString()}/t · {r.profitPerHour.toLocaleString()} cr/h ·
            ≈{r.tripMinutes} min
          </span>
        </div>
      </div>
    </Card>
  );
}


/**
 * Supply at the pickup, demand at the destination — the same rule the website uses.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "show total supply at the pickup station and total demand at the destination station please,
 * green for in demand, red for not in demand, and yellow for inbetween"
 *
 * `depthOf` lives in @grims/shared so the app and the website cannot call the same stop good and
 * thin. Judged against the tonnes THIS route moves, because four thousand tonnes of demand is
 * generous for a Python and thin for a Cutter.
 */
function Depth({ quantity, tonnes, noun }: { quantity: number; tonnes: number; noun: string }): JSX.Element {
  const depth = depthOf(quantity, tonnes);
  const tone =
    depth === 'good' ? C.good : depth === 'partial' ? C.warn : depth === 'none' ? C.bad : C.dim;

  return (
    <span style={{ color: tone, fontVariantNumeric: 'tabular-nums' }}>
      {depth === 'unknown' ? '—' : quantity.toLocaleString()} {noun}
    </span>
  );
}

export function TradePage(): JSX.Element {
  const [near, setNear] = useState('');
  const [cargo, setCargo] = useState('64');
  const [buyLy, setBuyLy] = useState('50');
  const [sellLy, setSellLy] = useState('100');
  const [commodity, setCommodity] = useState('');
  const [sort, setSort] = useState('trip');
  // The four the website has had all along and the app did not send. See TradeQuery.
  const [budget, setBudget] = useState('');
  const [padSize, setPadSize] = useState('');
  const [carriers, setCarriers] = useState(false);
  const [freshDays, setFreshDays] = useState('7');
  const [plan, setPlan] = useState<TradePlan | null>(null);
  /*
   * Which runs the member has picked, by a key that survives a re-render. Kept here rather than in
   * the config so that picking is instant — the config write happens once, when they send it.
   */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (): void => {
    setBusy(true);
    void window.trade
      .routes({
        near,
        cargo,
        buyWithinLy: buyLy,
        sellWithinLy: sellLy,
        commodity,
        sort,
        budget,
        // The hub reads these as '1'/absent, the same way the website's form posts them.
        padSize,
        carriers: carriers ? '1' : '',
        freshDays,
      })
      .then((a) => {
        setBusy(false);
        if (a.ok) {
          setPlan(a.data);
          setError(null);
        } else {
          setError(a.error);
        }
      });
  };

  // The first plan needs nothing typed — the journal knows where the ship is. Once, on mount.
  useEffect(run, []);

  /*
   * ★ "all data updated in realtime" — squadron owner, 2026-08-04 ★
   *
   * A standing plan re-quotes itself every minute with the member's own parameters: prices drain
   * while a run sits on screen, and the whole point of the believability work is that a stale
   * quote is worse than a fresh one. Nothing refires while a plan is still being computed.
   */
  useLive(() => {
    if (plan !== null && !busy) run();
  });

  return (
    <div>
      <Section title="Trade runs">
        <Card>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>
              <span style={LABEL}>Starting system</span>
              <input
                style={{ ...inputStyle, width: '160px' }}
                value={near}
                onInput={(e) => setNear((e.target as HTMLInputElement).value)}
                placeholder="where your ship is"
              />
            </label>
            <label>
              <span style={LABEL}>Cargo (t)</span>
              <input
                style={{ ...inputStyle, width: '80px' }}
                type="number"
                min={1}
                max={794}
                value={cargo}
                onInput={(e) => setCargo((e.target as HTMLInputElement).value)}
              />
            </label>
            <label>
              <span style={LABEL}>Go to load</span>
              <select style={{ ...inputStyle, width: '90px' }} value={buyLy} onChange={(e) => setBuyLy((e.target as HTMLSelectElement).value)}>
                {['20', '50', '100', '200'].map((ly) => (
                  <option key={ly} value={ly}>{ly} ly</option>
                ))}
              </select>
            </label>
            <label>
              <span style={LABEL}>Carry up to</span>
              <select style={{ ...inputStyle, width: '90px' }} value={sellLy} onChange={(e) => setSellLy((e.target as HTMLSelectElement).value)}>
                {['20', '50', '100', '200', '500'].map((ly) => (
                  <option key={ly} value={ly}>{ly} ly</option>
                ))}
              </select>
            </label>
            <label>
              <span style={LABEL}>Commodity</span>
              <input
                style={{ ...inputStyle, width: '140px' }}
                value={commodity}
                onInput={(e) => setCommodity((e.target as HTMLInputElement).value)}
                placeholder="best available"
              />
            </label>
            <label>
              <span style={LABEL}>Rank by</span>
              <select style={{ ...inputStyle, width: '130px' }} value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value)}>
                <option value="trip">Best trip</option>
                <option value="tonne">Best per tonne</option>
                <option value="hour">Best per hour</option>
              </select>
            </label>
            <label>
              <span style={LABEL}>Credits</span>
              <input
                style={{ ...inputStyle, width: '110px' }}
                value={budget}
                onInput={(e) => setBudget((e.target as HTMLInputElement).value)}
                placeholder="all of them"
                inputMode="numeric"
              />
            </label>
            <label>
              <span style={LABEL}>Prices seen</span>
              <select
                style={{ ...inputStyle, width: '130px' }}
                value={freshDays}
                onChange={(e) => setFreshDays((e.target as HTMLSelectElement).value)}
              >
                <option value="1">Today</option>
                <option value="3">Last 3 days</option>
                <option value="7">Last week</option>
                <option value="30">Last month</option>
                <option value="0">Any age</option>
              </select>
            </label>
            {/*
              Landing pads — the single most consequential filter here: a run to a station your
              hull cannot land at is not a worse run, it is not a run at all.

              A selector rather than a "large only" tick, because 54% of stations have no large pad
              and 1.2% are small-only, so a medium hull ticking the old box threw away half the
              galaxy to avoid one per cent of it.
            */}
            <label>
              <span style={LABEL}>My ship needs</span>
              <select
                style={{ ...inputStyle, width: '150px' }}
                value={padSize}
                onChange={(e) => setPadSize((e.target as HTMLSelectElement).value)}
              >
                <option value="">Any pad</option>
                <option value="medium">Medium or better</option>
                <option value="large">Large pad</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'end', paddingBottom: '6px' }}>
              <input
                type="checkbox"
                checked={carriers}
                onChange={(e) => setCarriers((e.target as HTMLInputElement).checked)}
              />
              {/*
                Off by default, matching the website and for the reason set out on CARRIER_TYPE: a
                carrier's prices are set by hand and it can be somewhere else tomorrow.
              */}
              <span style={{ fontSize: '12px', color: C.dim }}>Include carriers</span>
            </label>
            <Button onClick={run} disabled={busy}>
              {busy ? 'Planning…' : 'Plan a run'}
            </Button>
          </div>

          {plan?.origin != null ? (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.faint }}>
              Planning from <span style={{ color: C.dim }}>{plan.origin.system}</span>
              {plan.origin.station === null ? '' : ` (${plan.origin.station})`}
              {plan.origin.from === 'journal'
                ? ` — where your ship last was${plan.origin.age === undefined ? '' : `, ${plan.origin.age}`}.`
                : ' — the system you named.'}
              {plan.origin.stale === true ? (
                <span style={{ color: C.warn }}> That is a while ago — if you have moved, name your system.</span>
              ) : null}
            </p>
          ) : null}
          {plan !== null && plan.origin === null ? (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.warn }}>
              {plan.unknownSystem === null
                ? 'A run needs a starting point. Name the system you are in, or fly somewhere so the journal can say.'
                : `We hold no system called “${plan.unknownSystem}”. Check the spelling and try again.`}
            </p>
          ) : null}
        </Card>
      </Section>

      {error !== null ? <Problem>{error}</Problem> : null}

      {plan !== null && plan.origin !== null ? (
        <Section title={`Runs from ${plan.origin.system}`}>
          {plan.routes.length === 0 ? (
            <Empty>Nothing profitable in range. Carry further, go further to load, or clear the commodity.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: C.faint }}>
                Run times assume a ~{plan.timeModel.jumpLy} ly laden jump, about{' '}
                {plan.timeModel.minutesPerStop} minutes per stop, and add supercruise time from
                each station's arrival distance when we hold it.
              </p>
              <Basket
                plan={plan}
                picked={picked}
                sent={sent}
                onSent={() => setSent(true)}
                onClear={() => {
                  setPicked(new Set());
                  setSent(false);
                }}
              />
              {plan.routes.map((r) => {
                const key = keyOf(r);
                return (
                  <RouteCard
                    key={key}
                    r={r}
                    picked={picked.has(key)}
                    onToggle={() => {
                      const next = new Set(picked);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      setPicked(next);
                      // Any change invalidates "sent" — otherwise the bar keeps claiming the
                      // overlay holds a plan the member has since edited.
                      setSent(false);
                    }}
                  />
                );
              })}
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
