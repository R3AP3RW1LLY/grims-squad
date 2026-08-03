import type { ColonyNeed } from '../../../../lib/api';

/**
 * What a construction site still wants, biggest shortfall first.
 *
 * Each commodity links to the market, because "we need 4,000 tonnes of Steel" and "where is Steel"
 * are the same question asked half a second apart.
 */

const TH =
  'py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] ' +
  'text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

/**
 * How long ago the game told us this, in words.
 *
 * ★ A NEEDS LIST IS A SNAPSHOT, NOT A FEED ★
 *
 * It is only as current as the last time somebody docked at the site. Ten minutes old and it is
 * worth planning an evening around; a fortnight old and half of it may already be delivered. Those
 * two look identical without this line, which is why `observedAt` being stored and never shown was
 * worse than not storing it.
 */
function freshness(needs: readonly ColonyNeed[]): string | null {
  const stamps = needs
    .map((n) => (n.observedAt === null ? null : Date.parse(n.observedAt)))
    .filter((t): t is number => t !== null && Number.isFinite(t));

  if (stamps.length === 0) return null;

  const minutes = Math.floor((Date.now() - Math.max(...stamps)) / 60_000);
  if (minutes < 2) return 'Read from the site moments ago.';
  if (minutes < 90) return `Read from the site ${minutes} minutes ago.`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Read from the site ${hours} hours ago.`;

  return `Read from the site ${Math.round(hours / 24)} days ago — somebody docking there refreshes it.`;
}

export function NeedsTable({ needs }: { needs: readonly ColonyNeed[] }) {
  if (needs.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing recorded yet. The needs appear the first time somebody with the companion app docks
        at the site.
      </p>
    );
  }

  const outstanding = needs.filter((n) => n.remaining > 0);

  if (outstanding.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-semantic-success)]">
        Everything this site asked for has been delivered.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Commodity
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Still needed
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Delivered
            </th>
            <th scope="col" className={`${TH} w-[30%]`}>
              Progress
            </th>
          </tr>
        </thead>
        <tbody>
          {outstanding.map((n) => {
            // Null rather than zero when the total is unknown: a bar drawn at 0% claims nothing has
            // been delivered, which is a different statement from "we do not know the total".
            const pct =
              n.required !== null && n.required > 0
                ? Math.max(0, Math.min(100, ((n.required - n.remaining) / n.required) * 100))
                : null;

            return (
              <tr key={n.commodity} className="hover:bg-[var(--color-surface-panel)]">
                <td className={TD}>
                  <a
                    href={`/logistics/commodities/${encodeURIComponent(n.commodity)}`}
                    className="text-[var(--color-text-primary)] no-underline hover:underline"
                  >
                    {n.commodity}
                  </a>
                </td>
                <td className={`${TD} text-right font-mono tabular-nums`}>
                  {n.remaining.toLocaleString()} t
                </td>
                <td
                  className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                >
                  {n.required === null
                    ? '—'
                    : `${(n.required - n.remaining).toLocaleString()} / ${n.required.toLocaleString()}`}
                </td>
                <td className={TD}>
                  {pct === null ? (
                    <span className="text-[11px] text-[var(--color-text-secondary)]">unknown</span>
                  ) : (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-panel-sunken)]">
                      <div
                        className="h-full bg-[var(--color-brand-cyan)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Design principle: every number carries its provenance. This one is the provenance. */}
      {freshness(needs) === null ? null : (
        <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {freshness(needs)}
        </p>
      )}
    </div>
  );
}
