import type { ColonyHauler } from '../../../../../lib/api';

/**
 * Who has hauled to this build.
 *
 * ★ TOTALS ONLY, AND THAT IS A PRIVACY DECISION ★
 *
 * The ledger records when every delivery happened, and this deliberately does not show it. A
 * contribution board that listed times would be an activity log of who was online at what hour —
 * a different thing entirely, and not something anybody agreed to by delivering cargo. A name and a
 * tonnage is what a leaderboard needs.
 */
export function HaulerBoard({ haulers }: { haulers: readonly ColonyHauler[] }) {
  if (haulers.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        No deliveries recorded yet. They appear here as soon as somebody with the companion app
        hands cargo over.
      </p>
    );
  }

  const total = haulers.reduce((sum, h) => sum + h.tonnes, 0);

  return (
    <div>
      <ol className="m-0 grid list-none gap-2 p-0">
        {haulers.map((h, i) => (
          <li
            key={`${h.name}-${i}`}
            className="flex items-center justify-between gap-4 rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-2.5"
          >
            <span className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-[var(--color-text-dim)]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-sm text-[var(--color-text-primary)]">{h.name}</span>
            </span>
            <span className="font-mono text-sm tabular-nums text-[var(--color-text-primary)]">
              {h.tonnes.toLocaleString()} t
            </span>
          </li>
        ))}
      </ol>

      <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
        {total.toLocaleString()} t delivered by {haulers.length} commander
        {haulers.length === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
