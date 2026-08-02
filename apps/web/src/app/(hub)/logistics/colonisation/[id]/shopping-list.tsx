import type { ColonyShoppingRow } from '../../../../../lib/api';

/**
 * Where to buy what a project still needs.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "Squadron projects also get a shopping list from the Freight Office." This is the join between
 * the three systems: a project's outstanding needs, answered by the market, priced as a total.
 *
 * ★ THE TOTAL IS THE POINT ★
 *
 * "You need 4,000 t of Steel" is a fact. "Finishing this costs 38 million and the nearest Steel is
 * 22 ly away" is a decision. The cost column is the whole outstanding tonnage at the best price —
 * not what is on that station's shelf, which is shown separately so somebody can work out how many
 * trips it is.
 */

const TH =
  'py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] ' +
  'text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

const FIELD =
  'rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]';

export function ShoppingList({
  rows,
  projectId,
  origin,
  unknownSystem,
  query,
}: {
  rows: readonly ColonyShoppingRow[];
  projectId: string;
  origin: { system: string } | null;
  unknownSystem: string | null;
  query: Record<string, string>;
}) {
  const total = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const unsourced = rows.filter((r) => r.price === null).length;

  return (
    <div>
      <form
        method="get"
        action={`/logistics/colonisation/${projectId}`}
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Buying from
          </span>
          <input
            name="near"
            defaultValue={query['near'] ?? ''}
            placeholder="a system near you"
            className={`${FIELD} w-[200px]`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Within
          </span>
          <select name="withinLy" defaultValue={query['withinLy'] ?? '100'} className={FIELD}>
            {['50', '100', '200', '500'].map((ly) => (
              <option key={ly} value={ly}>
                {ly} ly
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            name="largePad"
            value="1"
            defaultChecked={query['largePad'] === '1'}
          />
          Large pad only
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)]"
        >
          Update
        </button>
      </form>

      {/*
        Where the prices are measured from, said out loud. Without it a distance column is a number
        nobody can check — the same reasoning as the market page's origin line.
      */}
      {origin === null ? (
        <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
          Showing the cheapest prices anywhere. Name a system to see what is close to you.
        </p>
      ) : (
        <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
          Cheapest within range of{' '}
          <strong className="text-[var(--color-text-primary)]">{origin.system}</strong>.
        </p>
      )}

      {unknownSystem === null ? null : (
        <p className="m-0 mb-3 rounded-md border border-[var(--color-semantic-warning)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          We hold no system called “{unknownSystem}”, so these are the best prices anywhere rather
          than the best near you.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          Nothing outstanding to buy.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Commodity
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Needed
                  </th>
                  <th scope="col" className={TH}>
                    Cheapest at
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Price
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    In stock
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.commodity} className="hover:bg-[var(--color-surface-panel)]">
                    <td className={TD}>
                      <a
                        href={`/logistics/commodities/${encodeURIComponent(r.commodity)}`}
                        className="text-[var(--color-text-primary)] no-underline hover:underline"
                      >
                        {r.commodity}
                      </a>
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>
                      {r.remaining.toLocaleString()} t
                    </td>
                    <td className={`${TD} text-[var(--color-text-secondary)]`}>
                      {r.stationName === null ? (
                        /*
                         * Said plainly rather than left blank. Nobody in range sells it, which is
                         * actionable information — widen the radius, or find a miner.
                         */
                        <span className="text-[var(--color-semantic-warning)]">
                          nobody in range sells this
                        </span>
                      ) : (
                        <>
                          {r.stationName}
                          <span className="ml-1.5 text-[11px]">
                            {r.systemName}
                            {r.distance === null ? '' : ` · ${r.distance.toFixed(0)} ly`}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>
                      {r.price === null ? '—' : r.price.toLocaleString()}
                    </td>
                    <td
                      className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                    >
                      {r.supply === null ? '—' : `${r.supply.toLocaleString()} t`}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>
                      {r.cost === null ? '—' : r.cost.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="m-0 mt-3 border-t border-[var(--color-border-hairline)] pt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
            {/*
              The total is qualified whenever it is incomplete. A confident "38,000,000 cr" that
              silently omits four commodities nobody sells is worse than no total at all.
            */}
            {unsourced === 0
              ? `Finishing this costs about ${total.toLocaleString()} cr in cargo.`
              : `About ${total.toLocaleString()} cr for what can be bought — ${unsourced} commodit${
                  unsourced === 1 ? 'y is' : 'ies are'
                } not sold anywhere in range, so the real total is higher.`}
          </p>
        </>
      )}
    </div>
  );
}
