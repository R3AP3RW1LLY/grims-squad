import Link from 'next/link';
import type { SharedBuildRow } from '../../../lib/api';

/**
 * A board of published builds.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add a Squadron page and Public build pages to the Shipyard category please, the public page must
 * also be visible along with the builds in them to anyone not signed in from the homepage."
 *
 * ★ ONE COMPONENT, TWO PAGES ★
 *
 * The squadron board and the public board differ in exactly one thing — which rows the server
 * returns — so they are the same component. Two copies would drift the moment somebody added a
 * column to one of them, and the difference between "shared with the squadron" and "shared with the
 * world" is not a difference in how a build should be presented.
 */

const num = (stats: Record<string, unknown> | null, key: string): string => {
  const value = stats?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  mining: 'Mining',
  combat: 'Combat',
  exploration: 'Exploration',
  trading: 'Trading',
  multipurpose: 'Multipurpose',
};

/** "3 days ago" beats a timestamp for a board somebody skims. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months} month${months === 1 ? '' : 's'} ago` : 'over a year ago';
}

export function BuildBoard({
  builds,
  emptyMessage,
}: {
  readonly builds: readonly SharedBuildRow[];
  /** What to say when there is nothing yet. Different for each board, so it is passed in. */
  readonly emptyMessage: string;
}) {
  if (builds.length === 0) {
    return <p className="m-0 text-sm text-[var(--color-text-secondary)]">{emptyMessage}</p>;
  }

  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
      {builds.map((build) => (
        <li key={build.shareToken}>
          <Link
            href={`/shipyard/build/${build.shareToken}`}
            className="block h-full rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4 no-underline transition-colors hover:border-[var(--color-border-subtle)]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-sm text-[var(--color-text-primary)]">
                {build.buildName ?? build.shipName}
              </h3>
              {/*
                The public marker appears on the SQUADRON board, where it is news — this build is
                also outside. On the public board every row is public and a badge on all of them
                would be decoration.
              */}
              {build.visibility === 'public' && (
                <span className="shrink-0 rounded border border-[var(--color-brand-cyan)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-brand-cyan-bright)]">
                  Public
                </span>
              )}
            </div>

            <p className="m-0 mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {build.shipName}
              {build.role === null ? '' : ` · ${ROLE_LABELS[build.role] ?? build.role}`}
            </p>

            <dl className="m-0 mt-3 grid grid-cols-4 gap-2 border-t border-[var(--color-border-hairline)] pt-2.5">
              {[
                ['Jump', num(build.stats, 'jumpRange'), 'ly'],
                ['Cargo', num(build.stats, 'cargoCapacity'), 't'],
                ['Shields', num(build.stats, 'shields'), 'MJ'],
                ['DPS', num(build.stats, 'dps'), ''],
              ].map(([label, value, unit]) => (
                <div key={label} className="min-w-0">
                  <dt className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-dim)]">
                    {label}
                  </dt>
                  <dd className="m-0 font-mono text-[11px] tabular-nums text-[var(--color-text-primary)]">
                    {value}
                    {unit === '' ? '' : <span className="text-[9px] text-[var(--color-text-dim)]"> {unit}</span>}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="m-0 mt-2.5 font-mono text-[10px] text-[var(--color-text-dim)]">
              {/*
                Credited by name. The owner's rule for the build corpus was "real answers with
                names", and a board of anonymous builds is a board nobody can ask about.
              */}
              {build.author ?? 'the squadron'} · {ago(build.updatedAt)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
