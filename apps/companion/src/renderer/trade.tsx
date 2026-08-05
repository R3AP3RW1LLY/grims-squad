import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { TradePlan, TradeRoute } from '../hub-trade.js';
import { Button, C, Card, Empty, Problem, Section, inputStyle } from './ui.js';
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

function RouteCard({ r }: { r: TradeRoute }): JSX.Element {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
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
          {ls(r.buy.arrivalLs)} · {r.buy.price.toLocaleString()} cr/t
        </div>
        <div>
          <span style={LABEL}>Sell at</span>
          <span style={{ color: C.text }}>{r.sell.stationName}</span>
          <br />
          {r.sell.systemName} · {r.sell.distance === null ? '—' : `${r.sell.distance.toFixed(1)} ly`}
          {ls(r.sell.arrivalLs)} · {r.sell.price.toLocaleString()} cr/t
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

export function TradePage(): JSX.Element {
  const [near, setNear] = useState('');
  const [cargo, setCargo] = useState('64');
  const [buyLy, setBuyLy] = useState('50');
  const [sellLy, setSellLy] = useState('100');
  const [commodity, setCommodity] = useState('');
  const [sort, setSort] = useState('trip');
  const [plan, setPlan] = useState<TradePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (): void => {
    setBusy(true);
    void window.trade
      .routes({ near, cargo, buyWithinLy: buyLy, sellWithinLy: sellLy, commodity, sort })
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
              {plan.routes.map((r) => (
                <RouteCard key={`${r.commodity}/${r.buy.stationName}/${r.sell.stationName}`} r={r} />
              ))}
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
