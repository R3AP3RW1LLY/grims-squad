import type { ColonyPlan } from '../../../../lib/api';
import { CopySystem } from '../../../../components/copy-system';

/**
 * A list of plans.
 *
 * ★ THE TONNAGE IS THE HEADLINE ★
 *
 * Not the number of sites. "Nine sites" says nothing about whether this is an evening or a
 * fortnight; four hundred thousand tonnes says it immediately, and it is the figure somebody is
 * deciding by when they look at a list of plans they might join.
 */
export function PlanBoard({ plans, empty }: { plans: readonly ColonyPlan[]; empty: string }) {
  if (plans.length === 0) {
    return <p className="m-0 text-sm text-[var(--color-text-secondary)]">{empty}</p>;
  }

  return (
    <ol className="m-0 grid list-none gap-2 p-0">
      {plans.map((p) => {
        /*
         * Summed from the sites the plan already holds rather than fetched. A plan with no build
         * types chosen yet is a real state — somebody sketching slots before deciding what goes in
         * them — and it reads as "nothing costed yet" rather than as zero.
         */
        const costed = p.sites.filter((s) => s.totalTonnes !== null);
        const tonnes = costed.reduce((sum, s) => sum + (s.totalTonnes ?? 0), 0);

        /*
         * ★ ONE FINDING, THE MOST ACTIONABLE — SQUADRON OWNER, 2026-08-22 ★
         *
         * Three conditions can be true at once and a broken plan is always also an old one. Showing
         * all of them buries the fault under two observations, and the eye lands on the last line.
         *
         * The server ranks them; this shows the first.
         */
        const flag = p.orphanFlags?.[0];

        return (
          <li
            key={p.id}
            className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3"
          >
            {flag !== undefined && (
              <p
                className={`m-0 mb-2 text-xs ${
                  flag.kind === 'dangling-sites'
                    ? 'text-[var(--color-semantic-warning)]'
                    : 'text-[var(--color-text-dim)]'
                }`}
              >
                {flag.message}
              </p>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="m-0 text-base">
                <a
                  href={`/colonisation/planning/${p.id}`}
                  className="text-[var(--color-text-primary)] no-underline hover:underline"
                >
                  {p.title}
                </a>
              </h3>
              <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                {p.sites.length === 0
                  ? 'nothing planned yet'
                  : costed.length === 0
                    ? `${p.sites.length} site${p.sites.length === 1 ? '' : 's'} · nothing costed yet`
                    : `${p.sites.length} site${p.sites.length === 1 ? '' : 's'} · ${tonnes.toLocaleString()} t`}
              </span>
            </div>

            <p className="m-0 mt-1 flex flex-wrap items-center gap-x-1 text-[11px] text-[var(--color-text-secondary)]">
              <span>{p.systemName}</span>
              <CopySystem system={p.systemName} size="small" />
              {p.postedBy === null ? null : <span>· by {p.postedBy}</span>}
              {/* The revision, said out loud. Two officers editing one plan is the case this exists
                  for, and a version nobody can see is a conflict nobody can explain. */}
              <span>· revision {p.version}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
