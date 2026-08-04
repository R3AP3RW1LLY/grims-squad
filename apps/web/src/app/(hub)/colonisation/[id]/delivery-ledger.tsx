import type { ColonyDelivery } from '../../../../lib/api';
import { formatLocal, zoneLabel } from '../../../../lib/time';

/**
 * Every delivery, newest first.
 *
 * ★ THE SITE HAS BEEN THROWING THIS AWAY ★
 *
 * Both API controllers have always returned `deliveries`, and the website's own type omitted the
 * field — so the ledger was visible in the companion app and nowhere here. Nothing failed. The data
 * arrived on every page load and was discarded before anything could draw it.
 *
 * ★ WHY A LEDGER AND NOT JUST THE LEADERBOARD ★
 *
 * The leaderboard answers "who is carrying this build". This answers "did my run land" — which is
 * the question somebody has in the ninety seconds after they undock, and the only one that can tell
 * them the pipeline is working. A member who cannot see their own delivery appear concludes the
 * app is broken, which is exactly what happened here once already.
 */

const TH =
  'py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] ' +
  'text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

/** How many rows before it stops being a page and starts being a database dump. */
const SHOWN = 40;

export function DeliveryLedger({
  deliveries,
  tz,
}: {
  deliveries: readonly ColonyDelivery[];
  /** The viewer's stored IANA zone. Every "when" below renders in it, and the caption says so. */
  tz: string;
}) {
  if (deliveries.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        No deliveries recorded yet. They appear here within seconds of somebody with the companion
        app handing cargo over.
      </p>
    );
  }

  const shown = deliveries.slice(0, SHOWN);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={TH}>Commodity</th>
              <th className={TH}>Commander</th>
              <th className={`${TH} text-right`}>Tonnes</th>
              <th className={TH}>When</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d, i) => (
              <tr key={`${d.at}-${d.commodity}-${i}`}>
                <td className={`${TD} text-[var(--color-text-primary)]`}>{d.commodity}</td>
                <td className={`${TD} text-[var(--color-text-secondary)]`}>{d.commander}</td>
                <td className={`${TD} text-right font-mono tabular-nums`}>
                  {d.amount.toLocaleString()}
                </td>
                <td className={`${TD} font-mono text-[11px] text-[var(--color-text-secondary)]`}>
                  {/*
                    The full timestamp, not "3 hours ago". A relative time is friendlier and is the
                    wrong tool here: somebody checking whether their own run registered is comparing
                    against a clock, and "3 hours ago" cannot be compared to anything.

                    ★ THE MEMBER'S STORED ZONE, NOT A BARE toLocaleString — REPORTED 2026-08-04 ★

                    This is a server component, so a bare `toLocaleString` was the SERVER's clock —
                    an unlabelled time that looked local and wasn't. `formatLocal` takes the stored
                    zone explicitly, and the caption under the table names it.
                  */}
                  {formatLocal(d.at, tz)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deliveries.length > SHOWN ? (
        <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {/* Said out loud, because a truncated list that does not admit it is a list that lies. */}
          Showing the {SHOWN} most recent of {deliveries.length.toLocaleString()}.
        </p>
      ) : null}

      <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
        {/*
          The zone, stated — the same reason the audit log stamps UTC on every line. A time with
          no zone reads as whatever clock the reader assumes, and this table exists to be compared
          against one ("did my 23:30 run land?"). The offset rides along because a member quoting
          a row to a squadmate abroad needs it.
        */}
        Times in {tz} ({zoneLabel(tz)}).
      </p>
    </div>
  );
}
