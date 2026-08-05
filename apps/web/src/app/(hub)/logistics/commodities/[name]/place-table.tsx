import { isCarrierStationType } from '@grims/shared/carrier';
import type { MarketPlace } from '../../../../../lib/api';

/**
 * Where to buy or sell one commodity.
 *
 * ★ FRESHNESS IS A COLUMN, NOT A FOOTNOTE ★
 *
 * Every price here was reported by a commander who flew there, and some of those flights were a
 * long time ago: of the 73,219 markets stocking Gold, only 29% have been seen in the last thirty
 * days. A table that shows a price and not its age invites a member to fly forty light years on a
 * number from 2024.
 *
 * So the age is shown on every row, and shown in words rather than as a date — "3 days ago" is a
 * judgement somebody can make at a glance, and "2024-07-09" is arithmetic.
 */

const TH =
  'py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] ' +
  'text-[var(--color-text-secondary)]';

const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

/*
 * Fleet carriers, which the member has explicitly asked to see if any are here at all.
 *
 * `isCarrierStationType` rather than a string compare, because the type column holds two
 * vocabularies — the galaxy dump's `"Drake-Class Carrier"` and the journal's `"FleetCarrier"` — and
 * comparing against one of them labelled real carriers as ordinary stations. See
 * `@grims/shared/carrier`.
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

export function PlaceTable({
  places,
  side,
  emptyMessage,
}: {
  places: readonly MarketPlace[];
  side: 'buy' | 'sell';
  emptyMessage: string;
}) {
  if (places.length === 0) {
    return <p className="m-0 text-sm text-[var(--color-text-secondary)]">{emptyMessage}</p>;
  }

  const anyDistance = places.some((p) => p.distance !== null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Station
            </th>
            <th scope="col" className={TH}>
              System
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Price
            </th>
            <th scope="col" className={`${TH} text-right`}>
              {side === 'buy' ? 'Supply' : 'Demand'}
            </th>
            {anyDistance ? (
              <th scope="col" className={`${TH} text-right`}>
                Distance
              </th>
            ) : null}
            <th scope="col" className={`${TH} text-right`}>
              Last seen
            </th>
          </tr>
        </thead>
        <tbody>
          {places.map((p) => {
            const seen = ago(p.seenAt);
            return (
              <tr
                key={`${p.systemName}/${p.stationName}`}
                className="hover:bg-[var(--color-surface-panel)]"
              >
                <td className={TD}>
                  <span className="text-[var(--color-text-primary)]">{p.stationName}</span>
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
                    {isCarrierStationType(p.stationType) ? 'carrier' : p.largePads > 0 ? 'L pad' : 'no L pad'}
                  </span>
                </td>
                <td className={`${TD} text-[var(--color-text-secondary)]`}>{p.systemName}</td>
                <td className={`${TD} text-right font-mono tabular-nums`}>
                  {p.price.toLocaleString()}
                </td>
                <td
                  className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                >
                  {p.quantity.toLocaleString()}t
                </td>
                {anyDistance ? (
                  <td
                    className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                  >
                    {p.distance === null ? '—' : `${p.distance.toFixed(1)} ly`}
                  </td>
                ) : null}
                <td
                  className={`${TD} text-right font-mono text-[11px] ${
                    seen.stale
                      ? 'text-[var(--color-semantic-warning)]'
                      : 'text-[var(--color-text-secondary)]'
                  }`}
                  // Spelled out for anybody who wants the actual date, without spending a column on it.
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
