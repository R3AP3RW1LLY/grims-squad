import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { CommoditiesIndex, CommodityRow } from '../hub-trade.js';
import { Button, C, Card, Empty, Problem, Section, inputStyle } from './ui.js';

/**
 * The commodities market, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "then add this to the companion app too please so we have full feature parridy" — the index the
 * website shows, with the same near-you columns, measured from where the ship actually is because
 * the device door always knows its member. Same believability rules, same 50 ly, same numbers:
 * both surfaces read the same endpoint family, so they cannot disagree.
 */

// `window.trade` is declared ONCE, in trade.tsx — the same rule window.colony documents: a second
// `declare global` for one object is a conflicting declaration, not an addition.

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

const cr = (n: number | null | undefined): string => (n == null ? '—' : n.toLocaleString());

type SortKey = 'spread' | 'nearBuy' | 'nearSell' | 'name';

function spreadOf(r: CommodityRow): number | null {
  return r.avgBuy !== null && r.avgSell !== null ? r.avgSell - r.avgBuy : null;
}

export function CommoditiesPage(): JSX.Element {
  const [index, setIndex] = useState<CommoditiesIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [near, setNear] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('spread');

  const load = (measureFrom?: string): void => {
    void window.trade.commodities(measureFrom).then((a) => {
      if (a.ok) {
        setIndex(a.data);
        setError(null);
      } else setError(a.error);
    });
  };

  // First load measures from the journal — the app's own advantage.
  useEffect(() => load(), []);

  const hasNear = index?.nearWithinLy != null;

  const shown = useMemo(() => {
    if (index === null) return [];
    const q = query.trim().toLowerCase();
    const filtered = index.commodities.filter(
      (r) => q === '' || r.commodity.toLowerCase().includes(q),
    );
    const nul = (v: number | null | undefined, dir: 1 | -1): number =>
      v == null ? dir * Number.POSITIVE_INFINITY : v;
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.commodity.localeCompare(b.commodity);
        case 'nearBuy':
          return nul(a.nearBuy, 1) - nul(b.nearBuy, 1);
        case 'nearSell':
          return nul(b.nearSell, -1) - nul(a.nearSell, -1);
        default:
          return nul(spreadOf(b), -1) - nul(spreadOf(a), -1);
      }
    });
  }, [index, query, sort]);

  return (
    <div>
      <Section title="Commodities">
        <Card>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.14em', color: C.faint, display: 'block', marginBottom: '4px' }}>
                Measure from
              </span>
              <input
                style={{ ...inputStyle, width: '170px' }}
                value={near}
                onInput={(e) => setNear((e.target as HTMLInputElement).value)}
                placeholder="where your ship is"
              />
            </label>
            <Button onClick={() => load(near)}>Measure</Button>
            <input
              style={{ ...inputStyle, width: '180px', marginLeft: 'auto' }}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              placeholder="Search commodities…"
              aria-label="Search commodities"
            />
            <select
              style={{ ...inputStyle, width: '160px' }}
              value={sort}
              onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}
            >
              <option value="spread">Best margin</option>
              {hasNear ? <option value="nearBuy">Cheapest near you</option> : null}
              {hasNear ? <option value="nearSell">Best sale near you</option> : null}
              <option value="name">Name</option>
            </select>
          </div>

          {index?.origin != null ? (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.faint }}>
              Near-you prices measure from{' '}
              <span style={{ color: C.dim }}>{index.origin.system}</span>
              {index.origin.from === 'journal'
                ? ` — where your ship last was${index.origin.age === undefined ? '' : `, ${index.origin.age}`}.`
                : ' — the system you named.'}{' '}
              Within {index.nearWithinLy} ly.
              {index.origin.stale === true ? (
                <span style={{ color: C.warn }}> That is a while ago — if you have moved, name your system.</span>
              ) : null}
            </p>
          ) : index !== null && index.unknownSystem !== null ? (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.warn }}>
              We hold no system called “{index.unknownSystem}”. Check the spelling and try again.
            </p>
          ) : null}
        </Card>
      </Section>

      {error !== null ? <Problem>{error}</Problem> : null}

      <Section title="Every commodity we hold a price for">
        <Card>
          {index === null ? (
            <Empty>Loading the market…</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                <thead>
                  <tr>
                    <th style={TH}>Commodity</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Avg buy</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Avg sell</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Margin</th>
                    {hasNear ? <th style={{ ...TH, textAlign: 'right' }}>Near buy</th> : null}
                    {hasNear ? <th style={{ ...TH, textAlign: 'right' }}>Near sell</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const spread = spreadOf(r);
                    return (
                      <tr key={r.commodity}>
                        <td style={{ ...TD, color: C.text }}>{r.commodity}</td>
                        <td style={NUM}>{cr(r.avgBuy)}</td>
                        <td style={NUM}>{cr(r.avgSell)}</td>
                        <td style={{ ...NUM, color: spread !== null && spread > 0 ? C.good : C.dim }}>
                          {spread === null ? '—' : `+${spread.toLocaleString()}`}
                        </td>
                        {hasNear ? <td style={NUM}>{cr(r.nearBuy)}</td> : null}
                        {hasNear ? <td style={NUM}>{cr(r.nearSell)}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>
    </div>
  );
}
