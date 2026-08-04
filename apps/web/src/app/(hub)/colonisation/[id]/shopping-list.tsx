import type { ColonyShoppingRow } from '../../../../lib/api';
import { CopySystem } from '../../../../components/copy-system';

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

/**
 * How old a price is, in words.
 *
 * ★ SHOWN, NOT HIDDEN — MEASURED 2026-08-03 ★
 *
 * Of the ten million rows in our market mirror, 6.4% were seen within a week and 46.6% are older
 * than three months; the oldest is from 2020. A price is a claim about STOCK, and stock is the
 * thing somebody is flying forty light years to collect.
 *
 * Filtering the old ones out would tell a member "nobody sells this" about commodities sitting on a
 * shelf right now, which is worse than an old number they can weigh for themselves. So the age is
 * printed, and anything past a month is marked.
 */
function Seen({ at }: { at: string | null }) {
  if (at === null) {
    return (
      <span className="ml-1.5 font-mono text-[10px] text-[var(--color-semantic-warning)]">
        never dated
      </span>
    );
  }

  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  const text =
    days <= 0
      ? 'seen today'
      : days === 1
        ? 'seen yesterday'
        : days < 30
          ? `seen ${days}d ago`
          : days < 365
            ? `seen ${Math.floor(days / 30)}mo ago`
            : `seen ${Math.floor(days / 365)}y ago`;

  return (
    <span
      className={
        days > 30
          ? 'ml-1.5 font-mono text-[10px] text-[var(--color-semantic-warning)]'
          : 'ml-1.5 font-mono text-[10px] text-[var(--color-text-dim)]'
      }
      title={
        days > 30
          ? 'Nobody has reported this market recently. The stock may be long gone.'
          : undefined
      }
    >
      {text}
    </span>
  );
}

export function ShoppingList({
  rows,
  onCarriers,
  projectId,
  origin,
  unknownSystem,
  query,
}: {
  rows: readonly ColonyShoppingRow[];
  /**
   * Tonnes already sitting in an attached carrier's hold.
   *
   * ★ THE ARGUMENT A TAB STRIP DISSOLVED ★
   *
   * Carriers used to sit immediately above this table in one column, with a comment explaining
   * why: what is already in a hold changes what still needs buying, so reading the shopping list
   * first is reading it against the wrong number.
   *
   * Tabs have no adjacency — nobody reads them left to right — so that placement stopped carrying
   * the point the moment the page was tabbed. The point is worth more than the layout trick was,
   * so it is now said in words on the table it applies to.
   */
  onCarriers: number;
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
        action={`/colonisation/${projectId}`}
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
        {/*
          ★ THIS CONTROL EXISTED IN THE API AND NOWHERE ON SCREEN ★

          Squadron owner asked for cheapest-versus-closest on 2026-08-02. Both were implemented end
          to end on both controllers and no surface ever drew a control, so the only sort anybody
          could get was the default — which is how a shopping list ended up sending somebody ninety-
          six light years to save five percent.

          `local` leads because it is the default and the one that is right nearly always: the same
          system beats leaving it, and within a comparable trip the better price wins.
        */}
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Prefer
          </span>
          <select name="sort" defaultValue={query['sort'] ?? 'local'} className={FIELD}>
            <option value="local">Local first</option>
            <option value="cheapest">Cheapest anywhere</option>
            <option value="closest">Closest anywhere</option>
          </select>
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

      {/*
        Said here rather than arranged for. Carriers are a tab away now, and a member reading this
        table has no way of knowing that twenty thousand tonnes of it is already parked at the site
        unless somebody tells them.
      */}
      {onCarriers === 0 ? null : (
        <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
          {onCarriers.toLocaleString()} t of what this build wants is already in an attached
          carrier&rsquo;s hold. These figures do not subtract it — check{' '}
          <span className="text-[var(--color-text-primary)]">Carriers</span> before you buy.
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
                         * ★ NOT A DEAD END — SQUADRON OWNER, 2026-08-03 ★
                         *
                         * "if a commodty is listed as 'nobody in range sells this' can we display
                         * the actual nearest location that does sell it, with an estimated light
                         * years in distance please."
                         *
                         * "Nobody in range" was true and useless: it said the search failed and
                         * nothing about what to do next. Somebody still has to go and get forty
                         * thousand tonnes of CMM Composite from somewhere.
                         */
                        <div>
                          <span className="text-[var(--color-semantic-warning)]">
                            nobody in range sells this
                          </span>
                          {r.nearestOutOfRange === null ? null : (
                            <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                              nearest is{' '}
                              <span className="text-[var(--color-text-primary)]">
                                {r.nearestOutOfRange.stationName}
                              </span>{' '}
                              in {r.nearestOutOfRange.systemName}
                              <CopySystem system={r.nearestOutOfRange.systemName} size="small" />
                              <span className="ml-2 font-mono tabular-nums">
                                {r.nearestOutOfRange.distance === null
                                  ? ''
                                  : `${r.nearestOutOfRange.distance.toFixed(0)} ly · `}
                                {r.nearestOutOfRange.price.toLocaleString()} cr ·{' '}
                                {r.nearestOutOfRange.supply.toLocaleString()} in stock
                                <Seen at={r.nearestOutOfRange.seenAt} />
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          {r.stationName}
                          <span className="ml-1.5 text-[11px]">
                            {r.systemName}
                            {r.distance === null ? '' : ` · ${r.distance.toFixed(0)} ly`}
                          </span>
                          {/* The system alone, because the galaxy map searches systems — a station
                              name pasted into it finds nothing. */}
                          {r.systemName === null ? null : (
                            <CopySystem system={r.systemName} size="small" />
                          )}
                          <Seen at={r.seenAt} />
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
