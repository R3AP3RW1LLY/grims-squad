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

/**
 * The three-segment progress bar: delivered (filled), aboard attached carriers (yellow), still to
 * source (empty track).
 *
 * ★ THE MIDDLE SEGMENT IS THE ONE THAT CHANGES DECISIONS ★
 *
 * A two-state bar makes 20,000 t on a carrier parked at the site look identical to 20,000 t nobody
 * has bought — and those are different builds to plan an evening around. The staged tonnage is the
 * server's effective figure (manual beats journal beats mirror), capped so the bar never claims
 * more than the site still wants.
 */
export function SegmentedBar({
  delivered,
  staged,
  required,
}: {
  delivered: number;
  staged: number;
  required: number;
}) {
  if (required <= 0) return null;
  const deliveredPct = Math.max(0, Math.min(100, (delivered / required) * 100));
  const stagedPct = Math.max(0, Math.min(100 - deliveredPct, (staged / required) * 100));

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-panel-sunken)]">
      <div className="h-full bg-[var(--color-brand-cyan)]" style={{ width: `${deliveredPct}%` }} />
      <div
        className="h-full bg-[var(--color-semantic-warning)]"
        style={{ width: `${stagedPct}%` }}
      />
    </div>
  );
}

/** The legend the segmented bar earns, printed once per table rather than per row. */
export function BarLegend() {
  return (
    <p className="m-0 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--color-text-secondary)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-4 rounded-full bg-[var(--color-brand-cyan)]" />
        delivered
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-4 rounded-full bg-[var(--color-semantic-warning)]" />
        aboard attached carriers
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-4 rounded-full bg-[var(--color-surface-panel-sunken)]" />
        still to source
      </span>
    </p>
  );
}

export function NeedsTable({
  needs,
  carrierCover,
}: {
  needs: readonly ColonyNeed[];
  /** Effective tonnes aboard attached carriers per commodity, from the server's merge. */
  carrierCover: Readonly<Record<string, number>>;
}) {
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
            // A bar drawn with an unknown total claims nothing has been delivered, which is a
            // different statement from "we do not know the total" — so it stays "unknown".
            const knowsTotal = n.required !== null && n.required > 0;
            const staged = Math.min(n.remaining, Math.max(0, carrierCover[n.commodity] ?? 0));

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
                  {staged > 0 ? (
                    <span
                      className="ml-1.5 text-[11px] text-[var(--color-semantic-warning)]"
                      title="Effective tonnes already aboard the build's attached carriers."
                    >
                      {staged.toLocaleString()} t aboard
                    </span>
                  ) : null}
                </td>
                <td
                  className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                >
                  {n.required === null
                    ? '—'
                    : `${(n.required - n.remaining).toLocaleString()} / ${n.required.toLocaleString()}`}
                </td>
                <td className={TD}>
                  {!knowsTotal ? (
                    <span className="text-[11px] text-[var(--color-text-secondary)]">unknown</span>
                  ) : (
                    <SegmentedBar
                      delivered={(n.required ?? 0) - n.remaining}
                      staged={staged}
                      required={n.required ?? 0}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <BarLegend />

      {/* Design principle: every number carries its provenance. This one is the provenance. */}
      {freshness(needs) === null ? null : (
        <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {freshness(needs)}
        </p>
      )}
    </div>
  );
}
