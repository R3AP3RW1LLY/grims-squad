import type { Opportunity } from '@grims/shared/colony-opportunity';
import type { ColonyProject } from '../../../lib/api';
import { CopySystem } from '../../../components/copy-system';

/**
 * A board of colonisation projects.
 *
 * ★ PROGRESS IS SHOWN ONLY WHEN IT IS KNOWN ★
 *
 * A project posted five minutes ago has no needs yet — nobody has docked at the site since, so no
 * journal has reported what it wants. That has to read as "waiting", not as a build needing
 * nothing: a full progress bar on an untouched project is the most misleading thing this component
 * could draw, and it would look exactly like success.
 */

function pct(project: ColonyProject): number | null {
  // Guarded on `required > 0`, not just on presence. A project whose needs are all recorded as zero
  // would divide by zero and render NaN% — which CSS silently treats as 0 and nobody notices.
  if (project.required <= 0) return null;
  const delivered = project.required - project.remaining;
  return Math.max(0, Math.min(100, (delivered / project.required) * 100));
}

export function ProjectBoard({
  projects,
  emptyMessage,
  notes,
}: {
  projects: readonly ColonyProject[];
  emptyMessage: string;
  /**
   * Per project — how far it is, whether it has gone quiet, and why it ranks where it does.
   *
   * Optional so the board still renders for a caller with no position and on any page that has not
   * ranked. A missing note draws the card exactly as it drew before this existed.
   */
  notes?: ReadonlyMap<string, Opportunity>;
}) {
  if (projects.length === 0) {
    return <p className="m-0 text-sm text-[var(--color-text-secondary)]">{emptyMessage}</p>;
  }

  return (
    <div className="grid gap-3">
      {projects.map((p) => {
        const progress = pct(p);
        const done = p.completedAt !== null;
        const note = notes?.get(p.id);

        return (
          <article
            key={p.id}
            /*
             * ★ THE GLASS THE SITE ALREADY SHIPS ★
             *
             * These were opaque rounded boxes while the companion's equivalent rows used the
             * chamfered translucent panel — on the two surfaces the owner asked to look alike, on
             * the main way into colonisation. `.panel` and `.panel-interactive` have been in
             * globals.css the whole time and were simply not applied here.
             */
            className={`panel panel-interactive p-4 ${
              p.isPriority ? 'border-[var(--color-brand-orange)]' : ''
            }`}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-base">
                <a
                  href={`/colonisation/${p.id}`}
                  className="text-[var(--color-text-primary)] no-underline hover:underline"
                >
                  {p.title}
                </a>
                {p.isPriority ? (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
                    current effort
                  </span>
                ) : null}
                {done ? (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-semantic-success)]">
                    complete
                  </span>
                ) : null}
              </h3>
              <p className="m-0 flex flex-wrap items-center gap-x-1 text-[11px] text-[var(--color-text-secondary)]">
                <span>{p.systemName}</span>
                {/*
                  Safe here because the link wraps the TITLE only, not the card — a button inside an
                  anchor is invalid markup and would navigate instead of copying.
                */}
                <CopySystem system={p.systemName} size="small" />
                <span>
                  {p.stationName === null ? null : ` · ${p.stationName}`}
                  {p.postedBy === null ? null : ` · posted by ${p.postedBy}`}
                </span>
                {/*
                  ★ HOW FAR, AND WHETHER IT HAS GONE QUIET ★

                  The two facts a member needs to choose between nineteen rows, and neither was on
                  the card. Distance is omitted rather than guessed when either end cannot be
                  placed — people haul to systems our galaxy dump has never heard of.
                */}
                {note?.distanceLy === null || note?.distanceLy === undefined ? null : (
                  <span className="font-mono tabular-nums text-[var(--color-text-primary)]">
                    · {note.distanceLy} ly
                  </span>
                )}
                {note?.stalled !== true ? null : (
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-semantic-warning)]"
                    title="A build nobody has hauled to in over a week looks exactly like a healthy one on a board, which is why it is said here."
                  >
                    · quiet {note.daysSinceDelivery} days
                  </span>
                )}
              </p>
            </header>

            {p.notes === null ? null : (
              <p className="m-0 mt-2 text-sm text-[var(--color-text-secondary)]">{p.notes}</p>
            )}

            <div className="mt-3">
              {p.needCount === 0 ? (
                /*
                 * The honest empty state. Nobody has docked at the site since it was posted, so we
                 * hold nothing about what it needs — which is not the same as it needing nothing.
                 */
                <p className="m-0 text-[11px] text-[var(--color-text-secondary)]">
                  Waiting for somebody to dock there — the needs appear once a journal reports them.
                </p>
              ) : (
                <>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-panel-sunken)]"
                    role="img"
                    aria-label={
                      progress === null
                        ? `${p.remaining.toLocaleString()} tonnes still needed`
                        : `${Math.round(progress)}% delivered`
                    }
                  >
                    <div
                      className="h-full bg-[var(--color-brand-cyan)]"
                      style={{ width: `${progress ?? 0}%` }}
                    />
                  </div>
                  <p className="m-0 mt-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {p.remaining.toLocaleString()} t still needed
                    {p.required > 0 ? ` of ${p.required.toLocaleString()}` : ''} ·{' '}
                    {p.needCount} commodit{p.needCount === 1 ? 'y' : 'ies'}
                  </p>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
