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
}: {
  projects: readonly ColonyProject[];
  emptyMessage: string;
}) {
  if (projects.length === 0) {
    return <p className="m-0 text-sm text-[var(--color-text-secondary)]">{emptyMessage}</p>;
  }

  return (
    <div className="grid gap-3">
      {projects.map((p) => {
        const progress = pct(p);
        const done = p.completedAt !== null;

        return (
          <article
            key={p.id}
            className={`rounded-lg border bg-[var(--color-surface-panel)] p-4 ${
              p.isPriority
                ? 'border-[var(--color-brand-orange)]'
                : 'border-[var(--color-border-hairline)]'
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
