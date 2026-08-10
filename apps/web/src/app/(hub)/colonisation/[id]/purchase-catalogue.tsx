import { CopySystem } from '../../../../components/copy-system';
import type { PurchaseStation } from '../../../../lib/api';

/**
 * The shopping route — where to fly for what this build still needs.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "the stations shown where weve bought it from should only show materials for the specific project
 * at hand, and should also only show the closet stations not every station ... also dont show
 * duplicate materials plan this so that the stations show the most matierals that can be bought for
 * the project ... we need it to work like this so we dont have people buying duplicte materials etc
 * and showing up and they already exist etc!"
 *
 * ★ WHAT THIS PANEL USED TO BE ★
 *
 * A record: every station the squadron had ever bought at, everything ever bought there. Accurate,
 * and the wrong shape — four people read it and all four flew for the same Steel, and one of them
 * flew for something that had been delivered the week before.
 *
 * ★ SO IT RENDERS A PLAN, AND MAKES NO DECISIONS OF ITS OWN ★
 *
 * The API has already dropped fleet carriers, anything the build no longer needs, and anything
 * already aboard an attached carrier — and it names each material at exactly ONE stop. Two stops
 * both listing Steel would be a fault upstream, not something to paper over here.
 *
 * The two things this page adds are the two a person needs to decide whether to go: how far it is,
 * and what the trip will NOT get them.
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

export function PurchaseCatalogue({
  stations,
  uncovered,
}: {
  stations: readonly PurchaseStation[];
  uncovered: readonly string[];
}) {
  if (stations.length === 0 && uncovered.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing bought for this system yet. Anything a member buys with the companion app running
        appears here automatically, and anybody building here can add a station by hand.
      </p>
    );
  }

  const covered = stations.reduce((n, s) => n + s.lines.length, 0);

  return (
    <div className="flex flex-col gap-3">
      {stations.length === 0 ? null : (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          {/* The whole point of the panel, said in one line: each material is named once, so two
              people reading this do not both fly for it. */}
          {covered} {covered === 1 ? 'material' : 'materials'} across {stations.length}{' '}
          {stations.length === 1 ? 'stop' : 'stops'}. Each one is listed at a single station, so
          nobody buys the same thing twice.
        </p>
      )}

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
              {/* Distance first: it is what decides whether this stop is worth the trip. Omitted
                  rather than guessed when we cannot place one end of it. */}
              {station.distanceLy === null ? '' : `${station.distanceLy.toFixed(1)} ly · `}
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

      {uncovered.length === 0 ? null : (
        <div className={CARD}>
          {/*
            ★ SAID, NOT OMITTED ★

            A route that quietly leaves these off reads as "this trip gets you everything", and
            somebody flies the whole thing and comes home still needing them. The market suggestions
            below this panel are exactly where to look next, which is why the sentence points there.
          */}
          <p className="m-0 text-xs text-[var(--color-text-secondary)]">
            <span className="text-[var(--color-text-primary)]">
              Nobody has bought {uncovered.length === 1 ? 'this one' : `these ${uncovered.length}`}{' '}
              yet
            </span>{' '}
            — the market suggestions below are the place to start looking, and adding the station
            afterwards puts it on this route for everybody else.
          </p>
          <p className="m-0 mt-2 text-xs text-[var(--color-text-primary)]">
            {uncovered.join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
}
