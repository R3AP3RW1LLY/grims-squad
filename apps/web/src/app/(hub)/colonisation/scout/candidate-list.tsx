import Link from 'next/link';
import type { ScoutResult, ScoutCandidateRow } from '../../../../lib/api';

/**
 * The candidates, best first.
 *
 * ★ THE PERMIT IS ON EVERY ROW, NOT IN A FOOTNOTE ★
 *
 * A system with no station in claim range cannot be taken at all, however good it looks — which
 * makes it worth less than a mediocre one that can. And WHOSE station sells the claim decides which
 * power the system joins, permanently. Both belong on the row, beside the name.
 */

function ls(v: number | null): string {
  if (v === null) return '—';
  return v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M Ls`
    : `${Math.round(v).toLocaleString()} Ls`;
}

/** Arrival distance, coloured by what it costs you every single visit. */
function Reach({ candidate }: { candidate: ScoutCandidateRow }) {
  if (!candidate.surveyed) {
    return <span className="text-[var(--color-text-secondary)]">not surveyed</span>;
  }
  if (candidate.nearestLandableLs === null) {
    return <span className="text-[var(--color-semantic-hostile-bright)]">nothing landable</span>;
  }

  const v = candidate.nearestLandableLs;
  const tone =
    v < 5_000
      ? 'text-[var(--color-semantic-success)]'
      : v < 50_000
        ? 'text-[var(--color-semantic-warning)]'
        : 'text-[var(--color-semantic-hostile-bright)]';

  return <span className={`font-mono tabular-nums ${tone}`}>{ls(v)}</span>;
}

export function CandidateList({ result }: { result: ScoutResult }) {
  if (result.candidates.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing claimable inside that range. Everything nearby is already colonised, inhabited or
        permit-locked. Widening the range is the usual fix — a claim only reaches 15 ly, but the
        candidate does not have to be near <em>you</em>.
      </p>
    );
  }

  const anchor = result.anchor;

  return (
    <div className="grid gap-3">
      {anchor !== null ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          Searching from <strong className="text-[var(--color-text-primary)]">{anchor.system}</strong>
          {anchor.controllingFaction === null ? null : (
            <>
              {' — '}
              {anchor.allegiance ?? 'unaligned'}, run by{' '}
              <strong className="text-[var(--color-text-primary)]">{anchor.controllingFaction}</strong>
            </>
          )}
          . {result.consideredSystems} claimable {result.consideredSystems === 1 ? 'system' : 'systems'}{' '}
          considered against {result.permitSources} possible permit{' '}
          {result.permitSources === 1 ? 'source' : 'sources'}.
        </p>
      ) : null}

      {result.candidates.map((c) => (
        <article
          key={c.system}
          className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4"
        >
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="m-0 text-base text-[var(--color-text-primary)]">{c.system}</h3>
            <Link
              href={`/colonisation/scout/${encodeURIComponent(c.system)}`}
              className="font-mono text-xs text-[var(--color-brand-orange-bright)] underline hover:text-[var(--color-brand-orange)]"
            >
              Survey it →
            </Link>
          </header>

          <p className="m-0 mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
            <span>
              {c.bodyCount > 0 ? `${c.bodyCount} bodies` : 'body count unknown'}
              {c.surveyed && c.landableCount > 0 ? ` · ${c.landableCount} landable` : ''}
            </span>
            <span>
              nearest landable <Reach candidate={c} />
            </span>
            {c.pristine ? (
              <span className="text-[var(--color-semantic-success)]">Pristine</span>
            ) : null}
          </p>

          {/*
            ★ THE TWO FACTS THAT DECIDE WHETHER THIS IS EVEN POSSIBLE ★

            No permit source in range means the system cannot be claimed at all — said plainly here
            rather than left for somebody to discover after flying out to look at it.
          */}
          {c.permit === null ? (
            <p className="m-0 rounded border border-[var(--color-semantic-hostile-bright)] px-2 py-1 text-sm text-[var(--color-semantic-hostile-bright)]">
              No station in claim range. This system cannot be claimed from anywhere nearby.
            </p>
          ) : (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              Buy the claim at{' '}
              <strong className="text-[var(--color-text-primary)]">{c.permit.system}</strong>
              {c.permitLy === null ? '' : ` — ${c.permitLy.toFixed(1)} ly`}
              {c.permit.allegiance === null ? null : (
                <>
                  {', '}
                  <strong
                    className={
                      anchor?.allegiance !== null && c.permit.allegiance === anchor?.allegiance
                        ? 'text-[var(--color-semantic-success)]'
                        : 'text-[var(--color-semantic-warning)]'
                    }
                  >
                    {c.permit.allegiance}
                  </strong>
                </>
              )}
              {c.permit.stationCount > 0 ? ` · ${c.permit.stationCount} stations` : ''}
            </p>
          )}
        </article>
      ))}

      {/*
        Said out loud: an unsurveyed candidate is ranked on what we know, which is body count and
        the permit. Surveying it can move it a long way in either direction.
      */}
      <p className="m-0 text-xs text-[var(--color-text-secondary)]">
        Candidates are ranked on body count, landable bodies, arrival distance and how comfortably
        the permit sits in range. Anything not yet surveyed is scored on what we hold — surveying it
        will move it.
      </p>
    </div>
  );
}
