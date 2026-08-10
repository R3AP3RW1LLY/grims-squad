import { CopySystem } from '../../../../components/copy-system';
import type { PurchaseStation } from '../../../../lib/api';

/**
 * Where the squadron has actually bought this build's materials.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "a way to declare what station a commander purchased various materials from so if they are
 * colonizing their own system, they can create their own catalogue that can be shared with other
 * people building in that system so that all materials that have been found and delivered can be
 * easily procurred without having to go hunt them down"
 *
 * ★ GROUPED BY STATION, BECAUSE THAT IS THE TRIP ★
 *
 * "group all materials bought at each station by the station name and system name please! so its
 * easy for us to identify where to go!"
 *
 * The shopping list above answers "where is the cheapest Steel", one commodity at a time. That is
 * the right question while planning and the wrong shape while flying: a hauler with a 720-tonne hold
 * wants ONE destination that fills it, not six holding one commodity each. So this is keyed on the
 * station — go here, and these are the things the squadron has actually got out of it.
 *
 * ★ THE SYSTEM IS THE NAVIGABLE PART, SO IT IS COPIABLE ★
 *
 * A station name alone is not somewhere you can go. The system it sits in is what gets pasted into
 * the galaxy map, which is why it is beside every heading with the same copy control the rest of
 * the site uses rather than as plain text somebody has to retype.
 */

const CARD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3';

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.round(months / 12)} years ago`;
}

export function PurchaseCatalogue({ stations }: { stations: readonly PurchaseStation[] }) {
  if (stations.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing bought for this system yet. Anything a member buys with the companion app running
        appears here automatically, and anybody building here can add a station by hand.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {stations.map((station) => (
        <div key={`${station.systemName} ${station.stationName}`} className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm text-[var(--color-text-primary)]">
              {station.stationName}
              <span className="ml-2 text-[11px] text-[var(--color-text-secondary)]">
                {station.systemName}
              </span>
              {/* The navigable part. Copiable for the same reason it is everywhere else on the
                  site: nobody should retype a procedurally generated system name. */}
              <CopySystem system={station.systemName} size="small" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              {station.lines.length} {station.lines.length === 1 ? 'material' : 'materials'} ·{' '}
              {ago(station.lastSeen)}
            </span>
          </div>

          <ul className="m-0 mt-2 list-none space-y-1 p-0">
            {station.lines.map((line) => (
              <li
                key={line.commodity}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-secondary)]"
              >
                <span className="text-[var(--color-text-primary)]">
                  {line.commodity}
                  {line.note === null ? null : (
                    <span className="ml-2 text-[11px] text-[var(--color-text-secondary)]">
                      {line.note}
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums">
                  {line.tonnes === null ? 'seen here' : `${line.tonnes.toLocaleString()} t`}
                  {line.price === null ? '' : ` · ${line.price.toLocaleString()} cr`}
                  {line.by === null ? '' : ` · ${line.by}`}
                  {/*
                    Said out loud, because the two mean different things. A watched row is what the
                    app saw somebody actually buy; a declared row is somebody's word for it, which
                    can be newer than any purchase and is the only source that can say "it is gone".
                  */}
                  <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
                    {line.source === 'manual' ? 'declared' : 'bought'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
